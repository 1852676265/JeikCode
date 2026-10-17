//! The `<system-reminder>` convention — the ONE place that owns it.
//!
//! Runtime context is always wrapped in `<system-reminder>…</system-reminder>`.
//! Most mode/todo notices remain synthetic `Role::User` messages immediately above
//! the real query. The per-turn calendar date from [`StatusReminderHook`] is the
//! deliberate exception: it is appended to the bottom of that real user block so it
//! cannot become an independent user-authored instruction on the wire.
//!
//! EVERY injector MUST build its reminder through [`system_reminder`] — that is the whole
//! point of centralizing the convention: the wrapper can no longer be forgotten. The bug
//! that motivated this: the date line was once emitted BARE (no wrapper), so the model read
//! it as the user's own words.
//!
//! [`StatusReminderHook`]: crate::session::StatusReminderHook

/// The reminder tag name (without angle brackets) — the single source of truth. A matcher
/// that wants to detect a reminder builds its needle from this (e.g. `format!("<{TAG}>")`).
pub const SYSTEM_REMINDER_TAG: &str = "system-reminder";

/// The strong reminder tag name (without angle brackets) for high-priority prompt tails.
pub const STRONG_REMINDER_TAG: &str = "strong-reminder";

/// Wrap `body` in a `<system-reminder>…</system-reminder>` block. THE constructor for every
/// runtime reminder injected into the conversation — call this instead of writing the tags
/// by hand so the wrapper can never be forgotten.
pub fn system_reminder(body: &str) -> String {
    format!("<{SYSTEM_REMINDER_TAG}>\n{body}\n</{SYSTEM_REMINDER_TAG}>")
}

/// Wrap `body` in a `<strong-reminder>…</strong-reminder>` block. High-priority reminder
/// that behaves as an intentional prompt tail for the model while staying stripped in UI display.
pub fn strong_reminder(body: &str) -> String {
    format!("<{STRONG_REMINDER_TAG}>\n{body}\n</{STRONG_REMINDER_TAG}>")
}

/// Whether `text` is a system-injected reminder block — i.e. begins with the
/// canonical opening tag. Reminders are pushed as ordinary `Role::User`
/// messages (see `cc_hooks.rs`, `plan_mode.rs`, …), so user-facing consumers
/// that scan for "the first user message" (session auto-naming, AI title
/// generation) must skip them or they would name the session after ambient
/// runtime context instead of the user's own words.
pub fn is_system_reminder(text: &str) -> bool {
    let opening = format!("<{SYSTEM_REMINDER_TAG}>");
    text.trim_start().starts_with(&opening)
}

/// Whether `text` is a strong reminder block.
pub fn is_strong_reminder(text: &str) -> bool {
    let opening = format!("<{STRONG_REMINDER_TAG}>");
    text.trim_start().starts_with(&opening)
}

/// Strip a specific tag block `<{tag}>...</{tag}>` entirely (tags and content).
pub fn strip_tag_blocks(text: &str, tag: &str) -> String {
    let open = format!("<{tag}>");
    let close = format!("</{tag}>");
    let mut out = String::with_capacity(text.len());
    let mut rest = text;
    while let Some(start) = rest.find(&open) {
        out.push_str(&rest[..start]);
        let after_open = start + open.len();
        match rest[after_open..].find(&close) {
            Some(rel_end) => {
                rest = &rest[after_open + rel_end + close.len()..];
            }
            None => {
                out.push_str(&rest[start..]);
                rest = "";
                break;
            }
        }
    }
    out.push_str(rest);
    out
}

/// Unwrap a specific tag wrapper `<{tag}>\n` and `\n</{tag}>`, preserving the interior text.
pub fn unwrap_tag_blocks(text: &str, tag: &str) -> String {
    let open = format!("<{tag}>");
    let close = format!("</{tag}>");
    let mut out = String::with_capacity(text.len());
    let mut rest = text;
    while let Some(start) = rest.find(&open) {
        out.push_str(&rest[..start]);
        let after_open = start + open.len();
        match rest[after_open..].find(&close) {
            Some(rel_end) => {
                let inner = &rest[after_open..after_open + rel_end];
                let inner = inner.strip_prefix('\n').unwrap_or(inner);
                let inner = inner.strip_suffix('\n').unwrap_or(inner);
                out.push_str(inner);
                rest = &rest[after_open + rel_end + close.len()..];
            }
            None => {
                out.push_str(&rest[start..]);
                rest = "";
                break;
            }
        }
    }
    out.push_str(rest);
    out
}

