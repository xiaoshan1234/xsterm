# Services · Attach — 对下依赖

> **位置**：`src-tauri/src/services/attach/`
> **依赖层级**：被多个上游 caller 调用，本身依赖少

## 1. 依赖图

```
services/attach/registry.rs
├── dashmap (crate)
├── tokio (crate)        [time::Duration 用于 idle_timeout]
├── serde (derive)
├── thiserror (derive)
├── tauri (AppHandle + Emitter)
└── models/attach.rs (AttachState 类型)

services/attach/idle_timeout.rs
├── tokio::time::interval
└── services/attach::registry (AttachRegistry)
```

## 2. 外部 crate 依赖

| crate | 用途 | 文件 |
|---|---|---|
| `dashmap` | `DashMap<u32, AttachState>` 并发安全 | `registry.rs` |
| `tokio` | `time::interval` + `sync::RwLock` (idle_timeout 配置) | `idle_timeout.rs` |
| `serde` | `Serialize` / `Deserialize` 派生 | `registry.rs` |
| `thiserror` | `AttachError` derive | `registry.rs` |
| `tauri` | `AppHandle` + `Emitter::emit` 广播事件 | `registry.rs` |

## 3. 内部模块依赖

| 模块 | 来源 | 用途 |
|---|---|---|
| `models::attach::AttachState` | `src-tauri/src/models/attach.rs` | attach 完整状态结构 |

## 4. 上游 caller（谁调 attach）

| caller | 调什么 | 何时调 |
|---|---|---|
| `services/session_manager::write` | `check_write_permission` | 每次 PTY/SSH/tmux 写入时 |
| `services/session_manager::close` | `force_detach` | 关闭 session 时 |
| `services/reverse_tunnel::*` | `try_attach` / `detach` | 远端 agent 接管时 |
| `mcp_server/tools/attach_session` | `try_attach(AttachSource::Mcp)` | MCP client attach |
| `mcp_server/tools/detach_session` | `detach` | MCP client detach |
| `mcp_server/server` (EOF handler) | `force_detach` | stdio EOF / HTTP stream close |
| `commands/mcp::attach_session` | `try_attach(AttachSource::Ui)` | frontend UI takeover |
| `commands/mcp::detach_session` | `detach` | frontend 释放按钮 |
| `services/attach::idle_timeout` | `list()` + `force_detach` | 后台 sweeper |

## 5. 下游被调（attach 调谁）

| callee | 来源 | 何时调 |
|---|---|---|
| `tauri::Emitter::emit` | `tauri` crate | 状态变化时广播 `mcp-attach-changed` |
| `tokio::time::interval::tick` | `tokio` crate | `idle_timeout` 后台 sweeper |
| **无** | — | attach 不调任何 `services::*` 或 `commands::*` |

## 6. 跟 config.toml 的关系

attach 的 idle_timeout_seconds 来自 config.toml `[mcp.idle_timeout] seconds`：

```rust
// services/config/mod.rs
pub fn apply_to_attach_registry(config: &AppConfig, registry: &AttachRegistry) {
    registry.set_idle_timeout(config.mcp.idle_timeout.seconds);
}

// 在 config reload 事件中调：
fn on_config_reloaded(new_config: AppConfig) {
    apply_to_attach_registry(&new_config, &state.attach_registry);
}
```

**关键**：
- config reload 不重启 attach task——只更新 `idle_timeout_seconds`（tokio RwLock 保护）
- attach 不直接读 config_store（避免循环依赖）

## 7. 不允许的依赖

- ❌ `services/attach/*` → `services/session_manager`（friend module 不算；只能通过公开 API）
- ❌ `services/attach/*` → `services/subscribe / capture`（attach 不感知其他 service 状态）
- ❌ `services/attach/*` → `services/local_session / ssh_session / tmux_session`（attach 不接触 PTY/SSH/tmux）
- ❌ `services/attach/*` → `mcp_server/*`（attach 不依赖 MCP 协议层）
- ❌ `services/attach/*` → `commands/*`（services 不依赖 commands）
- ❌ `services/attach/*` → `infrastructure/pty / ssh / tmux`（同上）
- ❌ `services/attach/*` → `models::session`（attach 不感知 session 元数据）

## 8. 生命周期

| 阶段 | 触发 | 副作用 |
|---|---|---|
| 创建 | `lib.rs::run()` setup 钩子创建 `Arc<AttachRegistry>` | spawn `idle_timeout` task |
| 运行 | 状态变化由 `try_attach / detach / force_detach` 触发 | emit `mcp-attach-changed` |
| 配置更新 | config.toml reload | 调 `set_idle_timeout(new_seconds)` |
| 销毁 | `Drop for AttachRegistry` | idle_timeout task 持 Arc，进程退出时自动清理 |

## 9. 强制约束（可机械校验）

```bash
# attach 不依赖 SessionManager 内部字段
grep -rnE 'session_manager\.(sessions|tmux_controllers|attach_state)\.' src-tauri/src/services/attach/
# 必须为空

# attach 不依赖 PTY/SSH/tmux
grep -rnE 'portable_pty|russh::|TmuxController' src-tauri/src/services/attach/
# 必须为空

# attach 不依赖 MCP 协议层
grep -rnE 'rmcp::|McpServerImpl|McpContext' src-tauri/src/services/attach/
# 必须为空

# attach 不感知 config_store 内部（除 idle_timeout 配置）
grep -rn 'config_store\.' src-tauri/src/services/attach/ | grep -v 'tests\|//'
# 必须只出现在 idle_timeout.rs 的 set_idle_timeout 调用点

# attach 修改只在 attach/ 和 session_manager.rs
grep -rn 'attach_state\.insert\|attach_state\.remove' src-tauri/src/ --include='*.rs'
# 必须只出现在 services/attach/ 和 services/session_manager.rs
```

## 10. 依赖变更流程

1. **新增 caller** → 在 §4 上游 caller 表加一行 + 检查不违反 §7 规则
2. **新增 AttachSource variant** → 更新 `models/attach.rs` + `registry.rs::try_attach` 接受 + 测试 + INTERFACE.md
3. **新增公开方法** → 在 `AttachRegistry` impl 加 + `INTERFACE.md` §1.4 加一行 + 测试
4. **删除公开方法** → 三处一起删除（破坏向后兼容需要 ADR）