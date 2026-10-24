import { parseFilePathAndLines } from './displayPath.ts';

// 系统默认应用直接打开的非纯文本/程序/归档/镜像/办公文件扩展名（生活办公与软件开发调试常用）
export const SYSTEM_APP_FILE_EXTS =
  'exe|zip|rar|iso|7z|tar|gz|bz2|xz|tgz|dmg|pkg|apk|msi|bin|img|vhd|vhdx|doc|docx|ppt|pptx|xls|xlsx|csv|pdf|mp4|mp3|wav|mov|avi|mkv|flv|wmv|m4a|aac|flac';

// 全量文件扩展名列表（包含全语言源码、配置、脚本、资源、文档、压缩包、镜像与可执行程序）
export const ALL_FILE_EXTS = `kt|kts|java|c|cpp|cc|cxx|h|hpp|hxx|cs|swift|m|mm|scala|clj|cljs|rs|go|py|pyw|rb|php|pl|pm|lua|r|dart|ts|tsx|js|jsx|mjs|cjs|json|json5|jsonc|toml|yaml|yml|xml|html|htm|xhtml|css|scss|sass|less|styl|sh|bash|zsh|fish|ps1|psm1|bat|cmd|sql|prisma|proto|graphql|gql|vue|svelte|astro|md|markdown|mdx|txt|text|log|diff|patch|env|properties|ini|conf|cfg|lock|svg|png|jpg|jpeg|gif|webp|ico|bmp|avif|gradle|cmake|dockerfile|containerfile|nix|${SYSTEM_APP_FILE_EXTS}`;

export const EXT_REGEX = new RegExp(`\\.(${ALL_FILE_EXTS})$`, 'i');
export const SYSTEM_APP_EXT_REGEX = new RegExp(`\\.(${SYSTEM_APP_FILE_EXTS})$`, 'i');
export const ROOT_DIRS_REGEX =
  /^(crates|src|webui|packages|desktop|docs|scripts|extensions|functions|plans|tests|assets|public|internal|cmd|api|lib)\/[\w.\-\\/]+$/i;

export const CLI_COMMAND_STARTS = new Set([
  'npm', 'npx', 'pnpm', 'yarn', 'bun', 'node', 'deno',
  'cargo', 'rustc', 'rustup',
  'git', 'gh', 'svn', 'hg',
  'python', 'python3', 'py', 'pip', 'pip3', 'pytest',
  'go', 'gofmt',
  'docker', 'docker-compose', 'podman', 'kubectl', 'helm',
  'bash', 'sh', 'zsh', 'fish', 'source', 'export',
  'cat', 'grep', 'find', 'awk', 'sed', 'cd', 'ls', 'dir',
  'cp', 'mv', 'rm', 'mkdir', 'touch', 'chmod', 'chown',
  'curl', 'wget', 'ssh', 'scp', 'tar', 'zip', 'unzip',
  'make', 'cmake', 'ninja', 'mvn', 'gradle',
  'vite', 'tsc', 'eslint', 'prettier', 'jest', 'vitest',
]);

/**
 * 智能识别一段文本是否是 CLI 终端命令行，防止命令代码被误当成文件路径
 */
