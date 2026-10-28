//! Append-only DISPLAY transcript.
//!
//! The model snapshot is intentionally compacted: old turns are drained into a
//! summary anchor so the provider context stays bounded. The WebUI/TUI, however,
//! must keep showing the full conversation. This module persists one JSONL record
//! per message, **outside** the model context, and never compacts it.
//!
//! Ordering: the file is append-only; a record's identity is `(turn_id, index)`.
//! `turn_id` is the kernel's monotonic turn counter, so a retried terminal can be
//! skipped idempotently. Unlike `snapshot.messages` indices, these never shift
//! when compaction replaces old history with a summary.
//!
//! Images are stored inline (base64) in v1. They are part of the record, so a
//! later compaction cannot remove them. A content-addressed blob store can be
//! layered under the same field without changing the read model.

use std::sync::Mutex;

use async_trait::async_trait;
use jeikcode_kernel::event::StopReason;
use jeikcode_kernel::hook::{LifecycleHooks, TurnCtx};
use jeikcode_kernel::message::{Conversation, Message, Role};
use serde::{Deserialize, Serialize};

use super::manager::SessionManager;
use super::{SessionResult, SessionStoreError};

pub const DISPLAY_VERSION: u32 = 3;
pub const MAX_DISPLAY_BYTES: usize = 512 * 1024 * 1024;
/// The reader loads the whole log (records + inline images). Keep a bounded
/// read but align it with realistic image-heavy sessions; beyond this the
/// daemon falls back to the snapshot projection and must not retry a backfill
/// that cannot be read back. A future streaming/indexed reader can lift this.
pub const MAX_DISPLAY_READ_BYTES: usize = 256 * 1024 * 1024;
pub const MAX_DISPLAY_LINES: usize = 1_000_000;

/// One image attached to a user display row. `missing` marks a VL-preprocessed
/// submission whose original lives in the daemon's `.images.json` sidecar.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct DisplayImage {
    pub media_type: String,
    pub data: String,
    #[serde(default, skip_serializing_if = "std::ops::Not::not")]
    pub missing: bool,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct DisplayToolCall {
    pub id: String,
    pub name: String,
    pub arguments: String,
}

/// One display message. It mirrors the kernel message fields the UI needs, but is
/// a standalone DTO so it can never be fed back to a provider.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct DisplayRecord {
    #[serde(default = "display_version")]
    pub v: u32,
    pub session_id: String,
    pub turn_id: u64,
    /// Position within this turn's conversation slice. `(turn_id, index)` is the
    /// idempotent identity for a retried terminal.
    pub index: u32,
    pub role: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub id: Option<String>,
    #[serde(default)]
    pub content: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub reasoning: Option<String>,
    #[serde(default)]
    pub synthetic: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub internal_origin: Option<String>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub tool_calls: Vec<DisplayToolCall>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub tool_call_id: Option<String>,
    #[serde(default)]
    pub is_error: bool,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub images: Vec<DisplayImage>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub created_at: Option<u64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub elapsed_ms: Option<u64>,
}

fn display_version() -> u32 {
    DISPLAY_VERSION
}

