//! `TodoHook` — manages the live todo list state for the session (TUI / WebUI sync)
//! and provides a quiet safety-net via `offer_continuation` when actionable work was
//! performed but open items remain uncompleted.
//!
//! Note: Per architecture alignment with OpenCode / Grok Build conventions, dynamic
//! turn-start task list re-announcements have been retired in favor of the permanent,
//! static System 3 (`<todo_rules>`) guidelines.

use async_trait::async_trait;
use jeikcode_capabilities::tools::todo::{
    derive_current_todos, todo_glyph, TodoItem, TodoLive, TodoStatus,
};
use jeikcode_kernel::hook::{LifecycleHooks, TurnCtx};
use jeikcode_kernel::message::{Conversation, Message, Role};

/// Injected when the model tries to STOP while the task list still has open items — the
/// residual weak-model gap after incremental `todo` updates land: it does the last item's work
/// (e.g. the closing summary) then ends WITHOUT marking it completed. Nudges at most ONCE
/// per real-user turn (and the kernel `max_continuations` fuse bounds it), so it can never spin.
const TODO_COMPLETION_NUDGE_PREFIX: &str = "Before you finish: the task list still has open items.";

fn format_completion_nudge(todos: &[TodoItem]) -> String {
    let open_items = todos
        .iter()
        .enumerate()
        .filter(|(_, t)| t.status != TodoStatus::Completed)
        .map(|(i, t)| format!("{} {}. {}", todo_glyph(t.status, false), i + 1, t.content))
        .collect::<Vec<_>>()
        .join("\n");

    format!(
        "{TODO_COMPLETION_NUDGE_PREFIX}\n\
The following items are NOT completed yet:\n\
{open_items}\n\n\
If you have actually completed them, mark each one done now with `todo_write` \
(`{{\"actions\":[{{\"id\":<id>,\"status\":\"completed\"}}]}}`). If some are NOT done, keep working \
through them. Only stop with open items if you genuinely need approval/input, are stuck, or the \
request is ambiguous — in that case say so briefly."
    )
}

pub struct TodoHook {
    live: Option<TodoLive>,
}

impl Drop for TodoHook {
    fn drop(&mut self) {
        if let Some(live) = &self.live {
            jeikcode_capabilities::tools::unbind_todo_session(live);
        }
    }
}

impl Default for TodoHook {
    fn default() -> Self {
        Self::new()
    }
}

impl TodoHook {
    pub fn new() -> Self {
        Self { live: None }
    }

    pub fn with_live(live: TodoLive) -> Self {
        Self { live: Some(live) }
    }

    fn sync_live(&self, todos: &[TodoItem]) {
        if let Some(live) = &self.live {
            *live.lock().unwrap_or_else(|e| e.into_inner()) = todos.to_vec();
        }
    }

    /// 结束拦截只看会话上的那一份清单。没有绑会话时才退回转录，供旧单测使用。
    fn stop_check_items(&self, convo: &Conversation) -> Vec<TodoItem> {
        let Some(live) = &self.live else {
            return derive_current_todos(&convo.messages);
        };
        if let Some(session_id) = jeikcode_capabilities::tools::todo::todo_session_of(live) {
            return jeikcode_capabilities::tools::read_todo_board(&session_id)
                .map(|board| board.items)
                .unwrap_or_default();
        }
        live.lock().unwrap_or_else(|err| err.into_inner()).clone()
    }
}

/// Index of the current real-user turn's start (last non-synthetic user message).
fn current_real_user_start(convo: &Conversation) -> usize {
    convo
        .messages
        .iter()
        .rposition(|m| m.role == Role::User && !m.synthetic)
        .unwrap_or(0)
}

/// True iff the completion nudge was already injected in the CURRENT real-user turn — so we
/// nudge at most once; if the model stops again with open items, we let it end.
fn completion_nudge_already_present(convo: &Conversation) -> bool {
    let start = current_real_user_start(convo);
    convo.messages[start..].iter().any(|m| {
        m.role == Role::User
            && m.synthetic
            && m.text
                .trim_start()
                .starts_with(TODO_COMPLETION_NUDGE_PREFIX)
    })
}

