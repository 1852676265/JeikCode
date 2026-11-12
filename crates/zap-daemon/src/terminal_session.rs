//! 交互式终端会话。
//!
//! Windows 使用 ConPTY，Linux 与 macOS 使用 POSIX pty。
//! 管道（stdin/stdout）不是终端：PowerShell/CMD 不会回显、单独的 `\r` 也不能提交命令；
//! bash/zsh/WSL/Git Bash 则没有 ONLCR，`\n` 不会回到行首，画面会逐级右移。

use std::io::{Read, Write};
use std::path::PathBuf;
use std::sync::{Arc, Mutex, OnceLock};
use std::time::Duration;

use portable_pty::{native_pty_system, Child, ChildKiller, CommandBuilder, MasterPty, PtySize};

use super::{daemon_terminals, now_unix_ms, publish_global, DaemonTerminalItem, GlobalWireEvent};

pub(crate) struct LiveTerminalProcess {
    writer: Arc<Mutex<Option<Box<dyn Write + Send>>>>,
    master: Mutex<Option<Box<dyn MasterPty + Send>>>,
    child: Mutex<Box<dyn Child + Send>>,
    killer: Mutex<Box<dyn ChildKiller + Send + Sync>>,
    pid: Option<u32>,
    buffer: Arc<Mutex<String>>,
    broadcast: tokio::sync::broadcast::Sender<String>,
}

fn live_terminals() -> &'static Mutex<std::collections::HashMap<String, Arc<LiveTerminalProcess>>> {
    static PROCESSES: OnceLock<Mutex<std::collections::HashMap<String, Arc<LiveTerminalProcess>>>> =
        OnceLock::new();
    PROCESSES.get_or_init(|| Mutex::new(std::collections::HashMap::new()))
}

fn spawn_gate() -> &'static Mutex<()> {
    static GATE: OnceLock<Mutex<()>> = OnceLock::new();
    GATE.get_or_init(|| Mutex::new(()))
}

fn lock<'a, T>(mutex: &'a Mutex<T>) -> std::sync::MutexGuard<'a, T> {
    mutex.lock().unwrap_or_else(|err| err.into_inner())
}

struct ShellLaunch {
    program: String,
    args: Vec<String>,
    env: Vec<(String, String)>,
    actual_shell: String,
}

fn shell_launch(shell_name: &str, cwd: &str) -> ShellLaunch {
    let shell = shell_name.trim().to_ascii_lowercase();
    #[cfg(windows)]
    {
        if shell == "cmd" || shell.contains("cmd") {
            return ShellLaunch {
                program: "cmd.exe".to_string(),
                args: vec!["/K".to_string()],
                env: Vec::new(),
                actual_shell: "cmd".to_string(),
            };
        }
        if shell == "wsl" || (shell.contains("wsl") && !shell.contains("git")) {
            return ShellLaunch {
                program: "wsl.exe".to_string(),
                args: vec![
                    "--cd".to_string(),
                    cwd.to_string(),
                    "--".to_string(),
                    "bash".to_string(),
                    "-i".to_string(),
                ],
                env: Vec::new(),
                actual_shell: "wsl".to_string(),
            };
        }
        if shell == "gitbash"
            || shell.contains("git")
            || (shell.contains("bash") && !shell.contains("wsl"))
        {
            return ShellLaunch {
                program: resolve_git_bash_path(),
                args: vec!["--login".to_string(), "-i".to_string()],
                env: vec![
                    ("MSYSTEM".to_string(), "MINGW64".to_string()),
                    ("CHERE_INVOKING".to_string(), "1".to_string()),
                    // MSYS 只有打开 pcon 才会把 ConPTY 当成真正的终端。
                    ("MSYS".to_string(), "enable_pcon".to_string()),
                ],
                actual_shell: "gitbash".to_string(),
            };
        }
        let program = if shell.contains("pwsh") {
            "pwsh.exe"
        } else {
            "powershell.exe"
        };
        return ShellLaunch {
            program: program.to_string(),
            args: vec!["-NoLogo".to_string(), "-NoExit".to_string()],
            env: Vec::new(),
            actual_shell: "powershell".to_string(),
        };
    }
    #[cfg(not(windows))]
    {
        if shell == "zsh" || shell.contains("zsh") {
            return ShellLaunch {
                program: "zsh".to_string(),
                args: vec!["-l".to_string(), "-i".to_string()],
                env: Vec::new(),
                actual_shell: "zsh".to_string(),
            };
        }
        // "powershell" / "pwsh" 含有 "sh"，不能因此落到 /bin/sh。
        let looks_like_sh = shell == "sh"
            || (shell.contains("sh")
                && !shell.contains("bash")
                && !shell.contains("zsh")
                && !shell.contains("power")
                && !shell.contains("pwsh"));
        if looks_like_sh {
            return ShellLaunch {
                program: "sh".to_string(),
                args: vec!["-i".to_string()],
                env: Vec::new(),
                actual_shell: "sh".to_string(),
            };
        }
        ShellLaunch {
            program: "bash".to_string(),
            args: vec!["-l".to_string(), "-i".to_string()],
            env: Vec::new(),
            actual_shell: "bash".to_string(),
        }
    }
}

