/**
 * Zap Plugin Micro-Kernel & Typed Slot System
 * -----------------------------------------------------------------------------
 * 1:1 architectural counterpart to DeepSeek's `@deepseek-ai/cordis` +
 * `@deepseek-ai/dsh-client-ui-slots` + `plugin-manager` + `ui-settings`.
 *
 * Provides:
 * - Typed UI Slot Registry (`settings.section`, `settings.action`,
 *   `settings.general.item`, `settings.plugins.tab`, `plugins.tab`, `shell.overlay`)
 * - Built-in Plugin Inventory (Session plugins by Agent Preset + Global plugins)
 * - Agent Preset Roster (`standard`, `ptc`, `minimal` + custom presets)
 * - External Plugin Package Manager (Install wizard, Registry selector,
 *   Package detail view, Row switches, Local JS/JSON bundle loader, Market index)
 */

import { ComponentChildren, h } from 'preact';
import { useEffect, useRef, useState } from 'preact/hooks';

// =============================================================================
// 1. Typed Slot Contracts (Aligned with @deepseek-ai/dsh-client-ui-slots)
// =============================================================================

export interface SettingsSectionRuntimeProps {
  close: () => void;
  navigate: (sectionId: string) => void;
}

export interface SettingsSectionContribution {
  id: string;
  order: number;
  icon: ComponentChildren;
  label: string;
  badge?: string | number;
  title?: string;
  description?: string;
  pluginPackage?: string;
  render: (props: SettingsSectionRuntimeProps) => ComponentChildren;
}

export interface SettingsActionContribution {
  id: string;
  order: number;
  pluginPackage?: string;
  render: (props: SettingsSectionRuntimeProps) => ComponentChildren;
}

export interface SettingsGeneralItemContribution {
  id: string;
  order: number;
  render: () => ComponentChildren;
}

export interface SettingsPluginsTabContribution {
  id: string;
  order: number;
  label: string;
  render: () => ComponentChildren;
}

export interface PluginsManagerTabContribution {
  id: string;
  order: number;
  label: string;
  render: (props: {
    openPackage: (packageName: string) => void;
    openInstall: (spec?: string) => void;
  }) => ComponentChildren;
}

export interface ShellOverlayContribution {
  id: string;
  order: number;
  pluginPackage?: string;
  render: () => ComponentChildren;
}

export interface SlotMap {
  'settings.section': SettingsSectionContribution;
  'settings.action': SettingsActionContribution;
  'settings.general.item': SettingsGeneralItemContribution;
  'settings.plugins.tab': SettingsPluginsTabContribution;
  'plugins.tab': PluginsManagerTabContribution;
  'shell.overlay': ShellOverlayContribution;
}

export type SlotKey = keyof SlotMap;

// =============================================================================
// 2. Built-in Plugins & Agent Presets Data Models
// =============================================================================

export type PluginRuntimePhase = 'active' | 'unobserved' | 'pending' | 'failed';

export interface BuiltinPluginEntry {
  id: string;
  name: string;
  title: string;
  description: string;
  moduleName: string;
  scope: 'session' | 'global';
  enabled: boolean;
  locked?: boolean;
  lockedReason?: string;
  presets?: string[];
  condition?: string;
  runtimePhase: PluginRuntimePhase;
  configTabId?: string;
}

export interface AgentPresetEntry {
  id: string;
  name: string;
  builtIn: boolean;
  isDefault: boolean;
  requiresCodingTools?: boolean;
  description: string;
  declarationYaml: string;
  explanation: string;
  usage: string;
}

export interface ShellExecutorLimits {
  defaultTimeoutSec: number;
  maxTimeoutSec: number;
  maxOutputBytes: number;
  autoPromoteLongJobs: boolean;
  blockInteractiveTui: boolean;
}

// =============================================================================
// 3. External Plugin Manager & Plugin Market Models
// =============================================================================

export interface ExternalPluginRow {
  rowId: string;
  title: string;
  description: string;
  moduleName: string;
  enabled: boolean;
  phase: PluginRuntimePhase;
  hasConfig?: boolean;
  sectionId?: string;
}

export interface ExternalPluginPackage {
  name: string;
  title: string;
  description: string;
  version: string;
  author?: string;
  icon?: string;
  official: boolean;
  pinnedByDefault?: boolean;
  installed: boolean;
  enabled: boolean;
  removable: boolean;
  updatable: boolean;
  beta?: boolean;
  source: string;
  installDir: string;
  readmeMarkdown: string;
  versions: string[];
  rows: ExternalPluginRow[];
  configValues?: Record<string, any>;
  configSchema?: {
    key: string;
    label: string;
    description: string;
    type: 'boolean' | 'string' | 'number' | 'select';
    options?: { label: string; value: string }[];
  }[];
}

export interface MarketListingVersion {
  version: string;
  publishTimestamp: number;
  compatible: boolean;
  runtimeRequirement: string;
}

export interface MarketListingEntry {
  name: string;
  title: string;
  description: string;
  author: string;
  category: 'productivity' | 'appearance' | 'devtools' | 'automation' | 'model';
  labels: string[];
  defaultVersion: string;
  versions: MarketListingVersion[];
  repository: string;
  registry: string;
  readmeMarkdown: string;
  configSchema?: ExternalPluginPackage['configSchema'];
  defaultConfig?: Record<string, any>;
  contributesSettingsSection?: {
    id: string;
    label: string;
    title: string;
    description: string;
  };
}

export type RegistryChoice =
  | { kind: 'offered'; registry: 'auto' | 'npmmirror' | 'npmjs' }
  | { kind: 'custom'; url: string };

export interface InstallRunLog {
  jobId: string;
  command: string;
  cwd: string;
  output: string;
  exitCode?: number;
  registryLabel?: string;
}

export interface InstallWizardState {
  open: boolean;
  phase: 'idle' | 'checking' | 'running' | 'done' | 'failed';
  spec: string;
  registryOpen: boolean;
  registry: RegistryChoice;
  detailsOpen: boolean;
  inputError: string | null;
  failureMessage: string | null;
  installedPackageName: string | null;
  installedVersion: string | null;
  subjectTitle: string | null;
  subjectDescription: string | null;
  runs: InstallRunLog[];
}

// =============================================================================
// 4. Default Initial Data (Aligned with DeepSeek Harness & Zap)
// =============================================================================

const STORAGE_KEY_BUILTIN = 'zap.plugin_kernel.builtin.v1';
const STORAGE_KEY_PRESETS = 'zap.plugin_kernel.presets.v1';
const STORAGE_KEY_PACKAGES = 'zap.plugin_kernel.packages.v1';
const STORAGE_KEY_SHELL_LIMITS = 'zap.plugin_kernel.shell_limits.v1';
const STORAGE_KEY_DEV_TOOLS = 'zap.plugin_kernel.dev_tools.v1';

const DEFAULT_AGENT_PRESETS: AgentPresetEntry[] = [
  {
    id: 'standard',
    name: 'Standard 标准预设',
    builtIn: true,
    isDefault: true,
    description: '全功能通用预设，组合文件读写、Shell 执行、语义代码图谱检索、网页抓取与多智能体任务编排。',
    declarationYaml: `# Agent Preset: standard\nid: standard\nname: Standard 标准预设\nsessionPlugins:\n  - "@zap/agent-loop"\n  - "@zap/code-explore"\n  - "@zap/file-tools"\n  - "@zap/shell-executor"\n  - "@zap/todo-planner"\n  - "@zap/subagent-router"\n  - "@zap/web-research"\n`,
    explanation: 'Standard 标准预设为每个新建会话挂载完整的研发工具链与上下文感知插件，适合日常编码、架构重构、代码审查与排错。',
    usage: '在新建会话时默认生效；也可在下方预设列表中切换其他预设作为新会话默认配置。',
  },
  {
    id: 'ptc',
    name: 'PTC 编排预设',
    builtIn: true,
    isDefault: false,
    requiresCodingTools: true,
    description: 'Programmatic Tool Calling 预设，支持在沙箱内通过脚本批量编排多工具调用并聚合结果，降低长链路推理延迟。',
    declarationYaml: `# Agent Preset: ptc\nid: ptc\nname: PTC 编排预设\nrequiresCodingTools: true\nsessionPlugins:\n  - "@zap/agent-loop"\n  - "@zap/ptc-orchestrator"\n  - "@zap/code-explore"\n  - "@zap/file-tools"\n  - "@zap/shell-executor"\n  - "@zap/todo-planner"\n`,
    explanation: 'PTC（程序化工具调用）允许智能体在单轮推理中编写编排逻辑并发调度多个检索与读写工具，大幅减少大规模代码库探索所需的往返轮次。',
    usage: '需先在「通用 -> 编码与开发者工具」中保持启用状态；适合跨模块重构、全量静态审计等重度工程任务。',
  },
  {
    id: 'minimal',
    name: 'Minimal 极简预设',
    builtIn: true,
    isDefault: false,
    requiresCodingTools: true,
    description: '极简轻量会话预设，仅启用核心对话循环与基础文件读取，关闭自动命令执行与后台子智能体。',
    declarationYaml: `# Agent Preset: minimal\nid: minimal\nname: Minimal 极简预设\nsessionPlugins:\n  - "@zap/agent-loop"\n  - "@zap/file-tools"\n`,
    explanation: 'Minimal 极简预设移除高开销工具Schema与子智能体注入，将上下文窗口100%留给纯文本推理、架构设计与算法问答。',
    usage: '适合纯粹的技术方案讨论、文档撰写或低延迟问答场景。',
  },
];

