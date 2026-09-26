# Module · Infra SSH — Reverse Tunnel

> **位置**：`src-tauri/src/infrastructure/ssh/reverse_tunnel.rs`
> **类型**：⭐ M8 关键功能（PRD §2 M8 + §7.4）—— 远端 AI agent 通过反向 SSH 隧道连本地 MCP server
> **被使用方**：`frontend/app/mcp/server.ts`（TCP transport 接受外部连接；MCP server 整体归 frontend TS 层，v6 后）+ `app/shell`（启动时建立 / 重连）
> **外部依赖**：`russh` crate（已有）+ `tokio::process`（生成 ssh client 子进程）

## 1. 这个子模块负责什么

PRD §2 M8 描述的"反向 SSH 隧道"——本地 xsterm 主动 `ssh -R` 暴露本地 MCP server 端口给远端 host,远端 AI agent 通过反向隧道连本地 MCP。

承担 4 类职责:

1. **隧道建立** —— `ssh -R <remote_port>:127.0.0.1:<local_mcp_port> user@host` spawn 子进程 + 监控生命周期
2. **隧道重连** —— 指数退避(1s / 2s / 4s / 8s / 16s),最多 5 次后停止并提示
3. **连接脚本生成** —— 自动生成 PowerShell + bash 双版本 `setup-tunnel.ps1` / `setup-tunnel.sh`
4. **状态上报** —— emit Tauri 事件 `reverse-tunnel-status-changed` 给 frontend logger

## 2. 子结构

```rust
infrastructure/ssh/
├── mod.rs
├── traits.rs               SshBackend trait (已存在)
├── backend.rs              SshBackendImpl (已存在)
├── session.rs              SshSession + SshSessionHandle (已存在)
├── upload.rs               upload_file_via_ssh (已存在)
├── probe.rs                run_command_capture_stdout (已存在)
├── reverse_tunnel.rs       ⭐ 新增——ReverseTunnelManager + ReverseTunnelConfig + 重连
├── mock.rs                 MockSshBackend (已存在)
└── errors.rs               SshError (已存在)
```

## 3. 核心接口

```rust
// infrastructure/ssh/reverse_tunnel.rs
use std::process::Stdio;
use tokio::process::Child;
use tokio::sync::Mutex;

pub struct ReverseTunnelConfig {
    pub enabled: bool,                    // 用户 settings 启用
    pub remote_host: String,              // 远端 SSH server (e.g., "ai-server.example.com")
    pub remote_port: u16,                 // 远端暴露端口 (e.g., 7000)
    pub local_mcp_port: u16,              // 本地 MCP TCP port (default 7000 = MCP server local listen)
    pub ssh_user: String,                 // SSH 用户
    pub ssh_auth: SshAuthMethod,          // 复用 domain::session::SshAuthMethod
    pub max_reconnect_attempts: u32,      // 默认 5
    pub initial_backoff_ms: u64,          // 默认 1000ms
}

pub struct ReverseTunnelManager {
    config: ReverseTunnelConfig,
    current_child: Mutex<Option<Child>>,
    reconnect_state: Mutex<ReconnectState>,
}

struct ReconnectState {
    attempts: u32,
    next_backoff_ms: u64,
    shutting_down: bool,
}

impl ReverseTunnelManager {
    pub fn new(config: ReverseTunnelConfig) -> Self;
    
    /// 启动反向隧道（首次或重连）
    pub async fn start(&self) -> Result<(), SshError>;
    
    /// 关闭反向隧道（清理子进程 + 重置重连状态）
    pub async fn shutdown(&self) -> Result<(), SshError>;
    
    /// 查询当前状态
    pub fn status(&self) -> ReverseTunnelStatus;
}

pub enum ReverseTunnelStatus {
    Disabled,
    Connecting { attempt: u32 },
    Connected { pid: u32, since_ms: u64 },
    Reconnecting { attempt: u32, next_backoff_ms: u64 },
    Failed { attempts: u32, last_error: String },
}
```

## 4. 启动流程

