# 《Zap & DeepSeek 双擎单体融合工程方案》

> **项目代号**：Project Zap-Titan (双擎单体融合)  
> **编写日期**：2026-11-04  
> **核心战略**：DSH 为皮（生态、桌宠、动态壁纸、WebUI），Zap 为骨（Rust 高性能代码图谱、99% KV-Cache、原子防脏写），N-API 进程内内存焊死，统一交付为单一可执行程序 `Zap.exe`。

---

## 一、 核心诉求与演进心路历程

### 1. 核心诉求（既要、又要、还要）
* **要 Zap 的硬核底座**：纯 Rust 的极致性能、**Tree-Sitter 语义代码图谱（CodeExplore：业务大白话搜索、跨文件调用链追踪）**、**98–99% 极致 KV-Cache 保护（圣地地基 sacred_floor，Token 便宜 90%+）**、类 Git 原子防脏写与状态机。
* **要 DeepSeek Harness 的生态果实**：会根据干活状态实时卖萌的大肥鱼桌宠（`dsh-pet`）、4K 动态视频壁纸（`dsh-wallpaper`）、以及社区不断涌现的 20,000+ 现成插件。
* **三大底线原则**：
  1. **坚决不重新造轮子复刻**：不要为了用桌宠和壁纸自己在 Zap 里重新写一套，必须能直接安装、直接用现成的插件；
  2. **坚决不搞两个分裂的程序**：不要批处理启动脚本、不要后台挂一个 `jeikcode.exe` 又开一个 Node 黑框，必须是**单个软件、单个桌面图标、同一个主程序**；
  3. **坚决不牺牲代码战斗力**：代码理解和工程重构能力必须由 Zap 的 Rust 引擎统治，绝不向低效妥协。

### 2. 逻辑死结与终极破局
* **为什么去掉 DS 内核会陷入死结？**  
  插件是长在内核上的“果子”，DS 内核是这棵“果树”。如果砍掉 DS 内核，所有插件立刻失效报废，就不可避免地被逼回“重新复刻”的死胡同。
* **破局之道**：  
  **DS 的内核绝对不能砍！把它原封不动装进同一个盒子里当“插件宿主树”，把 Zap 编译为“内嵌原生加速库”，整体打包成单个独立的 `Zap.exe` 桌面软件。**

---

## 二、 终极系统架构设计（单体融合图）

