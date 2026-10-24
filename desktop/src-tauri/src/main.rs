// Prevents additional console window on Windows in release
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

//! 薄桌面壳：拉起同一个 `jeikcode webui`，窗口只打开它。
//! 直接就地（In-Place）执行安装目录下的 `jeikcode`，单一来源运行，消除运行期文件释放与杀毒误报。

use std::io::{BufRead, BufReader, Read, Write};
use std::net::{SocketAddr, TcpStream};
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use tauri::menu::{MenuBuilder, MenuItemBuilder};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::{Listener, Manager};

static DESKTOP_SHUTTING_DOWN: AtomicBool = AtomicBool::new(false);

/// 这次桌面壳拉起的 WebUI。端口可能因占用从 13457 顺延。
#[derive(Clone, Debug, PartialEq, Eq)]
struct WebuiOrigin {
    host: String,
    port: u16,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum LinkAction {
    StayInWebview,
    OpenExternal,
}

/// Tauri 自己的页面。交给系统浏览器会去连一个不存在的 `tauri.localhost`。
fn is_shell_internal_url(url: &tauri::Url) -> bool {
    let scheme = url.scheme();
    if matches!(scheme, "tauri" | "about" | "data" | "ipc" | "asset") {
        return true;
    }
    if scheme == "http" || scheme == "https" {
        if let Some(host) = url.host_str() {
            return host.eq_ignore_ascii_case("tauri.localhost");
        }
    }
    false
}

fn is_loopback_host(host: &str) -> bool {
    let host = host.trim_matches(|c| c == '[' || c == ']');
    host.eq_ignore_ascii_case("localhost") || host == "127.0.0.1" || host == "::1"
}

fn is_launched_webui(url: &tauri::Url, origin: &WebuiOrigin) -> bool {
    if url.scheme() != "http" && url.scheme() != "https" {
        return false;
    }
    let Some(host) = url.host_str() else {
        return false;
    };
    let Some(port) = url.port() else {
        return false;
    };
    if port != origin.port {
        return false;
    }
    host.eq_ignore_ascii_case(&origin.host)
        || (is_loopback_host(host) && is_loopback_host(&origin.host))
}

/// 顶层导航：只有壳页面和这次的 WebUI 留在窗口里。
/// `http://localhost:3000` 这类本机开发服务改由系统浏览器打开，避免盖掉当前界面。
fn navigation_action(url: &tauri::Url, origin: Option<&WebuiOrigin>) -> LinkAction {
    if is_shell_internal_url(url) {
        return LinkAction::StayInWebview;
    }
    // 回环地址上的内部重载、端口变更或携带 desktop=1 标志的均保留在窗口内，绝不弹出到系统浏览器
    if let Some(host) = url.host_str() {
        if is_loopback_host(host) {
            let (_h, saved_port, _t) = saved_webui_listen();
            if url.port() == Some(saved_port) || url.query().is_some_and(|q| q.contains("desktop=")) {
                return LinkAction::StayInWebview;
            }
        }
    }
    if origin.is_some_and(|origin| is_launched_webui(url, origin)) {
        return LinkAction::StayInWebview;
    }
    LinkAction::OpenExternal
}

/// Markdown 链接带 `target="_blank"`，走新窗口而不是顶层导航。
/// 除 Tauri 虚拟地址外一律交给系统浏览器，包括本机其它端口。
fn new_window_action(url: &tauri::Url) -> LinkAction {
    if is_shell_internal_url(url) {
        LinkAction::StayInWebview
    } else {
        LinkAction::OpenExternal
    }
}

fn remember_webui_origin(slot: &Mutex<Option<WebuiOrigin>>, url: &str) {
    let Ok(parsed) = url.parse::<tauri::Url>() else {
        return;
    };
    let (Some(host), Some(port)) = (parsed.host_str(), parsed.port()) else {
        return;
    };
    *slot.lock().unwrap_or_else(|e| e.into_inner()) = Some(WebuiOrigin {
        host: host.to_string(),
        port,
    });
}

/// Quiet only while the native window is in front. Minimized stays away even
/// if the webview still reports itself focused.
fn host_window_away(minimized: bool, focused: bool) -> bool {
    minimized || !focused
}

fn read_host_away(window: &tauri::WebviewWindow) -> Option<bool> {
    let minimized = window.is_minimized().ok()?;
    let focused = window.is_focused().ok()?;
    Some(host_window_away(minimized, focused))
}

fn publish_host_away(window: &tauri::WebviewWindow, away: bool) {
    let _ = window.eval(format!("window.__jeikcodeHostAway={away};"));
}

/// The page's document.hidden / hasFocus miss a minimized WebView. Push the
/// native state so a selected session still notifies after minimize.
fn watch_host_presence(window: tauri::WebviewWindow) {
    let listener = window.clone();
    window.on_window_event(move |event| {
        if !matches!(event, tauri::WindowEvent::Focused(_)) {
            return;
        }
        if let Some(away) = read_host_away(&listener) {
            publish_host_away(&listener, away);
        }
    });

    std::thread::spawn(move || {
        let mut last = None;
        loop {
            let Some(away) = read_host_away(&window) else {
                break;
            };
            if last != Some(away) {
                publish_host_away(&window, away);
                last = Some(away);
            }
            std::thread::sleep(Duration::from_millis(400));
        }
    });
}

/// `0.0.0.0` / `::` 是监听地址，浏览器打不开。打开前改成回环。
fn external_browser_url(url: &tauri::Url) -> String {
    let bare = url
        .host_str()
        .unwrap_or("")
        .trim_matches(|c| c == '[' || c == ']');
    if bare == "0.0.0.0" || bare == "::" {
        let mut rewritten = url.clone();
        if rewritten.set_host(Some("127.0.0.1")).is_ok() {
            return rewritten.to_string();
        }
    }
    url.to_string()
}

fn open_in_external_browser(url: &str) {
    if url.contains("tauri.localhost")
        || url.starts_with("tauri://")
        || url.starts_with("about:")
        || url.starts_with("data:")
    {
        return;
    }
    #[cfg(target_os = "windows")]
    {
        use std::ffi::OsStr;
        use std::os::windows::ffi::OsStrExt;

        #[link(name = "shell32")]
        extern "system" {
            fn ShellExecuteW(
                hwnd: *mut std::ffi::c_void,
                lpOperation: *const u16,
                lpFile: *const u16,
                lpParameters: *const u16,
                lpDirectory: *const u16,
                nShowCmd: i32,
            ) -> isize;
        }

        fn wide(s: &str) -> Vec<u16> {
            OsStr::new(s)
                .encode_wide()
                .chain(std::iter::once(0))
                .collect()
        }

        let verb = wide("open");
        let file = wide(url);
        // SW_SHOWNORMAL = 1
        let rc = unsafe {
            ShellExecuteW(
                std::ptr::null_mut(),
                verb.as_ptr(),
                file.as_ptr(),
                std::ptr::null(),
                std::ptr::null(),
                1,
            )
        };
        if rc > 32 {
            return;
        }
        // Fallback
        let _ = Command::new("explorer").arg(url).spawn();
    }

    #[cfg(target_os = "macos")]
    {
        let _ = Command::new("open").arg(url).spawn();
    }

    #[cfg(target_os = "linux")]
    {
        let _ = Command::new("xdg-open").arg(url).spawn();
    }

    #[cfg(not(any(target_os = "windows", target_os = "macos", target_os = "linux")))]
    {
        let _ = url;
    }
}

#[cfg(target_os = "windows")]
fn ensure_single_instance_windows() -> bool {
    use std::os::windows::ffi::OsStrExt;

    #[link(name = "kernel32")]
    extern "system" {
        fn CreateMutexW(
            lpMutexAttributes: *mut std::ffi::c_void,
            bInitialOwner: i32,
            lpName: *const u16,
        ) -> *mut std::ffi::c_void;
        fn GetLastError() -> u32;
    }

    #[link(name = "user32")]
    extern "system" {
        fn FindWindowW(lpClassName: *const u16, lpWindowName: *const u16) -> *mut std::ffi::c_void;
        fn ShowWindow(hWnd: *mut std::ffi::c_void, nCmdShow: i32) -> i32;
        fn SetForegroundWindow(hWnd: *mut std::ffi::c_void) -> i32;
    }

    fn wide(s: &str) -> Vec<u16> {
        std::ffi::OsStr::new(s)
            .encode_wide()
            .chain(std::iter::once(0))
            .collect()
    }

    let mutex_name = wide("Local\\JeikCode_Desktop_SingleInstance_Mutex");
    const ERROR_ALREADY_EXISTS: u32 = 183;
    const SW_RESTORE: i32 = 9;
    const SW_SHOW: i32 = 5;

    let handle = unsafe { CreateMutexW(std::ptr::null_mut(), 1, mutex_name.as_ptr()) };
    if unsafe { GetLastError() } == ERROR_ALREADY_EXISTS {
        let win_title = wide("JeikCode Desktop");
        let hwnd = unsafe { FindWindowW(std::ptr::null(), win_title.as_ptr()) };
        if !hwnd.is_null() {
            unsafe {
                ShowWindow(hwnd, SW_SHOW);
                ShowWindow(hwnd, SW_RESTORE);
                SetForegroundWindow(hwnd);
            }
        }
        return true;
    }
    std::mem::forget(handle);
    false
}

fn desktop_settings_path() -> PathBuf {
    jeikcode_dir().join("desktop-settings.json")
}

fn load_close_action() -> String {
    let Ok(text) = std::fs::read_to_string(desktop_settings_path()) else {
        return "ask".to_string();
    };
    #[derive(serde::Deserialize)]
    struct Settings {
        #[serde(default)]
        close_action: Option<String>,
    }
    serde_json::from_str::<Settings>(&text)
        .ok()
        .and_then(|s| s.close_action)
        .unwrap_or_else(|| "ask".to_string())
}

fn main() {
    #[cfg(target_os = "windows")]
    if ensure_single_instance_windows() {
        return;
    }

    let child = Mutex::new(None);
    tauri::Builder::default()
        .manage(ChildSlot(child))
        .setup(|app| {
            let webui_origin = Arc::new(Mutex::new(None));
            let nav_origin = Arc::clone(&webui_origin);
            let window_builder = tauri::WebviewWindowBuilder::new(
                app,
                "main",
                tauri::WebviewUrl::App("index.html".into()),
            )
            .title("JeikCode Desktop")
            .inner_size(1280.0, 800.0)
            .resizable(true)
            .on_navigation(move |url| {
                let action = {
                    let guard = nav_origin.lock().unwrap_or_else(|e| e.into_inner());
                    navigation_action(url, guard.as_ref())
                };
                match action {
                    LinkAction::StayInWebview => true,
                    LinkAction::OpenExternal => {
                        open_in_external_browser(&external_browser_url(url));
                        false
                    }
                }
            })
            .on_new_window(|url, _features| {
                if new_window_action(&url) == LinkAction::OpenExternal {
                    open_in_external_browser(&external_browser_url(&url));
                }
                tauri::webview::NewWindowResponse::Deny
            });
            // Windows 上有两套原生放置目标，都会把「不是系统文件」的拖放写成 DROPEFFECT_NONE，
            // 光标就是禁止。disable_drag_drop_handler / tauri.conf.json 的 dragDropEnabled
            // 只卸 WebView2 那一套；窗口自己的 FileDropHandler 还在，应用内拖文件树、标签照样被禁。
            // 两套都关掉，拖放才进页面里的 HTML5。
            #[cfg(target_os = "windows")]
            let window_builder = window_builder.disable_drag_drop_handler().drag_and_drop(false);
            let window = window_builder.build()?;

            watch_host_presence(window.clone());
            let drop_window = window.clone();
            let close_window = window.clone();
            let hide_window = window.clone();
            let app_handle_for_event = app.handle().clone();

            let _ = window.listen("jeikcode:desktop:hide_to_tray", move |_| {
                let _ = hide_window.hide();
                publish_host_away(&hide_window, true);
            });

            let _ = window.listen("jeikcode:desktop:quit_app", move |_| {
                DESKTOP_SHUTTING_DOWN.store(true, Ordering::SeqCst);
                if let Some(slot) = app_handle_for_event.try_state::<ChildSlot>() {
                    if let Some(child) = slot.0.lock().unwrap_or_else(|e| e.into_inner()).as_mut() {
                        let _ = child.kill();
                    }
                }
                app_handle_for_event.exit(0);
            });

            // 窗口关闭拦截与 HTML5 拖放事件处理
            window.on_window_event(move |event| {
                if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                    let action = load_close_action();
                    match action.as_str() {
                        "tray" => {
                            api.prevent_close();
                            let _ = close_window.hide();
                            publish_host_away(&close_window, true);
                        }
                        "quit" => {
                            DESKTOP_SHUTTING_DOWN.store(true, Ordering::SeqCst);
                        }
                        _ => {
                            api.prevent_close();
                            let _ = close_window.eval(
                                "window.dispatchEvent(new CustomEvent('jeikcode:desktop:close_prompt'));",
                            );
                        }
                    }
                }
                if let tauri::WindowEvent::DragDrop(drop_event) = event {
                    if let tauri::DragDropEvent::Drop { paths, .. } = drop_event {
                        for path in paths {
                            let p_str = path.to_string_lossy().replace('\\', "/");
                            let json_path = serde_json::to_string(&p_str).unwrap_or_default();
                            let script = format!(
                                "window.dispatchEvent(new CustomEvent('jeikcode:switch_right_tab', {{ detail: 'preview' }}));\
                                 window.dispatchEvent(new CustomEvent('jeikcode:preview:open_file', {{ detail: {{ filePath: {json_path} }} }}));\
                                 window.dispatchEvent(new CustomEvent('jeikcode:open_file', {{ detail: {{ path: {json_path} }} }}));"
                            );
                            let _ = drop_window.eval(&script);
                        }
                    }
                }
            });
            setup_system_tray(app).expect("初始化系统托盘图标失败");

            let handle = app.handle().clone();
            tauri::async_runtime::spawn(async move {
                match start_webui(&handle) {
                    Ok((url, child, launch)) => {
                        if let Some(slot) = handle.try_state::<ChildSlot>() {
                            *slot.0.lock().unwrap_or_else(|e| e.into_inner()) = Some(child);
                        }
                        // 必须先记下地址再导航，否则这次 WebUI 会被当成外链弹出浏览器。
                        remember_webui_origin(&webui_origin, &url);
                        let _ = window.navigate(
                            url.parse()
                                .unwrap_or_else(|_| "about:blank".parse().expect("about:blank")),
                        );
                        supervise_webui(handle.clone(), window.clone(), webui_origin.clone(), url, launch);
                    }
                    Err(err) => {
                        let text =
                            serde_json::to_string(&err).unwrap_or_else(|_| "\"启动失败\"".into());
                        let _ = window.eval(&format!(
                            "document.getElementById('status').textContent = {text}"
                        ));
                    }
                }
            });
            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("启动 JeikCode Desktop 失败")
        .run(|app, event| {
            if let tauri::RunEvent::Exit = event {
                DESKTOP_SHUTTING_DOWN.store(true, Ordering::SeqCst);
                if let Some(slot) = app.try_state::<ChildSlot>() {
                    if let Some(child) = slot.0.lock().unwrap_or_else(|e| e.into_inner()).as_mut() {
                        let _ = child.kill();
                    }
                }
            }
        });
}

struct TrayTexts {
    tooltip: &'static str,
    show_window: &'static str,
    quit: &'static str,
}

fn resolve_tray_texts() -> TrayTexts {
    let lang = detect_user_language();
    if lang.starts_with("zh") {
        TrayTexts {
            tooltip: "JeikCode Desktop - AI 编程助手",
            show_window: "显示主界面",
            quit: "退出",
        }
    } else if lang.starts_with("vi") {
        TrayTexts {
            tooltip: "JeikCode Desktop - Trợ lý lập trình AI",
            show_window: "Hiển thị giao diện",
            quit: "Thoát",
        }
    } else {
        TrayTexts {
            tooltip: "JeikCode Desktop - AI Coding Agent",
            show_window: "Show Window",
            quit: "Quit",
        }
    }
}

fn detect_user_language() -> String {
    let config_path = jeikcode_dir().join("config.toml");
    if let Ok(content) = std::fs::read_to_string(&config_path) {
        for line in content.lines() {
            let trimmed = line.trim();
            if trimmed.starts_with('[') {
                break;
            }
            if let Some(rest) = trimmed.strip_prefix("language") {
                let rest = rest.trim_start();
                if let Some(val) = rest.strip_prefix('=') {
                    let clean = val
                        .trim()
                        .trim_matches('"')
                        .trim_matches('\'')
                        .trim()
                        .to_lowercase();
                    if !clean.is_empty() {
                        return clean;
                    }
                }
            }
        }
    }

    for var in ["JEIKCODE_LANGUAGE", "JEIKCODE_LANG", "LANG", "LC_ALL"] {
        if let Ok(val) = std::env::var(var) {
            let val = val.trim().to_lowercase();
            if !val.is_empty() {
                return val;
            }
        }
    }

    #[cfg(windows)]
    {
        if let Ok(hkcu) = winreg::RegKey::predef(winreg::enums::HKEY_CURRENT_USER)
            .open_subkey("Control Panel\\International")
        {
            if let Ok(locale_name) = hkcu.get_value::<String, _>("LocaleName") {
                return locale_name.to_lowercase();
            }
        }
    }

    "en".to_string()
}

fn setup_system_tray(app: &tauri::App) -> Result<(), Box<dyn std::error::Error>> {
    let texts = resolve_tray_texts();
    let show_item = MenuItemBuilder::with_id("show", texts.show_window).build(app)?;
    let quit_item = MenuItemBuilder::with_id("quit", texts.quit).build(app)?;
    let menu = MenuBuilder::new(app)
        .item(&show_item)
        .separator()
        .item(&quit_item)
        .build()?;

    let icon = app
        .default_window_icon()
        .cloned()
        .expect("未在 tauri.conf.json 中找到应用默认图标");

    let _tray = TrayIconBuilder::with_id("main-tray")
        .tooltip(texts.tooltip)
        .icon(icon)
        .menu(&menu)
        .show_menu_on_left_click(false)
        .on_menu_event(|app, event| match event.id.as_ref() {
            "show" => {
                if let Some(window) = app.get_webview_window("main") {
                    let _ = window.show();
                    let _ = window.unminimize();
                    let _ = window.set_focus();
                    publish_host_away(&window, false);
                }
            }
            "quit" => {
                DESKTOP_SHUTTING_DOWN.store(true, Ordering::SeqCst);
                if let Some(slot) = app.try_state::<ChildSlot>() {
                    if let Some(child) = slot.0.lock().unwrap_or_else(|e| e.into_inner()).as_mut() {
                        let _ = child.kill();
                    }
                }
                app.exit(0);
            }
            _ => {}
        })
        .on_tray_icon_event(|tray, event| {
            if let TrayIconEvent::Click {
                button: MouseButton::Left,
                button_state: MouseButtonState::Up,
                ..
            } = event
            {
                let app = tray.app_handle();
                if let Some(window) = app.get_webview_window("main") {
                    let is_visible = window.is_visible().unwrap_or(false);
                    let is_minimized = window.is_minimized().unwrap_or(false);
                    let is_focused = window.is_focused().unwrap_or(false);
                    if is_visible && !is_minimized && is_focused {
                        let _ = window.hide();
                        publish_host_away(&window, true);
                    } else {
                        let _ = window.show();
                        let _ = window.unminimize();
                        let _ = window.set_focus();
                        publish_host_away(&window, false);
                    }
                }
            }
        })
        .build(app)?;

    Ok(())
}

struct ChildSlot(Mutex<Option<std::process::Child>>);

struct WebuiLaunch {
    bin: PathBuf,
    host: String,
    port: u16,
    token: String,
    home: PathBuf,
    bundled: Option<PathBuf>,
}

fn start_webui(
    app: &tauri::AppHandle,
) -> Result<(String, std::process::Child, WebuiLaunch), String> {
    let bundled = bundled_cli(app);
    let bin = resolve_desktop_cli(bundled.as_deref());
    let home = home_dir();
    let (host, port, saved_token) = saved_webui_listen();
    let token = saved_token.unwrap_or_else(|| mint_desktop_token(&host, port));
    let mut launch = WebuiLaunch {
        bin,
        host,
        port,
        token,
        home,
        bundled,
    };
    let (url, child) = spawn_desktop_server(&launch, false, Duration::from_secs(90))?;
    let probe_port = url
        .parse::<tauri::Url>()
        .ok()
        .and_then(|parsed| parsed.port())
        .unwrap_or(launch.port);
    if probe_port != launch.port {
        launch.port = probe_port;
        let dir = jeikcode_dir();
        let _ = std::fs::create_dir_all(&dir);
        let body = format!(
            "{{\n  \"host\": \"{}\",\n  \"port\": {probe_port},\n  \"token\": \"{}\"\n}}\n",
            launch.host,
            launch.token
        );
        let _ = std::fs::write(dir.join("webui-listen.json"), body);
    }
    Ok((url, child, launch))
}

fn spawn_desktop_server(
    launch: &WebuiLaunch,
    exact_port: bool,
    url_timeout: Duration,
) -> Result<(String, std::process::Child), String> {
    let mut cmd = Command::new(&launch.bin);
    cmd.arg("webui")
        .arg("--host")
        .arg(&launch.host)
        .arg("--port")
        .arg(launch.port.to_string())
        .arg("--no-open")
        .arg("--token")
        .arg(&launch.token);
    cmd.env("JEIKCODE_DESKTOP", "1");
    if exact_port {
        // 与 jeikcode-updater 的同名变量一致：只绑定这个端口，不顺延，也不关闭别的进程。
        cmd.env("JEIKCODE_RESTART_EXACT_PORT", "1");
        cmd.env("JEIKCODE_RESTART_LISTEN_PORT", launch.port.to_string());
    }
    if let Some(ref bundled) = launch.bundled {
        cmd.env("JEIKCODE_DESKTOP_CLI_BIN", bundled);
    }
    cmd.current_dir(&launch.home)
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::piped());
    suppress_console(&mut cmd);
    let mut child = cmd
        .spawn()
        .map_err(|e| format!("无法启动 {}：{e}", launch.bin.display()))?;
    let stderr = child.stderr.take();
    let url_result = match stderr {
        Some(pipe) => read_url(pipe, url_timeout),
        None => Ok(None),
    };
    let mut url = match url_result {
        Ok(Some(url)) => url,
        Ok(None) => {
            let _ = child.kill();
            let _ = child.wait();
            return Err("jeikcode webui 没有打印出地址".to_string());
        }
        Err(err) => {
            let _ = child.kill();
            let _ = child.wait();
            return Err(err);
        }
    };
    if !url.contains("desktop=") {
        let separator = if url.contains('?') { "&" } else { "?" };
        url.push_str(&format!("{separator}desktop=1"));
    }
    // The process listens on 0.0.0.0. This window is on this computer, so it
    // opens 127.0.0.1. Other devices use the LAN addresses in the panel.
    url = window_url(&url);
    let probe_port = url
        .parse::<tauri::Url>()
        .ok()
        .and_then(|parsed| parsed.port())
        .unwrap_or(launch.port);
    let ready_deadline = Instant::now() + Duration::from_secs(20);
    while Instant::now() < ready_deadline && !health_ready(probe_port) {
        std::thread::sleep(Duration::from_millis(40));
    }
    Ok((url, child))
}

/// 只回收桌面壳自己拉起的子进程。升级后的新进程是脱离的后继，不在这个句柄里。
/// 端口恢复后在壳内打开原来的地址；不要按进程名清理，也不要打开系统浏览器。
fn supervise_webui(
    app: tauri::AppHandle,
    window: tauri::WebviewWindow,
    origin: Arc<Mutex<Option<WebuiOrigin>>>,
    mut url: String,
    mut launch: WebuiLaunch,
) {
    std::thread::spawn(move || {
        let mut relaunched = false;
        loop {
            if DESKTOP_SHUTTING_DOWN.load(Ordering::SeqCst) {
                return;
            }
            if !take_exited_child(&app) {
                std::thread::sleep(Duration::from_millis(200));
                continue;
            }
            if DESKTOP_SHUTTING_DOWN.load(Ordering::SeqCst) {
                return;
            }

            // 子进程退出后（无论是自更新还是用户在地球面板立即重启），动态重新读取配置，
            // 确保接管的是最新配置的 host、port 和 token，绝不二次拉起旧端口僵尸进程
            let (latest_host, latest_port, latest_token) = saved_webui_listen();
            let effective_port = if latest_port != 0 { latest_port } else { launch.port };
            let effective_token = latest_token.unwrap_or_else(|| launch.token.clone());
            launch.host = latest_host;
            launch.port = effective_port;
            launch.token = effective_token.clone();
            let target_url = format!("http://127.0.0.1:{effective_port}/?token={effective_token}&desktop=1");

            if wait_until_health(launch.port, Duration::from_secs(20)) {
                url = target_url;
                open_webui_in_shell(&window, &origin, &url);
                return;
            }
            if relaunched || DESKTOP_SHUTTING_DOWN.load(Ordering::SeqCst) {
                return;
            }
            relaunched = true;
            match spawn_desktop_server(&launch, true, Duration::from_secs(30)) {
                Ok((next_url, child)) => {
                    if let Some(slot) = app.try_state::<ChildSlot>() {
                        *slot.0.lock().unwrap_or_else(|e| e.into_inner()) = Some(child);
                    }
                    url = next_url;
                    open_webui_in_shell(&window, &origin, &url);
                }
                Err(err) => {
                    let text =
                        serde_json::to_string(&err).unwrap_or_else(|_| "\"重启失败\"".into());
                    let _ = window.eval(&format!(
                        "var status = document.getElementById('status'); if (status) status.textContent = {text};"
                    ));
                    return;
                }
            }
        }
    });
}

fn take_exited_child(app: &tauri::AppHandle) -> bool {
    let Some(slot) = app.try_state::<ChildSlot>() else {
        return false;
    };
    let mut guard = slot.0.lock().unwrap_or_else(|err| err.into_inner());
    let Some(child) = guard.as_mut() else {
        return false;
    };
    match child.try_wait() {
        Ok(Some(_)) => {
            guard.take();
            true
        }
        Ok(None) => false,
        Err(_) => {
            guard.take();
            true
        }
    }
}

fn wait_until_health(port: u16, budget: Duration) -> bool {
    let deadline = Instant::now() + budget;
    while Instant::now() < deadline {
        if DESKTOP_SHUTTING_DOWN.load(Ordering::SeqCst) {
            return false;
        }
        if health_ready(port) {
            return true;
        }
        std::thread::sleep(Duration::from_millis(200));
    }
    false
}

fn open_webui_in_shell(
    window: &tauri::WebviewWindow,
    origin: &Mutex<Option<WebuiOrigin>>,
    url: &str,
) {
    remember_webui_origin(origin, url);
    if let Ok(parsed) = url.parse() {
        let _ = window.navigate(parsed);
    }
}

/// Keep the printed launch address, but open this computer through loopback.
fn window_url(url: &str) -> String {
    let Ok(mut parsed) = url.parse::<tauri::Url>() else {
        return url.to_string();
    };
    let Some(host) = parsed.host_str() else {
        return url.to_string();
    };
    if is_loopback_host(host) {
        return parsed.to_string();
    }
    if parsed.set_host(Some("127.0.0.1")).is_ok() {
        parsed.to_string()
    } else {
        url.to_string()
    }
}

fn bundled_cli(app: &tauri::AppHandle) -> Option<PathBuf> {
    let exe_name = cli_file_name();
    // 1. app.path().resource_dir() 及其 resources 子目录
    if let Ok(dir) = app.path().resource_dir() {
        for candidate in [
            dir.join(exe_name),
            dir.join("resources").join(exe_name),
            dir.join("cli-bin"),
            dir.join("resources").join("cli-bin"),
        ] {
            if candidate.is_file() {
                return Some(candidate);
            }
        }
    }
    // 2. 当前运行 exe (jeikcode-desktop.exe) 自身所在目录及其 resources 子目录
    if let Ok(current) = std::env::current_exe() {
        if let Some(parent) = current.parent() {
            for candidate in [
                parent.join(exe_name),
                parent.join("resources").join(exe_name),
                parent.join("cli-bin"),
                parent.join("resources").join("cli-bin"),
            ] {
                if candidate.is_file() {
                    return Some(candidate);
                }
            }
        }
    }
    None
}

fn read_url(
    pipe: impl std::io::Read + Send + 'static,
    timeout: Duration,
) -> Result<Option<String>, String> {
    let (tx, rx) = std::sync::mpsc::channel();
    std::thread::spawn(move || {
        let mut reader = BufReader::new(pipe);
        let mut pending = String::new();
        let mut line = String::new();
        loop {
            line.clear();
            match reader.read_line(&mut line) {
                Ok(0) | Err(_) => break,
                Ok(_) => {
                    pending.push_str(&line);
                    if let Some(url) = extract_webui_url(&pending) {
                        let _ = tx.send(url);
                        // Dropping stderr here closes the pipe. A later write
                        // then panics twice and aborts the child, so the
                        // window sees connection refused. Drain until exit.
                        let mut extra = String::new();
                        loop {
                            extra.clear();
                            match reader.read_line(&mut extra) {
                                Ok(0) | Err(_) => break,
                                Ok(_) => {}
                            }
                        }
                        break;
                    }
                }
            }
        }
    });
    match rx.recv_timeout(timeout) {
        Ok(url) => Ok(Some(url)),
        Err(std::sync::mpsc::RecvTimeoutError::Timeout) => Err("等待 WebUI 启动超时".into()),
        Err(std::sync::mpsc::RecvTimeoutError::Disconnected) => Ok(None),
    }
}

pub fn extract_webui_url(text: &str) -> Option<String> {
    let start = text.find("http://").or_else(|| text.find("https://"))?;
    let rest = &text[start..];
    let end = rest.find(|c: char| c.is_whitespace()).unwrap_or(rest.len());
    let url = rest[..end].trim_end_matches(|c: char| matches!(c, ')' | '。' | '，' | '"' | '\''));
    url.contains("token=").then(|| url.to_string())
}

fn health_ready(port: u16) -> bool {
    let addr = SocketAddr::from(([127, 0, 0, 1], port));
    let Ok(mut stream) = TcpStream::connect_timeout(&addr, Duration::from_millis(200)) else {
        return false;
    };
    let _ = stream.set_read_timeout(Some(Duration::from_millis(400)));
    let _ = stream.set_write_timeout(Some(Duration::from_millis(200)));
    if stream
        .write_all(b"GET /health HTTP/1.1\r\nHost: 127.0.0.1\r\nConnection: close\r\n\r\n")
        .is_err()
    {
        return false;
    }
    let mut buf = [0u8; 80];
    let Ok(n) = stream.read(&mut buf) else {
        return false;
    };
    let head = String::from_utf8_lossy(&buf[..n]);
    head.starts_with("HTTP/1.1 200") || head.starts_with("HTTP/1.0 200")
}

fn mint_desktop_token(host: &str, port: u16) -> String {
    let nanos = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|elapsed| elapsed.as_nanos())
        .unwrap_or(0);
    let token = format!("sk-{:x}-{:x}", std::process::id(), nanos);
    let dir = jeikcode_dir();
    let _ = std::fs::create_dir_all(&dir);
    let body = format!("{{\n  \"host\": \"{host}\",\n  \"port\": {port},\n  \"token\": \"{token}\"\n}}\n");
    let _ = std::fs::write(dir.join("webui-listen.json"), body);
    token
}

