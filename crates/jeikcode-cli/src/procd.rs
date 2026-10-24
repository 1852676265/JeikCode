//! OpenWrt procd service generation, environment capture, and interactive wizard.
//!
//! Provides automated creation and management of OpenWrt procd services (`/etc/init.d/jeikcode-*`)
//! for `--host` serve mode, with autostart on boot and background daemon supervision.

use anyhow::{anyhow, Context, Result};
use is_terminal::IsTerminal;
use std::io::{self, Write};
use std::path::{Path, PathBuf};
use std::process::Command;

/// Options required to render an OpenWrt procd service script.
#[derive(Debug, Clone)]
pub struct ProcdServiceOpts {
    pub service_name: String,
    pub host: String,
    pub port: u16,
    pub workdir: PathBuf,
    pub no_token: bool,
    pub fixed_token: Option<String>,
    pub yolo: bool,
    pub no_telemetry: bool,
}

/// Check whether the root path represents an OpenWrt system or one of its derivatives
/// (ImmortalWrt, iStoreOS, Kwrt, LEDE, etc.).
pub fn is_openwrt_in_root(root: &Path) -> bool {
    // 1. Hallmark release identification files
    if root.join("etc/openwrt_release").exists() || root.join("etc/openwrt_version").exists() {
        return true;
    }

    // 2. Procd init daemon (exclusively used by OpenWrt ecosystem)
    if root.join("sbin/procd").exists() {
        return true;
    }

    // 3. UCI configuration tree + uci binary
    if root.join("etc/config").is_dir()
        && (root.join("sbin/uci").exists() || root.join("usr/bin/uci").exists())
    {
        return true;
    }

    // 4. Distribution identifier matching in /etc/os-release
    let os_release = root.join("etc/os-release");
    if os_release.exists() {
        if let Ok(content) = std::fs::read_to_string(&os_release) {
            let lower = content.to_ascii_lowercase();
            if lower.contains("openwrt")
                || lower.contains("immortalwrt")
                || lower.contains("istoreos")
                || lower.contains("kwrt")
                || lower.contains("lede")
            {
                return true;
            }
        }
    }

    false
}

/// Check whether the current system is OpenWrt or one of its derivatives.
pub fn is_openwrt() -> bool {
    #[cfg(target_os = "linux")]
    {
        is_openwrt_in_root(Path::new("/"))
    }
    #[cfg(not(target_os = "linux"))]
    {
        false
    }
}

/// Resolves the absolute path to the executable to put into procd script.
pub fn resolve_service_exe() -> PathBuf {
    crate::systemd::resolve_service_exe()
}

/// Render the OpenWrt /etc/init.d/ service script content.
pub fn render_procd_script(opts: &ProcdServiceOpts, env: &crate::systemd::CapturedEnv) -> String {
    let exe = resolve_service_exe();
    let exe_str = exe.to_string_lossy();

    let mut args = vec![
        format!("--host \"{}\"", opts.host),
        format!("--port {}", opts.port),
        format!("--dir \"{}\"", opts.workdir.display()),
    ];

    if opts.no_token {
        args.push("--no-token".to_string());
    } else if let Some(ref token) = opts.fixed_token {
        args.push(format!("--token \"{}\"", token));
    }

    if opts.yolo {
        args.push("--yolo".to_string());
    }
    if opts.no_telemetry {
        args.push("--no-telemetry".to_string());
    }

    let command_args = args.join(" ");

    // procd 的 `procd_set_param env` 重复调用会生成多个 env 表，后者可能覆盖前者，
    // 因此所有环境变量合并到同一次调用里。
    let mut env_pairs = vec![
        format!("PATH=\"{}\"", env.path),
        format!("HOME=\"{}\"", env.home),
        format!("JEIKCODE_HOST_SERVICE=\"{}\"", opts.service_name),
    ];
    if let Ok(val) = std::env::var("JEIKCODE_HOME") {
        env_pairs.push(format!("JEIKCODE_HOME=\"{val}\""));
    }
    let env_line = env_pairs.join(" ");

    format!(
        r#"#!/bin/sh /etc/rc.common

USE_PROCD=1
START=99
STOP=10

PROG="{exe_str}"

start_service() {{
    procd_open_instance
    procd_set_param command "$PROG" {command_args}
    procd_set_param env {env_line}
    procd_set_param respawn 3600 5 0
    procd_set_param stdout 1
    procd_set_param stderr 1
    procd_set_param user {user}
    procd_close_instance
}}

stop_service() {{
    return 0
}}
"#,
        exe_str = exe_str,
        command_args = command_args,
        env_line = env_line,
        user = env.user,
    )
}

