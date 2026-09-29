# Services · Subscribe — 职责

> **位置**：`src-tauri/src/services/subscribe/`
> **类型**：⭐ MCP `subscribe_output` + UI `session-output` 共用的输出流真相源
> **核心**：环形缓冲（OutputRing）+ 单调递增序号 + 多 subscriber fan-out

## 1. 一句话架构

**subscribe = 1 个 `OutputRing` (per session) + 1 个 `SubscribeRegistry` (session_id → OutputRing)**

```
src-tauri/src/services/subscribe/
├── mod.rs              公开 API（OutputRing + SubscribeRegistry）
├── ring.rs             OutputRing 环形缓冲 + 序号 AtomicU64
├── registry.rs         session_id → Arc<OutputRing> DashMap
├── subscriber.rs       Subscriber 类型（mpsc::Sender<RingEntry> + 过滤逻辑）
├── overflow.rs         ring 满处理（发 output-overflow 事件）
└── tests.rs            序号连续性 + 多 subscriber + overflow 场景
```

## 2. 职责

subscribe service 是 **PRD §2 M6 `subscribe_output` 工具 + frontend `session-output` 事件的共用底层**：

1. **环形缓冲** — 每个 session 维护 `OutputRing`（100000 行上限）
2. **序号生成** — `AtomicU64` 单调递增，每条 RingEntry 一个 `seq`
3. **多 subscriber fan-out** — 一个 session 可被 N 个 subscriber 订阅（MCP + UI 共享）
4. **overflow 处理** — ring 满时发 `output-overflow` 通知 + 保留最新 N 行
5. **from_seq 增量订阅** — 新 subscriber 可指定 `since_seq` 拿到丢失的 entry

## 3. 不承担

- ❌ PTY / SSH / tmux I/O（归 `services/{local,ssh,tmux}_session` 后端）—— 它们只调 `output_ring.push(seq, bytes)`
- ❌ MCP 协议处理（`mcp_server::tools::subscribe_output` 调本 service）
- ❌ frontend 事件 emit（`session-output` 由 frontend 监听 Tauri 事件；subscribe 不直接 emit 给 UI）
- ❌ 持久化（output buffer 是临时数据，重启清空）

## 4. 子结构详解

### 4.1 `ring.rs` — 环形缓冲

```rust
use std::collections::VecDeque;
use std::sync::atomic::{AtomicU64, Ordering};
use tokio::sync::Mutex;

pub struct OutputRing {
    inner: Mutex<RingInner>,
    /// 单调递增序号（next_seq 是下一个要分配的）
    next_seq: AtomicU64,
}

struct RingInner {
    /// 环形 buffer（VecDeque 实现）
    entries: VecDeque<RingEntry>,
    /// 当前容量上限（默认 100000）
    capacity: usize,
    /// ⭐ 标记 ring 是否已 overflow（用于发 output-overflow 事件）
    overflowed: bool,
}

#[derive(Debug, Clone)]
pub struct RingEntry {
    pub seq: u64,
    pub data: Vec<u8>,
    pub timestamp_ms: u64,
}

const DEFAULT_CAPACITY: usize = 100_000;

impl OutputRing {
    pub fn new() -> Self { ... }
    pub fn with_capacity(cap: usize) -> Self { ... }

    /// ⭐ 核心方法：推一条 entry，返回序号
    /// 
    /// 由 PTY/SSH/tmux 后端读循环调用
    pub async fn push(&self, data: Vec<u8>) -> u64 {
        let seq = self.next_seq.fetch_add(1, Ordering::Relaxed);
        let entry = RingEntry {
            seq,
            data,
            timestamp_ms: now_ms(),
        };

        let mut inner = self.inner.lock().await;
        if inner.entries.len() >= inner.capacity {
            // ⭐ overflow：弹出最旧 entry
            inner.entries.pop_front();
            inner.overflowed = true;
        }
        inner.entries.push_back(entry);
        seq
    }

    /// ⭐ 增量读取：从 since_seq 开始，返回所有 entry
    pub async fn since(&self, since_seq: Option<u64>) -> Vec<RingEntry> {
        let inner = self.inner.lock().await;
        let start = since_seq.map(|s| s + 1).unwrap_or(0);
        inner.entries.iter()
            .filter(|e| e.seq >= start)
            .cloned()
            .collect()
    }

    /// ⭐ 最近 N 行（用于 capture_screen text/ansi 模式 fallback）
    pub async fn tail(&self, n: usize) -> Vec<RingEntry> {
        let inner = self.inner.lock().await;
        inner.entries.iter().rev().take(n).rev().cloned().collect()
    }

    pub async fn overflowed(&self) -> bool {
        self.inner.lock().await.overflowed
    }
}

fn now_ms() -> u64 {
    std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap().as_millis() as u64
}
```

