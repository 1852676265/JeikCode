/** Strip optional `v` prefix so `v7.0.13` and `7.0.13` compare/display the same. */
export function normalizeAppVersion(raw: string | undefined | null): string {
  return String(raw ?? '').trim().replace(/^v/i, '');
}

/** Sidebar brand label (`v7.0.13`). Empty input stays empty. */
export function formatAppVersionLabel(raw: string | undefined | null): string {
  const v = normalizeAppVersion(raw);
  return v ? `v${v}` : '';
}

/** Vite `define` fallback baked into the SPA. Empty when the constant is missing (tests). */
export function bakedAppVersion(): string {
  try {
    return typeof __APP_VERSION__ !== 'undefined' ? normalizeAppVersion(__APP_VERSION__) : '';
  } catch {
    return '';
  }
}

export function parseSemVer(v: string) {
  const clean = String(v || '').replace(/^v/i, '').trim();
  const [core, ...pre] = clean.split('-');
  const parts = core.split('.').map((n) => parseInt(n, 10) || 0);
  while (parts.length < 3) parts.push(0);
  return { raw: clean, parts, pre: pre.join('-') };
}

export function compareSemVer(v1: string, v2: string): number {
  const s1 = parseSemVer(v1);
  const s2 = parseSemVer(v2);
  for (let i = 0; i < 3; i++) {
    if (s1.parts[i] > s2.parts[i]) return 1;
    if (s1.parts[i] < s2.parts[i]) return -1;
  }
  // No prerelease is newer than prerelease with same major.minor.patch
  if (!s1.pre && s2.pre) return 1;
  if (s1.pre && !s2.pre) return -1;
  if (s1.pre && s2.pre) return s1.pre.localeCompare(s2.pre, undefined, { numeric: true });
  return 0;
}
