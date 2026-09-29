# Services · Attach — 职责

> **位置**：`src-tauri/src/services/attach/`
> **状态**：⭐ MVP P0-3（PRD §2 M7 + target-arch §5.5）
> **核心**：独占状态机——AI agent 接管 session 后，user 键盘被屏蔽

## 1. 一句话架构

**attach = 1 个 `AttachRegistry` + 1 个 `idle_timeout` tokio task + 1 个 `mcp-attach-changed` event**

```
src-tauri/src/services/attach/
├── mod.rs              公开 API（AttachRegistry + AttachSource + AttachState）
├── registry.rs         DashMap<u32, AttachState> + try_attach / detach / check_owned_by
├── idle_timeout.rs     tokio::time::interval 扫表，自动释放超时会话
├── release_password.rs 用户在终端输入口令释放（前端检测，backend 不感知）
└── tests.rs            mockall 单测（状态机 + idle + 互斥）
```

## 2. 职责

attach service 是 **PRD §2 M7 + M6 attach 工具的底层真相源**——所有 attach / detach 操作都通过它。

### 2.1 承担 4 类职责

1. **状态机**：try_attach / detach / force_detach（关闭 session 时调用）
2. **权限检查**：`check_write_permission(session_id, caller_client_id)` 给 `SessionManager::write` 调
3. **idle 自动释放**：tokio interval 每分钟扫一次，超时 session 强制 detach
4. **事件广播**：`mcp-attach-changed` emit 给 frontend UI 显示 banner

### 2.2 不承担

- ❌ PTY / SSH / tmux I/O（归 `session_manager` + `services/{local,ssh,tmux}_session`）
- ❌ 用户键盘屏蔽（前端 `Terminal.tsx` 负责——见 `ui/session/AiTakeoverBanner`）
- ❌ 释放口令检测（前端 `service/session/aiRelease.ts` 检测，命中后调 `detach_session` IPC）
- ❌ MCP 协议处理（`mcp_server::tools::attach_session` 调 `attach::try_attach`）
- ❌ 持久化（attach state 是运行时状态，不持久化）

## 3. 子结构详解

### 3.1 `mod.rs` — 公开 API

```rust
//! attach 服务——AI 接管 session 的独占状态机
//! 
//! # 公开类型
//! - [`AttachRegistry`] —— 全局单例，由 SessionManager 持有
//! - [`AttachSource`] —— 谁 attach 的（Mcp / Ui / Tunnel）
//! - [`AttachState`] —— 完整 attach 信息（source + 时间戳）

pub mod registry;
pub mod idle_timeout;

pub use registry::{AttachRegistry, AttachSource, AttachState, AttachError};
```

### 3.2 `registry.rs` — 状态机核心

