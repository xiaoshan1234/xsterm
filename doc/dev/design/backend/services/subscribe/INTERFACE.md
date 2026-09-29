# Services · Subscribe — 对外接口

> **位置**：`src-tauri/src/services/subscribe/`
> **唯一入口**：`use crate::services::subscribe::{OutputRing, SubscribeRegistry, RingEntry}`
> **被使用方**：`services/session_manager` (创建 / 清理) + `services/{local,ssh,tmux}_session::read_loop` (push) + `mcp_server::tools::subscribe_output` (subscribe) + `services/capture` (tail fallback)

## 1. 公开类型

```rust
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RingEntry {
    pub seq: u64,
    pub data: Vec<u8>,
    pub timestamp_ms: u64,
}

pub struct OutputRing {
    inner: Mutex<RingInner>,
    next_seq: AtomicU64,
    subscribers: RwLock<Vec<Subscriber>>,
}

pub struct SubscribeRegistry {
    inner: DashMap<u32, Arc<OutputRing>>,
}

#[derive(Debug, thiserror::Error)]
pub enum SubscribeError {
    #[error("max subscribers ({0}) reached for session")]
    MaxSubscribersReached(usize),
    #[error("subscription not found")]
    SubscriptionNotFound,
    #[error("session {0} not found")]
    SessionNotFound(u32),
    #[error("internal: {0}")]
    Internal(String),
}
```

## 2. OutputRing 公开方法

```rust
impl OutputRing {
    pub fn new() -> Self;                                    // 默认 10000 行
    pub fn with_capacity(cap: usize) -> Self;
    pub async fn push(&self, data: Vec<u8>) -> u64;          // 由 read_loop 调
    pub async fn since(&self, since_seq: Option<u64>) -> Vec<RingEntry>;  // 增量读
    pub async fn tail(&self, n: usize) -> Vec<RingEntry>;    // 最近 N 行
    pub async fn overflowed(&self) -> bool;
    pub async fn subscribe(
        self: &Arc<Self>,
        client_id: String,
        since_seq: Option<u64>,
    ) -> mpsc::Receiver<RingEntry>;
    pub async fn unsubscribe(&self, client_id: &str) -> Result<(), SubscribeError>;
    pub async fn count_subscribers(&self) -> usize;
}
```

## 3. SubscribeRegistry 公开方法

```rust
impl SubscribeRegistry {
    pub fn new() -> Self;
    pub fn get_or_create(&self, session_id: u32) -> Arc<OutputRing>;
    pub fn get(&self, session_id: u32) -> Option<Arc<OutputRing>>;
    pub fn remove(&self, session_id: u32) -> Option<Arc<OutputRing>>;
    pub fn list(&self) -> Vec<(u32, Arc<OutputRing>)>;
}
```

## 4. 接缝契约

### 4.1 read_loop 注入

```rust
// services/local_session/bytes.rs
pub async fn read_loop(
    session_id: u32,
    reader: Box<dyn AsyncRead + Send + Unpin>,
    backend: Arc<dyn AppBackend>,
    ring: Arc<OutputRing>,  // ⭐ 新增参数
) {
    let mut buf = vec![0u8; 4096];
    loop {
        match reader.read(&mut buf).await {
            Ok(0) => break,
            Ok(n) => {
                let bytes = &buf[..n];
                backend.emit_binary(encode_session_output_frame(session_id, bytes))?;
                ring.push(bytes.to_vec()).await;  // ⭐ push to OutputRing
            }
            Err(_) => break,
        }
    }
}
```

### 4.2 SessionManager.create_local 注入

```rust
let ring = self.subscribe_registry.get_or_create(session_id);
services::local_session::create(&config, ring, ...)?;
```

### 4.3 SessionManager.close 清理

```rust
self.subscribe_registry.remove(session_id);
```

## 5. 错误码映射

| SubscribeError | McpError / IPC 错误 |
|---|---|
| `MaxSubscribersReached(_)` | `MaxSubscribersReached` (-32015) |
| `SubscriptionNotFound` | `SubscriptionNotFound` (-32016) |
| `SessionNotFound(_)` | `SessionNotFound` (-32001) |
| `Internal(_)` | `Internal` (-32603) |

## 6. 不对外暴露

- `RingInner` 内部 struct
- `Subscriber` 内部 struct（含 sender + since_seq）
- sweep task handle

## 7. 变更流程

1. **新增 RingEntry 字段** → 更新 struct + INTERFACE.md §1 + 测试
2. **新增 SubscribeError variant** → 更新 enum + McpError 映射 + INTERFACE.md §1
3. **修改 OutputRing API** → 同步 INTERFACE.md + 测试

## 8. 性能

| 操作 | 预算 |
|---|---|
| `push(bytes)` | < 0.5ms / 4KB |
| `since(seq)` | < 5ms / 10000 行 |
| `tail(n)` | < 5ms / 10000 行 |
| `subscribe()` | < 1ms (channel 创建) |
| `unsubscribe(client_id)` | < 0.5ms |

## 9. 文档

- [`README.md`](README.md) — 职责
- [`INTERFACE.md`](INTERFACE.md) — 本文档
- [`DOWNSTREAM.md`](DOWNSTREAM.md) — 依赖图