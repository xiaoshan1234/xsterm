# Module · Commands Shell — 职责

> **位置**：`src-tauri/src/commands/shell/`（落地 `src-tauri/src/commands/shell.rs`）
> **用户认知里的位置**：「app 启动序列 + 关闭序列编排」
> **核心地位**：app 层的入口编排者；其他 4 个 module 的 `initialize` 路径都从这里发起
> **Frontend 对应**：[`../../../frontend/app/shell/RESPONSIBILITY.md`](../../../frontend/app/shell/RESPONSIBILITY.md)

## 1. 这个 module 负责什么

shell module 是 backend 的**启动 / 关闭编排入口**。它**不**对外暴露 `#[tauri::command]`——它是 `tauri::Builder::default().setup(...)` 钩子里的编排代码：

1. **logging 初始化**——读 `log_config.json` / 清理旧 log / 创建 reload handle / 启动 rolling file writer
2. **binary output channel 注册**——把 `RealAppBackend::session_output_channel` 注册到 `App::manage(...)`，emit `session-output-channel` 事件给前端
3. **panic hook 注入**——确保 panic 既写 stderr 也走 `tracing::error!`
4. **（未来）shutdown 序列**——清理 old log / flush tracing / 优雅关 SessionManager（当前 lib.rs 已通过 Drop 自然完成）

## 2. 这个 module **不**负责什么

- **不暴露 IPC**——所有 IPC 命令归 session / terminal / settings 三个 module
- **不持有业务状态**——状态归 `domain/session_manager.rs` / `domain/session_log.rs`
- **不编排业务逻辑**——只是顺序触发其他 module 的 `api::*` 函数
- **不处理 Tauri runtime 的 register 逻辑**（plugins 注册 / invoke_handler）——这些保留在 `lib.rs::run()` 顶层

## 3. 子结构

落地到 `src-tauri/src/commands/shell.rs`（ `lib.rs::run()` 的内联块，v4 抽出来）：

```rust
// commands/shell.rs
pub fn initialize(app: &mut tauri::App) -> Result<(), String> {
    // 1. logging
    // 2. binary output channel
    // 3. (future) shutdown sequence registration
}
```

**api.rs**（语义名；落地为 `commands/shell.rs::initialize`）：

```rust
pub fn initialize(app: &mut tauri::App) -> Result<(), String>;
// 内部按顺序调：
//   - logging_setup::init_logging(&log_dir, &config)
//   - infrastructure::app_backend::RealAppBackend::new(app.handle().clone())
//   - app.emit("session-output-channel", channel)
```

## 4. 用户故事（backend 视角）

- **作为 Tauri runtime**，我希望 `.setup()` 完成时 logging 已就位、output channel 已注册 → `initialize()` 完成即可
- **作为 dev**，我希望关闭 app 时 rolling log writer 被 flush → 当前靠 `std::mem::forget(_guard)` 保持 writer 存活

## 5. 跟其他 module 的关系

| module | 关系 |
|—|—|
| `commands/session` | shell **不**调 session；session 通过自己的 `#[tauri::command]` 被前端触发 |
| `commands/terminal` | shell **不**调 terminal；terminal 通过自己的 `#[tauri::command]` 被前端触发 |
| （已删除——attached_tmux→terminal，log→shell）| shell.initialize() 内调 `commands/shell/api::load_log_config()`（在 logging 初始化之前） |
| `service/session_log` | shell 直接调（属于基础设施） |
| `service/infrastructure/app_backend` | shell 直接 new `RealAppBackend` |

**关键**：shell 不直接 import `domain/session_manager::*`——session_manager 完全由 session/terminal module 通过自己的 api.rs 触发。

## 6. 这个 module 的"产品语言"术语

- **initialize** —— backend 启动序列入口，绑定 `.setup()` 钩子
- **shutdown** —— backend 关闭序列（，靠 Rust Drop 兜底）
- **panic hook** —— 进程级 panic 处理器
- **output channel** —— binary `session-output` IPC channel（Perf 001）
- **reload handle** —— `EnvFilter` reload handle，让 `set_log_config` 实时生效
