# Module · Commands Session — 职责

> **位置**：`src-tauri/src/commands/session/`（落地 `src-tauri/src/commands/session.rs`）
> **用户认知里的位置**：「session 生命周期的所有 IPC 命令」
> **核心地位**：app 层最核心的 module；其他 4 个 module 都会调 session 的 api
> **Frontend 对应**：[`../../../frontend/app/session/RESPONSIBILITY.md`](../../../frontend/app/session/RESPONSIBILITY.md)

## 1. 这个 module 负责什么

session module 编排 backend **session 全生命周期的 IPC 命令**——**13 个 `#[tauri::command]`**（10 + 3 MCP attach 系列）：

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
11. **`set_mcp_attach`** —— MCP attach 状态登记（session_id + client_id）
12. **`clear_mcp_attach`** —— MCP attach 释放
13. **`list_mcp_attached`** —— 列当前被 MCP attach 的 session（给 `list_sessions` 拼 `attached_by_mcp` 字段）

**合计**：10 + 3 = **13 个 `#[tauri::command]`**——15 个 tmux 相关命令在 `commands/terminal/`。

## 2. 这个 module **不**负责什么

- **不渲染 UI** —— UI 由 frontend `ui/session/` 负责
- **不管理 tmux pane/window 操作** —— 归 `commands/terminal/`（混在 `commands/session.rs`）
- **不持久化 saved config** —— 砍掉，frontend `service/persistence/sessions.ts` 直存 `infra/store`
- **不持有状态** —— 状态归 `domain/session_manager.rs`
- **不直接 import `domain/session_manager` 字段** —— 通过 `session_manager::SessionManager` 的 public 方法

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
│   ├── output.rs                   get_session_output_channel
│   ├── attach.rs                   set_mcp_attach / clear_mcp_attach / list_mcp_attached（MCP AI attach 注册表 IPC）
│   └── log.rs                      start_session_logging_session（**P1-5 上移到 commands 层**——具体编排归 commands；领域层只声明事件点）
├── model.rs                        module 专属类型（MAX_WRITE_PAYLOAD_BYTES 常量等）
└── mod.rs                          re-export api.rs
```

## 4. 用户故事（backend 视角）

- **作为前端 `commands/session`**，我希望按 session 类型 invoke 不同的 IPC → `commands/{local,ssh,dispatch}.rs` 提供 3 个 create 入口
- **作为前端 paste 管线**，我希望 write_session 单次调用能下发任意大小字节 → `MAX_WRITE_PAYLOAD_BYTES` 上限保护 + 异步 write（Perf 010/011）
- **作为前端 resize observer**，我希望 PTY/SSH/tmux 用**不同的** IPC resize → 三个独立 command（前端按 `sessionType` 选择，tmux resize 归 terminal）
- **作为前端 image upload 流程**，我希望能直接传 `Vec<u8>` 给 backend SCP 上传 → `upload_image_to_ssh_session` 封装 `SshBackendImpl::upload_file`

## 5. 跟其他 module 的关系

| module | 关系 |
|--|--|
| `commands/terminal` | session **不**直接调 terminal；tmux session 创建由 `commands/terminal/api::create_tmux_session` 暴露 |
| **（无）** | session 创建成功后不触发 backend 持久化（v6 砍 save_session_config）；saved config 由 frontend `service/persistence/sessions.ts` 直存 `sessions.json` |
| `commands/shell` | shell 不直接调 session；session 完全由前端 `invoke()` 触发 |
| **（无 backend module）** | workspace 状态完全 frontend 持有，session 不调 backend |
| `domain::session::SessionManager` | session api **唯一**直接调用的 domain —— 通过 `state.method()` 调用 |
| `domain::session::mcp_attachments` | **新增字段**——`DashMap<u32, String>` 注册表（session_id → mcp client_id），由 `commands/session/commands/attach.rs` 的 3 个 IPC 维护 |
| `commands/session/log.rs::start_session_logging_session` | **P1-5 上移**——session create 时由本 module 的 `commands/log.rs` 调（具体日志编排归 commands/session；domain/session 仅声明事件点） |
| `domain::session::backends::local` | session.create_local 委托给 `domain/session/backends/local/mod.rs::create_local_session` |
| `domain::session::backends::ssh` | session.create_ssh 委托给 `domain/session/backends/ssh/mod.rs::create_ssh_session` |
| `infrastructure::tauri::RealAppBackend` | 每个 session create 都构造 `RealAppBackend::new(app)`（注入 Tauri AppHandle） |

**关键**：

- session **不** import `domain/terminal_session::*`——tmux 操作归 `commands/terminal/`
- session **不**触发 backend 持久化（v6 砍 save_session_config）；saved config 由 frontend `service/persistence/sessions.ts` 直存
- session **不** 跨过 service 直接调 `infrastructure/pty::*`——必须经 service

## 6. 这个 module 的"产品语言"术语

- **session** —— 一个后台进程 + 它的连接配置 + 状态
- **local session** —— 本地 PTY（local shell）
- **ssh session** —— 远程 SSH（russh）
- **tmux session** —— tmux -CC controller 下的 pane（归 `commands/terminal/`）
| `persisted config` —— 持久化的 session 配置（frontend 直存 sessions.json，归 service/persistence） |
- **display config** —— 运行时可调的字体 / 字号 / theme（**MVP 没有 IPC**，完全在 frontend）
- **session status** —— connecting / running / closed / error（**MVP 没有 IPC**，由前端读 `SessionInfo.is_connected`）
