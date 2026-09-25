# Module · App Terminal — 职责

> **位置**：`src-tauri/src/app/modules/terminal/`（落地 `src-tauri/src/commands/terminal.rs`）
> **用户认知里的位置**：「终端特有业务」——tmux -CC 协议的所有 IPC + terminal preferences 应用
> **依赖**：`app/session`（generic dispatcher 路由 tmux）、`app/settings`（attached_tmux.json 持久化）
> **Frontend 对应**：[`../../../../frontend/app/terminal/RESPONSIBILITY.md`](../../../../frontend/app/terminal/RESPONSIBILITY.md)

## 1. 这个 module 负责什么

terminal module 编排 backend **tmux -CC 子系统的全部 IPC**——15 个 `#[tauri::command]`：

1. **tmux session lifecycle** (4)
   - `create_tmux_session` —— 创建 tmux -CC controller
   - `attach_tmux_session` —— attach 到已存在 tmux server
   - `probe_tmux_session_exists` —— 探测 server 是否存在
   - `auto_attach_tmux_servers` —— 启动时自动 attach 持久化列表

2. **tmux pane 操作** (4)
   - `create_tmux_pane` —— `split-window`
   - `kill_tmux_pane` —— `kill-pane`
   - `resize_tmux_pane` —— `resize-pane`
   - `capture_tmux_pane` —— 抓 scrollback

3. **tmux window 操作** (3)
   - `create_tmux_window` —— `new-window`
   - `kill_tmux_window` —— `kill-window`
   - `rename_tmux_window` —— `rename-window`

4. **tmux server 管理** (4)
   - `get_attached_tmux_servers` —— 列出已 attach 的 server
   - `detach_tmux_controller` —— detach controller（保留 server）
   - `kill_server_via_controller` —— kill server
   - `unmark_attached_tmux` —— 从持久化列表移除

5. **terminal preferences** (0)
   - 当前 MVP **没有 IPC**——preferences 完全在 frontend store

**合计**：15 个 `#[tauri::command]`——v0 全部在 `commands/session.rs` 内的「tmux 系列」。

## 2. 这个 module **不**负责什么

- **不渲染 xterm** —— UI 渲染归 frontend `ui/terminal/`
- **不管理 pane 树结构** —— pane 树归 `app/workspace/`（未来激活）
- **不实现 tmux 协议** —— tmux -CC 协议在 `services::tmux_session/`（已在 v0 完成）
- **不管理普通 PTY/SSH session** —— 那是 `app/session/` 的事
- **不持久化 settings** —— 持久化归 `app/settings/`（attached_tmux.json 走 settings）

## 3. 子结构

落地到 `src-tauri/src/commands/terminal.rs`（顶层） + `src-tauri/src/commands/terminal/` 子目录：

```
modules/terminal/
├── api.rs                          ⭐ 唯一对外入口
├── commands/
│   └── tmux/
│       ├── session.rs              create_tmux_session / attach_tmux_session / probe / auto_attach
│       ├── pane.rs                 create_tmux_pane / kill_tmux_pane / resize_tmux_pane / capture_tmux_pane
│       ├── window.rs               create_tmux_window / kill_tmux_window / rename_tmux_window
│       └── server.rs               get_attached / detach / kill / unmark
├── model.rs                        module 专属类型（如 MAX_TMUX_PROBE_LINES）
└── mod.rs                          re-export api.rs
```

**关键**：

- 所有命令都在 `commands/tmux/` 子目录——没有 `commands/local/` 或 `commands/ssh/`，因为 terminal module 100% 是 tmux 业务
- preferences 不暴露 IPC（README §7 解释）

## 4. 用户故事（backend 视角）

- **作为前端 `app/terminal`**，我希望调 `create_tmux_session` 后立刻拿到完整初始状态（windows + panes + control_window）→ `create_tmux_session` 返回 `TmuxSessionInit { session, windows, panes, control_window }`
- **作为前端 split 操作**，我希望前端解析 local-id → server-id 后直接传 `(controller_id, tmux_pane_id)` → `create_tmux_pane` / `kill_tmux_pane` 接受 tmux-side identifier，backend 不查 `sessions`
- **作为前端启动序列**，我希望 backend 在 `app/shell::initialize` 时**不**自动 attach——而是等前端显式调 `auto_attach_tmux_servers` → terminal api 暴露此入口
- **作为前端 settings 抽屉**，我希望列出已 attach 的 server 用于展示 → `get_attached_tmux_servers` 返回 projection

## 5. 跟其他 module 的关系

| module | 关系 |
|---|---|
| `app/session` | session.create_session (generic) 收到 `TmuxCcConfig` 时调 `terminal_api::create_tmux` |
| `app/settings` | terminal 在 create/attach 成功后调 `settings_api::save_attached_tmux_servers` 持久化 |
| `app/shell` | shell **不**自动 attach tmux——由前端显式调 `terminal_api::auto_attach_tmux_servers` |
| `app/workspace` | workspace 未来激活时调 `terminal_api::create_tmux_pane`（pane split 时检测 parent 是 tmux） |
| `services/session_manager` | terminal api **唯一**直接调用的 service（create / attach / detach / kill 通过 SessionManager） |
| `services/tmux_session` | terminal api 委托 `SessionManager::create_tmux` —— 它内部用 `TmuxController` |
| `services/ssh_session` | terminal 通过 `SessionManager::probe_tmux_session_exists` 间接使用（local probe 不需要 SSH；SSH probe 走 SshBackend） |
| `infrastructure/tmux` | terminal api **不**直接 import——必须经过 service |

