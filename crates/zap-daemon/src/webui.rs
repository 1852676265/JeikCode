//! 嵌入式 webui 静态资源服务。
//!
//! 编译期把 `webui/dist/` 打进二进制；运行期 `GET /` 与未匹配的非 API 路径
//! 都回退到 `index.html`，交给前端 SPA 路由。
//!
//! dev 模式（设置 `JEIKCODE_WEBUI_DEV=http://localhost:5173`）下应改为反代/
//! 重定向到 vite dev server——后续任务实现。

use axum::{
    http::{header, StatusCode, Uri},
    response::{IntoResponse, Response},
};

/// 尝试从本地插件目录提供静态资源服务。
///
/// 允许外部扩展插件（如 DevOrbit 等独立项目编译产物）直接由 Daemon 托管。
/// 严格限定在插件根目录下，防范任意路径穿越；若文件不存在则严格返回 404，
/// 绝对不回退至 Zap 自身的 index.html，防止破坏 iframe 内部脚本的 MIME 解析。
pub async fn try_serve_plugin_asset(path: &str) -> Option<Response> {
    let p = path.trim_start_matches('/');
    // 仅拦截以 plugins/ 或 plugins-local/ 开头的请求
    let (_prefix, rest) = if let Some(rest) = p.strip_prefix("plugins/") {
        ("plugins/", rest)
    } else if let Some(rest) = p.strip_prefix("plugins-local/") {
        ("plugins-local/", rest)
    } else if p == "plugins" || p == "plugins-local" {
        return Some((StatusCode::NOT_FOUND, "plugin id required").into_response());
    } else {
        return None;
    };

    // 提取 plugin_id 和 subpath
    let (plugin_id, subpath) = match rest.split_once('/') {
        Some((id, s)) => (id, s),
        None => (rest, ""),
    };

    if plugin_id.is_empty() {
        return Some((StatusCode::NOT_FOUND, "plugin id empty").into_response());
    }

    // 安全检查：plugin_id 仅允许字母、数字、短横线、下划线
    if !plugin_id
        .chars()
        .all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_')
    {
        return Some((StatusCode::BAD_REQUEST, "invalid plugin id").into_response());
    }

    let raw_subpath = subpath.split('?').next().unwrap_or("").trim_matches('/');
    let clean_subpath = if raw_subpath.is_empty() {
        "index.html"
    } else {
        raw_subpath
    };

    // 安全防穿透：禁止包含 .. 或绝对路径前缀
    if clean_subpath.contains("..")
        || clean_subpath.starts_with('/')
        || clean_subpath.starts_with('\\')
    {
        return Some((StatusCode::FORBIDDEN, "forbidden path traversal").into_response());
    }

    // 构建候选根目录列表（跨平台支持用户主目录、自定义目录与本地工作区）
    let mut candidate_roots = Vec::new();
    if let Some(home) = zap_config::util::real_home_dir() {
        candidate_roots.push(home.join(".zap").join("plugins").join(plugin_id).join("dist"));
        candidate_roots.push(home.join(".zap").join("plugins").join(plugin_id).join("web"));
        candidate_roots.push(home.join(".zap").join("plugins").join(plugin_id));
        candidate_roots.push(home.join(".jeikcode").join("plugins").join(plugin_id).join("dist"));
        candidate_roots.push(home.join(".jeikcode").join("plugins").join(plugin_id));
    }
    if let Ok(custom_dir) = std::env::var("ZAP_PLUGINS_DIR") {
        candidate_roots.push(std::path::PathBuf::from(&custom_dir).join(plugin_id).join("dist"));
        candidate_roots.push(std::path::PathBuf::from(&custom_dir).join(plugin_id));
    }
    #[cfg(windows)]
    {
        candidate_roots.push(std::path::PathBuf::from(format!("D:/Projects/{plugin_id}/dist")));
        candidate_roots.push(std::path::PathBuf::from(format!("D:/Projects/{plugin_id}")));
    }

    for root in candidate_roots {
        if !root.is_dir() {
            continue;
        }

        let target_file = root.join(clean_subpath);
        // 防穿越二次确认：规范化路径前缀校验
        if let Ok(canon_root) = root.canonicalize() {
            if let Ok(canon_target) = target_file.canonicalize() {
                if !canon_target.starts_with(&canon_root) {
                    continue;
                }
            }
        }

        if target_file.is_file() {
            if let Ok(content) = std::fs::read(&target_file) {
                let mime = mime_guess::from_path(&target_file).first_or_octet_stream();
                let cache_control = if clean_subpath == "index.html" {
                    "no-cache"
                } else if clean_subpath.starts_with("assets/") {
                    "public, max-age=31536000, immutable"
                } else {
                    "public, max-age=3600"
                };
                return Some(
                    (
                        [
                            (header::CONTENT_TYPE, mime.as_ref()),
                            (header::CACHE_CONTROL, cache_control),
                        ],
                        content,
                    )
                        .into_response(),
                );
            }
        }

        // SPA 路由回退：如果未带扩展名（如 /plugins/dev-orbit/dashboard），且根目录下有 index.html
        if !clean_subpath.contains('.') {
            let index_file = root.join("index.html");
            if index_file.is_file() {
                if let Ok(content) = std::fs::read(&index_file) {
                    return Some(
                        (
                            [
                                (header::CONTENT_TYPE, "text/html; charset=utf-8"),
                                (header::CACHE_CONTROL, "no-cache"),
                            ],
                            content,
                        )
                            .into_response(),
                    );
                }
            }
        }
    }

    // 严禁 fallback 到 Zap 的 index.html！对插件路径严格返回 404
    Some((StatusCode::NOT_FOUND, format!("plugin '{plugin_id}' asset '{clean_subpath}' not found")).into_response())
},
};
use rust_embed::RustEmbed;

