# Infra · Tauri — 职责

> **位置**：`src-tauri/src/infrastructure/tauri/`
> **类型**：⭐ Tauri runtime 适配（AppHandle / Channel / Emitter）
> **被使用方**：`domain/session`（AppBackend 注入）、`commands/shell`（app backend 初始化）、`domain/terminal/bridge.rs`（emit Tauri 事件）
> **外部依赖**：`tauri` crate

## 1. 这个子模块负责什么

tauri 子模块是 backend 与 **Tauri runtime** 交互的物理适配层——所有 Tauri API 调用都集中在这里。

承担 4 类职责：

1. **AppBackend trait 定义**——抽象 Tauri runtime 能力（emit 事件 / emit_binary / spawn task）
2. **RealAppBackend impl**——基于 `tauri::AppHandle` 的实现
3. **BinaryFrame 编解码**——binary `session-output` payload 的 wire 格式（Perf 001）
4. **session_output_channel 管理**——Tauri `Channel<Vec<u8>>` 创建 + 持有

## 2. 这个子模块 **不**负责什么

- **不渲染 UI**——UI 在 frontend `ui/`
- **不持有 session 状态**——session 状态归 `domain/session/state.rs`
- **不监听 Tauri 事件**——前端 → backend 事件通过 `app/<module>::commands::*` 处理
- **不实现命令处理**——Tauri 命令归 `app/<module>/commands/*.rs`
- **不实现持久化**——持久化归 `domain/terminal::attached_tmux`（typed wrapper）+ `commands/shell::log_config`

## 3. 子结构

```
infrastructure/tauri/
├── mod.rs              re-export 4 文件
├── app_backend.rs      ⭐ AppBackend trait + RealAppBackend(Tauri AppHandle wrapper)
├── binary_frame.rs     ⭐ BinaryFrame 编解码(session-output wire format)
├── errors.rs           TauriError(thiserror derive)
└── mock.rs             #[automock] MockAppBackend
```

**拆分映射**：

-  `infrastructure/app_backend.rs` →  `infrastructure/tauri/app_backend.rs`
-  `infrastructure/binary_frame.rs` →  `infrastructure/tauri/binary_frame.rs`
- 无 errors / mock 模块 → 新增

## 4. 跟 frontend infra 的关系

| backend infra/tauri | frontend infra/tauri |
|--|--|
| `AppBackend::emit(event, payload)` | `infra/tauri/commands/*::invoke(cmd)` |
| `AppBackend::emit_binary(bytes)` | `infra/tauri/events/*::listen(event, cb)` |
| `RealAppBackend::new(AppHandle)` | (frontend 无 AppHandle 等价) |
| `BinaryFrame` | (frontend 在 `sessionOutputChannel.ts` 解析 BinaryFrame) |

**关键**：

- backend `infra/tauri` 与 frontend `infra/tauri` 镜像——但职责相反
- **backend 提供** `AppBackend` 抽象 + `emit` 能力——service 通过 trait 间接调 Tauri
- **frontend 提供** `invoke / listen` 包装——通过 IPC 调 backend

## 5. 跟其他 backend infra 子模块的关系

| 子模块 | 关系 |
|--|--|
| `infra/pty` | 平级；不互相依赖 |
| `infra/ssh` | 平级；不互相依赖 |
| `infra/tmux` | 平级；tmux 子模块不调 Tauri（事件推送由 domain/terminal/bridge.rs 间接通过 AppBackend） |

**关键约束**：

- tauri 子模块**不** import pty / ssh / tmux
- tauri 子模块**是 backend 唯一允许直接 import `tauri` 的地方**
- service 层通过 `AppBackend` trait 间接调用

## 6. 跟 service / app 的关系

