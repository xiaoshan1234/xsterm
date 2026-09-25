# Infra · Tauri — 对外接口

> **位置**：`src-tauri/src/infrastructure/tauri/`
> **唯一进口**：`use crate::infrastructure::tauri::*;` 或精确 `use crate::infrastructure::tauri::app_backend::AppBackend;`

## 1. 对外暴露什么

tauri 子模块暴露 4 类符号：

1. **`AppBackend` trait** —— Tauri runtime 抽象接口
2. **`RealAppBackend` struct** —— AppBackend 的 Tauri 实现（持有 AppHandle + session_output_channel）
3. **Public functions** —— `encode_binary_frame / decode_binary_frame`
4. **Constants** —— `BINARY_FRAME_MAGIC / BINARY_FRAME_VERSION`
5. **`TauriError` enum** —— thiserror 派生错误

## 2. 核心接口

### 2.1 AppBackend trait

```rust
// infrastructure/tauri/app_backend.rs
use serde_json::Value;

pub trait AppBackend: Send + Sync {
    /// Emit Tauri event(JSON payload)
    fn emit(&self, event: &str, payload: &Value) -> Result<(), String>;

    /// Emit binary payload via Tauri Channel(Vec<u8>)
    fn emit_binary(&self, bytes: Vec<u8>) -> Result<(), String>;

    /// Spawn background thread
    fn spawn(&self, f: Box<dyn FnOnce() + Send>);
}
```

**关键**：

- `Clone` **不**是 super-trait bound——`dyn AppBackend` 必须 object-safe
- 服务想"分享" backend 用 `Arc<dyn AppBackend>` by value + `Arc::clone`

### 2.2 RealAppBackend struct

```rust
#[derive(Clone)]
pub struct RealAppBackend {
    app: Arc<AppHandle>,
    pub session_output_channel: Channel<Vec<u8>>,
}

impl RealAppBackend {
    /// 构造 RealAppBackend（创建 session_output_channel）
    pub(crate) fn new(app: AppHandle) -> Self;

    /// 返回 channel 引用供 `get_session_output_channel` IPC handler 用
    pub fn session_output_channel(&self) -> &Channel<Vec<u8>>;
}

impl AppBackend for RealAppBackend {
    fn emit(&self, event: &str, payload: &Value) -> Result<(), String> { ... }
    fn emit_binary(&self, bytes: Vec<u8>) -> Result<(), String> { ... }
    fn spawn(&self, f: Box<dyn FnOnce() + Send>) {
        std::thread::spawn(f);
    }
}
```

### 2.3 BinaryFrame functions

```rust
// infrastructure/tauri/binary_frame.rs

pub const BINARY_FRAME_MAGIC: u32 = 0xDEAD_BEEF;
pub const BINARY_FRAME_VERSION: u8 = 1;
pub const MAX_SESSION_ID_LEN: usize = 255;
pub const MAX_DATA_LEN: u32 = 16 * 1024 * 1024;  // 16 MiB

/// Encode BinaryFrame wire format
pub fn encode_binary_frame(session_id: &str, data: &[u8]) -> Vec<u8>;

/// Decode BinaryFrame wire format
/// Returns (session_id, data)
pub fn decode_binary_frame(buf: &[u8]) -> Result<(String, Vec<u8>), TauriError>;
```

### 2.4 TauriError enum

```rust
// infrastructure/tauri/errors.rs
use thiserror::Error;

#[derive(Debug, Error)]
pub enum TauriError {
    #[error("invalid binary frame: {0}")]
    InvalidBinaryFrame(String),

    #[error("unsupported binary frame version: {0}")]
    UnsupportedBinaryFrameVersion(u8),

    #[error("session_id too long: {0} bytes (max {max})")]
    SessionIdTooLong { actual: usize, max: usize },

    #[error("data too long: {actual} bytes (max {max})")]
    DataTooLong { actual: usize, max: usize },
}
```

### 2.5 MockAppBackend（自动生成）

```rust
// infrastructure/tauri/mock.rs
#[automock]
impl AppBackend for MockAppBackend {
    fn emit(&self, event: &str, payload: &Value) -> Result<(), String> { ... }
    fn emit_binary(&self, bytes: Vec<u8>) -> Result<(), String> { ... }
    fn spawn(&self, f: Box<dyn FnOnce() + Send>) { ... }
}
```

