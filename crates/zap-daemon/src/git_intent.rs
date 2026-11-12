//! 启发式识别「会改动分支 / 引用 / 本地或远端状态」的 git 命令。
//!
//! 仅服务于 run_command / bash 的**关键节点触发**：Agent 执行完这类命令后，
//! daemon 向该项目所有会话广播一次 Git 刷新（远端类命令再由客户端补一次
//! `git fetch`）。这里刻意保持为纯函数、无副作用、不做命令执行，便于单测覆盖，
//! 也绝不引入任何轮询。
//!
//! 设计取舍：采用「在命令段里定位 `git` 可执行文件 token，再取其子命令」的宽松
//! 匹配，而非完整 shell 解析。代价是极少数把 `git xxx` 当普通参数传参的命令会
//! 误判，后果仅为一次无害的额外刷新，可接受；收益是能稳定覆盖 `sudo -u x git …`、
//! `env FOO=1 git …`、`cd dir && git …` 等真实写法。

/// 一条 shell 命令里 git 写操作的「影响面」，用于决定刷新强度。
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord)]
pub(crate) enum GitIntent {
    /// 只改工作区 / 暂存区（add、stash、restore、rm…）：本地状态刷新即可。
    WorktreeOrIndex,
    /// 改动本地引用 / 分支 / 提交历史（commit、merge、rebase、reset…）：
    /// 刷新状态与提交图，并补一次 fetch 以对齐远端跟踪引用。
    Refs,
    /// 可能改动远端（push、pull、fetch、clone…）：必须补一次 fetch。
    Remote,
}

impl GitIntent {
    /// 是否建议客户端在本地刷新之外，再执行一次 `git fetch`
    /// （只更新 remote-tracking refs，绝不动工作区，也绝不做 pull/merge）。
    pub(crate) fn needs_fetch(self) -> bool {
        matches!(self, GitIntent::Refs | GitIntent::Remote)
    }
}

/// 从一条 shell 命令中提取所有 git 写操作里**最强**的影响面。
///
/// 支持 `&&` / `||` / `;` / `|` / `&` / 换行 串联的多条子命令；返回 `None` 表示
/// 这条命令不涉及会改动状态的 git 写操作（如 `git status` / `git log` / 非 git 命令）。
pub(crate) fn classify(command: &str) -> Option<GitIntent> {
    let mut best: Option<GitIntent> = None;
    for segment in split_segments(command) {
        if let Some(intent) = classify_segment(&segment) {
            best = Some(match best {
                Some(prev) => prev.max(intent),
                None => intent,
            });
        }
    }
    best
}

/// 取 `git` 子命令对应的影响面。`None` = 非写命令（status/log/diff/--version…）。
fn classify_subcommand(sub: &str) -> Option<GitIntent> {
    // 归一到小写并剥离可能的分支/参数后缀（如 `push origin` 已由分词处理，这里只管子命令本身）。
    let sub = sub.to_ascii_lowercase();
    match sub.as_str() {
        // 会同步 remote-tracking refs，需 fetch 对齐。
        "push" | "pull" | "fetch" | "clone" | "remote" | "submodule" | "ls-remote" => {
            Some(GitIntent::Remote)
        }
        // 本地引用 / 分支 / 历史变更。
        "commit" | "merge" | "rebase" | "reset" | "cherry-pick" | "revert" | "am" | "branch"
        | "checkout" | "switch" | "tag" | "worktree" | "update-ref" | "symbolic-ref"
        | "filter-branch" | "reflog" | "notes" | "replace" | "gc" | "prune" => {
            Some(GitIntent::Refs)
        }
        // 仅工作区 / 暂存区（含用户问到的 add 与 stash：它们不动分支/远端）。
        "add" | "rm" | "mv" | "clean" | "apply" | "stash" | "restore" | "checkout-index"
        | "read-tree" | "sparse-checkout" => Some(GitIntent::WorktreeOrIndex),
        // 读命令、--version/--help 或未知 → 不触发。
        _ => None,
    }
}

/// 解析单个命令段：定位 `git` token → 跳过全局选项 → 取子命令。
fn classify_segment(segment: &str) -> Option<GitIntent> {
    let tokens = tokenize(segment);
    // 取「可执行文件名为 git」的 token；宽松搜索以兼容 sudo/env/nice/绝对路径等前缀。
    let git_pos = tokens.iter().position(|t| {
        let b = basename(t);
        b == "git" || b == "git.exe"
    })?;

    let mut j = git_pos + 1;
    while j < tokens.len() {
        let t = &tokens[j];
        if t.starts_with('-') {
            // 这些 git 全局选项带一个值，需要连同值一起跳过。
            if matches!(
                t.as_str(),
                "-C" | "-c"
                    | "--git-dir"
                    | "--work-tree"
                    | "--namespace"
                    | "--exec-path"
                    | "--config-env"
                    | "--super-prefix"
            ) {
                j += 2;
            } else {
                j += 1;
            }
            continue;
        }
        return classify_subcommand(t);
    }
    None
}

