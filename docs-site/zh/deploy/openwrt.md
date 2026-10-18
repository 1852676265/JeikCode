# OpenWrt 软路由与嵌入式网关部署

JeikCode 致力于打造真正**全平台统一的开源 AI 编程智能体 (Unified Cross-Platform Agent)**。得益于纯 Rust 原生开发与 Linux 上采用的 musl 静态编译架构，JeikCode 不仅能在 Windows、macOS 和主流 Linux 发行版上运行，更深度支持各类 **OpenWrt** 及其主流衍生固件（包括 **iStoreOS**、**ImmortalWrt**、**Kwrt**、**LEDE** 等）在 x86_64 与 aarch64 芯片架构上的无缝部署。

无论是将 JeikCode 部署在软路由边缘网关上作为全天候家庭/企业常驻代码审查 Agent，还是直接在路由器内执行网络脚本运维与开发任务，均能享受完全一致的代码图谱、工具调用与极致缓存能力。

---

## 一、一键在线安装

在 OpenWrt 终端（通过 SSH 或网页端控制台）执行官方一键安装命令：

```sh
curl -fsSL https://raw.githubusercontent.com/jeikl/JeikCode/main/scripts/install.sh | sh
```

### 自动化适配说明
* **架构自适应**：脚本自动检测当前软路由 CPU 架构（如 `x86_64` 或 `aarch64/arm64`），匹配下载纯静态编译的二进制产物；
* **自动建立系统软链接**：脚本内置高精度 OpenWrt 指纹检测，识别后自动在系统默认 PATH 目录创建软链接 `/usr/bin/jeikcode -> /usr/local/bin/jeikcode`；
* **无需重新加载**：安装完成后无需手动执行 `source` 或修改配置文件，直接在当前终端输入 `jeikcode` 即可立即执行。

---

## 二、配置开机自启（procd 守护向导）

OpenWrt 采用自研轻量级 `procd` 进程管理系统（非传统 Linux 的 `systemd`）。JeikCode CLI 深度集成了 OpenWrt 原生自启向导：

当你通过 `--host` 参数启动服务时：

```sh
jeikcode --host 0.0.0.0 --port 13457 --token your-secure-token
```

JeikCode 会自动确诊当前环境为 OpenWrt，并弹出原生向导提问：

```text
JeikCode 即将在 0.0.0.0:13457 启动。
是否配置为 OpenWrt 系统服务 (procd) 并开机自启？ [y/N]: y
请输入系统服务名 (直接回车默认: jeikcode-13457): 
```

输入 `y` 确认后，系统将自动完成以下全部工作：
1. 捕获当前环境配置并在 `/etc/init.d/` 生成标准的 `USE_PROCD=1` 启动脚本；
2. 注入 `respawn 3600 5 0` 守护规则（进程异常退出后自动拉起恢复）；
3. 自动执行 `/etc/init.d/jeikcode-13457 enable` 注册开机自启；
4. 自动拉起后台服务并打印网络访问 URL，随后优雅将终端输入态交还用户。

---

## 三、服务状态管理与卸载

你可以随时使用 OpenWrt 原生命令或 JeikCode 统一服务命令维护后台服务：

### 1. OpenWrt 原生维护命令

```sh
# 查看服务状态
/etc/init.d/jeikcode-13457 status

# 重启后台服务
/etc/init.d/jeikcode-13457 restart

# 停止后台服务
/etc/init.d/jeikcode-13457 stop

# 禁用开机自启
/etc/init.d/jeikcode-13457 disable

# 查看实时运行日志
logread -e jeikcode
```

### 2. JeikCode 统一服务管理命令

JeikCode 提供了跨平台的统一服务管理子命令：

```sh
# 列出当前软路由上已安装的所有 JeikCode 服务
jeikcode server list

# 卸载指定服务（自动停止进程、注销自启并安全清理脚本）
jeikcode server uninstall <ID>
```

---

## 四、软路由存储优化建议

在路由器或嵌入式设备上运行智能体时，通常需要注意内部 Flash（Overlay）分区的存储容量：

1. **重定向工作与数据目录**：
   JeikCode 运行时产生的本地配置、会话记录与代码图谱索引默认存放于 `~/.jeikcode`。如果软路由挂载了外部 SSD、U 盘或网络存储（如 `/mnt/sda1`），强烈建议通过环境变量将其重定向至外置磁盘：
   ```sh
   echo 'export JEIKCODE_HOME="/mnt/sda1/.jeikcode"' >> /etc/profile
   ```
2. **挂载点权限**：
   确保挂载的外置存储具有读写权限（推荐使用 ext4 等 Linux 原生文件系统）。
