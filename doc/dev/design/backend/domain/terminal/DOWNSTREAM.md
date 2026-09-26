# Domain · Terminal — 对下依赖

> **位置**：`src-tauri/src/domain/terminal/`

## 1. 依赖图

```
domain/terminal/
├── state.rs             ────►  domain/session::SessionIdSource (Arc<引用>)
├── state.rs             ────►  infra/tauri::AppBackend (Arc<dyn>)
├── state.rs             ────►  infra/tmux::{TmuxBackend, NativeTmuxBackend, SshTmuxBackend} (Box<dyn>)
├── controller/spawn.rs ────►  tokio::process::Command (tmux -CC 子进程)
├── controller/spawn.rs ────►  infra/ssh::SshBackend (russh 连接)
├── controller/spawn.rs ────►  domain/session::SessionIdSource (Arc<>)
├── controller/commands.rs ──►  infra/tmux::{TmuxBackend, CommandKind} (通过 trait)
├── controller/registry.rs ──►  (self-only: HashMap bindings)
├── controller/sync.rs   ────►  tokio::sync::oneshot (bootstrap rendezvous)
├── controller/io_tasks.rs ──►  tokio::{spawn, task::JoinHandle} (4 个 IO task)
├── controller/subscriber.rs ──►  infra/tmux::ProtocolEvent 累积
├── dispatch.rs          ────►  tokio::sync::mpsc (event dispatch channel)
├── bridge.rs            ────►  infra/tauri::AppBackend (emit ProtocolEvent → Tauri)
├── protocol/wire.rs     ────►  (pure: octal codec)
├── protocol/command.rs   ────►  (pure: CommandKind enum)
├── protocol/events.rs    ────►  (pure: ProtocolEvent enum)
├── protocol/parser.rs   ────►  (pure: parser)
├── protocol/version.rs  ────►  (pure: handshake)
├── types.rs             ────►  domain/session::SessionInfo (字段引用)
├── types.rs             ────►  domain/session::SshAuthMethod (字段引用)
├── rules.rs             ────►  domain/session::SessionInfo (构造)
└── errors.rs            ────►  thiserror::Error
```

## 2. domain/session（核心依赖）

| 依赖 | 来源 | 何时 |
|--|--|--|
| `SessionIdSource` (Arc) | `domain/session/id.rs` | `spawn_create` / `spawn_attach` 注入——controller 用 `allocate()` 分配 xsterm pane session id |
| `domain::session::SessionManager::TmuxPaneHandle::controller` | `domain::session::backends::tmux_pane.rs` | session manager 持有 `Arc<TmuxController>` 引用 + 调公开方法 |

**约束**：

- terminal **不** import `domain::session::SessionManager` ——session manager 主动调 terminal
- terminal **不** import `domain::session::backends::tmux_pane` ——TmuxPaneHandle 是 session 的 backend impl，session 自己持有

## 3. infra/tmux（外部资源）

| 依赖 | 来源 | 何时 |
|--|--|--|
| `TmuxBackend` trait | `infra/tmux/backend.rs` | terminal 持有 `Box<dyn TmuxBackend>`——local / ssh 两种实现 |
| `NativeTmuxBackend` | `infra/tmux/backend.rs` (impl) | local tmux 调 portable-pty 子进程 |
| `SshTmuxBackend` | `infra/tmux/backend.rs` (impl) | remote tmux 通过 SSH channel 调 |
| `TmuxInfraError` | `infrastructure/tmux/errors.rs` | terminal **不**直接 import（统一用 `TmuxError`） |

**约束**：

- terminal 通过 `TmuxBackend` trait 调外部 tmux -CC 子进程
- terminal **不** import `TmuxInfraError`（infra 层用，terminal 层用 `TmuxError`）
- terminal **不** import `NativeTmuxBackend` / `SshTmuxBackend` 具体实现——只 import trait

## 4. infra/tauri（emit 事件依赖）

| 依赖 | 来源 | 何时 |
|--|--|--|
| `AppBackend` trait | `infra/tauri/app_backend.rs` | terminal 持有 `Arc<dyn AppBackend>`——emit tmux 事件到 Tauri |
| `AppBackend::emit(event, payload)` | 同上 | `bridge.rs::TmuxBridge` 调——把 `ProtocolEvent` 转 Tauri event |

**约束**：terminal 只通过 `AppBackend::emit()` emit——**不直接** import `tauri::Emitter` 等具体 API（那在 infra 层）。

## 5. infra/ssh（remote tmux backend）