| 层 | 怎么用 infra/tauri |
|--|--|
| `domain/session` | `create_local` / `create_ssh` / `create_tmux` 都接收 `Arc<dyn AppBackend>` 参数——emit Tauri 事件 |
| `domain/terminal/bridge.rs` | `TmuxBridge::dispatch_event` 调 `AppBackend::emit` 推送 `tmux-pane-added` 等事件 |
| `commands/shell/api.rs::initialize` | 构造 `RealAppBackend::new(app)` + emit `session-output-channel` |
| `commands/session/commands/output.rs::get_session_output_channel` | 返回 `RealAppBackend::session_output_channel` 给前端 |

## 7. 这个子模块的"产品语言"术语

- **AppHandle** —— Tauri 提供的全局 app 句柄
- **AppBackend trait** —— 抽象 Tauri runtime 能力（让 service 可 mock）
- **RealAppBackend** —— AppBackend 的 Tauri 实现
- **session-output-channel** —— Tauri `Channel<Vec<u8>>` 用于推送 binary session output（Perf 001）
- **emit** —— Tauri 事件推送 API（`app.emit("event-name", payload)`）
- **emit_binary** —— Tauri `Channel::send` 推送 binary payload
- **BinaryFrame** —— session-output 的 wire 格式（pane id + data）
- **spawn** —— Tauri 提供的后台任务能力（通过 `std::thread::spawn`）

## 8. 关键设计约束

### 8.1 AppBackend trait 必须支持 Arc<dyn AppBackend>

```rust
// infrastructure/tauri/app_backend.rs
pub trait AppBackend: Send + Sync {
    fn emit(&self, event: &str, payload: &serde_json::Value) -> Result<(), String>;
    fn emit_binary(&self, bytes: Vec<u8>) -> Result<(), String>;
    fn spawn(&self, f: Box<dyn FnOnce() + Send>);
}
```

**关键**：

- `Clone` **不**是 super-trait bound——`dyn AppBackend` 才能 object-safe
- 服务想"分享" backend 给后台 thread——用 `Arc<dyn AppBackend>` by value + `Arc::clone`
- 注释明确警告了这一点（不可改）

### 8.2 RealAppBackend 持有 session_output_channel

```rust
#[derive(Clone)]
pub struct RealAppBackend {
    app: Arc<AppHandle>,
    pub session_output_channel: Channel<Vec<u8>>,
}

impl RealAppBackend {
    pub(crate) fn new(app: AppHandle) -> Self {
        let channel = Channel::<Vec<u8>>::new(|_payload| Ok(()));  // no-op handler
        Self {
            app: Arc::new(app),
            session_output_channel: channel,
        }
    }
}

impl AppBackend for RealAppBackend {
    fn emit(&self, event: &str, payload: &serde_json::Value) -> Result<(), String> {
        self.app.emit(event, payload.clone()).map_err_string()
    }

    fn emit_binary(&self, bytes: Vec<u8>) -> Result<(), String> {
        self.session_output_channel.send(bytes).map_err_string()
    }

    fn spawn(&self, f: Box<dyn FnOnce() + Send>) {
        std::thread::spawn(f);
    }
}
```

### 8.3 BinaryFrame wire format

```rust
// infrastructure/tauri/binary_frame.rs

/// BinaryFrame wire format:
/// [magic: u32 = 0xDEADBEEF] [version: u8 = 1] [session_id_len: u8] [session_id: bytes] [data_len: u32] [data: bytes]

pub const BINARY_FRAME_MAGIC: u32 = 0xDEAD_BEEF;
pub const BINARY_FRAME_VERSION: u8 = 1;

pub fn encode_binary_frame(session_id: &str, data: &[u8]) -> Vec<u8> {
    let mut buf = Vec::new();
    buf.extend_from_slice(&BINARY_FRAME_MAGIC.to_le_bytes());
    buf.push(BINARY_FRAME_VERSION);
    let session_id_bytes = session_id.as_bytes();
    buf.push(session_id_bytes.len() as u8);
    buf.extend_from_slice(session_id_bytes);
    buf.extend_from_slice(&(data.len() as u32).to_le_bytes());
    buf.extend_from_slice(data);
    buf
}

pub fn decode_binary_frame(buf: &[u8]) -> Result<(String, Vec<u8>), TauriError> {
    if buf.len() < 8 {
        return Err(TauriError::InvalidBinaryFrame("frame too short".into()));
    }
    let magic = u32::from_le_bytes([buf[0], buf[1], buf[2], buf[3]]);
    if magic != BINARY_FRAME_MAGIC {
        return Err(TauriError::InvalidBinaryFrame(format!("bad magic: 0x{:X}", magic)));
    }
    let version = buf[4];
    if version != BINARY_FRAME_VERSION {
        return Err(TauriError::UnsupportedBinaryFrameVersion(version));
    }
    let session_id_len = buf[5] as usize;
    // ... 解析剩余 bytes
    Ok((session_id, data))
}
```