const DEFAULT_BUILTIN_PLUGINS: BuiltinPluginEntry[] = [
  // Session Plugins (composed per session by Agent Presets)
  {
    id: 'agent-loop',
    name: '@zap/agent-loop',
    title: '智能体推理循环 (Agent Loop)',
    description: '驱动多轮工具调用、流式思维链解析与上下文自动折叠的核心会话执行器。',
    moduleName: '@zap/agent-loop/session',
    scope: 'session',
    enabled: true,
    locked: true,
    lockedReason: '核心会话运行时组件，不可停用',
    presets: ['standard', 'ptc', 'minimal'],
    runtimePhase: 'active',
  },
  {
    id: 'code-explore',
    name: '@zap/code-explore',
    title: '语义代码图谱 (Code Explore)',
    description: '基于语义调用图谱检索跨文件调用链、业务流程与字段读写位点。',
    moduleName: '@zap/code-explore/graph',
    scope: 'session',
    enabled: true,
    presets: ['standard', 'ptc'],
    runtimePhase: 'active',
  },
  {
    id: 'file-tools',
    name: '@zap/file-tools',
    title: '工作区文件工具集 (File Tools)',
    description: '提供 read、edit、write、glob、grep 等高性能本地文件精准读写与搜索能力。',
    moduleName: '@zap/file-tools/fs',
    scope: 'session',
    enabled: true,
    presets: ['standard', 'ptc', 'minimal'],
    runtimePhase: 'active',
  },
  {
    id: 'shell-executor',
    name: '@zap/shell-executor',
    title: '终端命令执行器 (Shell Executor)',
    description: '在受控非交互式 Shell 中执行构建、测试、Git 操作与进程检查，自动拦截阻塞式 TUI。',
    moduleName: '@zap/shell-executor/runner',
    scope: 'session',
    enabled: true,
    presets: ['standard', 'ptc'],
    runtimePhase: 'active',
    configTabId: 'shell-config',
  },
  {
    id: 'todo-planner',
    name: '@zap/todo-planner',
    title: '实时任务清单 (Todo Planner)',
    description: '维护多步工程任务的结构化检查单，实时同步执行进度与单点闭环状态。',
    moduleName: '@zap/todo-planner/checklist',
    scope: 'session',
    enabled: true,
    presets: ['standard', 'ptc'],
    runtimePhase: 'active',
  },
  {
    id: 'subagent-router',
    name: '@zap/subagent-router',
    title: '子智能体并发路由 (Subagent Router)',
    description: '派发隔离的 explore 与受作用域约束的 worker 子智能体并发执行独立子任务。',
    moduleName: '@zap/subagent-router/dispatch',
    scope: 'session',
    enabled: true,
    presets: ['standard'],
    runtimePhase: 'active',
  },
  {
    id: 'web-research',
    name: '@zap/web-research',
    title: '网页检索与文档抓取 (Web Research)',
    description: '提供 web_search 与 web_fetch 能力，实时查阅外部技术文档并将网页转换为 Markdown。',
    moduleName: '@zap/web-research/fetch',
    scope: 'session',
    enabled: true,
    presets: ['standard'],
    runtimePhase: 'active',
  },
  // Global Plugins (shared across system and all sessions)
  {
    id: 'mcp-bridge',
    name: '@zap/mcp-bridge',
    title: 'MCP 协议客户端桥 (MCP Bridge)',
    description: '连接并管理外部 Model Context Protocol 工具服务器（Stdio / SSE / HTTP）及工具注入。',
    moduleName: '@zap/mcp-bridge/host',
    scope: 'global',
    enabled: true,
    runtimePhase: 'active',
    configTabId: 'mcp-skills-config',
  },
  {
    id: 'skills-engine',
    name: '@zap/skills-engine',
    title: 'Skills 技能工作流引擎 (Skills Engine)',
    description: '扫描并挂载项目级与全局 SKILL.md 技能包，支持按任务语义自动唤醒可复用工作流模板。',
    moduleName: '@zap/skills-engine/loader',
    scope: 'global',
    enabled: true,
    runtimePhase: 'active',
    configTabId: 'mcp-skills-config',
  },
  {
    id: 'session-compactor',
    name: '@zap/session-compactor',
    title: '上下文锚点压缩器 (Session Compactor)',
    description: '当长会话逼近上下文窗口阈值时，自动提炼结构化进度锚点并无损释放历史 Token。',
    moduleName: '@zap/session-compactor/anchor',
    scope: 'global',
    enabled: true,
    runtimePhase: 'active',
  },
  {
    id: 'security-gate',
    name: '@zap/security-gate',
    title: '高危指令安全门禁 (Security Gate)',
    description: '拦截破坏性 Git 回滚、越权文件写入与未知外部副作用操作，拉起人工审批确认门禁。',
    moduleName: '@zap/security-gate/guard',
    scope: 'global',
    enabled: true,
    locked: true,
    lockedReason: '系统安全红线策略要求常驻开启',
    runtimePhase: 'active',
  },
  {
    id: 'js-reverse-cdp',
    name: '@zap/js-reverse-cdp',
    title: '浏览器逆向与调试桥 (JS Reverse CDP)',
    description: '通过 Chrome DevTools Protocol 捕获网络请求、Set-Cookie 溯源、调用栈与断点调试证据。',
    moduleName: '@zap/js-reverse-cdp/inspector',
    scope: 'global',
    enabled: true,
    condition: '仅在连接 CDP 调试目标时激活',
    runtimePhase: 'active',
  },
  {
    id: 'git-webhook-reviewer',
    name: '@zap/git-webhook-reviewer',
    title: 'GitHub Webhook 自动审查 (Git Reviewer)',
    description: '监听仓库 Push / PR 事件并自动拉起 Bugbot 与安全审查子智能体生成双语审查报告。',
    moduleName: '@zap/git-webhook-reviewer/daemon',
    scope: 'global',
    enabled: false,
    runtimePhase: 'unobserved',
  },
];

