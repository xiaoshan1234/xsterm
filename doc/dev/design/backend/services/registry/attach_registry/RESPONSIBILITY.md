# Services · Registry · AttachRegistry — 职责

> **位置**：`src-tauri/src/services/registry/attach_registry.rs`
> **状态**：⭐ MVP P0-3（PRD §2 M7 + target-arch §5.5）
> **核心**：独占状态机——AI agent 接管 session 后，user 键盘被屏蔽

## 1. 这个 module 负责什么

attach registry service 是 **PRD §2 M7 + M6 attach 工具的底层真相源**——所有 attach / detach 操作都通过它。

承担 4 类职责：

1. **状态机**：try_attach / detach / force_detach（关闭 session 时调用）
2. **权限检查**：`check_write_permission(session_id, caller_client_id)` 给 `SessionManager::write` 调
3. **idle 自动释放**：tokio interval 每分钟扫一次，超时 session 强制 detach
4. **事件广播**：`mcp-attach-changed` event 给 frontend 订阅

## 2. 这个 module **不**负责什么

- ❌ PTY / SSH / tmux I/O（归 `services/lifecycle/{local,ssh,tmux}/`）
- ❌ 用户键盘屏蔽（前端 `Terminal.tsx` 负责——见 frontend `app/session/ai_takeover/`）
- ❌ 释放口令检测（前端 `service/session/aiRelease.ts` 检测，命中后调 `detach_session` IPC）
- ❌ MCP 协议处理（`frontend/app/mcp/tools/attach_session` 调 `commands/mcp::attach_session`）
- ❌ 持久化（attach state 是运行时状态，不持久化）

## 3. 公开 API 边界

```rust
impl AttachRegistry {
    pub fn try_attach(&self, session_id: u32, source: AttachSource) -> Result<(), AttachError>;
    pub fn detach(&self, session_id: u32, caller_client_id: &str) -> Result<(), AttachError>;
    pub fn force_detach(&self, session_id: u32);
    pub fn check_write_permission(&self, session_id: u32, caller_client_id: Option<&str>) -> bool;
    pub fn record_activity(&self, session_id: u32, caller_client_id: &str);
    pub fn get(&self, session_id: u32) -> Option<AttachState>;
    pub fn list(&self) -> Vec<(u32, AttachState)>;
    pub fn count(&self) -> usize;
    pub fn set_idle_timeout(&self, seconds: u64);
    pub fn idle_timeout_seconds(&self) -> u64;
}
```

详见 [`INTERFACE.md`](INTERFACE.md)。

## 4. 内部实现约束

**数据结构**：
- `inner: DashMap<u32, AttachState>` — session_id → AttachState
- `idle_timeout_seconds: Arc<RwLock<u64>>` — 可热更新（来自 settings.json）

**state machine**：
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
```

**关键约束**：
- 写操作都用 `DashMap::entry()` API（CAS 语义）
- emit event 放在 entry 锁内（避免窗口期）
- `record_activity` 只在 attach 状态匹配 caller 时更新

## 5. 关键设计决策

### 5.1 为什么独立 module（不内嵌 SessionManager）

考虑过 `SessionManager::attach_state: DashMap<u32, AttachState>` 但**否决**：
- attach 状态机复杂（try_attach / detach / idle_timeout / force_detach）
- 强单测需求——独立 module 便于 mockall
- attach 同时被 MCP 工具 + UI takeover + reverse_tunnel 使用——多 caller，单一真相源
- 状态机独立演化（idle timeout policy / 互斥规则 / EOF 处理）

### 5.2 为什么 frontend 同时拦截 + backend 检查（双层防御）

**前端层**（`Terminal.tsx`）：
- useEffect 订阅 `attachState`（来自 `service/session/store`）
- attached → `keydown` capture 阶段 `preventDefault()` + `stopPropagation()`
- 优点：用户立即看到屏蔽（无 IPC 延迟），UX 好

**后端层**（`SessionManager::write`）：
- 调 `attach_registry.check_write_permission(session_id, caller_client_id)`
- 优点：即使前端被绕过（恶意脚本、bug、注入），backend 仍是最后防线

**双层冗余是必要的**——任何单层失效都会被另一层兜住。

### 5.3 为什么 emit 事件给 frontend 而不是 polling

考虑过 `frontend 轮询 get_attach_state(session_id)` 但**否决**：
- emit 单向广播，比 polling 快（毫秒级 vs 秒级）
- attach / detach 是低频事件（用户主动行为），polling 大部分时间是空转
- Tauri 2 的 emit / listen 是官方推荐模式

### 5.4 为什么 mcp-attach-changed 不携带 attachState 全字段

事件 payload 只携带 `{ session_id, client_id, action }`，不携带完整 `AttachState`：
- 事件轻量（4 字节 session_id + 字符串 + action）
- frontend 需要 attachState 时调 `get_session_attach_state(session_id)` 单独拉
- 避免 emit 大 payload 触发序列化开销

## 6. 文档

- [`README.md`](README.md) — 本文档（职责）
- [`INTERFACE.md`](INTERFACE.md) — 公开 API + 类型契约
- [`DOWNSTREAM.md`](DOWNSTREAM.md) — 依赖图 + 强约束

## 7. 验收

- 状态机 4 个状态转换（attach / detach / 互斥 / idle timeout）100% 覆盖 ✅
- 双层防御（前端 + 后端）均独立测试 ✅
- force_detach 在 close_session 时正确触发 ✅
- emit mcp-attach-changed 事件被前端 service/session/bridge 正确接收 ✅
- idle_timeout 默认 3600s（来自 settings.json）；tokio task 60s 扫一次 ✅