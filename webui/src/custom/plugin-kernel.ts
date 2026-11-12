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
import { fetchFsRead } from '../api';

// =============================================================================
// 0. Generic Contribution System & Standard Host SDK (DSH / Cordis Aligned)
// =============================================================================

export interface ActionContribution<TContext = any> {
  id: string;
  order: number;
  title: string;
  icon?: string | ComponentChildren;
  pluginPackage?: string;
  when?: (ctx: TContext) => boolean;
  execute: (ctx: TContext, host: ZapHostSDK) => void | Promise<void>;
  render?: (props: { ctx: TContext; host: ZapHostSDK; action: ActionContribution<TContext> }) => ComponentChildren;
}

export type ActionScope =
  | 'chat.message:actions'
  | 'chat.turn:actions'
  | 'chat.input:actions'
  | 'chat.selection:actions'
  | string;

export interface InspectorContribution<TTarget = any> {
  id: string;
  title: string;
  icon?: string | ComponentChildren;
  order?: number;
  pluginPackage?: string;
  supports?: (target: TTarget) => boolean;
  render: (props: { target: TTarget; onClose: () => void; host: ZapHostSDK }) => ComponentChildren;
}

export type InspectorScope =
  | 'chat.turn:inspectors'
  | 'chat.message:inspectors'
  | 'workbench:inspectors'
  | string;

export interface ZapHostSDK {
  session: {
    getActiveSessionId(): string | null;
    create(options?: { prefillPrompt?: string; autoSend?: boolean }): Promise<string | null>;
    rollback(turnIndex: number, options?: { promptOverride?: string }): Promise<void>;
    send(text: string): Promise<void>;
  };
  history: {
    getTurn(turnIndex: number): Promise<any | null>;
    getRawPrompt(turnIndex: number): Promise<{ system: string; user: string } | null>;
  };
  storage: {
    get<T = any>(key: string): Promise<T | null>;
    set<T = any>(key: string, value: T): Promise<void>;
    delete(key: string): Promise<void>;
  };
  ui: {
    toast(message: string, type?: 'info' | 'success' | 'warn' | 'error'): void;
    copy(text: string): Promise<boolean>;
    openInspector(inspectorId: string, targetPayload: any, scope?: InspectorScope): void;
    closeInspector(): void;
  };
  events: {
    on(event: string, handler: (data: any) => void): () => void;
    emit(event: string, data?: any): void;
  };
}

export interface ZapHostDriver {
  getActiveSessionId?: () => string | null;
  createSession?: (options?: { prefillPrompt?: string; autoSend?: boolean }) => Promise<string | null>;
  rollbackTurn?: (turnIndex: number, options?: { promptOverride?: string }) => Promise<void>;
  sendMessage?: (text: string) => Promise<void>;
  getTurnSnapshot?: (turnIndex: number) => Promise<any | null>;
  getRawPromptSnapshot?: (turnIndex: number) => Promise<{ system: string; user: string } | null>;
  showToast?: (message: string, type?: 'info' | 'success' | 'warn' | 'error') => void;
  copyText?: (text: string) => Promise<boolean>;
}

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

export interface SidebarNavContribution {
  id: string;
  order: number;
  label: string;
  icon?: ComponentChildren;
  badge?: string | number;
  active?: boolean;
  pluginPackage?: string;
  viewId?: string;
  onClick?: () => void;
  render?: () => ComponentChildren;
}

export interface WorkbenchViewContribution {
  id: string;
  order: number;
  title: string;
  icon?: ComponentChildren;
  pluginPackage?: string;
  type?: 'component' | 'iframe';
  src?: string;
  render?: () => ComponentChildren;
}

export interface SlotMap {
  'settings.section': SettingsSectionContribution;
  'settings.action': SettingsActionContribution;
  'settings.general.item': SettingsGeneralItemContribution;
  'settings.plugins.tab': SettingsPluginsTabContribution;
  'plugins.tab': PluginsManagerTabContribution;
  'shell.overlay': ShellOverlayContribution;
  'sidebar.nav': SidebarNavContribution;
  'workbench.view': WorkbenchViewContribution;
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
    default?: any;
    options?: { label: string; value: string }[];
  }[];
  contributesSidebarNav?: {
    id?: string;
    label: string;
    badge?: string | number;
    order?: number;
    viewId?: string;
    eventName?: string;
    sectionId?: string;
  };
  contributesWorkbenchView?: {
    id: string;
    title?: string;
    order?: number;
    type?: 'component' | 'iframe';
    src?: string;
  };
  contributesSettingsSection?: {
    id: string;
    label: string;
    title?: string;
    description?: string;
  };
  entry?: string;
  entryDir?: string;
}