## 3. 跟 service / app 的接缝

### 3.1 service → infra/tauri

```rust
// services/session/manager.rs
use crate::infrastructure::tauri::AppBackend;

pub struct SessionManager {
    // 持有 Arc<dyn AppBackend>（构造时注入）
    // ...
}

impl SessionManager {
    pub fn create_local(
        &self,
        config: LocalSessionConfig,
        backend: Arc<dyn AppBackend>,  // ← AppBackend trait
    ) -> Result<SessionInfo, String> {
        // ... 启动 PTY + emit 事件
        backend.emit("session-output", &json!({"sessionId": id, "data": data}))?;
        Ok(info)
    }
}
```

### 3.2 services/tmux/bridge → infra/tauri

```rust
// services/tmux/bridge.rs
use crate::infrastructure::tauri::AppBackend;

pub struct TmuxBridge {
    app: Arc<dyn AppBackend>,
}

impl TmuxBridge {
    pub fn emit_pane_added(&self, pane_id: &str, window_id: &str) -> Result<(), String> {
        self.app.emit("tmux-pane-added", &json!({
            "paneId": pane_id,
            "windowId": window_id,
        }))
    }
}
```

### 3.3 app/shell → infra/tauri（启动序列）

```rust
// app/shell/api.rs::initialize
use crate::infrastructure::tauri::{AppBackend, RealAppBackend};

pub fn initialize(app: &mut tauri::App) -> Result<(), String> {
    let real_backend = RealAppBackend::new(app.handle().clone());
    let session_output_channel = real_backend.session_output_channel.clone();
    app.manage(Arc::new(real_backend));

    // emit session-output-channel 给前端
    if let Err(e) = app.emit("session-output-channel", session_output_channel) {
        tracing::error!("Failed to emit session-output channel: {e}");
    }

    Ok(())
}
```

### 3.4 service 测试 → MockAppBackend

```rust
// services/session/manager.rs::tests
use crate::infrastructure::tauri::MockAppBackend;

#[test]
fn create_local_emits_session_event() {
    let mut mock_app = MockAppBackend::new();
    mock_app.expect_emit()
        .withf(|event, _payload| event == "session-output")
        .returning(|_, _| Ok(()));

    let manager = SessionManager::new(Box::new(mock_pty), Arc::new(mock_app));
    // 测试 emit 调用
}
```

## 4. 接缝约束

- service 持有 `Arc<dyn AppBackend>`（不是具体类型）——支持 mock 替换
- service **不** 直接 import `tauri::AppHandle`（通过 trait 间接）
- service 调 `backend.emit(event, payload)` 返回 `Result<(), String>`（简化错误）
- service 通过 `?` 运算符自动转换 `Result<(), String>`

## 5. 不对外暴露

- `RealAppBackend::app` 字段（只在 impl 内使用）
- `Channel<Vec<u8>>` 的构造细节（封装在 `RealAppBackend::new`）
- `BinaryFrame` 的内部 byte buffer 格式（只暴露 encode/decode 函数）

## 6. api.rs 变更流程

1. **新增 AppBackend trait method** → 加 `app_backend.rs` + 更新 mock + 更新 `RealAppBackend` impl + INTERFACE.md §2.1
2. **新增 BinaryFrame 字段** → 加 `binary_frame.rs` + 同步更新前端解析 + INTERFACE.md §2.3
3. **新增 TauriError 变体** → 加 `errors.rs` 变体 + INTERFACE.md §2.4 + 检查所有 `?` 调用方
4. **修改 session_output_channel 行为** → ⚠️ breaking——同步更新前端 listener + INTERFACE.md §2.2
5. **迁移 RealAppBackend 构造** → 加 `services/settings/api.rs::init_real_app_backend` + 在 `app/shell/api.rs::initialize` 调

## 7. 错误传播约定

- infra 层：`Result<T, TauriError>`（typed error，binary frame 编解码）
- infra → service：`Result<(), String>`（AppBackend trait 简化错误）
- service → app：`Result<T, String>`（IPC 序列化）