//! 外部扩展插件本地数据 RPC 接口服务。
//!
//! 为已安装的本地工作台插件（如 DevOrbit 等）提供与宿主系统的本地数据双向互通支持，
//! 包含工作区资产探测、SQL 发布跟踪、任务归档、文档读取与外部文件管理器联动。

use axum::{
    extract::{Path, State},
    http::StatusCode,
    response::{IntoResponse, Json},
};
use serde::Deserialize;
use serde_json::{json, Value};
use std::path::{Path as StdPath, PathBuf};
use crate::AppState;

#[derive(Debug, Deserialize)]
pub struct PluginRpcRequest {
    pub action: String,
    #[serde(default)]
    pub payload: Value,
}

/// 解析单个任务文件夹的资产与元信息
fn parse_task_folder(task_dir: &StdPath, fallback_year: &str) -> Option<Value> {
    if !task_dir.is_dir() {
        return None;
    }
    let dir_name = task_dir.file_name()?.to_string_lossy().to_string();
    let meta_file = task_dir.join("task.json");
    let mut meta = if meta_file.is_file() {
        std::fs::read_to_string(&meta_file)
            .ok()
            .and_then(|s| serde_json::from_str::<Value>(&s).ok())
            .unwrap_or_else(|| json!({}))
    } else {
        json!({})
    };

    if meta.get("id").is_none() {
        meta["id"] = json!(dir_name);
    }
    if meta.get("title").is_none() {
        meta["title"] = json!(dir_name);
    }
    if meta.get("status").is_none() {
        meta["status"] = json!("developing");
    }
    if meta.get("project").is_none() {
        meta["project"] = json!("常规项目");
    }

    let sql_dir = task_dir.join("sql");
    let mut sql_count = 0;
    let mut prod_pending_count = 0;
    let mut test_pending_count = 0;

    if sql_dir.is_dir() {
        if let Ok(entries) = std::fs::read_dir(&sql_dir) {
            let records = meta.get("sqlReleaseRecords").cloned().unwrap_or_else(|| json!({}));
            for entry in entries.flatten() {
                let p = entry.path();
                if p.is_file() && p.extension().and_then(|s| s.to_str()) == Some("sql") {
                    sql_count += 1;
                    let file_name = p.file_name().unwrap_or_default().to_string_lossy().to_string();
                    let r = records.get(&file_name);
                    let test_rel = r
                        .and_then(|v| v.get("testReleased"))
                        .and_then(|v| v.as_bool())
                        .unwrap_or(false);
                    let prod_rel = r
                        .and_then(|v| v.get("prodReleased"))
                        .and_then(|v| v.as_bool())
                        .unwrap_or(false);
                    if !test_rel {
                        test_pending_count += 1;
                    }
                    if !prod_rel {
                        prod_pending_count += 1;
                    }
                }
            }
        }
    }

    let inferred_year = meta
        .get("year")
        .and_then(|v| v.as_str())
        .unwrap_or(fallback_year);
    let final_year = if inferred_year.is_empty() {
        "2026"
    } else {
        inferred_year
    };

    meta["dirName"] = json!(dir_name);
    meta["fullPath"] = json!(task_dir.to_string_lossy().to_string());
    meta["year"] = json!(final_year);
    meta["sqlCount"] = json!(sql_count);
    meta["testPendingCount"] = json!(test_pending_count);
    meta["prodPendingCount"] = json!(prod_pending_count);

    Some(meta)
}