/// Strip assembly-layer `<system-reminder>…</system-reminder>` and `<strong-reminder>…</strong-reminder>`
/// blocks from a user message for **UI display only**.
///
/// The date / session-keyword reminder is appended to the real user block so
/// provider context stays one wire-level user turn (prefix-stable). Snapshot
/// and the three protocol adapters keep that assembled text. TUI / WebUI
/// replay must show only the user's own input.
pub fn strip_injected_reminders_for_display(text: &str) -> String {
    let without_sys = strip_tag_blocks(text, SYSTEM_REMINDER_TAG);
    let without_strong = strip_tag_blocks(&without_sys, STRONG_REMINDER_TAG);
    collapse_display_whitespace(&without_strong)
}

/// Unwraps `<strong-reminder>…</strong-reminder>` wrappers, keeping the interior text as
/// clean user prompt content for wire/model transmission.
pub fn unwrap_strong_reminders(text: &str) -> String {
    if !text.contains(&format!("<{STRONG_REMINDER_TAG}>")) {
        return text.to_string();
    }
    unwrap_tag_blocks(text, STRONG_REMINDER_TAG)
}

/// Inserts a `<strong-reminder>` block right before any existing `<system-reminder>` tails,
/// or appends to the end if no `<system-reminder>` tail exists yet.
///
/// Ensures idempotency via `needle`.
pub fn insert_strong_reminder_before_system_reminders(text: &mut String, body: &str, needle: &str) {
    if text.contains(needle) {
        return;
    }
    let block = strong_reminder(body);
    let sys_open = format!("<{SYSTEM_REMINDER_TAG}>");
    if let Some(pos) = text.find(&sys_open) {
        let prefix = text[..pos].trim_end();
        let suffix = &text[pos..];
        if prefix.is_empty() {
            *text = format!("{block}\n\n{suffix}");
        } else {
            *text = format!("{prefix}\n\n{block}\n\n{suffix}");
        }
    } else {
        if !text.is_empty() {
            text.push_str("\n\n");
        }
        text.push_str(&block);
    }
}

fn collapse_display_whitespace(text: &str) -> String {
    let trimmed = text.trim();
    let mut out = String::with_capacity(trimmed.len());
    let mut blank = false;
    for line in trimmed.lines() {
        if line.trim().is_empty() {
            if !out.is_empty() && !blank {
                out.push('\n');
                blank = true;
            }
        } else {
            if !out.is_empty() {
                out.push('\n');
            }
            out.push_str(line.trim_end());
            blank = false;
        }
    }
    out
}

/// Insert `item` immediately before the last real (non-synthetic) user message.
///
/// Grok Build sends ambient user blocks first and the `<user_query>` last. Putting
/// the reminder at the tail used to steal recency; inserting here keeps the query
/// as the last user turn. If there is no real user yet, the item is appended.
pub fn insert_before_last_real_user(
    messages: &mut Vec<jeikcode_kernel::message::Message>,
    item: jeikcode_kernel::message::Message,
) {
    use jeikcode_kernel::message::Role;
    let pos = messages
        .iter()
        .rposition(|m| m.role == Role::User && !m.synthetic)
        .unwrap_or(messages.len());
    messages.insert(pos, item);
}