fn resolve_desktop_cli(bundled: Option<&Path>) -> PathBuf {
    // 同步执行老版本残留迁移清理（立即清理 ~/.local/bin 并注册当前安装目录到 PATH）
    cleanup_legacy_dropper_install();

    if let Some(src) = bundled {
        set_executable(src);
        return src.to_path_buf();
    }

    // 开发环境或 fallback：尝试同级可执行文件、resources 子目录或 PATH
    let name = cli_file_name();
    if let Ok(exe) = std::env::current_exe() {
        if let Some(parent) = exe.parent() {
            for candidate in [
                parent.join(name),
                parent.join("resources").join(name),
                parent.join("cli-bin"),
                parent.join("resources").join("cli-bin"),
            ] {
                if candidate.is_file() {
                    set_executable(&candidate);
                    return candidate;
                }
            }
        }
    }
    PathBuf::from(name)
}

#[cfg(windows)]
fn cleanup_legacy_dropper_install() {
    let local_bin = home_dir().join(".local").join("bin");
    if let Ok(entries) = std::fs::read_dir(&local_bin) {
        for entry in entries.flatten() {
            let path = entry.path();
            if path.is_file() {
                let name = path
                    .file_name()
                    .and_then(|n| n.to_str())
                    .unwrap_or("")
                    .to_ascii_lowercase();
                if name.starts_with("jeikcode") || name.starts_with("atomcode") {
                    let _ = std::fs::remove_file(&path);
                }
            }
        }
    }
    let _ = std::fs::remove_dir(&local_bin);

    use winreg::enums::*;
    use winreg::RegKey;
    let Ok(env) = RegKey::predef(HKEY_CURRENT_USER).open_subkey_with_flags(
        "Environment",
        KEY_READ | KEY_WRITE,
    ) else {
        return;
    };
    let current: String = env.get_value("Path").unwrap_or_default();
    let install_dir = std::env::current_exe()
        .ok()
        .and_then(|p| p.parent().map(|d| d.to_path_buf()));

    let mut parts: Vec<String> = current
        .split(';')
        .filter(|p| {
            let trimmed = p.trim();
            if trimmed.is_empty() {
                return false;
            }
            let lower = trimmed.to_ascii_lowercase();
            if lower.contains(".local\\bin")
                || lower.contains(".local/bin")
                || lower.contains("atomcode")
            {
                return false;
            }
            true
        })
        .map(|s| s.to_string())
        .collect();

    if let Some(dir) = install_dir {
        let dir_str = dir.display().to_string();
        let res_dir = dir.join("resources");
        if res_dir.is_dir() {
            let res_str = res_dir.display().to_string();
            if !parts.iter().any(|p| p.trim().eq_ignore_ascii_case(&res_str)) {
                parts.insert(0, res_str);
            }
        }
        if !parts.iter().any(|p| p.trim().eq_ignore_ascii_case(&dir_str)) {
            parts.insert(0, dir_str);
        }
    }

    let new_path = parts.join(";");
    if new_path != current {
        let _ = env.set_value("Path", &new_path);
        broadcast_env_change();
    }
}

