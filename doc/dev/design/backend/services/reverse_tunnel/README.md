# Services · Reverse Tunnel — 职责

> **位置**：`src-tauri/src/services/reverse_tunnel/`
> **类型**：⭐ PRD §2 M8 远程 SSH agent 接入
> **核心**：russh -R 反向隧道 + 指数退避自动重连

## 1. 一句话架构

**reverse_tunnel = 1 个 `TunnelHandle` + russh client + -R 远端转发 + 指数退避重连 loop**

```
src-tauri/src/services/reverse_tunnel/
├── mod.rs              公开 API（TunnelHandle + start_if_enabled）
├── client.rs           russh client 连远端 ssh server
├── forward.rs          -R 远端端口 → local 127.0.0.1:local_mcp_port
├── reconnect.rs        tokio interval 指数退避（1/2/4/8/16s × 5 次）
├── status.rs           TunnelStatus 状态机 + emit tunnel-status-changed
└── scripts.rs          生成反向隧道脚本（PowerShell + bash 双版本）
```

## 2. 职责

reverse_tunnel service 是 **PRD §2 M8 远程 AI agent 通过反向 SSH tunnel 接入本地 MCP server 的底层**：

1. **russh client** — 连用户配置的远端 ssh server
2. **-R 转发** — 在 SSH session 上 open forward channel，把远端 port 转到 local MCP HTTP port
3. **指数退避重连** — 隧道断开后 1/2/4/8/16s 重试，最多 5 次
4. **白名单校验** — 远端用户 / 端口必须在 `settings.json` (tunnel.allowedRemoteUsers 字段)
5. **状态机** — Disconnected / Connecting / Connected / Reconnecting / Failed
6. **脚本生成** — 给用户生成可手动运行的 ssh -R 命令（PowerShell + bash 双版本）

## 3. 不承担

- ❌ SSH 连接本身（用现有 `infrastructure::ssh` 复用）
- ❌ MCP server（用现有 `mcp_server::transport::http` 复用）
- ❌ 安全 token 鉴权（MCP HTTP server 已经有 Bearer token；tunnel 只做反向转发，鉴权由 MCP 层负责）
- ❌ 多跳代理（single hop only）

## 4. 公开 API

```rust
// services/reverse_tunnel/mod.rs
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

pub async fn start_if_enabled(
    config: &AppConfig,
    session_manager: Arc<SessionManager>,
    attach_registry: Arc<AttachRegistry>,
) -> Result<TunnelHandle, TunnelError>;

pub fn generate_powershell_script(config: &TunnelConfig) -> String;
pub fn generate_bash_script(config: &TunnelConfig) -> String;
```

## 5. 实现骨架

### 5.1 russh client + -R 转发

```rust
// services/reverse_tunnel/client.rs
use russh::{client, Channel};
use russh_keys::key::KeyPair;
use crate::services::ssh_session::{create_ssh_backend, SshAuthConfig};

pub async fn connect_and_forward(
    config: TunnelConfig,
    local_port: u16,
    status: Arc<RwLock<TunnelStatus>>,
) -> Result<(), TunnelError> {
    // 1. ⭐ 白名单校验
    validate_remote_users(&config)?;

    *status.write().await = TunnelStatus::Connecting;

    // 2. SSH client config
    let ssh_config = Arc::new(client::Config {
        keepalive_interval: Some(Duration::from_secs(15)),
        ..Default::default()
    });

    // 3. 认证
    let auth = config.ssh_auth.clone();
    let mut sh = client::connect(
        ssh_config.clone(),
        (config.ssh_host.as_str(), config.ssh_port),
        ClientHandler { auth: auth.clone() },
    ).await?;

    // 4. ⭐ -R 远端端口转发：remote_port → local_port
    let channel = sh.channel_open_forward(
        russh::ChannelForward::RemoteTcpIp(config.remote_port.to_string()),
        "127.0.0.1".to_string(),  // bind 127.0.0.1 only
        local_port,
    ).await?;

    *status.write().await = TunnelStatus::Connected { since_ms: now_ms() };
    tracing::info!("tunnel established: {}:{} -> 127.0.0.1:{}", config.ssh_host, config.remote_port, local_port);

    // 5. ⭐ 等 channel 关闭（断开信号）
    channel.wait_eof().await?;

    // 6. 标记 disconnected
    *status.write().await = TunnelStatus::Disconnected;
    Ok(())
}
```