const DEFAULT_EXTERNAL_PACKAGES: ExternalPluginPackage[] = [
  {
    name: '@deepseek-ai/plugin-mermaid-enhanced',
    title: 'Mermaid 架构图增强渲染器',
    description: '为对话流中的 Mermaid 流程图、时序图与架构图提供交互式缩放、源码对照与高清导出能力。',
    version: '1.4.2',
    author: 'DeepSeek & Zap Official',
    official: true,
    pinnedByDefault: true,
    installed: true,
    enabled: true,
    removable: false,
    updatable: true,
    source: 'builtin:@deepseek-ai/plugin-mermaid-enhanced',
    installDir: '~/.jeikcode/plugins/mermaid-enhanced',
    readmeMarkdown: `### Mermaid 架构图增强渲染器\n\n提供对话内 Mermaid 图表的无级缩放、拖拽平移、亮暗主题自适应以及一键复制 SVG/PNG 能力。\n\n- **视图切换**：支持「图表预览」与「原始代码」一键切换\n- **自适应视口**：自动根据节点密度计算最佳初始缩放比例`,
    versions: ['1.4.2', '1.4.0', '1.3.5'],
    rows: [
      {
        rowId: 'mermaid-renderer',
        title: '交互式图表视口 (Interactive Viewport)',
        description: '接管 Markdown 中的 mermaid 代码块并渲染可缩放画布',
        moduleName: '@deepseek-ai/plugin-mermaid-enhanced/viewport',
        enabled: true,
        phase: 'active',
      },
    ],
  },
  {
    name: '@deepseek-ai/plugin-code-canvas',
    title: 'Canvas 交互式分析画布',
    description: '支持将复杂数据分析、账单审计、架构评审与可视化报表渲染为独立可交互的 React/Preact 画布。',
    version: '2.1.0',
    author: 'DeepSeek & Zap Official',
    official: true,
    pinnedByDefault: true,
    installed: true,
    enabled: true,
    removable: false,
    updatable: true,
    source: 'builtin:@deepseek-ai/plugin-code-canvas',
    installDir: '~/.jeikcode/plugins/code-canvas',
    readmeMarkdown: `### Canvas 交互式分析画布\n\n当智能体产出定量分析、架构矩阵或交互式工具时，在聊天流旁侧展开实时可交互预览画布。`,
    versions: ['2.1.0', '2.0.4'],
    rows: [
      {
        rowId: 'canvas-split-stage',
        title: '右侧分栏预览舞台 (Split Stage)',
        description: '管理 .canvas.tsx 与 HTML 预览面板的实时挂载与状态保持',
        moduleName: '@deepseek-ai/plugin-code-canvas/stage',
        enabled: true,
        phase: 'active',
      },
    ],
  },
  {
    name: '@deepseek-ai/plugin-git-worktree-guard',
    title: 'Git 多工作树并发隔离器',
    description: '在多会话并行编码时自动校验分支污染与未提交变更，提供一键提交、推送与 PR 创建快捷栏。',
    version: '1.2.0',
    author: 'DeepSeek & Zap Official',
    official: true,
    pinnedByDefault: false,
    installed: true,
    enabled: false,
    removable: false,
    updatable: true,
    source: 'builtin:@deepseek-ai/plugin-git-worktree-guard',
    installDir: '~/.jeikcode/plugins/git-worktree-guard',
    readmeMarkdown: `### Git 多工作树并发隔离器\n\n防止多个并发 Agent 会话在同一工作区发生文件覆盖冲突。`,
    versions: ['1.2.0', '1.1.0'],
    rows: [
      {
        rowId: 'worktree-guard',
        title: '并发改动冲突检测 (Conflict Detector)',
        description: '在提交前自动扫描外部会话修改过的文件并提示隔离提交',
        moduleName: '@deepseek-ai/plugin-git-worktree-guard/detector',
        enabled: false,
        phase: 'unobserved',
      },
    ],
  },
];

