# Module · App Workspace — 对下依赖

> **位置**：`src-tauri/src/app/modules/workspace/`
> **MVP 状态**：当前**无任何依赖**——本文档描述未来激活时的依赖图

## 1. 依赖图（目标态）

```
modules/workspace/
├── api.rs        ────►  app/session/api.rs           (create_local_only / create_tmux_only)
├── api.rs        ────►  app/terminal/api.rs          (create_tmux_pane / kill_tmux_pane)
├── api.rs        ────►  app/settings/api.rs          (save_workspace_state — 未来)
├── api.rs        ────►  services/session_manager     (list_sessions / read tmux 标识)
├── api.rs        ────►  models/*                     (PaneNode / SplitDirection / WindowId)
└── commands/     ────►  (未来) services/workspace_store  (backend-owned workspace state)
```

## 2. app/session

| 调用 | 来源 | 何时调 |
|---|---|---|
| `session_api::create_local_only(config)` | `app/session/api.rs` | pane split 创建非 tmux 子 pane 时 |
| `session_api::create_ssh_only(config)` | `app/session/api.rs` | pane split 创建 SSH 子 pane 时（未来） |
| `session_api::close_session(session_id)` | `app/session/api.rs` | close pane 时 |

## 3. app/terminal

| 调用 | 来源 | 何时调 |
|---|---|---|
| `terminal_api::create_tmux_pane(controller_id, parent_pane, direction)` | `app/terminal/api.rs` | pane split 时检测到 parent 是 tmux-cc |
| `terminal_api::kill_tmux_pane(controller_id, tmux_pane_id)` | `app/terminal/api.rs` | close pane 时检测到 pane 是 tmux-cc |

## 4. app/settings

| 调用 | 来源 | 何时调 |
|---|---|---|
| `settings_api::save_workspace_state(ws)` | `app/settings/api.rs`（未来） | workspace 状态变更后持久化 |

## 5. services

| 调用 | 来源 |
|---|---|
| `session_manager.list()` | `services/session_manager.rs` |
| (未来) `services/workspace_store::*` | 新增的 backend-owned store |

## 6. models

| 读取 | 来源 |
|---|---|
| `SessionType` | `models/session.rs` |
| `SplitDirection` | `models/session.rs` |
| `PaneNode` / `WindowId` / `GroupId` | `models/workspace.rs`（未来新增） |

## 7. 设计意图：workspace 是「跨 module 编排者」

v1 设计的核心命题：workspace = 跨 session/terminal/settings 三个 module 的协调者。

- **session/terminal 提供原子能力**（创建单个 session、调单个 tmux pane 操作）
- **settings 提供持久化能力**（保存 / 读取）
- **workspace 把它们串起来**（pane split 时：判断父 pane 类型 → 调对应 module → 更新 pane 树）

这条边界避免了 v0 的"workspace 业务散在 session module 内部"反模式。

## 8. 不允许的依赖

- ❌ `modules/workspace/` → `services/session_manager::create_tmux_pane` 直调（必须经过 `app/terminal/api.rs`）
- ❌ `modules/workspace/` → `infrastructure/*` 直调（必须经过 service）
- ❌ `modules/workspace/` → 任何 module 的 `commands/*` 内部文件

## 9. 依赖变更流程

激活后：

1. **新增 pane 操作 IPC** → 加 `commands/tree.rs` + 在 §2 / §3 同步
2. **新增 backend-owned workspace store** → 加 `services/workspace_store.rs` + 在 §5 同步
3. **调整跨 module 调用路径** → 同步 §2 / §3 + 在 frontend app/workspace/api.ts 同步