fn is_actionable_tool(name: &str) -> bool {
    jeikcode_capabilities::tools::is_file_mutation_tool(name)
        || jeikcode_capabilities::tools::is_shell_tool_name(name)
        || jeikcode_capabilities::tools::is_todo_tool_name(name)
        || name.eq_ignore_ascii_case("task")
        || name.eq_ignore_ascii_case("cmd")
}

/// True iff the model performed actionable modifications this turn (e.g. edited files,
/// executed commands, updated todos). Pure informational / read-only queries (read, grep,
/// glob, code_explore) and explicit questions to the user (request_user_input) are
/// exempted so normal answering and clarifying questions are never hijacked into continuation.
fn active_work_or_managed_todos_this_turn(convo: &Conversation) -> bool {
    let start = current_real_user_start(convo);
    let turn_msgs = &convo.messages[start..];

    // If the assistant's last message explicitly asked the user for input, exempt from interception
    if let Some(last_asst) = turn_msgs.iter().rev().find(|m| m.role == Role::Assistant) {
        if last_asst
            .tool_calls
            .iter()
            .any(|c| c.name == "request_user_input")
        {
            return false;
        }
    }

    // Only intercept when actual modification or execution tools were called
    turn_msgs
        .iter()
        .any(|m| m.tool_calls.iter().any(|c| is_actionable_tool(&c.name)))
}

#[async_trait]
impl LifecycleHooks for TodoHook {
    async fn pre_request(&self, _messages: &mut Vec<Message>, ctx: &TurnCtx) {
        let Some(live) = &self.live else {
            return;
        };
        let Some(session_id) = ctx.session_id.as_deref() else {
            return;
        };
        jeikcode_capabilities::tools::bind_todo_session(live, session_id);
        let items = jeikcode_capabilities::tools::read_todo_board(session_id)
            .map(|board| board.items)
            .unwrap_or_default();
        self.sync_live(&items);
    }

    async fn turn_start(&self, _convo: &mut Conversation) {
        let Some(live) = &self.live else {
            return;
        };
        let Some(session_id) = jeikcode_capabilities::tools::todo::todo_session_of(live) else {
            return;
        };
        let items = jeikcode_capabilities::tools::read_todo_board(&session_id)
            .map(|board| board.items)
            .unwrap_or_default();
        self.sync_live(&items);
    }

    /// The model wants to stop. If the live checklist still has OPEN items
    /// (pending or in_progress), and actionable work was performed without
    /// answering or asking, inject a one-shot nudge to close them out and
    /// continue the turn. Fires at most once per real-user turn.
    async fn offer_continuation(&self, convo: &Conversation) -> Option<String> {
        let todos = self.stop_check_items(convo);
        let has_open = todos.iter().any(|t| t.status != TodoStatus::Completed);
        if !has_open
            || !active_work_or_managed_todos_this_turn(convo)
            || completion_nudge_already_present(convo)
        {
            return None;
        }
        Some(format_completion_nudge(&todos))
    }