/// Install the service script into `/etc/init.d/{service_name}`, make it executable,
/// enable it on boot, and start it.
pub fn install_and_start_procd_service(service_name: &str, script_content: &str) -> Result<()> {
    #[cfg(target_os = "linux")]
    {
        let target_path = PathBuf::from("/etc/init.d").join(service_name);

        let write_res = std::fs::write(&target_path, script_content);
        if let Err(e) = write_res {
            let tmp_path = std::env::temp_dir().join(format!(".{}.init", service_name));
            std::fs::write(&tmp_path, script_content).with_context(|| {
                format!(
                    "failed to write temporary service file at {}",
                    tmp_path.display()
                )
            })?;

            let cp_res = Command::new("sudo")
                .args([
                    "cp",
                    tmp_path.to_str().unwrap(),
                    target_path.to_str().unwrap(),
                ])
                .output();
            let _ = std::fs::remove_file(&tmp_path);

            if cp_res.map(|o| !o.status.success()).unwrap_or(true) {
                return Err(anyhow!("failed to write {}: {}", target_path.display(), e));
            }
        }

        // chmod +x /etc/init.d/{service_name}
        let chmod_res = Command::new("chmod")
            .args(["+x", target_path.to_str().unwrap()])
            .output();
        if chmod_res.map(|o| !o.status.success()).unwrap_or(true) {
            let _ = Command::new("sudo")
                .args(["chmod", "+x", target_path.to_str().unwrap()])
                .output();
        }

        // Enable on boot: /etc/init.d/{service_name} enable
        let enable_res = Command::new(&target_path).arg("enable").output();
        if enable_res.map(|o| !o.status.success()).unwrap_or(true) {
            let _ = Command::new("sudo")
                .args([target_path.to_str().unwrap(), "enable"])
                .output();
        }

        // Start/Restart service: /etc/init.d/{service_name} restart
        let restart_res = Command::new(&target_path).arg("restart").output();
        if restart_res.map(|o| !o.status.success()).unwrap_or(true) {
            let _ = Command::new("sudo")
                .args([target_path.to_str().unwrap(), "restart"])
                .output();
        }

        Ok(())
    }

    #[cfg(not(target_os = "linux"))]
    {
        let _ = (service_name, script_content);
        Err(anyhow!(
            "procd services are only supported on Linux/OpenWrt"
        ))
    }
}

/// Check whether the OpenWrt procd service is active/running.
pub fn is_service_active(service_name: &str, port: u16) -> bool {
    #[cfg(target_os = "linux")]
    {
        let target_path = PathBuf::from("/etc/init.d").join(service_name);
        if target_path.exists() {
            // rc.common provides `running` action
            if let Ok(out) = Command::new(&target_path).arg("running").output() {
                if out.status.success() {
                    return true;
                }
            }
        }

        // Fallback: check pgrep for the specific listening port
        if port > 0 {
            let port_str = port.to_string();
            if let Ok(out) = Command::new("pgrep")
                .args(["-f", &format!("jeikcode.*--port {port_str}")])
                .output()
            {
                if out.status.success() && !out.stdout.is_empty() {
                    return true;
                }
            }
        }
        false
    }
    #[cfg(not(target_os = "linux"))]
    {
        let _ = (service_name, port);
        false
    }
}

