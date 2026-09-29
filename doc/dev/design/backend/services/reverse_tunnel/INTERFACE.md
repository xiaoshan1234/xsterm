# Services · Reverse Tunnel — 对外接口

> **位置**：`src-tauri/src/services/reverse_tunnel/mod.rs`
> **唯一入口**：`use crate::services::reverse_tunnel::{TunnelHandle, TunnelStatus, start_if_enabled}`
> **被使用方**：`commands/tunnel::*` + `services/config`（联动启停）

## 1. 公开类型

```rust
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase", tag = "status")]
pub enum TunnelStatus {
    Disconnected,
    Connecting,
    Connected { since_ms: u64 },
    Reconnecting { attempt: u32, next_delay_secs: u32 },
    Failed { reason: String, will_retry: bool },
}

pub struct TunnelHandle {
    status: Arc<RwLock<TunnelStatus>>,
    cancel: tokio::sync::watch::Sender<()>,
}

impl TunnelHandle {
    pub fn status(&self) -> TunnelStatus;
    pub fn stop(&self);
    pub fn is_running(&self) -> bool;
}

#[derive(Debug, thiserror::Error)]
pub enum TunnelError {
    #[error("remote user {0} not in allowlist")]
    RemoteUserNotAllowed(String),
    #[error("ssh connection failed: {0}")]
    SshConnectFailed(String),
    #[error("forward channel failed: {0}")]
    ForwardFailed(String),
    #[error("config invalid: {0}")]
    InvalidConfig(String),
}
```

## 2. 公开函数

```rust
pub async fn start_if_enabled(
    config: &AppConfig,
    session_manager: Arc<SessionManager>,
    attach_registry: Arc<AttachRegistry>,
) -> Result<TunnelHandle, TunnelError>;

pub fn generate_powershell_script(config: &TunnelConfig) -> String;
pub fn generate_bash_script(config: &TunnelConfig) -> String;
```

## 3. 接缝契约

```rust
// lib.rs::run() setup block
use crate::services::reverse_tunnel;

let config = config_store.get().await;
let tunnel_handle = reverse_tunnel::start_if_enabled(
    &config,
    session_manager.clone(),
    attach_registry.clone(),
).await?;
app.manage(Some(tunnel_handle));  // ⭐ Option<Arc<TunnelHandle>>
```

## 4. 错误码

| TunnelError | IPC 错误字符串 |
|---|---|
| `RemoteUserNotAllowed(user)` | "remote user 'X' not in allowlist" |
| `SshConnectFailed(reason)` | "ssh connection failed: X" |
| `ForwardFailed(reason)` | "forward channel failed: X" |
| `InvalidConfig(reason)` | "config invalid: X" |

## 5. 不对外暴露

- `client::connect_and_forward` 内部 russh 调用
- `reconnect::run_reconnect_loop` 内部 loop
- 内部 BACKOFF_DELAYS 常量

## 6. 变更流程

1. **新增 TunnelStatus variant** → 更新 enum + display impl + INTERFACE.md
2. **修改 start_if_enabled 签名** → 同步 INTERFACE.md + 测试
3. **新增 auth method** → 更新 SshAuthConfig + client impl

## 7. 文档

- [`README.md`](README.md) — 职责
- [`INTERFACE.md`](INTERFACE.md) — 本文档
- [`DOWNSTREAM.md`](DOWNSTREAM.md) — 依赖图