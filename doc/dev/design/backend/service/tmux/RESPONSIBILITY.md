# Service · Tmux — 职责

> **位置**：`src-tauri/src/services/tmux/`
> **类型**：⭐ 派生 domain（独立的 tmux -CC control mode 子系统）
> **被调用方**：`services/session/`（代理给 `TmuxController` 公开方法）、`app/terminal`（直接通过 `SessionManager` 调用）
> **Frontend 对应**：[`../../../frontend/service/tmux/RESPONSIBILITY.md`](../../../frontend/service/tmux/RESPONSIBILITY.md)

## 1. 这个 domain 负责什么

tmux domain 持有**tmux -CC control mode 子系统的全部逻辑**——backend 的 tmux controller 状态机 + tmux 协议层 + 事件 bridge。

承担 6 类职责：

1. **TmuxController 状态机**——`spawn_create_tmux / attach_tmux`，每个 controller 持 1 个 `tmux -CC` 子进程
2. **tmux pane / window 注册表**——`pane_bindings: HashMap<tmux_pane_id, xsterm_session_id>` + `window_bindings: HashMap<tmux_window_id, xsterm_window_id>`
3. **tmux 协议层**——octal 解码 / 命令 ID 分配 / `ProtocolEvent` 解析
4. **tmux Bridge**——`ProtocolEvent → Tauri 事件` 转换（推给 frontend listener）
5. **dispatch task**——从 `tmux -CC` 子进程 stdout 读事件 → dispatch 到 controller
6. **11 个用户面向的 tmux command**——send-keys / split-window / kill-pane / capture-pane / new-window / kill-window / rename-window / list-windows / list-panes 等

## 2. 这个 domain **不**负责什么

- **不存 session 元数据**——tmux session 在 `services/session/`；`TmuxPaneHandle` 是 session 的 backend 实现
- **不直接被 IPC 调用**——tmux IPC 全部由 `app/terminal/api.rs` 通过 `SessionManager` 代理
- **不渲染 UI**——backend 无 UI
- **不实现 xterm**——xterm 渲染在 frontend `ui/terminal/`
- **不管理 pane tree**——pane tree 归 `services/workspace/`（预留位）

## 3. 子结构

```
services/tmux/
├── mod.rs                 入口 + From<TmuxError> for String
├── errors.rs              ⭐ TmuxError 枚举（thiserror derive）
├── dispatch.rs            spawn_dispatch_task + dispatch_event
├── bridge.rs              ⭐ TmuxBridge — ProtocolEvent → Tauri 事件（拆自 v3 tmux_session/bridge/）
├── controller/
│   ├── mod.rs             TmuxController struct + 共享 helper
│   ├── spawn.rs           4 个构造函数（local / ssh / new-session / attach）
│   ├── commands.rs        11 个用户面向的 tmux command
│   ├── io_tasks.rs        spawn_*_task（reader/writer/stderr/monitor）
│   ├── registry.rs        ⭐ binding 访问器（pane_bindings / window_bindings）
│   ├── sync.rs            close + bootstrap rendezvous
│   ├── id_map.rs          CommandRegistry
│   ├── subscriber.rs      RouterState — %begin..%end body 累积
│   ├── handshake.rs       v2 handshake 计划
│   └── tests.rs           29 个 #[tokio::test]
└── protocol/              纯协议层（无 I/O）—— 不动
    ├── mod.rs
    ├── codec.rs           octal \nnn 编解码
    ├── command.rs         CommandId / CommandKind / ResponseWaiter / TaggedCommand
    ├── events.rs          ProtocolEvent 枚举（30+ 变体）
    ├── parser.rs          line → Option<ProtocolEvent>
    ├── version.rs         CapabilityMatrix
    └── wire.rs            "send-keys" / "split-window" 文本构造
```

**关键命名变化（v3 → v4）**：

- v3 的 `services/tmux_session/` 顶层目录 → v4 的 `services/tmux/`（去掉 `_session` 后缀——与 frontend service/tmux 镜像对齐）
- v3 的 `services/tmux_session/bridge/mod.rs` → v4 的 `services/tmux/bridge.rs`（顶层，不再嵌目录）
- v3 的 `services/tmux_session/protocol/` 不动
- v3 的 `services/tmux_session/controller/` 不动

## 4. 跟其他 domain 的关系

| domain | 关系 |
|---|---|
| `services/session` | session 通过 `Arc<TmuxController>` 持有 controller 引用——调 controller 的**公开方法**（send_keys / resize_pane / unbind_pane / 等）。**禁止字段直读**（bug 0009 根因）|
| `services/workspace` | tmux 不依赖 workspace（pane tree 由 workspace 管辖，tmux 只管 controller） |
| `services/settings` | tmux **不依赖** settings |
| `services/persistence` | tmux 不直接 import——attached_tmux 持久化由 `app/terminal/api.rs` 触发 `app/settings/api.rs::save_attached_tmux_servers` |
| `infrastructure/ssh` | tmux 通过 `SshBackend::run_command_capture_stdout` 做 SSH tmux probe（经 `services/session::SessionManager::probe_tmux_session_exists`）|

**关键约束**：

- tmux controller 的所有内部字段（`pane_bindings` / `window_bindings` / `initial_state` / `dispatch_task` / `child`）**禁止**被 `services/session/` 直接 import
- `services/session/` 通过 `TmuxController` 的公开方法访问（`controller_id()` / `send_keys()` / `resize_pane()` / `unbind_pane()` / `tmux_window_id_for_pane()` / `session_name()` / `capture_pane()` / `detach()` / `await_first_pane()` / `take_initial_state()` 等）

## 5. 跟 app 的关系

