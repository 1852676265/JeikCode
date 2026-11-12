/**
 * Path helpers for webui display.
 *
 * Windows `canonicalize` / `std::fs::canonicalize` returns extended-length
 * paths like `\\?\E:\desktop`. Showing that raw string in the cwd chip is
 * noisy and confuses users — strip the prefix for display only.
 */

/**
 * Strip Windows extended-length prefixes:
 *   `\\?\C:\...`  `\\?\UNC\server\share`
 *   `//?/C:/...`  `//?/UNC/server/share`   (backslashes folded to slashes)
 *   `/?/C:/...`   `/?/UNC/server/share`    (one slash dropped on the way)
 * A POSIX path is unchanged. `/?/` is removed only when a drive letter or
 * `UNC/` follows, so a real directory named `?` is kept.
 */
export function stripExtendedPathPrefix(path: string): string {
  if (!path) return '';
  if (/^\\\\\?\\UNC\\/i.test(path)) {
    return '\\\\' + path.slice('\\\\?\\UNC\\'.length);
  }
  if (/^\/\/\?\/UNC\//i.test(path)) {
    return '//' + path.slice('//?/UNC/'.length);
  }
  if (/^\/\?\/UNC\//i.test(path)) {
    return '//' + path.slice('/?/UNC/'.length);
  }
  if (/^\\\\\?\\/i.test(path)) {
    return path.slice(4);
  }
  if (/^\/\/\?\//i.test(path)) {
    return path.slice(4);
  }
  let out = path;
  if (/^\/\?\/[A-Za-z]:/.test(path)) {
    out = path.slice(3);
  }
  // IME fullwidth colon: `E：/xxxx` is the same drive as `E:/xxxx`.
  return out.replace(/^([A-Za-z])\uFF1A/, '$1:');
}

export interface FsCrumb {
  label: string;
  fullPath: string;
}

/** Breadcrumbs that understand drive letters, UNC shares, and `\\?\` / `/?/`. */
export function fsBreadcrumbs(raw: string): FsCrumb[] {
  const path = stripExtendedPathPrefix(raw).replace(/[/\\]+$/, '');
  if (!path || path === '/' || path === '\\') {
    return [{ label: '/', fullPath: '/' }];
  }

  const unc = path.match(/^\\\\([^\\]+)\\([^\\]+)\\?(.*)$/)
    || path.match(/^\/\/([^/]+)\/([^/]+)\/?(.*)$/);
  if (unc) {
    const sep = path.startsWith('\\\\') ? '\\' : '/';
    const root = sep === '\\'
      ? `\\\\${unc[1]}\\${unc[2]}`
      : `//${unc[1]}/${unc[2]}`;
    const crumbs: FsCrumb[] = [{ label: root, fullPath: root }];
    let acc = root;
    for (const part of (unc[3] || '').split(/[/\\]/).filter(Boolean)) {
      acc = joinFsChild(acc, part);
      crumbs.push({ label: part, fullPath: acc });
    }
    return crumbs;
  }

  const drive = path.match(/^([A-Za-z]:)[/\\]?(.*)$/);
  if (drive) {
    const sep = path.includes('\\') ? '\\' : '/';
    const root = drive[1] + sep;
    const crumbs: FsCrumb[] = [{ label: drive[1], fullPath: root }];
    let acc = root;
    for (const part of (drive[2] || '').split(/[/\\]/).filter(Boolean)) {
      acc = joinFsChild(acc, part);
      crumbs.push({ label: part, fullPath: acc });
    }
    return crumbs;
  }

  const parts = path.split('/').filter(Boolean);
  const crumbs: FsCrumb[] = [{ label: '/', fullPath: '/' }];
  let acc = '';
  for (const part of parts) {
    acc += '/' + part;
    crumbs.push({ label: part, fullPath: acc });
  }
  return crumbs;
}

/** Append one directory name without gluing a `/?/` or mixed separator on. */
export function joinFsChild(baseRaw: string, name: string): string {
  const stripped = stripExtendedPathPrefix(baseRaw);
  const child = name.replace(/^[/\\]+|[/\\]+$/g, '');
  if (!child) return stripped;
  if (!stripped || stripped === '/' || stripped === '\\') {
    return '/' + child;
  }
  const trimmed = stripped.replace(/[/\\]+$/, '');
  if (/^[A-Za-z]:$/.test(trimmed)) {
    const sep = stripped.includes('\\') ? '\\' : '/';
    return trimmed + sep + child;
  }
  const sep = trimmed.startsWith('\\\\') || trimmed.includes('\\') ? '\\' : '/';
  return trimmed + sep + child;
}