    /// 大轮结束。只有清单已经全部完成时才清掉内存里的实时副本。
    /// 工具调用留在记录里，历史画布仍能画到那一条消息上。还有未完成项时保留，下一轮接着改。
    async fn turn_complete(
        &self,
        _convo: &Conversation,
        _reason: &jeikcode_kernel::event::StopReason,
        ctx: &TurnCtx,
    ) {
        let Some(session_id) = ctx.session_id.as_deref() else {
            return;
        };
        if jeikcode_capabilities::tools::close_todo_board_if_complete(session_id).is_some() {
            self.sync_live(&[]);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use jeikcode_kernel::hook::LifecycleHooks;
    use jeikcode_kernel::message::Message;
    use jeikcode_kernel::tool::ToolCall;

    fn todowrite_msg(args: &str) -> Message {
        Message::assistant(
            "",
            vec![ToolCall {
                id: "1".into(),
                name: jeikcode_capabilities::tools::TODO_TOOL_NAME.into(),
                arguments: args.into(),
            }],
        )
    }

    fn convo_with(msgs: Vec<Message>) -> Conversation {
        let mut c = Conversation::default();
        c.messages = msgs;
        c
    }

    #[tokio::test]
    async fn turn_start_does_not_inject_dynamic_reminder() {
        let mut convo = convo_with(vec![
            Message::user("do it"),
            todowrite_msg(r#"{"todos":[{"content":"step one","status":"in_progress"}]}"#),
            Message::user("what next?"),
        ]);
        let before_len = convo.messages.len();
        TodoHook::new().turn_start(&mut convo).await;
        assert_eq!(
            convo.messages.len(),
            before_len,
            "turn_start must not inject dynamic reminders into convo"
        );
    }

    #[tokio::test]
    async fn hook_syncs_live_so_execute_rejects_unknown_ids() {
        use jeikcode_capabilities::tools::TodoTool;
        use jeikcode_kernel::tool::{Tool, ToolContext};
        use tokio_util::sync::CancellationToken;

        let tool = TodoTool::new();
        let hook = TodoHook::with_live(tool.live());
        let msgs = vec![
            Message::user("do it"),
            todowrite_msg(r#"{"todos":[{"content":"only","status":"pending"}]}"#),
        ];
        let mut convo = convo_with(msgs);
        hook.turn_start(&mut convo).await;

        let ctx = ToolContext {
            working_dir: std::path::PathBuf::from("."),
            cancel: CancellationToken::new(),
            progress: jeikcode_kernel::tool::ProgressSink::noop(),
            requester: None,
        };
        let bad = tool
            .execute(r#"{"action":"update","id":3,"status":"completed"}"#, &ctx)
            .await;
        assert!(bad.is_error, "{}", bad.content);
        assert!(bad.content.contains("only"), "{}", bad.content);
        assert!(bad.content.contains("Current list"), "{}", bad.content);
    }

    #[tokio::test]
    async fn no_injection_when_no_list() {
        let mut convo = convo_with(vec![
            Message::user("hi"),
            Message::assistant("hello", vec![]),
        ]);
        let before = convo.messages.len();
        TodoHook::new().turn_start(&mut convo).await;
        assert_eq!(convo.messages.len(), before, "empty list → no injection");
    }

    // ---- offer_continuation: safety-net for actionable work ---------------------------------

    fn convo_of(msgs: Vec<Message>) -> Conversation {
        let mut c = Conversation::new();
        c.messages = msgs;
        c
    }

    #[tokio::test]
    async fn nudges_to_close_out_open_items_on_stop() {
        let convo = convo_of(vec![
            Message::user("do the audit"),
            todowrite_msg(
                r#"{"todos":[{"content":"a","status":"completed"},{"content":"b","status":"in_progress"}]}"#,
            ),
            Message::assistant("here is the summary…", vec![]),
        ]);
        assert!(
            TodoHook::new().offer_continuation(&convo).await.is_some(),
            "open item on stop after todowrite must nudge"
        );
    }

    #[tokio::test]
    async fn completed_board_does_not_nudge_when_the_transcript_fold_still_looks_open() {
        let session_id = format!("stop-check-{}", std::process::id());
        let tool = jeikcode_capabilities::tools::TodoTool::new();
        let live = tool.live();
        let hook = TodoHook::with_live(live.clone());
        jeikcode_capabilities::tools::bind_todo_session(&live, &session_id);
        jeikcode_capabilities::tools::commit_todo_board(
            &session_id,
            &[
                TodoItem {
                    content: "a".into(),
                    status: TodoStatus::Completed,
                },
                TodoItem {
                    content: "b".into(),
                    status: TodoStatus::Completed,
                },
            ],
        );
        let convo = convo_of(vec![
            Message::user("do the audit"),
            todowrite_msg(
                r#"{"todos":[{"content":"a","status":"pending"},{"content":"b","status":"in_progress"}]}"#,
            ),
            Message::assistant("here is the summary…", vec![]),
        ]);
        let res = hook.offer_continuation(&convo).await;
        jeikcode_capabilities::tools::unbind_todo_session(&live);
        jeikcode_capabilities::tools::clear_todo_board(&session_id);
        assert!(
            res.is_none(),
            "a finished TodoBoard must not be reopened by the transcript fold"
        );
    }

    #[tokio::test]
    async fn no_nudge_when_all_completed() {
        let convo = convo_of(vec![
            Message::user("do it"),
            todowrite_msg(
                r#"{"todos":[{"content":"a","status":"completed"},{"content":"b","status":"completed"}]}"#,
            ),
            Message::assistant("all done", vec![]),
        ]);
        assert!(
            TodoHook::new().offer_continuation(&convo).await.is_none(),
            "all completed → let it stop"
        );
    }

    #[tokio::test]
    async fn no_nudge_when_no_todos() {
        let convo = convo_of(vec![
            Message::user("hi"),
            Message::assistant("hi there", vec![]),
        ]);
        assert!(TodoHook::new().offer_continuation(&convo).await.is_none());
    }

    #[tokio::test]
    async fn no_nudge_when_list_untouched_this_turn() {
        let convo = convo_of(vec![
            Message::user("plan it"),
            todowrite_msg(r#"{"todos":[{"content":"a","status":"in_progress"}]}"#),
            Message::assistant("planned", vec![]),
            Message::user("what does foo do?"),
            Message::assistant("foo does X.", vec![]),
        ]);
        assert!(
            TodoHook::new().offer_continuation(&convo).await.is_none(),
            "a stale open list not touched this turn must not force a continuation"
        );
    }

    #[tokio::test]
    async fn no_nudge_when_only_read_tools_performed() {
        // Read-only tools should be exempted so question answering is not hijacked
        let convo = convo_of(vec![
            Message::user("plan it"),
            todowrite_msg(r#"{"todos":[{"content":"a","status":"in_progress"}]}"#),
            Message::assistant("planned", vec![]),
            Message::user("explain how auth works"),
            Message::assistant(
                "I researched this",
                vec![ToolCall {
                    id: "tool_1".into(),
                    name: "read".into(),
                    arguments: "{}".into(),
                }],
            ),
        ]);
        assert!(
            TodoHook::new().offer_continuation(&convo).await.is_none(),
            "read-only tools must be exempted from continuation nudge"
        );
    }

    #[tokio::test]
    async fn no_nudge_when_request_user_input_called() {
        // Asking the user for confirmation should be exempted from continuation nudge
        let convo = convo_of(vec![
            Message::user("plan it"),
            todowrite_msg(r#"{"todos":[{"content":"a","status":"in_progress"}]}"#),
            Message::assistant("planned", vec![]),
            Message::user("continue"),
            Message::assistant(
                "Which option do you prefer?",
                vec![ToolCall {
                    id: "tool_1".into(),
                    name: "request_user_input".into(),
                    arguments: "{}".into(),
                }],
            ),
        ]);
        assert!(
            TodoHook::new().offer_continuation(&convo).await.is_none(),
            "asking the user via request_user_input must be exempted from continuation nudge"
        );
    }

    #[tokio::test]
    async fn nudges_when_model_performed_work_tools_without_calling_todowrite() {
        // Agent did real modification work (edit/write) but neglected to update todo -> nudge
        let convo = convo_of(vec![
            Message::user("plan it"),
            todowrite_msg(r#"{"todos":[{"content":"a","status":"in_progress"}]}"#),
            Message::assistant("planned", vec![]),
            Message::user("now implement feature a"),
            Message::assistant(
                "implemented",
                vec![ToolCall {
                    id: "tool_1".into(),
                    name: "write".into(),
                    arguments: "{}".into(),
                }],
            ),
        ]);
        assert!(
            TodoHook::new().offer_continuation(&convo).await.is_some(),
            "working agent that omitted todowrite after write must be nudged before ending turn"
        );
    }

    #[tokio::test]
    async fn nudge_includes_concrete_unfinished_item_list() {
        let convo = convo_of(vec![
            Message::user("do the audit"),
            todowrite_msg(
                r#"{"todos":[{"content":"task finished","status":"completed"},{"content":"task ongoing","status":"in_progress"},{"content":"task pending","status":"pending"}]}"#,
            ),
            Message::assistant(
                "I worked on this",
                vec![ToolCall {
                    id: "tool_1".into(),
                    name: "write".into(),
                    arguments: "{}".into(),
                }],
            ),
        ]);
        let nudge = TodoHook::new().offer_continuation(&convo).await.unwrap();
        assert!(nudge.contains("[~] 2. task ongoing"));
        assert!(nudge.contains("[ ] 3. task pending"));
        assert!(
            !nudge.contains("1. task finished"),
            "completed items must not be listed in unfinished nudge"
        );
    }

    #[tokio::test]
    async fn nudges_at_most_once_per_turn() {
        let mut convo = convo_of(vec![
            Message::user("do it"),
            todowrite_msg(r#"{"todos":[{"content":"a","status":"in_progress"}]}"#),
            Message::assistant("summary", vec![]),
        ]);
        assert!(
            TodoHook::new().offer_continuation(&convo).await.is_some(),
            "first stop nudges"
        );
        // Kernel injected the nudge as a synthetic user message; model stops again without closing.
        convo
            .messages
            .push(Message::synthetic_user(TODO_COMPLETION_NUDGE_PREFIX));
        convo
            .messages
            .push(Message::assistant("still open", vec![]));
        assert!(
            TodoHook::new().offer_continuation(&convo).await.is_none(),
            "already nudged this turn → let it stop (no spin)"
        );
    }

    #[tokio::test]
    async fn nudges_for_actionable_tool_aliases_and_task_delegation() {
        for tool_name in [
            "task",
            "Task",
            "bash",
            "cmd",
            "edit_file",
            "create_file",
            "search_replace",
            "global_search_replace",
        ] {
            let convo = convo_of(vec![
                Message::user("plan it"),
                todowrite_msg(r#"{"todos":[{"content":"a","status":"in_progress"}]}"#),
                Message::assistant("planned", vec![]),
                Message::user("execute the step"),
                Message::assistant(
                    "did work",
                    vec![ToolCall {
                        id: "tool_1".into(),
                        name: tool_name.into(),
                        arguments: "{}".into(),
                    }],
                ),
            ]);
            assert!(
                TodoHook::new().offer_continuation(&convo).await.is_some(),
                "actionable tool `{tool_name}` with open todos must trigger continuation nudge"
            );
        }
    }

    #[tokio::test]
    async fn completed_checklist_cleared_on_turn_complete_is_not_resurrected_next_turn() {
        use jeikcode_capabilities::tools::TodoTool;
        use jeikcode_kernel::event::StopReason;

        let tool = TodoTool::new();
        let live = tool.live();
        let hook = TodoHook::with_live(live.clone());
        let session_id = format!("clear-board-{}", std::process::id());
        jeikcode_capabilities::tools::bind_todo_session(&live, &session_id);
        jeikcode_capabilities::tools::commit_todo_board(
            &session_id,
            &[
                TodoItem {
                    content: "step 1".into(),
                    status: TodoStatus::Completed,
                },
                TodoItem {
                    content: "step 2".into(),
                    status: TodoStatus::Completed,
                },
            ],
        );
        let ctx = TurnCtx {
            session_id: Some(session_id.clone().into()),
            ..TurnCtx::default()
        };

        let mut convo = convo_with(vec![
            Message::user("ship feature"),
            todowrite_msg(
                r#"{"todos":[{"content":"step 1","status":"pending"},{"content":"step 2","status":"in_progress"}]}"#,
            ),
            Message::assistant("all done", vec![]),
        ]);
        hook.turn_start(&mut convo).await;
        assert_eq!(live.lock().unwrap().len(), 2);

        hook.turn_complete(&convo, &StopReason::Stopped, &ctx).await;
        assert!(
            live.lock().unwrap().is_empty(),
            "turn_complete must clear live when all items are completed"
        );

        // Turn 2: user sends a new message; turn_start and pre_request must not resurrect Turn 1's completed list.
        convo.messages.push(Message::user("thanks, what is 2+2?"));
        hook.turn_start(&mut convo).await;
        assert!(
            live.lock().unwrap().is_empty(),
            "turn_start on next turn must not resurrect completed checklist from prior turn"
        );

        hook.pre_request(&mut convo.messages, &ctx).await;
        assert!(
            live.lock().unwrap().is_empty(),
            "pre_request on next turn must not resurrect completed checklist from prior turn"
        );
        jeikcode_capabilities::tools::unbind_todo_session(&live);
        jeikcode_capabilities::tools::clear_todo_board(&session_id);
    }
}