/// True when the slot immediately before the last real user is already a reminder
/// matching `pred`. Lets `turn_start` injectors stay idempotent.
pub fn reminder_already_before_last_real_user(
    messages: &[jeikcode_kernel::message::Message],
    pred: impl Fn(&str) -> bool,
) -> bool {
    use jeikcode_kernel::message::Role;
    let Some(i) = messages
        .iter()
        .rposition(|m| m.role == Role::User && !m.synthetic)
    else {
        return false;
    };
    i > 0
        && messages[i - 1].synthetic
        && is_system_reminder(&messages[i - 1].text)
        && pred(&messages[i - 1].text)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn wraps_body_in_the_canonical_tag() {
        let r = system_reminder("line one\nline two");
        assert_eq!(
            r,
            "<system-reminder>\nline one\nline two\n</system-reminder>"
        );
        assert!(r.starts_with(&format!("<{SYSTEM_REMINDER_TAG}>")));
        assert!(r.ends_with(&format!("</{SYSTEM_REMINDER_TAG}>")));
    }

    #[test]
    fn detects_wrapped_reminders_but_not_plain_user_text() {
        assert!(is_system_reminder(&system_reminder("日期：2026-08-09")));
        assert!(is_system_reminder(
            "  <system-reminder>\n注意\n</system-reminder>"
        ));
        assert!(!is_system_reminder("我提到了 <system-reminder> 这个词"));
        assert!(!is_system_reminder("修复登录错误"));
        assert!(!is_system_reminder(""));
    }

    #[test]
    fn strip_injected_reminders_keeps_user_input_only() {
        let raw = format!(
            "帮我看下端口\n\n{}\n\n{}\n\n{}",
            strong_reminder("还有，请充分探索代码库。"),
            system_reminder("Current date: 2026-09-01 (Tue)"),
            system_reminder("暂存长bash列表：ninja")
        );
        assert_eq!(strip_injected_reminders_for_display(&raw), "帮我看下端口");
        assert_eq!(
            strip_injected_reminders_for_display("just the question"),
            "just the question"
        );
        assert_eq!(
            strip_injected_reminders_for_display(&system_reminder("Current date: x")),
            ""
        );
        assert_eq!(
            strip_injected_reminders_for_display(&strong_reminder("Some strong reminder")),
            ""
        );
        assert_eq!(
            strip_injected_reminders_for_display("我提到了 <system-reminder> 这个词"),
            "我提到了 <system-reminder> 这个词"
        );
    }

    #[test]
    fn unwrap_strong_reminders_removes_tags_only() {
        let raw = format!(
            "你好\n\n{}\n\n{}",
            strong_reminder("还有，请使用 code_explore。"),
            system_reminder("Current date: 2026-09-01 (Tue)")
        );
        let unwrapped = unwrap_strong_reminders(&raw);
        assert_eq!(
            unwrapped,
            "你好\n\n还有，请使用 code_explore。\n\n<system-reminder>\nCurrent date: 2026-09-01 (Tue)\n</system-reminder>"
        );
    }

    #[test]
    fn insert_strong_reminder_before_system_reminders_places_cleanly() {
        let mut text =
            "问题描述\n\n<system-reminder>\nCurrent date: today\n</system-reminder>".to_string();
        insert_strong_reminder_before_system_reminders(&mut text, "探索引导文案", "探索引导");
        assert_eq!(
            text,
            "问题描述\n\n<strong-reminder>\n探索引导文案\n</strong-reminder>\n\n<system-reminder>\nCurrent date: today\n</system-reminder>"
        );
        // Idempotency
        insert_strong_reminder_before_system_reminders(&mut text, "探索引导文案", "探索引导");
        assert_eq!(text.matches("<strong-reminder>").count(), 1);
    }

    #[test]
    fn insert_before_last_real_user_puts_reminder_above_query() {
        use jeikcode_kernel::message::Message;
        let mut msgs = vec![Message::system("sys"), Message::user("the query")];
        insert_before_last_real_user(
            &mut msgs,
            Message::synthetic_user(system_reminder("ambient")),
        );
        assert_eq!(msgs.len(), 3);
        assert!(msgs[1].synthetic && is_system_reminder(&msgs[1].text));
        assert_eq!(msgs[2].text, "the query");
        assert!(!msgs[2].synthetic);
    }

    #[test]
    fn insert_before_last_real_user_skips_earlier_real_users() {
        use jeikcode_kernel::message::Message;
        let mut msgs = vec![
            Message::user("first"),
            Message::assistant("ok", vec![]),
            Message::user("second"),
        ];
        insert_before_last_real_user(&mut msgs, Message::synthetic_user(system_reminder("r")));
        assert_eq!(msgs[0].text, "first");
        assert!(msgs[2].synthetic);
        assert_eq!(msgs[3].text, "second");
    }
}