export function isCommandSnippet(text: string): boolean {
  const t = (text || '').trim().replace(/^['"`]|['"`]$/g, '');
  if (!t) return false;

  // 1. 包含命令行连接符、管道符、分号或重定向符
  if (/(\s+&&\s+|\s+\|\|\s+|\s+\|\s+|\s+>>?\s+|\s+<<?\s+|;\s*)/.test(t)) return true;

  // 2. 包含典型的命令行参数标志 (如 --test, -v, -p, --save-dev, -rf)
  if (/\s+--?[a-zA-Z0-9]/.test(t)) return true;

  // 3. 以常见 CLI 命令关键字开头且附带参数 (如 npm run, git status, node --test)
  const firstWord = t.split(/[\s/\\:]/)[0]?.toLowerCase();
  if (firstWord && CLI_COMMAND_STARTS.has(firstWord) && /\s+/.test(t)) {
    return true;
  }

  // 4. 包含空格且含常见命令行动词 (run build, test, install 等)
  if (/\s+(?:run|build|test|start|install|add|commit|checkout|push|pull|revert|fetch|merge|diff|status|serve|watch)\b/i.test(t)) {
    return true;
  }

  return false;
}

/**
 * 智能判断路径是否属于应当以系统默认应用打开的程序/压缩包/办公文档/镜像文件 (.exe, .zip, .rar, .iso, .docx, .xlsx 等)
 */
export function isSystemDefaultAppFile(filePath: string): boolean {
  const clean = filePath.trim().replace(/^['"`]|['"`]$/g, '').replace(/:\d+(?::\d+)?$/, '');
  const segs = clean.split(/[\\/]/).filter(Boolean);
  const lastSeg = segs.length > 0 ? segs[segs.length - 1]! : clean;
  return SYSTEM_APP_EXT_REGEX.test(lastSeg);
}

/**
 * 智能识别一段文本是否是项目源码/资源文件或目录路径（支持末尾带或不带斜杠，支持相对与绝对路径）
 */
export function isFilePathSnippet(text: string): boolean {
  if (isCommandSnippet(text)) return false;

  const { filePath } = parseFilePathAndLines(text);
  const t = filePath.trim().replace(/^['"`]|['"`]$/g, '');
  if (t.length < 2 || t.length > 350) return false;
  if (/^(https?:|\/\/)/i.test(t) || /^www\./i.test(t)) return false;

  // 1. 标准扩展名匹配 (全语言源码、脚本、配置、文本及资源、程序、归档与办公文档)
  if (EXT_REGEX.test(t)) return true;

  // 2. 绝对路径特征 (Windows盘符路径 如 C:/, D:\, POSIX绝对路径 如 /home/..., /var/...)
  if (/^[a-zA-Z]:[\\/][^\0<>:"|?*]+$/i.test(t)) return true;
  if (/^\/[^\0\r\n\t]+$/i.test(t)) return true;

  // 3. 相对路径前缀特征 (./ 或 ../ 或 .\ 或 ..\)
  if (/^\.{1,2}[\\/][^\0<>:"|?*]+$/i.test(t)) return true;

  // 4. 显式以斜杠结尾的目录特征 (如 src/, webui/src/, crates/)
  if (/[\\/]$/.test(t) && /[\w.\-\\/]/.test(t)) return true;

  // 5. 常见工程目录层级结构 (如 crates/jeikcode-daemon, src/components, webui/src 等)
  if (ROOT_DIRS_REGEX.test(t)) return true;

  return false;
}

/**
 * 智能判断路径是否是目录 (支持末尾带/不带/，支持绝对和相对路径)
 */
export function isLikelyDirPath(pathStr: string): boolean {
  const clean = pathStr.trim().replace(/^['"`]|['"`]$/g, '');
  if (!clean) return false;
  // 1. 显式末尾带斜杠或反斜杠必定为目录
  if (clean.endsWith('/') || clean.endsWith('\\')) return true;
  // 2. 纯盘符根目录 (如 C:, D:)
  if (/^[a-zA-Z]:$/i.test(clean)) return true;
  // 3. 检查路径的最后一段
  const segs = clean.split(/[\\/]/).filter(Boolean);
  if (segs.length === 0) return false;
  const lastSeg = segs[segs.length - 1]!;
  // 若包含标准文件扩展名则为文件（防止 .exe/.zip/.rar/.iso 等带路径时被误判为目录）
  if (EXT_REGEX.test(lastSeg)) return false;
  // 过滤常见的无后缀单文件名
  if (/^(dockerfile|containerfile|makefile|license|gemfile|procfile|vagrantfile|cargofile)$/i.test(lastSeg)) {
    return false;
  }
  // 包含层级分隔符且无扩展名，即为目录
  return clean.includes('/') || clean.includes('\\');
}

/**
 * 计算适应页面缩放比例 (Page Zoom) 的右键菜单视口坐标，防止任何放大缩小比例下菜单漂移或溢出视口
 */
export function computeFileContextMenuPosition(
  clientX: number,
  clientY: number,
  zoom = 1.0,
  isDir = false,
  viewportWidth = 1024,
  viewportHeight = 768,
): { x: number; y: number } {
  const effectiveZoom = zoom > 0 ? zoom : 1.0;
  const rawX = Math.round(clientX / effectiveZoom);
  const rawY = Math.round(clientY / effectiveZoom);

  const menuWidth = 205;
  const menuHeight = isDir ? 125 : 225;
  const maxX = Math.round(viewportWidth / effectiveZoom) - 10;
  const maxY = Math.round(viewportHeight / effectiveZoom) - 10;

  const posX = rawX + menuWidth > maxX ? Math.max(8, rawX - menuWidth) : Math.max(8, rawX);
  const posY = rawY + menuHeight > maxY ? Math.max(8, rawY - menuHeight) : Math.max(8, rawY);

  return { x: posX, y: posY };
}
