//! Process-wide physical singleton pool for `scope=global` MCP servers.
//!
//! Reuses the exact same child process across all project directories and
//! sessions, ensuring pure cloud or stateless tools (e.g. Brave search)
//! consume only one single background process globally.

use anyhow::Result;
use std::collections::HashMap;
use std::sync::{Arc, OnceLock};
use tokio::sync::{Mutex, RwLock};

use super::client::McpClient;
use super::config::{McpServerConfig, McpTransportConfig};
use super::transport_http::HttpClient;
use super::transport_stdio::StdioClient;
use super::types::ServerStatus;

/// Global singleton pool keyed by server name.
pub struct GlobalMcpPool {
    clients: RwLock<HashMap<String, Arc<dyn McpClient>>>,
    lifecycle: Mutex<()>,
}

static GLOBAL_MCP_POOL: OnceLock<Arc<GlobalMcpPool>> = OnceLock::new();

impl GlobalMcpPool {
    pub fn new() -> Self {
        Self {
            clients: RwLock::new(HashMap::new()),
            lifecycle: Mutex::new(()),
        }
    }

    /// Process-wide shared singleton pool.
    pub fn global() -> Arc<Self> {
        GLOBAL_MCP_POOL
            .get_or_init(|| Arc::new(Self::new()))
            .clone()
    }

    /// Get an existing healthy client or spawn a new shared physical instance.
    pub async fn get_or_spawn(&self, config: &McpServerConfig) -> Result<Arc<dyn McpClient>> {
        let name = &config.name;
        // Fast path: check read lock
        {
            let clients = self.clients.read().await;
            if let Some(client) = clients.get(name) {
                if matches!(client.status(), ServerStatus::Connected) {
                    return Ok(Arc::clone(client));
                }
            }
        }

        // Serialized spawn/initialize under lifecycle lock
        let _lifecycle = self.lifecycle.lock().await;
        {
            let clients = self.clients.read().await;
            if let Some(client) = clients.get(name) {
                if matches!(client.status(), ServerStatus::Connected) {
                    return Ok(Arc::clone(client));
                }
            }
        }

        let mut client: Box<dyn McpClient> = match &config.config {
            McpTransportConfig::Stdio {
                command,
                args,
                env,
                timeout_ms,
            } => Box::new(StdioClient::new(
                name.clone(),
                command.clone(),
                args.clone(),
                env.clone(),
                *timeout_ms,
            )),
            McpTransportConfig::Http {
                url,
                headers,
                auth,
                timeout_ms,
            } => Box::new(HttpClient::new(
                name.clone(),
                url.clone(),
                headers.clone(),
                auth.clone(),
                *timeout_ms,
            )),
        };

        client.initialize().await?;
        let client_arc: Arc<dyn McpClient> = Arc::from(client);
        super::register_mcp_client(&client_arc);

        let mut clients = self.clients.write().await;
        clients.insert(name.clone(), Arc::clone(&client_arc));
        Ok(client_arc)
    }

    /// Tear down all global shared processes on host exit.
    pub async fn shutdown_all(&self) {
        let _lifecycle = self.lifecycle.lock().await;
        let stale: Vec<_> = {
            let mut clients = self.clients.write().await;
            clients.drain().map(|(_, client)| client).collect()
        };
        for client in stale {
            client.shutdown().await;
        }
    }
}

impl Default for GlobalMcpPool {
    fn default() -> Self {
        Self::new()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::mcp::config::{McpConfigSource, McpScope};
    use crate::mcp::types::{
        CallToolResult, InitializeResult, ListToolsResult, ServerCapabilities, ServerInfo,
    };
    use std::collections::BTreeMap;

    struct MockConnectedClient;

    #[async_trait::async_trait]
    impl McpClient for MockConnectedClient {
        async fn initialize(&mut self) -> Result<InitializeResult> {
            Ok(InitializeResult {
                protocol_version: "2024-11-05".to_string(),
                capabilities: ServerCapabilities::default(),
                server_info: ServerInfo {
                    name: "mock".to_string(),
                    version: "1.0.0".to_string(),
                },
                instructions: None,
            })
        }

        async fn list_tools(&self) -> Result<ListToolsResult> {
            Ok(ListToolsResult { tools: Vec::new() })
        }

        async fn call_tool(
            &self,
            _tool_name: &str,
            _arguments: serde_json::Value,
        ) -> Result<CallToolResult> {
            Ok(CallToolResult {
                content: Vec::new(),
                is_error: false,
            })
        }

        fn server_name(&self) -> &str {
            "mock-global"
        }

        fn status(&self) -> ServerStatus {
            ServerStatus::Connected
        }

        async fn shutdown(&self) {}
    }

    #[tokio::test]
    async fn global_mcp_pool_shares_single_instance_for_same_server_name() {
        let pool = GlobalMcpPool::new();
        let config = McpServerConfig {
            name: "mock-global".to_string(),
            config: McpTransportConfig::Http {
                url: "http://127.0.0.1:9".to_string(),
                headers: BTreeMap::new(),
                auth: None,
                timeout_ms: Some(100),
            },
            max_concurrent_calls: 4,
            scope: McpScope::Global,
            disabled: false,
            auto_approve: Vec::new(),
            source: McpConfigSource::User,
            trust: false,
        };

        // Inject pre-connected mock into pool
        let mock_client: Arc<dyn McpClient> = Arc::new(MockConnectedClient);

        {
            let mut clients = pool.clients.write().await;
            clients.insert("mock-global".to_string(), Arc::clone(&mock_client));
        }

        let first = pool.get_or_spawn(&config).await.unwrap();
        let second = pool.get_or_spawn(&config).await.unwrap();

        assert!(
            Arc::ptr_eq(&first, &second),
            "GlobalMcpPool must return the exact same Arc client singleton across multiple requests"
        );
        assert!(Arc::ptr_eq(&first, &mock_client));

        pool.shutdown_all().await;
        assert!(
            pool.clients.read().await.is_empty(),
            "shutdown_all must drain clients"
        );
    }
}