/// Uninstall an OpenWrt procd service.
pub fn uninstall_procd(service_name: &str) -> Result<()> {
    #[cfg(target_os = "linux")]
    {
        let target_path = PathBuf::from("/etc/init.d").join(service_name);

        // 1. Stop service
        let _ = Command::new(&target_path).arg("stop").output();
        let _ = Command::new("sudo")
            .args([target_path.to_str().unwrap(), "stop"])
            .output();

        // 2. Disable on boot
        let _ = Command::new(&target_path).arg("disable").output();
        let _ = Command::new("sudo")
            .args([target_path.to_str().unwrap(), "disable"])
            .output();

        // 3. Remove script file
        if target_path.exists() {
            if let Err(e) = std::fs::remove_file(&target_path) {
                let sudo_out = Command::new("sudo")
                    .args(["rm", target_path.to_str().unwrap_or_default()])
                    .output();
                if sudo_out.map(|o| !o.status.success()).unwrap_or(true) {
                    return Err(anyhow!("failed to remove {}: {e}", target_path.display()));
                }
            }
        }
        Ok(())
    }
    #[cfg(not(target_os = "linux"))]
    {
        let _ = service_name;
        Err(anyhow!(
            "procd services are only supported on Linux/OpenWrt"
        ))
    }
}

/// Scan all installed OpenWrt procd services in `/etc/init.d/`.
pub fn scan_procd() -> Vec<crate::host_service::HostServiceEntry> {
    let mut entries = Vec::new();
    #[cfg(target_os = "linux")]
    {
        let dir = PathBuf::from("/etc/init.d");
        if let Ok(read_dir) = std::fs::read_dir(&dir) {
            for entry in read_dir.flatten() {
                let file_name = entry.file_name().to_string_lossy().to_string();
                let is_service = (file_name.starts_with("jeikcode-")
                    && !file_name.starts_with("jeikcode-schedule-"))
                    || file_name == "jeikcode";
                if is_service {
                    let port = crate::host_service::parse_port_from_name(&file_name).unwrap_or(0);
                    let active = is_service_active(&file_name, port);
                    let status = if active {
                        crate::host_service::ServiceStatus::Running
                    } else {
                        crate::host_service::ServiceStatus::Stopped
                    };
                    let path = entry.path();
                    entries.push(crate::host_service::HostServiceEntry {
                        id: 0,
                        service_name: file_name,
                        port,
                        status,
                        platform: "procd",
                        path: Some(path.display().to_string()),
                    });
                }
            }
        }
    }
    entries
}

fn read_tty_line(prompt: &str) -> Result<String> {
    eprint!("{prompt}");
    io::stderr().flush().ok();
    let mut line = String::new();
    io::stdin()
        .read_line(&mut line)
        .map_err(|e| anyhow!("read tty: {e}"))?;
    Ok(line.trim().to_string())
}

