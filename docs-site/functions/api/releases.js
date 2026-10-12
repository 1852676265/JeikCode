/**
 * Cloudflare Pages Function: /api/releases
 * 
 * 作用：作为 GitHub Releases 的全球边缘智能缓存中继，
 * 解决海外 VPN / 共享出口 IP 遭遇 GitHub API 60次/小时 Rate Limit 的问题。
 * 全球 CDN 边缘缓存 70 秒，带跨域 CORS 头，支持并发。
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
  } catch (_) {
    // 缓存未就绪或受限时继续向上游拉取
  }

  // 2. 向上游 GitHub Releases API 请求最新发布（含正式版与预发布版）
  const upstreamUrl = 'https://api.github.com/repos/jeikl/JeikCode/releases?per_page=30';
  let ghResponse;
  try {
    ghResponse = await fetch(upstreamUrl, {
      headers: {
        'User-Agent': 'JeikCode-Cloudflare-Relay',
        'Accept': 'application/vnd.github+json',
      },
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: 'Failed to contact upstream GitHub', detail: String(err) }), {
      status: 502,
      headers: {
        'Content-Type': 'application/json; charset=utf-8',
        'Access-Control-Allow-Origin': '*',
      },
    });
  }

  if (!ghResponse.ok) {
    return new Response(await ghResponse.text(), {
      status: ghResponse.status,
      headers: {
        'Content-Type': 'application/json; charset=utf-8',
        'Access-Control-Allow-Origin': '*',
        'Cache-Control': 'no-cache, no-store',
      },
    });
  }

  const body = await ghResponse.text();
  const response = new Response(body, {
    status: 200,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, HEAD, OPTIONS',
      'Cache-Control': 'public, max-age=70, s-maxage=70, stale-while-revalidate=10',
    },
  });

  // 3. 异步写入 Cloudflare 全球边缘节点缓存 70 秒
  try {
    context.waitUntil(cache.put(cacheKey, response.clone()));
  } catch (_) {
    // 忽略缓存写入异常
  }

  return response;
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