#[cfg(windows)]
fn resolve_git_bash_path() -> String {
    let username = std::env::var("USERNAME").unwrap_or_default();
    let candidates = [
        r"C:\Program Files\Git\bin\bash.exe".to_string(),
        r"C:\Program Files\Git\usr\bin\bash.exe".to_string(),
        r"C:\Program Files (x86)\Git\bin\bash.exe".to_string(),
        format!(r"C:\Users\{username}\AppData\Local\Programs\Git\bin\bash.exe"),
    ];
    for path in &candidates {
        if std::path::Path::new(path).exists() {
            return path.clone();
        }
    }
    if let Ok(out) = std::process::Command::new("where").arg("bash").output() {
        if out.status.success() {
            let stdout = String::from_utf8_lossy(&out.stdout);
            for line in stdout.lines() {
                let trimmed = line.trim();
                let lower = trimmed.to_lowercase();
                if !lower.contains("system32")
                    && !lower.contains("windowsapps")
                    && std::path::Path::new(trimmed).exists()
                {
                    return trimmed.to_string();
                }
            }
        }
    }
    "bash.exe".to_string()
}

fn pty_size(cols: u16, rows: u16) -> PtySize {
    // 与前端可见网格保持同一宽高。放大字号后列数变少时，不能再夹到 20 列，
    // 否则 shell 换行和画面换行会错开。
    PtySize {
        cols: cols.clamp(2, 500),
        rows: rows.clamp(1, 200),
        pixel_width: 0,
        pixel_height: 0,
    }
}

struct SpawnedPty {
    reader: Box<dyn Read + Send>,
    writer: Box<dyn Write + Send>,
    master: Box<dyn MasterPty + Send>,
    child: Box<dyn Child + Send>,
}

fn command_from_launch(launch: &ShellLaunch, cwd: &str) -> CommandBuilder {
    let mut cmd = CommandBuilder::new(&launch.program);
    cmd.args(&launch.args);
    if !cwd.is_empty() && cwd != "." {
        cmd.cwd(cwd);
    }
    for (key, value) in &launch.env {
        cmd.env(key, value);
    }
    cmd.env("TERM", "xterm-256color");
    cmd.env("COLORTERM", "truecolor");
    cmd
}

fn spawn_pty_command(
    program: &str,
    args: &[String],
    env: &[(String, String)],
    cwd: &str,
    cols: u16,
    rows: u16,
) -> anyhow::Result<SpawnedPty> {
    let launch = ShellLaunch {
        program: program.to_string(),
        args: args.to_vec(),
        env: env.to_vec(),
        actual_shell: program.to_string(),
    };
    let cmd = command_from_launch(&launch, cwd);
    let pty_system = native_pty_system();
    let pair = pty_system
        .openpty(pty_size(cols, rows))
        .map_err(|err| anyhow::anyhow!("openpty: {err}"))?;
    let reader = pair
        .master
        .try_clone_reader()
        .map_err(|err| anyhow::anyhow!("pty reader: {err}"))?;
    let writer = pair
        .master
        .take_writer()
        .map_err(|err| anyhow::anyhow!("pty writer: {err}"))?;
    // slave 在 spawn 后丢弃：会话生命周期由 master 持有，关闭 master 时子进程会收到挂断。
    let child = pair
        .slave
        .spawn_command(cmd)
        .map_err(|err| anyhow::anyhow!("spawn {}: {err}", launch.program))?;
    Ok(SpawnedPty {
        reader,
        writer,
        master: pair.master,
        child,
    })
}