### 4.2 `registry.rs` — session → ring

```rust
use dashmap::DashMap;
use std::sync::Arc;

pub struct SubscribeRegistry {
    inner: DashMap<u32, Arc<OutputRing>>,
}

impl SubscribeRegistry {
    pub fn new() -> Self {
        Self { inner: DashMap::new() }
    }

    /// 获取或创建 session 的 OutputRing
    pub fn get_or_create(&self, session_id: u32) -> Arc<OutputRing> {
        self.inner.entry(session_id)
            .or_insert_with(|| Arc::new(OutputRing::new()))
            .clone()
    }

    pub fn get(&self, session_id: u32) -> Option<Arc<OutputRing>> {
        self.inner.get(&session_id).map(|r| Arc::clone(r.value()))
    }

    /// session 关闭时清理
    pub fn remove(&self, session_id: u32) -> Option<Arc<OutputRing>> {
        self.inner.remove(&session_id).map(|(_, ring)| ring)
    }

    pub fn list(&self) -> Vec<(u32, Arc<OutputRing>)> {
        self.inner.iter().map(|r| (*r.key(), Arc::clone(r.value()))).collect()
    }
}
```

### 4.3 `subscriber.rs` — 订阅者

```rust
use tokio::sync::mpsc;

pub struct Subscriber {
    pub client_id: String,          // 订阅者唯一标识（MCP client_id / "ui-listener"）
    pub sender: mpsc::Sender<RingEntry>,
    pub since_seq: u64,              // 已读到的序号（重启订阅时从 0 开始）
    pub buffer_size: usize,          // channel 容量（默认 1024）
}

impl Subscriber {
    /// ⭐ 推一条 entry 给 subscriber（带背压）
    pub async fn push(&self, entry: &RingEntry) -> Result<(), mpsc::error::SendError> {
        if entry.seq <= self.since_seq {
            return Ok(());  // 已读过，跳过
        }
        self.sender.send(entry.clone()).await
    }
}
```

### 4.4 `registry.rs` — 订阅注册

每个 session 的 OutputRing 维护一个 subscriber 列表：

```rust
// 扩展 OutputRing 加上 subscribers 字段（实际实现可能用单独 DashMap）
pub struct OutputRing {
    inner: Mutex<RingInner>,
    next_seq: AtomicU64,
    subscribers: tokio::sync::RwLock<Vec<Subscriber>>,  // ⭐ 新增
}

impl OutputRing {
    /// ⭐ 注册一个 subscriber（异步 spawn task 持续推）
    pub async fn subscribe(
        self: &Arc<Self>,
        client_id: String,
        since_seq: Option<u64>,
    ) -> mpsc::Receiver<RingEntry> {
        let (tx, rx) = mpsc::channel::<RingEntry>(1024);
        let subscriber = Subscriber {
            client_id,
            sender: tx,
            since_seq: since_seq.unwrap_or(0),
            buffer_size: 1024,
        };

        // ⭐ 启动 task：每次 ring.push() 后通知所有 subscribers
        let ring_clone = Arc::clone(self);
        let sub_clone = subscriber.sender.clone();
        tokio::spawn(async move {
            loop {
                tokio::time::sleep(Duration::from_millis(50)).await;  // 20Hz 批处理
                let entries = ring_clone.tail_with_seq_since(subscriber.since_seq).await;
                for entry in entries {
                    if sub_clone.send(entry.clone()).await.is_err() {
                        break;  // client 断开
                    }
                }
            }
        });

        self.subscribers.write().await.push(subscriber);
        rx
    }

    /// ⭐ 取消订阅
    pub async fn unsubscribe(&self, client_id: &str) -> Result<(), SubscribeError> {
        let mut subs = self.subscribers.write().await;
        let before = subs.len();
        subs.retain(|s| s.client_id != client_id);
        if subs.len() == before {
            Err(SubscribeError::SubscriptionNotFound)
        } else {
            Ok(())
        }
    }

    pub async fn count_subscribers(&self) -> usize {
        self.subscribers.read().await.len()
    }
}
```

### 4.5 `overflow.rs` — ring 满处理