### 5.2 指数退避重连

```rust
// services/reverse_tunnel/reconnect.rs
const BACKOFF_DELAYS: [u64; 5] = [1, 2, 4, 8, 16];  // 秒

pub async fn run_reconnect_loop(
    config: TunnelConfig,
    local_port: u16,
    status: Arc<RwLock<TunnelStatus>>,
    cancel: tokio::sync::watch::Receiver<()>,
) {
    let mut attempt = 0;
    loop {
        if *cancel.borrow() { break; }

        match connect_and_forward(&config, local_port, &status).await {
            Ok(_) => {
                // 正常断开 → 立即重连
                attempt = 0;
            }
            Err(e) => {
                attempt += 1;
                if attempt > BACKOFF_DELAYS.len() {
                    tracing::error!("tunnel failed after {} attempts: {}", attempt - 1, e);
                    *status.write().await = TunnelStatus::Failed {
                        reason: e.to_string(),
                        will_retry: false,
                    };
                    break;
                }
                let delay = BACKOFF_DELAYS[attempt - 1];
                tracing::warn!("tunnel connect failed (attempt {}/{}): {}; retry in {}s",
                    attempt, BACKOFF_DELAYS.len(), e, delay);

                *status.write().await = TunnelStatus::Reconnecting {
                    attempt: attempt as u32,
                    next_delay_secs: delay as u32,
                };

                tokio::select! {
                    _ = tokio::time::sleep(Duration::from_secs(delay)) => {},
                    _ = cancel.changed() => break,
                }
            }
        }
    }
}
```

### 5.3 启动入口

```rust
// services/reverse_tunnel/mod.rs
pub async fn start_if_enabled(
    config: &AppConfig,
    _session_manager: Arc<SessionManager>,
    _attach_registry: Arc<AttachRegistry>,
) -> Result<TunnelHandle, TunnelError> {
    if !config.tunnel.enabled {
        return Ok(TunnelHandle::noop());  // 未启用，返回空 handle
    }

    let status = Arc::new(RwLock::new(TunnelStatus::Disconnected));
    let (cancel_tx, cancel_rx) = tokio::sync::watch::channel(());

    let tunnel_config = config.tunnel.clone();
    let local_port = config.mcp.http.port;  // 默认 19847

    let status_clone = status.clone();
    tokio::spawn(async move {
        run_reconnect_loop(tunnel_config, local_port, status_clone, cancel_rx).await;
    });

    Ok(TunnelHandle {
        status,
        cancel: cancel_tx,
    })
}
```

### 5.4 脚本生成

```rust
// services/reverse_tunnel/scripts.rs
pub fn generate_powershell_script(config: &TunnelConfig) -> String {
    let auth_part = match &config.ssh_auth {
        SshAuthConfig::Password => String::new(),
        SshAuthConfig::PrivateKey { path } => format!("-i \"{}\"", path.display()),
        SshAuthConfig::Agent => String::new(),
    };
    format!(
        "# xsterm MCP 反向隧道（PowerShell）\n\
         # 用法：复制到 PowerShell 运行\n\
         ssh {auth} -N -R {remote_port}:127.0.0.1:{local_port} {user}@{host} -p {ssh_port}\n",
        auth = auth_part,
        remote_port = config.remote_port,
        local_port = config.local_mcp_port,
        user = config.ssh_user,
        host = config.ssh_host,
        ssh_port = config.ssh_port,
    )
}

pub fn generate_bash_script(config: &TunnelConfig) -> String {
    // 类似 PowerShell 格式
    format!(
        "#!/bin/bash\n\
         # xsterm MCP 反向隧道（bash）\n\
         ssh {auth} -N -R {remote_port}:127.0.0.1:{local_port} {user}@{host} -p {ssh_port}\n",
        ...
    )
}
```

## 6. 状态机

