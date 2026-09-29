# Services · Subscribe — 对下依赖

> **位置**：`src-tauri/src/services/subscribe/`
> **依赖层级**：基础设施层（被 services/session_manager + mcp_server 调用）

## 1. 依赖图

```
services/subscribe/ring.rs
├── std::collections::VecDeque
├── tokio::sync::Mutex (ring lock)
├── tokio::sync::RwLock (subscribers lock)
├── std::sync::atomic::AtomicU64 (next_seq)
└── external: serde (RingEntry Serialize/Deserialize)

services/subscribe/registry.rs
├── dashmap::DashMap
└── std::sync::Arc<OutputRing>

services/subscribe/subscriber.rs
└── tokio::sync::mpsc (channel)
```

## 2. 外部 crate 依赖

| crate | 用途 |
|---|---|
| `dashmap` | session_id → OutputRing 并发安全 |
| `tokio` | async runtime + Mutex/RwLock/mpsc |
| `serde` | RingEntry 序列化 |
| `thiserror` | SubscribeError 派生 |

## 3. 内部模块依赖

无内部依赖——subscribe 是 leaf service（被多个 caller 调用，自身不调其他 service）。

## 4. 上游 caller

| caller | 调什么 | 何时 |
|---|---|---|
| `services/session_manager::create_local` | `subscribe_registry.get_or_create(session_id)` | 创建 session 时 |
| `services/session_manager::create_ssh` | 同上 | 创建 session 时 |
| `services/session_manager::create_tmux` | 同上 | 创建 session 时 |
| `services/session_manager::close` | `subscribe_registry.remove(session_id)` | 关闭 session 时 |
| `services/local_session::read_loop` | `output_ring.push(bytes)` | PTY 读循环 |
| `services/ssh_session::read_loop` | 同上 | SSH 读循环 |
| `services/tmux_session::dispatch` | 同上 | tmux controller output 事件 |
| `mcp_server/tools/subscribe_output` | `output_ring.subscribe(client_id, since_seq)` | MCP subscribe 工具 |
| `mcp_server/tools/unsubscribe_output` | `output_ring.unsubscribe(client_id)` | MCP unsubscribe 工具 |
| `mcp_server/tools/wait_for` | `output_ring.since(since_seq)` | MCP wait_for 临时订阅 |
| `services/capture::capture_text/ansi` | `output_ring.tail(n)` | capture 模式 fallback |

## 5. 下游被调

| callee | 来源 | 何时 |
|---|---|---|
| `tauri::Emitter::emit("output-overflow", ...)` | tauri | ring 满时（emit_overflow_event helper） |

## 6. 不允许的依赖

- ❌ `services/subscribe/*` → `services/attach`（subscribe 不感知 attach）
- ❌ `services/subscribe/*` → `services/config`（subscribe 不读配置）
- ❌ `services/subscribe/*` → `services/session_manager`（subscribe 是 friend module——通过 Arc<SubscribeRegistry> 共享，不反向依赖 session_manager 类型）
- ❌ `services/subscribe/*` → `mcp_server/*`（subscribe 是 MCP 的下层）
- ❌ `services/subscribe/*` → `commands/*`（services 不依赖 commands）
- ❌ `services/subscribe/*` → `infrastructure/*`（subscribe 不接触平台 API）

## 7. 强制约束

```bash
# OutputRing 修改只在 subscribe/ + session_manager.rs + 后端 read_loop
grep -rn 'output_ring\.push\|output_ring\.insert\|output_ring\.remove' src-tauri/src/ --include='*.rs' | grep -v 'services/subscribe/\|services/session_manager\|local_session\|ssh_session\|tmux_session'
# 必须为空

# subscribe 不依赖 attach / config / session_manager / mcp_server
grep -rnE 'attach|AttachRegistry|config_store|session_manager|rmcp::' src-tauri/src/services/subscribe/
# 必须为空

# subscribe 不接触 PTY/SSH/tmux
grep -rnE 'portable_pty|russh::|TmuxController' src-tauri/src/services/subscribe/
# 必须为空
```

## 8. 依赖变更流程

1. **新增上游 caller** → §4 加一行 + 检查 §6
2. **新增 RingEntry 字段** → INTERFACE.md §1 + 测试
3. **修改 subscribe 行为** → sweep 逻辑更新 + INTERFACE.md §2 同步