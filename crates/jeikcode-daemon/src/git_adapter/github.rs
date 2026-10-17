//! GitHub platform adapter driver.
//!
//! Implements HMAC-SHA256 webhook verification, normalized payload parsing,
//! and comments API read/write operations.

use axum::http::HeaderMap;
use serde_json::Value;

use super::{
    constant_time_eq, hmac_sha256, to_hex, GitEventKind, GitPlatformAdapter, GitUserMeta,
    NormalizedGitEvent,
};

#[derive(Debug, Default, Clone)]
pub struct GitHubAdapter;

impl GitHubAdapter {
    pub fn new() -> Self {
        Self
    }
}

const DEFAULT_GITHUB_API_BASE: &str = "https://api.github.com";

#[async_trait::async_trait]
impl GitPlatformAdapter for GitHubAdapter {
    fn platform_id(&self) -> &'static str {
        "github"
    }

    fn verify_signature(&self, secret: &str, headers: &HeaderMap, body_bytes: &[u8]) -> bool {
        let secret = secret.trim();
        if secret.is_empty() {
            // 未配置 secret 时放行
            return true;
        }

        let Some(sig_header) = headers.get("x-hub-signature-256") else {
            return false;
        };

        let Ok(sig_str) = sig_header.to_str() else {
            return false;
        };

        let expected_prefix = "sha256=";
        if !sig_str.starts_with(expected_prefix) {
            return false;
        }

        let remote_hex = &sig_str[expected_prefix.len()..];
        let calculated_bytes = hmac_sha256(secret.as_bytes(), body_bytes);
        let calculated_hex = to_hex(&calculated_bytes);

        constant_time_eq(remote_hex.as_bytes(), calculated_hex.as_bytes())
    }

    fn parse_event(
        &self,
        headers: &HeaderMap,
        payload: Value,
    ) -> Result<Option<NormalizedGitEvent>, String> {
        let event_type_header = headers
            .get("x-github-event")
            .and_then(|v| v.to_str().ok())
            .unwrap_or("")
            .trim();

        if event_type_header.is_empty() {
            return Err("Missing X-GitHub-Event header".to_string());
        }

        let repo_full_name = payload["repository"]["full_name"]
            .as_str()
            .unwrap_or("")
            .to_string();

        let sender_obj = &payload["sender"];
        let sender_association = sender_obj["author_association"]
            .as_str()
            .map(|s| s.to_string());
        let sender = GitUserMeta {
            username: sender_obj["login"]
                .as_str()
                .unwrap_or("unknown")
                .to_string(),
            display_name: sender_obj["name"].as_str().map(|s| s.to_string()),
            email: sender_obj["email"].as_str().map(|s| s.to_string()),
            user_type: sender_obj["type"].as_str().unwrap_or("User").to_string(),
            avatar_url: sender_obj["avatar_url"].as_str().map(|s| s.to_string()),
            author_association: sender_association,
        };

        match event_type_header {
            "ping" => Ok(Some(NormalizedGitEvent {
                platform: "github".to_string(),
                event_kind: GitEventKind::Ping,
                repo_full_name,
                is_pull_request: false,
                issue_or_pr_number: None,
                sender,
                commit_author: None,
                title: None,
                body_text: None,
                comment_id: None,
                head_sha: None,
                base_branch: None,
                head_branch: None,
                html_url: payload["repository"]["html_url"]
                    .as_str()
                    .map(|s| s.to_string()),
                raw_payload: payload,
            })),

            "pull_request" => {
                let action = payload["action"].as_str().unwrap_or("");
                let pr = &payload["pull_request"];
                let number = payload["number"].as_u64().or_else(|| pr["number"].as_u64());

                let event_kind = match action {
                    "opened" | "reopened" => GitEventKind::PullRequestOpened,
                    "synchronize" => GitEventKind::PullRequestSynchronize,
                    other => GitEventKind::Unknown(format!("pr_{other}")),
                };

                let head_sha = pr["head"]["sha"].as_str().map(|s| s.to_string());
                let head_branch = pr["head"]["ref"].as_str().map(|s| s.to_string());
                let base_branch = pr["base"]["ref"].as_str().map(|s| s.to_string());
                let title = pr["title"].as_str().map(|s| s.to_string());
                let body_text = pr["body"].as_str().map(|s| s.to_string());
                let html_url = pr["html_url"].as_str().map(|s| s.to_string());

                Ok(Some(NormalizedGitEvent {
                    platform: "github".to_string(),
                    event_kind,
                    repo_full_name,
                    is_pull_request: true,
                    issue_or_pr_number: number,
                    sender,
                    commit_author: None,
                    title,
                    body_text,
                    comment_id: None,
                    head_sha,
                    base_branch,
                    head_branch,
                    html_url,
                    raw_payload: payload,
                }))
            }

            "issue_comment" => {
                let action = payload["action"].as_str().unwrap_or("");
                if action != "created" {
                    return Ok(None);
                }

                let issue = &payload["issue"];
                let comment = &payload["comment"];
                let number = issue["number"].as_u64();
                let is_pull_request = issue.get("pull_request").is_some();
                let comment_id = comment["id"].as_u64();
                let body_text = comment["body"].as_str().map(|s| s.to_string());
                let title = issue["title"].as_str().map(|s| s.to_string());

                let author_association = comment["author_association"]
                    .as_str()
                    .or_else(|| issue["author_association"].as_str())
                    .map(|s| s.to_string());

                let comment_sender = GitUserMeta {
                    username: comment["user"]["login"]
                        .as_str()
                        .unwrap_or("unknown")
                        .to_string(),
                    display_name: comment["user"]["name"].as_str().map(|s| s.to_string()),
                    email: comment["user"]["email"].as_str().map(|s| s.to_string()),
                    user_type: comment["user"]["type"]
                        .as_str()
                        .unwrap_or("User")
                        .to_string(),
                    avatar_url: comment["user"]["avatar_url"]
                        .as_str()
                        .map(|s| s.to_string()),
                    author_association,
                };

                let html_url = comment["html_url"]
                    .as_str()
                    .or_else(|| issue["html_url"].as_str())
                    .map(|s| s.to_string());

                Ok(Some(NormalizedGitEvent {
                    platform: "github".to_string(),
                    event_kind: GitEventKind::IssueCommentCreated,
                    repo_full_name,
                    is_pull_request,
                    issue_or_pr_number: number,
                    sender: comment_sender,
                    commit_author: None,
                    title,
                    body_text,
                    comment_id,
                    head_sha: None,
                    base_branch: None,
                    head_branch: None,
                    html_url,
                    raw_payload: payload,
                }))
            }

            "push" => {
                let head_sha = payload["after"].as_str().map(|s| s.to_string());
                let ref_str = payload["ref"].as_str().unwrap_or("");
                let branch = ref_str.strip_prefix("refs/heads/").unwrap_or(ref_str);

                let pusher_name = payload["pusher"]["name"].as_str().unwrap_or("");
                let pusher_email = payload["pusher"]["email"].as_str().map(|s| s.to_string());

                let pusher = GitUserMeta {
                    username: pusher_name.to_string(),
                    display_name: None,
                    email: pusher_email,
                    user_type: "User".to_string(),
                    avatar_url: None,
                    author_association: Some("COLLABORATOR".to_string()),
                };

                Ok(Some(NormalizedGitEvent {
                    platform: "github".to_string(),
                    event_kind: GitEventKind::Push,
                    repo_full_name,
                    is_pull_request: false,
                    issue_or_pr_number: None,
                    sender: pusher,
                    commit_author: None,
                    title: None,
                    body_text: None,
                    comment_id: None,
                    head_sha,
                    base_branch: Some(branch.to_string()),
                    head_branch: None,
                    html_url: payload["compare"].as_str().map(|s| s.to_string()),
                    raw_payload: payload,
                }))
            }

            other => Ok(Some(NormalizedGitEvent {
                platform: "github".to_string(),
                event_kind: GitEventKind::Unknown(other.to_string()),
                repo_full_name,
                is_pull_request: false,
                issue_or_pr_number: None,
                sender,
                commit_author: None,
                title: None,
                body_text: None,
                comment_id: None,
                head_sha: None,
                base_branch: None,
                head_branch: None,
                html_url: None,
                raw_payload: payload,
            })),
        }
    }

    async fn post_comment(
        &self,
        token: &str,
        api_base: Option<&str>,
        repo: &str,
        number: u64,
        body: &str,
    ) -> Result<u64, String> {
        let base = api_base
            .filter(|s| !s.trim().is_empty())
            .unwrap_or(DEFAULT_GITHUB_API_BASE);
        let url = format!("{base}/repos/{repo}/issues/{number}/comments");

        let client = reqwest::Client::new();
        let resp = client
            .post(&url)
            .header("Authorization", format!("Bearer {}", token.trim()))
            .header("User-Agent", "JeikCode-Bot/1.0")
            .header("Accept", "application/vnd.github+json")
            .json(&serde_json::json!({ "body": body }))
            .send()
            .await
            .map_err(|e| format!("Failed to send comment request to GitHub: {e}"))?;

        if !resp.status().is_success() {
            let status = resp.status();
            let err_text = resp.text().await.unwrap_or_default();
            return Err(format!("GitHub post comment failed ({status}): {err_text}"));
        }

        let created_json: Value = resp
            .json()
            .await
            .map_err(|e| format!("Failed to parse GitHub comment response: {e}"))?;

        let id = created_json["id"]
            .as_u64()
            .ok_or_else(|| "GitHub comment response missing 'id'".to_string())?;

        Ok(id)
    }

    async fn update_comment(
        &self,
        token: &str,
        api_base: Option<&str>,
        repo: &str,
        comment_id: u64,
        body: &str,
    ) -> Result<(), String> {
        let base = api_base
            .filter(|s| !s.trim().is_empty())
            .unwrap_or(DEFAULT_GITHUB_API_BASE);
        let url = format!("{base}/repos/{repo}/issues/comments/{comment_id}");

        let client = reqwest::Client::new();
        let resp = client
            .patch(&url)
            .header("Authorization", format!("Bearer {}", token.trim()))
            .header("User-Agent", "JeikCode-Bot/1.0")
            .header("Accept", "application/vnd.github+json")
            .json(&serde_json::json!({ "body": body }))
            .send()
            .await
            .map_err(|e| format!("Failed to send comment update to GitHub: {e}"))?;

        if !resp.status().is_success() {
            let status = resp.status();
            let err_text = resp.text().await.unwrap_or_default();
            return Err(format!(
                "GitHub update comment failed ({status}): {err_text}"
            ));
        }

        Ok(())
    }

    async fn find_bot_primary_comment(
        &self,
        token: &str,
        api_base: Option<&str>,
        repo: &str,
        number: u64,
    ) -> Result<Option<u64>, String> {
        let base = api_base
            .filter(|s| !s.trim().is_empty())
            .unwrap_or(DEFAULT_GITHUB_API_BASE);
        let url = format!("{base}/repos/{repo}/issues/{number}/comments?per_page=100");

        let client = reqwest::Client::new();
        let resp = client
            .get(&url)
            .header("Authorization", format!("Bearer {}", token.trim()))
            .header("User-Agent", "JeikCode-Bot/1.0")
            .header("Accept", "application/vnd.github+json")
            .send()
            .await
            .map_err(|e| format!("Failed to list GitHub comments: {e}"))?;

        if !resp.status().is_success() {
            return Ok(None);
        }

        let comments: Value = resp.json().await.unwrap_or(Value::Null);
        let Some(list) = comments.as_array() else {
            return Ok(None);
        };

        // 从后往前查找 Bot 发表的最新评论（标识包含 JeikCode 或 user_type 为 Bot）
        for item in list.iter().rev() {
            let is_bot = item["user"]["type"].as_str() == Some("Bot")
                || item["user"]["login"]
                    .as_str()
                    .map(|u| u.ends_with("[bot]"))
                    .unwrap_or(false);
            let body = item["body"].as_str().unwrap_or("");
            if (is_bot || body.contains("JeikCode")) && !body.is_empty() {
                if let Some(id) = item["id"].as_u64() {
                    return Ok(Some(id));
                }
            }
        }

        Ok(None)
    }
}