#[derive(RustEmbed)]
#[folder = "../../webui/dist/"]
#[allow_missing = true]
pub struct WebuiAssets;

/// 取静态资源；未命中时回退 index.html 的内容（SPA）。
pub fn asset_or_index(path: &str) -> Option<std::borrow::Cow<'static, [u8]>> {
    let p = path.trim_start_matches('/');
    if let Some(f) = WebuiAssets::get(p) {
        return Some(f.data);
    }
    WebuiAssets::get("index.html").map(|f| f.data)
}

/// axum handler：服务任意 webui 路径。
pub async fn serve_webui(uri: Uri) -> Response {
    // dev 模式：设置 JEIKCODE_WEBUI_DEV=http://localhost:5173 后，
    // 重定向到 vite dev server，前端开发可享受热更新而非嵌入 bundle。
    if let Ok(dev) = std::env::var("JEIKCODE_WEBUI_DEV") {
        let target = format!("{}{}", dev.trim_end_matches('/'), uri.path());
        return axum::response::Redirect::temporary(&target).into_response();
    }

    let path = uri.path();

    // 优先拦截本地扩展插件静态资源（/plugins/{plugin_id}/* 或 /plugins-local/{plugin_id}/*）
    if let Some(resp) = try_serve_plugin_asset(path).await {
        return resp;
    }

    let p = path.trim_start_matches('/');
    let lookup = if p.is_empty() { "index.html" } else { p };
    match WebuiAssets::get(lookup) {
        Some(content) => {
            let mime = mime_guess::from_path(lookup).first_or_octet_stream();
            // 动静分级缓存策略：
            // 1. 带内容 Hash 的编译产物（assets/*）：永久强缓存（immutable），二次冷启动 0ms 命中本地磁盘缓存；
            // 2. index.html：强制 no-cache（必须向服务端核对，确保发版后即时拉取最新 Hash 资源）；
            // 3. 其他根静态资源（如 favicon.png）：短期缓存 1 小时。
            let cache_control = if lookup == "index.html" {
                "no-cache"
            } else if lookup.starts_with("assets/") {
                "public, max-age=31536000, immutable"
            } else {
                "public, max-age=3600"
            };
            (
                [
                    (header::CONTENT_TYPE, mime.as_ref()),
                    (header::CACHE_CONTROL, cache_control),
                ],
                content.data,
            )
                .into_response()
        }
        None => match WebuiAssets::get("index.html") {
            Some(index) => (
                [
                    (header::CONTENT_TYPE, "text/html"),
                    (header::CACHE_CONTROL, "no-cache"),
                ],
                index.data,
            )
                .into_response(),
            None => (StatusCode::NOT_FOUND, "webui not built").into_response(),
        },
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn serves_embedded_index() {
        assert!(
            WebuiAssets::get("index.html").is_some(),
            "index.html should be embedded"
        );
    }

    #[test]
    fn unknown_path_falls_back_to_index() {
        // 未知路径回退 index.html 内容（SPA 路由）
        assert!(
            asset_or_index("some/spa/route").is_some(),
            "SPA route should fall back to index"
        );
    }
}
