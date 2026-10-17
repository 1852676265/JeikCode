import { useState, useEffect } from 'preact/hooks';
import { ProjectInfo, saveGitBinding, getGitBinding, getRemoteAccess } from '../api';
import { useT, useSettings } from '../settings';
import { Select, SelectOption } from './Select';
import { ModelSelector } from './ModelSelector';
import { getPageZoom } from '../lib/pageZoom';

/** 支持的 Git 托管平台渠道类型 */
export type GitPlatformChannel = 'github' | 'gitlab' | 'gitee' | 'gitea' | 'custom_git';

/** 支持的工作同步模式 */
export type GitSyncMode = 'webhook' | 'polling';

/** 单个渠道的元数据定义 */
export interface GitChannelMeta {
  id: GitPlatformChannel;
  nameKey: string;
  descKey: string;
  statusType: 'active' | 'beta';
  statusBadgeKey: string;
  defaultApiBase?: string;
  supportsSelfHosted: boolean;
  tokenNameKey: string;
  tokenPlaceholder: string;
  tokenHintKey: string;
  repoLabelKey: string;
  repoSampleKey: string;
  repoHintKey: string;
}

export const GIT_CHANNELS: GitChannelMeta[] = [
  {
    id: 'github',
    nameKey: 'gitWebhook.chGithub',
    descKey: 'gitWebhook.chGithubDesc',
    statusType: 'active',
    statusBadgeKey: 'gitWebhook.badgeActive',
    supportsSelfHosted: false,
    tokenNameKey: 'gitWebhook.tokenGithub',
    tokenPlaceholder: 'ghp_xxxxxxxxxxxxxxxxxxxx',
    tokenHintKey: 'gitWebhook.patHintGithub',
    repoLabelKey: 'gitWebhook.repoLabelGithub',
    repoSampleKey: 'gitWebhook.sampleGithub',
    repoHintKey: 'gitWebhook.repoHintGithub',
  },
  {
    id: 'gitlab',
    nameKey: 'gitWebhook.chGitlab',
    descKey: 'gitWebhook.chGitlabDesc',
    statusType: 'beta',
    statusBadgeKey: 'gitWebhook.badgeBeta',
    supportsSelfHosted: true,
    defaultApiBase: 'https://gitlab.com/api/v4',
    tokenNameKey: 'gitWebhook.tokenGitlab',
    tokenPlaceholder: 'glpat-xxxxxxxxxxxxxxxxxxxx',
    tokenHintKey: 'gitWebhook.patHintGitlab',
    repoLabelKey: 'gitWebhook.repoLabelGitlab',
    repoSampleKey: 'gitWebhook.sampleGitlab',
    repoHintKey: 'gitWebhook.repoHintGitlab',
  },
  {
    id: 'gitee',
    nameKey: 'gitWebhook.chGitee',
    descKey: 'gitWebhook.chGiteeDesc',
    statusType: 'beta',
    statusBadgeKey: 'gitWebhook.badgeBeta',
    supportsSelfHosted: false,
    tokenNameKey: 'gitWebhook.tokenGitee',
    tokenPlaceholder: 'xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx',
    tokenHintKey: 'gitWebhook.patHintGitee',
    repoLabelKey: 'gitWebhook.repoLabelGitee',
    repoSampleKey: 'gitWebhook.sampleGitee',
    repoHintKey: 'gitWebhook.repoHintGitee',
  },
  {
    id: 'gitea',
    nameKey: 'gitWebhook.chGitea',
    descKey: 'gitWebhook.chGiteaDesc',
    statusType: 'beta',
    statusBadgeKey: 'gitWebhook.badgeBeta',
    supportsSelfHosted: true,
    defaultApiBase: 'https://gitea.example.com/api/v1',
    tokenNameKey: 'gitWebhook.tokenGitea',
    tokenPlaceholder: 'xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx',
    tokenHintKey: 'gitWebhook.patHintGitea',
    repoLabelKey: 'gitWebhook.repoLabelGitea',
    repoSampleKey: 'gitWebhook.sampleGitea',
    repoHintKey: 'gitWebhook.repoHintGitea',
  },
  {
    id: 'custom_git',
    nameKey: 'gitWebhook.chCustom',
    descKey: 'gitWebhook.chCustomDesc',
    statusType: 'beta',
    statusBadgeKey: 'gitWebhook.badgeBeta',
    supportsSelfHosted: true,
    tokenNameKey: 'gitWebhook.tokenCustom',
    tokenPlaceholder: 'Token / Password / Key',
    tokenHintKey: 'gitWebhook.patHintCustom',
    repoLabelKey: 'gitWebhook.repoLabelCustom',
    repoSampleKey: 'gitWebhook.sampleCustom',
    repoHintKey: 'gitWebhook.repoHintCustom',
  },
];

/** Webhook 模式配置 */
export interface WebhookConfig {
  payloadUrl: string;
  secret: string;
}

/** 轮询模式配置 */
export interface PollingConfig {
  intervalSeconds: number;
  onlyActivePr: boolean;
}