#[cfg(windows)]
fn broadcast_env_change() {
    #[link(name = "user32")]
    extern "system" {
        fn SendMessageTimeoutW(
            hwnd: *mut std::ffi::c_void,
            msg: u32,
            wparam: usize,
            lparam: *const u16,
            flags: u32,
            timeout: u32,
            result: *mut usize,
        ) -> isize;
    }
    use std::os::windows::ffi::OsStrExt;
    let env_wide: Vec<u16> = std::ffi::OsStr::new("Environment")
        .encode_wide()
        .chain(std::iter::once(0))
        .collect();
    let hwnd_broadcast = 0xffff as *mut std::ffi::c_void;
    const WM_SETTINGCHANGE: u32 = 0x001A;
    const SMTO_ABORTIFHUNG: u32 = 0x0002;
    let mut res = 0;
    unsafe {
        SendMessageTimeoutW(
            hwnd_broadcast,
            WM_SETTINGCHANGE,
            0,
            env_wide.as_ptr(),
            SMTO_ABORTIFHUNG,
            5000,
            &mut res,
        );
    }
}

#[cfg(not(windows))]
fn cleanup_legacy_dropper_install() {
    let legacy_bin = home_dir().join(".local").join("bin").join("jeikcode");
    if legacy_bin.is_file() {
        // 如果是孤儿残留且非当前运行程序，移除避免旧版本优先命中
        let _ = std::fs::remove_file(&legacy_bin);
    }
}

