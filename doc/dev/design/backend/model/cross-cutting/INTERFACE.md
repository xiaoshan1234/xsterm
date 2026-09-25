# Model · Cross-Cutting — 对外接口

> **位置**：`src-tauri/src/models/cross_cutting/`
> **唯一进口**：`use crate::models::cross_cutting::*;` 或精确 `use crate::models::cross_cutting::types::CapabilityFlags;`

## 1. 对外暴露什么

cross-cutting domain 暴露 4 类符号:

1. **Types**——`CapabilityFlags / SplitDirection / SessionLoggingConfig`(被所有 backend session 用)
2. **Helpers**——`build_remote_image_path() / tmux_probe_quote()`(pure function)
3. **Ids**——(预留)统一 id 分配器 trait
4. **Constants**——(预留)文件大小 / 超时常量

## 2. 核心接口

### 2.1 Types

```rust
use serde::{Deserialize, Serialize};

// ============ Capability flags(backend capability 探测结果)============

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct CapabilityFlags {
    pub supports_paste: bool,
    pub supports_resize: bool,
    pub supports_tmux: bool,
    pub supports_image_upload: bool,
    pub supports_clipboard: bool,
}

impl CapabilityFlags {
    /// local PTY session 的 capability
    pub fn for_local() -> Self {
        Self {
            supports_paste: true,
            supports_resize: true,
            supports_tmux: false,
            supports_image_upload: false,
            supports_clipboard: true,
        }
    }

    /// SSH session 的 capability(支持 SCP 上传图片)
    pub fn for_ssh() -> Self {
        Self {
            supports_paste: true,
            supports_resize: true,
            supports_tmux: false,
            supports_image_upload: true,
            supports_clipboard: true,
        }
    }

    /// tmux -CC pane 的 capability
    pub fn for_tmux() -> Self {
        Self {
            supports_paste: true,
            supports_resize: true,
            supports_tmux: true,
            supports_image_upload: false,
            supports_clipboard: true,
        }
    }

    /// 合并多个 capability flags(union)
    pub fn merge(&self, other: &Self) -> Self {
        Self {
            supports_paste: self.supports_paste || other.supports_paste,
            supports_resize: self.supports_resize || other.supports_resize,
            supports_tmux: self.supports_tmux || other.supports_tmux,
            supports_image_upload: self.supports_image_upload || other.supports_image_upload,
            supports_clipboard: self.supports_clipboard || other.supports_clipboard,
        }
    }
}

// ============ Split direction(被 session / workspace 用)============

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum SplitDirection {
    Horizontal,  // split-window -h(right of parent)
    Vertical,    // split-window -v(below parent)
}

impl SplitDirection {
    /// tmux -CC 命令参数("-h" / "-v")
    pub fn as_tmux_arg(&self) -> &'static str {
        match self {
            Self::Horizontal => "-h",
            Self::Vertical => "-v",
        }
    }
}

// ============ Session logging config ============

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionLoggingConfig {
    #[serde(default)]
    pub enabled: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub log_path: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub max_file_size: Option<u64>,
}

impl Default for SessionLoggingConfig {
    fn default() -> Self {
        Self {
            enabled: false,
            log_path: None,
            max_file_size: None,
        }
    }
}
```

### 2.2 Helpers(pure functions)

```rust
// models/cross_cutting/helpers.rs
use std::time::{SystemTime, UNIX_EPOCH};

/// 在 SSH 服务器上构造图片保存路径
/// 返回类似 "/tmp/xsterm-image-{unix_ms}-{filename}" 的字符串
pub fn build_remote_image_path(filename: &str) -> Result<String, String> {
    let timestamp = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_err(|e| format!("system time error: {e}"))?
        .as_millis();
    Ok(format!("/tmp/xsterm-image-{}-{}", timestamp, filename))
}

/// Shell-quote 单一参数(用于 tmux probe 命令的 remote shell)
/// 保守实现:包在单引号 + escape 内嵌单引号
/// 用途:`run_command_capture_stdout` 把字符串交给 remote shell 拆分
pub fn tmux_probe_quote(s: &str) -> String {
    format!("'{}'", s.replace('\'', "'\\''"))
}

/// (预留) 解析本地命令字符串(quote / escape / env var)
/// 从 v0 services/local_session/resolution.rs 迁入(目标态)
pub fn parse_shell_command(command: &str) -> Vec<String> {
    // stub: 简化实现
    command.split_whitespace().map(String::from).collect()
}
```

### 2.3 Ids(预留)

```rust
// models/cross_cutting/ids.rs(预留, MVP 不用)

use std::sync::atomic::{AtomicU32, Ordering};

/// 通用 id 分配器 trait(预留统一所有 id 类型)
pub trait IdAllocator {
    type Id;
    fn allocate(&self) -> Self::Id;
}

/// u32 id 分配器实现(预留)
pub struct U32IdAllocator {
    next_id: AtomicU32,
}

impl U32IdAllocator {
    pub fn new(start: u32) -> Self {
        Self { next_id: AtomicU32::new(start) }
    }
}

impl IdAllocator for U32IdAllocator {
    type Id = u32;
    fn allocate(&self) -> u32 {
        self.next_id.fetch_add(1, Ordering::Relaxed)
    }
}
```