export interface ZapPluginManifest {
  id: string;
  name: string;
  version: string;
  title?: string;
  description?: string;
  author?: string;
  icon?: string;
  entry?: string;
  contributes?: {
    sidebarNav?: {
      id?: string;
      label: string;
      badge?: string | number;
      order?: number;
      viewId?: string;
      sectionId?: string;
      eventName?: string;
    };
    workbenchView?: {
      id: string;
      title?: string;
      order?: number;
      type?: 'iframe' | 'component';
      src?: string;
    };
    settingsSection?: {
      id?: string;
      label: string;
      title?: string;
      description?: string;
      schema?: {
        key: string;
        label: string;
        description?: string;
        type: 'boolean' | 'string' | 'number' | 'select';
        options?: { label: string; value: string }[];
        default?: any;
      }[];
    };
  };
  defaultConfig?: Record<string, any>;
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
  {
    id: 'glass-theme',
    name: '@zap/glass-theme',
    title: '苹果毛玻璃与透明度定制 (Apple Glass & Opacity)',
    description: '提供全景苹果液态毛玻璃视觉、工作台侧边栏/卡片透明度无级调节、高斯模糊度与壁纸光晕控制。',
    moduleName: '@zap/glass-theme/suite',
    scope: 'global',
    enabled: true,
    runtimePhase: 'active',
    configTabId: 'glass-theme-config',
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
    installDir: '~/.zap/plugins/mermaid-enhanced',
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
    installDir: '~/.zap/plugins/code-canvas',
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
    installDir: '~/.zap/plugins/git-worktree-guard',
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
  {
    name: '@dsh-community/pet',
    title: '桌宠伴侣 (Desktop Pet)',
    description: '基于透明 WebM 骨骼动效与物理引擎的萌系伴侣宠，感知 AI 推理与打字状态，支持自由拖拽抛掷、投喂白饭互动、趣味碎碎念。',
    version: '0.4.7',
    author: 'PC2005-cloud & Zap Team',
    official: false,
    pinnedByDefault: true,
    installed: true,
    enabled: true,
    removable: true,
    updatable: false,
    source: 'local:D:/插件/dsh-pet',
    installDir: 'D:/插件/dsh-pet',
    entry: 'dist/entry.js',
    entryDir: 'D:/插件/dsh-pet',
    readmeMarkdown: `### 桌宠伴侣 (Desktop Pet)\n\n基于透明 WebM 骨骼动效与物理引擎的萌系伴侣宠，感知 AI 推理与打字状态，支持自由拖拽抛掷、投喂白饭互动、趣味碎碎念。\n\n- **智能状态感知**：AI 编写代码时桌宠同步敲键盘，完工时雀跃庆祝\n- **全自由拖拽抛掷**：具备重力、反弹与挤压弹性\n- **右键动作直通**：投喂白饭、玩魔方、宅舞、睡觉一键切换`,
    versions: ['0.4.7'],
    contributesSidebarNav: {
      id: 'sidebar-nav-dsh-pet',
      label: '桌宠互动',
      badge: 'PET',
      order: 55,
      eventName: 'zap:toggle-pet-drawer',
    },
    contributesSettingsSection: {
      id: 'ext-dsh-pet',
      label: '桌宠伴侣',
      title: '桌宠伴侣设置',
      description: '自定义桌宠大小、互动频率、音效与物理拖拽特性。',
    },
    configSchema: [
      {
        key: 'petScale',
        label: '桌宠缩放比例',
        description: '调整桌宠显示大小（0.5 ~ 1.5，默认 1.0）',
        type: 'string',
        default: '1.0',
      },
      {
        key: 'soundEnabled',
        label: '点击与动作音效',
        description: '开启后点击或特定动作触发可爱音效',
        type: 'boolean',
        default: true,
      },
      {
        key: 'physicsEnabled',
        label: '窗口边缘碰撞与重力抛掷',
        description: '开启后拖拽扔出桌宠具备物理惯性与屏幕反弹',
        type: 'boolean',
        default: true,
      },
      {
        key: 'whisperEnabled',
        label: '定时碎碎念与气泡',
        description: '桌宠在闲置时随机展示趣味碎碎念气泡',
        type: 'boolean',
        default: true,
      },
    ],
    configValues: {
      petScale: '1.0',
      soundEnabled: true,
      physicsEnabled: true,
      whisperEnabled: true,
    },
    rows: [
      {
        rowId: 'pet-companion',
        title: '透明动画舞台与物理引擎 (Stage & Physics)',
        description: '在界面层挂载 60fps 透明 WebM 伴侣宠与鼠标碰撞物理系统',
        moduleName: '@dsh-community/pet/companion',
        enabled: true,
        phase: 'active',
      },
    ],
  },
];

export const MARKET_CATALOG: MarketListingEntry[] = [
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
  {
    name: '@dsh-community/pet',
    title: '桌宠伴侣 (Desktop Pet)',
    description: '基于透明 WebM 骨骼动效与物理引擎的萌系伴侣宠，感知 AI 推理与打字状态，支持自由拖拽抛掷、投喂白饭互动、趣味碎碎念。',
    author: 'PC2005-cloud & Zap Team',
    category: 'appearance',
    labels: ['featured', 'companion', 'slot:sidebar.nav', 'slot:settings.section'],
    defaultVersion: '0.4.7',
    versions: [
      { version: '0.4.7', publishTimestamp: 1776000000, compatible: true, runtimeRequirement: '>=0.2.0' },
    ],
    repository: 'https://github.com/PC2005-cloud/dsh-pet',
    registry: 'https://registry.npmmirror.com',
    readmeMarkdown: `### 桌宠伴侣 (Desktop Pet)\n\n基于透明 WebM 骨骼动效与物理引擎的萌系伴侣宠，感知 AI 推理与打字状态，支持自由拖拽抛掷、投喂白饭互动、趣味碎碎念。\n\n- **智能状态感知**：AI 编写代码时桌宠同步敲键盘，完工时雀跃庆祝\n- **全自由拖拽抛掷**：具备重力、反弹与挤压弹性\n- **右键动作直通**：投喂白饭、玩魔方、宅舞、睡觉一键切换`,
    contributesSettingsSection: {
      id: 'ext-dsh-pet',
      label: '桌宠伴侣',
      title: '桌宠伴侣设置',
      description: '自定义桌宠大小、互动频率、音效与物理拖拽特性。',
    },
    configSchema: [
      {
        key: 'petScale',
        label: '桌宠缩放比例',
        description: '调整桌宠显示大小（0.5 ~ 1.5，默认 1.0）',
        type: 'string',
        default: '1.0',
      },
      {
        key: 'soundEnabled',
        label: '点击与动作音效',
        description: '开启后点击或特定动作触发可爱音效',
        type: 'boolean',
        default: true,
      },
      {
        key: 'physicsEnabled',
        label: '窗口边缘碰撞与重力抛掷',
        description: '开启后拖拽扔出桌宠具备物理惯性与屏幕反弹',
        type: 'boolean',
        default: true,
      },
      {
        key: 'whisperEnabled',
        label: '定时碎碎念与气泡',
        description: '桌宠在闲置时随机展示趣味碎碎念气泡',
        type: 'boolean',
        default: true,
      },
    ],
    defaultConfig: {
      petScale: '1.0',
      soundEnabled: true,
      physicsEnabled: true,
      whisperEnabled: true,
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
    'sidebar.nav': new Map(),
    'workbench.view': new Map(),
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
  // 单调递增的内核版本号：订阅方在挂载时比对，补偿「渲染→订阅」之间错过的变更通知
  private version = 0;
  private dynamicDisposers = new Map<string, () => void>();
  // 每个插件包的运行时同步代际，用于作废停用/重同步之前发起的异步脚本加载
  private runtimeGenerations = new Map<string, number>();
  private styleElements = new Map<string, HTMLStyleElement>();

  // Generic Extension Registries (DSH / Cordis Action & Inspector models)
  private actionRegistries = new Map<string, Map<string, ActionContribution>>();
  private inspectorRegistries = new Map<string, Map<string, InspectorContribution>>();
  private activeInspectorState: { scope: string; id: string; target: any } | null = null;
  private hostDriver: ZapHostDriver = {};
  private hostEventListeners = new Map<string, Set<(data: any) => void>>();
  public readonly hostSDK: ZapHostSDK;

  constructor() {
    this.hostSDK = this.createHostSDK();
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

    // 清理可能遗留的孤儿插件（当壁纸/桌宠插件未启用或已被卸载时）
    if (typeof document !== 'undefined') {
      const hasWallpaper = this.externalPackages.some((p) => p.name.includes('wallpaper') && p.enabled);
      if (!hasWallpaper) {
        const bg = document.getElementById('zap-wallpaper-bg-container');
        if (bg) {
          const v = bg.querySelector('video') as HTMLVideoElement | null;
          if (v) { v.pause(); v.src = ''; }
          bg.remove();
        }
        document.getElementById('zap-wallpaper-drawer')?.remove();
        document.getElementById('zap-wallpaper-injected-styles')?.remove();
        if (typeof window !== 'undefined') {
          (window as any).__ZAP_WALLPAPER_ENGINE_INITIALIZED__ = false;
        }
      }

      const hasPet = this.externalPackages.some((p) => p.name.includes('pet') && p.enabled);
      if (!hasPet) {
        document.getElementById('zap-pet-companion-container')?.remove();
        document.getElementById('zap-pet-injected-styles')?.remove();
        document.getElementById('zap-pet-drawer')?.remove();
        if (typeof window !== 'undefined') {
          (window as any).__ZAP_PET_INITIALIZED__ = false;
        }
      }
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

  public getVersion(): number {
    return this.version;
  }

  public notify() {
    this.version += 1;
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
  // Generic Action Provider API (DSH `actions.register` Aligned)
  // ---------------------------------------------------------------------------

  public registerAction<TContext = any>(
    scope: ActionScope,
    action: ActionContribution<TContext>,
  ): () => void {
    let registry = this.actionRegistries.get(scope);
    if (!registry) {
      registry = new Map();
      this.actionRegistries.set(scope, registry);
    }
    registry.set(action.id, action);
    this.notify();
    return () => {
      const reg = this.actionRegistries.get(scope);
      if (reg && reg.get(action.id) === action) {
        reg.delete(action.id);
        this.notify();
      }
    };
  }

  public getActions<TContext = any>(
    scope: ActionScope,
    context?: TContext,
  ): ActionContribution<TContext>[] {
    const registry = this.actionRegistries.get(scope);
    if (!registry) return [];
    const list = Array.from(registry.values()) as ActionContribution<TContext>[];
    const filtered = context !== undefined
      ? list.filter((act) => !act.when || act.when(context))
      : list;
    return filtered.sort((a, b) => a.order - b.order);
  }

  // ---------------------------------------------------------------------------
  // Generic Inspector & View Drawer API (DSH `inspectors.register` Aligned)
  // ---------------------------------------------------------------------------

  public registerInspector<TTarget = any>(
    scope: InspectorScope,
    inspector: InspectorContribution<TTarget>,
  ): () => void {
    let registry = this.inspectorRegistries.get(scope);
    if (!registry) {
      registry = new Map();
      this.inspectorRegistries.set(scope, registry);
    }
    registry.set(inspector.id, inspector);
    this.notify();
    return () => {
      const reg = this.inspectorRegistries.get(scope);
      if (reg && reg.get(inspector.id) === inspector) {
        reg.delete(inspector.id);
        if (this.activeInspectorState?.id === inspector.id) {
          this.activeInspectorState = null;
        }
        this.notify();
      }
    };
  }

  public getInspectors<TTarget = any>(
    scope: InspectorScope,
    target?: TTarget,
  ): InspectorContribution<TTarget>[] {
    const registry = this.inspectorRegistries.get(scope);
    if (!registry) return [];
    const list = Array.from(registry.values()) as InspectorContribution<TTarget>[];
    const filtered = target !== undefined
      ? list.filter((ins) => !ins.supports || ins.supports(target))
      : list;
    return filtered.sort((a, b) => (a.order ?? 50) - (b.order ?? 50));
  }

  public openInspector(inspectorId: string, targetPayload: any, scope: InspectorScope = 'chat.turn:inspectors') {
    const registry = this.inspectorRegistries.get(scope);
    const item = registry?.get(inspectorId);
    if (!item) {
      console.warn(`[ZapPluginKernel] Inspector "${inspectorId}" not found in scope "${scope}"`);
      return;
    }
    this.activeInspectorState = { scope, id: inspectorId, target: targetPayload };
    this.notify();
  }

  public closeInspector() {
    if (this.activeInspectorState) {
      this.activeInspectorState = null;
      this.notify();
    }
  }

  public getActiveInspector(): {
    scope: string;
    id: string;
    target: any;
    inspector: InspectorContribution;
  } | null {
    if (!this.activeInspectorState) return null;
    const { scope, id, target } = this.activeInspectorState;
    const reg = this.inspectorRegistries.get(scope);
    const inspector = reg?.get(id);
    if (!inspector) return null;
    return { scope, id, target, inspector };
  }

  // ---------------------------------------------------------------------------
  // Host Driver Binding & Standard Host SDK
  // ---------------------------------------------------------------------------

  public bindHostDriver(driver: Partial<ZapHostDriver>) {
    this.hostDriver = { ...this.hostDriver, ...driver };
  }

  private createHostSDK(): ZapHostSDK {
    const self = this;
    return {
      session: {
        getActiveSessionId: () => self.hostDriver.getActiveSessionId?.() ?? null,
        create: async (options) => {
          if (self.hostDriver.createSession) {
            return await self.hostDriver.createSession(options);
          }
          console.warn('[ZapHostSDK] createSession handler is not bound yet');
          return null;
        },
        rollback: async (turnIndex, options) => {
          if (self.hostDriver.rollbackTurn) {
            await self.hostDriver.rollbackTurn(turnIndex, options);
            return;
          }
          console.warn('[ZapHostSDK] rollbackTurn handler is not bound yet');
        },
        send: async (text) => {
          if (self.hostDriver.sendMessage) {
            await self.hostDriver.sendMessage(text);
            return;
          }
          console.warn('[ZapHostSDK] sendMessage handler is not bound yet');
        },
      },
      history: {
        getTurn: async (turnIndex) => {
          if (self.hostDriver.getTurnSnapshot) {
            return await self.hostDriver.getTurnSnapshot(turnIndex);
          }
          return null;
        },
        getRawPrompt: async (turnIndex) => {
          if (self.hostDriver.getRawPromptSnapshot) {
            return await self.hostDriver.getRawPromptSnapshot(turnIndex);
          }
          return null;
        },
      },
      storage: {
        get: async <T = any>(key: string): Promise<T | null> => {
          try {
            const raw = localStorage.getItem(`zap.plugin_storage.${key}`);
            return raw ? JSON.parse(raw) : null;
          } catch {
            return null;
          }
        },
        set: async <T = any>(key: string, value: T): Promise<void> => {
          try {
            localStorage.setItem(`zap.plugin_storage.${key}`, JSON.stringify(value));
          } catch (e) {
            console.error('[ZapHostSDK] storage set error:', e);
          }
        },
        delete: async (key: string): Promise<void> => {
          try {
            localStorage.removeItem(`zap.plugin_storage.${key}`);
          } catch {
            /* ignore */
          }
        },
      },
      ui: {
        toast: (message, type = 'info') => {
          if (self.hostDriver.showToast) {
            self.hostDriver.showToast(message, type);
            return;
          }
          console.log(`[Toast ${type.toUpperCase()}]: ${message}`);
        },
        copy: async (text) => {
          if (self.hostDriver.copyText) {
            return await self.hostDriver.copyText(text);
          }
          if (typeof navigator !== 'undefined' && navigator.clipboard) {
            await navigator.clipboard.writeText(text);
            return true;
          }
          return false;
        },
        openInspector: (id, target, scope) => {
          self.openInspector(id, target, scope);
        },
        closeInspector: () => {
          self.closeInspector();
        },
      },
      events: {
        on: (event, handler) => {
          let set = self.hostEventListeners.get(event);
          if (!set) {
            set = new Set();
            self.hostEventListeners.set(event, set);
          }
          set.add(handler);
          return () => {
            const s = self.hostEventListeners.get(event);
            if (s) s.delete(handler);
          };
        },
        emit: (event, data) => {
          const s = self.hostEventListeners.get(event);
          if (s) {
            for (const h of s) {
              try {
                h(data);
              } catch (e) {
                console.error(`[ZapHostSDK] event ${event} error:`, e);
              }
            }
          }
        },
      },
    };
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

  public getPackage(packageName: string): ExternalPluginPackage | undefined {
    return this.externalPackages.find((p) => p.name === packageName);
  }

  public togglePackage(packageName: string): boolean {
    const pkg = this.getPackage(packageName);
    if (!pkg) return false;
    this.setPackageEnabled(packageName, !pkg.enabled);
    return !pkg.enabled;
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
    this.runtimeGenerations.set(packageName, (this.runtimeGenerations.get(packageName) ?? 0) + 1);
    const disposer = this.dynamicDisposers.get(packageName);
    if (disposer) {
      disposer();
      this.dynamicDisposers.delete(packageName);
    }
    this.purgePackageContributions(packageName);
    if (typeof document !== 'undefined') {
      const cleanId = packageName.replace(/^@/, '').replace(/\//g, '-');
      document.querySelectorAll(`script[src*="${cleanId}"]`).forEach((s) => s.remove());

      // 派发插件卸载事件，驱动插件自洁
      window.dispatchEvent(new CustomEvent('zap:plugin-uninstalled', { detail: { package: packageName } }));

      // 强保障清理动态壁纸残留 DOM
      if (packageName.includes('wallpaper')) {
        const bg = document.getElementById('zap-wallpaper-bg-container');
        if (bg) {
          const v = bg.querySelector('video') as HTMLVideoElement | null;
          if (v) { v.pause(); v.src = ''; }
          bg.remove();
        }
        document.getElementById('zap-wallpaper-drawer')?.remove();
        document.getElementById('zap-wallpaper-injected-styles')?.remove();
        (window as any).__ZAP_WALLPAPER_ENGINE_INITIALIZED__ = false;
      }
      if (packageName.includes('pet')) {
        document.getElementById('zap-pet-companion-container')?.remove();
        document.getElementById('zap-pet-injected-styles')?.remove();
        document.getElementById('zap-pet-drawer')?.remove();
        (window as any).__ZAP_PET_INITIALIZED__ = false;
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
      installDir: `~/.zap/plugins/${entry.name.replace(/^@/, '').replace(/\//g, '-')}`,
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
      installDir: `~/.zap/plugins/${shortId}`,
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

  public installFromManifest(manifest: ZapPluginManifest, source?: string): ExternalPluginPackage {
    const rawId = manifest.id || manifest.name;
    const cleanId = rawId.toLowerCase().replace(/[^a-z0-9-_]/g, '-');
    const pkgName = manifest.name.startsWith('@') || manifest.name.includes('/')
      ? manifest.name
      : `@plugins/${cleanId}`;
    const sectionId = manifest.contributes?.settingsSection?.id || `ext-${cleanId}`;

    const newPkg: ExternalPluginPackage = {
      name: pkgName,
      title: manifest.title || manifest.name,
      description: manifest.description || '外部扩展插件包',
      version: manifest.version || '1.0.0',
      author: manifest.author || 'Plugin Contributor',
      official: false,
      installed: true,
      enabled: true,
      removable: true,
      updatable: false,
      source: source || `manifest:${cleanId}`,
      installDir: `~/.zap/plugins/${cleanId}`,
      entry: manifest.entry,
      entryDir: source && (source.startsWith('/') || /^[A-Za-z]:/.test(source))
        ? source.replace(/[\\/]+[^\\/]*\.json$/, '').replace(/[\\/]+$/, '')
        : undefined,
      readmeMarkdown: `### ${manifest.title || manifest.name}\n\n${manifest.description || ''}`,
      versions: [manifest.version || '1.0.0'],
      configSchema: manifest.contributes?.settingsSection?.schema?.map((s) => ({
        key: s.key,
        label: s.label,
        description: s.description || '',
        type: s.type,
        options: s.options,
      })) || [],
      configValues: { ...(manifest.defaultConfig || {}) },
      contributesSidebarNav: manifest.contributes?.sidebarNav
        ? {
            id: manifest.contributes.sidebarNav.id || `sidebar-nav-${cleanId}`,
            label: manifest.contributes.sidebarNav.label,
            badge: manifest.contributes.sidebarNav.badge,
            order: manifest.contributes.sidebarNav.order,
            viewId: manifest.contributes.sidebarNav.viewId || manifest.contributes.workbenchView?.id,
            sectionId: manifest.contributes.sidebarNav.sectionId || sectionId,
            eventName: manifest.contributes.sidebarNav.eventName,
          }
        : undefined,
      contributesWorkbenchView: manifest.contributes?.workbenchView
        ? {
            id: manifest.contributes.workbenchView.id,
            title: manifest.contributes.workbenchView.title || manifest.title,
            order: manifest.contributes.workbenchView.order,
            type: manifest.contributes.workbenchView.type || 'iframe',
            src: manifest.contributes.workbenchView.src,
          }
        : undefined,
      contributesSettingsSection: manifest.contributes?.settingsSection
        ? {
            id: sectionId,
            label: manifest.contributes.settingsSection.label,
            title: manifest.contributes.settingsSection.title,
            description: manifest.contributes.settingsSection.description,
          }
        : undefined,
      rows: [
        {
          rowId: `${cleanId}-main`,
          title: manifest.title || manifest.name,
          description: manifest.description || '插件核心功能与工作台插槽',
          moduleName: `${pkgName}/index.js`,
          enabled: true,
          phase: 'active',
          hasConfig: Boolean(manifest.contributes?.settingsSection?.schema?.length),
          sectionId,
        },
      ],
    };

    const existsInList = this.externalPackages.some((p) => p.name === pkgName);
    if (existsInList) {
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

  /**
   * 清理插件脚本通过全局内核 API 自行注册的插槽 / Action / Inspector。
   * 内核代注册的贡献由 dynamicDisposers 回收；插件脚本自注册的贡献只能按 pluginPackage 归属清理，
   * 否则停用或卸载后侧栏、设置导航中会残留失效入口。
   */
  private purgePackageContributions(packageName: string) {
    for (const map of Object.values(this.slots) as Map<string, { pluginPackage?: string }>[]) {
      for (const [id, entry] of map) {
        if (entry.pluginPackage === packageName) map.delete(id);
      }
    }
    const registries = [...this.actionRegistries.values(), ...this.inspectorRegistries.values()] as Map<
      string,
      { pluginPackage?: string }
    >[];
    for (const registry of registries) {
      for (const [id, entry] of registry) {
        if (entry.pluginPackage === packageName) registry.delete(id);
      }
    }
  }

  private syncPackageRuntimeEffects(packageName: string) {
    const generation = (this.runtimeGenerations.get(packageName) ?? 0) + 1;
    this.runtimeGenerations.set(packageName, generation);

    const prevDisposer = this.dynamicDisposers.get(packageName);
    if (prevDisposer) {
      prevDisposer();
      this.dynamicDisposers.delete(packageName);
    }

    const pkg = this.externalPackages.find((p) => p.name === packageName);
    if (!pkg || !pkg.enabled) {
      this.purgePackageContributions(packageName);
      if (typeof window !== 'undefined') {
        window.dispatchEvent(new CustomEvent('zap:plugin-deactivated', { detail: { package: packageName } }));
        if (packageName.includes('wallpaper')) {
          const bg = document.getElementById('zap-wallpaper-bg-container');
          if (bg) {
            const v = bg.querySelector('video') as HTMLVideoElement | null;
            if (v) { v.pause(); v.src = ''; }
            bg.remove();
          }
          document.getElementById('zap-wallpaper-drawer')?.remove();
          document.getElementById('zap-wallpaper-injected-styles')?.remove();
          (window as any).__ZAP_WALLPAPER_ENGINE_INITIALIZED__ = false;
        }
        if (packageName.includes('pet')) {
          document.getElementById('zap-pet-companion-container')?.remove();
          document.getElementById('zap-pet-injected-styles')?.remove();
          document.getElementById('zap-pet-drawer')?.remove();
          (window as any).__ZAP_PET_INITIALIZED__ = false;
        }
      }
      return;
    }

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

    // If plugin contributes a workbench view, register into `workbench.view`
    if (pkg.contributesWorkbenchView && pkg.contributesWorkbenchView.id) {
      const wb = pkg.contributesWorkbenchView;
      const unregWb = this.registerSlot('workbench.view', {
        id: wb.id,
        order: wb.order ?? 50,
        title: wb.title || pkg.title,
        pluginPackage: pkg.name,
        type: wb.type || 'iframe',
        src: wb.src,
      });
      cleanups.push(unregWb);
    }

    // If plugin declares a sidebar navigation entry, mount into `sidebar.nav`
    if (pkg.contributesSidebarNav && pkg.contributesSidebarNav.label) {
      const navCfg = pkg.contributesSidebarNav;
      const navId = navCfg.id || `sidebar-nav-${pkg.name}`;
      const targetViewId = navCfg.viewId || pkg.contributesWorkbenchView?.id;
      const unregNav = this.registerSlot('sidebar.nav', {
        id: navId,
        order: navCfg.order ?? 50,
        label: navCfg.label,
        badge: navCfg.badge,
        pluginPackage: pkg.name,
        viewId: targetViewId,
        onClick: () => {
          if (targetViewId) {
            window.dispatchEvent(
              new CustomEvent('zap:switch-workbench-view', {
                detail: { viewId: targetViewId, pluginPackage: pkg.name },
              }),
            );
          } else if (navCfg.eventName) {
            window.dispatchEvent(new CustomEvent(navCfg.eventName, { detail: { pkg } }));
          } else if (navCfg.sectionId) {
            window.dispatchEvent(
              new CustomEvent('zap:open-deepseek-settings-center', {
                detail: { section: navCfg.sectionId },
              }),
            );
          }
        },
      });
      cleanups.push(unregNav);
    }

    // If plugin declares a settings section or has configSchema, mount into `settings.section`
    if (pkg.contributesSettingsSection || (pkg.configSchema && pkg.configSchema.length > 0)) {
      const secCfg = pkg.contributesSettingsSection;
      const secId = secCfg?.id || `ext-${pkg.name.replace(/^@/, '').replace(/\//g, '-')}`;
      const unregSec = this.registerSlot('settings.section', {
        id: secId,
        order: 85,
        icon: null,
        label: secCfg?.label || pkg.title || pkg.name,
        title: secCfg?.title || `${pkg.title || pkg.name} 配置`,
        description: secCfg?.description || pkg.description,
        pluginPackage: pkg.name,
        render: () => null,
      });
      cleanups.push(unregSec);
    }

    // Attempt to dynamically load plugin bundle script if present
    if (pkg.entry && pkg.entryDir) {
      const normalizedDir = pkg.entryDir.replace(/\\/g, '/');
      const normalizedEntry = pkg.entry.replace(/\\/g, '/').replace(/^\.\//, '');
      const fullEntryPath = `${normalizedDir}/${normalizedEntry}`;
      fetchFsRead(fullEntryPath)
        .then((res) => {
          // 读取期间插件已被停用 / 重新同步：丢弃本次结果，避免重复注入或注入到已回收的运行时
          if (this.runtimeGenerations.get(packageName) !== generation) return;
          if (res.success && res.content) {
            const scriptEl = document.createElement('script');
            scriptEl.type = 'module';
            scriptEl.textContent = res.content;
            document.head.appendChild(scriptEl);
            cleanups.push(() => scriptEl.remove());
          }
        })
        .catch(() => {});
    } else {
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
    }

    this.dynamicDisposers.set(packageName, () => {
      for (const fn of cleanups) fn();
    });
  }
}

export const zapPluginKernel = new ZapPluginKernel();
export const zapHostSDK = zapPluginKernel.hostSDK;

// =============================================================================
// React Hooks for Plugin System Consumption
// =============================================================================

export function usePluginActions<TContext = any>(
  scope: ActionScope,
  context?: TContext,
): ActionContribution<TContext>[] {
  const [actions, setActions] = useState<ActionContribution<TContext>[]>(() =>
    zapPluginKernel.getActions(scope, context),
  );

  useEffect(() => {
    setActions(zapPluginKernel.getActions(scope, context));
    return zapPluginKernel.subscribe(() => {
      setActions(zapPluginKernel.getActions(scope, context));
    });
  }, [scope, context]);

  return actions;
}

export function usePluginInspectors<TTarget = any>(
  scope: InspectorScope,
  target?: TTarget,
): InspectorContribution<TTarget>[] {
  const [inspectors, setInspectors] = useState<InspectorContribution<TTarget>[]>(() =>
    zapPluginKernel.getInspectors(scope, target),
  );

  useEffect(() => {
    setInspectors(zapPluginKernel.getInspectors(scope, target));
    return zapPluginKernel.subscribe(() => {
      setInspectors(zapPluginKernel.getInspectors(scope, target));
    });
  }, [scope, target]);

  return inspectors;
}

export function useActiveInspector() {
  const [active, setActive] = useState(() => zapPluginKernel.getActiveInspector());

  useEffect(() => {
    return zapPluginKernel.subscribe(() => {
      setActive(zapPluginKernel.getActiveInspector());
    });
  }, []);

  return active;
}

/**
 * 订阅插件内核变更并返回当前版本号；任何插槽、插件包状态变化都会触发使用方重渲染。
 * 订阅建立后立即比对一次版本，补偿父/兄弟组件 effect（如 syncAllPackagesRuntimeEffects）
 * 先于本组件订阅执行而错过的通知。
 */
export function usePluginKernelVersion(): number {
  const [version, setVersion] = useState(() => zapPluginKernel.getVersion());

  useEffect(() => {
    const sync = () => setVersion(zapPluginKernel.getVersion());
    const unsub = zapPluginKernel.subscribe(sync);
    sync();
    return unsub;
  }, []);

  return version;
}

export function useZapHostSDK(): ZapHostSDK {
  return zapPluginKernel.hostSDK;
}

// Expose global runtime hooks for external user scripts & plugins
if (typeof window !== 'undefined') {
  (window as any).__ZAP_PLUGIN_KERNEL__ = zapPluginKernel;
  (window as any).__ZAP_HOST_SDK__ = zapPluginKernel.hostSDK;
}