impl DisplayRecord {
    pub fn from_message(
        session_id: &str,
        working_dir: &std::path::Path,
        turn_id: u64,
        index: u32,
        message: &Message,
    ) -> Self {
        let role = match message.role {
            Role::System => "system",
            Role::User => "user",
            Role::Assistant => "assistant",
            Role::Tool => "tool",
        };
        let mut images: Vec<DisplayImage> = message
            .images
            .iter()
            .map(|image| DisplayImage {
                media_type: image.media_type.clone(),
                data: image.data.clone(),
                missing: false,
            })
            .collect();
        // VL-preprocessed submissions keep a textual vision marker and no image
        // (the original lives in the daemon sidecar). Persist a placeholder so
        // the read path can re-attach the sidecar set in order.
        if message.role == Role::User
            && images.is_empty()
            && (message.text.contains("[图片内容（由") || message.text.contains("[图片识别失败]"))
        {
            images.push(DisplayImage {
                media_type: "image/png".into(),
                data: "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==".into(),
                missing: true,
            });
        }
        let content = if message.role == Role::User {
            super::user_text_for_display(working_dir, &message.text)
        } else {
            message.text.clone()
        };
        Self {
            v: DISPLAY_VERSION,
            session_id: session_id.to_string(),
            turn_id,
            index,
            role: role.to_string(),
            id: message.id.clone(),
            content,
            reasoning: message
                .reasoning
                .clone()
                .filter(|reasoning| !reasoning.is_empty()),
            synthetic: message.synthetic,
            internal_origin: message.internal_origin.clone(),
            tool_calls: message
                .tool_calls
                .iter()
                .map(|call| DisplayToolCall {
                    id: call.id.clone(),
                    name: call.name.clone(),
                    arguments: call.arguments.clone(),
                })
                .collect(),
            tool_call_id: message.tool_call_id.clone(),
            is_error: message.is_error,
            images,
            created_at: (message.created_at_ms > 0).then_some(message.created_at_ms),
            elapsed_ms: message
                .meta
                .as_ref()
                .map(|meta| meta.elapsed_ms)
                .filter(|elapsed| *elapsed > 0),
        }
    }
}

/// Sidecar telling the reader whether the log covers the whole session. A log
/// without meta (crash between append and meta write) is ignored and rebuilt.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct DisplayMeta {
    #[serde(default = "display_version")]
    pub v: u32,
    /// False while a backfill/new log is being written.
    #[serde(default)]
    pub complete: bool,
    /// Highest kernel turn id covered. Future turns append above this.
    #[serde(default)]
    pub last_turn_id: u64,
    /// True when the prefix was reconstructed from the compacted snapshot/JSONL
    /// (images from already-drained turns cannot be recovered).
    #[serde(default)]
    pub backfilled: bool,
    #[serde(default)]
    pub updated_at: u64,
}

impl Default for DisplayMeta {
    fn default() -> Self {
        Self {
            v: DISPLAY_VERSION,
            complete: false,
            last_turn_id: 0,
            backfilled: false,
            updated_at: 0,
        }
    }
}

/// Lifecycle hook that appends every completed turn to `<id>.display.jsonl`.
///
/// `turn_start` snapshots the conversation length AFTER the user message entered
/// history (the kernel pushes it before `run_turn`); the terminal then writes the
/// exact `[start..]` slice, preserving round order, reasoning, tool calls, tool
/// results and images.
#[derive(Clone, Debug)]
struct TurnAnchor {
    id: Option<String>,
    text: String,
    synthetic: bool,
    start_index: usize,
}

pub struct DisplayHook {
    mgr: std::sync::Arc<SessionManager>,
    session_id: String,
    working_dir: std::path::PathBuf,
    anchor: Mutex<Option<TurnAnchor>>,
}

impl DisplayHook {
    pub fn new(
        mgr: std::sync::Arc<SessionManager>,
        session_id: impl Into<String>,
        working_dir: impl Into<std::path::PathBuf>,
    ) -> Self {
        Self {
            mgr,
            session_id: session_id.into(),
            working_dir: working_dir.into(),
            anchor: Mutex::new(None),
        }
    }

