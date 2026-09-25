# Module · App Session — 职责

> **位置**：`src-tauri/src/app/modules/session/`（落地 `src-tauri/src/commands/session.rs`）
> **用户认知里的位置**：「session 生命周期的所有 IPC 命令」
> **核心地位**：app 层最核心的 module；其他 4 个 module 都会调 session 的 api
> **Frontend 对应**：[`../../../frontend/app/session/RESPONSIBILITY.md`](../../../frontend/app/session/RESPONSIBILITY.md)

## 1. 这个 module 负责什么

session module 编排 backend **session 全生命周期的 IPC 命令**——10 个 `#[tauri::command]`：

1. **create_local_session** —— 创建本地 PTY session
2. **create_ssh_session** —— 创建 SSH session
3. **create_session** —— generic SessionConfig 调度入口（local/ssh/tmux 分发）
4. **write_session** —— 写入终端输入（含 paste 管线，Perf 010/011）
5. **close_session** —— 关闭 session
6. **list_sessions** —— 列出所有 active session 元数据
7. **resize_pty_session** —— resize 本地 PTY
8. **resize_ssh_session** —— resize SSH channel
9. **upload_image_to_ssh_session** —— 通过 SCP 上传图片到 SSH 服务器
10. **get_session_output_channel** —— 获取 binary output channel（Perf 001）

**合计**：10 个 `#[tauri::command]`——v0 在 `commands/session.rs` 25 个，v1 拆走 15 个 tmux 相关到 `app/terminal/`。

## 2. 这个 module **不**负责什么

- **不渲染 UI** —— UI 由 frontend `ui/session/` 负责
- **不管理 tmux pane/window 操作** —— 归 `app/terminal/`（v0 全部混在 `commands/session.rs`）
- **不持久化 saved config** —— 归 `app/settings/api::save_sessions`（v0 在 `commands/persistence.rs`）
- **不持有状态** —— 状态归 `services/session_manager.rs`
- **不直接 import `services/session_manager` 字段** —— 通过 `session_manager::SessionManager` 的 public 方法

## 3. 子结构

落地到 `src-tauri/src/commands/session.rs`（顶层） + `src-tauri/src/commands/session/` 子目录：

```
modules/session/
├── api.rs                          ⭐ 唯一对外入口（落地：commands/session.rs 的 public api 符号）
├── commands/
│   ├── local/
│   │   ├── create.rs               create_local_session
│   │   └── resize.rs               resize_pty_session
│   ├── ssh/
│   │   ├── create.rs               create_ssh_session
│   │   ├── resize.rs               resize_ssh_session
│   │   └── upload.rs               upload_image_to_ssh_session
│   ├── dispatch.rs                 create_session (generic SessionConfig 分发)
│   ├── write.rs                    write_session (含 paste 管线)
│   ├── close.rs                    close_session
│   ├── list.rs                     list_sessions
│   └── output.rs                   get_session_output_channel
├── model.rs                        module 专属类型（MAX_WRITE_PAYLOAD_BYTES 常量等）
└── mod.rs                          re-export api.rs
```

## 4. 用户故事（backend 视角）

- **作为前端 `app/session`**，我希望按 session 类型 invoke 不同的 IPC → `commands/{local,ssh,dispatch}.rs` 提供 3 个 create 入口
- **作为前端 paste 管线**，我希望 write_session 单次调用能下发任意大小字节 → `MAX_WRITE_PAYLOAD_BYTES` 上限保护 + 异步 write（Perf 010/011）
- **作为前端 resize observer**，我希望 PTY/SSH/tmux 用**不同的** IPC resize → 三个独立 command（前端按 `sessionType` 选择，tmux resize 归 terminal）
- **作为前端 image upload 流程**，我希望能直接传 `Vec<u8>` 给 backend SCP 上传 → `upload_image_to_ssh_session` 封装 `SshBackendImpl::upload_file`

## 5. 跟其他 module 的关系