```rust
use dashmap::DashMap;
use std::sync::Arc;
use std::time::{SystemTime, UNIX_EPOCH};
use tauri::AppHandle;
use tauri::Emitter;
use crate::models::attach::AttachState;
use crate::mcp_server::error::McpError;

pub struct AttachRegistry {
    /// session_id → AttachState（None = 未 attach）
    inner: DashMap<u32, AttachState>,
    /// idle_timeout 配置（来自 config.toml）
    idle_timeout_seconds: Arc<tokio::sync::RwLock<u64>>,
    /// ⭐ emit mcp-attach-changed 事件（前端 banner 监听）
    app: AppHandle,
}

#[derive(Debug, Clone)]
pub enum AttachSource {
    /// MCP client（stdin/stdout 或 HTTP）
    Mcp {
        client_id: String,
        agent_name: String,
        agent_pid: u32,
    },
    /// frontend UI "🤖 AI 接管" 按钮
    Ui {
        client_id: String,  // 固定 "ui-takeover"
    },
    /// 反向 SSH tunnel 远端 agent
    Tunnel {
        client_id: String,
        remote_user: String,
    },
}

impl AttachSource {
    /// 用于权限比较的统一 client_id
    pub fn client_id(&self) -> &str {
        match self {
            Self::Mcp { client_id, .. } => client_id,
            Self::Ui { client_id } => client_id,
            Self::Tunnel { client_id, .. } => client_id,
        }
    }
}

#[derive(Debug, thiserror::Error)]
pub enum AttachError {
    #[error("session {0} already attached by {1}")]
    AlreadyAttached(u32, String),
    #[error("session {0} not attached")]
    NotAttached(u32),
    #[error("session {0} not attached by this client")]
    NotOwnedByYou(u32),
}

impl AttachRegistry {
    pub fn new(app: AppHandle) -> Self {
        Self {
            inner: DashMap::new(),
            idle_timeout_seconds: Arc::new(tokio::sync::RwLock::new(3600)), // 默认 1 小时
            app,
        }
    }

    /// ⭐ 尝试 attach 一个 session
    /// 
    /// 行为：
    /// - 未 attach → 允许，记录 AttachState，返回 Ok
    /// - 已被同一 client attach → 幂等，返回 Ok
    /// - 已被别的 client attach → 拒绝，返回 AlreadyAttached
    /// 
    /// 副作用：
    /// - emit "mcp-attach-changed" { sessionId, clientId, action: "attach" }
    pub fn try_attach(
        &self,
        session_id: u32,
        source: AttachSource,
    ) -> Result<(), AttachError> {
        let client_id = source.client_id().to_string();
        let mut entry = self.inner.entry(session_id);

        match entry {
            dashmap::mapref::entry::Entry::Occupied(mut existing) => {
                let existing_state = existing.get();
                if existing_state.is_owned_by(&client_id) {
                    // 幂等：同一 client re-attach → 只更新时间戳
                    existing_state.refresh();
                    Ok(())
                } else {
                    Err(AttachError::AlreadyAttached(session_id, existing_state.source.client_id().to_string()))
                }
            }
            dashmap::mapref::entry::Entry::Vacant(vacant) => {
                let now_ms = now_ms();
                let state = AttachState {
                    source: source.clone(),
                    attached_at_ms: now_ms,
                    last_activity_at_ms: now_ms,
                };
                vacant.insert(state);

                // ⭐ emit 事件
                let _ = self.app.emit("mcp-attach-changed", McpAttachChangedEvent {
                    session_id,
                    client_id,
                    action: "attach".to_string(),
                });

                Ok(())
            }
        }
    }

    /// ⭐ 主动 detach（被 client 调用或前端 "释放" 按钮）
    pub fn detach(
        &self,
        session_id: u32,
        caller_client_id: &str,
    ) -> Result<(), AttachError> {
        let mut entry = self.inner.entry(session_id);

        match entry {
            dashmap::mapref::entry::Entry::Occupied(existing) => {
                let state = existing.get();
                if state.is_owned_by(caller_client_id) {
                    existing.remove();

                    let _ = self.app.emit("mcp-attach-changed", McpAttachChangedEvent {
                        session_id,
                        client_id: caller_client_id.to_string(),
                        action: "detach".to_string(),
                    });

                    Ok(())
                } else {
                    Err(AttachError::NotOwnedByYou(session_id))
                }
            }
            dashmap::mapref::entry::Entry::Vacant(_) => {
                Err(AttachError::NotAttached(session_id))
            }
        }
    }

    /// ⭐ 强制 detach（session 关闭时调，不检查 caller）
    pub fn force_detach(&self, session_id: u32) {
        if let Some((_, state)) = self.inner.remove(&session_id) {
            let _ = self.app.emit("mcp-attach-changed", McpAttachChangedEvent {
                session_id,
                client_id: state.source.client_id().to_string(),
                action: "detach".to_string(),
            });
        }
    }

    /// ⭐ 权限检查（给 SessionManager::write 调）
    /// 
    /// 返回 true 表示允许写入，false 表示拒绝
    pub fn check_write_permission(
        &self,
        session_id: u32,
        caller_client_id: Option<&str>,  // None = 来自 user 键盘（前端 IPC）
    ) -> bool {
        match self.inner.get(&session_id) {
            // 未 attach → 允许 user 写入
            None => true,
            // 已 attach → 只允许 attach agent 写入
            Some(state) => {
                match caller_client_id {
                    Some(client_id) => state.is_owned_by(client_id),
                    // caller 是 None（user keyboard）→ reject
                    None => false,
                }
            }
        }
    }

    /// ⭐ 刷新 last_activity_at_ms（每次 send_keys / capture / subscribe 调用时）
    pub fn record_activity(&self, session_id: u32, caller_client_id: &str) {
        if let Some(state) = self.inner.get(&session_id) {
            if state.is_owned_by(caller_client_id) {
                state.refresh();
            }
        }
    }

    pub fn get(&self, session_id: u32) -> Option<AttachState> {
        self.inner.get(&session_id).map(|r| r.value().clone())
    }

    pub fn list(&self) -> Vec<(u32, AttachState)> {
        self.inner.iter().map(|r| (*r.key(), r.value().clone())).collect()
    }
}

#[derive(Debug, Clone, serde::Serialize)]
struct McpAttachChangedEvent {
    session_id: u32,
    client_id: String,
    action: String,  // "attach" | "detach"
}

fn now_ms() -> u64 {
    SystemTime::now().duration_since(UNIX_EPOCH).unwrap().as_millis() as u64
}
```