| 依赖 | 来源 | 何时 |
|--|--|--|
| `SshBackend` trait | `infra/ssh/backend.rs` | terminal 通过 `SshTmuxBackend` 持 `Arc<dyn SshBackend>`——建立 SSH 连接 |

**约束**：terminal 通过 `SshBackend` trait 调 SSH——**不直接** import `russh` crate。

## 6. 内部依赖关系

```
domain/terminal/
├── protocol/         ← 纯协议层（不依赖任何 IO，可纯函数测试）
├── types.rs          ← types（被 controller/rules/bridge 使用）
├── rules.rs          ← types（构造 helper）
├── state.rs          ← types + errors（TmuxController struct）
├── controller/
│   ├── mod.rs        ← types + state + bridge（impl TmuxController）
│   ├── spawn.rs      ← state + types + infra/* (trait)
│   ├── commands.rs   ← state + protocol（tmux command 发送）
│   ├── registry.rs   ← types（HashMap bindings）
│   ├── sync.rs       ← tokio::sync（bootstrap 同步）
│   ├── id_map.rs     ← types（CommandRegistry）
│   ├── io_tasks.rs   ← tokio（4 个 IO task spawn）
│   └── subscriber.rs ← protocol + state（RouterState）
├── dispatch.rs       ← types + state + tokio（dispatch task）
├── bridge.rs         ← types + state + infra/tauri（emit events）
└── errors.rs         ← types（TmuxError enum）
```

**关键约束**：

- `protocol/` 是**最底层**（纯协议，不依赖 IO）
- `types.rs` 是**被引用最多的**（controller / state / rules / bridge 都用）
- `state.rs` 是**状态机主体**（依赖最广）
- `controller/` 子目录是**impl 拆分**（mod.rs 是 impl，其他文件是 helper）

## 7. 跨域依赖

| domain | terminal 对其依赖 |
|--|--|
| `domain::session` | ✅ 弱依赖（`SessionIdSource` 类型 + Arc 引用） |
| `infra::tmux` | ✅ 依赖（`TmuxBackend` trait） |
| `infra::ssh` | ✅ 依赖（`SshBackend` trait，remote tmux 用） |
| `infra::tauri` | ✅ 依赖（`AppBackend` emit） |

**说明**：v6 砍 persistence 域，attached_tmux.json 由 `domain/terminal::attached_tmux` 内部触发；terminal 不依赖独立 persistence domain。

## 8. 设计意图：terminal 是"tmux 协议层 + 状态机 + Bridge"

**反模式**：

- `services/tmux/controller/mod.rs` 1000+ 行——`TmuxController` struct + impl + bindings + dispatch 全部混在一起
- `app/terminal/api.rs` 空壳转发——没业务价值
- `models/tmux` 与 `services/tmux` 边界模糊——前者纯类型，后者纯状态机，但跨两个目录跨两个 README

**当前边界**（3 层架构下）：

- `state.rs` + `controller/` 子目录：`TmuxController` struct 与 impl 拆分
- `protocol/` 子目录：纯协议层，可纯函数测试
- `api.rs`：唯一对外入口（**这条**——强制）
- types + rules + state + bridge + controller + protocol + dispatch + io_tasks 按文件分

## 10. 不允许的依赖

- ❌ （已删除——v6 砍）
- ❌ （已删除——workspace 状态完全 frontend 持有，terminal 不需要跨域引用）
- ❌ `domain/terminal/` → `tauri`（terminal 通过 `AppBackend` trait 调 emit）
- ❌ `domain/terminal/protocol/` → `tokio` / `std::process` / `std::net`（纯协议层，不依赖 IO）
- ❌ `domain/terminal/` → `russh` / `portable-pty`（这些 import 在 `infra/tmux/` 内部）
- ❌ `domain/terminal/` → `crate::logging_setup::*`（tracing 由 bridge 间接 emit）

## 11. 依赖变更流程

1. **新增 tmux command** → 加 `domain/terminal/controller/commands.rs` 方法 + `protocol/command.rs` CommandKind + INTERFACE §2 + frontend `service/tmux` 订阅事件
2. **新增 typed wrapper** → 加 `domain/terminal/types.rs` 类型 + serde derive + 检查 IPC payload
3. **修改 TmuxController public method** → ⚠️ breaking——所有 `domain/session` 调用方更新
4. **修改 ProtocolEvent** → ⚠️ breaking——frontend `service/tmux` 订阅事件类型同步
5. **修改 bridge emit** → 影响 frontend 事件订阅——可能破坏 frontend 状态
6. **修改 protocol wire format** → ⚠️ breaking——tmux 协议版本号需要 bump