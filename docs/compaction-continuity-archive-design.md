# 压缩连续性 + Artifact 记忆归档 最终设计

> 状态：已实现（2026-10-25）
> 目标：在压缩后最大化 **任务连续性** 与 **记忆完整性**，同时不牺牲现有安全机制。
> 关联：[compact-durable-checkpoint-design.md](compact-durable-checkpoint-design.md)、[compact-native-migration-retrospective.md](compact-native-migration-retrospective.md)

## 1. 结论

最终形态是四层叠加：

```text
触发/水位（何时压）
  → 保留策略（最近上下文 + sacred floor，逐字保留）
  → LLM 摘要（连续性模板，跨压缩锚点更新）
  → Artifact 原文归档（完整记忆，可 read 回读，watchdog 治理）
```

一句话：**最近内容逐字留着，被摘要的内容一句不丢地进 artifact，摘要告诉继任 agent 怎么找回来。**
不再设置单次归档大小上限（依赖现有全局 watchdog 治理）。

## 2. 触发与水位（与输出预算对齐）

```text
水位 watermark   = window − min(20_000, window / 4)
自动压缩触发线   = 0.9 × watermark            (compact_threshold 默认 0.9，可按模型覆盖)
高水位强制摘要   = utilization ≥ 0.78         (仅 auto：且 auto_drain_would_help)
溢出阶梯         0 激进 stub → 1 硬截断 → 2 drain+摘要
```

压力口径：**prompt + completion**（下一次请求真正携带的上下文），由 provider 上报；
无 usage 时退回保守估算（CJK 一字一 token）。

与输出预算的配合（已实现）：

```text
max_tokens = max(1, min(能力值, window/8, window − 提示词锚点 − 4096))
锚点 = provider 上次(prompt+completion) + 尾部保守估算，与全量保守估算取大
```

在压缩触发线，1M 窗口仍有约 119K 输出预算；200K 窗口约 25K。两者互不冲突。

## 3. 保留策略（逐字，不进摘要）

1. **sacred floor**：开头所有 System 消息 + 第一条真实 user 消息，永不 drain。
2. **最近窗口**：保留最近约 `25% × window` 的完整 turn（clamp 8K–256K，且 ≤ window/2）。
3. **turn 对齐**：drain 边界必须落在真实 user 消息上；不拆 turn、不产生孤立 tool_call/result。
4. **净缩减守卫**：候选必须比原对话小，否则拒绝提交（幂等，重复触发是 no-op）。
5. **resume 配对修复**：恢复时 `repair_pairing`，丢弃 orphan、补齐 dangling。

## 4. Artifact 原文归档（本次新增）

### 4.1 存储

- 复用现有 `ArtifactStore`（`tools/output_artifact.rs`）：
  - 内容寻址：`sha256` 前 8 字节 → 16 hex id；同样内容自动去重；
  - 每会话目录：`<sessions>/<project_hash>/<session_id>.artifacts/`；
  - 原子写（`.tmp` + rename），读取 touch mtime（真实 LRU）。
- **不设单次归档大小上限**。唯一的边界是全局 watchdog（7 GiB 硬上限、5 GiB 目标、3 天周期淘汰）与磁盘本身。
- 归档发生在 `OverflowCompaction` 真正 drain 的分支（manual / auto 升级 / overflow tier 2）；
  stub-only 路径不 drain，不产生归档。

### 4.2 归档内容（完整优先）

Markdown 转录，逐消息、逐字：

```markdown
# Compaction archive — <n> message(s)

## Index (user turns)
#0012 帮我排查测试超时
#0031 继续，把测试也修了
...

## #0012 · user · id=<message id>
<完整原文，含附件引用>

## #012 · user
<完整原文，含附件引用>

## #013 · assistant
<完整正文>
[reasoning]
<完整思考内容>
[signature]
<opaque 签名，若存在（不设上限，完整保留）>
[tool_call] read {"path":"…"}

## #014 · tool (call_id=…)
<完整工具输出，不截断>
```

约定：

- **正文、思考、工具参数、工具输出全部完整保留**，不做 2K 截断（那是摘要输入的限制，不是归档的）。
- 签名（Anthropic signed thinking 等）默认保留；如体积敏感可通过配置关闭，但默认"完整"。
- 图片不内联 base64：写引用（session image-cache / sidecar 路径），避免重复占盘。
- 顶部 Index 便于 `read(keyword=…)` 与人工定位。

