# Infra · PTY — 职责

> **位置**：`src-tauri/src/infrastructure/pty/`
> **类型**：⭐ 外部资源 — OS PTY 子进程
> **被使用方**：`services/session`、`services/session_log`
> **外部依赖**：`portable-pty` crate

## 1. 这个子模块负责什么

pty 子模块是 backend 与 **OS PTY 子进程**交互的物理适配层——所有 `portable-pty` crate 调用都集中在这里。

承担 4 类职责：

1. **PtySystem trait 定义**——抽象 PTY 子进程创建接口（让 service 层能 mock）
2. **NativePtySystem impl**——基于 `portable-pty` crate 的平台实现
3. **PtyPair struct**——PTY master + slave 持有（master 持有给 service 层，slave 交给子进程）
4. **errors**——`PtyError`（thiserror derive）封装 `portable-pty` 错误 + ioctl 错误

## 2. 这个子模块 **不**负责什么

- **不持有 session 元数据**——session 元数据归 `models/session/types.rs::SessionInfo`
- **不实现 PTY read/write 循环**——read/write 循环归 `services/session/backends/local.rs`
- **不实现 shell command 解析**——command 解析归 `services/session/backends/local.rs::resolution`
- **不处理 session lifecycle**——lifecycle 归 `services/session/manager.rs::SessionManager`
- **不渲染 xterm**——UI 渲染归 frontend

## 3. 子结构

```
infrastructure/pty/
├── mod.rs            re-export 4 文件
├── traits.rs         PtySystem trait 定义
├── native.rs         NativePtySystem impl（基于 portable-pty）
├── pair.rs           PtyPair struct（master + slave）
├── mock.rs           #[automock] 生成的 MockPtySystem
└── errors.rs         PtyError（thiserror derive）
```

**v0 → v1 拆分映射**：v0 的 `infrastructure/pty.rs`（PTY 全部逻辑）单文件 ~150 行 → v1 拆为 5 文件，按 trait / impl / struct / mock / errors 分类。

## 4. 跟 frontend infra 的关系

frontend **没有** `infra/pty` —— frontend 不直接调 PTY（通过 IPC 调 backend 的 `create_local_session` / `write_session` / `resize_pty_session`）。

| backend infra/pty | frontend 等价 |
|---|---|
| `PtySystem::openpty(config)` | ❌（frontend 不可见）|
| `PtyPair::write / read / resize` | ❌（frontend 通过 IPC 间接）|
| `NativePtySystem::default()` | ❌ |

**关键**：backend infra/pty 是**纯 backend 概念**——frontend 完全不感知 PTY。

## 5. 跟其他 backend infra 子模块的关系

| 子模块 | 关系 |
|---|---|
| `infra/ssh` | 平级（同样"外部资源"切分）；不互相依赖 |
| `infra/tmux` | 平级；tmux 通过 `tokio::process` 直接 spawn `tmux -CC` 子进程，不通过 PtySystem |
| `infra/tauri` | 平级；infra/tauri 提供 Tauri runtime 适配（AppHandle / Channel），不与 PtySystem 直接交互 |

**关键约束**：

- pty 子模块**不**依赖其他 infra 子模块（不调 ssh / tmux / tauri）
- pty 子模块**不**依赖 service / app / commands
- pty 子模块**只**依赖 models（pure data）+ portable-pty crate

## 6. 跟 service / app 的关系

| 层 | 怎么用 infra/pty |
|---|---|
| `services/session` | `SessionManager::pty_system: Box<dyn PtySystem>` 字段持有；`create_local` 调用 `pty_system.openpty(config)` |
| `services/session_log` | 不直接调 PtySystem——log message 通过 tracing |
| `app/session` | 不直接调 PtySystem——通过 `services/session::create_local_session` 间接 |

**关键**：service 持有 `Box<dyn PtySystem>`（不是 `NativePtySystem`）——让 mock 可以替换实现。

## 7. 这个子模块的"产品语言"术语

- **PTY** —— pseudo-terminal（伪终端），OS 提供的 IPC 机制，用于与子进程交互
- **master / slave** —— PTY 是双向通道，master 由父进程（xsterm）持有，slave 由子进程持有
- **PtyPair** —— xsterm 持 master + 子进程持 slave 的配对结构
- **PtySystem trait** —— 创建 PtyPair 的抽象接口
- **NativePtySystem** —— PtySystem 的平台实现（macOS / Linux / Windows 都用 portable-pty）
- **TIOCSWINSZ** —— Linux PTY resize ioctl
- **TIOCGPTN / TIOCSPTLCK** —— Linux PTY slave 获取 ioctl

## 8. 关键设计约束

### 8.1 PtySystem trait 必须 Send + Sync（service 多线程持有）

```rust
pub trait PtySystem: Send + Sync {
    fn openpty(&self, config: &PtyConfig) -> Result<PtyPair, PtyError>;
}
```

**关键**：`Send + Sync` 让 `Box<dyn PtySystem>` 能在 `SessionManager`（被多线程持有）中使用。

### 8.2 PtyPair 持有 master + slave(其中 slave 转交给子进程)

```rust
pub struct PtyPair {
    /// master: 由 xsterm 持有（read / write / resize）
    pub master: Box<dyn MasterPty + Send>,
    /// slave: 在 spawn 子进程时转交给子进程（之后不再由 xsterm 持有）
    pub slave: Box<dyn SlavePty + Send>,
}
```

