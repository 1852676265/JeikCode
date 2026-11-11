//! 官方与第三方插件管理 HTTP API 服务。
//!
//! 打通 WebUI 前端与后端 `zap-capabilities::plugin` 核心引擎，
//! 提供插件市场浏览、插件安装/卸载、生命周期同步与插件隔离沙箱存储能力。

use axum::{
    extract::Path,
    http::StatusCode,
    response::{IntoResponse, Json},
    routing::{delete, get, post},
    Router,
};
use serde::Deserialize;
use serde_json::{json, Value};
use std::path::PathBuf;
use zap_capabilities::plugin::{installer, marketplace, InstallScope};

use crate::AppState;

#[derive(Debug, Deserialize)]
pub struct InstallPluginRequest {
    #[serde(alias = "source")]
    pub plugin: String,
    pub marketplace: Option<String>,
    pub scope: Option<String>,
}

#[derive(Debug, Deserialize)]
pub struct UninstallPluginRequest {
    pub plugin: String,
    pub marketplace: Option<String>,
    pub scope: Option<String>,
}

#[derive(Debug, Deserialize)]
pub struct AddMarketplaceRequest {
    pub url: String,
}

#[derive(Debug, Deserialize)]
pub struct UpdateMarketplaceRequest {
    pub name: String,
}

#[derive(Debug, Deserialize)]
pub struct StorageGetRequest {
    pub plugin_id: String,
    pub key: String,
}

#[derive(Debug, Deserialize)]
pub struct StorageSetRequest {
    pub plugin_id: String,
    pub key: String,
    pub value: Value,
}

fn parse_scope(s: Option<&str>) -> InstallScope {
    match s.map(|v| v.to_ascii_lowercase()).as_deref() {
        Some("project") => InstallScope::Project,
        Some("local") => InstallScope::Local,
        _ => InstallScope::User,
    }
}

fn get_plugin_storage_file(plugin_id: &str) -> PathBuf {
    let sanitized: String = plugin_id
        .chars()
        .map(|c| if c.is_alphanumeric() || c == '-' || c == '_' { c } else { '_' })
        .collect();
    
    let base = if let Ok(home) = std::env::var("HOME") {
        PathBuf::from(home)
    } else if let Ok(userprofile) = std::env::var("USERPROFILE") {
        PathBuf::from(userprofile)
    } else {
        PathBuf::from(".")
    };
    base.join(".zap").join("plugin-storage").join(sanitized).join("storage.json")
}

pub fn router() -> Router<AppState> {
    Router::new()
        .route("/api/plugins/installed", get(list_installed_handler))
        .route("/api/plugins/install", post(install_handler))
        .route("/api/plugins/uninstall", post(uninstall_handler))
        .route("/api/plugins/marketplaces", get(list_marketplaces_handler).post(add_marketplace_handler))
        .route("/api/plugins/marketplaces/update", post(update_marketplace_handler))
        .route("/api/plugins/marketplaces/:name", delete(remove_marketplace_handler))
        .route("/api/plugins/storage/get", post(storage_get_handler))
        .route("/api/plugins/storage/set", post(storage_set_handler))
}

async fn list_installed_handler() -> impl IntoResponse {
    match installer::list_installed() {
        Ok(plugins) => (StatusCode::OK, Json(json!({ "success": true, "plugins": plugins }))).into_response(),
        Err(e) => (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(json!({ "success": false, "error": e.to_string() })),
        )
            .into_response(),
    }
}

async fn install_handler(Json(req): Json<InstallPluginRequest>) -> impl IntoResponse {
    let scope = parse_scope(req.scope.as_deref());
    let market = req.marketplace.as_deref().unwrap_or("");

    match installer::install(&req.plugin, market, scope) {
        Ok(info) => (StatusCode::OK, Json(json!({ "success": true, "plugin": info }))).into_response(),
        Err(e) => (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(json!({ "success": false, "error": e.to_string() })),
        )
            .into_response(),
    }
}