### 4.3 指针（写进摘要）

摘要末尾固定追加：

```text
[Verbatim archive] artifact=<id>
Recover exact code, error strings, or full tool output with:
- read(path="artifact://<id>", keyword="<term>")
- read(path="artifact://<id>", offset=<line>, limit=<lines>)
```

该语法与现有压缩 stub 完全一致（`compaction.rs` 的 stub 已经在教模型用 `artifact://`），
`read` 工具已原生支持 keyword / offset / limit。

### 4.4 失败与降级

- `ArtifactStore::put` 失败：发一条 Warning，**摘要照常提交**，只是不带指针；压缩不失败。
- 摘要失败/超时（180s）：退回快速 stub，**仍然带上 artifact 指针**（stub 也能引用归档）。
- checkpoint（手动压缩）：先写归档 → 再持久化压缩后候选快照 → 成功后才提交；任一失败保持 live conversation 不变。

### 4.5 Watchdog 治理（pin）

压缩归档比普通工具输出更重要，避免被 3 天周期淘汰：

- 归档写入时同时创建零字节 `<id>.pin`；
- `evict_oldest_bytes` 与周期扫描：
  - 跳过 `*.pin` 文件本身；
  - 有同名 `.pin` 的 artifact **不参与周期 30% 淘汰**；
  - 仅当全局突破 7 GiB 硬上限时，pin 归档才作为最后的 LRU 候选（先淘汰非 pin）；
- artifact 被删除时一并清理 `.pin`。

## 5. 摘要提示词（最终版）

### 5.1 System

```text
You are an anchored context summarization assistant for a coding session. Your
summary will be given to a SUCCESSOR assistant that must continue the work
seamlessly; it will see the user's original request, this summary, and can read
the verbatim archive at artifact://<id>.

If a <previous-summary> block is present, treat it as the authoritative summary
so far: preserve still-true facts, remove stale ones, merge new facts. Never
drop information that is still needed to continue.

Output exactly the requested section structure, every section present
("(none)" when empty). Be terse and factual. Do not answer the conversation.
Do not mention summarizing/compaction. Respond in the conversation's language.
Do not call tools.
```

### 5.2 章节（连续性与记忆优先）

```markdown
## 1. Primary Request & Intent
- 用户全部显式请求 + 底层意图、范围边界、明确偏好

## 2. Constraints & Preferences
- 用户提出的约束/规范/禁止项

## 3. All User Messages
- 按时间顺序列出每条真实用户消息（原文，压缩/系统生成的除外）

## 4. Key Technical Concepts
- 语言/框架/库/工具/关键模式

## 5. Files & Code Sections
- 每个涉及文件的完整路径、作用、最近改动的完整代码片段

## 6. Errors & Fixes
- 每个报错/失败命令/测试失败的根因与修复；用户反馈原话

## 7. Problem Solving
- 已解决 + 正在验证的假设、未收敛的诊断

## 8. Progress
### Done / In Progress / Blocked

## 9. Key Decisions
- 决策 + 理由（保留历史决策，标注被推翻的）

## 10. Current Work
- 压缩前最后在做什么：文件、命令、状态，精确到可 mid-stream 恢复

## 11. Pending Tasks
- 用户明确要求但未完成的（不得臆造）

## 12. Next Step
- 唯一一条直接续做的动作，附最近消息中的原话引用

## 13. Relevant Files
- path: 为什么重要
```

### 5.3 生成参数

| 项 | 值 |
|---|---|
| 输入 | 被 drain 区间的转录（工具输出每条截 2K，控制摘要成本；完整内容在 artifact） |
| 输出预算 | 16,000 tokens（软），64 KiB 硬截断 |
| 超时 | 180 秒；超时/失败 → stub 兜底 + 说明 note |
| 工具 | 禁用 |
| 模型 | 默认当前模型；预留 `session_summary_model` 作为后续可选 |
| 锚点 | 有旧摘要时走 UPDATE 模式，并把旧摘要置于 `<previous-summary>`；分隔符逃逸中和 |

## 6. 成功/失败契约