**关键**：`master` 与 `slave` 之间的所有权转移通过 `portable-pty::native_pty_system::Pair` 的 API 完成。

### 8.3 mockall 自动 mock 用于 infra 层（vs service 层手写 fixture）

```rust
// infra/pty/mock.rs
use mockall::automock;

#[automock]
impl PtySystem for MockPtySystem {
    async fn openpty(&self, config: &PtyConfig) -> Result<PtyPair, PtyError> {
        // mockall 自动生成
    }
}
```

**vs service 层**：`services/tmux_session/controller/tests.rs` 用手写 `RecordingBackend`——更可控。两种风格保持。

### 8.4 错误统一用 thiserror derive

```rust
// infra/pty/errors.rs
use thiserror::Error;

#[derive(Debug, Error)]
pub enum PtyError {
    #[error("io error: {0}")]
    Io(#[from] std::io::Error),

    #[error("portable-pty error: {0}")]
    PortablePty(String),

    #[error("pty already closed")]
    AlreadyClosed,

    #[error("resize ioctl failed: {0}")]
    ResizeFailed(String),
}
```

**对比**：`SessionError` / `TmuxError` / `SshError` / `PtyError` 各自的错误变体——infra 层先按外部资源划分错误。service 层可以聚合多个 infra 错误到自己的 typed error。

## 9. v0 → v1 拆分映射

| v0 位置 | v1 位置 | 改动 |
|---|---|---|
| `infrastructure/pty.rs::PtySystem trait` | `infrastructure/pty/traits.rs` | 抽到独立文件 |
| `infrastructure/pty.rs::NativePtySystem` | `infrastructure/pty/native.rs` | 抽到独立文件 |
| `infrastructure/pty.rs::PtyPair` | `infrastructure/pty/pair.rs` | 抽到独立文件 |
| `infrastructure/pty.rs` 内 error inline | `infrastructure/pty/errors.rs::PtyError` | 抽到独立文件 + thiserror derive |
| 无 mock | `infrastructure/pty/mock.rs::MockPtySystem` | 新增 `#[automock]` |

## 10. 强制约束（可机械校验）

```bash
# infra/pty 不依赖 service / app / commands
grep -rn 'use crate::\(services\|app\|commands\)' src-tauri/src/infrastructure/pty/
# 必须为空

# infra/pty 不依赖其他 infra 子模块（平级）
grep -rn 'use crate::infrastructure::\(ssh\|tmux\|tauri\)' src-tauri/src/infrastructure/pty/
# 必须为空

# infra/pty 只能读 models 类型，不调用 model 函数
grep -rn 'use crate::models::' src-tauri/src/infrastructure/pty/ | grep -v '::types\|::accessor\|::helpers'
# 必须为空（只允许读 types / accessor / helpers 的纯数据）

# infra/pty 不持有 tokio::main
grep -rn 'tokio::main' src-tauri/src/infrastructure/pty/
# 必须为空（tokio::main 只在 lib.rs / main.rs）
```

## 11. 跟 v0 的差异

| 维度 | v0 | v1 |
|---|---|---|
| 文件数 | 1 文件 ~150 行 | 5 文件（traits / native / pair / mock / errors） |
| 错误处理 | inline enum | 独立 `PtyError`（thiserror derive） |
| mock | 无 | `#[automock]` 自动 mock |
| Trait 定义与 impl 分离 | ❌ 同文件 | ✅ traits.rs + native.rs 分文件 |
| 与 frontend 镜像 | ❌（frontend 无 PTY） | 文档明确标注 "backend 独有" |

## 12. 测试

每个文件都有 `*.test.rs`：

- `traits.rs` 的 trait 定义编译时由 `#[automock]` 验证
- `native.rs` 的 `NativePtySystem::openpty` 集成测试（依赖真实 platform PTY——macOS / Linux 跑，Windows CI 跳过）
- `pair.rs` 的 `PtyPair::master` / `slave` 所有权测试
- `errors.rs` 的 `PtyError` Display + From 派生测试

**为什么 infra 测试最重要**：

- infra 是 backend 最底层的 I/O 层——上层（service / app）都依赖它
- infra 出 bug = 后端 I/O 全挂——影响所有 session
- mock 正确性 = service 层单测可依赖的关键

## 13. 依赖变更流程

1. **新增 PtySystem trait method** → 加 `traits.rs` + 更新 mock + 更新 native impl + INTERFACE.md §2.1
2. **新增 PtyError 变体** → 加 `errors.rs` 变体 + INTERFACE.md §2.4 + 检查所有 `?` 调用方
3. **修改 portable-pty crate 版本** → Cargo.toml 改 + 跑 `cargo check` + 跑集成测试（真实 PTY）
4. **新增 MasterPty / SlavePty method** → 加 `pair.rs` 方法 + INTERFACE.md §2.2 + 更新 service 调用方

## 14. 安全警告

- **PTY 是 OS 资源**——泄漏的 PtyPair 会持有文件描述符。Rust Drop trait 会自动关闭，但需注意 PtyPair 在 Service 层传递时不要遗忘
- **`std::process::Command` 的 slave 句柄**——必须在 spawn 子进程前转交，否则子进程拿不到 PTY
- **resize ioctl（TIOCSWINSZ）失败**——常见原因是 PTY 已关闭。PtyError::ResizeFailed 应返回明确错误，让 service 层处理