```rust
// infrastructure/ssh/reverse_tunnel.rs::start
pub async fn start(&self) -> Result<(), SshError> {
    if !self.config.enabled {
        return Ok(());  // 未启用直接返回
    }
    
    loop {
        match self.spawn_ssh_process().await {
            Ok(child) => {
                let pid = child.id().unwrap_or(0);
                *self.current_child.lock().await = Some(child);
                self.emit_status(ReverseTunnelStatus::Connected { pid, since_ms: now_ms() });
                
                // 等待子进程退出
                let mut child = self.current_child.lock().await;
                if let Some(mut c) = child.take() {
                    let status = c.wait().await.map_err(SshError::Io)?;
                    
                    if self.reconnect_state.lock().await.shutting_down {
                        return Ok(());  // 主动关闭
                    }
                    
                    // 非零退出 = 断开,触发重连
                    tracing::warn!(?status, "reverse tunnel SSH process exited unexpectedly");
                }
            }
            Err(e) => {
                tracing::error!(?e, "reverse tunnel SSH spawn failed");
                self.emit_status(ReverseTunnelStatus::Failed {
                    attempts: self.reconnect_state.lock().await.attempts,
                    last_error: e.to_string(),
                });
            }
        }
        
        // 重连逻辑
        let mut state = self.reconnect_state.lock().await;
        if state.shutting_down { return Ok(()); }
        if state.attempts >= self.config.max_reconnect_attempts {
            return Err(SshError::ReconnectExhausted);
        }
        
        state.attempts += 1;
        let backoff = state.next_backoff_ms;
        state.next_backoff_ms *= 2;  // 指数退避
        
        drop(state);
        self.emit_status(ReverseTunnelStatus::Reconnecting {
            attempt: self.reconnect_state.lock().await.attempts,
            next_backoff_ms: backoff,
        });
        tokio::time::sleep(Duration::from_millis(backoff)).await;
    }
}
```

**关键**:
- 重连循环使用 `loop` + 指数退避(1s → 2s → 4s → 8s → 16s)
- `max_reconnect_attempts = 5` 超出后返回 `ReconnectExhausted`
- 子进程 spawn 失败**也**重连(可能 ssh binary 不在 PATH,重连有机会恢复)
- `shutting_down` 标志在 `shutdown()` 时设置,防止 race condition

## 5. ssh -R 命令构造

```rust
fn build_ssh_command(config: &ReverseTunnelConfig) -> Command {
    let mut cmd = Command::new("ssh");
    cmd.args([
        "-N",                           // 不分配远程 shell
        "-o", "StrictHostKeyChecking=accept-new",
        "-o", "ServerAliveInterval=30", // 每 30s 探活
        "-o", "ServerAliveCountMax=3",  // 3 次失败断开
        "-R", &format!("{}:127.0.0.1:{}", config.remote_port, config.local_mcp_port),
        "-p", &config.ssh_port_or_default().to_string(),
        &format!("{}@{}", config.ssh_user, config.remote_host),
    ]);
    
    // 认证方式
    match &config.ssh_auth {
        SshAuthMethod::Password(pwd) => {
            // 用 sshpass 或 expect 包装(避免 ssh 子进程 TTY 提示)
            // MVP 简化: 只支持 key-based
        }
        SshAuthMethod::PrivateKey { path, passphrase } => {
            cmd.args(["-i", path]);
            if let Some(pp) = passphrase {
                cmd.env("SSH_PASSPHRASE", pp);
            }
        }
    }
    
    cmd.stdout(Stdio::null()).stderr(Stdio::piped());
    cmd
}
```

**关键**:
- MVP 只支持 private key 认证(password 太复杂,需要 sshpass / expect 工具)
- `-o ServerAliveInterval=30` 让隧道定时探活,半断开能及时检测
- stderr 捕获到日志(用于诊断连接错误)

## 6. 启动编排

```rust
// commands/shell/api.rs::initialize (v6 合并后)
pub fn initialize(app: &mut tauri::App) -> Result<(), String> {
    // 1. logging 初始化
    // 2. binary output channel
    // 3. RealAppBackend 注册
    // 4. session-output-channel emit
    
    // 5. 反向隧道(可选,用户 settings 启用才启动)
    let config = load_reverse_tunnel_config(app.handle())?;
    if config.enabled {
        let manager = Arc::new(ReverseTunnelManager::new(config));
        app.manage(manager.clone());
        tokio::spawn(async move {
            if let Err(e) = manager.start().await {
                tracing::error!("reverse tunnel failed: {e}");
            }
        });
    }
    
    Ok(())
}
```

## 7. 脚本生成(自动给用户)

```typescript
// app/shell/usecases/generateTunnelScript.ts (frontend)
export function generatePowerShellScript(config: ReverseTunnelConfig): string {
  return `# setup-tunnel.ps1 — generated by xsterm