```text
┌─────────────────────────────────────────────────────────────┐
│                 最终交付：单独立可执行软件 Zap.exe            │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│   【外表交互与插件宿主层：DeepSeek Harness (皮 / 宿主)】       │
│   - 负责 Web 交互界面、窗口渲染与状态通知                   │
│   - 100% 保留 DS 专有内核 (Cordis 微内核 + Agent Loop)       │
│   - 零修改直接运行现成插件：                                  │
│     • 桌面小挂件：大肥鱼桌宠 (实时状态换表情、摸摸头)          │
│     • 沉浸式背景：Wallpaper Engine 4K 动态视频壁纸           │
│     • 社区生态池：ModLens 视觉外挂、GenUI 动态卡片等         │
│                                                             │
│ ═══════════════════════════════════════════════════════════ │
│    【进程内内存直调桥梁：N-API (Rust C-ABI 零开销管道)】     │
│    - 运行在同一个操作系统进程、同一个内存地址空间！           │
│    - 绝非网络 HTTP、绝非本地子进程，微秒级直接调取函数         │
│ ═══════════════════════════════════════════════════════════ │
│                                                             │
│   【内核计算与安全层：Zap Rust Core Engine (骨 / 算力)】     │
│   - 编译为原生 .node 扩展，静态内嵌于 exe 肚子里              │
│   - Tree-Sitter 12+ 语言原生 AST 语义图谱 (code_explore)    │
│   - Sacred Floor 字节级锁死 99% KV-Cache (极大砍掉 API 费用) │
│   - 类 Git 状态机，多文件并发原子防脏写与一键 Undo 历史检查点     │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

---

## 三、 四阶段工程实施操作计划（落地 Roadmap）

### 阶段一：Zap 核心能力的“原生库化”（N-API 编译）
* **目标**：不改变 Zap 现有逻辑，通过 Rust 官方 `napi-rs` 将其核心函数导出为 `.node` 动态库。
* **具体动作**：
  1. 在 `D:/JeikCode/crates` 下新建 `zap-napi` 包，配置 `Cargo.toml`：
     ```toml
     [package]
     name = "zap-napi"
     version = "1.0.0"
     edition = "2021"

     [lib]
     crate-type = ["cdylib"]

     [dependencies]
     napi = { version = "2", features = ["async"] }
     napi-derive = "2"
     zap-coding = { path = "../zap-coding" }
     jeikcode-core = { path = "../jeikcode-core" }
     ```
  2. 导出两个关键原生能力：
     ```rust
     use napi_derive::napi;

     #[napi]
     pub fn zap_code_explore(scope_path: String, query: String) -> String {
         // 毫秒级直接调用 Zap 原生 Tree-Sitter 代码图谱
         zap_coding::explore_sync(&scope_path, &query)
     }

     #[napi]
     pub fn zap_reconcile_cache(prompt: String) -> String {
         // 字节级锁定前缀，确保 99% KV-Cache 命中
         jeikcode_core::sacred_floor::reconcile(&prompt)
     }
     ```
  3. 执行编译命令：
     ```bash
     cargo build --release --package zap-napi
     ```
     产出 `zap-core.node` 原生动态链接库。

---

### 阶段二：DS 内核无缝集成 Zap 引擎
* **目标**：在 DS 内核里注册 Zap，将其作为内置高优先级特权模块。
* **具体动作**：
  1. 在 DS 项目中创建内置插件 `@zap/builtin-core`：
     ```javascript
     // 直接载入同一个进程内存中的 Rust 模块
     const zap = require('./zap-core.node');

     module.exports = function apply(ctx) {
       // 1. 注册 Zap 王牌代码图谱工具
       ctx.tools.register({
         name: 'code_explore',
         description: '【Zap原生代码图谱】1~3ms精准分析AST语法树与业务调用链，复杂代码必用！',
         parameters: {
           type: 'object',
           properties: {
             path: { type: 'string', description: '目录或文件路径，如 "src" 或 "."' },
             query: { type: 'string', description: '业务问题或符号名称，如 "用户登录校验"' }
           },
           required: ['query', 'path']
         },
         execute: async (args) => zap.zapCodeExplore(args.path, args.query)
       });

       // 2. 注入 99% 缓存守卫（锁死前缀，杜绝抖动）
       ctx.on('agent/request', async (payload, next) => {
         payload.systemPrompt = zap.zapReconcileCache(payload.systemPrompt);
         return next();
       });
     };
     ```

---

### 阶段三：插件生态一键装配（直接用，零复刻）
* **目标**：把最火爆的大肥鱼桌宠、动态壁纸直接挂在 DS 内核上。
* **具体动作**：
  在配置声明里直接激活原生现成插件，一个字都不用改：
  ```bash
  # 直接安装大肥鱼桌宠（它自动监听 DS 内核事件驱动表情）
  dsh plugin add dsh-pet
  # 直接安装动态壁纸（自动读取 Steam Wallpaper Engine）
  dsh plugin add dsh-wallpaper
  ```

---

### 阶段四：单体独立软件打包（Single Executable Pipeline）
* **目标**：彻底告别终端和批处理脚本，生成单一 `Zap-Setup.exe` 安装包。
* **具体动作**：
  1. 使用桌面打包工具将前端界面、DS 内核、编译好的 `zap-core.node` 以及桌宠壁纸素材统一压入安装工程；
  2. 执行打包脚本：
     ```bash
     pnpm run build:desktop
     ```
  3. **产出终极交付件**：单个安装程序 `Zap_Setup_x64.exe`。

---

## 四、 最终交付体验对比清单

| 维度 | 整合前的割裂体验 | **融合后的“完全体 Zap”** |
| :--- | :--- | :--- |
| **启动形态** | 要开两个黑窗口，或跑批处理脚本 | **桌面单个图标，双击秒开独立窗口，零黑框** |
| **视觉与陪伴** | 枯燥的代码输入框，无任何趣味 | **全屏 4K 动态视频壁纸 + 屏幕右下角活体大肥鱼桌宠** |
| **代码搜索力** | 只有笨拙的 `grep`/`read`，经常漏查 | **Zap 原生 Tree-Sitter 语法图谱，业务大白话 1ms 溯源** |
| **API 成本** | DS 原生提示词易抖动，缓存常失效 | **Zap 圣地地基固化，98~99% KV-Cache 稳定省钱 90%** |
| **插件扩展** | 双方插件互不兼容 | **直接无感安装 20,000+ DSH 现成插件，无需二次复刻** |

---

## 五、 一句话总结

> **想“不复刻直接用插件”，DS 内核就绝不能砍！**  
> 我们的解法，不是把 DS 内核扔掉，而是**把“DS 内核”和“Zap 引擎”一起装进一个叫 `Zap.exe` 的单一软件肚子里，让你既能直接白嫖所有顶级插件，又能独享 Zap 的极速大脑！**
