# Module · App Settings — 职责

> **位置**：`src-tauri/src/app/modules/settings/`（落地 `src-tauri/src/commands/settings.rs` + `commands/persistence.rs` 迁入）
> **用户认知里的位置**：「设置持久化 + log 配置 + 跨 module 应用」
> **核心地位**：app 层的"横切" module——其他 4 个 module 都会调 settings 触发持久化
> **Frontend 对应**：[`../../../frontend/app/settings/RESPONSIBILITY.md`](../../../frontend/app/settings/RESPONSIBILITY.md)

## 1. 这个 module 负责什么

settings module 编排 backend **所有持久化 + log 配置 IPC**——8 个 `#[tauri::command]`：

1. **persistence — sessions** (2)
   - `save_sessions` —— 写 `sessions.json`
   - `load_sessions` —— 读 `sessions.json`

2. **persistence — groups** (2)
   - `save_groups` —— 写 `groups.json`
   - `load_groups` —— 读 `groups.json`

3. **persistence — attached_tmux_servers** (2)
   - `save_attached_tmux_servers` —— 写 `attached_tmux.json`
   - `load_attached_tmux_servers` —— 读 `attached_tmux.json`

4. **logging** (3)
   - `log_message` —— 前端日志转发到 backend `tracing`
   - `get_log_config` —— 读 log config
   - `set_log_config` —— 写 log config + 实时 reload `EnvFilter`
   - `get_log_dir` —— 返回 log 目录路径

**合计**：10 个 `#[tauri::command]`——v3 在 `commands/persistence.rs` 6 个 + `commands/logging.rs` 4 个，v4 全部合并到 `app/settings/`。

## 2. 为什么 persistence/logging 合并到 settings

v3 把 `commands/persistence.rs` + `commands/logging.rs` 当作**独立的资源类型** module。v4 合并理由：

- **persistence 没有独立业务**：所有持久化调用都来自 settings 流程（保存 session config / 保存 group / 保存 attach 列表）—— 没有"独立于 settings 的 persistence 业务"
- **logging 没有独立业务**：只有 settings tab 会读 / 写 log config，其他 module 调 `log_message` 是横切关注点（应走 `infra/logger`，不经过 settings module 的 IPC）
- **避免"按技术层切"反模式**：v4 按产品功能切；如果 persistence / logging 单独成 module，会退化成 v3 的资源类型切分

**例外**：`log_message` 必须保留为 IPC（前端 `app/session/api.ts::logMessage` 调）——但它**逻辑上**属于 logging 横切关注点，不是 settings tab 流程。

## 3. 这个 module **不**负责什么

- **不渲染设置 UI** —— UI 由 frontend `ui/settings/` 负责
- **不决定 log 行为**（除了 reload filter）—— log 写文件由 `services/session_log.rs` / `logging_setup` 完成
- **不持有状态** —— 持久化全部走 `tauri-plugin-store`，reload handle 由 `logging_setup` 创建
- **不管理 in-memory 配置缓存** —— 设置每次都从 disk 读（不缓存）；log config 在内存中是 `Arc<Mutex<reload::Handle>>`

## 4. 子结构

落地到 `src-tauri/src/commands/settings.rs`（顶层，logging 部分）+ `src-tauri/src/commands/settings/` 子目录：

```
modules/settings/
├── api.rs                          ⭐ 唯一对外入口
├── commands/
│   ├── persistence/
│   │   ├── sessions.rs             save_sessions / load_sessions
│   │   ├── groups.rs               save_groups / load_groups
│   │   └── attached_tmux.rs        save_attached_tmux_servers / load_attached_tmux_servers
│   └── logging/
│       ├── message.rs              log_message
│       └── config.rs                get_log_config / set_log_config / get_log_dir
├── model.rs                        module 专属类型（ATTACHED_TMUX_STORE 常量等）
└── mod.rs                          re-export api.rs
```

## 5. 用户故事（backend 视角）