**关键**：

- terminal **不** import `TmuxController` 字段 —— 只通过 `SessionManager` 的 method 访问
- terminal **不** import `services::tmux_session::controller::*` 字段 —— 通过 SessionManager 间接

## 6. 这个 module 的"产品语言"术语

- **tmux controller** —— backend 维护的 `tmux -CC` 连接（一个 controller 多 pane）
- **attach / detach** —— attach 到 / detach 自 tmux controller
- **tmux pane / window** —— tmux 自己的 pane / window 概念（跟 xsterm pane / window 不完全对应）
- **bootstrap pane** —— `tmux -CC` 启动后的第一个 pane（`new -s` 时 visible；`attach` 时 hidden）
- **control window** —— tmux -CC 用来跑控制命令的内部 window（隐藏，不暴露给 UI）
- **attached_tmux_servers** —— 当前 attach 的 tmux server 列表（持久化到 `attached_tmux.json`）
- **terminal preferences** —— terminal 偏好（font / fontSize / theme / cursor blink）—— **无 IPC**

## 7. terminal preferences 为什么没 IPC

前端 `app/terminal/usecases/preferences/apply.ts` 把 preferences 写入 `useTerminalStore.getState()`——**纯前端 store 操作**，不触发任何 IPC。

backend 不需要：

- 字体 / 字号 —— 只影响 xterm.js 渲染，不影响 PTY
- theme —— xterm 内容主题，由 frontend 维护 `src/types/theme.ts`
- cursor blink —— xterm option，纯前端

如果未来要加 "persisted terminal preferences reload on startup"——通过 `app/settings/api::load_terminal_preferences`（未来），不在本 module 加 IPC。

## 8. v0 → v1 迁移说明

v0 的 15 个 tmux 命令全部在 `commands/session.rs` 内。v1 全部迁到 `app/terminal/commands/tmux/`：

| 命令 | v0 归属 | v1 归属 | 子目录 |
|---|---|---|---|
| `create_tmux_session` | `commands/session.rs:222` | `app/terminal/commands/tmux/session.rs` | session |
| `attach_tmux_session` | `commands/session.rs:381` | `app/terminal/commands/tmux/session.rs` | session |
| `probe_tmux_session_exists` | （在 SessionManager） | `app/terminal/commands/tmux/session.rs` | session |
| `auto_attach_tmux_servers` | `commands/session.rs:476`（v0 单独 file） | `app/terminal/commands/tmux/session.rs` | session |
| `create_tmux_pane` | `commands/session.rs:323` | `app/terminal/commands/tmux/pane.rs` | pane |
| `kill_tmux_pane` | `commands/session.rs:357` | `app/terminal/commands/tmux/pane.rs` | pane |
| `resize_tmux_pane` | `commands/session.rs:145` | `app/terminal/commands/tmux/pane.rs` | pane |
| `capture_tmux_pane` | `commands/session.rs:510` | `app/terminal/commands/tmux/pane.rs` | pane |
| `create_tmux_window` | `commands/session.rs:429` | `app/terminal/commands/tmux/window.rs` | window |
| `kill_tmux_window` | `commands/session.rs:473` | `app/terminal/commands/tmux/window.rs` | window |
| `rename_tmux_window` | `commands/session.rs:525` | `app/terminal/commands/tmux/window.rs` | window |
| `get_attached_tmux_servers` | `commands/session.rs:580` | `app/terminal/commands/tmux/server.rs` | server |
| `detach_tmux_controller` | `commands/session.rs:628` | `app/terminal/commands/tmux/server.rs` | server |
| `kill_server_via_controller` | `commands/session.rs:684` | `app/terminal/commands/tmux/server.rs` | server |
| `unmark_attached_tmux` | `commands/session.rs:725` | `app/terminal/commands/tmux/server.rs` | server |

**关键**：v0 把这 14 个 tmux 命令塞进 `commands/session.rs` 是反产品功能切分——session module 看起来"什么 session 都有"，实际只是因为 SessionManager 类名带"session"。v1 按"产品功能是 tmux -CC 子系统"切。

## 9. 跟 v0 的差异

| 维度 | v0 | v1 |
|---|---|---|
| tmux 命令数 | 15 个全在 `commands/session.rs` | 15 个全在 `app/terminal/commands/tmux/` |
| 模块归属 | `commands/session` | `app/terminal` |
| 持久化触发 | 内联在 `commands/session.rs` 调 `commands::persistence::save_attached_tmux_servers_impl` | 通过 `app/settings/api::save_attached_tmux_servers` |
| 与 frontend 对应 | 隐式 | 显式（与 frontend `app/terminal/api.ts` 一一对应） |
| 单文件最大 | `commands/session.rs` 660 行 | `commands/terminal/commands/tmux/pane.rs` ≤ 80 行 |