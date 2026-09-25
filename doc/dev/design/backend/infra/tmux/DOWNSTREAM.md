# Infra · Tmux — 对下依赖

> **位置**：`src-tauri/src/infrastructure/tmux/`

## 1. 依赖图

```
infrastructure/tmux/
├── backend.rs      ────►  tokio::process::Command          (LocalTmuxBackend::spawn)
├── backend.rs      ────►  infrastructure/ssh::SshBackend     (SshTmuxBackend::spawn)
├── backend.rs      ────►  std::io::{Read, Write}            (TmuxBackendHandle stdin/stdout)
├── backend.rs      ────►  std::process::Child              (subprocess handle)
├── errors.rs       ────►  thiserror::Error                 (TmuxInfraError derive)
└── mock.rs         ────►  mockall                          (#[automock])
```

**关键约束**：

- tmux 子模块**不** import `crate::services::*`
- tmux 子模块**不** import `crate::app::*`
- tmux 子模块**不** import `crate::commands::*`
- tmux 子模块**不** import 其他 infra 子模块（**除** `infra/ssh`）
- tmux 子模块**只** import `std` + `tokio` + `mockall` + `thiserror` + `infra/ssh::*` + `models`

## 2. tokio

| 调用 | 来源 | 何时 |
|---|---|---|
| `tokio::process::Command::new("tmux")` | `tokio` crate | `LocalTmuxBackend::spawn` |
| `tokio::process::Command::args(...)` | 同上 | tmux 命令行参数 |
| `tokio::process::Command::spawn()` | 同上 | spawn 子进程 |
| `tokio::process::Child` | 同上 | 持有子进程 handle |
| `tokio::process::Child::kill()` | 同上 | 关闭 controller 时 kill 子进程 |

**约束**：

- tmux 子模块**允许** import `tokio::process`——具体 I/O API
- tmux 子模块**禁止** import `tokio::main`——那是 binary 入口

## 3. infra/ssh（关键依赖）

| 调用 | 来源 | 何时 |
|---|---|---|
| `infra/ssh::SshBackend` trait | `infrastructure/ssh/traits.rs` | `SshTmuxBackend::spawn` 通过 SSH exec channel 启动远端 tmux |
| `SshBackend::run_command_capture_stdout` | `infrastructure/ssh/traits.rs` | 备选路径——同步执行远程 tmux 命令 |

**关键约束**：

- tmux 子模块**允许** import `infra/ssh::SshBackend`——SshTmuxBackend 需要这个 trait
- 但**不** import `infra/ssh::SshBackendImpl`(具体实现)——只引用 trait
- 这是 4 个 infra 子模块中**唯一**允许跨子模块依赖的边界

## 4. models

| 读取 | 来源 |
|---|---|
| `TmuxCcConfig` | `models/tmux/types.rs` |

**约束**：models 是纯数据类型——tmux 可自由 import。

## 5. std

| 使用 | 何时 |
|---|---|
| `std::io::{Read, Write}` | `TmuxBackendHandle.stdin / stdout / stderr` |
| `std::process::Child` | `TmuxBackendHandle.child` trait bound |
| `std::process::ExitStatus` | 子进程 exit status |

## 6. mockall

| 使用 | 何时 |
|---|---|
| `#[automock]` | 自动 mock `TmuxBackend` trait |
| `MockTmuxBackend::new()` | 测试代码构造 mock 实例 |
| `.expect_spawn().returning(...)` | 配置 mock 行为 |

## 7. thiserror

| 调用 | 来源 | 何时 |
|---|---|---|
| `#[derive(thiserror::Error)]` | `thiserror` crate | `TmuxInfraError` enum derive |

## 8. 内部依赖关系

```
infrastructure/tmux/
├── backend.rs        ← 实现 TmuxBackend trait + LocalTmuxBackend / SshTmuxBackend impl
├── errors.rs         ← 被 backend.rs 使用
└── mock.rs           ← 实现 TmuxBackend trait(#[automock])
```