fn append_output(buffer: &Mutex<String>, text: &str) {
    let mut guard = lock(buffer);
    guard.push_str(text);
    const MAX: usize = 256 * 1024;
    const KEEP: usize = 128 * 1024;
    if guard.len() > MAX {
        let mut cut = guard.len() - KEEP;
        while cut < guard.len() && !guard.is_char_boundary(cut) {
            cut += 1;
        }
        guard.drain(..cut);
    }
}

fn utf8_prefix_len(bytes: &[u8]) -> usize {
    match std::str::from_utf8(bytes) {
        Ok(_) => bytes.len(),
        Err(err) => match err.error_len() {
            Some(len) => err.valid_up_to() + len,
            None => err.valid_up_to(),
        },
    }
}

/// 过滤 Windows ConPTY 自行发出的光标位置查询序列（ESC[6n / ESC[?6n），
/// 并由后台 PTY 读线程直接向子进程回复 CPR（\x1b[1;1R），满足 ConPTY 握手。
/// 剔除该序列后，绝不将其广播给前端 xterm.js 或存入历史快照，彻底杜绝切会话回放导致敲入 "1R1R"。
fn process_pty_output(text: &str, writer: &Mutex<Option<Box<dyn Write + Send>>>) -> String {
    #[cfg(windows)]
    {
        if text.contains("\x1b[6n") || text.contains("\x1b[?6n") {
            let mut w = lock(writer);
            if let Some(w) = w.as_mut() {
                let _ = w.write_all(b"\x1b[1;1R");
                let _ = w.flush();
            }
            return text.replace("\x1b[6n", "").replace("\x1b[?6n", "");
        }
    }
    #[cfg(not(windows))]
    let _ = writer;

    text.to_string()
}

fn start_reader(
    mut reader: Box<dyn Read + Send>,
    writer: Arc<Mutex<Option<Box<dyn Write + Send>>>>,
    buffer: Arc<Mutex<String>>,
    broadcast: tokio::sync::broadcast::Sender<String>,
) {
    let _ = std::thread::Builder::new()
        .name("jeik-pty".to_string())
        .spawn(move || {
            let mut chunk = [0u8; 8192];
            let mut pending = Vec::new();
            loop {
                match reader.read(&mut chunk) {
                    Ok(0) | Err(_) => {
                        if !pending.is_empty() {
                            let text = String::from_utf8_lossy(&pending).into_owned();
                            let clean = process_pty_output(&text, &writer);
                            if !clean.is_empty() {
                                append_output(&buffer, &clean);
                                let _ = broadcast.send(clean);
                            }
                        }
                        break;
                    }
                    Ok(n) => {
                        pending.extend_from_slice(&chunk[..n]);
                        if pending.len() > 8 && utf8_prefix_len(&pending) == 0 {
                            let text = String::from_utf8_lossy(&pending).into_owned();
                            pending.clear();
                            let clean = process_pty_output(&text, &writer);
                            if !clean.is_empty() {
                                append_output(&buffer, &clean);
                                let _ = broadcast.send(clean);
                            }
                            continue;
                        }
                        let mut split = utf8_prefix_len(&pending);
                        if split == 0 {
                            continue;
                        }
                        // 边界处理：防止 \x1b[6n 或 \x1b[?6n 跨 chunk 读取时被截断
                        let prefix_slice = &pending[..split];
                        let partial_len = if prefix_slice.ends_with(b"\x1b[?6")
                            || prefix_slice.ends_with(b"\x1b[6")
                        {
                            if prefix_slice.ends_with(b"\x1b[?6") {
                                4
                            } else {
                                3
                            }
                        } else if prefix_slice.ends_with(b"\x1b[?")
                            || prefix_slice.ends_with(b"\x1b[")
                        {
                            if prefix_slice.ends_with(b"\x1b[?") {
                                3
                            } else {
                                2
                            }
                        } else if prefix_slice.ends_with(b"\x1b") {
                            1
                        } else {
                            0
                        };
                        if partial_len > 0 && split > partial_len {
                            split -= partial_len;
                        } else if partial_len > 0 && split == partial_len {
                            continue;
                        }

                        let text = String::from_utf8_lossy(&pending[..split]).into_owned();
                        pending.drain(..split);
                        let clean = process_pty_output(&text, &writer);
                        if !clean.is_empty() {
                            append_output(&buffer, &clean);
                            let _ = broadcast.send(clean);
                        }
                    }
                }
            }
        });
}