async fn uninstall_handler(Json(req): Json<UninstallPluginRequest>) -> impl IntoResponse {
    let scope = parse_scope(req.scope.as_deref());
    let market = req.marketplace.as_deref().unwrap_or("");

    match installer::uninstall(&req.plugin, market, scope) {
        Ok(()) => (StatusCode::OK, Json(json!({ "success": true }))).into_response(),
        Err(e) => (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(json!({ "success": false, "error": e.to_string() })),
        )
            .into_response(),
    }
}

async fn list_marketplaces_handler() -> impl IntoResponse {
    match marketplace::list_marketplaces() {
        Ok(markets) => (StatusCode::OK, Json(json!({ "success": true, "marketplaces": markets }))).into_response(),
        Err(e) => (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(json!({ "success": false, "error": e.to_string() })),
        )
            .into_response(),
    }
}

async fn add_marketplace_handler(Json(req): Json<AddMarketplaceRequest>) -> impl IntoResponse {
    match marketplace::add_marketplace(&req.url) {
        Ok(info) => (StatusCode::OK, Json(json!({ "success": true, "marketplace": info }))).into_response(),
        Err(e) => (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(json!({ "success": false, "error": e.to_string() })),
        )
            .into_response(),
    }
}

async fn update_marketplace_handler(Json(req): Json<UpdateMarketplaceRequest>) -> impl IntoResponse {
    match marketplace::update_marketplace(&req.name) {
        Ok(info) => (StatusCode::OK, Json(json!({ "success": true, "marketplace": info }))).into_response(),
        Err(e) => (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(json!({ "success": false, "error": e.to_string() })),
        )
            .into_response(),
    }
}

async fn remove_marketplace_handler(Path(name): Path<String>) -> impl IntoResponse {
    match marketplace::remove_marketplace(&name) {
        Ok(()) => (StatusCode::OK, Json(json!({ "success": true }))).into_response(),
        Err(e) => (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(json!({ "success": false, "error": e.to_string() })),
        )
            .into_response(),
    }
}

async fn storage_get_handler(Json(req): Json<StorageGetRequest>) -> impl IntoResponse {
    let p = get_plugin_storage_file(&req.plugin_id);
    if !p.is_file() {
        return (StatusCode::OK, Json(json!({ "success": true, "value": Value::Null }))).into_response();
    }
    match std::fs::read_to_string(&p) {
        Ok(s) => match serde_json::from_str::<Value>(&s) {
            Ok(map) => {
                let val = map.get(req.key.as_str()).cloned().unwrap_or(Value::Null);
                (StatusCode::OK, Json(json!({ "success": true, "value": val }))).into_response()
            }
            Err(_) => (StatusCode::OK, Json(json!({ "success": true, "value": Value::Null }))).into_response(),
        },
        Err(e) => (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(json!({ "success": false, "error": e.to_string() })),
        )
            .into_response(),
    }
}

async fn storage_set_handler(Json(req): Json<StorageSetRequest>) -> impl IntoResponse {
    let p = get_plugin_storage_file(&req.plugin_id);
    if let Some(parent) = p.parent() {
        let _ = std::fs::create_dir_all(parent);
    }
    let mut map = if p.is_file() {
        std::fs::read_to_string(&p)
            .ok()
            .and_then(|s| serde_json::from_str::<Value>(&s).ok())
            .unwrap_or_else(|| json!({}))
    } else {
        json!({})
    };

    if !map.is_object() {
        map = json!({});
    }

    if let Some(obj) = map.as_object_mut() {
        obj.insert(req.key, req.value);
    }
    match serde_json::to_string_pretty(&map) {
        Ok(s) => match std::fs::write(&p, s) {
            Ok(_) => (StatusCode::OK, Json(json!({ "success": true }))).into_response(),
            Err(e) => (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(json!({ "success": false, "error": e.to_string() })),
            )
                .into_response(),
        },
        Err(e) => (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(json!({ "success": false, "error": e.to_string() })),
        )
            .into_response(),
    }
}
