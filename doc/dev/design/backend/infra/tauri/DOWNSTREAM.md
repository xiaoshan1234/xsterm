# Infra · Tauri — 对下依赖

> **位置**：`src-tauri/src/infrastructure/tauri/`

## 1. 依赖图

```
infrastructure/tauri/
├── app_backend.rs  ────►  tauri::{AppHandle, Emitter}        (RealAppBackend::emit / emit_binary)
├── app_backend.rs  ────►  tauri::ipc::Channel                 (session_output_channel)
├── app_backend.rs  ────►  serde_json::Value                   (emit JSON payload)
├── app_backend.rs  ────►  std::thread                         (spawn 后台 thread)
├── binary_frame.rs ────►  (no deps — pure byte buffer codec)
├── errors.rs       ────►  thiserror::Error                    (TauriError derive)
└── mock.rs         ────►  mockall                             (#[automock])
```

**关键约束**：

- tauri 子模块**不** import `crate::services::*`
- tauri 子模块**不** import `crate::app::*`
- tauri 子模块**不** import `crate::commands::*`
- tauri 子模块**不** import 其他 infra 子模块（平级）
- tauri 子模块**只** import `tauri` + `std` + `serde_json` + `mockall` + `thiserror`

## 2. tauri（核心外部依赖）

| 调用 | 来源 | 何时 |
|---|---|---|
| `tauri::AppHandle` | `tauri` crate | `RealAppBackend.app` 字段 |
| `tauri::Emitter` (trait) | 同上 | `app.emit(event, payload)` 方法 |
| `tauri::ipc::Channel<T>` | 同上 | `Channel<Vec<u8>>` binary output channel |
| `Channel::new(handler)` | 同上 | 创建 channel（no-op handler for Rust → JS） |
| `Channel::send(payload)` | 同上 | `emit_binary` 推 binary payload |
| `tauri::Manager` (trait) | 同上 | (在 lib.rs / app/shell 使用) |

**约束**：

- tauri 子模块是 backend 中**唯一**允许直接 import `tauri` 的 infra 子模块
- 其他 3 个 infra 子模块（pty / ssh / tmux）**不** 直接 import tauri
- service 层通过 `AppBackend` trait 间接调用 Tauri

## 3. serde_json

| 调用 | 来源 | 何时 |
|---|---|---|
| `serde_json::Value` | `serde_json` crate | `AppBackend::emit` payload 参数 |
| `serde_json::to_value` | 同上 | (在 service 层使用，emit 构造 payload) |

## 4. std

| 使用 | 何时 |
|---|---|
| `std::sync::Arc` | `RealAppBackend.app` 字段（共享 AppHandle） |
| `std::thread::spawn` | `RealAppBackend::spawn` 后台 thread |
| `std::io::{Read, Write}` | (BinaryFrame 函数不需要——纯 byte 操作) |

## 5. mockall

| 使用 | 何时 |
|---|---|
| `#[automock]` | 自动 mock `AppBackend` trait |
| `MockAppBackend::new()` | 测试代码构造 mock 实例 |
| `.expect_emit().withf(...)` | 配置 mock 行为 + 参数匹配 |

## 6. thiserror

| 调用 | 来源 | 何时 |
|---|---|---|
| `#[derive(thiserror::Error)]` | `thiserror` crate | `TauriError` enum derive |

## 7. 内部依赖关系

```
infrastructure/tauri/
├── app_backend.rs  ← 实现 AppBackend trait + 使用 Channel + AppHandle
├── binary_frame.rs ← pure byte buffer codec（不依赖其他文件）
├── errors.rs       ← 被 app_backend.rs / binary_frame.rs 使用
└── mock.rs         ← 实现 AppBackend trait（#[automock]）
```

**关键约束**：

- `app_backend.rs` **不** import `binary_frame.rs`（BinaryFrame 是独立 wire format）
- `binary_frame.rs` **不** import 其他文件（pure function）

## 8. 跨子模块依赖（infra 平级）