# Run this locally to expose MCP server to remote AI agent

$RemoteHost = "${config.remote_host}"
$RemotePort = ${config.remote_port}
$LocalMcpPort = ${config.local_mcp_port}
$SshUser = "${config.ssh_user}"

ssh -N -o StrictHostKeyChecking=accept-new \\
    -R "$RemotePort`:127.0.0.1:$LocalMcpPort" \\
    "$SshUser@$RemoteHost"
`;
}

export function generateBashScript(config: ReverseTunnelConfig): string {
  return `# setup-tunnel.sh — generated by xsterm
# Run this locally to expose MCP server to remote AI agent

REMOTE_HOST="${config.remote_host}"
REMOTE_PORT=${config.remote_port}
LOCAL_MCP_PORT=${config.local_mcp_port}
SSH_USER="${config.ssh_user}"

ssh -N -o StrictHostKeyChecking=accept-new \\
    -R "$REMOTE_PORT:127.0.0.1:$LOCAL_MCP_PORT" \\
    "$SSH_USER@$REMOTE_HOST"
`;
}
```

**关键**:
- 脚本由 frontend 生成并保存到 `~/xsterm/tunnel/` 或用户指定目录
- 用户**也可**选择手动运行(advanced 场景: SSH agent 转发 / 多跳)
- 自动生成的脚本**不**包含密码 — 私有 key 用户跑 ssh-agent 转发

## 8. 错误处理

```rust
// 扩展 SshError 枚举
pub enum SshError {
    // ... 已有 ...
    
    #[error("reverse tunnel reconnect exhausted after {0} attempts")]
    ReconnectExhausted(u32),
    
    #[error("reverse tunnel SSH spawn failed: {0}")]
    ReverseTunnelSpawn(String),
    
    #[error("reverse tunnel config invalid: {0}")]
    ReverseTunnelConfig(String),
}
```

## 9. 状态事件契约

```rust
// emit 给 frontend 的事件
#[derive(Serialize, Clone)]
pub enum ReverseTunnelStatusEvent {
    Connected { pid: u32 },
    Reconnecting { attempt: u32, next_backoff_ms: u64 },
    Failed { attempts: u32, last_error: String },
    Disabled,
}

// frontend 监听
eventBus.on("reverse-tunnel-status-changed", (event) => {
    // ui/shell 显示 tunnel 状态指示器
    // logger 记录所有状态变化
});
```

## 10. 安全约束

- **私钥不落盘** —— 启动时 user 提供路径 + ssh-agent 转发,不复制到 xsterm 数据目录
- **known_hosts 校验** —— `StrictHostKeyChecking=accept-new`(用户首次连接会提示确认指纹;后续接受)
- **不存 SSH 密码** —— MVP 只支持 private key,不引入 sshpass / expect 等额外依赖
- **重连尝试上限** —— 5 次后停止重连 + UI 提示,避免疯狂 spawn 消耗资源

## 11. 强制约束(可机械校验)

```bash
# reverse_tunnel 不直接 import commands (必须经过 SshBackend trait)
grep -rn 'use crate::commands' src-tauri/src/infrastructure/ssh/reverse_tunnel.rs
# 必须为空

# reverse_tunnel 不持有 password
grep -rn 'password' src-tauri/src/infrastructure/ssh/reverse_tunnel.rs | grep -v 'SshAuthMethod'
# 必须为空

# reverse_tunnel 不绕过 max_reconnect_attempts
grep -rn 'attempts.*=\|loop' src-tauri/src/infrastructure/ssh/reverse_tunnel.rs
# 应该出现 — 重连逻辑必须存在
```

## 12. 测试

- `reverse_tunnel::start` 集成测试(需要 mock ssh binary 或 subprocess mock)
- 重连指数退避测试(单元)
- `status()` 状态机测试
- 脚本生成测试(frontend)

## 13. 依赖变更流程

1. **新增 reverse_tunnel 配置字段** → 加 `ReverseTunnelConfig` 字段 + 同步 frontend settings form + INTERFACE.md §3
2. **修改重连策略** → 加 `ReconnectConfig` 字段(默认 5 次 / 1s 起步)
3. **新增认证方式** → 加 `SshAuthMethod` 变体 + `build_ssh_command` 分支
4. **新增状态事件** → 加 `ReverseTunnelStatusEvent` 变体 + frontend 监听同步