    fn write_turn(&self, convo: &Conversation, turn_id: u64) {
        let anchor = self
            .anchor
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
            .take();
        // Mid-turn compaction can drain messages BEFORE the recorded start index.
        // Re-anchor on the turn's prompt message (id first, then text) so the
        // display slice still starts at the real user question.
        let anchored = anchor.as_ref().and_then(|anchor| {
            convo.messages.iter().rposition(|message| {
                if let Some(id) = anchor.id.as_deref() {
                    message.id.as_deref() == Some(id)
                } else {
                    message.role == Role::User
                        && message.synthetic == anchor.synthetic
                        && message.text == anchor.text
                }
            })
        });
        let start = anchored.unwrap_or_else(|| {
            anchor
                .as_ref()
                .map(|anchor| anchor.start_index.min(convo.messages.len()))
                .unwrap_or(convo.messages.len())
        });
        if start >= convo.messages.len() || turn_id == 0 || convo.messages[start].role != Role::User
        {
            // Never write a slice that starts mid-assistant/tool: that would
            // persist a turn without its question. The daemon backfills from the
            // snapshot on the next idle read instead.
            return;
        }
        let records: Vec<DisplayRecord> = convo.messages[start..]
            .iter()
            .enumerate()
            .map(|(index, message)| {
                DisplayRecord::from_message(
                    &self.session_id,
                    &self.working_dir,
                    turn_id,
                    u32::try_from(index).unwrap_or(u32::MAX),
                    message,
                )
            })
            .collect();
        if let Err(error) = self
            .mgr
            .append_display_turn(&self.session_id, turn_id, &records)
        {
            eprintln!("[DisplayHook] append display transcript failed: {error}");
        }
    }
}

#[async_trait]
impl LifecycleHooks for DisplayHook {
    async fn turn_start(&self, convo: &mut Conversation) {
        // The kernel pushes the prompt BEFORE run_turn→turn_start. Prefer the
        // latest real user message; for a synthetic continuation there is none,
        // so fall back to the last message (the synthetic prompt).
        let message = convo
            .messages
            .iter()
            .rev()
            .find(|message| message.role == Role::User && !message.synthetic)
            .or_else(|| convo.messages.last());
        *self
            .anchor
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner()) = message.map(|message| TurnAnchor {
            id: message.id.clone(),
            text: message.text.clone(),
            synthetic: message.synthetic,
            start_index: convo.messages.len(),
        });
    }

    async fn turn_complete(&self, convo: &Conversation, reason: &StopReason, ctx: &TurnCtx) {
        // A cancelled/rejected turn is rolled back (or never ran); the snapshot
        // does not commit a user message for it either. Do not leak it into the
        // display transcript.
        if matches!(reason, StopReason::Cancelled | StopReason::PromptRejected) {
            return;
        }
        self.write_turn(convo, ctx.turn_id);
    }
}

impl SessionManager {
    /// Append-only UI transcript (never compacted). Sibling of the snapshot.
    pub fn display_path(&self, id: &str) -> SessionResult<std::path::PathBuf> {
        self.path_for(id, "display.jsonl")
    }

    /// Completeness/coverage sidecar for [`display_path`](Self::display_path).
    pub fn display_meta_path(&self, id: &str) -> SessionResult<std::path::PathBuf> {
        self.path_for(id, "display.meta.json")
    }

    /// Append one completed turn. A log is only created for a brand-new session
    /// (turn 1). For an existing session without a log, the daemon backfills on
    /// the next idle read; writing only the new turn would create a partial log.
    pub(crate) fn append_display_turn(
        &self,
        id: &str,
        turn_id: u64,
        records: &[DisplayRecord],
    ) -> SessionResult<()> {
        if records.is_empty() {
            return Ok(());
        }
        let meta_path = self.display_meta_path(id)?;
        let mut meta = match crate::session::manager::read_json_optional::<DisplayMeta>(
            &meta_path,
            "display meta",
        )? {
            Some(meta) => meta,
            None => {
                if turn_id != 1 {
                    return Ok(());
                }
                // First turn of a brand-new session: this append WILL make the
                // log complete. Do not trip the incomplete-log guard below.
                DisplayMeta {
                    complete: true,
                    ..DisplayMeta::default()
                }
            }
        };
        // Never append to a log written by a different projection. The next
        // read returns None and the daemon backfills it in the current schema.
        if meta.v != DISPLAY_VERSION {
            return Ok(());
        }
        // Idempotent terminal: a retry/late duplicate of an already written turn.
        if meta.last_turn_id >= turn_id {
            return Ok(());
        }
        if !meta.complete {
            // A crashed backfill / first-turn write is incomplete. Let the reader
            // rebuild instead of appending to a partial log.
            return Ok(());
        }
        let mut bytes = Vec::with_capacity(records.len() * 512);
        for record in records {
            serde_json::to_writer(&mut bytes, record).map_err(|error| {
                SessionStoreError::Corrupt {
                    kind: "display record",
                    message: error.to_string(),
                }
            })?;
            bytes.push(b'\n');
        }
        let path = self.display_path(id)?;
        self.append_jsonl_line_at(id, &path, "display transcript", &bytes)?;
        meta.last_turn_id = turn_id;
        meta.updated_at = u64::try_from(super::now_ms()).unwrap_or(0);
        self.write_display_meta(id, &meta)?;
        Ok(())
    }