/// Interactive wizard in `--host` serve mode for OpenWrt.
pub fn prompt_procd_setup(
    host: &str,
    port: u16,
    workdir: &Path,
    no_token: bool,
    fixed_token: Option<&str>,
    display_token: Option<&str>,
    yolo: bool,
    no_telemetry: bool,
    banner: &str,
) -> Result<bool> {
    if !cfg!(target_os = "linux") || !io::stdin().is_terminal() || !is_openwrt() {
        return Ok(false);
    }

    let default_service_name = format!("jeikcode-{}", port);
    eprintln!();
    eprintln!(
        "{}",
        crate::host_service::host_msg(
            &format!("JeikCode is about to listen on {host}:{port}."),
            &format!("JeikCode 即将在 {host}:{port} 启动。"),
            &format!("JeikCode sắp lắng nghe tại {host}:{port}."),
        )
    );
    let answer = read_tty_line(&crate::host_service::host_msg(
        "Register an OpenWrt (procd) service and start it on boot? [y/N]: ",
        "是否配置为 OpenWrt 系统服务 (procd) 并开机自启？ [y/N]: ",
        "Đăng ký dịch vụ OpenWrt (procd) và tự động khởi động khi bật máy? [y/N]: ",
    ))?;
    let user_agreed = matches!(answer.to_ascii_lowercase().as_str(), "y" | "yes");
    if !user_agreed {
        eprintln!(
            "{}",
            crate::host_service::host_msg(
                "Staying in the foreground (Ctrl+C stops the server).\n",
                "✓ 保持前台运行模式 (按 Ctrl+C 可停止服务)\n",
                "Tiếp tục chạy ở chế độ tiền cảnh (Ctrl+C để dừng máy chủ).\n",
            )
        );
        return Ok(false);
    }

    let service_input = read_tty_line(&crate::host_service::host_msg(
        &format!("Service name (Enter for {default_service_name}): "),
        &format!("请输入系统服务名 (直接回车默认: {default_service_name}): "),
        &format!("Tên dịch vụ (nhấn Enter để dùng {default_service_name}): "),
    ))?;
    let service_name = if service_input.is_empty() {
        default_service_name
    } else {
        service_input
    };

    println!(
        "{}",
        crate::host_service::host_msg(
            "==> Capturing the environment and writing the procd script...",
            "==> 正在捕获当前环境并生成 OpenWrt procd 服务配置...",
            "==> Đang thu thập môi trường hiện tại và tạo tệp cấu hình procd cho OpenWrt...",
        )
    );
    let env = crate::systemd::capture_current_environment();
    let unit_token = if no_token {
        None
    } else {
        fixed_token
            .filter(|s| !s.is_empty())
            .or_else(|| display_token.filter(|s| !s.is_empty()))
            .map(str::to_string)
    };

    let opts = ProcdServiceOpts {
        service_name: service_name.clone(),
        host: host.to_string(),
        port,
        workdir: workdir.to_path_buf(),
        no_token,
        fixed_token: unit_token,
        yolo,
        no_telemetry,
    };

    let script_content = render_procd_script(&opts, &env);

    println!(
        "{}",
        crate::host_service::host_msg(
            &format!("==> Installing and starting OpenWrt service [{service_name}]..."),
            &format!("==> 正在安装并启动 OpenWrt 服务 [{service_name}]..."),
            &format!("==> Đang cài đặt và khởi động dịch vụ OpenWrt [{service_name}]..."),
        )
    );

    if let Err(e) = install_and_start_procd_service(&service_name, &script_content) {
        eprintln!(
            "\n{}",
            crate::host_service::host_msg(
                &format!("Failed to install the service: {e:#}"),
                &format!("❌ 安装 OpenWrt 服务失败: {e:#}"),
                &format!("Không thể cài đặt dịch vụ OpenWrt: {e:#}"),
            )
        );
        eprintln!(
            "{}",
            crate::host_service::host_msg(
                &format!(
                    "You can create `/etc/init.d/{service_name}` manually and run /etc/init.d/{service_name} enable && /etc/init.d/{service_name} start."
                ),
                &format!(
                    "您可以手动创建 `/etc/init.d/{service_name}` 并执行 /etc/init.d/{service_name} enable && /etc/init.d/{service_name} start。"
                ),
                &format!(
                    "Bạn có thể tạo `/etc/init.d/{service_name}` thủ công và chạy /etc/init.d/{service_name} enable && /etc/init.d/{service_name} start."
                ),
            )
        );
        return Err(e);
    }

    let active = is_service_active(&service_name, port);

    // Print final retained output summary
    println!("\n========================================================================");
    if active {
        println!(
            "{}",
            crate::host_service::host_msg(
                &format!("Service [{service_name}] is installed and will start on boot."),
                &format!("✨ OpenWrt 服务 [{service_name}] 配置成功并已在后台运行 (开机自启已就绪)！"),
                &format!(
                    "Dịch vụ OpenWrt [{service_name}] đã được cài đặt và sẽ tự động khởi động khi bật máy."
                ),
            )
        );
    } else {
        println!(
            "{}",
            crate::host_service::host_msg(
                &format!("Service [{service_name}] was created. Check its status."),
                &format!("⚠️ OpenWrt 服务 [{service_name}] 已创建并已尝试启动，请检查状态。"),
                &format!(
                    "Dịch vụ OpenWrt [{service_name}] đã được tạo. Hãy kiểm tra trạng thái của dịch vụ."
                ),
            )
        );
    }
    println!("------------------------------------------------------------------------");
    print!("{banner}");
    if !banner.ends_with('\n') {
        println!();
    }
    println!("------------------------------------------------------------------------");
    println!(
        "{}",
        crate::host_service::host_msg(
            "Service commands:",
            "📌 系统服务管理命令 (可随时在终端执行):",
            "Các lệnh quản lý dịch vụ:"
        )
    );
    println!("  /etc/init.d/{service_name} status");
    println!("  /etc/init.d/{service_name} restart");
    println!("  /etc/init.d/{service_name} stop");
    println!("  /etc/init.d/{service_name} disable");
    println!("  logread -e {service_name}");
    println!("========================================================================");
    println!(
        "{}\n",
        crate::host_service::host_msg(
            "Terminal input restored.",
            "已恢复终端输入态。",
            "Đã khôi phục khả năng nhập liệu trong terminal."
        )
    );

    Ok(true)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn render_procd_script_contains_expected_tokens() {
        let opts = ProcdServiceOpts {
            service_name: "jeikcode-13457".to_string(),
            host: "0.0.0.0".to_string(),
            port: 13457,
            workdir: PathBuf::from("/root"),
            no_token: false,
            fixed_token: Some("anhuang520".to_string()),
            yolo: false,
            no_telemetry: true,
        };
        let env = crate::systemd::CapturedEnv {
            user: "root".to_string(),
            home: "/root".to_string(),
            shell: "/bin/ash".to_string(),
            lang: "C".to_string(),
            path: "/usr/sbin:/usr/bin:/sbin:/bin".to_string(),
        };

        let script = render_procd_script(&opts, &env);
        assert!(script.contains("USE_PROCD=1"));
        assert!(script.contains("START=99"));
        assert!(script.contains("--host \"0.0.0.0\""));
        assert!(script.contains("--port 13457"));
        assert!(script.contains("--token \"anhuang520\""));
        assert!(script.contains("--no-telemetry"));
        assert!(script.contains("procd_set_param respawn"));
        assert!(script.contains("JEIKCODE_HOST_SERVICE=\"jeikcode-13457\""));
        assert_eq!(script.matches("procd_set_param env").count(), 1);
        assert!(script.contains("user root"));
    }

    #[test]
    fn detects_openwrt_derivatives_correctly() {
        let temp = tempfile::tempdir().unwrap();
        let root = temp.path();

        assert!(!is_openwrt_in_root(root));

        // Test /etc/openwrt_release (Kwrt)
        let etc = root.join("etc");
        std::fs::create_dir_all(&etc).unwrap();
        let release = etc.join("openwrt_release");
        std::fs::write(&release, "DISTRIB_ID='Kwrt'\n").unwrap();
        assert!(is_openwrt_in_root(root));
        std::fs::remove_file(&release).unwrap();

        // Test /sbin/procd
        let sbin = root.join("sbin");
        std::fs::create_dir_all(&sbin).unwrap();
        let procd = sbin.join("procd");
        std::fs::write(&procd, "").unwrap();
        assert!(is_openwrt_in_root(root));
        std::fs::remove_file(&procd).unwrap();

        // Test /etc/config + uci
        let config = etc.join("config");
        std::fs::create_dir_all(&config).unwrap();
        let uci = sbin.join("uci");
        std::fs::write(&uci, "").unwrap();
        assert!(is_openwrt_in_root(root));
        std::fs::remove_file(&uci).unwrap();

        // Test /etc/os-release with ImmortalWrt
        let os_rel = etc.join("os-release");
        std::fs::write(&os_rel, "NAME=\"ImmortalWrt\"\nID=\"immortalwrt\"\n").unwrap();
        assert!(is_openwrt_in_root(root));

        // Test /etc/os-release with iStoreOS
        std::fs::write(&os_rel, "NAME=\"iStoreOS\"\nID=\"istoreos\"\n").unwrap();
        assert!(is_openwrt_in_root(root));

        // Test /etc/os-release with LEDE
        std::fs::write(&os_rel, "NAME=\"LEDE\"\nID=\"lede\"\n").unwrap();
        assert!(is_openwrt_in_root(root));
    }
}