```
(Disconnected)
    │
    │ start_if_enabled()
    ▼
(Connecting)
    │
    ├── connect_and_forward 成功 → (Connected, since_ms = now)
    │                              │
    │                              ├── channel 正常关闭 → (Disconnected) → 立即重连
    │                              │
    │                              └── 异常断开 → (Reconnecting, attempt=1, delay=1s)
    │
    └── connect 失败 → (Reconnecting, attempt=N, delay=BACKOFF[N-1])
                       │
                       ├── N ≤ 5 → sleep delay → retry
                       │
                       └── N > 5 → (Failed, will_retry=false)
                                    │
                                    │ 用户手动点 "重试" 按钮 → (Connecting)
                                    │
                                    └── (永远 failed，等用户介入)
```

## 7. 跟其他 service 的关系

| service | 关系 |
|---|---|
| `services/ssh_session` | 复用 russh client + auth |
| `mcp_server::transport::http` | 隧道另一端是 local HTTP MCP server |
| `services/attach` | 远端 agent 通过 tunnel attach 时调 `try_attach(AttachSource::Tunnel)` |
| `commands/tunnel` | frontend UI 触发 start / stop + 生成脚本 |
| `services/config` | tunnel.enabled / remote_port / ssh 配置来自 settings.json |

## 8. IPC 契约（commands/tunnel.rs）

```rust
#[tauri::command]
pub async fn tunnel_status(
    tunnel_handle: State<'_, TunnelHandle>,
) -> Result<TunnelStatus, String> {
    Ok(tunnel_handle.status())
}

#[tauri::command]
pub async fn tunnel_start(
    config_store: State<'_, Arc<ConfigStore>>,
    session_manager: State<'_, Arc<SessionManager>>,
) -> Result<TunnelHandle, String> {
    reverse_tunnel::start_if_enabled(&config_store.get().await, session_manager.inner().clone(), ...).await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn tunnel_stop(
    tunnel_handle: State<'_, TunnelHandle>,
) -> Result<(), String> {
    tunnel_handle.stop();
    Ok(())
}

#[tauri::command]
pub async fn generate_tunnel_script(
    shell: String,  // "powershell" | "bash"
    config_store: State<'_, Arc<ConfigStore>>,
) -> Result<String, String> {
    let config = config_store.get().await;
    let tunnel_config = &config.tunnel;
    Ok(match shell.as_str() {
        "powershell" => reverse_tunnel::scripts::generate_powershell_script(tunnel_config),
        "bash" => reverse_tunnel::scripts::generate_bash_script(tunnel_config),
        _ => return Err("unsupported shell".into()),
    })
}
```

## 9. tunnel-status-changed 事件

```rust
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TunnelStatusEvent {
    pub status: TunnelStatus,  // Connected / Reconnecting / Failed
    pub timestamp_ms: u64,
}

// status 变化时 emit
self.app.emit("tunnel-status-changed", TunnelStatusEvent { ... });
```

**frontend UI 监听**：
- `status: Connected` → 绿色 ✓ 标识
- `status: Reconnecting { attempt, next_delay_secs }` → 黄色 ⚠ 倒计时
- `status: Failed { reason }` → 红色 ✗ 显示原因 + "重试" 按钮

## 10. 安全模型

### 10.1 远端用户白名单

`settings.json` (tunnel.allowedRemoteUsers 字段) 限制哪些远端用户可以连：

```rust
fn validate_remote_users(config: &TunnelConfig) -> Result<(), TunnelError> {
    if config.allowed_remote_users.is_empty() {
        return Ok(());  // 未配置 = 不限制
    }
    // russh 验证 SSH session 登录用户
    let remote_user = sh.authenticated_user().await?;
    if !config.allowed_remote_users.iter().any(|u| u == remote_user) {
        return Err(TunnelError::RemoteUserNotAllowed(remote_user.to_string()));
    }
    Ok(())
}
```

### 10.2 远端端口绑定限制

russh `-R` 端口必须 bind `127.0.0.1`（不能 bind `0.0.0.0`）——这是 russh 的内置约束。

### 10.3 鉴权由 MCP 层负责

tunnel 自身不做鉴权；远端 agent 连入后访问 MCP HTTP server 时必须带 Bearer token。
- 防止 tunnel 暴露给不受信用户后被滥用
- MCP 层 token 校验是已实现的安全边界