| 场景 | 行为 |
|---|---|
| 正常 drain | 写 artifact → 生成摘要（带指针）→ net-loss 校验 → commit |
| artifact 写失败 | Warning；摘要不带指针；commit 正常 |
| 摘要超时/失败 | 退回 stub（对话保留、工具输出折叠）+ artifact 指针 + resume note |
| 手动压缩 checkpoint 失败 | `CompactionFailed`，live conversation / epoch 不变 |
| 无内容可 drain | no-op（不写 artifact、不递增 epoch、不显示 "compacting"） |
| 恢复 | `repair_pairing`；artifact 由 read 工具按会话解析 |

## 7. 实现边界（已落地）

| 层 | 改动 |
|---|---|
| `jeikcode-capabilities/src/compaction.rs` | ✅ `OverflowCompaction::with_archive`；`summarize()` 先写归档再摘要；`archive_span` / `archive_pointer` / `render_full_transcript`（含 user-turn Index、完整工具输出、reasoning、签名）；摘要模板替换为 13 段；旧指针剥离 |
| `jeikcode-coding/src/parts.rs` | ✅ 用 `SessionBinding.manager.artifacts_dir(id)` 构造 `ArtifactStore` 注入策略（`assemble.rs` 的无会话路径不注入） |
| `jeikcode-capabilities/src/tools/output_artifact.rs` | ✅ `ArtifactStore::pin()`（写 `<id>.pin`） |
| `jeikcode-capabilities/src/tools/artifact_watchdog.rs` | ✅ `.pin` 跳过；周期淘汰豁免 pinned；硬上限时 pinned 排最后；删除时清理 `.pin` |
| `jeikcode-kernel` | 不改触发/预算/commit；复用现有 `CompactionView` 与事件 |
| `read` 工具 | 不改（`artifact://` 已支持 keyword/offset/limit） |

### 实现备注

- 无摘要 provider 或摘要失败/为空时，不再"静默纯 drain"：改为写入 `ANCHOR_SENTINEL + SUMMARY_FRAMING + 指针` 的锚点消息，继任 agent 仍能回读。
- `SUMMARY_FRAMING` 显式说明末尾的 `[Verbatim archive]` 指针是元数据、可调用 `read()` —— 避免注入防护把恢复指令也一并禁止。
- 归档先写、摘要后生成；摘要超时路径走 stub（不 drain，不需要归档）。

## 8. 记忆与性能指标

- 归档内容 ≈ **4–5 MB / 1M tokens**（紧凑文本，含思考与工具输出；实测 664K → 2.51 MB 内容 / 4.40 MB JSON）。
- 归档写入是纯本地 I/O，无额外 LLM 调用。
- 内容寻址去重：重复压缩同一区间不重复占盘。
- 全局容量：7 GiB ÷ 5 MB ≈ 1400 次归档；单会话通常数十 MB。
- 指标：`Compacted` 事件增加 `archive: {id, bytes, messages}`；记录摘要 tokens、耗时、artifact 读取次数。

## 9. 安全与隐私

- artifact 与现有工具输出同目录、同权限；会话删除时随之清理。
- 归档包含完整对话（可能含敏感输出），不对外传输；仅本地 `read` 可访问。
- 摘要输入仍然做 2K 工具输出截断与注入防护；归档不进入模型上下文，除非模型主动 read。

## 10. 测试计划

1. 归档写入/读取 round-trip：内容寻址 id 稳定、offset/limit/keyword 正确。
2. 摘要包含指针；`read(artifact://id)` 能命中归档。
3. 归档写失败 → 压缩仍成功、无指针、有 Warning。
4. 摘要超时 → stub 兜底 + 指针 + note。
5. `.pin` 豁免：周期淘汰不删 pinned；硬上限下先淘汰非 pinned。
6. 多次压缩：锚点摘要持续累积，旧 artifact 仍可读。
7. net-loss / 幂等 / sacred floor / turn 对齐回归。
8. 1M 上下文归档体积回归（4–5 MB 量级，无上限）。

## 11. 后续可选

- `session_summary_model`：摘要使用独立小模型，降低成本。
- 分支/fork 摘要（Pi 的 branch summarization）。
- 归档 zstd 压缩（读取端解压）以进一步降低占盘。