/// 按 shell 分隔符切分命令段（尊重单/双引号，避免切到引号内的字面量）。
fn split_segments(command: &str) -> Vec<String> {
    let chars: Vec<char> = command.chars().collect();
    let mut out = Vec::new();
    let mut cur = String::new();
    let mut quote: Option<char> = None;
    let mut i = 0;
    while i < chars.len() {
        let c = chars[i];
        if let Some(q) = quote {
            cur.push(c);
            if c == q {
                quote = None;
            }
            i += 1;
            continue;
        }
        match c {
            '\'' | '"' => {
                quote = Some(c);
                cur.push(c);
                i += 1;
            }
            ';' | '\n' | '&' | '|' => {
                if !cur.trim().is_empty() {
                    out.push(cur.trim().to_string());
                }
                cur.clear();
                // 吞掉 `&&` / `||` 的第二个字符。
                if (c == '&' || c == '|') && i + 1 < chars.len() && chars[i + 1] == c {
                    i += 1;
                }
                i += 1;
            }
            _ => {
                cur.push(c);
                i += 1;
            }
        }
    }
    if !cur.trim().is_empty() {
        out.push(cur.trim().to_string());
    }
    out
}

/// 极简分词：按空白切分，尊重单/双引号（引号本身剥离）。
fn tokenize(segment: &str) -> Vec<String> {
    let mut tokens = Vec::new();
    let mut cur = String::new();
    let mut quote: Option<char> = None;
    for c in segment.chars() {
        match quote {
            Some(q) => {
                if c == q {
                    quote = None;
                } else {
                    cur.push(c);
                }
            }
            None => {
                if c == '\'' || c == '"' {
                    quote = Some(c);
                } else if c.is_whitespace() {
                    if !cur.is_empty() {
                        tokens.push(std::mem::take(&mut cur));
                    }
                } else {
                    cur.push(c);
                }
            }
        }
    }
    if !cur.is_empty() {
        tokens.push(cur);
    }
    tokens
}

/// 取路径 / 命令 basename，去掉首尾引号并统一小写（兼容 `git.exe` 与绝对路径）。
fn basename(token: &str) -> String {
    let trimmed = token.trim_matches(|c| c == '"' || c == '\'');
    trimmed
        .rsplit(['/', '\\'])
        .next()
        .unwrap_or(trimmed)
        .to_ascii_lowercase()
}

#[cfg(test)]
mod tests {
    use super::{classify, GitIntent};

    #[test]
    fn remote_commands_need_fetch() {
        for cmd in [
            "git push origin main",
            "git pull --rebase",
            "git fetch --all --prune",
            "git clone https://example.com/x.git",
            "git remote update",
            "sudo git fetch",
            "git -C /repo push",
        ] {
            let intent = classify(cmd).unwrap_or_else(|| panic!("{cmd}"));
            assert_eq!(intent, GitIntent::Remote, "{cmd}");
            assert!(intent.needs_fetch(), "{cmd}");
        }
    }

    #[test]
    fn ref_commands_trigger_fetch_but_not_worktree_only() {
        for cmd in [
            "git commit -m 'feat: x'",
            "git rebase origin/beta",
            "git merge --no-ff feature",
            "git reset --hard HEAD~1",
            "git cherry-pick abc123",
            "git checkout -b new-branch",
            "git switch main",
            "git tag v1.0.0",
            "cd /repo && git commit -am fix",
        ] {
            let intent = classify(cmd).unwrap_or_else(|| panic!("{cmd}"));
            assert_eq!(intent, GitIntent::Refs, "{cmd}");
            assert!(intent.needs_fetch(), "{cmd}");
        }
    }

    #[test]
    fn worktree_and_index_commands_do_not_need_fetch() {
        for cmd in [
            "git add -A",
            "git add .",
            "git stash",
            "git stash pop",
            "git rm file",
        ] {
            let intent = classify(cmd).unwrap_or_else(|| panic!("{cmd}"));
            assert_eq!(intent, GitIntent::WorktreeOrIndex, "{cmd}");
            assert!(!intent.needs_fetch(), "{cmd}");
        }
    }

    #[test]
    fn read_only_and_non_git_commands_are_ignored() {
        for cmd in [
            "git status",
            "git log --oneline",
            "git diff HEAD",
            "git rev-parse HEAD",
            "git --version",
            "ls -la",
            "cargo test --workspace",
            "echo 'git commit'",
            "echo git", // 宽松匹配的已知代价：仅多一次无害刷新，但此处无子命令 → None
            "",
        ] {
            assert_eq!(classify(cmd), None, "{cmd}");
        }
    }

    #[test]
    fn mixed_chains_take_the_strongest_intent() {
        assert_eq!(
            classify("git add -A && git commit -m x"),
            Some(GitIntent::Refs)
        );
        assert_eq!(
            classify("git commit -m x && git push"),
            Some(GitIntent::Remote)
        );
        assert_eq!(
            classify("git add . && git status"),
            Some(GitIntent::WorktreeOrIndex)
        );
    }
}
