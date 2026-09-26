# Module · Commands Shell — 对下依赖

> **位置**：`src-tauri/src/commands/shell/`

## 1. 依赖图

```
modules/shell/
├── api.rs        ────►  commands/shell/log_config::load_log_config (本 module 子模块，v6 合并自原 commands/settings)
├── api.rs        ────►  logging_setup::*              (init_logging / cleanup_old_logs)
├── api.rs        ────►  infrastructure/tauri::RealAppBackend    (RealAppBackend::new)
├── api.rs        ────►  domain/session/types::*                (LogConfig 等纯数据类型)
└── commands/     ────►  (不调任何其他 module——shell 不暴露 #[tauri::command])
```

## 2. commands/shell（log runtime）

| 调用 | 来源 | 何时调 |
|--|--|--|
| `commands/shell/log_config::load_log_config(app_handle)` | 本 module 子模块（v6 合并） | `initialize()` 步骤 3，启动 rolling writer 之前 |

**关键**：shell 不直接 import `domain::session::log` 或 `domain::session::types::LoggingConfig`——统一走 `shell::log_config` 入口。

## 3. logging_setup

| 调用 | 来源 | 何时调 |
|--|--|--|
| `cleanup_old_logs(&log_dir, max_bytes)` | `crate::logging_setup` | `initialize()` 步骤 4 |
| `init_logging(&log_dir, &config) -> reload::Handle` | `crate::logging_setup` | `initialize()` 步骤 5 |

**约束**：logging_setup 是 infra-level 工具函数，shell 直接调是允许的（不需要 service 间接）。

## 4. infrastructure

| 调用 | 来源 | 何时调 |
|--|--|--|
| `RealAppBackend::new(app_handle)` | `crate::infrastructure::tauri::app_backend` | `initialize()` 步骤 7 |

**约束**：shell 是**唯一允许**直接 import `infrastructure::tauri::RealAppBackend` 的 module——其他 module 必须经过 domain/app_backend trait。理由：app_backend 是 Tauri-level handle 的 wrapper，没有业务规则。

## 5. models

| 读取 | 来源 |
|--|--|
| `PathBuf` | `std::path` |
| `tauri::App` / `tauri::AppHandle` | `tauri` |
| `Arc<...>` / `tracing::*` | std / tracing |

## 6. 设计意图：shell 是「瘦编排者」

 `lib.rs::run()` 内联块 30 行混了 logging + binary frame + panic hook 注释。抽到 shell module 的好处：

- **可单测**：`initialize(mock_app)` 可以被未来的集成测试覆盖
- **可演进**：加新的启动步骤（如：预热 SessionManager、emit `ready` 事件）只改 `initialize()` 一个函数
- **文档化**：启动序列在 §3 的接口注释里有完整步骤列表

## 7. 不允许的依赖

| ❌ `commands/shell/` → `infrastructure::pty::*`（PTY 由 session/terminal 间接使用）
| ❌ `commands/shell/` → `infrastructure::ssh::*`（同）
| ❌ `commands/shell/` → 任何 `#[tauri::command]` 内部逻辑（shell 不暴露 IPC）
| ❌ `commands/shell/` → `commands/terminal/api.rs::auto_attach_*`（auto-attach 由前端触发，不在启动钩子里）

## 8. 依赖变更流程

1. **新增启动步骤** → 加 logging_setup helper 或 app_backend 调用 + 更新 §3
2. **修改启动顺序** → 更新 `initialize()` 步骤顺序 + 同步 README
3. **删除启动步骤** → 从 helper + README 一起删除
4. **新增跨 module 启动依赖**（如：启动时自动 attach 所有 tmux server）→ 改由 `commands/terminal/api.rs::auto_attach_tmux_servers` 暴露，并在 §2 加上对 terminal_api 的依赖