export const MARKET_CATALOG: MarketListingEntry[] = [
  {
    name: 'dsh-boot-suite',
    title: 'dsh-boot-suite 双幕开机动画与全景壁纸',
    description: '1:1 移植 DeepSeek Harness 官方两幕冷启动动效（档案授权 + 2K 鲸鱼娘睁眼）与毛玻璃聊天室壁纸套件。',
    author: 'Zap Community / LeeRolling',
    category: 'appearance',
    labels: ['featured', 'slot:shell.overlay', 'standalone-plugin'],
    defaultVersion: '1.0.0',
    versions: [
      { version: '1.0.0', publishTimestamp: 1775300000, compatible: true, runtimeRequirement: '>=0.2.0' },
    ],
    repository: 'https://github.com/LeeRolling/dsh-boot-suite',
    registry: 'github:LeeRolling/dsh-boot-suite',
    readmeMarkdown: `### dsh-boot-suite 1:1 双幕开机动效与壁纸套件\n\n- **第一幕**：暖白技术档案认证与准星扫描\n- **第二幕**：2K 鲸鱼娘睁眼扫描短片（whale-girl-scan.mp4）\n- **聊天背景**：全屏毛玻璃与大字横幅\n- **控制台**：输入 \`/boot replay\` 随时重播`,
    contributesSettingsSection: {
      id: 'ext-dsh-boot-suite',
      label: '双幕动效',
      title: 'dsh-boot-suite 开机动画与壁纸',
      description: '配置两幕动效、声音开关与聊天室全景背景图。',
    },
    defaultConfig: {
      playOnLaunch: true,
      enableAudio: true,
      clickToDismiss: true,
      fadeDurationSec: '1',
    },
  },
  {
    name: 'dsh-boot-animation',
    title: 'dsh-boot-animation 开机启动动画与片库',
    description: '打开新对话或每次启动应用时播放一段全窗口开机短片，支持点击跳过、声音开关、淡入淡出及自定义片库。',
    author: 'NativeDog1 / Alice-Marx',
    category: 'appearance',
    labels: ['featured', 'slot:shell.overlay', 'slot:settings.section'],
    defaultVersion: '0.4.2',
    versions: [
      { version: '0.4.2', publishTimestamp: 1775200000, compatible: true, runtimeRequirement: '>=0.2.0' },
      { version: '0.4.0', publishTimestamp: 1774000000, compatible: true, runtimeRequirement: '>=0.2.0' },
    ],
    repository: 'https://github.com/NativeDog1/dsh-boot-animation',
    registry: 'github:NativeDog1/dsh-boot-animation',
    readmeMarkdown: `### dsh-boot-animation 开机动画\n\n给 Zap / DSH 换一段**开机动画**：每次打开应用或新建会话时播放一段全屏片头短片，随后交叉溶解进工作区。\n\n- **全屏铺满窗口**：视效沉浸，支持静音自动播放与点击启用声音\n- **即时跳过**：点击任意区域或按 Esc / 空格 / 回车即可直接进入界面\n- **片库切换**：内置 DeepSeek 品牌、赛博朋克与数字苏醒片头\n- **无侵入接入**：通过 Cordis 微内核 \`shell.overlay\` 插槽无侵入式注入，不改动本体源码`,
    contributesSettingsSection: {
      id: 'ext-dsh-boot-animation',
      label: '开机动画',
      title: 'dsh-boot-animation 开机动画配置',
      description: '配置启动全屏动画播放模式、声音开关、淡入时长与片库选择。',
    },
    configSchema: [
      {
        key: 'playOnLaunch',
        label: '每次打开应用时播放一次',
        description: '开启后每次打开工作台播一次；关闭后仅在新建会话时播一次',
        type: 'boolean',
      },
      {
        key: 'enableAudio',
        label: '开启影片原声音频',
        description: '默认以静音启动（浏览器自动播放安全策略要求），点击画面或该开关可解锁声音',
        type: 'boolean',
      },
      {
        key: 'clickToDismiss',
        label: '点击画面直接跳过进入',
        description: '在播放过程中点击屏幕任意位置或按 Esc 立刻淡入工作台界面',
        type: 'boolean',
      },
      {
        key: 'fadeDurationSec',
        label: '进场淡出溶解时间 (秒)',
        description: '片尾画面交叉溶解进工作区的过渡时长',
        type: 'select',
        options: [
          { label: '1 秒 (极速)', value: '1' },
          { label: '2 秒 (平滑推荐)', value: '2' },
          { label: '3 秒 (影院慢速)', value: '3' },
        ],
      },
      {
        key: 'clipTheme',
        label: '默认播放片头',
        description: '选择开机动画的视觉主题',
        type: 'select',
        options: [
          { label: 'DeepSeek 品牌官方片头 (Cyber Wave)', value: 'brand' },
          { label: 'DeepSeek 赛博朋克流光 (Neon Grid)', value: 'cyber' },
          { label: 'DeepSeek 神经元苏醒 (Neural Awakening)', value: 'neural' },
        ],
      },
    ],
    defaultConfig: {
      playOnLaunch: true,
      enableAudio: false,
      clickToDismiss: true,
      fadeDurationSec: '2',
      clipTheme: 'brand',
    },
  },
  {
    name: '@dsh-community/prompt-vault',
    title: 'Prompt Vault 提示词资产库',
    description: '在设置中心注入专属「提示词库」面板，支持分类管理常用架构指令、系统级角色模板与一键变量替换。',
    author: 'dsh-community',
    category: 'productivity',
    labels: ['featured', 'slot:settings.section'],
    defaultVersion: '1.3.0',
    versions: [
      { version: '1.3.0', publishTimestamp: 1775000000, compatible: true, runtimeRequirement: '>=0.2.0' },
      { version: '1.2.1', publishTimestamp: 1772000000, compatible: true, runtimeRequirement: '>=0.2.0' },
    ],
    repository: 'https://github.com/dsh-community/prompt-vault',
    registry: 'https://registry.npmmirror.com',
    readmeMarkdown: `### Prompt Vault 提示词资产库\n\n安装并启用后，会自动向**设置中心左侧导航栏**注入 \`提示词资产库\` 专属配置页，支持：\n- 自定义高频研发 Prompt 模板\n- 设置快捷键与斜杠指令别名\n- 导入/导出 JSON 团队共享资产库`,
    contributesSettingsSection: {
      id: 'ext-prompt-vault',
      label: '提示词资产库',
      title: 'Prompt Vault 提示词资产库',
      description: '管理可复用的工程指令模板、代码审查清单与自动注入前缀。',
    },
    configSchema: [
      {
        key: 'autoSuggestSlash',
        label: '输入框 / 斜杠自动联想模板',
        description: '在聊天输入框键入 / 时，将资产库中的高频提示词合并到候选列表顶部',
        type: 'boolean',
      },
      {
        key: 'defaultCategory',
        label: '默认展开分类',
        description: '打开提示词面板时默认选中的分组标签',
        type: 'select',
        options: [
          { label: '架构设计与重构', value: 'arch' },
          { label: '代码安全与 Bug 审查', value: 'review' },
          { label: 'SQL 与数据库调优', value: 'sql' },
        ],
      },
      {
        key: 'customPrefix',
        label: '全局附加系统约束前缀',
        description: '可选：在每次发送提示词模板时自动附带的简短规范说明',
        type: 'string',
      },
    ],
    defaultConfig: {
      autoSuggestSlash: true,
      defaultCategory: 'arch',
      customPrefix: '请优先使用 code_explore 梳理全局调用链后再动手修改。',
    },
  },
  {
    name: '@dsh-community/theme-customizer',
    title: 'Appearance Studio 界面字体与紧凑度调优',
    description: '向设置中心注入「界面排版与微调」面板，支持自定义代码字体族、字号缩放、消息气泡间距与毛玻璃模糊度。',
    author: 'dsh-community',
    category: 'appearance',
    labels: ['featured', 'slot:settings.section'],
    defaultVersion: '2.0.1',
    versions: [
      { version: '2.0.1', publishTimestamp: 1776200000, compatible: true, runtimeRequirement: '>=0.2.0' },
      { version: '1.9.0', publishTimestamp: 1771000000, compatible: true, runtimeRequirement: '>=0.2.0' },
    ],
    repository: 'https://github.com/dsh-community/theme-customizer',
    registry: 'https://registry.npmmirror.com',
    readmeMarkdown: `### Appearance Studio 界面排版与微调\n\n通过 Cordis \`styles.insert\` 与 \`settings.section\` 插槽动态调节 WebUI 的字体大小、代码块行高与紧凑布局模式。`,
    contributesSettingsSection: {
      id: 'ext-theme-customizer',
      label: '排版与视觉微调',
      title: 'Appearance Studio 界面排版与微调',
      description: '实时定制工作台代码字体、正文字号缩放与会话列表紧凑度。',
    },
    configSchema: [
      {
        key: 'fontScale',
        label: '全局界面字号缩放',
        description: '调整聊天流与侧边栏的文字显示比例',
        type: 'select',
        options: [
          { label: '95% (紧凑高密度)', value: '95%' },
          { label: '100% (标准默认)', value: '100%' },
          { label: '105% (舒适大字号)', value: '105%' },
          { label: '110% (超大护眼模式)', value: '110%' },
        ],
      },
      {
        key: 'monoFontFamily',
        label: '代码块等宽字体族 (Monospace Font)',
        description: '优先应用于代码块、终端与文件编辑器的等宽字体栈',
        type: 'string',
      },
      {
        key: 'compactSidebar',
        label: '紧凑型侧边栏会话间距',
        description: '减小左侧项目树与会话列表的垂直内边距以展示更多条目',
        type: 'boolean',
      },
    ],
    defaultConfig: {
      fontScale: '100%',
      monoFontFamily: "'JetBrains Mono', 'Cascadia Code', Consolas, monospace",
      compactSidebar: false,
    },
  },
  {
    name: '@dsh-community/context-telemetry',
    title: 'Token & Context Telemetry 上下文监控仪',
    description: '实时统计会话缓存命中率（Cached Tokens）、推理耗时分布与单轮工具调用开销，在设置中心提供详细审计页。',
    author: 'dsh-community',
    category: 'devtools',
    labels: ['featured', 'slot:settings.section'],
    defaultVersion: '1.1.4',
    versions: [
      { version: '1.1.4', publishTimestamp: 1775800000, compatible: true, runtimeRequirement: '>=0.2.0' },
    ],
    repository: 'https://github.com/dsh-community/context-telemetry',
    registry: 'https://registry.npmmirror.com',
    readmeMarkdown: `### Token & Context Telemetry 上下文监控仪\n\n为重度开发者提供精准的 Prompt Cache 命中率监控与上下文膨胀预警阈值设置。`,
    contributesSettingsSection: {
      id: 'ext-context-telemetry',
      label: '上下文与缓存监控',
      title: 'Token & Context Telemetry 监控配置',
      description: '配置上下文预算告警阈值、Prompt Cache 命中率追踪与耗时分析。',
    },
    configSchema: [
      {
        key: 'warnTokenThreshold',
        label: '单会话 Token 预警阈值',
        description: '当单次会话上下文超过该数值时高亮提醒及时收敛或新建会话',
        type: 'number',
      },
      {
        key: 'showCacheHitRatio',
        label: '显示缓存命中率指标',
        description: '在消息底栏 Token 统计旁展示 Cached / Input 百分比',
        type: 'boolean',
      },
    ],
    defaultConfig: {
      warnTokenThreshold: 120000,
      showCacheHitRatio: true,
    },
  },
  {
    name: '@dsh-community/webhook-notifier',
    title: '飞书 / 钉钉 / 企业微信任务完成通知',
    description: '当耗时编译、自动化重构或 /loop 巡检任务完成或遇到审批门禁时，通过 Webhook 推送桌面与移动端提醒。',
    author: 'dsh-community',
    category: 'automation',
    labels: ['slot:settings.section'],
    defaultVersion: '1.0.8',
    versions: [
      { version: '1.0.8', publishTimestamp: 1774100000, compatible: true, runtimeRequirement: '>=0.2.0' },
    ],
    repository: 'https://github.com/dsh-community/webhook-notifier',
    registry: 'https://registry.npmmirror.com',
    readmeMarkdown: `### 飞书 / 钉钉 / 企业微信任务完成通知\n\n支持配置自定义 IM 机器人 Webhook URL，当后台任务结束或需要人工确认时第一时间通知。`,
    contributesSettingsSection: {
      id: 'ext-webhook-notifier',
      label: 'IM 消息推送通知',
      title: 'Webhook 外部消息推送配置',
      description: '当长耗时任务执行完毕或等待人工审批时，推送通知到飞书、钉钉或企业微信。',
    },
    configSchema: [
      {
        key: 'webhookUrl',
        label: '机器人 Webhook 地址',
        description: '填入飞书、钉钉或企业微信群机器人的 HTTPS Webhook URL',
        type: 'string',
      },
      {
        key: 'notifyOnApproval',
        label: '遇到权限审批门禁时立即推送',
        description: '当 Agent 请求高危命令确认或用户输入时发送高优通知',
        type: 'boolean',
      },
    ],
    defaultConfig: {
      webhookUrl: '',
      notifyOnApproval: true,
    },
  },
];

// =============================================================================
// 5. Kernel Implementation
// =============================================================================

type Listener = () => void;

export class ZapPluginKernel {
  private slots: { [K in SlotKey]: Map<string, SlotMap[K]> } = {
    'settings.section': new Map(),
    'settings.action': new Map(),
    'settings.general.item': new Map(),
    'settings.plugins.tab': new Map(),
    'plugins.tab': new Map(),
    'shell.overlay': new Map(),
  };

  private builtinPlugins: BuiltinPluginEntry[] = [];
  private agentPresets: AgentPresetEntry[] = [];
  private externalPackages: ExternalPluginPackage[] = [];
  private shellLimits: ShellExecutorLimits = {
    defaultTimeoutSec: 120,
    maxTimeoutSec: 600,
    maxOutputBytes: 262144,
    autoPromoteLongJobs: true,
    blockInteractiveTui: true,
  };
  private developerToolsEnabled = true;
  private listeners = new Set<Listener>();
  private dynamicDisposers = new Map<string, () => void>();
  private styleElements = new Map<string, HTMLStyleElement>();

  constructor() {
    this.loadPersistedState();
  }