| app module | 怎么用 services/tmux |
|---|---|
| `app/terminal` | **不直接 import** services/tmux——通过 `app/terminal/api.rs::create_tmux` 调 `SessionManager::create_tmux` 间接访问 controller |
| `app/session` | `app/session/api.rs::create_session` dispatcher 路由 `SessionConfig::TmuxCc` 时调 `SessionManager::create_tmux` |

**关键**：app **不** import `services::tmux::*`——所有 tmux 操作都通过 `SessionManager` 公开方法代理。

## 6. 这个 domain 的"产品语言"术语

- **tmux controller** —— backend 维护的 `tmux -CC` 控制连接（每个 controller 对应一个 tmux server）
- **attached server** —— 已 attach 的 tmux server（持久化到 `attached_tmux.json`）
- **tmux pane / window** —— tmux 自己的 pane / window 概念
- **bootstrap pane** —— `tmux -CC` 启动后的第一个 pane（`new -s` 模式 visible；`attach` 模式 hidden）
- **control window** —— tmux -CC 用来跑控制命令的内部 window（隐藏，不暴露给 UI）
- **pane_bindings** —— tmux pane id ↔ xsterm session id 映射（bug 0009 的核心数据结构）
- **window_bindings** —— tmux window id ↔ xsterm window id 映射
- **dispatch task** —— 从 tmux 子进程读 stdout + 解析 + 推事件的 Tokio task
- **ProtocolEvent** —— tmux 协议层解析出来的事件（30+ 变体）
- **Tauri event** —— 由 bridge 推送的 frontend 可见事件（`session-output` / `tmux-pane-added` / 等）

## 7. 关键设计约束

### 7.1 bug 0009 的硬性边界（防御性约束）

v3 的 bug 0009 根因：`SessionManager::create_tmux` 直接读 `TmuxController.window_bindings` HashMap（未在 `record_pane_window` 时同步写入）。v4 通过以下约束避免复发：

- **字段可见性**：`pane_bindings` / `window_bindings` 设为 `pub(crate)` 或 `pub(super)`——只能被 `services/tmux/` 内部访问
- **访问 API**：所有跨 domain 访问通过 `registry.rs` 提供的公开方法（`xsterm_window_id_for_pane()` 等）
- **静态快照**：`take_initial_state()` 等方法返回 owned 数据（`Vec<TmuxWindow>` / `Vec<TmuxPane>`），调用方拿到后 controller 内部 HashMap 可变不影响

### 7.2 controller 生命周期由 session manager 持有

```rust
// services/session/manager.rs
pub struct SessionManager {
    tmux_controllers: DashMap<u32, Arc<TmuxController>>,
    // ...
}

// 关键：controller 是 `Arc<TmuxController>` 共享
// services/session/backends/tmux_pane.rs 也持 Arc（pane handle）
```

**约束**：

- controller 由 `services/tmux/controller/spawn.rs` 的 `TmuxController::spawn_create` 创建
- 注册到 `SessionManager::tmux_controllers` DashMap
- 多 pane handle 共享同一个 controller Arc
- controller close 由 `SessionManager::close_tmux_controller` / `detach_tmux_controller` 触发

### 7.3 dispatch task 是 Tokio task

- `spawn_dispatch_task(controller, stdin_writer, stdout_reader)` 启动后台 task
- task 内部调 `dispatch_event(event)` 把 `ProtocolEvent` 路由到：
  - controller 内部 HashMap 更新
  - bridge 推送 Tauri 事件
  - waiter 唤醒（response waiter）

### 7.4 协议层是纯函数（无 I/O）

`services/tmux/protocol/` 是**纯协议层**——没有 I/O、没有 tokio、没有 state。可以独立单测（v3 已有部分测试）。

**约束**：

- protocol 不 import `services::tmux::*` 其他文件
- protocol 不 import `infrastructure::*`
- protocol 只 import `models::*`

## 8. v3 → v4 迁移说明

| v3 位置 | v4 位置 | 改动 |
|---|---|---|
| `services/tmux_session/` 顶层目录 | `services/tmux/` | 去掉 `_session` 后缀，与 frontend service/tmux 镜像 |
| `services/tmux_session/mod.rs` | `services/tmux/mod.rs` | 不动 |
| `services/tmux_session/bridge/mod.rs` | `services/tmux/bridge.rs` | 提升到顶层（不再嵌目录）|
| `services/tmux_session/dispatch.rs` | `services/tmux/dispatch.rs` | 不动 |
| `services/tmux_session/errors.rs` | `services/tmux/errors.rs` | 不动 |
| `services/tmux_session/protocol/*` | `services/tmux/protocol/*` | 不动 |
| `services/tmux_session/controller/*` | `services/tmux/controller/*` | 不动 |
| `services/session_manager.rs` 内嵌的 `TmuxPaneHandle` | `services/session/backends/tmux_pane.rs` | 抽出独立文件 |
| `services/session_manager.rs` 内嵌的 `tmux_controllers: DashMap` 字段 | `services/session/manager.rs` 同名字段 | 不动（SessionManager 是 controller 的注册表持有者）|

## 9. 跟 v3 的差异

| 维度 | v3 | v4 |
|---|---|---|
| 顶层目录 | `services/tmux_session/` | `services/tmux/` |
| bridge 位置 | `services/tmux_session/bridge/mod.rs` | `services/tmux/bridge.rs`（顶层）|
| `TmuxPaneHandle` | 内嵌在 `session_manager.rs` | `services/session/backends/tmux_pane.rs` |
| 与 frontend service 镜像 | `services/tmux_session/` ↔ `service/tmux/` | `services/tmux/` ↔ `service/tmux/`（名字一致）|
| 跨 domain 字段直读 | bug 0009 复发风险 | 通过 trait / 公开方法严格禁止 |