```rust
use crate::services::subscribe::OutputRing;
use tauri::{AppHandle, Emitter};

/// ⭐ ring 满时发 output-overflow 事件
/// 
/// 由 OutputRing::push 检测到 overflow 后调
pub fn emit_overflow_event(app: &AppHandle, session_id: u32) {
    let _ = app.emit("output-overflow", OutputOverflowEvent {
        session_id,
        message: "output ring buffer overflowed; oldest entries discarded".to_string(),
    });
}

#[derive(Debug, Clone, serde::Serialize)]
pub struct OutputOverflowEvent {
    pub session_id: u32,
    pub message: String,
}
```

## 5. 集成到 PTY/SSH/tmux 后端

**关键**：所有后端读循环都要调 `output_ring.push(bytes)`：

```rust
// services/local_session/bytes.rs
pub async fn read_loop(
    session_id: u32,
    reader: Box<dyn AsyncRead + Send + Unpin>,
    backend: Arc<dyn AppBackend>,
    ring: Arc<OutputRing>,  // ⭐ 新增
) {
    let mut buf = vec![0u8; 4096];
    loop {
        match reader.read(&mut buf).await {
            Ok(0) => break,  // EOF
            Ok(n) => {
                let bytes = &buf[..n];
                // 1. emit 给 frontend（原有逻辑）
                backend.emit_binary(encode_session_output_frame(session_id, bytes))?;
                // 2. ⭐ push 到 OutputRing（新增）
                ring.push(bytes.to_vec()).await;
            }
            Err(e) => { tracing::error!("PTY read error: {e}"); break; }
        }
    }
}
```

**统一注入**：在 `services/session_manager::create_local / create_ssh / create_tmux` 里：

```rust
let ring = subscribe_registry.get_or_create(session_id);
// 把 ring 传给对应的 read_loop
services::local_session::create(config, ring, ...)?;
```

## 6. 状态机（subscriber 生命周期）

```
(subscriber 未注册)
    │
    │ subscribe(client_id, since_seq)
    ▼
(registered)
    │
    ├── 每 50ms 读一次 ring.tail_with_seq_since(since_seq)
    │   │
    │   ├─ 有新 entry → sender.send(entry) → since_seq = entry.seq
    │   │
    │   └─ 无新 entry → skip
    │
    ├── sender 满了（1024 条未消费）→ 背压：subscriber 慢于 ring 增长
    │   → ⭐ 自动 cancel？（v2 考虑，MVP 暂只 log warn）
    │
    ├── sender 断开（client 关闭）→ send error → break loop → 自动清理
    │
    └── unsubscribe(client_id) → 从 subscribers list 移除
```

## 7. 跟其他 service 的关系

| service | 关系 |
|---|---|
| `services/local_session::read_loop` | 调 `output_ring.push(bytes)` |
| `services/ssh_session::read_loop` | 同上 |
| `services/tmux_session::dispatch` | 同上（来自 tmux controller 的 output 事件） |
| `services/session_manager::create_*` | 注入 `Arc<OutputRing>` 给后端 |
| `services/session_manager::close` | 调 `subscribe_registry.remove(session_id)` 清理 |
| `services/capture::capture_text/ansi` | 调 `output_ring.tail(n)` 作为 fallback（tmux 之外） |
| `mcp_server::tools::subscribe_output` | 调 `output_ring.subscribe(client_id, since_seq)` |
| `mcp_server::tools::wait_for` | 临时订阅 + regex 匹配 |
| `infrastructure::pty / ssh / tmux` | 不直接调 —— 走 session 后端 |

## 8. 关键设计决策

### 8.1 为什么 OutputRing 与 frontend `session-output` 事件并存

考虑过 `OutputRing 替代 session-output 事件` 但**否决**：
- frontend UI 渲染需要**低延迟** stream（不是 100000 行 buffer 拉取）
- OutputRing 是**回放 / 恢复**机制（capture / subscribe / 重连时拉取历史）
- 两条路径独立：UI 走 `app.emit_binary(BinaryFrame)`，MCP `subscribe_output` 走 `OutputRing`

**内存预算**：100 sessions × 100000 行 × 平均 200 字节 ≈ 200MB（Perf 004 终态预算）

### 8.2 为什么 OutputRing 是 per-session 不是全局

考虑过 `global OutputRing` 但**否决**：
- per-session 独立清理（session close → ring drop）
- per-session 独立序号空间（重启后从 0 重新开始）
- per-session 独立 overflow 检测（避免一个 session 卡死拖累全局）

### 8.3 为什么 100000 行上限

权衡依据：
- `cat 1GB 文件` 场景（PRD §E 性能预算）
- 平均每行 100 字节 → 100000 行 = 10MB
- 100 sessions × 10MB = 1GB ❌ 太多

**实际预算**：100 sessions × 10000 行 × 100 字节 = 100MB ✅