- **作为前端 `app/settings`**，我希望改完设置后能立即持久化 → `save_sessions` / `save_groups` 等 6 个命令
- **作为前端 `app/session`**，我希望创建 saved session config 时调一次 save → `settings_api::save_session_config`（纯函数入口，被 session 触发）
- **作为前端 `app/terminal`**，我希望 tmux controller attach 后自动持久化 → `settings_api::save_attached_tmux_servers`（被 terminal 触发）
- **作为前端 logger**，我希望前端 console 输出能落到 backend log 文件 → `log_message` 接受 `level/source/message/data` 转发到 `tracing::*!`
- **作为前端 settings drawer**，我希望改完 log level 立即生效 → `set_log_config` 写 store + reload `EnvFilter`

## 6. 跟其他 module 的关系

| module | 关系 |
|---|---|
| `app/shell` | shell.initialize() 调 `settings_api::load_log_config`（在 init_logging 之前） |
| `app/session` | session 在 create 后调 `settings_api::save_session_config` |
| `app/terminal` | terminal 在 controller 创建/attach/detach/kill 后调 `settings_api::save_attached_tmux_servers` |
| `app/workspace` | workspace 未来激活时调 `settings_api::save_workspace_state`（未来） |
| `services/session_log` | settings **不**直接调——log_message 转发到 `tracing::*!`，由 tracing-subscriber 路由到 rolling writer |
| `infrastructure/store` | settings 直接调 `tauri-plugin-store` —— 这是 settings module **唯一允许**直接调 infra 的特殊情形 |

**关键**：

- settings **不** import 其他 module 的 IPC handler
- 其他 module 通过 `settings_api::save_*` / `load_*` 纯函数入口调 settings
- settings 是唯一允许直接 import `tauri-plugin-store` 的 module（其他 module 必须经过 settings）

## 7. 这个 module 的"产品语言"术语

- **persisted session config** —— `SessionInfo` + 原始 `SessionConfig` 的可持久化投影（与 frontend `PersistedSessionConfig` 对应）
- **group** —— sidebar 的 session 分类（`SessionGroup { id, name, session_ids, collapsed }`）
- **attached_tmux_servers** —— 启动时尝试 attach 的 tmux server 列表
- **log config** —— `{ log_level: String, max_log_files: u32, max_file_size: u64 }`
- **reload handle** —— `Arc<Mutex<EnvFilterReloadHandle>>`，让 `set_log_config` 实时改 filter
- **log directory** —— `app.path().app_log_dir()` 解析的绝对路径
- **frontend log message** —— `{ level, source, message, data? }` IPC 载荷，转发到 `tracing::{info,debug,warn,error}`

## 8. v3 → v4 迁移说明

v3 的 `commands/persistence.rs` 6 个命令 + `commands/logging.rs` 4 个命令，v4 全部合并到 `app/settings/commands/`：

| v3 命令（src-tauri/src/commands/*.rs） | v4 落点 |
|---|---|
| `save_sessions` | `app/settings/commands/persistence/sessions.rs` |
| `load_sessions` | 同上 |
| `save_groups` | `app/settings/commands/persistence/groups.rs` |
| `load_groups` | 同上 |
| `save_attached_tmux_servers` | `app/settings/commands/persistence/attached_tmux.rs` |
| `load_attached_tmux_servers` | 同上 |
| `log_message` | `app/settings/commands/logging/message.rs` |
| `get_log_config` | `app/settings/commands/logging/config.rs` |
| `set_log_config` | 同上 |
| `get_log_dir` | 同上 |

**关键**：

- v3 的 `commands/persistence.rs` 整体删除
- v3 的 `commands/logging.rs` 整体删除
- v3 的 `save_attached_tmux_servers_impl`（pub(crate) sync helper，被 session module 内联调用）→ v4 改为 `settings_api::save_attached_tmux_servers` 的 pub 纯函数入口

## 9. 跟 v3 的差异

| 维度 | v3 | v4 |
|---|---|---|
| module 划分 | 独立 `commands/persistence.rs` + `commands/logging.rs` | 合并进 `app/settings/commands/` |
| 单文件最大 | `commands/session.rs` 660 行 | `commands/settings.rs` ≤ 200 行 |
| 子目录 | 无 | `commands/settings/{persistence,logging}/` |
| `save_attached_tmux_servers_impl` | pub(crate) helper 被 session 内联 | pub api 入口，terminal 通过 api 边界调 |
| 与 frontend 对应 | 隐式 | 显式（与 frontend `app/settings/api.ts` 一一对应） |
| log_message 归属 | `commands/logging.rs`（独立） | `app/settings/commands/logging/message.rs`（合并） |