    /// Replace the log with a complete snapshot-derived projection. Used for the
    /// first read of an old session (and after an explicit mutation).
    pub fn write_display_backfill(
        &self,
        id: &str,
        records: &[DisplayRecord],
        last_turn_id: u64,
    ) -> SessionResult<()> {
        let meta_path = self.display_meta_path(id)?;
        let mut incomplete = DisplayMeta {
            complete: false,
            last_turn_id: 0,
            backfilled: true,
            updated_at: u64::try_from(super::now_ms()).unwrap_or(0),
            ..DisplayMeta::default()
        };
        self.write_display_meta(id, &incomplete)?;
        let path = self.display_path(id)?;
        let mut bytes = Vec::with_capacity(records.len() * 512);
        for record in records {
            serde_json::to_writer(&mut bytes, record).map_err(|error| {
                SessionStoreError::Corrupt {
                    kind: "display record",
                    message: error.to_string(),
                }
            })?;
            bytes.push(b'\n');
        }
        self.write_bytes_atomic(&path, &bytes, "display transcript", MAX_DISPLAY_BYTES)?;
        incomplete.complete = true;
        incomplete.last_turn_id = last_turn_id;
        incomplete.updated_at = u64::try_from(super::now_ms()).unwrap_or(0);
        self.write_display_meta(id, &incomplete)
    }

    fn write_display_meta(&self, id: &str, meta: &DisplayMeta) -> SessionResult<()> {
        let path = self.display_meta_path(id)?;
        let bytes =
            serde_json::to_vec_pretty(meta).map_err(|error| SessionStoreError::Corrupt {
                kind: "display meta",
                message: error.to_string(),
            })?;
        self.write_bytes_atomic(&path, &bytes, "display meta", 64 * 1024)
    }

    /// Read a complete display log. `None` means it is absent or incomplete; the
    /// caller must fall back to the snapshot projection (and may backfill).
    pub fn read_display(
        &self,
        id: &str,
    ) -> SessionResult<Option<(DisplayMeta, Vec<DisplayRecord>)>> {
        let meta_path = self.display_meta_path(id)?;
        let Some(meta) =
            crate::session::manager::read_json_optional::<DisplayMeta>(&meta_path, "display meta")?
        else {
            return Ok(None);
        };
        // An old/future display projection must be rebuilt from the snapshot
        // rather than interpreted with the current index coordinate system.
        if !meta.complete || meta.v != DISPLAY_VERSION {
            return Ok(None);
        }
        let path = self.display_path(id)?;
        let bytes =
            match self.read_bytes_bounded(&path, "display transcript", MAX_DISPLAY_READ_BYTES) {
                Ok(bytes) => bytes,
                Err(SessionStoreError::NotFound { .. }) => return Ok(None),
                Err(error) => return Err(error),
            };
        let mut records = Vec::new();
        let lines: Vec<&[u8]> = bytes.split(|byte| *byte == b'\n').collect();
        for (index, line) in lines.iter().enumerate() {
            if line.is_empty() {
                continue;
            }
            if records.len() >= MAX_DISPLAY_LINES {
                return Err(SessionStoreError::TooLarge {
                    kind: "display lines",
                    limit: MAX_DISPLAY_LINES,
                    actual: records.len() + 1,
                });
            }
            match serde_json::from_slice::<DisplayRecord>(line) {
                Ok(record) if record.v == DISPLAY_VERSION => records.push(record),
                // A record from another schema cannot be mixed with current
                // coordinates; fall back to the snapshot projection.
                Ok(_) => return Ok(None),
                // A crash can leave a partial final line. Ignore ONLY that line;
                // corruption in the middle is explicit.
                Err(_) if index + 1 == lines.len() => break,
                Err(error) => {
                    return Err(SessionStoreError::Corrupt {
                        kind: "display record",
                        message: error.to_string(),
                    })
                }
            }
        }
        Ok(Some((meta, records)))
    }