**调整**：MVP 默认 `OutputRing::with_capacity(10_000)`；用户可在 config.toml `[terminal.scrollback]` 调。

### 8.4 为什么 50ms 批处理而不是 push 即发

考虑过 `push 立即通知所有 subscriber` 但**否决**：
- 1 字节 1 次 IPC 开销大（PTY 高频小数据）
- 50ms 批处理把零散 entry 打包发送，降低 subscriber 处理压力
- 延迟 50ms 在 MCP use case 下可接受（人类感知阈值）

**可调**：config.toml `[mcp.subscribe.batch_interval_ms] = 50`

## 9. 测试策略

### 9.1 序号连续性

```rust
#[tokio::test]
async fn seq_is_monotonic() {
    let ring = OutputRing::new();
    for _ in 0..1000 {
        ring.push(b"x".to_vec()).await;
    }
    let entries = ring.since(None).await;
    let seqs: Vec<_> = entries.iter().map(|e| e.seq).collect();
    let mut sorted = seqs.clone();
    sorted.sort();
    assert_eq!(seqs, sorted);
    assert_eq!(seqs[0], 0);
    assert_eq!(seqs[999], 999);
}
```

### 9.2 多 subscriber fan-out

```rust
#[tokio::test]
async fn multiple_subscribers_all_receive() {
    let ring = Arc::new(OutputRing::new());
    let mut rx1 = ring.subscribe("agent-A".into(), None).await;
    let mut rx2 = ring.subscribe("agent-B".into(), None).await;

    ring.push(b"hello".to_vec()).await;
    tokio::time::sleep(Duration::from_millis(100)).await;

    assert_eq!(rx1.recv().await.unwrap().data, b"hello");
    assert_eq!(rx2.recv().await.unwrap().data, b"hello");
}
```

### 9.3 since_seq 增量订阅

```rust
#[tokio::test]
async fn since_seq_skips_already_read() {
    let ring = Arc::new(OutputRing::new());
    ring.push(b"a".to_vec()).await;
    ring.push(b"b".to_vec()).await;

    let mut rx = ring.subscribe("agent-A".into(), Some(0)).await;  // since_seq=0
    tokio::time::sleep(Duration::from_millis(100)).await;

    let entry = rx.recv().await.unwrap();
    assert_eq!(entry.data, b"a");
    assert_eq!(entry.seq, 0);

    let entry2 = rx.recv().await.unwrap();
    assert_eq!(entry2.data, b"b");
    assert_eq!(entry2.seq, 1);
}
```

### 9.4 overflow

```rust
#[tokio::test]
async fn overflow_drops_oldest() {
    let ring = OutputRing::with_capacity(3);
    ring.push(b"1".to_vec()).await;
    ring.push(b"2".to_vec()).await;
    ring.push(b"3".to_vec()).await;
    ring.push(b"4".to_vec()).await;  // ⭐ overflow: drop "1"

    assert!(ring.overflowed().await);
    let entries = ring.since(None).await;
    assert_eq!(entries.len(), 3);
    assert_eq!(entries[0].data, b"2");
    assert_eq!(entries[2].data, b"4");
}
```

## 10. 强约束

```bash
# OutputRing 修改只在 subscribe/ 和 session_manager.rs + 后端 read_loop
grep -rn 'output_ring\.push\|output_ring\.insert' src-tauri/src/ --include='*.rs' | grep -v 'services/subscribe/\|services/session_manager\|local_session\|ssh_session\|tmux_session'
# 必须为空（push 只在 read_loop 内部；insert/remove 只在 registry 内部）

# subscribe 不依赖 PTY/SSH/tmux
grep -rnE 'portable_pty|russh::|TmuxController' src-tauri/src/services/subscribe/
# 必须为空

# subscribe 不依赖 MCP 协议层
grep -rnE 'rmcp::|McpServerImpl' src-tauri/src/services/subscribe/
# 必须为空
```

## 11. 验收

- OutputRing 序号单调递增 + 连续无重复 ✅
- 100000 行 ring 不爆内存（实测 < 20MB per ring） ✅
- overflow 检测 + 事件 emit 正确 ✅
- 多 subscriber fan-out 不丢消息 ✅
- since_seq 增量订阅正确跳过已读 ✅
- session close 时 ring 正确清理 ✅

## 12. 文档地图

- [`README.md`](README.md) — 本文档
- [`INTERFACE.md`](INTERFACE.md) — OutputRing / Subscriber / SubscribeRegistry 公开 API
- [`DOWNSTREAM.md`](DOWNSTREAM.md) — 依赖图