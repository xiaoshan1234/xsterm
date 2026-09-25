# Infra · PTY — 对外接口

> **位置**：`src-tauri/src/infrastructure/pty/`
> **唯一进口**：`use crate::infrastructure::pty::*;` 或精确 `use crate::infrastructure::pty::traits::PtySystem;`

## 1. 对外暴露什么

pty 子模块暴露 4 类符号：

1. **`PtySystem` trait** —— 创建 PtyPair 的抽象接口（mockable）
2. **`PtyPair` struct** —— master + slave 持有
3. **`PtyError` enum** —— thiserror 派生错误
4. **Mock + impl** —— `MockPtySystem`（`#[automock]`）+ `NativePtySystem`（portable-pty 平台实现）

## 2. 核心接口

### 2.1 PtySystem trait

```rust
// infrastructure/pty/traits.rs
use std::io::{Read, Write};

pub trait PtySystem: Send + Sync {
    /// 创建一个新的 PTY 对(master 给父进程 + slave 给子进程)
    fn openpty(&self, config: &PtyConfig) -> Result<PtyPair, PtyError>;
}

/// PTY 创建配置
pub struct PtyConfig {
    pub cols: u16,
    pub rows: u16,
    pub term: String,            // "xterm-256color" 等
}
```

**关键**：

- `Send + Sync` 让 `Box<dyn PtySystem>` 在多线程 service 中使用
- `PtyConfig` 是 plain struct（可 Clone / Debug）——纯配置数据

### 2.2 PtyPair struct

```rust
// infrastructure/pty/pair.rs
use std::io::{Read, Write};

/// PTY master / slave 配对
///
/// `master` 由 xsterm 持有（read / write / resize）;
/// `slave` 在 spawn 子进程时转交给子进程（之后不再由 xsterm 持有）
pub struct PtyPair {
    pub master: Box<dyn MasterPty + Send>,
    pub slave: Box<dyn SlavePty + Send>,
}

/// MasterPty trait — xsterm 端的 master 句柄
pub trait MasterPty: Read + Write + Send {
    /// 通知子进程 terminal size 变化（TIOCSWINSZ ioctl）
    fn resize(&self, rows: u16, cols: u16) -> Result<(), PtyError>;

    /// 通知子进程 terminal size 变化（带 PID，用于精细控制）
    fn resize_with_pid(&self, rows: u16, cols: u16, pid: u32) -> Result<(), PtyError>;
}

/// SlavePty trait — 子进程端的 slave 句柄
pub trait SlavePty: Read + Write + Send {}
```

**关键**：

- `MasterPty` 实现 `Read + Write` 让 service 层直接读写 PTY
- `SlavePty` 实现 `Read + Write` 但通常不暴露（转交给子进程）
- `resize()` 通过 `TIOCSWINSZ` ioctl（Linux）/ `SetConsoleScreenBufferSize`（Windows）实现

### 2.3 PtyError enum

```rust
// infrastructure/pty/errors.rs
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

    #[error("invalid terminal size: rows {rows} cols {cols}")]
    InvalidSize { rows: u16, cols: u16 },
}

impl From<PtyError> for String {
    fn from(e: PtyError) -> Self { e.to_string() }
}
```

### 2.4 NativePtySystem impl

```rust
// infrastructure/pty/native.rs
use portable_pty::{native_pty_system, CommandBuilder, PtySize};

pub struct NativePtySystem {
    inner: portable_pty::NativePtySystem,
}

impl NativePtySystem {
    pub fn new() -> Self {
        Self { inner: native_pty_system() }
    }
}

impl PtySystem for NativePtySystem {
    fn openpty(&self, config: &PtyConfig) -> Result<PtyPair, PtyError> {
        let pair = self.inner.openpty(PtySize {
            rows: config.rows,
            cols: config.cols,
            pixel_width: 0,
            pixel_height: 0,
        }).map_err(|e| PtyError::PortablePty(e.to_string()))?;

        Ok(PtyPair {
            master: Box::new(NativeMasterPty { inner: pair.master }),
            slave: Box::new(NativeSlavePty { inner: pair.slave }),
        })
    }
}
```

### 2.5 MockPtySystem（自动生成）

```rust
// infrastructure/pty/mock.rs
use mockall::automock;

#[automock]
impl PtySystem for MockPtySystem {
    fn openpty(&self, config: &PtyConfig) -> Result<PtyPair, PtyError> {
        // mockall 自动生成 mock 实现
        // 测试代码可通过 .expect_openpty(...) 配置 mock 行为
    }
}
```

## 3. 跟 service / app 的接缝

### 3.1 service → infra/pty

```rust
// services/session/manager.rs
use crate::infrastructure::pty::{PtySystem, PtyConfig, NativePtySystem};

pub struct SessionManager {
    pty_system: Box<dyn PtySystem>,
    // ...
}

impl SessionManager {
    pub fn new() -> Self {
        Self {
            pty_system: Box::new(NativePtySystem::new()),
            // ...
        }
    }
}
```

### 3.2 service 测试 → MockPtySystem

```rust
// services/session/manager.rs::tests
use crate::infrastructure::pty::MockPtySystem;

#[test]
fn create_local_pty_session() {
    let mut mock_pty = MockPtySystem::new();
    mock_pty.expect_openpty()
        .returning(|_config| Ok(/* mock PtyPair */));

    let manager = SessionManager::with_pty_system(Box::new(mock_pty));
    // 测试 SessionManager::create_local 流程
}
```

## 4. 接缝约束

- service 持有 `Box<dyn PtySystem>`（不是具体类型）——支持 mock 替换
- service 不直接 import `portable_pty`——通过 `PtySystem` trait 间接
- service 调 `pty_system.openpty(config)` 返回 `Result<PtyPair, PtyError>`（typed error）
- service 通过 `?` 运算符 + `From<PtyError> for String` 自动转换为 IPC 错误

## 5. 不对外暴露

- `NativePtySystem::inner`（portable_pty 内部类型）
- `MasterPty` / `SlavePty` 的具体实现（只在 service 层使用）
- `PtyConfig` 的 setter（应该通过构造器传入）

## 6. api.rs 变更流程

1. **新增 PtySystem trait method** → 加 `traits.rs` + 更新 `native.rs` impl + 更新 mock + INTERFACE.md §2.1
2. **新增 PtyError 变体** → 加 `errors.rs` 变体 + INTERFACE.md §2.3 + 检查所有 `?` 调用方
3. **修改 portable-pty API** → 升级 Cargo.toml + 更新 `native.rs` 调用 + 跑 `cargo check`
4. **新增 MasterPty / SlavePty method** → 加 `pair.rs` 方法 + INTERFACE.md §2.2 + 更新 service 调用方

## 7. 错误传播约定

- infra 层：`Result<T, PtyError>`（typed error）
- infra → service：`Result<T, String>`（通过 `From<PtyError> for String` 自动转换）
- service → app：`Result<T, String>`（IPC 序列化）

未来可统一为 `AppError`（顶层 error.rs）—— 但 MVP 保持 `Result<T, String>`。