  private loadPersistedState() {
    try {
      const savedBuiltin = localStorage.getItem(STORAGE_KEY_BUILTIN);
      if (savedBuiltin) {
        const parsed = JSON.parse(savedBuiltin) as Record<string, boolean>;
        this.builtinPlugins = DEFAULT_BUILTIN_PLUGINS.map((item) => ({
          ...item,
          enabled: item.locked ? true : (parsed[item.id] ?? item.enabled),
          runtimePhase: (item.locked ? true : (parsed[item.id] ?? item.enabled)) ? 'active' : 'unobserved',
        }));
      } else {
        this.builtinPlugins = [...DEFAULT_BUILTIN_PLUGINS];
      }
    } catch {
      this.builtinPlugins = [...DEFAULT_BUILTIN_PLUGINS];
    }

    try {
      const savedPresets = localStorage.getItem(STORAGE_KEY_PRESETS);
      if (savedPresets) {
        const parsed = JSON.parse(savedPresets) as { defaultId?: string; custom?: AgentPresetEntry[] };
        const defaultId = parsed.defaultId || 'standard';
        const custom = Array.isArray(parsed.custom) ? parsed.custom : [];
        this.agentPresets = [
          ...DEFAULT_AGENT_PRESETS.map((p) => ({ ...p, isDefault: p.id === defaultId })),
          ...custom.map((p) => ({ ...p, isDefault: p.id === defaultId })),
        ];
      } else {
        this.agentPresets = [...DEFAULT_AGENT_PRESETS];
      }
    } catch {
      this.agentPresets = [...DEFAULT_AGENT_PRESETS];
    }

    try {
      const savedPackages = localStorage.getItem(STORAGE_KEY_PACKAGES);
      if (savedPackages) {
        const parsed = JSON.parse(savedPackages) as ExternalPluginPackage[];
        if (Array.isArray(parsed) && parsed.length > 0) {
          const existingNames = new Set(parsed.map((p) => p.name));
          const missingDefaults = DEFAULT_EXTERNAL_PACKAGES.filter((p) => !existingNames.has(p.name));
          this.externalPackages = [...parsed, ...missingDefaults];
        } else {
          this.externalPackages = [...DEFAULT_EXTERNAL_PACKAGES];
        }
      } else {
        this.externalPackages = [...DEFAULT_EXTERNAL_PACKAGES];
      }
    } catch {
      this.externalPackages = [...DEFAULT_EXTERNAL_PACKAGES];
    }

    try {
      const savedLimits = localStorage.getItem(STORAGE_KEY_SHELL_LIMITS);
      if (savedLimits) {
        this.shellLimits = { ...this.shellLimits, ...JSON.parse(savedLimits) };
      }
    } catch {
      /* ignore */
    }

    try {
      const savedDev = localStorage.getItem(STORAGE_KEY_DEV_TOOLS);
      if (savedDev !== null) {
        this.developerToolsEnabled = savedDev === 'true';
      }
    } catch {
      /* ignore */
    }
  }

  private persistBuiltin() {
    try {
      const map: Record<string, boolean> = {};
      for (const item of this.builtinPlugins) {
        map[item.id] = item.enabled;
      }
      localStorage.setItem(STORAGE_KEY_BUILTIN, JSON.stringify(map));
    } catch {
      /* ignore */
    }
  }

  private persistPresets() {
    try {
      const def = this.agentPresets.find((p) => p.isDefault)?.id || 'standard';
      const custom = this.agentPresets.filter((p) => !p.builtIn);
      localStorage.setItem(STORAGE_KEY_PRESETS, JSON.stringify({ defaultId: def, custom }));
    } catch {
      /* ignore */
    }
  }

  private persistPackages() {
    try {
      localStorage.setItem(STORAGE_KEY_PACKAGES, JSON.stringify(this.externalPackages));
    } catch {
      /* ignore */
    }
  }

  public subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  public notify() {
    for (const listener of this.listeners) {
      try {
        listener();
      } catch (err) {
        console.error('[ZapPluginKernel] Listener error:', err);
      }
    }
  }

  // ---------------------------------------------------------------------------
  // Slot Registration & Query API
  // ---------------------------------------------------------------------------

  public registerSlot<K extends SlotKey>(slotName: K, contribution: SlotMap[K]): () => void {
    const map = this.slots[slotName];
    map.set(contribution.id, contribution);
    this.notify();
    return () => {
      if (map.get(contribution.id) === contribution) {
        map.delete(contribution.id);
        this.notify();
      }
    };
  }

  public getSlotEntries<K extends SlotKey>(slotName: K): SlotMap[K][] {
    const list = Array.from(this.slots[slotName].values());
    return list.sort((a, b) => a.order - b.order);
  }

  // ---------------------------------------------------------------------------
  // Dynamic Style & Theme Token Injection (Cordis `styles.insert` equivalent)
  // ---------------------------------------------------------------------------

  public insertStyle(id: string, cssText: string): () => void {
    if (typeof document === 'undefined') return () => {};
    let styleEl = this.styleElements.get(id);
    if (!styleEl) {
      styleEl = document.createElement('style');
      styleEl.setAttribute('data-zap-plugin-style', id);
      document.head.appendChild(styleEl);
      this.styleElements.set(id, styleEl);
    }
    styleEl.textContent = cssText;
    return () => {
      const el = this.styleElements.get(id);
      if (el) {
        el.remove();
        this.styleElements.delete(id);
      }
    };
  }

  // ---------------------------------------------------------------------------
  // Built-in Plugins & Shell Config Management
  // ---------------------------------------------------------------------------

  public getBuiltinPlugins(): BuiltinPluginEntry[] {
    return this.builtinPlugins;
  }

  public setBuiltinPluginEnabled(id: string, enabled: boolean) {
    this.builtinPlugins = this.builtinPlugins.map((item) => {
      if (item.id !== id || item.locked) return item;
      return {
        ...item,
        enabled,
        runtimePhase: enabled ? 'active' : 'unobserved',
      };
    });
    this.persistBuiltin();
    this.notify();
  }

  public enableAllBuiltinPlugins() {
    this.builtinPlugins = this.builtinPlugins.map((item) => ({
      ...item,
      enabled: true,
      runtimePhase: 'active',
    }));
    this.persistBuiltin();
    this.notify();
  }

  public resetBuiltinPluginsToDefault() {
    this.builtinPlugins = [...DEFAULT_BUILTIN_PLUGINS];
    this.persistBuiltin();
    this.notify();
  }

  public getShellLimits(): ShellExecutorLimits {
    return this.shellLimits;
  }

  public updateShellLimits(patch: Partial<ShellExecutorLimits>) {
    this.shellLimits = { ...this.shellLimits, ...patch };
    try {
      localStorage.setItem(STORAGE_KEY_SHELL_LIMITS, JSON.stringify(this.shellLimits));
    } catch {
      /* ignore */
    }
    this.notify();
  }

  public getDeveloperToolsEnabled(): boolean {
    return this.developerToolsEnabled;
  }

  public setDeveloperToolsEnabled(enabled: boolean) {
    this.developerToolsEnabled = enabled;
    try {
      localStorage.setItem(STORAGE_KEY_DEV_TOOLS, String(enabled));
    } catch {
      /* ignore */
    }
    if (!enabled) {
      // Fallback to standard preset if current default requires coding tools
      const currentDefault = this.agentPresets.find((p) => p.isDefault);
      if (currentDefault?.requiresCodingTools) {
        this.setDefaultPreset('standard');
        return;
      }
    }
    this.notify();
  }

  // ---------------------------------------------------------------------------
  // Agent Presets Management
  // ---------------------------------------------------------------------------

  public getAgentPresets(): AgentPresetEntry[] {
    return this.agentPresets;
  }

  public setDefaultPreset(presetId: string) {
    this.agentPresets = this.agentPresets.map((item) => ({
      ...item,
      isDefault: item.id === presetId,
    }));
    this.persistPresets();
    this.notify();
  }

  public addCustomPreset(preset: Omit<AgentPresetEntry, 'builtIn' | 'isDefault'>) {
    const existing = this.agentPresets.some((p) => p.id === preset.id);
    const entry: AgentPresetEntry = {
      ...preset,
      builtIn: false,
      isDefault: false,
    };
    if (existing) {
      this.agentPresets = this.agentPresets.map((p) => (p.id === preset.id ? entry : p));
    } else {
      this.agentPresets = [...this.agentPresets, entry];
    }
    this.persistPresets();
    this.notify();
  }

  // ---------------------------------------------------------------------------
  // External Packages & Market Lifecycle
  // ---------------------------------------------------------------------------

  public getExternalPackages(): ExternalPluginPackage[] {
    return this.externalPackages;
  }