### 3.3 `idle_timeout.rs` — 自动释放

```rust
use std::time::Duration;
use std::sync::Arc;
use crate::services::attach::registry::AttachRegistry;

/// 后台 tokio task：每 60s 扫一次，超时 session 自动 detach
pub async fn run_idle_sweeper(registry: Arc<AttachRegistry>) {
    let mut interval = tokio::time::interval(Duration::from_secs(60));
    loop {
        interval.tick().await;
        let timeout_seconds = *registry.idle_timeout_seconds.read().await;
        let now_ms = now_ms();

        let expired: Vec<u32> = registry.list().into_iter()
            .filter(|(_, state)| {
                let elapsed = (now_ms - state.last_activity_at_ms) / 1000;
                elapsed > timeout_seconds
            })
            .map(|(id, _)| id)
            .collect();

        for session_id in expired {
            tracing::warn!("session {session_id} attach idle timeout, auto-detaching");
            registry.force_detach(session_id);
        }
    }
}

fn now_ms() -> u64 {
    std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap().as_millis() as u64
}
```

**触发**：
- `attach_registry` 创建后立即 spawn 这个 task
- task 永生——不退出（除非整个进程退出）

### 3.4 `release_password.rs` — 释放口令（仅前端）

**为什么不归 backend**：
- 性能：每行 output 都 regex match 是 backend hot path 开销
- 安全：用户密码可能在 terminal 输出里，backend regex 误触概率不低
- PRD §4：release 是用户主动行为，frontend 检测已经够

详见 `frontend doc/dev/design/frontend/app/session/ai_takeover.md` §5。

**backend 只提供**：
- `invoke('detach_session', { sessionId, clientId: "ui-takeover" })` IPC（前端释放时调）
- `attach_registry.detach(session_id, "ui-takeover")` 内部执行

## 4. 状态机

```
                  ┌─────────────────┐
                  │  (none)         │
                  └────────┬────────┘
                           │ try_attach(session_id, source)
                           │ (any client)
                           ▼
       ┌───────────────────────────────────────┐
       │  (attached by client-A)               │
       │  attached_at_ms = T0                  │
       │  last_activity_at_ms = T0             │
       └───────┬───────────────────┬───────────┘
               │                   │
   try_attach  │                   │ idle > 30 min
   (same       │                   │ (auto-detach)
   client)     │                   │
   (idempotent)│                   │
               ▼                   ▼
       ┌─────────────────┐ ┌─────────────────┐
       │  refresh ts     │ │  (none)         │
       │  (no state      │ └─────────────────┘
       │   change)       │
       └─────────────────┘

   try_attach(other client) → ERROR AlreadyAttached(session_id, "client-A")

   detach(session_id, "client-A")  ──▶ (none)
   detach(session_id, "other")     ──▶ ERROR NotOwnedByYou(session_id)
   close_session(session_id)       ──▶ force_detach(session_id) → (none)
   EOF / stdio disconnect         ──▶ force_detach（由 mcp_server 调用）
```

## 5. 跟其他 service 的关系

| service | 关系 |
|---|---|
| `services/session_manager` | 持有 `Arc<AttachRegistry>`；`write()` 调 `check_write_permission`；`close()` 调 `force_detach` |
| `services/subscribe` | 不感知 attach；但 attach 是 `subscribe_output` 的前提（`require_attached` 检查在 mcp_server 层） |
| `services/capture` | 同上 |
| `services/reverse_tunnel` | 调 `try_attach` 当远端 agent 接管 |
| `mcp_server::tools::attach_session` | 调 `attach_registry.try_attach` |
| `mcp_server::tools::detach_session` | 调 `attach_registry.detach` |
| `commands/mcp::attach_session` | frontend UI takeover 调；内部委托 `attach_registry.try_attach(AttachSource::Ui)` |
| `commands/mcp::detach_session` | 同上 |

## 6. 用户故事（AI agent 视角）

