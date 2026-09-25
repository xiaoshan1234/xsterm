# Module · App Shell — 对外接口

> **位置**：`src-tauri/src/app/modules/shell/api.rs`（落地 `src-tauri/src/commands/shell.rs`）
> **唯一进口**：`use crate::app::modules::shell::api::*;`

## 1. 对外暴露什么

`shell` module 只暴露**一个函数**：`initialize(app)`——Tauri 启动钩子的入口。

不暴露 `#[tauri::command]`——因为启动序列不是被前端触发的，而是 `tauri::Builder::default().setup(...)` 钩子里调用的。

## 2. 核心接口

```rust
use tauri::App;

/// Backend 启动序列入口。`lib.rs::run()` 在 `.setup(|app| ...)` 内调用。
///
/// 内部按顺序执行：
/// 1. panic hook 注册（已经在 lib.rs 顶层注册，shell 不重复）
/// 2. `app.handle().path().app_log_dir()` 解析 log 目录
/// 3. `app/settings/api::load_log_config(&app)` 读 log config
/// 4. `logging_setup::cleanup_old_logs(...)` 清理超限 log
/// 5. `logging_setup::init_logging(...)` 创建 reload handle + rolling writer
/// 6. `app.manage(Arc::new(reload_handle))` 注入 reload handle（给 `set_log_config` 用）
/// 7. `RealAppBackend::new(app.handle().clone())` 创建 app backend
/// 8. `app.manage(Arc::new(backend))` 注入 backend
/// 9. `app.emit("session-output-channel", channel)` emit 给前端（Perf 001）
pub fn initialize(app: &mut App) -> Result<(), String>;
```

## 3. 跨 module 调用的具体实现

shell 只调一个其他 module 的 api：

```rust
// commands/shell.rs
use crate::app::modules::settings::api as settings_api;

pub fn initialize(app: &mut tauri::App) -> Result<(), String> {
    // 1. logging
    let log_dir = app.handle().path().app_log_dir()
        .unwrap_or_else(|_| PathBuf::from("."));
    let config = settings_api::load_log_config(&app.handle())?;
    logging_setup::cleanup_old_logs(&log_dir, ...);
    let reload_handle = logging_setup::init_logging(&log_dir, &config);
    app.manage(Arc::new(reload_handle));

    // 2. binary output channel
    let backend = infrastructure::app_backend::RealAppBackend::new(app.handle().clone());
    let channel = backend.session_output_channel.clone();
    app.manage(Arc::new(backend));
    if let Err(e) = app.emit("session-output-channel", channel) {
        tracing::error!("Failed to emit session-output channel: {e}");
    }

    Ok(())
}
```

**关键**：

- shell **不** import `services/*` 内部的字段——只走 `settings::api::load_log_config`
- shell **不**调 `session_manager::create_*`——session 创建完全由前端 `invoke('create_*_session')` 触发

## 4. 接缝契约

```rust
// src-tauri/src/lib.rs::run()
.setup(|app| app::modules::shell::api::initialize(app))
```

**接缝约束**：

- `.setup()` 钩子只能调 `app/shell/api::initialize`，不能绕过 shell 直接编排
- shell 不暴露任何 `pub` 字段给其他 module
- shell 的内部函数（清理 log / 注册 backend）不导出

## 5. 不对外暴露

- panic hook —— 留在 `lib.rs::run()` 顶层（进程级，不属于 shell）
- plugin 注册（`tauri_plugin_opener` 等）—— 留在 `lib.rs::run()` 顶层
- `SessionManager` 的构造 —— 留在 `lib.rs::run()` 顶层（`app.manage(Arc::new(SessionManager::new()))`）

## 6. api.rs 变更流程

1. **新增启动步骤**（如：清理某个缓存）→ 加 `commands/shell.rs` 内部 helper + 在 `initialize()` 按顺序调用
2. **修改启动顺序** → 更新 §3 的注释列表
3. **删除启动步骤** → 同步更新 README + 移除 helper