## 11. 测试

### 11.1 单元测试（mock sshd）

```rust
#[tokio::test]
async fn connect_and_forward_with_test_sshd() {
    // 用 russh 测试工具起一个 mock sshd（绑定 127.0.0.1:2222）
    let sshd = TestSshd::spawn_test_sshd().await;

    let config = TunnelConfig {
        enabled: true,
        ssh_host: "127.0.0.1".into(),
        ssh_port: 2222,
        ssh_user: "test".into(),
        ssh_auth: SshAuthConfig::Password("test".into()),
        local_mcp_port: 19847,
        remote_port: 19848,
        allowed_remote_users: vec!["test".into()],
    };

    let handle = start_test_mcp_server(19847).await;
    let status = Arc::new(RwLock::new(TunnelStatus::Disconnected));

    let result = connect_and_forward(config, 19847, &status).await;
    assert!(result.is_ok());

    let final_status = status.read().await.clone();
    assert!(matches!(final_status, TunnelStatus::Connected { .. }));
}
```

### 11.2 指数退避测试

```rust
#[tokio::test]
async fn exponential_backoff_after_5_attempts() {
    // 让 SSH 连接永远失败（连不存在的 host）
    let config = TunnelConfig {
        ssh_host: "127.0.0.1".into(),
        ssh_port: 1,  // 无服务
        ...
    };

    let status = Arc::new(RwLock::new(TunnelStatus::Disconnected));
    let (cancel_tx, cancel_rx) = watch::channel(());

    let handle = tokio::spawn(async move {
        run_reconnect_loop(config, 19847, status, cancel_rx).await;
    });

    // 等 35s（1+2+4+8+16 + 几个 connect 超时）
    tokio::time::sleep(Duration::from_secs(35)).await;
    cancel_tx.send(()).unwrap();
    handle.await.unwrap();

    let final_status = status.read().await.clone();
    assert!(matches!(final_status, TunnelStatus::Failed { will_retry: false, .. }));
}
```

## 12. 性能预算

| 操作 | 预算 |
|---|---|
| tunnel start | < 3s（TCP connect + SSH auth） |
| 正常断开重连 | < 1s |
| 异常断开第 1 次重连 | 1s |
| 异常断开第 5 次重连 | 16s |
| 状态 emit 延迟 | < 100ms |

## 13. 强约束

```bash
# tunnel 不直连 PTY/SSH
grep -rnE 'portable_pty|TmuxController' src-tauri/src/services/reverse_tunnel/
# 必须为空（复用 services/ssh_session）

# tunnel 只 bind 127.0.0.1（不允许 0.0.0.0）
grep -rn 'bind.*0\.0\.0\.0\|INADDR_ANY' src-tauri/src/services/reverse_tunnel/
# 必须为空

# tunnel 不写 MCP 协议
grep -rnE 'rmcp::|McpServerImpl' src-tauri/src/services/reverse_tunnel/
# 必须为空（tunnel 只做反向转发，鉴权归 MCP 层）

# 状态修改只在 reverse_tunnel 模块内
grep -rn 'tunnel_status\|TunnelStatus' src-tauri/src/ --include='*.rs' | grep -v 'services/reverse_tunnel\|commands/tunnel'
# 必须只出现在 reverse_tunnel/ 和 commands/tunnel.rs
```

## 14. 验收

- russh 连接本地 sshd 成功 < 3s ✅
- 隧道断开后指数退避（1/2/4/8/16s × 5）正确 ✅
- 5 次失败后 status = Failed ✅
- 远端用户白名单生效 ✅
- tunnel-status-changed 事件被 frontend 正确接收 ✅
- 脚本生成 PowerShell + bash 双版本 ✅

## 15. 文档

- [`README.md`](README.md) — 本文档
- [`INTERFACE.md`](INTERFACE.md) — TunnelHandle / TunnelStatus 公开 API
- [`DOWNSTREAM.md`](DOWNSTREAM.md) — 依赖图

## 16. 不在 MVP 范围

- 多跳代理（v2）
- 端口分配策略（v1.0 用户手动指定 remote_port）
- SSH key 协商热切换（v1.0）