- **作为 Claude Desktop 用户**，我用 `attach_session("tab-3")` → 该 tab 被独占，UI 显示 banner
- **作为 Claude Desktop 用户**，我持续调用 `send_keys` → `last_activity_at_ms` 自动 refresh，不会超时
- **作为 Claude Desktop 用户**，我忘记调 `detach_session` 然后关掉 → stdio EOF → backend 自动 `force_detach`
- **作为 user**，我在被 attach 的 tab 输入键盘 → Terminal.tsx 拦截 → 不发到 PTY
- **作为 user**，我在被 attach 的 tab 输入释放口令 → frontend 检测 → 调 `detach_session`
- **作为 user**，我点 UI "🤖 释放" 按钮 → 调 `detach_session` → backend 解除 attach

## 7. 关键设计决策

### 7.1 为什么独立 module（不内嵌 SessionManager）

考虑过 `SessionManager::attach_state: DashMap<u32, AttachState>` 但**否决**：
- attach 状态机复杂（try_attach / detach / idle_timeout / force_detach）
- 强单测需求——独立 module 便于 mockall 测试
- attach 同时被 MCP 工具 + UI takeover + reverse_tunnel 使用——多 caller，单一真相源
- 状态机独立演化（idle timeout policy / 互斥规则 / EOF 处理）

### 7.2 为什么 frontend 同时拦截 + backend 检查（双层防御）

**前端层**（`Terminal.tsx`）：
- useEffect 订阅 `attachState`（来自 `service/session/store`）
- attached → `keydown` capture 阶段 `preventDefault()` + `stopPropagation()`
- 优点：用户立即看到屏蔽（无 IPC 延迟），UX 好

**后端层**（`SessionManager::write`）：
- 调 `attach_registry.check_write_permission(session_id, caller_client_id)`
- 优点：即使前端被绕过（恶意脚本、bug、注入），backend 仍是最后防线

**双层冗余是必要的**——任何单层失效都会被另一层兜住。

### 7.3 为什么 emit 事件给 frontend 而不是 polling

考虑过 `frontend 轮询 get_attach_state(session_id)` 但**否决**：
- emit 单向广播，比 polling 快（毫秒级 vs 秒级）
- attach / detach 是低频事件（用户主动行为），polling 大部分时间是空转
- Tauri 2 的 emit / listen 是官方推荐模式

### 7.4 为什么 mcp-attach-changed 不携带 attachState 全字段

事件 payload 只携带 `{ session_id, client_id, action }`，不携带完整 `AttachState`：
- 事件轻量（4 字节 session_id + 字符串 + action）
- frontend 需要 attachState 时调 `get_session_attach_state(session_id)` 单独拉
- 避免 emit 大 payload 触发序列化开销

## 8. 测试策略

### 8.1 状态机测试（mockall）

```rust
#[cfg(test)]
mod tests {
    use super::*;

    fn test_app() -> AppHandle {
        tauri::test::mock_app()
    }

    #[test]
    fn try_attach_then_detach() {
        let reg = AttachRegistry::new(test_app());

        reg.try_attach(42, AttachSource::Ui { client_id: "ui-takeover".into() }).unwrap();
        assert!(reg.get(42).is_some());

        reg.detach(42, "ui-takeover").unwrap();
        assert!(reg.get(42).is_none());
    }

    #[test]
    fn try_attach_already_attached_rejects_other_client() {
        let reg = AttachRegistry::new(test_app());

        reg.try_attach(42, AttachSource::Mcp {
            client_id: "agent-A".into(),
            agent_name: "Claude".into(),
            agent_pid: 1234,
        }).unwrap();

        let result = reg.try_attach(42, AttachSource::Mcp {
            client_id: "agent-B".into(),
            agent_name: "Codex".into(),
            agent_pid: 5678,
        });

        assert!(matches!(result, Err(AttachError::AlreadyAttached(42, _))));
    }

    #[test]
    fn try_attach_same_client_is_idempotent() {
        let reg = AttachRegistry::new(test_app());

        reg.try_attach(42, AttachSource::Ui { client_id: "ui-takeover".into() }).unwrap();
        let first_state = reg.get(42).unwrap();
        std::thread::sleep(std::time::Duration::from_millis(10));

        reg.try_attach(42, AttachSource::Ui { client_id: "ui-takeover".into() }).unwrap();
        let second_state = reg.get(42).unwrap();

        assert!(second_state.last_activity_at_ms >= first_state.last_activity_at_ms);
    }

    #[test]
    fn check_write_permission_blocks_user_when_attached() {
        let reg = AttachRegistry::new(test_app());

        reg.try_attach(42, AttachSource::Mcp {
            client_id: "agent-A".into(),
            agent_name: "Claude".into(),
            agent_pid: 1234,
        }).unwrap();

        // agent 写入 → 允许
        assert!(reg.check_write_permission(42, Some("agent-A")));

        // user 写入 → 拒绝
        assert!(!reg.check_write_permission(42, None));

        // 其他 agent 写入 → 拒绝
        assert!(!reg.check_write_permission(42, Some("agent-B")));

        // detach 后 user 写入 → 允许
        reg.detach(42, "agent-A").unwrap();
        assert!(reg.check_write_permission(42, None));
    }

    #[tokio::test]
    async fn idle_timeout_auto_detaches() {
        let reg = Arc::new(AttachRegistry::new(test_app()));
        *reg.idle_timeout_seconds.write().await = 0;  // 立即超时（测试用）

        reg.try_attach(42, AttachSource::Ui { client_id: "ui-takeover".into() }).unwrap();
        let handle = tokio::spawn(run_idle_sweeper(reg.clone()));

        tokio::time::sleep(std::time::Duration::from_millis(100)).await;
        handle.abort();

        assert!(reg.get(42).is_none());
    }
}
```