  public setPackageEnabled(packageName: string, enabled: boolean) {
    this.externalPackages = this.externalPackages.map((pkg) => {
      if (pkg.name !== packageName) return pkg;
      return {
        ...pkg,
        enabled,
        rows: pkg.rows.map((r) => ({
          ...r,
          enabled,
          phase: enabled ? 'active' : 'unobserved',
        })),
      };
    });
    this.persistPackages();
    this.syncPackageRuntimeEffects(packageName);
    this.notify();
  }

  public setPackageRowEnabled(packageName: string, rowId: string, enabled: boolean) {
    this.externalPackages = this.externalPackages.map((pkg) => {
      if (pkg.name !== packageName) return pkg;
      const nextRows = pkg.rows.map((r) =>
        r.rowId === rowId ? { ...r, enabled, phase: (enabled ? 'active' : 'unobserved') as PluginRuntimePhase } : r,
      );
      const anyEnabled = nextRows.some((r) => r.enabled);
      return {
        ...pkg,
        enabled: anyEnabled,
        rows: nextRows,
      };
    });
    this.persistPackages();
    this.syncPackageRuntimeEffects(packageName);
    this.notify();
  }

  public updatePackageConfig(packageName: string, key: string, value: any) {
    this.externalPackages = this.externalPackages.map((pkg) => {
      if (pkg.name !== packageName) return pkg;
      return {
        ...pkg,
        configValues: {
          ...(pkg.configValues || {}),
          [key]: value,
        },
      };
    });
    this.persistPackages();
    this.syncPackageRuntimeEffects(packageName);
    this.notify();
  }

  public uninstallPackage(packageName: string) {
    const disposer = this.dynamicDisposers.get(packageName);
    if (disposer) {
      disposer();
      this.dynamicDisposers.delete(packageName);
    }
    if (typeof document !== 'undefined') {
      const cleanId = packageName.replace(/^@/, '').replace(/\//g, '-');
      document.querySelectorAll(`script[src*="${cleanId}"]`).forEach((s) => s.remove());
      if (packageName === 'dsh-boot-suite') {
        document.getElementById('dsh-startup-root')?.remove();
        document.querySelectorAll('.dsu-root, .dsh-wallpaper-container').forEach((el) => el.remove());
        try {
          delete (window as any).__DSH_BOOT_SUITE_API__;
          delete (window as any).__ZAP_BOOT_SUITE_API__;
          delete (window as any).__DSH_STARTUP__;
          delete (window as any).__DSH_STARTUP_API__;
          sessionStorage.removeItem('dsh-boot-animation:played');
        } catch {}
      }
    }
    this.externalPackages = this.externalPackages.filter((pkg) => pkg.name !== packageName || !pkg.removable);
    this.persistPackages();
    this.notify();
  }

  public installPackageFromMarket(entry: MarketListingEntry, chosenVersion?: string): ExternalPluginPackage {
    const version = chosenVersion || entry.defaultVersion;
    const sectionId = entry.contributesSettingsSection?.id;
    const newPkg: ExternalPluginPackage = {
      name: entry.name,
      title: entry.title,
      description: entry.description,
      version,
      author: entry.author,
      official: false,
      installed: true,
      enabled: true,
      removable: true,
      updatable: true,
      source: `registry:${entry.name}@${version}`,
      installDir: `~/.jeikcode/plugins/${entry.name.replace(/^@/, '').replace(/\//g, '-')}`,
      readmeMarkdown: entry.readmeMarkdown,
      versions: entry.versions.map((v) => v.version),
      configSchema: entry.configSchema,
      configValues: { ...(entry.defaultConfig || {}) },
      rows: [
        {
          rowId: `${entry.name.split('/').pop() || 'main'}-core`,
          title: entry.contributesSettingsSection?.title || entry.title,
          description: entry.contributesSettingsSection?.description || entry.description,
          moduleName: `${entry.name}/client`,
          enabled: true,
          phase: 'active',
          hasConfig: Boolean(entry.configSchema && entry.configSchema.length > 0),
          sectionId,
        },
      ],
    };

    const exists = this.externalPackages.some((p) => p.name === entry.name);
    if (exists) {
      this.externalPackages = this.externalPackages.map((p) => (p.name === entry.name ? newPkg : p));
    } else {
      this.externalPackages = [...this.externalPackages, newPkg];
    }
    this.persistPackages();
    this.syncPackageRuntimeEffects(newPkg.name);
    this.notify();
    return newPkg;
  }

  public installCustomSpec(spec: string, customTitle?: string, customDesc?: string): ExternalPluginPackage {
    const trimmed = spec.trim();
    // Check if it matches a market entry first
    const marketMatch = MARKET_CATALOG.find(
      (m) => m.name === trimmed || trimmed.startsWith(`${m.name}@`),
    );
    if (marketMatch) {
      const verPart = trimmed.startsWith(`${marketMatch.name}@`)
        ? trimmed.slice(marketMatch.name.length + 1)
        : undefined;
      return this.installPackageFromMarket(marketMatch, verPart);
    }

    const cleanName = trimmed.replace(/\.(js|mjs|json|tgz|zip)$/i, '');
    const pkgName = cleanName.startsWith('@') || cleanName.includes('/')
      ? cleanName
      : `@user-plugin/${cleanName.toLowerCase().replace(/[^a-z0-9-_]/g, '-')}`;
    const shortId = pkgName.split('/').pop() || 'custom-plugin';
    const sectionId = `ext-${shortId}`;

    const newPkg: ExternalPluginPackage = {
      name: pkgName,
      title: customTitle || `${shortId} 扩展插件`,
      description: customDesc || `通过插件管理中心安装的外部扩展包 (${trimmed})，已在设置中心左侧注入配置槽位。`,
      version: '1.0.0',
      author: 'Local / Custom',
      official: false,
      installed: true,
      enabled: true,
      removable: true,
      updatable: false,
      source: trimmed.startsWith('http') || trimmed.startsWith('git+') ? `git:${trimmed}` : `local:${trimmed}`,
      installDir: `~/.jeikcode/plugins/${shortId}`,
      readmeMarkdown: `### ${customTitle || shortId}\n\n来源规格：\`${trimmed}\`\n\n该插件已通过 Zap Cordis 插件运行时挂载，并在设置中心左侧导航栏注册了专属设置页。`,
      versions: ['1.0.0'],
      configSchema: [
        {
          key: 'autoStart',
          label: '随工作台启动自动挂载',
          description: '在每次打开或刷新 Zap WebUI 时自动执行该插件的 apply(ctx) 生命周期函数',
          type: 'boolean',
        },
        {
          key: 'customEndpoint',
          label: '插件自定义参数 / 端点',
          description: '传递给插件运行时的自定义配置字符串',
          type: 'string',
        },
      ],
      configValues: {
        autoStart: true,
        customEndpoint: '',
      },
      rows: [
        {
          rowId: `${shortId}-entry`,
          title: `${customTitle || shortId} 主模块`,
          description: '向设置中心与工作台提供动态插槽扩展',
          moduleName: `${pkgName}/index.js`,
          enabled: true,
          phase: 'active',
          hasConfig: true,
          sectionId,
        },
      ],
    };

    const exists = this.externalPackages.some((p) => p.name === pkgName);
    if (exists) {
      this.externalPackages = this.externalPackages.map((p) => (p.name === pkgName ? newPkg : p));
    } else {
      this.externalPackages = [...this.externalPackages, newPkg];
    }
    this.persistPackages();
    this.syncPackageRuntimeEffects(newPkg.name);
    this.notify();
    return newPkg;
  }

  public async installPackageWithBackend(
    spec: string,
    customTitle?: string,
    customDesc?: string,
  ): Promise<{ success: boolean; pkg?: ExternalPluginPackage; message: string }> {
    // 1. 本地快速登记
    const localPkg = this.installCustomSpec(spec, customTitle, customDesc);

    // 2. 异步调用后端真实克隆下载 API
    try {
      const resp = await fetch('/api/plugins/install', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ source: spec }),
      });
      const data = await resp.json();
      if (data.success && data.plugin) {
        const updated = this.externalPackages.map((p) => {
          if (p.name === localPkg.name) {
            return {
              ...p,
              title: data.plugin.name || p.title,
              description: data.plugin.description || p.description,
              version: data.plugin.version || p.version,
              installDir: data.plugin.install_path || p.installDir,
              rows: p.rows.map((r) => ({
                ...r,
                moduleName: data.plugin.entry_file ? `${p.name}/${data.plugin.entry_file}` : r.moduleName,
              })),
            };
          }
          return p;
        });
        this.externalPackages = updated;
        this.persistPackages();
        this.syncPackageRuntimeEffects(localPkg.name);
        this.notify();
        return {
          success: true,
          pkg: this.externalPackages.find((p) => p.name === localPkg.name),
          message: data.message,
        };
      } else {
        return { success: false, pkg: localPkg, message: data.message || '后端克隆失败' };
      }
    } catch (err: any) {
      // 离线或无后端网络响应时，保持本地预设启用
      return { success: true, pkg: localPkg, message: '已按本地离线沙箱配置成功载入' };
    }
  }

  public syncAllPackagesRuntimeEffects() {
    for (const pkg of this.externalPackages) {
      this.syncPackageRuntimeEffects(pkg.name);
    }
  }

  private syncPackageRuntimeEffects(packageName: string) {
    const prevDisposer = this.dynamicDisposers.get(packageName);
    if (prevDisposer) {
      prevDisposer();
      this.dynamicDisposers.delete(packageName);
    }

    const pkg = this.externalPackages.find((p) => p.name === packageName);
    if (!pkg || !pkg.enabled) return;

    const cleanups: (() => void)[] = [];

    // Apply appearance customizer CSS if `@dsh-community/theme-customizer` is enabled
    if (pkg.name === '@dsh-community/theme-customizer') {
      const cfg = pkg.configValues || {};
      const fontScale = cfg.fontScale || '100%';
      const monoFont = cfg.monoFontFamily || "'JetBrains Mono', Consolas, monospace";
      const compact = Boolean(cfg.compactSidebar);
      const css = `
        :root {
          font-size: ${fontScale};
          --font-mono: ${monoFont};
        }
        ${compact ? `.session-item, .project-group-header { padding-top: 4px !important; padding-bottom: 4px !important; }` : ''}
      `;
      cleanups.push(this.insertStyle('plugin:theme-customizer', css));
    }

    // Apply boot animation overlay if `dsh-boot-animation` is enabled
    if (pkg.name === 'dsh-boot-animation' || pkg.name.includes('boot-animation')) {
      const cfg = pkg.configValues || {};
      const playOnLaunch = cfg.playOnLaunch !== false;
      let alreadyPlayed = false;
      try {
        alreadyPlayed = sessionStorage.getItem('dsh-boot-animation:played') === '1';
      } catch {
        /* ignore */
      }

      if (playOnLaunch && !alreadyPlayed && !gBootAnimSessionPlayed) {
        const overlayId = `boot-anim-${pkg.name}`;
        let unregSlot: (() => void) | null = null;
        unregSlot = this.registerSlot('shell.overlay', {
          id: overlayId,
          order: 10,
          pluginPackage: pkg.name,
          render: () =>
            h(BootAnimationOverlay, {
              pkg,
              onDismiss: () => {
                gBootAnimSessionPlayed = true;
                if (unregSlot) {
                  unregSlot();
                  unregSlot = null;
                }
              },
            }),
        });
        cleanups.push(() => {
          if (unregSlot) unregSlot();
        });
      }
    }

    // Apply desktop pet overlay if `dsh-pet` or any pet extension package is enabled
    if (
      pkg.name === 'dsh-pet' ||
      pkg.name === '@user-plugin/dsh-pet' ||
      pkg.name.includes('pet')
    ) {
      const overlayId = `pet-widget-${pkg.name}`;
      const unreg = this.registerSlot('shell.overlay', {
        id: overlayId,
        order: 20,
        pluginPackage: pkg.name,
        render: () => h(PetCompanionOverlay, { pkg }),
      });
      cleanups.push(unreg);
    }

    // Attempt to dynamically load plugin bundle script if present
    const cleanId = pkg.name.replace(/^@/, '').replace(/\//g, '-');
    const scriptUrl = `/api/plugins/assets/${cleanId}/lib/index.js`;
    const scriptEl = document.createElement('script');
    scriptEl.type = 'module';
    scriptEl.src = scriptUrl;
    scriptEl.onerror = () => {
      // 外部脚本未找到时无需阻断，插槽已具备自愈沙箱适配
      scriptEl.remove();
    };
    document.head.appendChild(scriptEl);
    cleanups.push(() => scriptEl.remove());

    this.dynamicDisposers.set(packageName, () => {
      for (const fn of cleanups) fn();
    });
  }
}

