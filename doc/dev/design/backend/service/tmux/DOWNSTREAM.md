# Service · Tmux — 对下依赖

> **位置**：`src-tauri/src/services/tmux/`

## 1. 依赖图

```
services/tmux/
├── mod.rs                ────►  models/session::*                (TmuxCcConfig / TmuxSessionInit)
├── errors.rs             ────►  (no deps — pure error enum)
├── controller/mod.rs     ────►  services/tmux/protocol/*         (纯协议层)
├── controller/registry.rs ────►  models/session::*                (TmuxWindow / TmuxPane types)
├── controller/spawn.rs   ────►  infrastructure/app_backend::*   (AppBackend trait)
├── controller/spawn.rs   ────►  infrastructure/ssh::*            (SshBackend trait)
├── controller/io_tasks.rs ────►  infrastructure/pty::*           (Child trait for tmux child process)
├── controller/commands.rs ────►  services/tmux/protocol/*          (wire text + TaggedCommand)
├── bridge.rs             ────►  services/tmux/protocol/events    (ProtocolEvent)
├── bridge.rs             ────►  tauri::AppHandle                  (emit Tauri events)
├── protocol/*            ────►  models/session::*                (TmuxCcConfig 部分字段)
├── protocol/codec.rs     ────►  (no deps — pure codec)
├── protocol/command.rs   ────►  (no deps — pure command types)
├── protocol/parser.rs    ────►  services/tmux/protocol/events    (返回 ProtocolEvent)
└── protocol/wire.rs      ────►  (no deps — pure text serialization)
```

## 2. models

tmux domain 直接读以下 models 类型：

| 类型 | 来源 |
|---|---|
| `TmuxCcConfig` | `models/session.rs` |
| `TmuxSessionInit` | `models/session.rs` |
| `TmuxControlWindowInit` | `models/session.rs` |
| `AttachedTmuxServer` | `models/session.rs` |
| `TmuxWindow` / `TmuxPane` | `models/session.rs`（或独立 models/tmux.rs —— 待定）|

**约束**：models 是纯数据类型——tmux 可自由 import。

## 3. infrastructure

### 3.1 infrastructure/app_backend

| 调用 | 来源 | 何时 |
|---|---|---|
| `AppBackend` trait object 参数 | `infrastructure/app_backend.rs` | `TmuxController::spawn_create` 签名 |

**约束**：controller 不直接构造 `RealAppBackend`——由 `app/terminal/api.rs` 构造后传入。

### 3.2 infrastructure/ssh

| 调用 | 来源 | 何时 |
|---|---|---|
| `SshBackend` trait object 参数 | `infrastructure/ssh.rs` | `TmuxController::spawn_create` 签名（当 config.ssh.is_some() 时） |
| `SshBackend::run_command_capture_stdout` | 同上 | `SessionManager::probe_tmux_session_exists` 间接（不直接） |

### 3.3 infrastructure/pty

| 调用 | 来源 | 何时 |
|---|---|---|
| `Child` trait（`portable_pty::Child` 或同等） | `infrastructure/pty.rs` | `controller/io_tasks.rs` 持有 tmux child process |

**约束**：tmux 子进程是 `Child` trait object——controller 通过 trait 调度，不持有具体类型。

## 4. tauri

| 调用 | 来源 | 何时 |
|---|---|---|
| `tauri::AppHandle` | `tauri` crate | `TmuxBridge::new(app)` 构造；emit Tauri 事件 |
| `app.emit("event-name", payload)` | 同上 | bridge 推送事件给 frontend |

**约束**：

- tmux domain 是**唯一**允许直接 import `tauri::AppHandle` 的 service（理由：bridge 需要 emit 事件，这是 tmux 子系统的核心职责）
- 其他 service 通过 `AppBackend` trait 间接获得 emit 能力

## 5. tokio

| 调用 | 来源 | 何时 |
|---|---|---|
| `tokio::sync::Notify` | `tokio` | `initial_state_ready` 唤醒机制 |
| `tokio::sync::oneshot` | 同上 | command response waiter |
| `tokio::sync::mpsc` | 同上 | `command_tx` 发送命令到 dispatch task |
| `tokio::task::JoinHandle` | 同上 | `dispatch_task` 持有 |
| `tokio::process::Command` | 同上 | 本地 tmux -CC 子进程启动（不用 portable_pty）|

**约束**：tmux domain 是 backend 中 **tokio 使用最重** 的子系统。

## 6. thiserror

| 调用 | 来源 | 何时 |
|---|---|---|
| `#[derive(thiserror::Error)]` | `thiserror` crate | `TmuxError` enum |

**约束**：tmux domain 引入第一个 typed error——其他 service 暂用 `Result<T, String>`。迁移路径见 `app/session/DOWNSTREAM.md` 的"统一错误类型"段。

## 7. 内部依赖关系