| 依赖 | 何时 |
|---|---|
| `infra/pty::*` | ❌ 不依赖 |
| `infra/ssh::*` | ❌ 不依赖 |
| `infra/tmux::*` | ❌ 不依赖 |

**关键**：tauri 子模块是 4 个 infra 子模块中**唯一**直接 import `tauri` 的。其他通过 service 层间接。

## 9. 跨层依赖（infra → service/app）

| 依赖 | 何时 |
|---|---|
| `crate::services::*` | ❌ 不依赖 |
| `crate::app::*` | ❌ 不依赖 |
| `crate::commands::*` | ❌ 不依赖 |
| `crate::models::*` | ❌ 不依赖（BinaryFrame 是 pure byte buffer，不涉及 models） |

## 10. 设计意图:tauri 是「Tauri runtime 的物理封装」

v0 反模式：`infrastructure/{app_backend,binary_frame}.rs` 2 文件混在顶层，命名上不归类。

v1 边界：

- tauri 子模块是**单一外部资源（Tauri runtime）的物理封装**——所有 `tauri` crate 调用集中
- service 层通过 `AppBackend` trait 抽象——可 mock 替换
- 与 frontend `infra/tauri` 镜像（backend 提供 emit / frontend 提供 invoke / listen）
- BinaryFrame 是独立 wire format——不依赖其他文件

## 11. v0 → v1 跨调用迁移

| v0 现状 | v1 改法 |
|---|---|
| `infrastructure/app_backend.rs` | `infrastructure/tauri/app_backend.rs` |
| `infrastructure/binary_frame.rs` | `infrastructure/tauri/binary_frame.rs` |
| 无 errors 模块 | `infrastructure/tauri/errors.rs::TauriError`(thiserror derive) |
| 无 mock | `infrastructure/tauri/mock.rs::MockAppBackend`(`#[automock]`) |
| `RealAppBackend::session_output_channel` 直接 `pub` 字段访问 | `RealAppBackend::session_output_channel(&self) -> &Channel<Vec<u8>>` getter |
| `lib.rs::run()` 内联 `app.emit("session-output-channel", channel)` | `app/shell/api.rs::initialize(app)` 调 `infra/tauri::RealAppBackend::new` |

## 12. 不允许的依赖

- ❌ `infrastructure/tauri/` → `crate::services::*`
- ❌ `infrastructure/tauri/` → `crate::app::*`
- ❌ `infrastructure/tauri/` → `crate::commands::*`
- ❌ `infrastructure/tauri/` → 其他 infra 子模块（平级）
- ❌ `infrastructure/tauri/` → `crate::models::*`（BinaryFrame 不涉及 models）
- ❌ `infrastructure/tauri/app_backend.rs` → `infrastructure/tauri/mock.rs`（具体实现 vs mock 平行）
- ❌ `infrastructure/tauri/binary_frame.rs` → `infrastructure/tauri/app_backend.rs`（独立 wire format）
- ❌ 其他 infra 子模块（pty / ssh / tmux）→ 直接 import `tauri`（必须经过 `AppBackend` trait）

## 13. 依赖变更流程

1. **新增 AppBackend trait method** → 加 `app_backend.rs` + 更新 mock + 更新 `RealAppBackend` impl + INTERFACE.md §2.1
2. **新增 BinaryFrame 字段** → 加 `binary_frame.rs` + 同步更新前端解析 + INTERFACE.md §2.3
3. **新增 TauriError 变体** → 加 `errors.rs` 变体 + INTERFACE.md §2.4 + 检查所有 `?` 调用方
4. **修改 session_output_channel 行为** → ⚠️ breaking——同步更新前端 listener + INTERFACE.md §2.2
5. **迁移 RealAppBackend 构造** → 加 `services/settings/api.rs::init_real_app_backend` + 在 `app/shell/api.rs::initialize` 调
6. **升级 tauri crate 版本** → 跑 `cargo check` + 跑集成测试 + INTERFACE.md 同步