/** Collapse home prefixes to `~` for readability. */
export function collapseHomePath(path: string): string {
  const p = stripExtendedPathPrefix(path);
  if (!p) return '';
  return p
    .replace(/^\/(?:Users|home)\/[^/]+/, '~')
    .replace(/^[A-Za-z]:[/\\]Users[/\\][^/\\]+/i, '~');
}

/** Short display path for the input cwd chip / breadcrumbs. */
export function displayPath(path: string): string {
  return collapseHomePath(path);
}

/** Page hostname that is the daemon machine itself (native folder dialog is local). */
export function isLoopbackHost(hostname: string): boolean {
  const host = hostname.trim().toLowerCase().replace(/^\[|\]$/g, '');
  return host === 'localhost' || host === '127.0.0.1' || host === '::1';
}

/** Last path segment (project folder name), separator-agnostic. */
export function pathBasename(path: string): string {
  const p = stripExtendedPathPrefix(path).replace(/[/\\]+$/, '');
  if (!p) return '';
  const parts = p.split(/[/\\]/);
  return parts[parts.length - 1] || p;
}

/**
 * 计算文件相对于项目工作目录的完整相对路径。
 * 支持单仓库、多 Git 仓库（子仓位于项目子目录）与跨平台盘符标准化。
 */
export function getRelativePathToProject(filePath: string, repoRoot?: string, projectCwd?: string): string {
  const cleanFile = stripExtendedPathPrefix(filePath || '').trim().replace(/\\/g, '/');
  if (!cleanFile) return '';
  if (!repoRoot || !projectCwd) return cleanFile.replace(/^\.?\/+/, '');

  const normRepo = stripExtendedPathPrefix(repoRoot).trim().replace(/\\/g, '/').replace(/\/+$/, '');
  const normProject = stripExtendedPathPrefix(projectCwd).trim().replace(/\\/g, '/').replace(/\/+$/, '');

  // 1. 如果 cleanFile 本身是绝对路径
  if (/^[a-zA-Z]:\//.test(cleanFile) || cleanFile.startsWith('/')) {
    if (cleanFile.toLowerCase().startsWith(normProject.toLowerCase())) {
      const rest = cleanFile.slice(normProject.length).replace(/^\/+/, '');
      return rest || pathBasename(cleanFile);
    }
    return cleanFile;
  }

  // 2. 如果 repoRoot 是 projectCwd 的子目录 (多仓场景，如 project/crates/foo)
  if (normRepo.toLowerCase().startsWith(normProject.toLowerCase())) {
    const subRepo = normRepo.slice(normProject.length).replace(/^\/+/, '');
    if (subRepo) {
      return `${subRepo}/${cleanFile.replace(/^\.?\/+/, '')}`;
    }
    return cleanFile.replace(/^\.?\/+/, '');
  }

  return cleanFile.replace(/^\.?\/+/, '');
}

export interface ParsedFilePathWithLine {
  filePath: string;
  startLine?: number;
  endLine?: number;
}

/**
 * 健壮解析文件路径及其附属行号标记。
 * 支持半角冒号与全角冒号（:、：）、斜杠（/）、井号（#L），
 * 以及范围号（~、-、～、—、..）与单行号（:3000、：3000、:3000:15）。
 */
export function parseFilePathAndLines(raw: string): ParsedFilePathWithLine {
  let cleaned = (raw || '').trim().replace(/^['"`]|['"`]$/g, '');
  let startLine: number | undefined;
  let endLine: number | undefined;

  // 1. 匹配多行范围：如 :3000~10000, :L3000-10000, ：L3000～10000, /3000-10000, #L3000-L10000, L3000-10000, :3000..10000
  const rangeMatch = cleaned.match(/([:：#/]|\s+)(?:L)?(\d+)\s*(?:[~\-～—–至]|(?:\.\.)|(?:-L))\s*(?:L)?(\d+)$/i);
  if (rangeMatch && rangeMatch.index !== undefined) {
    startLine = parseInt(rangeMatch[2], 10);
    endLine = parseInt(rangeMatch[3], 10);
    cleaned = cleaned.slice(0, rangeMatch.index);
  } else {
    // 2. 匹配单行号或行列号：如 :3000, ：3000, :L3000, ：L3000, /3000, #L3000, L3000, :3000:10, ：3000：10
    const singleMatch = cleaned.match(/([:：#/]|\s+)(?:L)?(\d+)(?:[:：]\d+)?$/i);
    if (singleMatch && singleMatch.index !== undefined) {
      startLine = parseInt(singleMatch[2], 10);
      cleaned = cleaned.slice(0, singleMatch.index);
    }
  }

  return {
    filePath: cleaned.trim(),
    startLine: Number.isFinite(startLine) && startLine! > 0 ? startLine : undefined,
    endLine: Number.isFinite(endLine) && endLine! > 0 ? endLine : undefined,
  };
}