```
services/tmux/
├── protocol/*          ← 纯函数，无依赖
├── controller/registry ← HashMap 数据结构（被 controller + backends/tmux_pane 间接访问）
├── controller/spawn    ← 创建 controller（被 SessionManager 调用）
├── controller/commands ← 11 个用户面向 tmux command（被 SessionManager 调用）
├── controller/io_tasks ← Tokio task 生命周期
├── controller/id_map    ← CommandRegistry（Tag → waiter 映射）
├── controller/subscriber ← %begin..%end body 累积
├── controller/sync     ← bootstrap rendezvous + close
├── bridge              ← ProtocolEvent → Tauri event（被 dispatch 内部调用）
├── dispatch            ← spawn_dispatch_task（被 spawn 调用）
└── errors              ← TmuxError（被 controller/registry/spawn 全部使用）
```

**关键约束**：

- `protocol/*` **不依赖** controller / bridge / dispatch——protocol 是纯函数层
- `controller/*` 内部互相依赖（共享 `TmuxController` struct 字段）
- `bridge` 依赖 `protocol::events`（ProtocolEvent）
- `dispatch` 依赖 `controller`（mutation）+ `bridge`（emit）

## 8. 跨 domain 依赖

| domain | tmux 对其依赖 |
|---|---|
| `services/session` | ❌ 不依赖——session 持有 `Arc<TmuxController>`，不反过来 |
| `services/workspace` | ❌ 不依赖 |
| `services/settings` | ❌ 不依赖 |
| `services/persistence` | ❌ 不依赖——attached_tmux 持久化由 `app/terminal` 触发 `app/settings/api.rs` |
| `infrastructure/app_backend` | ✅ 依赖（构造参数）|
| `infrastructure/ssh` | ✅ 依赖（构造参数）|
| `infrastructure/pty` | ✅ 依赖（Child trait）|
| `tauri` | ✅ 依赖（AppHandle + emit）|
| `models/session` | ✅ 依赖（pure data types）|

## 9. 设计意图：tmux 是「最大的 service 子系统，独立演进」

v4 保留 `services/tmux/` 顶层（即使 controller 内部组件很多）——理由：

- tmux -CC 是 backend 中**最复杂的子系统**（11 个文件 / 1500+ 行 + 5 个 ADR + 1 篇专题文档）
- 协议层（`protocol/*`）是纯函数，可独立单测
- 状态机（`controller/*`）生命周期独立（controller 创建 → 注册 → bootstrap → 持续运行 → close）
- 跟 frontend `service/tmux/` 镜像关系明确

**对比 session 内部子模块化**：session 拆 `backends/{local,ssh,tmux_pane}` 是因为 3 种 backend 共享 `SessionManager` 中央状态机；tmux 不共享 state，所以保持顶层独立。

## 10. v3 → v4 跨调用迁移

| v3 现状 | v4 改法 |
|---|---|
| `services/session_manager.rs` 内嵌 `TmuxPaneHandle` + `tmux_controllers` 字段 | 字段保留在 `services/session/manager.rs`；`TmuxPaneHandle` 抽出到 `services/session/backends/tmux_pane.rs` |
| `services/session_manager.rs::create_tmux` 直读 `controller.window_bindings` HashMap（bug 0009）| `services/session/manager.rs::create_tmux` 调 `controller.tmux_window_id_for_pane()` 公开方法 |
| `services/session_manager.rs::attach_tmux` 同样直读 | 同上 |
| `services/tmux_session/bridge/mod.rs` 嵌目录 | `services/tmux/bridge.rs` 顶层（无 mod 嵌套）|
| `services/tmux_session/` 顶层 | `services/tmux/`（去掉 `_session` 后缀）|

## 11. 不允许的依赖

- ❌ `services/tmux/` → `services/session::*`（tmux 是独立子系统，不依赖 session）
- ❌ `services/tmux/` → `services/workspace::*`
- ❌ `services/tmux/` → `services/settings::*`
- ❌ `services/tmux/` → `services/persistence::*`
- ❌ `services/tmux/` → `app::*`（service 不知道 IPC）
- ❌ `services/tmux/` → `services/tmux::controller::*` 字段直读（被其他 service 通过 Arc 调用时）
- ❌ `services/tmux/protocol/*` → `services/tmux/controller/*`（protocol 是纯函数）
- ❌ `services/tmux/protocol/*` → `tauri::*`（protocol 完全不依赖 tauri）

## 12. 依赖变更流程

1. **新增 controller 公开方法** → 加 `controller/mod.rs` 方法 + INTERFACE.md §2 同步
2. **新增 ProtocolEvent 变体** → 加 `protocol/events.rs` + 更新 `bridge.rs` 转换 + INTERFACE.md §3.3 同步
3. **修改 controller 字段可见性** → ⚠️ breaking——bug 0009 边界
5. **修改 TmuxError 变体** → ⚠️ breaking——检查所有 `?` 调用方
6. **新增跨 domain 调用**（如未来 tmux 直接调 settings）→ ❌ 禁止——通过 `app/terminal/api.rs` 编排
7. **修改 protocol 输出格式** → ⚠️ breaking——wire.rs 必须同步