    /// Drop the display log + meta so the next read rebuilds from the snapshot.
    /// Compaction must NEVER call this; explicit mutations/deletes do.
    pub fn invalidate_display(&self, id: &str) -> SessionResult<()> {
        for path in [self.display_meta_path(id)?, self.display_path(id)?] {
            match std::fs::remove_file(&path) {
                Ok(()) => {}
                Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
                Err(source) => return Err(SessionStoreError::Io { path, source }),
            }
        }
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn record(turn_id: u64, index: u32, text: &str) -> DisplayRecord {
        DisplayRecord {
            v: DISPLAY_VERSION,
            session_id: "s1".into(),
            turn_id,
            index,
            role: "user".into(),
            id: Some(format!("m-{turn_id}-{index}")),
            content: text.into(),
            reasoning: None,
            synthetic: false,
            internal_origin: None,
            tool_calls: Vec::new(),
            tool_call_id: None,
            is_error: false,
            images: Vec::new(),
            created_at: Some(1_000 + i64::from(index) as u64),
            elapsed_ms: None,
        }
    }

    #[test]
    fn display_log_is_append_only_and_idempotent_per_turn() {
        let dir = tempfile::tempdir().unwrap();
        let mgr = SessionManager::with_root(dir.path());
        mgr.append_display_turn("s1", 1, &[record(1, 0, "Q1"), record(1, 1, "A1")])
            .unwrap();
        let (meta, rows) = mgr.read_display("s1").unwrap().unwrap();
        assert!(meta.complete);
        assert_eq!(meta.last_turn_id, 1);
        assert_eq!(rows.len(), 2);

        mgr.append_display_turn("s1", 2, &[record(2, 0, "Q2")])
            .unwrap();
        // A retried terminal for turn 2 must not duplicate rows.
        mgr.append_display_turn("s1", 2, &[record(2, 0, "Q2")])
            .unwrap();
        let (meta, rows) = mgr.read_display("s1").unwrap().unwrap();
        assert_eq!(meta.last_turn_id, 2);
        assert_eq!(rows.len(), 3);

        // Turn ids may have gaps (cancelled/rejected turns never wrote a log).
        // Once a complete log exists, appending the next settled turn is fine.
        mgr.append_display_turn("s1", 5, &[record(5, 0, "late")])
            .unwrap();
        let (_, rows) = mgr.read_display("s1").unwrap().unwrap();
        assert_eq!(rows.len(), 4);
    }

    #[test]
    fn display_log_is_not_created_from_a_later_turn_without_a_backfill() {
        let dir = tempfile::tempdir().unwrap();
        let mgr = SessionManager::with_root(dir.path());
        mgr.append_display_turn("s1", 5, &[record(5, 0, "late")])
            .unwrap();
        assert!(mgr.read_display("s1").unwrap().is_none());
    }

    #[test]
    fn display_backfill_then_append_keeps_old_and_new_turns() {
        let dir = tempfile::tempdir().unwrap();
        let mgr = SessionManager::with_root(dir.path());
        mgr.write_display_backfill("s1", &[record(0, 0, "old Q"), record(0, 1, "old A")], 7)
            .unwrap();
        let (meta, rows) = mgr.read_display("s1").unwrap().unwrap();
        assert!(meta.backfilled);
        assert_eq!(meta.last_turn_id, 7);
        assert_eq!(rows.len(), 2);

        mgr.append_display_turn("s1", 8, &[record(8, 0, "new Q")])
            .unwrap();
        let (meta, rows) = mgr.read_display("s1").unwrap().unwrap();
        assert_eq!(meta.last_turn_id, 8);
        assert_eq!(rows.len(), 3);
        assert_eq!(rows[2].content, "new Q");
    }

    #[test]
    fn display_reader_ignores_a_partial_final_line() {
        let dir = tempfile::tempdir().unwrap();
        let mgr = SessionManager::with_root(dir.path());
        mgr.append_display_turn("s1", 1, &[record(1, 0, "Q1")])
            .unwrap();
        let path = mgr.display_path("s1").unwrap();
        let mut bytes = std::fs::read(&path).unwrap();
        bytes.extend_from_slice(b"{\"v\":1,\"session_id\":\"s1\",\"turn_id\":2");
        std::fs::write(&path, bytes).unwrap();
        let (_, rows) = mgr.read_display("s1").unwrap().unwrap();
        assert_eq!(rows.len(), 1);
    }

    #[tokio::test]
    async fn display_hook_reanchors_on_the_prompt_after_prefix_compaction() {
        let dir = tempfile::tempdir().unwrap();
        let mgr = std::sync::Arc::new(SessionManager::with_root(dir.path()));
        let hook = DisplayHook::new(mgr.clone(), "s1", dir.path());
        let mut convo = Conversation::new();
        convo.push(Message::system("system prompt"));
        convo.push(Message::user_with_images(
            "Q1",
            vec![jeikcode_kernel::message::ImageContent {
                media_type: "image/png".into(),
                data: "AAAA".into(),
            }],
        ));
        hook.turn_start(&mut convo).await;

        // Mid-turn compaction drains the prefix; the recorded start index is now
        // stale. The hook must re-anchor on Q1 by identity, not on the old index.
        convo.messages.remove(0);
        convo.push(Message::assistant("A1", Vec::new()));
        let ctx = TurnCtx {
            turn_id: 1,
            ..Default::default()
        };
        hook.turn_complete(&convo, &StopReason::Stopped, &ctx).await;

        let (meta, rows) = mgr.read_display("s1").unwrap().unwrap();
        assert!(meta.complete);
        assert_eq!(rows.len(), 2);
        assert_eq!(rows[0].content, "Q1");
        assert_eq!(rows[0].images[0].data, "AAAA");
        assert_eq!(rows[1].content, "A1");
    }

    #[test]
    fn incompatible_display_schema_falls_back_for_backfill() {
        let dir = tempfile::tempdir().unwrap();
        let mgr = SessionManager::with_root(dir.path());
        mgr.write_display_meta(
            "s1",
            &DisplayMeta {
                v: DISPLAY_VERSION + 1,
                complete: true,
                ..DisplayMeta::default()
            },
        )
        .unwrap();
        assert!(mgr.read_display("s1").unwrap().is_none());
        // A terminal must not append into an incompatible log either.
        mgr.append_display_turn("s1", 1, &[record(1, 0, "Q1")])
            .unwrap();
        assert!(mgr.read_display("s1").unwrap().is_none());
    }

    #[test]
    fn invalidate_display_forces_the_fallback_path() {
        let dir = tempfile::tempdir().unwrap();
        let mgr = SessionManager::with_root(dir.path());
        mgr.append_display_turn("s1", 1, &[record(1, 0, "Q1")])
            .unwrap();
        assert!(mgr.read_display("s1").unwrap().is_some());
        mgr.invalidate_display("s1").unwrap();
        assert!(mgr.read_display("s1").unwrap().is_none());
    }
}