fn child_still_running(proc: &LiveTerminalProcess) -> bool {
    let mut child = lock(&proc.child);
    matches!(child.try_wait(), Ok(None))
}

pub(crate) fn shutdown_pty(proc: &LiveTerminalProcess) {
    lock(&proc.writer).take();
    lock(&proc.master).take();
}

pub(crate) fn kill_terminal_process(proc: &LiveTerminalProcess) {
    if let Some(pid) = proc.pid {
        kill_process_tree(pid);
    }
    let _ = lock(&proc.killer).kill();
    shutdown_pty(proc);
}

fn kill_process_tree(pid: u32) {
    #[cfg(windows)]
    {
        let _ = std::process::Command::new("taskkill")
            .args(["/F", "/T", "/PID", &pid.to_string()])
            .stdin(std::process::Stdio::null())
            .stdout(std::process::Stdio::null())
            .stderr(std::process::Stdio::null())
            .status();
    }
    #[cfg(unix)]
    {
        let group = format!("-{pid}");
        let attempts = [
            vec![
                "-s".to_string(),
                "KILL".to_string(),
                "--".to_string(),
                group.clone(),
            ],
            vec!["-s".to_string(), "KILL".to_string(), group],
        ];
        for args in attempts {
            let ok = std::process::Command::new("kill")
                .args(&args)
                .stdin(std::process::Stdio::null())
                .stdout(std::process::Stdio::null())
                .stderr(std::process::Stdio::null())
                .status()
                .map(|status| status.success())
                .unwrap_or(false);
            if ok {
                break;
            }
        }
    }
}

pub(crate) fn output_snapshot(proc: &LiveTerminalProcess) -> String {
    lock(&proc.buffer).clone()
}

pub(crate) fn subscribe(proc: &LiveTerminalProcess) -> tokio::sync::broadcast::Receiver<String> {
    proc.broadcast.subscribe()
}

pub(crate) fn write_terminal_bytes(proc: &LiveTerminalProcess, data: &[u8]) {
    if data.is_empty() {
        return;
    }
    let mut writer = lock(&proc.writer);
    if let Some(writer) = writer.as_mut() {
        let _ = writer.write_all(data);
        let _ = writer.flush();
    }
}

/// 把一次性命令整理成 PTY 需要的回车（`\r`），不要再追加 `\n`。
pub(crate) fn format_pty_input(input: &str) -> String {
    let mut formatted = input.replace("\r\n", "\r").replace('\n', "\r");
    if !formatted.ends_with('\r') {
        formatted.push('\r');
    }
    formatted
}

pub(crate) fn write_terminal_command(proc: &LiveTerminalProcess, input: &str) {
    let formatted = format_pty_input(input);
    write_terminal_bytes(proc, formatted.as_bytes());
}

pub(crate) fn parse_resize_message(text: &str) -> Option<(u16, u16)> {
    let trimmed = text.trim();
    if !trimmed.starts_with("{\"resize\":") && !trimmed.starts_with("{ \"resize\":") {
        return None;
    }
    let value: serde_json::Value = serde_json::from_str(trimmed).ok()?;
    let resize = value.get("resize")?;
    let cols = resize.get("cols")?.as_u64()?;
    let rows = resize.get("rows")?.as_u64()?;
    if cols == 0 || rows == 0 || cols > 1000 || rows > 500 {
        return None;
    }
    Some((cols as u16, rows as u16))
}