/// POST /api/plugins-rpc/:plugin_id
///
/// 外部插件通用 RPC 路由器
pub async fn handle_plugin_rpc(
    State(state): State<AppState>,
    Path(plugin_id): Path<String>,
    Json(req): Json<PluginRpcRequest>,
) -> impl IntoResponse {
    let action = req.action.as_str();
    let payload = req.payload;

    match action {
        "get-workspace-path" => {
            let mut ws = payload
                .get("workspacePath")
                .and_then(|v| v.as_str())
                .unwrap_or("")
                .to_string();

            if ws.is_empty() {
                #[cfg(windows)]
                {
                    if StdPath::new("D:\\工作").is_dir() {
                        ws = "D:\\工作".to_string();
                    }
                }
                if ws.is_empty() {
                    ws = state.current_dir.read().await.clone();
                }
            }
            Json(json!({ "workspacePath": ws })).into_response()
        }

        "set-workspace-path" => {
            let ws = payload
                .get("workspacePath")
                .and_then(|v| v.as_str())
                .unwrap_or("")
                .to_string();
            Json(json!({ "success": true, "workspacePath": ws })).into_response()
        }

        "get-tasks" => {
            let mut ws = payload
                .get("workspacePath")
                .and_then(|v| v.as_str())
                .unwrap_or("")
                .to_string();

            if ws.is_empty() {
                #[cfg(windows)]
                {
                    if StdPath::new("D:\\工作").is_dir() {
                        ws = "D:\\工作".to_string();
                    }
                }
                if ws.is_empty() {
                    ws = state.current_dir.read().await.clone();
                }
            }

            let ws_path = PathBuf::from(&ws);
            if !ws_path.is_dir() {
                return Json(json!({ "tasks": [], "years": ["2026"] })).into_response();
            }

            let mut tasks = Vec::new();
            let mut years = std::collections::BTreeSet::new();

            if let Ok(entries) = std::fs::read_dir(&ws_path) {
                for entry in entries.flatten() {
                    let path = entry.path();
                    if !path.is_dir() {
                        continue;
                    }
                    let name = entry.file_name().to_string_lossy().to_string();
                    if name.starts_with('.') || name.starts_with('_') {
                        continue;
                    }

                    // 年份归档目录（如 2026, 2025）
                    if name.len() == 4 && name.chars().all(|c| c.is_ascii_digit()) {
                        years.insert(name.clone());
                        if let Ok(sub_entries) = std::fs::read_dir(&path) {
                            for sub_entry in sub_entries.flatten() {
                                let sub_path = sub_entry.path();
                                if sub_path.is_dir() {
                                    let sub_name = sub_entry.file_name().to_string_lossy().to_string();
                                    if !sub_name.starts_with('.') && !sub_name.starts_with('_') {
                                        if let Some(t) = parse_task_folder(&sub_path, &name) {
                                            tasks.push(t);
                                        }
                                    }
                                }
                            }
                        }
                    } else {
                        // 根目录下直接包含 task.json 的独立任务目录
                        if path.join("task.json").is_file() {
                            if let Some(t) = parse_task_folder(&path, "") {
                                if let Some(y) = t.get("year").and_then(|v| v.as_str()) {
                                    if !y.is_empty() {
                                        years.insert(y.to_string());
                                    }
                                }
                                tasks.push(t);
                            }
                        }
                    }
                }
            }

            years.insert("2026".to_string());
            let mut sorted_years: Vec<String> = years.into_iter().collect();
            sorted_years.sort_by(|a, b| b.cmp(a));

            Json(json!({ "tasks": tasks, "years": sorted_years })).into_response()
        }

        "get-task-sqls" => {
            let task_dir = payload
                .get("taskDir")
                .and_then(|v| v.as_str())
                .unwrap_or("");
            if task_dir.is_empty() {
                return Json(json!([])).into_response();
            }

            let task_path = PathBuf::from(task_dir);
            let sql_dir = task_path.join("sql");
            if !sql_dir.is_dir() {
                return Json(json!([])).into_response();
            }

            let meta_file = task_path.join("task.json");
            let records = if meta_file.is_file() {
                std::fs::read_to_string(&meta_file)
                    .ok()
                    .and_then(|s| serde_json::from_str::<Value>(&s).ok())
                    .and_then(|v| v.get("sqlReleaseRecords").cloned())
                    .unwrap_or_else(|| json!({}))
            } else {
                json!({})
            };

            let mut results = Vec::new();
            if let Ok(entries) = std::fs::read_dir(&sql_dir) {
                for entry in entries.flatten() {
                    let path = entry.path();
                    if path.is_file() && path.extension().and_then(|s| s.to_str()) == Some("sql") {
                        let file_name = path.file_name().unwrap_or_default().to_string_lossy().to_string();
                        let size = entry.metadata().map(|m| m.len()).unwrap_or(0);
                        let updated_at = entry
                            .metadata()
                            .ok()
                            .and_then(|m| m.modified().ok())
                            .and_then(|t| {
                                t.duration_since(std::time::UNIX_EPOCH)
                                    .ok()
                                    .map(|d| format!("{}000", d.as_secs()))
                            })
                            .unwrap_or_default();

                        let rec = records.get(&file_name);
                        let test_rel = rec
                            .and_then(|v| v.get("testReleased"))
                            .and_then(|v| v.as_bool())
                            .unwrap_or(false);
                        let test_rel_at = rec.and_then(|v| v.get("testReleasedAt")).cloned();
                        let prod_rel = rec
                            .and_then(|v| v.get("prodReleased"))
                            .and_then(|v| v.as_bool())
                            .unwrap_or(false);
                        let prod_rel_at = rec.and_then(|v| v.get("prodReleasedAt")).cloned();

                        results.push(json!({
                            "fileName": file_name,
                            "filePath": path.to_string_lossy().to_string(),
                            "size": size,
                            "updatedAt": updated_at,
                            "testReleased": test_rel,
                            "testReleasedAt": test_rel_at,
                            "prodReleased": prod_rel,
                            "prodReleasedAt": prod_rel_at,
                        }));
                    }
                }
            }

            results.sort_by(|a, b| {
                let sa = a.get("fileName").and_then(|v| v.as_str()).unwrap_or("");
                let sb = b.get("fileName").and_then(|v| v.as_str()).unwrap_or("");
                sa.cmp(sb)
            });

            Json(json!(results)).into_response()
        }

        "update-sql-status" => {
            let task_dir = payload.get("taskDir").and_then(|v| v.as_str()).unwrap_or("");
            let file_name = payload.get("fileName").and_then(|v| v.as_str()).unwrap_or("");
            let env = payload.get("env").and_then(|v| v.as_str()).unwrap_or("");
            let is_released = payload
                .get("status")
                .map(|v| v.as_bool() == Some(true) || v.as_str() == Some("published"))
                .unwrap_or(false);
            let timestamp = payload
                .get("timestamp")
                .and_then(|v| v.as_str())
                .map(|s| s.to_string())
                .unwrap_or_else(|| "刚刚".to_string());

            if task_dir.is_empty() || file_name.is_empty() {
                return (StatusCode::BAD_REQUEST, "taskDir and fileName required").into_response();
            }

            let task_path = PathBuf::from(task_dir);
            let meta_file = task_path.join("task.json");
            let mut meta = if meta_file.is_file() {
                std::fs::read_to_string(&meta_file)
                    .ok()
                    .and_then(|s| serde_json::from_str::<Value>(&s).ok())
                    .unwrap_or_else(|| json!({}))
            } else {
                json!({})
            };

            if !meta.get("sqlReleaseRecords").map_or(false, |v| v.is_object()) {
                meta["sqlReleaseRecords"] = json!({});
            }

            let records = meta.get_mut("sqlReleaseRecords").unwrap();
            if !records.get(file_name).map_or(false, |v| v.is_object()) {
                records[file_name] = json!({});
            }

            let file_rec = records.get_mut(file_name).unwrap();
            if env == "prod" {
                file_rec["prodReleased"] = json!(is_released);
                file_rec["prodReleasedAt"] = if is_released {
                    json!(timestamp)
                } else {
                    Value::Null
                };
            } else {
                file_rec["testReleased"] = json!(is_released);
                file_rec["testReleasedAt"] = if is_released {
                    json!(timestamp)
                } else {
                    Value::Null
                };
            }

            let saved_rec = file_rec.clone();
            if let Ok(pretty) = serde_json::to_string_pretty(&meta) {
                let _ = std::fs::write(&meta_file, pretty);
            }

            Json(json!({ "success": true, "record": saved_rec })).into_response()
        }

        "read-sql-content" => {
            let file_path = payload.get("filePath").and_then(|v| v.as_str()).unwrap_or("");
            let content = if !file_path.is_empty() && StdPath::new(file_path).is_file() {
                std::fs::read_to_string(file_path).unwrap_or_default()
            } else {
                String::new()
            };
            Json(json!({ "content": content })).into_response()
        }

        "save-sql-content" => {
            let file_path = payload.get("filePath").and_then(|v| v.as_str()).unwrap_or("");
            let content = payload.get("content").and_then(|v| v.as_str()).unwrap_or("");
            if !file_path.is_empty() {
                if let Some(parent) = StdPath::new(file_path).parent() {
                    let _ = std::fs::create_dir_all(parent);
                }
                let _ = std::fs::write(file_path, content);
            }
            Json(json!({ "success": true })).into_response()
        }

        "get-task-notes" => {
            let task_dir = payload.get("taskDir").and_then(|v| v.as_str()).unwrap_or("");
            let meta_file = PathBuf::from(task_dir).join("task.json");
            let notes = if meta_file.is_file() {
                std::fs::read_to_string(&meta_file)
                    .ok()
                    .and_then(|s| serde_json::from_str::<Value>(&s).ok())
                    .and_then(|v| v.get("notes").cloned())
                    .unwrap_or_else(|| json!([]))
            } else {
                json!([])
            };
            Json(notes).into_response()
        }

        "save-task-notes" => {
            let task_dir = payload.get("taskDir").and_then(|v| v.as_str()).unwrap_or("");
            let notes = payload.get("notes").cloned().unwrap_or_else(|| json!([]));
            let meta_file = PathBuf::from(task_dir).join("task.json");
            let mut meta = if meta_file.is_file() {
                std::fs::read_to_string(&meta_file)
                    .ok()
                    .and_then(|s| serde_json::from_str::<Value>(&s).ok())
                    .unwrap_or_else(|| json!({}))
            } else {
                json!({})
            };
            meta["notes"] = notes;
            if let Ok(pretty) = serde_json::to_string_pretty(&meta) {
                let _ = std::fs::write(&meta_file, pretty);
            }
            Json(json!({ "success": true })).into_response()
        }

        "get-task-file" => {
            let task_dir = payload.get("taskDir").and_then(|v| v.as_str()).unwrap_or("");
            let file_type = payload.get("type").and_then(|v| v.as_str()).unwrap_or("");
            let docs_dir = PathBuf::from(task_dir).join("docs");
            let target = if file_type == "note" {
                docs_dir.join("笔记.md")
            } else {
                docs_dir.join("需求.md")
            };
            let content = if target.is_file() {
                std::fs::read_to_string(target).unwrap_or_default()
            } else {
                String::new()
            };
            Json(json!({ "content": content })).into_response()
        }

        "get-dir-files" => {
            let dir_path = payload.get("dirPath").and_then(|v| v.as_str()).unwrap_or("");
            let path = PathBuf::from(dir_path);
            let mut files = Vec::new();
            if path.is_dir() {
                if let Ok(entries) = std::fs::read_dir(path) {
                    for entry in entries.flatten() {
                        let p = entry.path();
                        if p.is_file() {
                            let name = p.file_name().unwrap_or_default().to_string_lossy().to_string();
                            if !name.starts_with('.') {
                                let size = entry.metadata().map(|m| m.len()).unwrap_or(0);
                                files.push(json!({
                                    "fileName": name,
                                    "filePath": p.to_string_lossy().to_string(),
                                    "size": size,
                                }));
                            }
                        }
                    }
                }
            }
            Json(json!(files)).into_response()
        }

        "create-task" => {
            let ws = payload.get("workspacePath").and_then(|v| v.as_str()).unwrap_or("D:\\工作");
            let title = payload.get("title").and_then(|v| v.as_str()).unwrap_or("新开发任务");
            let year = payload.get("year").and_then(|v| v.as_str()).unwrap_or("2026");
            let project = payload.get("project").and_then(|v| v.as_str()).unwrap_or("常规项目");

            let task_dir = PathBuf::from(ws).join(year).join(title);
            let sql_dir = task_dir.join("sql");
            let docs_dir = task_dir.join("docs");
            let _ = std::fs::create_dir_all(&sql_dir);
            let _ = std::fs::create_dir_all(&docs_dir);

            let req_content = format!("# {title} - 任务需求\n\n> 归属年份: {year} 年\n> 所属模块: {project}\n");
            let note_content = format!("# {title} - 开发笔记与联调备忘\n\n");
            let _ = std::fs::write(docs_dir.join("需求.md"), req_content);
            let _ = std::fs::write(docs_dir.join("笔记.md"), note_content);

            let initial_meta = json!({
                "id": title,
                "title": title,
                "year": year,
                "project": project,
                "status": "developing",
                "sqlReleaseRecords": {},
                "notes": []
            });
            let _ = std::fs::write(task_dir.join("task.json"), serde_json::to_string_pretty(&initial_meta).unwrap());

            let task_obj = parse_task_folder(&task_dir, year).unwrap_or(initial_meta);
            Json(json!({ "success": true, "task": task_obj })).into_response()
        }

        "delete-task" => {
            let task_dir = payload.get("taskDir").and_then(|v| v.as_str()).unwrap_or("");
            if !task_dir.is_empty() {
                let p = PathBuf::from(task_dir);
                if p.is_dir() {
                    let _ = std::fs::remove_dir_all(p);
                }
            }
            Json(json!({ "success": true })).into_response()
        }

        "open-in-explorer" => {
            let target_path = payload.get("targetPath").and_then(|v| v.as_str()).unwrap_or("");
            if !target_path.is_empty() {
                #[cfg(windows)]
                {
                    let win_path = target_path.replace('/', "\\");
                    let _ = std::process::Command::new("explorer.exe")
                        .arg(&win_path)
                        .spawn();
                }
                #[cfg(target_os = "macos")]
                {
                    let _ = std::process::Command::new("open")
                        .arg(target_path)
                        .spawn();
                }
                #[cfg(target_os = "linux")]
                {
                    let _ = std::process::Command::new("xdg-open")
                        .arg(target_path)
                        .spawn();
                }
            }
            Json(json!({ "success": true })).into_response()
        }

        _ => {
            // 未知 action：提供默认 success 响应，确保插件前端不抛出异常
            Json(json!({ "success": true, "unhandledAction": action, "pluginId": plugin_id })).into_response()
        }
    }
}
