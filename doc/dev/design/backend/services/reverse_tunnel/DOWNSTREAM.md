# Services · Reverse Tunnel — 对下依赖

> **位置**：`src-tauri/src/services/reverse_tunnel/`
> **依赖层级**：中——复用 ssh + mcp_http

## 1. 依赖图

```
services/reverse_tunnel/mod.rs
├── services/ssh_session (russh client + auth)
├── services/attach::AttachRegistry (远端 attach)
├── external: tokio (interval, watch, sleep)
├── external: russh (client::connect, channel_open_forward)
├── external: russh_keys (key::KeyPair)
└── external: uuid (session id)

services/reverse_tunnel/client.rs
└── russh::client::{Config, connect, Channel}

services/reverse_tunnel/reconnect.rs
└── tokio::time::{interval, sleep}

services/reverse_tunnel/scripts.rs
└── (pure string formatting)

services/reverse_tunnel/status.rs
└── tokio::sync::RwLock<TunnelStatus>
```

## 2. 外部 crate 依赖

| crate | 用途 |
|---|---|
| `russh` | SSH client + forward channel |
| `russh_keys` | SSH key 解析（host key verify） |
| `tokio` | async runtime + interval + watch |
| `serde` | TunnelStatus 序列化 |
| `thiserror` | TunnelError 派生 |

## 3. 内部模块依赖

| 模块 | 来源 | 用途 |
|---|---|---|
| `services::ssh_session::SshAuthConfig` | `services/ssh_session/` | 复用 SSH 认证 |
| `services::attach::AttachRegistry` | `services/attach/` | 远端 agent attach |
| `services::config::AppConfig` | `services/config/` + `models/config.rs` | tunnel config |

## 4. 上游 caller

| caller | 调什么 | 何时 |
|---|---|---|
| `lib.rs::run()` setup | `start_if_enabled(&config, ...)` | 启动时（如果 enabled） |
| `services/config::apply_to_subsystems` | `start_if_enabled` / `TunnelHandle::stop` | config reload 时 |
| `commands/tunnel::tunnel_start` | `start_if_enabled` | UI 手动启动 |
| `commands/tunnel::tunnel_stop` | `TunnelHandle::stop` | UI 手动停止 |
| `commands/tunnel::tunnel_status` | `TunnelHandle::status` | UI 轮询 |
| `commands/tunnel::generate_tunnel_script` | `generate_powershell_script / generate_bash_script` | UI 生成脚本 |

## 5. 下游被调

| callee | 来源 | 何时 |
|---|---|---|
| `russh::client::connect` | external | SSH 连接 |
| `russh::client::Handle::channel_open_forward` | external | -R 转发 |
| `services::attach::try_attach(AttachSource::Tunnel)` | `services/attach/` | 远端 agent 接管 |
| `tauri::Emitter::emit("tunnel-status-changed", ...)` | tauri | 状态变化时 |

## 6. 不允许的依赖

- ❌ `services/reverse_tunnel/*` → `services/local_session / ssh_session / tmux_session`（除复用 SshAuthConfig 类型）
- ❌ `services/reverse_tunnel/*` → `mcp_server/*`（tunnel 只做反向转发，鉴权归 MCP 层）
- ❌ `services/reverse_tunnel/*` → `commands/*`（services 不依赖 commands）

## 7. 强制约束

```bash
# tunnel 不直连 PTY/tmux
grep -rnE 'portable_pty|TmuxController' src-tauri/src/services/reverse_tunnel/
# 必须为空

# tunnel 不写 MCP 协议
grep -rnE 'rmcp::|McpServerImpl' src-tauri/src/services/reverse_tunnel/
# 必须为空

# tunnel 只 bind 127.0.0.1（不允许 0.0.0.0）
grep -rn 'bind.*0\.0\.0\.0\|INADDR_ANY\|TcpListener::bind.*\".*0' src-tauri/src/services/reverse_tunnel/
# 必须为空

# 状态修改只在 reverse_tunnel + commands/tunnel
grep -rn 'TunnelStatus' src-tauri/src/ --include='*.rs' | grep -v 'services/reverse_tunnel\|commands/tunnel'
# 必须只出现在这两个 module
```

## 8. 依赖变更流程

1. **新增上游 caller** → §4 加一行 + 检查 §6
2. **新增下游 callee** → §5 加一行 + 检查 §6
3. **修改 auth 支持** → 更新 client.rs + tests + INTERFACE.md §1