fn cli_file_name() -> &'static str {
    if cfg!(windows) {
        "jeikcode.exe"
    } else {
        "jeikcode"
    }
}

const DEFAULT_LISTEN_HOST: &str = "127.0.0.1";
const WEBUI_DEFAULT_PORT: u16 = 13457;

/// `~/.jeikcode/webui-listen.json` written by the remote-access panel.
/// Defaults to 127.0.0.1 and port 13457; supports user customized host (e.g. 0.0.0.0).
fn saved_webui_listen() -> (String, u16, Option<String>) {
    let path = jeikcode_dir().join("webui-listen.json");
    let Ok(text) = std::fs::read_to_string(path) else {
        return (DEFAULT_LISTEN_HOST.to_string(), WEBUI_DEFAULT_PORT, None);
    };
    parse_webui_listen(&text)
}

fn parse_webui_listen(text: &str) -> (String, u16, Option<String>) {
    let Ok(value) = serde_json::from_str::<serde_json::Value>(text) else {
        return (DEFAULT_LISTEN_HOST.to_string(), WEBUI_DEFAULT_PORT, None);
    };
    let host = value
        .get("host")
        .and_then(|item| item.as_str())
        .map(str::trim)
        .filter(|item| !item.is_empty())
        .map(str::to_string)
        .unwrap_or_else(|| DEFAULT_LISTEN_HOST.to_string());
    let port = value
        .get("port")
        .and_then(|item| item.as_u64())
        .and_then(|item| u16::try_from(item).ok())
        .filter(|item| *item != 0)
        .unwrap_or(WEBUI_DEFAULT_PORT);
    let token = value
        .get("token")
        .and_then(|item| item.as_str())
        .map(str::trim)
        .filter(|item| !item.is_empty())
        .map(str::to_string);
    (host, port, token)
}

