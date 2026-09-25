# Infra · PTY — 对下依赖

> **位置**：`src-tauri/src/infrastructure/pty/`

## 1. 依赖图

```
infrastructure/pty/
├── traits.rs       ────►  std::io::{Read, Write}                       (MasterPty / SlavePty trait)
├── native.rs       ────►  portable_pty::{native_pty_system, PtySize}   (平台实现)
├── pair.rs         ────►  std::io::{Read, Write}                       (MasterPty / SlavePty impl)
├── mock.rs         ────►  mockall                                       (#[automock])
└── errors.rs       ────►  thiserror::Error                             (PtyError derive)
```

**关键约束**：

- pty 子模块**不** import `crate::services::*`
- pty 子模块**不** import `crate::app::*`
- pty 子模块**不** import `crate::commands::*`
- pty 子模块**不** import 其他 infra 子模块（平级）
- pty 子模块**只** import `std` + `portable-pty` + `mockall` + `thiserror`

## 2. portable-pty（核心外部依赖）

| 调用 | 来源 | 何时 |
|---|---|---|
| `portable_pty::native_pty_system()` | `portable-pty` crate | `NativePtySystem::new()` |
| `portable_pty::NativePtySystem::openpty(PtySize)` | 同上 | `NativePtySystem::openpty()` |
| `portable_pty::PtySize { rows, cols, ... }` | 同上 | 传给 `openpty()` |
| `portable_pty::native_pty_system::Pair` | 同上 | 返回的 pair 持有 master / slave |

**约束**：

- pty 子模块是**唯一**允许直接 import `portable-pty` 的地方
- service 层通过 `PtySystem` trait 间接调用
- 升级 portable-pty 版本只影响 `native.rs` 一个文件

## 3. std

| 使用 | 何时 |
|---|---|
| `std::io::{Read, Write}` | `MasterPty / SlavePty` trait 继承 |
| `std::io::Error` | `PtyError::Io` 自动 From |
| `std::process::Stdio` | (在 service 层使用 `portable_pty::slave` 作为 `Stdio`) |
| `std::sync::Arc` / `Box` | trait object 持有 |

## 4. mockall

| 使用 | 何时 |
|---|---|
| `#[automock]` | 自动 mock `PtySystem` trait |
| `MockPtySystem::new()` | 测试代码构造 mock 实例 |
| `.expect_openpty().returning(...)` | 配置 mock 行为 |
| `.expect_openpty().times(n)` | 配置调用次数 |

**约束**：infra 层统一用 `#[automock]`（自动 mock）；service 层用**手写 fixture**（如 `RecordingBackend`）。两种风格不混。

## 5. thiserror

| 调用 | 来源 | 何时 |
|---|---|---|
| `#[derive(thiserror::Error)]` | `thiserror` crate | `PtyError` enum derive |
| `#[from] std::io::Error` | std | `PtyError::Io` 自动 From |
| `#[error("...")]` | thiserror | Display impl |

## 6. 内部依赖关系

```
infrastructure/pty/
├── traits.rs        ← 被 native.rs + mock.rs + service/session 实现
├── pair.rs          ← 被 native.rs 实现(具体 MasterPty / SlavePty)
├── errors.rs        ← 被 traits.rs + pair.rs 使用
├── native.rs        ← 实现 traits.rs + 使用 pair.rs + errors.rs
└── mock.rs          ← 实现 traits.rs(#[automock])
```

**关键约束**：

- `traits.rs` **不** import `native.rs / mock.rs`（trait 是抽象）
- `native.rs` **不** import `mock.rs`（具体实现 vs mock 平行）
- `mock.rs` **不** import `native.rs`（同上）

## 7. 跨子模块依赖（infra 平级）

| 依赖 | 何时 |
|---|---|
| `infra/ssh::*` | ❌ 不依赖 |
| `infra/tmux::*` | ❌ 不依赖 |
| `infra/tauri::*` | ❌ 不依赖 |

**关键**：4 个 infra 子模块是**平级**——互不依赖。

## 8. 跨层依赖（infra → service/app）

| 依赖 | 何时 |
|---|---|
| `crate::services::*` | ❌ 不依赖 |
| `crate::app::*` | ❌ 不依赖 |
| `crate::commands::*` | ❌ 不依赖 |
| `crate::models::*` | ✅ 可读 `models::session::SessionInfo` 等纯数据类型 |

## 9. 设计意图:pty 是「PTY 子进程的物理封装」

v0 反模式：`infrastructure/pty.rs` 单文件 ~150 行，所有逻辑混在一起——trait + impl + error 难找到。

v1 边界：

- pty 子模块是**单一外部资源的物理封装**——`portable-pty` crate 调用都集中在这里
- service 层通过 `PtySystem` trait 抽象——可 mock 替换
- error 集中在 `errors.rs`——typed error 模式

## 10. v0 → v1 跨调用迁移

| v0 现状 | v1 改法 |
|---|---|
| `infrastructure/pty.rs::PtySystem trait` | `infrastructure/pty/traits.rs` |
| `infrastructure/pty.rs::NativePtySystem` | `infrastructure/pty/native.rs` |
| `infrastructure/pty.rs::PtyPair` | `infrastructure/pty/pair.rs` |
| `infrastructure/pty.rs` 内 inline enum error | `infrastructure/pty/errors.rs::PtyError`(thiserror derive) |
| 无 mock | `infrastructure/pty/mock.rs::MockPtySystem`(`#[automock]`) |
| 所有 `use crate::infrastructure::pty::X` | `use crate::infrastructure::pty::{traits, native, pair, mock, errors}::X` |

## 11. 不允许的依赖

- ❌ `infrastructure/pty/` → `crate::services::*`
- ❌ `infrastructure/pty/` → `crate::app::*`
- ❌ `infrastructure/pty/` → `crate::commands::*`
- ❌ `infrastructure/pty/` → 其他 infra 子模块
- ❌ `infrastructure/pty/` → `tokio::main`
- ❌ `infrastructure/pty/traits.rs` → `infrastructure/pty/native.rs`（trait 是抽象，不依赖 impl）
- ❌ `infrastructure/pty/` → `infrastructure/pty/mock.rs` 在非测试代码（mock 只用于 service 测试）

## 12. 依赖变更流程

1. **新增 PtySystem trait method** → 加 `traits.rs` + 更新 mock + 更新 `native.rs` impl + INTERFACE.md §2.1
2. **新增 PtyError 变体** → 加 `errors.rs` 变体 + INTERFACE.md §2.3 + 检查所有 `?` 调用方
3. **修改 portable-pty API** → 升级 Cargo.toml + 更新 `native.rs` 调用 + 跑 `cargo check` + 跑集成测试
4. **新增 MasterPty / SlavePty method** → 加 `pair.rs` 方法 + INTERFACE.md §2.2 + 更新 service 调用方
5. **mock 配置变更** → `mock.rs` 自动跟随 trait——只需更新 `#[automock]` 标注 + 测试代码