**MVP 决策**:`SessionIdSource` 保留在 `models/session/types.rs`(它是 session 生命周期的一部分)——未来统一 id 分配时再迁移。

### 2.4 Constants(预留)

```rust
// models/cross_cutting/constants.rs(预留, MVP 不用)

// IPC payload 保护
pub const MAX_WRITE_PAYLOAD_BYTES: usize = 1024 * 1024;  // 1 MiB

// log 文件大小
pub const DEFAULT_MAX_LOG_FILE_SIZE: u64 = 1024 * 1024;  // 1 MiB
pub const DEFAULT_MAX_LOG_FILES: u32 = 5;

// tmux probe / 同步超时
pub const TMUX_PROBE_TIMEOUT_SECS: u64 = 5;
pub const SESSION_OUTPUT_CHANNEL_BUFFER: usize = 4096;

// session output 帧缓冲
pub const SESSION_OUTPUT_FRAME_SIZE: usize = 4096;
pub const SESSION_OUTPUT_FRAME_COUNT: usize = 256;
```

**MVP 决策**:`MAX_WRITE_PAYLOAD_BYTES` 当前定义在 `commands/session.rs:17`(app 层 inline const)——未来抽到本模块。

## 3. 跨 domain 调用接口

cross-cutting 是**最底层**——**不** import 其他 domain。其他 domain 引用本 domain:

```rust
// models/session/types.rs
use crate::models::cross_cutting::types::{CapabilityFlags, SplitDirection, SessionLoggingConfig};

// models/workspace/types.rs(目标态)
use crate::models::cross_cutting::types::SplitDirection;

// models/tmux/accessor.rs
use crate::models::cross_cutting::types::CapabilityFlags;

// services/session/backends/local.rs
use crate::models::cross_cutting::types::CapabilityFlags;  // CapabilityFlags::for_local()

// services/session/backends/tmux_pane.rs
use crate::models::cross_cutting::types::CapabilityFlags;  // CapabilityFlags::for_tmux()

// infrastructure/ssh.rs
use crate::models::cross_cutting::helpers::build_remote_image_path;
```

## 4. 接缝契约

```rust
// services/session/manager.rs
use crate::models::cross_cutting::types::CapabilityFlags;

impl SessionManager {
    pub fn create_local(
        &self,
        config: LocalSessionConfig,
        backend: Arc<dyn AppBackend>,
    ) -> Result<SessionInfo, String> {
        // ...
        let capabilities = CapabilityFlags::for_local();
        // ...
    }
}
```

```rust
// infrastructure/ssh.rs
use crate::models::cross_cutting::helpers::build_remote_image_path;

pub fn upload_image(session: &SshSession, local_path: &str, filename: &str) -> Result<String, String> {
    let remote_path = build_remote_image_path(filename)?;
    upload_file_via_ssh(...)
}
```

**接缝约束**:
- 任何 layer 都可 import `models/cross_cutting::*`
- `models/cross_cutting::*` **不** import 其他 model domain / service / app / infra

## 5. 不对外暴露

- `models/cross_cutting/ids.rs`(预留,MVP 不用)
- `models/cross_cutting/constants.rs`(预留,MVP 不用)
- 内部 std import(如 `std::time::SystemTime`)

## 6. api.rs 变更流程

1. **新增 CapabilityFlags 字段** → 加 `types.rs` 字段 + §2.1 + frontend `model/cross-cutting/types.ts` 同步
2. **新增 helper function** → 加 `helpers.rs` 函数 + §2.2 + 加纯函数测试
3. **新增 SplitDirection 变体** → 加 `types.rs` 变体 + `as_tmux_arg()` 更新 + 检查所有 `match SplitDirection` 调用方
5. **从其他 domain 迁入类型** → 加新 struct + 旧 domain 删 → cargo check 全仓

## 7. 错误传播约定

- helpers 返回 `Result<T, String>`(MVP 简单错误)— 未来可统一为 typed error
- 类型构造器返回 `Self`(无校验)— 简单数据结构
- CapabilityFlags 构造器返回 `Self` —— 内部 bool 字段不需校验

## 8. 测试

每个 helpers 函数都有 `*.test.rs`(纯函数单测):

- `build_remote_image_path()` 输出格式 / timestamp 单调性
- `tmux_probe_quote()` quote 转义 / 单引号嵌套
- `CapabilityFlags::for_*()` 静态 snapshot 测试

**为什么 model 测试最重要**:
- **model 是最底层**——所有 layer 都依赖
- **model 出 bug = 全 app 出 bug**——下游影响范围最大
- **helpers 是纯函数**——测试简单,无需 mock