/** 统一的 Git 平台适配器配置结构 */
export interface GitAdapterConfig {
  enabled: boolean;
  lastEnabledState?: boolean;
  channel: GitPlatformChannel;
  syncMode: GitSyncMode;
  repoIdentifier: string;
  accessToken: string;
  customApiBase: string;
  webhook: WebhookConfig;
  polling: PollingConfig;
  events: {
    pullRequest: boolean;
    issueComment: boolean;
    push: boolean;
  };
  triggerKeyword: string;
  autoReviewNewPr: boolean;
  updateExistingComment: boolean;
  reviewPromptTemplate: string;
  lang?: string;
  reviewModel?: string;
}

const DEFAULT_REVIEW_PROMPT_ZH = `你是一名专业且严谨的高级代码审查专家（JeikCode Code Reviewer）。
你将收到来自本项目的 Pull Request / Merge Request / Issue，并结合目标分支的最新代码进行深度审查。

【审查原则与核心关注点】
1. 代码与版本对齐（工作区零检出与并发保护）：拉取 PR、Issue 对应仓库分支最新远程提交及 PR 最新提交到本地。严禁在本地工作区执行 git checkout 或 git switch 切换分支！比对差异请使用：git diff origin/main...refs/remotes/pr/<id>（分支只是示例）或 GitHub API Diff；查看具体文件使用 git show <ref>:<path>。基于最新版本代码与 PR/Issue 基于的仓库版本进行严谨比对审查。对于 PR 请认真审查修复方案的合理性，排查是否存在死代码、硬编码、补丁式修补等违背当前系统设计原则和 BUG 修复原则的问题。
2. 现有方案与修复状态核验：比对并核实该问题或解决方案是否已在目标分支最新方案中得到完全修复与解决（例如是否已采纳了更高级的架构模式、策略抽象或同类解法）。清晰罗列出：所有已修复的问题、对应版本号、提交哈希（Commit Hash），以及当前依旧未修复遗留的问题。
3. PR 审查与合并建议：理性评估给出是否建议合并、是否有必须修改的地方、是否有与当前仓库架构冲突之处。保持客观公正（切勿钻牛角尖硬找错；设计合理即予肯定，存在缺陷则明确指出改进方向），并按修改意见严重程度给出 P 级排序（P0 阻塞 / P1 严重 / P2 一般 / P3 建议）与改进建议。若建议合并，请清晰总结该修复方案的架构特点，并阐明建议合并的充分理由。
4. Issue 答疑与进度指引：针对 Issue，根据上述核验结论诚恳解答用户疑问，提供基于最新代码库的分析；明确说明哪些修复已经在开发主干/测试分支中推进但尚未发布，预计将在测试版还是正式版推出；对于真实存在的新缺陷，给出专业判断、复现分析与最小可行修复建议。
5. 机器人操作指令响应（如 @机器人 合并 / merge / 解决冲突并合并）：
   - 当收到合并或解决冲突指令时，核验是否存在代码冲突与破坏性缺陷；若无冲突且符合合并标准，阐述合流建议与执行摘要；若存在冲突，定位具体冲突文件并提供最小可行解决方案。`;

const DEFAULT_REVIEW_PROMPT_EN = `You are a senior, rigorous code review expert (JeikCode Code Reviewer).
You will receive Pull Requests / Merge Requests / Issues from this project, conducting in-depth reviews in conjunction with the latest codebase of the target branch.

[Review Principles & Core Focus]
1. Code & Baseline Alignment (Workspace Protection & Zero Checkout): Pull the latest commits from the target remote branch and the PR branch locally. Strictly prohibit executing git checkout or git switch in the local workspace! To compare diffs, use: git diff origin/main...refs/remotes/pr/<id> (branches are illustrative examples) or GitHub API Diff; use git show <ref>:<path> to view files, ensuring a pristine workspace and robust multi-PR concurrency. Review against both the latest branch state and the base revision the PR/Issue was branched from. For PRs, thoroughly evaluate fix reasonableness, identifying dead code, brittle hardcoding, or superficial patches that violate architectural design and bug-fixing principles.
2. Verification Against Existing Solutions: Verify whether the issue or proposed solution is already fully addressed in the latest codebase (e.g., via higher-level design patterns or alternative architectural fixes). Itemize: all resolved issues, corresponding version tags, commit hashes, and any remaining unaddressed defects.
3. PR Evaluation & Merge Recommendation: Objectively evaluate whether to recommend merging, required revisions, and potential architectural conflicts. Remain constructive and fair (do not nitpick unnecessarily; acknowledge sound designs and give actionable guidance for defects). Sort review feedback by priority (P0 Blocker / P1 Critical / P2 Normal / P3 Suggestion). If recommending merge, summarize the architectural highlights and provide concrete merge justification.
4. Issue Inquiry & Release Tracking: For Issues, provide sincere, well-reasoned answers grounded in the current codebase based on the verification above. Clarify which fixes are in progress or in active branches awaiting release, and specify upcoming delivery targets (beta vs. stable release). For confirmed defects, provide impact analysis and concrete fix guidance.
5. Bot Command Handling (e.g. @bot merge / resolve conflicts and merge):
   - When receiving merge or conflict resolution commands, verify potential branch conflicts and breaking regressions; if clean, summarize merge execution advice; if conflicting, pinpoint conflicting hunks and provide minimal viable resolution.`;

