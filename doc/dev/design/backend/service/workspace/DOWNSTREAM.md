# Service · Workspace — 对下依赖

> **位置**：`src-tauri/src/services/workspace/`
> **MVP 状态**：当前**无任何依赖**——本文档描述未来激活时的依赖图

## 1. 依赖图（目标态）

```
services/workspace/
├── api.rs        ────►  services/session::*           (info(parent_session_id) 读 session 类型)
├── api.rs        ────►  services/persistence/api::*  (workspace.json 读写)
├── api.rs        ────►  models/workspace::*           (Workspace / PaneNode / WindowId)
├── api.rs        ────►  models/session::*             (SessionType 判定 tmux)
└── commands/     ────►  (未来) services/workspace_store
```

## 2. services/session

| 调用 | 来源 | 何时 |
|---|---|---|
| `session.info(session_id)` | `services/session/api.rs` | pane split 时读 parent session 元数据判定是否 tmux |

**约束**：workspace **不**调用 `SessionManager::create_*`——由 `app/workspace/api.rs` 编排。这是 service 之间不互相调的原则（workspace 与 session 都是核心 domain，不互相直接创建）。

## 3. services/persistence（未来）

| 调用 | 来源 | 何时 |
|---|---|---|
| `persistence::save_workspace_state(&app, &state)` | `services/persistence/api.rs` | workspace 变更后持久化 |
| `persistence::load_workspace_state(&app)` | 同上 | 启动加载 |

## 4. services/settings

workspace **不依赖** settings——layout / sidebar width 由 frontend store 维护。

## 5. services/tmux

workspace **不直接依赖** tmux——由 `app/workspace/api.rs::split_pane` 调 `app/terminal/api.rs::create_tmux_pane`。

## 6. models

| 读取 | 来源 |
|---|---|
| `Workspace` / `Window` / `PaneNode` / `PaneId` / `WindowId` / `Group` | `models/workspace.rs`（未来新增）|
| `SessionType` | `models/session.rs` |
| `SplitDirection` | `models/session.rs` |

## 7. 设计意图：workspace 是「跨 domain 协调的 future host」

MVP 的 workspace 业务完全在 frontend store。v4 设计预留 backend 位置，等"多窗口同步"或"server-side persistence"出现时激活。

**关键设计原则**：

- workspace **不**调 `SessionManager::create_*`（session 创建归 app 编排）
- workspace **不**调 `tmux::*` 直接操作（tmux 操作归 app/terminal 编排）
- workspace **不**实现 pane tree 算法（算法归 `model/workspace/rules.rs`）

## 8. 不允许的依赖

- ❌ `services/workspace/` → `services/session::create_*`（必须经过 `app/session/api.rs`）
- ❌ `services/workspace/` → `services/tmux::*`（必须经过 `app/terminal/api.rs`）
- ❌ `services/workspace/` → `services/settings::*`（layout 是 frontend 关注）
- ❌ `services/workspace/` → `infrastructure/*` 直接（必须经过 service）

## 9. 依赖变更流程

激活后：

1. **新增 workspace store method** → 加 `WorkspaceStore::method()` + 在 §2 / §3 同步
2. **新增 pane tree rule** → 加 `models/workspace/rules.rs` + workspace store 调用
3. **新增跨 domain 持久化** → 加 `services/persistence::save_workspace_state` + 在 §3 同步
4. **新增 cross-module 触发**（如：workspace 加载后 auto-attach tmux）→ 改由 `app/shell/api.rs::initialize` 编排，不在 workspace store 内