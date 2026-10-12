/**
 * Cloudflare Pages Function: /api/releases
 * 
 * 作用：作为 GitHub Releases 的全球边缘智能缓存中继，
 * 解决海外 VPN / 共享出口 IP 遭遇 GitHub API 60次/小时 Rate Limit 的问题。
 * 核心机制：优先从 GitHub 官方公开的 releases.atom (RSS Feed) 解析，
 * 完全绕过未授权 GitHub REST API 60次/小时硬限制，零限流！
 * 全球 CDN 边缘缓存 70 秒，带跨域 CORS 头，支持高并发。
 */

export async function onRequest(context) {
  const cacheUrl = new URL(context.request.url);
  const cacheKey = new Request(cacheUrl.toString(), context.request);
  const cache = caches.default;

  // 1. 尝试从 Cloudflare 边缘缓存命中
  try {
    const cachedResponse = await cache.match(cacheKey);
    if (cachedResponse) {
      return cachedResponse;
    }
  } catch (_) {}

  // 2. 优先通过 GitHub 公开 releases.atom 抓取（免除任何 GitHub API 60次/小时限流），
  //    若失败则回退至 api.github.com 接口
  let releases = [];
  try {
    const atomResp = await fetch('https://github.com/jeikl/JeikCode/releases.atom', {
      headers: {
        'User-Agent': 'JeikCode-Cloudflare-Relay',
        'Accept': 'application/atom+xml, text/xml, */*',
      },
    });
    if (atomResp.ok) {
      const xml = await atomResp.text();
      releases = parseReleasesFromAtom(xml);
    }
  } catch (_) {}

  // 3. 若 Atom 解析为空，回退到 api.github.com
  if (!releases.length) {
    try {
      const ghResp = await fetch('https://api.github.com/repos/jeikl/JeikCode/releases?per_page=30', {
        headers: {
          'User-Agent': 'JeikCode-Cloudflare-Relay',
          'Accept': 'application/vnd.github+json',
        },
      });
      if (ghResp.ok) {
        releases = await ghResp.json();
      }
    } catch (_) {}
  }

  if (!releases.length) {
    return new Response(JSON.stringify({ error: 'Failed to fetch release information' }), {
      status: 502,
      headers: {
        'Content-Type': 'application/json; charset=utf-8',
        'Access-Control-Allow-Origin': '*',
        'Cache-Control': 'no-cache, no-store',
      },
    });
  }

  const response = new Response(JSON.stringify(releases), {
    status: 200,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, HEAD, OPTIONS',
      'Cache-Control': 'public, max-age=70, s-maxage=70, stale-while-revalidate=10',
    },
  });

  try {
    context.waitUntil(cache.put(cacheKey, response.clone()));
  } catch (_) {}

  return response;
}

function parseReleasesFromAtom(xml) {
  const list = [];
  const entryRegex = /<entry>([\s\S]*?)<\/entry>/g;
  let m;
  while ((m = entryRegex.exec(xml)) !== null) {
    const block = m[1];
    const titleMatch = block.match(/<title>(?:JeikCode\s+)?(v[0-9][^<]*)<\/title>/);
    const updatedMatch = block.match(/<updated>([^<]*)<\/updated>/);
    if (titleMatch) {
      const tag = titleMatch[1].trim();
      const cleanVer = tag.replace(/^v/, '');
      list.push({
        tag_name: tag,
        prerelease: tag.includes('-'),
        published_at: updatedMatch ? updatedMatch[1].trim() : null,
        html_url: `https://github.com/jeikl/JeikCode/releases/tag/${tag}`,
        assets: [
          { name: `jeikcode-${tag}-windows-x64.exe`, browser_download_url: `https://github.com/jeikl/JeikCode/releases/download/${tag}/jeikcode-${tag}-windows-x64.exe` },
          { name: `jeikcode-${tag}-darwin-arm64`, browser_download_url: `https://github.com/jeikl/JeikCode/releases/download/${tag}/jeikcode-${tag}-darwin-arm64` },
          { name: `jeikcode-${tag}-darwin-x64`, browser_download_url: `https://github.com/jeikl/JeikCode/releases/download/${tag}/jeikcode-${tag}-darwin-x64` },
          { name: `jeikcode-${tag}-linux-x64`, browser_download_url: `https://github.com/jeikl/JeikCode/releases/download/${tag}/jeikcode-${tag}-linux-x64` },
          { name: `jeikcode-${tag}-linux-arm64`, browser_download_url: `https://github.com/jeikl/JeikCode/releases/download/${tag}/jeikcode-${tag}-linux-arm64` },
          { name: `JeikCode-Desktop-Setup-${tag}.exe`, browser_download_url: `https://github.com/jeikl/JeikCode/releases/download/${tag}/JeikCode.Desktop_${cleanVer}_x64-setup.exe` },
          { name: `JeikCode-Desktop-${tag}.dmg`, browser_download_url: `https://github.com/jeikl/JeikCode/releases/download/${tag}/JeikCode.Desktop_${cleanVer}_aarch64.dmg` },
          { name: `JeikCode-Desktop-x64-${tag}.dmg`, browser_download_url: `https://github.com/jeikl/JeikCode/releases/download/${tag}/JeikCode.Desktop_${cleanVer}_x64.dmg` },
          { name: `JeikCode-Desktop-${tag}.AppImage`, browser_download_url: `https://github.com/jeikl/JeikCode/releases/download/${tag}/JeikCode.Desktop_${cleanVer}_amd64.AppImage` },
          { name: `JeikCode-Desktop-${tag}.deb`, browser_download_url: `https://github.com/jeikl/JeikCode/releases/download/${tag}/JeikCode.Desktop_${cleanVer}_amd64.deb` },
        ],
      });
    }
  }
  return list;
}

export async function onRequestOptions() {
  return new Response(null, {
    status: 204,
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, HEAD, OPTIONS',
      'Access-Control-Allow-Headers': '*',
    },
  });
}