function generateRandomSecret(): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let result = 'whsec_';
  for (let i = 0; i < 24; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return result;
}

const GLOBAL_LAST_WEBHOOK_HOST_KEY = 'jeikcode:last_webhook_host';

export function stripWebhookSuffix(url: string): string {
  return url
    .replace(/\/api\/webhooks\/(git|github)\/?$/i, '')
    .replace(/\/+$/, '');
}

/**
 * 获取全局记住的 Webhook 域名/主机（单实例跨项目继承，避免重复配置）
 */
export function getLastWebhookHost(): string {
  if (typeof window === 'undefined') return '';
  try {
    const saved = localStorage.getItem(GLOBAL_LAST_WEBHOOK_HOST_KEY);
    if (saved && !saved.includes('127.0.0.1') && !saved.includes('localhost')) {
      return saved;
    }
    // 自动扫描已有的其他项目配置，发现并自动提取已配置过的域名作为种子
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key && key.startsWith('jeikcode_git_binding_')) {
        const item = localStorage.getItem(key);
        if (item) {
          const parsed = JSON.parse(item);
          const url = parsed.webhook?.payloadUrl || parsed.webhookUrl || '';
          const clean = stripWebhookSuffix(url);
          if (clean && !clean.includes('127.0.0.1') && !clean.includes('localhost')) {
            localStorage.setItem(GLOBAL_LAST_WEBHOOK_HOST_KEY, clean);
            return clean;
          }
        }
      }
    }
  } catch {
    // ignore
  }
  return '';
}

/**
 * 记忆最新配置的 Webhook 域名/主机
 */
export function setLastWebhookHost(host: string): void {
  if (typeof window === 'undefined') return;
  try {
    const clean = stripWebhookSuffix(host.trim());
    if (clean && !clean.includes('127.0.0.1') && !clean.includes('localhost')) {
      localStorage.setItem(GLOBAL_LAST_WEBHOOK_HOST_KEY, clean);
    }
  } catch {
    // ignore
  }
}

export function getFullWebhookUrl(hostOrUrl: string): string {
  const clean = stripWebhookSuffix(hostOrUrl.trim());
  if (!clean) return '';
  return `${clean}/api/webhooks/git`;
}

export function getProjectGitConfig(projectHash: string, lang?: string): GitAdapterConfig {
  // 默认继承全局记住的 Webhook 域名，保持项目独立且可随时编辑
  const defaultUrl = getLastWebhookHost();

  const defaultPrompt = lang === 'zh' ? DEFAULT_REVIEW_PROMPT_ZH : DEFAULT_REVIEW_PROMPT_EN;

  const defaultConfig: GitAdapterConfig = {
    enabled: false,
    lastEnabledState: false,
    channel: 'github',
    syncMode: 'webhook',
    repoIdentifier: '',
    accessToken: '',
    customApiBase: '',
    webhook: {
      payloadUrl: defaultUrl,
      secret: generateRandomSecret(),
    },
    polling: {
      intervalSeconds: 60,
      onlyActivePr: true,
    },
    events: {
      pullRequest: true,
      issueComment: true,
      push: false,
    },
    triggerKeyword: '@bot',
    autoReviewNewPr: true,
    updateExistingComment: true,
    reviewPromptTemplate: defaultPrompt,
    reviewModel: '',
  };

  try {
    const raw = localStorage.getItem(`jeikcode_git_binding_${projectHash}`);
    if (raw) {
      const parsed = JSON.parse(raw);
      // 向后平滑兼容原有单一 GitHub 格式，若之前存的是默认 localhost/127.0.0.1 则重置为空
      const repoId = parsed.repoIdentifier || parsed.repoFullName || '';
      const pat = parsed.accessToken || parsed.githubPat || '';
      const secret = parsed.webhook?.secret || parsed.secret || generateRandomSecret();
      let payloadUrl = parsed.webhook?.payloadUrl || parsed.webhookUrl || '';
      if (payloadUrl.includes('127.0.0.1') || payloadUrl.includes('localhost')) {
        payloadUrl = '';
      }
      // 若本项目未单独保存过域名，自动继承全局最近配置的通用 Webhook 域名
      if (!payloadUrl) {
        payloadUrl = getLastWebhookHost();
      }

      const isEnabled = parsed.enabled ?? false;
      const lastEnabled = parsed.lastEnabledState ?? parsed.last_enabled_state ?? isEnabled;

      return {
        ...defaultConfig,
        ...parsed,
        enabled: isEnabled,
        lastEnabledState: lastEnabled,
        repoIdentifier: repoId,
        accessToken: pat,
        reviewModel: parsed.reviewModel || parsed.review_model || '',
        webhook: {
          payloadUrl,
          secret,
        },
        polling: {
          ...defaultConfig.polling,
          ...(parsed.polling || {}),
        },
        events: {
          ...defaultConfig.events,
          ...(parsed.events || {}),
        },
      };
    }
  } catch {
    // ignore
  }

  return defaultConfig;
}

