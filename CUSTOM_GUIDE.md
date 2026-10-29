# JeikCode 二次开发与上游持续开源同步指南

本项目已完成从官方仓库（[jeikl/JeikCode](https://github.com/jeikl/JeikCode)）到个人仓库（[1852676265/JeikCode](https://github.com/1852676265/JeikCode)）的 Fork 与本地多远端（Dual Remote）配置，并设立了专门的二开分支与非侵入式开发规范。

---

## 📌 仓库与远端架构 (Dual-Remote Model)

本地仓库已自动绑定双远端：
- **`upstream`（官方上游）**：`https://github.com/jeikl/JeikCode.git`
- **`origin`（您的开源仓库）**：`https://github.com/1852676265/JeikCode.git`

---

## 🌿 分支管理规范（保障官方更新无冲突合并）

为了实现 **「官方更新我也开源更新，二开不破坏原版」** 的核心目标，仓库采用双分支隔离机制：

| 分支名 | 定位 | 规则 |
| :--- | :--- | :--- |
| **`main`** | 官方纯净镜像分支 | **严禁在此分支编写任何二开代码**。它仅用于 1:1 跟踪官方更新，并开源推送到您的 GitHub `origin/main`。 |
| **`custom`** | 二次开发专属分支 | **所有 UI 修改、新功能增加均在此分支推进**。每次官方更新后，将 `main` 的最新提交合并到 `custom`。 |

---

## ⚡ 一键同步官方更新（后续官方更新，我也开源更新）

当官方发布了新版本或修复了 Bug，您只需在项目根目录运行预置的自动化脚本：

### Windows 用户 (PowerShell)：
```powershell
.\scripts\sync-upstream.ps1
```

### Linux / macOS / Git Bash 用户：
```bash
./scripts/sync-upstream.sh
```

### 脚本全自动执行的逻辑：
1. 自动 `git fetch upstream` 检查官方最新提交；
2. 自动切换到 `main` 分支，快进对齐 `upstream/main`；
3. 自动将最新的官方代码推送到您的 GitHub（`origin/main`），完成**公开开源同步**；
4. 自动切回您的 `custom` 分支，并将 `main` 的最新更新合并（merge）进二开环境；
5. 自动保留并恢复未提交的工作区暂存（stash）。

---

## 🎨 二开规范：不改系统原本核心，仅改 UI 与加功能

为避免日后合并官方更新时陷入繁琐的冲突解决（Merge Conflict），请遵循以下非侵入式原则：

### 1. 修改 UI 样式（非侵入式 CSS 覆盖）
- **规范路径**：`webui/src/custom/custom.css`
- **规范做法**：官方 WebUI 采用了高度模块化的 CSS Variables 设计。请直接在 `custom.css` 中重写变量（例如 `--app-brand`, `--app-accent-color`, `--corner-radius-medium`）或编写自定义选择器。
- **严禁行为**：尽量不要直接重构 `webui/src/styles/theme.css` 或 `app.css` 中的原始类名。

### 2. 增加前端自定义功能
- **规范路径**：`webui/src/custom/`
- **规范做法**：将新功能组件、工具函数放在 `webui/src/custom/` 目录下，并在 `webui/src/custom/custom-registry.ts` 中注册。通过挂载监听、插槽或高阶包装（Wrapper）接入视图，不修改官方核心事件流。

### 3. 增加后端（Rust）自定义功能
- **规范路径**：`crates/` 目录下新增独立 crate（如 `crates/jeikcode-my-feature`）
- **规范做法**：根目录 `Cargo.toml` 采用了通配符 `members = ["crates/*"]`，任何新建在 `crates/` 下的 crate 都会被 Cargo 自动识别为工作区成员，**完全不需要修改根目录 Cargo.toml**。在需要调用的地方以依赖模块引入，保持官方已有 crate 的纯净。

---

## 🔐 授权与 GitHub 管理说明

- **本地授权**：已通过 GitHub CLI（`gh`）完成对账号 `1852676265` 的授权绑定，具备 `repo` 等读写权限。
- **网页端管理**：
  - 您的 GitHub 仓库主页：[https://github.com/1852676265/JeikCode](https://github.com/1852676265/JeikCode)
  - GitHub 个人 Access Tokens 管理：[https://github.com/settings/tokens](https://github.com/settings/tokens)
  - GitHub 授权应用列表：[https://github.com/settings/applications](https://github.com/settings/applications)