pub(crate) fn resize_terminal(proc: &LiveTerminalProcess, cols: u16, rows: u16) {
    let size = pty_size(cols, rows);
    let master = lock(&proc.master);
    let Some(master) = master.as_ref() else {
        return;
    };
    if let Ok(current) = master.get_size() {
        if current.cols == size.cols && current.rows == size.rows {
            return;
        }
    }
    let _ = master.resize(size);
}

fn normalize_cwd(cwd: &str) -> String {
    if cwd.is_empty() || cwd == "." {
        std::env::current_dir()
            .unwrap_or_else(|_| PathBuf::from("."))
            .to_string_lossy()
            .to_string()
    } else {
        cwd.to_string()
    }
}

fn register_daemon_terminal(term_id: &str, shell_name: &str, cwd: &str) {
    let mut guard = daemon_terminals()
        .lock()
        .unwrap_or_else(|err| err.into_inner());
    let count = guard.len();
    if let Some(existing) = guard.get_mut(term_id) {
        existing.cwd = cwd.to_string();
        existing.shell = shell_name.to_string();
        // 自动纠正历史上或前端并发误传的异构平台终端名称
        if (cfg!(not(windows)) && existing.name.starts_with("powershell"))
            || (cfg!(windows)
                && existing.name.starts_with("bash")
                && !existing.name.contains("git"))
        {
            existing.name = format!("{shell_name} {count}");
        }
        return;
    }
    let name = format!("{shell_name} {}", count + 1);
    guard.insert(
        term_id.to_string(),
        DaemonTerminalItem {
            id: term_id.to_string(),
            name,
            cwd: cwd.to_string(),
            shell: shell_name.to_string(),
            history: Vec::new(),
            timestamp: now_unix_ms(),
        },
    );
}

fn reap_when_exited(proc: Arc<LiveTerminalProcess>, term_id: String, cwd: String) {
    tokio::spawn(async move {
        let waited = proc.clone();
        let _ = tokio::task::spawn_blocking(move || loop {
            let status = {
                let mut child = lock(&waited.child);
                child.try_wait()
            };
            match status {
                Ok(Some(_)) | Err(_) => break,
                Ok(None) => std::thread::sleep(Duration::from_millis(200)),
            }
        })
        .await;
        shutdown_pty(&proc);
        {
            let mut guard = lock(live_terminals());
            if let Some(current) = guard.get(&term_id) {
                if Arc::ptr_eq(current, &proc) {
                    guard.remove(&term_id);
                }
            }
        }
        {
            let mut guard = daemon_terminals()
                .lock()
                .unwrap_or_else(|err| err.into_inner());
            guard.remove(&term_id);
        }
        publish_global(GlobalWireEvent::TerminalUpdated { cwd });
    });
}

pub(crate) async fn get_or_spawn_terminal_process(
    term_id: &str,
    cwd: &str,
    shell_name: &str,
    cols: u16,
    rows: u16,
) -> anyhow::Result<Arc<LiveTerminalProcess>> {
    let _gate = lock(spawn_gate());
    if let Some(existing) = lock(live_terminals()).get(term_id).cloned() {
        if child_still_running(&existing) {
            resize_terminal(&existing, cols, rows);
            return Ok(existing);
        }
        shutdown_pty(&existing);
        lock(live_terminals()).remove(term_id);
    }

    let target_cwd = normalize_cwd(cwd);
    let launch = shell_launch(shell_name, &target_cwd);
    let spawned = spawn_pty_command(
        &launch.program,
        &launch.args,
        &launch.env,
        &target_cwd,
        cols,
        rows,
    )?;
    let actual_shell = launch.actual_shell.clone();
    let pid = spawned.child.process_id();
    let killer = spawned.child.clone_killer();
    let (broadcast, _) = tokio::sync::broadcast::channel::<String>(512);
    let greeting = format!(
        "\x1b[32m[JeikCode Terminal: {term_id} ({actual_shell})]\x1b[0m\r\nActive workspace: {target_cwd}\r\nReady.\r\n\r\n"
    );
    let buffer = Arc::new(Mutex::new(greeting));
    let writer = Arc::new(Mutex::new(Some(spawned.writer)));
    start_reader(
        spawned.reader,
        writer.clone(),
        buffer.clone(),
        broadcast.clone(),
    );
    let proc = Arc::new(LiveTerminalProcess {
        writer,
        master: Mutex::new(Some(spawned.master)),
        child: Mutex::new(spawned.child),
        killer: Mutex::new(killer),
        pid,
        buffer,
        broadcast,
    });
    lock(live_terminals()).insert(term_id.to_string(), proc.clone());
    register_daemon_terminal(term_id, &actual_shell, &target_cwd);
    reap_when_exited(proc.clone(), term_id.to_string(), target_cwd);
    Ok(proc)
}