### 8.2 集成测试（与 SessionManager）

```rust
#[tokio::test]
async fn write_blocked_when_attached_by_other() {
    let sm = SessionManager::new_for_test();
    sm.create_local(test_local_config(), Arc::new(MockBackend::new())).unwrap();
    let session_id = sm.list().first().unwrap().id;

    // MCP attach
    sm.attach_registry.try_attach(session_id, AttachSource::Mcp {
        client_id: "agent-A".into(),
        agent_name: "Claude".into(),
        agent_pid: 1234,
    }).unwrap();

    // user 写入 → 拒绝
    let result = sm.write(session_id, b"hello", Some("ui-takeover"));
    assert!(matches!(result, Err(SessionError::PermissionDenied)));
}
```

## 9. 关键文件路径

| 文件 | 行数预估 | 内容 |
|---|---|---|
| `mod.rs` | 10 | re-exports |
| `registry.rs` | 200 | `AttachRegistry` + `AttachSource` + `try_attach / detach / check_write_permission` |
| `idle_timeout.rs` | 50 | tokio interval sweeper |
| `tests.rs` | 200 | mockall 单测 |

## 10. 强约束（pre-commit 必跑）

```bash
# attach state 修改只在 attach/ 和 session_manager.rs（friend module）
grep -rn 'attach_state\.insert\|attach_state\.remove' src-tauri/src/ --include='*.rs'
# 必须只出现在 services/attach/ 和 services/session_manager.rs

# attach 不感知 PTY/SSH/tmux
grep -rnE 'portable_pty|russh::|TmuxController' src-tauri/src/services/attach/ --include='*.rs'
# 必须为空（attach 只操作 DashMap + emit）

# attach 不感知 MCP 协议
grep -rn 'rmcp::\|McpServerImpl' src-tauri/src/services/attach/ --include='*.rs'
# 必须为空（attach 是 backend 内部状态机，不依赖 MCP 协议层）

# attach 不感知 config.toml（除 idle_timeout_seconds 配置）
grep -rn 'config_store\|config\.toml' src-tauri/src/services/attach/ --include='*.rs'
# 必须只出现在 idle_timeout.rs 的 set_idle_timeout_seconds 方法
```

## 11. 文档地图

| 文档 | 内容 |
|---|---|
| [`README.md`](README.md) | 本文档 |
| [`INTERFACE.md`](INTERFACE.md) | `AttachRegistry` / `AttachSource` / `AttachState` 公开类型 |
| [`DOWNSTREAM.md`](DOWNSTREAM.md) | attach 的依赖图（被谁调、调谁） |

## 12. 验收

- 状态机 4 个状态转换（attach / detach / 互斥 / idle timeout）100% 覆盖 ✅
- 双层防御（前端 + 后端）均独立测试 ✅
- force_detach 在 close_session 时正确触发 ✅
- emit mcp-attach-changed 事件被前端 service/session/bridge 正确接收 ✅
- idle_timeout 默认 3600s（来自 config.toml）；tokio task 60s 扫一次 ✅