### 8.4 mockall 自动 mock

```rust
// infrastructure/tauri/mock.rs
#[automock]
impl AppBackend for MockAppBackend {
    fn emit(&self, event: &str, payload: &serde_json::Value) -> Result<(), String> { ... }
    fn emit_binary(&self, bytes: Vec<u8>) -> Result<(), String> { ... }
    fn spawn(&self, f: Box<dyn FnOnce() + Send>) { ... }
}
```

### 8.5 错误统一用 thiserror derive

```rust
// infrastructure/tauri/errors.rs
use thiserror::Error;

#[derive(Debug, Error)]
pub enum TauriError {
    #[error("invalid binary frame: {0}")]
    InvalidBinaryFrame(String),

    #[error("unsupported binary frame version: {0}")]
    UnsupportedBinaryFrameVersion(u8),

    #[error("session_id too long in binary frame: {0} bytes (max 255)")]
    SessionIdTooLong(usize),

    #[error("data too long in binary frame: {0} bytes (max {max})")]
    DataTooLong { actual: usize, max: usize },
}
```

## 10. 强制约束（可机械校验）

```bash
# infra/tauri 是 backend 唯一允许直接 import tauri 的地方
grep -rn 'use tauri::' src-tauri/src/ | grep -v 'src-tauri/src/infrastructure/tauri/' | grep -v 'src-tauri/src/lib.rs' | grep -v 'src-tauri/src/main.rs' | grep -v 'src-tauri/src/commands/' | grep -v 'src-tauri/src/app/'
# 必须为空（lib.rs / main.rs / commands / app 是 Tauri command 层,允许用 tauri）

# infra/tauri 不依赖 service / app / commands
grep -rn 'use crate::\(services\|app\|commands\)' src-tauri/src/infrastructure/tauri/
# 必须为空

# infra/tauri 不依赖其他 infra 子模块（平级）
grep -rn 'use crate::infrastructure::\(pty\|ssh\|tmux\)' src-tauri/src/infrastructure/tauri/
# 必须为空
```

## 12. 测试

每个文件都有 `*.test.rs`：

- `app_backend.rs` 的 `AppBackend` trait 定义编译时由 `#[automock]` 验证
- `app_backend.rs::RealAppBackend::emit` 集成测试（需要真实 Tauri AppHandle——标记 `#[ignore]`）
- `binary_frame.rs` 的 `encode_binary_frame / decode_binary_frame` round-trip 测试
- `mock.rs` 的 `MockAppBackend::emit` 单测
- `errors.rs` 的 `TauriError` Display + From 派生测试

## 13. 依赖变更流程

1. **新增 AppBackend trait method** → 加 `app_backend.rs` + 更新 mock + 更新 `RealAppBackend` impl + INTERFACE.md §2.1
2. **新增 BinaryFrame 字段** → 加 `binary_frame.rs` + 同步更新前端解析（`sessionOutputChannel.ts`）+ INTERFACE.md §2.3
3. **新增 TauriError 变体** → 加 `errors.rs` 变体 + INTERFACE.md §2.5 + 检查所有 `?` 调用方
4. **修改 session_output_channel 行为** → ⚠️ breaking——同步更新前端 listener + INTERFACE.md §2.2
5. **迁移 RealAppBackend 构造** → 加 `commands/shell/api.rs::initialize` 内部构造 RealAppBackend（不通过 persistence layer）