pub(crate) fn take_live_terminal(term_id: &str) -> Option<Arc<LiveTerminalProcess>> {
    lock(live_terminals()).remove(term_id)
}

pub(crate) fn lookup_live_terminal(term_id: &str) -> Option<Arc<LiveTerminalProcess>> {
    lock(live_terminals()).get(term_id).cloned()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn process_pty_output_strips_conpty_dsr_and_answers_cpr() {
        let cursor = std::io::Cursor::new(Vec::<u8>::new());
        let writer: Mutex<Option<Box<dyn Write + Send>>> = Mutex::new(Some(Box::new(cursor)));

        let input = "hello\x1b[6nworld\x1b[?6n!";
        let clean = process_pty_output(input, &writer);

        #[cfg(windows)]
        {
            assert_eq!(clean, "helloworld!");
            assert!(!clean.contains("\x1b[6n"));
            assert!(!clean.contains("\x1b[?6n"));
        }
        #[cfg(not(windows))]
        {
            assert_eq!(clean, input);
        }
    }

    #[test]
    fn pty_input_uses_single_carriage_return() {
        assert_eq!(format_pty_input("ls"), "ls\r");
        assert_eq!(format_pty_input("ls\r\n"), "ls\r");
        assert_eq!(format_pty_input("echo a\necho b"), "echo a\recho b\r");
        assert_eq!(format_pty_input("echo a\r\necho b\r\n"), "echo a\recho b\r");
    }

    #[test]
    fn resize_payload_is_not_shell_input() {
        assert_eq!(
            parse_resize_message(r#"{"resize":{"cols":80,"rows":24}}"#),
            Some((80, 24))
        );
        assert_eq!(parse_resize_message("ls\r"), None);
        assert_eq!(
            parse_resize_message(r#"{"resize":{"cols":0,"rows":24}}"#),
            None
        );
    }

    #[cfg(windows)]
    #[test]
    fn windows_shells_are_interactive_and_do_not_inject_enter() {
        let cmd = shell_launch("cmd", r"E:\code");
        assert_eq!(cmd.program, "cmd.exe");
        assert_eq!(cmd.args, vec!["/K".to_string()]);

        let powershell = shell_launch("powershell", r"E:\code");
        assert_eq!(powershell.program, "powershell.exe");
        assert_eq!(
            powershell.args,
            vec!["-NoLogo".to_string(), "-NoExit".to_string()]
        );

        let gitbash = shell_launch("gitbash", r"E:\code");
        assert_eq!(gitbash.args, vec!["--login".to_string(), "-i".to_string()]);
        assert!(gitbash
            .env
            .iter()
            .any(|(key, value)| key == "MSYS" && value == "enable_pcon"));

        let wsl = shell_launch("wsl", r"E:\code\jeikcode");
        assert_eq!(wsl.program, "wsl.exe");
        assert!(wsl.args.windows(2).any(|pair| pair == ["bash", "-i"]));
        assert!(wsl.args.iter().any(|arg| arg == r"E:\code\jeikcode"));
    }

    #[cfg(not(windows))]
    #[test]
    fn unix_shells_are_interactive_on_linux_and_macos() {
        let bash = shell_launch("bash", "/tmp");
        assert_eq!(bash.program, "bash");
        assert_eq!(bash.args, vec!["-l".to_string(), "-i".to_string()]);

        let zsh = shell_launch("zsh", "/tmp");
        assert_eq!(zsh.program, "zsh");
        assert_eq!(zsh.args, vec!["-l".to_string(), "-i".to_string()]);

        let sh = shell_launch("sh", "/tmp");
        assert_eq!(sh.program, "sh");
        assert_eq!(sh.args, vec!["-i".to_string()]);

        let powershell = shell_launch("powershell", "/tmp");
        assert_ne!(powershell.program, "sh");
        assert_eq!(powershell.program, "bash");
    }

    fn read_until(
        mut reader: Box<dyn Read + Send>,
        mut reply: Option<Box<dyn Write + Send>>,
        needle: &str,
        timeout: Duration,
    ) -> Vec<u8> {
        let needle_owned = needle.to_string();
        let (tx, rx) = std::sync::mpsc::channel::<Vec<u8>>();
        std::thread::spawn(move || {
            let mut chunk = [0u8; 4096];
            let mut all = Vec::new();
            loop {
                match reader.read(&mut chunk) {
                    Ok(0) | Err(_) => {
                        let _ = tx.send(all);
                        break;
                    }
                    Ok(n) => {
                        all.extend_from_slice(&chunk[..n]);
                        let _ = tx.send(all.clone());
                    }
                }
            }
        });
        let deadline = std::time::Instant::now() + timeout;
        let mut latest = Vec::new();
        let mut replied = false;
        while std::time::Instant::now() < deadline {
            match rx.recv_timeout(Duration::from_millis(200)) {
                Ok(data) => {
                    latest = data;
                    if let Some(writer) = reply.as_mut() {
                        if !replied && latest.windows(4).any(|seq| seq == [0x1b, b'[', b'6', b'n'])
                        {
                            let _ = writer.write_all(b"\x1b[1;1R");
                            let _ = writer.flush();
                            replied = true;
                        }
                    }
                    if String::from_utf8_lossy(&latest).contains(needle_owned.as_str()) {
                        let extra = std::time::Instant::now() + Duration::from_millis(400);
                        while std::time::Instant::now() < extra {
                            match rx.recv_timeout(Duration::from_millis(100)) {
                                Ok(data) => latest = data,
                                Err(_) => break,
                            }
                        }
                        break;
                    }
                }
                Err(std::sync::mpsc::RecvTimeoutError::Timeout) => continue,
                Err(std::sync::mpsc::RecvTimeoutError::Disconnected) => break,
            }
        }
        latest
    }

    #[test]
    fn pty_is_a_real_terminal_on_this_platform() {
        let (program, args): (&str, Vec<String>) = if cfg!(windows) {
            (
                "powershell.exe",
                vec![
                    "-NoLogo".to_string(),
                    "-NoProfile".to_string(),
                    "-NonInteractive".to_string(),
                    "-Command".to_string(),
                    "Write-Output ([Console]::IsOutputRedirected)".to_string(),
                ],
            )
        } else {
            (
                "sh",
                vec![
                    "-c".to_string(),
                    "if [ -t 1 ]; then printf 'TTY\\n'; else printf 'PIPE\\n'; fi".to_string(),
                ],
            )
        };
        let cwd = std::env::current_dir().unwrap_or_else(|_| PathBuf::from("."));
        let spawned = spawn_pty_command(program, &args, &[], cwd.to_str().unwrap_or("."), 80, 24)
            .unwrap_or_else(|err| panic!("spawn pty: {err}"));
        let pid = spawned.child.process_id();
        let mut killer = spawned.child.clone_killer();
        let output = read_until(
            spawned.reader,
            Some(spawned.writer),
            if cfg!(windows) { "False" } else { "TTY" },
            Duration::from_secs(20),
        );
        if let Some(pid) = pid {
            kill_process_tree(pid);
        }
        let _ = killer.kill();
        drop(spawned.master);
        let text = String::from_utf8_lossy(&output);
        if cfg!(windows) {
            assert!(
                text.contains("False"),
                "ConPTY should not redirect console output, got {text:?}"
            );
        } else {
            assert!(
                text.contains("TTY"),
                "POSIX pty should be a tty, got {text:?}"
            );
        }
        assert!(
            output.contains(&b'\r'),
            "pty output must include CR so the next line does not staircase, got {text:?}"
        );
    }
}