fn jeikcode_dir() -> PathBuf {
    if let Some(home) = std::env::var_os("JEIKCODE_HOME") {
        if !home.is_empty() {
            return PathBuf::from(home);
        }
    }
    home_dir().join(".jeikcode")
}

fn home_dir() -> PathBuf {
    std::env::var_os("USERPROFILE")
        .or_else(|| std::env::var_os("HOME"))
        .map(PathBuf::from)
        .unwrap_or_else(|| PathBuf::from("."))
}

fn set_executable(path: &Path) {
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let _ = std::fs::set_permissions(path, std::fs::Permissions::from_mode(0o755));
    }
    let _ = path;
}

#[cfg(windows)]
fn suppress_console(cmd: &mut Command) {
    use std::os::windows::process::CommandExt;
    const CREATE_NO_WINDOW: u32 = 0x0800_0000;
    cmd.creation_flags(CREATE_NO_WINDOW);
}

#[cfg(not(windows))]
fn suppress_console(_cmd: &mut Command) {}

#[cfg(test)]
mod tests {
    use std::sync::Mutex;

    use super::{
        external_browser_url, extract_webui_url, host_window_away,
        navigation_action, new_window_action, parse_webui_listen, remember_webui_origin,
        resolve_desktop_cli, window_url, LinkAction, WebuiOrigin,
    };