**关键约束**：

- `backend.rs` **不** import `mock.rs`（具体实现 vs mock 平行）
- `mock.rs` **不** import `backend.rs`（同上）

## 9. 跨子模块依赖（infra 边界）

| 依赖 | 何时 |
|---|---|
| `infra/pty::*` | ❌ 不依赖 |
| `infra/ssh::*` | ✅ **依赖**（SshTmuxBackend 需要 SshBackend trait）|
| `infra/tauri::*` | ❌ 不依赖 |

**关键**：4 个 infra 子模块中**只有 tmux 依赖 ssh**——其他都是平级。

## 10. 跨层依赖（infra → service/app）

| 依赖 | 何时 |
|---|---|
| `crate::services::*` | ❌ 不依赖 |
| `crate::app::*` | ❌ 不依赖 |
| `crate::commands::*` | ❌ 不依赖 |
| `crate::models::tmux::TmuxCcConfig` | ✅ 读纯数据类型 |

## 11. 设计意图:tmux 是「tmux -CC 子进程的物理封装」

v3 反模式：`infrastructure/tmux/` 只有 2 文件，错误处理隐式。

v4 边界：

- tmux 子模块是**单一外部资源（tmux -CC 子进程）的物理封装**——`tokio::process::Command` + SSH exec channel 调用都集中在这里
- service 层通过 `TmuxBackend` trait 抽象——可 mock 替换
- error 集中在 `errors.rs`——`TmuxInfraError` 与 `services::tmux::TmuxError` 区分
- 与 `infra/ssh` 的依赖边界清晰（trait only）

## 12. v3 → v4 跨调用迁移

| v3 现状 | v4 改法 |
|---|---|
| `infrastructure/tmux/mod.rs` | `infrastructure/tmux/mod.rs`（不动） |
| `infrastructure/tmux/backend.rs::TmuxBackend trait` | `infrastructure/tmux/backend.rs`（不动） |
| `infrastructure/tmux/backend.rs::LocalTmuxBackend` | `infrastructure/tmux/backend.rs`（不动） |
| `infrastructure/tmux/backend.rs::SshTmuxBackend` | `infrastructure/tmux/backend.rs`（不动） |
| 隐式 error 依赖 String | `infrastructure/tmux/errors.rs::TmuxInfraError`(thiserror derive) |
| 无 mock | `infrastructure/tmux/mock.rs::MockTmuxBackend`(`#[automock]`) |

## 13. 不允许的依赖

- ❌ `infrastructure/tmux/` → `crate::services::*`
- ❌ `infrastructure/tmux/` → `crate::app::*`
- ❌ `infrastructure/tmux/` → `crate::commands::*`
- ❌ `infrastructure/tmux/` → `infra/pty::*`（平级）
- ❌ `infrastructure/tmux/` → `infra/tauri::*`（平级）
- ❌ `infrastructure/tmux/` → `tokio::main`
- ❌ `infrastructure/tmux/backend.rs` → `infrastructure/tmux/mock.rs`（具体实现 vs mock 平行）
- ❌ `infrastructure/tmux/` → `infrastructure/ssh::SshBackendImpl`（只引用 trait）

## 14. 依赖变更流程

1. **新增 TmuxBackend trait method** → 加 `backend.rs` + 更新 mock + 更新 impl + INTERFACE.md §2.1
2. **新增 TmuxInfraError 变体** → 加 `errors.rs` 变体 + INTERFACE.md §2.5 + 检查所有 `?` 调用方
3. **修改 LocalTmuxBackend / SshTmuxBackend 签名** → ⚠️ breaking——同步更新 `services/tmux/controller/spawn.rs`
4. **修改 tmux wire protocol**（未来）→ ⚠️ breaking——同步更新 `services/tmux/protocol/`
5. **新增 SshTmuxBackend 依赖**（未来）→ 加新 ssh 调用 + 同步 §3 + 更新 `services/tmux/controller/spawn.rs`