export const zapPluginKernel = new ZapPluginKernel();

// =============================================================================
// 5. dsh-boot-animation 客户端插槽全屏开机动画组件
// =============================================================================

let gBootAnimSessionPlayed = false;

function BootAnimationOverlay({
  pkg,
  onDismiss,
}: {
  pkg: ExternalPluginPackage;
  onDismiss: () => void;
}) {
  const cfg = pkg.configValues || {};
  const [visible, setVisible] = useState(() => {
    if (gBootAnimSessionPlayed) return false;
    try {
      if (sessionStorage.getItem('dsh-boot-animation:played') === '1') {
        gBootAnimSessionPlayed = true;
        return false;
      }
    } catch {
      /* ignore */
    }
    return true;
  });
  const [fading, setFading] = useState(false);
  const [progress, setProgress] = useState(15);
  const dismissedRef = useRef(false);

  const triggerDismiss = () => {
    if (dismissedRef.current) return;
    dismissedRef.current = true;
    setFading(true);
    gBootAnimSessionPlayed = true;
    try {
      sessionStorage.setItem('dsh-boot-animation:played', '1');
    } catch {
      /* ignore */
    }
    const fadeSec = Number(cfg.fadeDurationSec) || 1;
    setTimeout(() => {
      setVisible(false);
      onDismiss();
    }, Math.min(600, Math.max(150, fadeSec * 250)));
  };

  useEffect(() => {
    if (!visible) {
      onDismiss();
      return;
    }

    const progressTimer = setInterval(() => {
      setProgress((p) => {
        if (p >= 100) {
          clearInterval(progressTimer);
          return 100;
        }
        const delta = Math.random() * 20 + 12;
        const next = Math.min(100, Math.floor(p + delta));
        if (next >= 100) {
          setTimeout(triggerDismiss, 200);
        }
        return next;
      });
    }, 160);

    const fadeTimer = setTimeout(() => {
      triggerDismiss();
    }, 3200);

    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' || e.key === ' ' || e.key === 'Enter') {
        triggerDismiss();
      }
    };
    window.addEventListener('keydown', handleKey);

    return () => {
      clearInterval(progressTimer);
      clearTimeout(fadeTimer);
      window.removeEventListener('keydown', handleKey);
    };
  }, [visible]);

  if (!visible) return null;

  return h(
    'div',
    {
      class: `dsh-boot-anim-overlay ${fading ? 'is-fading' : ''}`,
      onClick: () => {
        if (cfg.clickToDismiss !== false) triggerDismiss();
      },
    },
    h('div', { class: 'dsh-boot-anim-backdrop' }),
    h(
      'div',
      { class: 'dsh-boot-anim-center-stage' },
      h('div', { class: 'dsh-boot-anim-pulse-halo' }),
      h(
        'div',
        { class: 'dsh-boot-anim-logo-badge' },
        h(
          'svg',
          { width: 68, height: 68, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 1.6 },
          h('path', { d: 'M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5', stroke: '#38bdf8' }),
        ),
      ),
      h('div', { class: 'dsh-boot-anim-brand-title' }, 'DEEPSEEK HARNESS'),
      h('div', { class: 'dsh-boot-anim-kernel-subtitle' }, 'CORDIS KERNEL // SYSTEM INITIALIZING'),
    ),
    h(
      'div',
      { class: 'dsh-boot-anim-footer' },
      h(
        'div',
        { class: 'dsh-boot-anim-progress-track' },
        h('div', { class: 'dsh-boot-anim-progress-fill', style: { width: `${progress}%` } }),
      ),
      h(
        'div',
        { class: 'dsh-boot-anim-status-row' },
        h(
          'span',
          { class: 'dsh-boot-anim-status-text' },
          progress < 100 ? `正在加载内核插槽与环境资产... ${progress}%` : '内核已就绪，正在呈现工作区...',
        ),
        h('span', { class: 'dsh-boot-anim-skip-hint' }, '点击任意区域或按 [Esc] 跳过'),
      ),
    ),
  );
}

// =============================================================================
// 6. dsh-pet 客户端桌面伴侣与桌宠挂件组件（支持官方透明 WebM 视频动效）
// =============================================================================