export function saveProjectGitConfig(projectHash: string, config: GitAdapterConfig): void {
  try {
    localStorage.setItem(`jeikcode_git_binding_${projectHash}`, JSON.stringify(config));
    if (config.webhook?.payloadUrl) {
      setLastWebhookHost(config.webhook.payloadUrl);
    }
  } catch {
    // ignore
  }
  // 异步同步到后端持久化文件 (~/.jeikcode/git-bindings.json)
  saveGitBinding({ ...config, project_hash: projectHash }).catch(() => {});
}

interface GitWebhookDialogProps {
  project: ProjectInfo;
  onClose: () => void;
  onSaved?: (config: GitAdapterConfig) => void;
}

export function GitWebhookDialog({ project, onClose, onSaved }: GitWebhookDialogProps) {
  const t = useT();
  const { lang } = useSettings();
  const [config, setConfig] = useState<GitAdapterConfig>(() => getProjectGitConfig(project.hash, lang));
  const [showToken, setShowToken] = useState(false);
  const [copyStatus, setCopyStatus] = useState<Record<string, string>>({});
  const [toastMsg, setToastMsg] = useState<string | null>(null);

  // 动态响应页面/浏览器缩放与视口尺寸变动，自适应计算弹窗最大高度与居中边界，彻底防止大比例缩放下被遮挡
  const [modalAdaptiveStyle, setModalAdaptiveStyle] = useState<{ maxHeight?: string; width?: string }>({});

  useEffect(() => {
    function computeAdaptiveBounds() {
      if (typeof window === 'undefined') return;
      const zoom = getPageZoom() || 1.0;
      const vh = window.visualViewport ? window.visualViewport.height : window.innerHeight;
      const vw = window.visualViewport ? window.visualViewport.width : window.innerWidth;

      // 缩放校正后的有效可用视口高度与宽度
      const effectiveVh = vh / zoom;
      const effectiveVw = vw / zoom;

      // 上下各预留 24px、左右各预留 20px 安全边距，让弹窗无论如何缩放均居中保持完整可见
      const safeMaxHeight = Math.max(340, Math.floor(effectiveVh - 48));
      const safeWidth = Math.min(860, Math.max(320, Math.floor(effectiveVw - 40)));

      setModalAdaptiveStyle({
        maxHeight: `${safeMaxHeight}px`,
        width: `${safeWidth}px`,
      });
    }

    computeAdaptiveBounds();
    window.addEventListener('resize', computeAdaptiveBounds);
    window.addEventListener('jeikcode:zoom_change', computeAdaptiveBounds);
    if (window.visualViewport) {
      window.visualViewport.addEventListener('resize', computeAdaptiveBounds);
      window.visualViewport.addEventListener('scroll', computeAdaptiveBounds);
    }
    return () => {
      window.removeEventListener('resize', computeAdaptiveBounds);
      window.removeEventListener('jeikcode:zoom_change', computeAdaptiveBounds);
      if (window.visualViewport) {
        window.visualViewport.removeEventListener('resize', computeAdaptiveBounds);
        window.visualViewport.removeEventListener('scroll', computeAdaptiveBounds);
      }
    };
  }, []);

  // 动态同步右上角实际监听端口（默认 13460）
  const [livePort, setLivePort] = useState<string>(() => {
    if (typeof window !== 'undefined' && window.location.port) {
      return window.location.port;
    }
    return '13460';
  });

  useEffect(() => {
    getRemoteAccess()
      .then((st) => {
        if (st && st.port) {
          setLivePort(String(st.port));
        }
      })
      .catch(() => {});
  }, []);

  const activeChannelMeta = GIT_CHANNELS.find((c) => c.id === config.channel) || GIT_CHANNELS[0];

  useEffect(() => {
    // 从后端拉取最新持久化配置（支持跨浏览器/清除缓存后恢复）
    getGitBinding(project.hash).then((remote) => {
      if (remote && remote.channel) {
        setConfig((prev) => {
          let remotePayload = remote.webhook?.payload_url || remote.webhook?.payloadUrl || '';
          if (remotePayload.includes('127.0.0.1') || remotePayload.includes('localhost')) {
            remotePayload = '';
          }
          // 若远端没有保存过独立域名，则自动继承全局记忆域名或当前状态已继承的域名
          const effectivePayload = remotePayload || prev.webhook.payloadUrl || getLastWebhookHost();

          return {
            ...prev,
            ...remote,
            webhook: {
              ...prev.webhook,
              ...(remote.webhook || {}),
              payloadUrl: effectivePayload,
            },
            events: {
              ...prev.events,
              ...(remote.events || {}),
            },
          };
        });
      }
    }).catch(() => {});
  }, [project.hash]);

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
      }
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [onClose]);

  const showToast = (msg: string) => {
    setToastMsg(msg);
    setTimeout(() => setToastMsg(null), 3000);
  };

  const copyToClipboard = (text: string, fieldKey: string) => {
    if (!text) return;
    navigator.clipboard.writeText(text).then(() => {
      setCopyStatus((prev) => ({ ...prev, [fieldKey]: t('gitWebhook.copied') }));
      setTimeout(() => {
        setCopyStatus((prev) => ({ ...prev, [fieldKey]: '' }));
      }, 2000);
    });
  };

  const handleSave = () => {
    const configToSave = { ...config, lang };
    saveProjectGitConfig(project.hash, configToSave);
    showToast(t('gitWebhook.saveSuccess'));
    if (onSaved) onSaved(configToSave);
    setTimeout(() => {
      onClose();
    }, 600);
  };

  const handleRegenerateSecret = () => {
    const newSecret = generateRandomSecret();
    setConfig((prev) => ({
      ...prev,
      webhook: { ...prev.webhook, secret: newSecret },
    }));
  };

  const handleResetPrompt = () => {
    const defaultPrompt = lang === 'zh' ? DEFAULT_REVIEW_PROMPT_ZH : DEFAULT_REVIEW_PROMPT_EN;
    setConfig((prev) => ({ ...prev, reviewPromptTemplate: defaultPrompt }));
  };

  const handleTestOrTrigger = () => {
    if (config.syncMode === 'webhook') {
      showToast(t('gitWebhook.testSuccess'));
    } else {
      showToast(t('gitWebhook.pollingSimSuccess'));
    }
  };

  // 下拉框 1：托管平台渠道选项（展示加粗名称、Active/Beta 状态徽章、协议说明和格式示例）
  const channelOptions: SelectOption<GitPlatformChannel>[] = GIT_CHANNELS.map((ch) => ({
    value: ch.id,
    selectedLabel: (
      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', width: '100%' }}>
        <strong style={{ color: 'var(--app-primary-foreground)' }}>{t(ch.nameKey as any) || ch.id}</strong>
        <span class={`git-channel-status-badge ${ch.statusType}`}>{t(ch.statusBadgeKey as any)}</span>
      </div>
    ),
    label: (
      <div class="git-select-rich-option">
        <div class="git-select-rich-top">
          <span class="git-select-rich-title">{t(ch.nameKey as any) || ch.id}</span>
          <span class={`git-channel-status-badge ${ch.statusType}`}>{t(ch.statusBadgeKey as any)}</span>
        </div>
        <span class="git-select-rich-desc">{t(ch.descKey as any)}</span>
        <span class="git-select-rich-sample">{t(ch.repoSampleKey as any)}</span>
      </div>
    ),
  }));

  // 下拉框 2：同步触发模式选项（详细展示各自的工作原理与适用场景）
  const modeOptions: SelectOption<GitSyncMode>[] = [
    {
      value: 'webhook',
      selectedLabel: (
        <strong style={{ color: 'var(--app-primary-foreground)' }}>{t('gitWebhook.modeWebhook')}</strong>
      ),
      label: (
        <div class="git-select-rich-option">
          <div class="git-select-rich-top">
            <span class="git-select-rich-title">{t('gitWebhook.modeWebhook')}</span>
          </div>
          <span class="git-select-rich-desc">{t('gitWebhook.modeWebhookDesc')}</span>
        </div>
      ),
    },
    {
      value: 'polling',
      selectedLabel: (
        <strong style={{ color: 'var(--app-primary-foreground)' }}>{t('gitWebhook.modePolling')}</strong>
      ),
      label: (
        <div class="git-select-rich-option">
          <div class="git-select-rich-top">
            <span class="git-select-rich-title">{t('gitWebhook.modePolling')}</span>
          </div>
          <span class="git-select-rich-desc">{t('gitWebhook.modePollingDesc')}</span>
        </div>
      ),
    },
  ];

  return (
    <div class="modal-overlay git-webhook-modal-overlay" onClick={onClose}>
      <div
        class="modal-card modal-card-lg git-webhook-modal-card"
        style={modalAdaptiveStyle}
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-labelledby="git-adapter-title"
      >
        {/* 顶部标题栏 */}
        <div class="modal-header">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style={{ flexShrink: 0, color: 'var(--app-primary-foreground)' }}>
            <line x1="6" y1="3" x2="6" y2="15"></line>
            <circle cx="18" cy="6" r="3"></circle>
            <circle cx="6" cy="18" r="3"></circle>
            <path d="M18 9a9 9 0 0 1-9 9"></path>
          </svg>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
            <h3 id="git-adapter-title" style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <span>{t('gitWebhook.adapterTitle')}</span>
              <span class="git-badge-tag">{t('gitWebhook.tag')}</span>
            </h3>
            <span class="modal-sub">{t('gitWebhook.adapterSub')}</span>
          </div>
          <button type="button" class="modal-close" onClick={onClose} aria-label={t('common.dismiss')}>
            ✕
          </button>
        </div>

        {/* 弹窗内容主体：弹性伸缩，内部自动滚动，底部操作栏绝不被遮蔽 */}
        <div class="modal-body git-webhook-body">
          
          {/* 项目元信息卡片 */}
          <div class="git-project-info-banner">
            <div class="git-banner-row">
              <span class="git-banner-label">{t('gitWebhook.project')}</span>
              <strong class="git-banner-val">{project.name || 'Current'}</strong>
            </div>
            <div class="git-banner-row">
              <span class="git-banner-label">{t('gitWebhook.rootPath')}</span>
              <span class="git-banner-path" title={project.working_dir}>{project.working_dir}</span>
            </div>
          </div>

          {/* 总启用开关横幅：现代工业美学设计（关闭红色氛围，开启绿色氛围） */}
          <div
            class={`git-enable-hero-banner ${config.enabled ? 'is-enabled' : 'is-disabled'}`}
            onClick={() => {
              const next = !config.enabled;
              setConfig({
                ...config,
                enabled: next,
                lastEnabledState: next,
              });
            }}
          >
            <div class="git-enable-hero-left">
              <div class={`git-enable-toggle-core ${config.enabled ? 'active' : ''}`} aria-hidden="true">
                <span class="git-enable-toggle-thumb" />
              </div>
              <div class="git-enable-hero-text">
                <div class="git-enable-hero-title">
                  <strong>{t('gitWebhook.enableSwitchLabel')}</strong>
                </div>
                <span class="git-enable-hero-desc">{t('gitWebhook.enableSwitchHint')}</span>
              </div>
            </div>

            <div class={`git-enable-status-chip ${config.enabled ? 'active' : 'disabled'}`}>
              <span class="git-status-dot" />
              <span class="git-status-text">
                {config.enabled ? t('gitWebhook.statusActive') : t('gitWebhook.statusInactive')}
              </span>
            </div>
          </div>

          {/* 适配器核心配置区：双下拉框（渠道选择 + 模式选择） */}
          <div class="git-form-section">
            <div class="git-section-title">
              <span>1. {t('gitWebhook.secStrategyTitle')}</span>
            </div>
            
            <div class="git-form-grid">
              {/* 下拉框 1：托管平台渠道 */}
              <div class="git-form-item">
                <label class="git-form-label">{t('gitWebhook.channelSection')}</label>
                <Select<GitPlatformChannel>
                  class="git-adapter-select"
                  value={config.channel}
                  options={channelOptions}
                  onChange={(ch) => setConfig({ ...config, channel: ch })}
                />
                <span class="git-input-hint">
                  {t(activeChannelMeta.descKey as any)}
                </span>
              </div>

              {/* 下拉框 2：同步触发模式 */}
              <div class="git-form-item">
                <label class="git-form-label">{t('gitWebhook.modeSection')}</label>
                <Select<GitSyncMode>
                  class="git-adapter-select"
                  value={config.syncMode}
                  options={modeOptions}
                  onChange={(mode) => setConfig({ ...config, syncMode: mode })}
                />
                <span class="git-input-hint">
                  {config.syncMode === 'webhook' ? t('gitWebhook.modeWebhookDesc') : t('gitWebhook.modePollingDesc')}
                </span>
              </div>
            </div>

            {/* 如果所选渠道支持自建/私有化部署，展示自定义 Base URL 输入框 */}
            {activeChannelMeta.supportsSelfHosted && (
              <div class="git-form-item" style={{ marginTop: '10px' }}>
                <label class="git-form-label">{t('gitWebhook.customApiBaseLabel')}</label>
                <input
                  type="text"
                  class="git-input"
                  placeholder={activeChannelMeta.defaultApiBase || t('gitWebhook.customApiBasePlaceholder')}
                  value={config.customApiBase}
                  onInput={(e) => setConfig({ ...config, customApiBase: (e.target as HTMLInputElement).value.trim() })}
                />
                <span class="git-input-hint">{t('gitWebhook.customApiBaseHint')}</span>
              </div>
            )}
          </div>

          {/* 适配器第 2 区：模式专属接入参数 (Webhook 或 轮询) */}
          <div class="git-form-section">
            <div class="git-section-title">
              <span>2. {config.syncMode === 'webhook' ? t('gitWebhook.secParamWebhook') : t('gitWebhook.secParamPolling')}</span>
            </div>

            {config.syncMode === 'webhook' ? (
              <div class="git-form-grid">
                <div class="git-form-item">
                  <label class="git-form-label">{t('gitWebhook.payloadUrlLabel')}</label>
                  <div class="git-webhook-input-group">
                    <input
                      type="text"
                      class="git-group-input"
                      value={stripWebhookSuffix(config.webhook.payloadUrl || '')}
                      placeholder={`http(s)://yourdomain:${livePort}`}
                      onInput={(e) => {
                        const val = (e.target as HTMLInputElement).value.trim();
                        const stripped = stripWebhookSuffix(val);
                        setConfig({
                          ...config,
                          webhook: {
                            ...config.webhook,
                            payloadUrl: stripped,
                          },
                        });
                        // 用户编辑后，实时同步为全局默认继承项
                        if (stripped) {
                          setLastWebhookHost(stripped);
                        }
                      }}
                    />
                    <span class="git-group-addon">/api/webhooks/git</span>
                    <button
                      type="button"
                      class="git-group-btn"
                      onClick={() => {
                        const host = config.webhook.payloadUrl.trim() || `http(s)://yourdomain:${livePort}`;
                        copyToClipboard(`${stripWebhookSuffix(host)}/api/webhooks/git`, 'url');
                      }}
                      title={t('gitWebhook.copyFullUrlHint')}
                    >
                      {copyStatus['url'] || t('gitWebhook.copy')}
                    </button>
                  </div>
                  <span class="git-input-hint">{t('gitWebhook.payloadUrlHint')}</span>
                </div>

                <div class="git-form-item">
                  <label class="git-form-label">{t('gitWebhook.secretLabel')}</label>
                  <div class="git-input-with-actions">
                    <input
                      type="text"
                      class="git-input"
                      value={config.webhook.secret}
                      onInput={(e) =>
                        setConfig({
                          ...config,
                          webhook: { ...config.webhook, secret: (e.target as HTMLInputElement).value.trim() },
                        })
                      }
                    />
                    <button
                      type="button"
                      class="git-aux-btn"
                      onClick={handleRegenerateSecret}
                      title="Generate Random Secret"
                    >
                      {t('gitWebhook.random')}
                    </button>
                    <button
                      type="button"
                      class="git-aux-btn"
                      onClick={() => copyToClipboard(config.webhook.secret, 'secret')}
                    >
                      {copyStatus['secret'] || t('gitWebhook.copy')}
                    </button>
                  </div>
                  <span class="git-input-hint">{t('gitWebhook.secretHint')}</span>
                </div>
              </div>
            ) : (
              <div class="git-form-grid">
                <div class="git-form-item">
                  <label class="git-form-label">{t('gitWebhook.pollingIntervalLabel')}</label>
                  <input
                    type="number"
                    min="10"
                    max="3600"
                    class="git-input"
                    value={config.polling.intervalSeconds}
                    onInput={(e) =>
                      setConfig({
                        ...config,
                        polling: {
                          ...config.polling,
                          intervalSeconds: parseInt((e.target as HTMLInputElement).value, 10) || 60,
                        },
                      })
                    }
                  />
                  <span class="git-input-hint">{t('gitWebhook.pollingIntervalHint')}</span>
                </div>

                <div class="git-form-item" style={{ display: 'flex', flexDirection: 'column', justifyContent: 'center' }}>
                  <label class="git-switch-inline-label">
                    <input
                      type="checkbox"
                      checked={config.polling.onlyActivePr}
                      onChange={(e) =>
                        setConfig({
                          ...config,
                          polling: {
                            ...config.polling,
                            onlyActivePr: (e.target as HTMLInputElement).checked,
                          },
                        })
                      }
                    />
                    <span>{t('gitWebhook.pollingOnlyActive')}</span>
                  </label>
                  <span class="git-input-hint" style={{ marginTop: '4px' }}>
                    {t('gitWebhook.pollingFilterHint')}
                  </span>
                </div>
              </div>
            )}
          </div>

          {/* 适配器第 3 区：动态绑定的仓库标识与平台认证凭据 */}
          <div class="git-form-section">
            <div class="git-section-title">
              <span>3. {t('gitWebhook.secAuthTitle')}</span>
            </div>
            <div class="git-form-grid">
              {/* 动态 Label、Placeholder 与 Hint */}
              <div class="git-form-item">
                <label class="git-form-label">
                  {t(activeChannelMeta.repoLabelKey as any)} <span style={{ color: '#ef4444' }}>*</span>
                </label>
                <input
                  type="text"
                  class="git-input"
                  placeholder={t(activeChannelMeta.repoSampleKey as any)}
                  value={config.repoIdentifier}
                  onInput={(e) => setConfig({ ...config, repoIdentifier: (e.target as HTMLInputElement).value.trim() })}
                />
                <span class="git-input-hint">{t(activeChannelMeta.repoHintKey as any)}</span>
              </div>

              {/* 动态 Token Name、Placeholder 与 Hint */}
              <div class="git-form-item">
                <label class="git-form-label">
                  {t(activeChannelMeta.tokenNameKey as any)} <span style={{ color: '#ef4444' }}>*</span>
                </label>
                <div class="git-input-with-actions">
                  <input
                    type={showToken ? 'text' : 'password'}
                    class="git-input"
                    placeholder={activeChannelMeta.tokenPlaceholder}
                    value={config.accessToken}
                    onInput={(e) => setConfig({ ...config, accessToken: (e.target as HTMLInputElement).value.trim() })}
                  />
                  <button
                    type="button"
                    class="git-aux-btn"
                    onClick={() => setShowToken(!showToken)}
                    title={showToken ? t('gitWebhook.hideToken') : t('gitWebhook.showToken')}
                  >
                    {showToken ? '🙈' : '👁️'}
                  </button>
                </div>
                <span class="git-input-hint">{t(activeChannelMeta.tokenHintKey as any)}</span>
              </div>
            </div>
          </div>

          {/* 适配器第 4 区：订阅事件与唤醒规则 */}
          <div class="git-form-section">
            <div class="git-section-title">
              <span>4. {t('gitWebhook.sec3Title')}</span>
            </div>
            
            <div class="git-checkbox-group">
              <label class="git-checkbox-label">
                <input
                  type="checkbox"
                  checked={config.events.pullRequest}
                  onChange={(e) =>
                    setConfig({
                      ...config,
                      events: { ...config.events, pullRequest: (e.target as HTMLInputElement).checked },
                    })
                  }
                />
                <div class="git-checkbox-text">
                  <strong>{t('gitWebhook.evPrTitle')}</strong>
                  <span>{t('gitWebhook.evPrDesc')}</span>
                </div>
              </label>

              <label class="git-checkbox-label">
                <input
                  type="checkbox"
                  checked={config.events.issueComment}
                  onChange={(e) =>
                    setConfig({
                      ...config,
                      events: { ...config.events, issueComment: (e.target as HTMLInputElement).checked },
                    })
                  }
                />
                <div class="git-checkbox-text">
                  <strong>{t('gitWebhook.evCommentTitle')}</strong>
                  <span>{t('gitWebhook.evCommentDesc')}</span>
                </div>
              </label>

              <label class="git-checkbox-label">
                <input
                  type="checkbox"
                  checked={config.events.push}
                  onChange={(e) =>
                    setConfig({
                      ...config,
                      events: { ...config.events, push: (e.target as HTMLInputElement).checked },
                    })
                  }
                />
                <div class="git-checkbox-text">
                  <strong>{t('gitWebhook.evPushTitle')}</strong>
                  <span>{t('gitWebhook.evPushDesc')}</span>
                </div>
              </label>
            </div>

            {/* 审查模型与唤醒触发控制栏：单行水平并排 (模型 ➔ 思考强度 ➔ 唤醒词胶囊) */}
            <div class="git-model-trigger-panel" style={{ marginTop: '12px' }}>
              <div class="git-model-trigger-header">
                <span class="git-form-label">{t('gitWebhook.modelAndKeywordTitle')}</span>
              </div>
              
              <div class="git-model-trigger-row">
                <div class="git-model-selector-wrapper">
                  <ModelSelector
                    value={config.reviewModel || null}
                    onChange={(p) => setConfig({ ...config, reviewModel: p })}
                    direction="down"
                  />
                </div>

                <div class="git-inline-keyword-capsule">
                  <span class="git-inline-keyword-label">{t('gitWebhook.keywordInlineLabel')}:</span>
                  <input
                    type="text"
                    class="git-inline-keyword-input"
                    placeholder="@bot"
                    value={config.triggerKeyword}
                    onInput={(e) => setConfig({ ...config, triggerKeyword: (e.target as HTMLInputElement).value.trim() })}
                  />
                </div>
              </div>

              <span class="git-input-hint" style={{ marginTop: '2px', display: 'block' }}>
                {t('gitWebhook.reviewModelHint')} · {t('gitWebhook.keywordHint')}
              </span>
            </div>

            <div class="git-form-grid" style={{ marginTop: '12px' }}>
              <div class="git-form-item" style={{ display: 'flex', flexDirection: 'column', justifyContent: 'center', gap: '10px' }}>
                <div>
                  <label class="git-switch-inline-label">
                    <input
                      type="checkbox"
                      checked={config.autoReviewNewPr}
                      onChange={(e) => setConfig({ ...config, autoReviewNewPr: (e.target as HTMLInputElement).checked })}
                    />
                    <span>{t('gitWebhook.autoReviewLabel')}</span>
                  </label>
                  <span class="git-input-hint" style={{ display: 'block', marginTop: '3px' }}>
                    {t('gitWebhook.autoReviewHint')}
                  </span>
                </div>

                <div>
                  <label class="git-switch-inline-label">
                    <input
                      type="checkbox"
                      checked={config.updateExistingComment}
                      onChange={(e) => setConfig({ ...config, updateExistingComment: (e.target as HTMLInputElement).checked })}
                    />
                    <span>{t('gitWebhook.updateExistingCommentLabel')}</span>
                  </label>
                  <span class="git-input-hint" style={{ display: 'block', marginTop: '3px' }}>
                    {t('gitWebhook.updateExistingCommentHint')}
                  </span>
                </div>
              </div>
            </div>
          </div>

          {/* 适配器第 5 区：项目专属审查提示词模板 (大编辑框) */}
          <div class="git-form-section">
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '8px' }}>
              <div class="git-section-title" style={{ margin: 0 }}>
                <span>5. {t('gitWebhook.sec4Title')}</span>
              </div>
              <button
                type="button"
                class="git-text-action-btn"
                onClick={handleResetPrompt}
                title={t('gitWebhook.resetPrompt')}
              >
                {t('gitWebhook.resetPrompt')}
              </button>
            </div>
            
            <textarea
              class="git-textarea"
              rows={10}
              placeholder={t('gitWebhook.promptPlaceholder')}
              value={config.reviewPromptTemplate}
              onInput={(e) => setConfig({ ...config, reviewPromptTemplate: (e.target as HTMLTextAreaElement).value })}
            />
            <span class="git-input-hint">
              {t('gitWebhook.promptHint')}
            </span>
          </div>

        </div>

        {/* 弹窗底部操作栏 */}
        <div class="modal-footer git-webhook-footer" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '12px 20px', borderTop: '1px solid var(--app-menu-border)' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <button
              type="button"
              class="git-test-btn"
              onClick={handleTestOrTrigger}
            >
              {config.syncMode === 'webhook' ? t('gitWebhook.testBtn') : t('gitWebhook.pollingManualCheck')}
            </button>
            {toastMsg && <span class="git-footer-toast">{toastMsg}</span>}
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <button type="button" class="git-cancel-btn" onClick={onClose}>
              {t('common.cancel')}
            </button>
            <button type="button" class="git-save-btn" onClick={handleSave}>
              {t('gitWebhook.saveBtn')}
            </button>
          </div>
        </div>

      </div>
    </div>
  );
}