    fn parse_url(raw: &str) -> tauri::Url {
        raw.parse().unwrap()
    }

    #[test]
    fn resolve_desktop_cli_prefers_bundled() {
        let dummy = std::path::Path::new("dummy-bundled-path");
        let resolved = resolve_desktop_cli(Some(dummy));
        assert_eq!(resolved, dummy);
    }

    fn origin(host: &str, port: u16) -> WebuiOrigin {
        WebuiOrigin {
            host: host.to_string(),
            port,
        }
    }

    #[test]
    fn minimized_window_is_away_even_if_the_page_keeps_focus() {
        assert!(!host_window_away(false, true));
        assert!(host_window_away(true, true));
        assert!(host_window_away(true, false));
        assert!(host_window_away(false, false));
    }

    #[test]
    fn window_opens_loopback_when_the_launch_url_uses_a_lan_address() {
        assert_eq!(
            window_url("http://192.168.123.20:13457/?token=abc&desktop=1"),
            "http://127.0.0.1:13457/?token=abc&desktop=1"
        );
        assert_eq!(
            window_url("http://127.0.0.1:13457/?token=abc"),
            "http://127.0.0.1:13457/?token=abc"
        );
    }

    #[test]
    fn saved_listen_uses_the_port_and_token_and_ignores_a_blank_token() {
        assert_eq!(
            parse_webui_listen(r#"{"host":"0.0.0.0","port":4096,"token":"desk-token"}"#),
            ("0.0.0.0".to_string(), 4096, Some("desk-token".to_string()))
        );
        assert_eq!(
            parse_webui_listen(r#"{"port":0,"token":"  "}"#),
            ("127.0.0.1".to_string(), 13457, None)
        );
        assert_eq!(parse_webui_listen("not json"), ("127.0.0.1".to_string(), 13457, None));
    }

    #[test]
    fn reads_token_url_from_webui_line() {
        let line = "webui 已启动：http://127.0.0.1:13457/?token=abc&sync=0\n";
        assert_eq!(
            extract_webui_url(line).as_deref(),
            Some("http://127.0.0.1:13457/?token=abc&sync=0")
        );
    }

    #[test]
    fn ignores_text_without_token() {
        assert!(extract_webui_url("listen http://127.0.0.1:13457/").is_none());
    }

    #[test]
    fn shell_pages_stay_in_the_window() {
        for raw in [
            "http://tauri.localhost/",
            "http://tauri.localhost/index.html",
            "https://tauri.localhost/index.html",
            "tauri://localhost",
            "about:blank",
        ] {
            let parsed = parse_url(raw);
            assert_eq!(
                navigation_action(&parsed, None),
                LinkAction::StayInWebview,
                "{raw}"
            );
            assert_eq!(
                new_window_action(&parsed),
                LinkAction::StayInWebview,
                "{raw}"
            );
        }
    }

    #[test]
    fn launched_webui_stays_in_the_window() {
        let launched = origin("127.0.0.1", 13457);
        assert_eq!(
            navigation_action(
                &parse_url("http://127.0.0.1:13457/?token=abc"),
                Some(&launched)
            ),
            LinkAction::StayInWebview
        );
        assert_eq!(
            navigation_action(
                &parse_url("http://localhost:13457/?token=abc&desktop=1"),
                Some(&launched)
            ),
            LinkAction::StayInWebview
        );
        let shifted = origin("127.0.0.1", 13458);
        assert_eq!(
            navigation_action(
                &parse_url("http://127.0.0.1:13458/?token=abc"),
                Some(&shifted)
            ),
            LinkAction::StayInWebview
        );
        // 地址还没记下来时不能把 WebUI 留在窗口里，调用方必须先 remember 再导航。
        assert_eq!(
            navigation_action(&parse_url("http://127.0.0.1:13457/?token=abc"), None),
            LinkAction::OpenExternal
        );
    }

    #[test]
    fn localhost_dev_servers_open_in_the_browser() {
        let launched = origin("127.0.0.1", 13457);
        for raw in [
            "http://localhost:3000/",
            "http://127.0.0.1:5173/",
            "http://[::1]:8080/",
            "http://0.0.0.0:3000/",
            "http://app.localhost:3000/",
            "https://github.com/jeikl/JeikCode",
            "https://google.com",
        ] {
            let parsed = parse_url(raw);
            assert_eq!(
                navigation_action(&parsed, Some(&launched)),
                LinkAction::OpenExternal,
                "{raw}"
            );
            assert_eq!(
                new_window_action(&parsed),
                LinkAction::OpenExternal,
                "{raw}"
            );
        }
        let webui = parse_url("http://127.0.0.1:13457/?token=abc");
        assert_eq!(new_window_action(&webui), LinkAction::OpenExternal);
    }

    #[test]
    fn wildcard_bind_urls_open_on_loopback() {
        assert_eq!(
            external_browser_url(&parse_url("http://0.0.0.0:3000/")),
            "http://127.0.0.1:3000/"
        );
        assert_eq!(
            external_browser_url(&parse_url("http://[::]:8080/docs")),
            "http://127.0.0.1:8080/docs"
        );
        assert_eq!(
            external_browser_url(&parse_url("http://localhost:5173/")),
            "http://localhost:5173/"
        );
    }

    #[test]
    fn remembers_launched_origin() {
        let slot = Mutex::new(None);
        remember_webui_origin(&slot, "http://127.0.0.1:13480/?token=abc&desktop=1");
        let stored = slot.lock().unwrap().clone().unwrap();
        assert_eq!(stored, origin("127.0.0.1", 13480));
    }
}