const PET_QUOTES = [
  '小鲸鱼一直在陪你写代码哦~ 🐳',
  '代码写得真棒！今天也是高效的一天！✨',
  '遇到 Bug 别慌，深呼吸一下再看看日志~ 💡',
  'DeepSeek 模型正在施展魔法推理中...',
  '累了的话记得喝口水休息一下哦 (oﾟ▽ﾟ)o',
];

const PET_IDLE_ACTIONS = [
  '东张西望.webm',
  '原地小憩沉眠.webm',
  '原地漂浮踏步.webm',
];

const PET_PAT_ACTIONS = [
  '原地敲击桌面互动.webm',
  '原地专心玩魔方.webm',
  '可爱宅舞.webm',
  '吃Token.webm',
  '三球抛接.webm',
];

function PetCompanionOverlay({ pkg }: { pkg: ExternalPluginPackage }) {
  const [pos, setPos] = useState(() => {
    try {
      const saved = localStorage.getItem('dsh-pet:position');
      if (saved) return JSON.parse(saved);
    } catch {
      /* ignore */
    }
    const defX = typeof window !== 'undefined' ? Math.max(20, window.innerWidth - 150) : 900;
    const defY = typeof window !== 'undefined' ? Math.max(20, window.innerHeight - 170) : 600;
    return { x: defX, y: defY };
  });

  const [affinity, setAffinity] = useState(() => {
    try {
      return Number(localStorage.getItem('dsh-pet:affinity')) || 99;
    } catch {
      return 99;
    }
  });

  const [patting, setPatting] = useState(false);
  const [hidden, setHidden] = useState(false);
  const [quote, setQuote] = useState('小鲸鱼一直在陪你写代码哦~ 🐳');
  const [showBubble, setShowBubble] = useState(true);

  // 官方 WebM 动效支持
  const [currentAction, setCurrentAction] = useState('东张西望.webm');
  const [isPlayingCustomAction, setIsPlayingCustomAction] = useState(false);
  const [videoFailed, setVideoFailed] = useState(false);
  const videoRef = useRef<HTMLVideoElement | null>(null);

  const draggingRef = useRef(false);
  const offsetRef = useRef({ x: 0, y: 0 });

  useEffect(() => {
    const bubbleTimer = setInterval(() => {
      const randomQuote = PET_QUOTES[Math.floor(Math.random() * PET_QUOTES.length)];
      setQuote(randomQuote);
      setShowBubble(true);
      setTimeout(() => setShowBubble(false), 5000);
    }, 16000);

    return () => clearInterval(bubbleTimer);
  }, []);

  const handleMouseDown = (e: MouseEvent) => {
    if ((e.target as HTMLElement).closest('.dsh-pet-btn')) return;
    draggingRef.current = true;
    offsetRef.current = {
      x: e.clientX - pos.x,
      y: e.clientY - pos.y,
    };

    const handleMouseMove = (moveEvent: MouseEvent) => {
      if (!draggingRef.current) return;
      const newX = Math.max(10, Math.min(window.innerWidth - 120, moveEvent.clientX - offsetRef.current.x));
      const newY = Math.max(10, Math.min(window.innerHeight - 120, moveEvent.clientY - offsetRef.current.y));
      setPos({ x: newX, y: newY });
    };

    const handleMouseUp = () => {
      if (draggingRef.current) {
        draggingRef.current = false;
        try {
          localStorage.setItem('dsh-pet:position', JSON.stringify(pos));
        } catch {
          /* ignore */
        }
      }
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };

    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);
  };

  const handlePat = () => {
    setPatting(true);
    const newAffinity = affinity + 1;
    setAffinity(newAffinity);
    try {
      localStorage.setItem('dsh-pet:affinity', String(newAffinity));
    } catch {
      /* ignore */
    }

    // 随机播放互动动效（魔方、宅舞、吃Token、三球抛接等）
    const nextAction = PET_PAT_ACTIONS[Math.floor(Math.random() * PET_PAT_ACTIONS.length)];
    setCurrentAction(nextAction);
    setIsPlayingCustomAction(true);
    if (videoRef.current) {
      videoRef.current.currentTime = 0;
      videoRef.current.play().catch(() => {});
    }

    setQuote(`摸摸头！好感度 +1（当前: ${newAffinity}）(oﾟ▽ﾟ)o`);
    setShowBubble(true);
    setTimeout(() => setPatting(false), 450);
  };

  const handleVideoEnded = () => {
    if (isPlayingCustomAction) {
      setIsPlayingCustomAction(false);
      // 动作结束恢复待机状态
      const idleAction = PET_IDLE_ACTIONS[Math.floor(Math.random() * PET_IDLE_ACTIONS.length)];
      setCurrentAction(idleAction);
    }
  };

  const handleResetPos = () => {
    const defX = window.innerWidth - 150;
    const defY = window.innerHeight - 170;
    const newPos = { x: defX, y: defY };
    setPos(newPos);
    try {
      localStorage.setItem('dsh-pet:position', JSON.stringify(newPos));
    } catch {
      /* ignore */
    }
  };

  if (hidden) return null;

  const videoUrl = `/api/plugins/assets/dsh-pet/assets/webm/${encodeURIComponent(currentAction)}`;

  return h(
    'div',
    {
      class: 'dsh-pet-widget',
      style: {
        left: `${pos.x}px`,
        top: `${pos.y}px`,
      },
      onMouseDown: handleMouseDown,
    },
    showBubble ? h('div', { class: 'dsh-pet-bubble' }, quote) : null,
    h(
      'div',
      {
        class: `dsh-pet-body ${patting ? 'is-patting' : ''}`,
        onClick: handlePat,
        title: `DeepSeek 官方开源桌面伴侣 (dsh-pet) · 好感度 ${affinity}（点击互动 / 按住拖拽）`,
      },
      !videoFailed
        ? h('video', {
            ref: videoRef,
            class: 'dsh-pet-video',
            src: videoUrl,
            autoPlay: true,
            loop: !isPlayingCustomAction,
            muted: true,
            playsInline: true,
            onEnded: handleVideoEnded,
            onError: () => setVideoFailed(true),
          })
        : h(
            'svg',
            { width: 84, height: 84, viewBox: '0 0 100 100', fill: 'none' },
            h('circle', { cx: 50, cy: 50, r: 42, fill: 'rgba(14, 165, 233, 0.12)' }),
            h('path', {
              d: 'M25 58 C25 40, 42 28, 65 30 C78 31, 88 40, 88 52 C88 66, 74 74, 52 74 C36 74, 25 68, 25 58 Z',
              fill: '#0284c7',
            }),
            h('path', {
              d: 'M32 60 C32 48, 45 42, 60 44 C72 45, 80 52, 80 58 C80 66, 70 70, 52 70 C40 70, 32 66, 32 60 Z',
              fill: '#38bdf8',
              opacity: 0.85,
            }),
            h('path', {
              d: 'M26 56 C20 50, 12 46, 10 52 C12 56, 18 58, 22 60 C18 64, 12 66, 10 70 C14 74, 20 68, 26 62 Z',
              fill: '#0284c7',
            }),
            h('path', {
              d: 'M48 64 C52 70, 60 72, 62 66 C58 64, 52 63, 48 64 Z',
              fill: '#0369a1',
            }),
            h('circle', { cx: 72, cy: 46, r: 4, fill: '#0f172a' }),
            h('circle', { cx: 73.5, cy: 44.5, r: 1.5, fill: '#ffffff' }),
            h('ellipse', { cx: 68, cy: 52, rx: 3, ry: 1.8, fill: '#f43f5e', opacity: 0.65 }),
            h('path', { d: 'M76 50 Q78 52 80 50', stroke: '#0f172a', strokeWidth: 1.4, fill: 'none' }),
            h('circle', { cx: 54, cy: 22, r: 2.5, fill: '#38bdf8' }),
            h('circle', { cx: 58, cy: 16, r: 3.5, fill: '#38bdf8' }),
            h('circle', { cx: 63, cy: 23, r: 2, fill: '#38bdf8' }),
          ),
    ),
    h(
      'div',
      { class: 'dsh-pet-controls' },
      h('button', { class: 'dsh-pet-btn', onClick: handlePat }, '互动'),
      h('button', { class: 'dsh-pet-btn', onClick: handleResetPos }, '复位'),
      h('button', { class: 'dsh-pet-btn', onClick: () => setHidden(true) }, '隐藏'),
    ),
  );
}

// Expose global runtime hook for external user scripts
if (typeof window !== 'undefined') {
  (window as any).__ZAP_PLUGIN_KERNEL__ = zapPluginKernel;
}