| module | 关系 |
|---|---|
| `app/terminal` | session **不**直接调 terminal；tmux session 创建由 `app/terminal/api::create_tmux_session` 暴露 |
| `app/settings` | session 创建成功后**内部**调 `settings_api::save_session_config`（如果 should_save） |
| `app/shell` | shell 不直接调 session；session 完全由前端 `invoke()` 触发 |
| `app/workspace` | workspace 未来激活时调 session.create_local_only()（详见 `app/workspace/INTERFACE.md`） |
| `services/session_manager` | session api **唯一**直接调用的 service —— 通过 `state.method()` 调用 |
| `services/session_log` | session create 时调 `start_session_logging(id, &config)` 启动日志 |
| `services/local_session` | session.create_local 委托给 `services/local_session::create_local_session()` |
| `services/ssh_session` | session.create_ssh 委托给 `services/ssh_session::create_ssh_session()` |
| `infrastructure/app_backend` | 每个 session create 都构造 `RealAppBackend::new(app)`（注入 Tauri AppHandle） |

**关键**：

- session **不** import `services/tmux_session::*`——tmux 操作归 `app/terminal/`
- session **不** import `commands/persistence::*`——持久化归 `app/settings/`
- session **不** 跨过 service 直接调 `infrastructure/pty::*`——必须经 service

## 6. 这个 module 的"产品语言"术语

- **session** —— 一个后台进程 + 它的连接配置 + 状态
- **local session** —— 本地 PTY（local shell）
- **ssh session** —— 远程 SSH（russh）
- **tmux session** —— tmux -CC controller 下的 pane（归 `app/terminal/`）
- **persisted config** —— 持久化的 session 配置（归 `app/settings/`）
- **display config** —— 运行时可调的字体 / 字号 / theme（**MVP 没有 IPC**，完全在 frontend）
- **session status** —— connecting / running / closed / error（**MVP 没有 IPC**，由前端读 `SessionInfo.is_connected`）

## 7. v0 → v1 迁移说明

v0 的 `commands/session.rs` 25 个 command 中：

- 10 个留在 `app/session/`（上文 §1）
- 15 个 tmux 相关迁到 `app/terminal/`

拆分边界（按"命令名 object 是否 tmux"判定）：

| 命令 | v0 归属 | v1 归属 |
|---|---|---|
| `create_local_session` | session | session |
| `create_ssh_session` | session | session |
| `create_session` (generic) | session | session（dispatcher 内部按 type 分流到 session 或 terminal） |
| `write_session` | session | session（通用 write 入口） |
| `close_session` | session | session（通用 close） |
| `list_sessions` | session | session |
| `resize_pty_session` | session | session |
| `resize_ssh_session` | session | session |
| `upload_image_to_ssh_session` | session | session |
| `get_session_output_channel` | session | session |
| `create_tmux_session` | session | **terminal** |
| `attach_tmux_session` | session | **terminal** |
| `probe_tmux_session_exists` | session | **terminal** |
| `auto_attach_tmux_servers` | session | **terminal** |
| `create_tmux_pane` | session | **terminal** |
| `kill_tmux_pane` | session | **terminal** |
| `resize_tmux_pane` | session | **terminal** |
| `capture_tmux_pane` | session | **terminal** |
| `create_tmux_window` | session | **terminal** |
| `kill_tmux_window` | session | **terminal** |
| `rename_tmux_window` | session | **terminal** |
| `get_attached_tmux_servers` | session | **terminal** |
| `detach_tmux_controller` | session | **terminal** |
| `kill_server_via_controller` | session | **terminal** |
| `unmark_attached_tmux` | session | **terminal** |

**拆分原则**：按"命令操作的资源类型"切分——如果命令名的 object 是 `tmux_*` 就归 terminal，否则归 session。`create_session` 是 generic dispatcher 留在 session。

## 8. 跟 v0 的差异

| 维度 | v0 | v1 |
|---|---|---|
| 单文件最大规模 | `commands/session.rs` 660 行 / 25 个 command | `commands/session.rs` ≤ 250 行 / 10 个 command |
| tmux 操作归属 | session | terminal（按产品功能切） |
| 子目录 | 无 | `commands/session/{local,ssh,dispatch,write,close,list,output}.rs` |
| 持久化触发 | 散在 `commands/session.rs` 内调用 `commands/persistence::*` | 通过 `app/settings/api::save_session_config` |
| 与 frontend 对应 | 隐式 | 显式（与 frontend `app/session/api.ts` 一一对应） |