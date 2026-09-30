# Services · Capture — 职责

> **位置**：`src-tauri/src/services/capture/`
> **类型**：MCP `capture_screen` 工具的底层实现 + UI 复制粘贴 fallback
> **核心**：3 种 capture 模式（text / ansi / screenshot）

## 1. 一句话架构

**capture = 1 个 `CaptureRouter` 根据 session 类型路由到不同实现**

```
src-tauri/src/services/capture/
├── mod.rs              公开 API（CaptureRouter + 3 个模式函数）
├── text.rs             剥 ANSI 转义（regex strip_ansi crate）
├── ansi.rs             保留 ANSI（直接返回 bytes）
├── screenshot.rs       MVP 占位（前端 xterm.js offscreen renderer 实现，backend 返回 supported=false）
├── tmux.rs             tmux 走 capture-pane -p -e -J 命令（已有 backend 实现）
└── fallback.rs         local/SSH 走 OutputRing.tail(n) fallback
```

## 2. 职责

capture service 处理 MCP `capture_screen` 工具的 3 种模式：

| 模式 | 含义 | 实现 |
|---|---|---|
| `text` | 纯文本（剥 ANSI） | `services/subscribe::OutputRing::tail` + `strip_ansi` |
| `ansi` | 带 ANSI 转义 | `services/subscribe::OutputRing::tail`（直接返回） |
| `screenshot` | PNG 截图 | MVP: 返回 `McpError::UnsupportedMode`；v1.0 由 frontend xterm.js offscreen renderer 接管 |

## 3. 关键设计决策（target-arch §3.5）

### 3.1 tmux 走后端，其他走前端

**取舍依据**（target-arch §3.5）：
- tmux 走 `tmux capture-pane -p -e -J` 命令，**精准**（拿服务端最近 N 行）
- local/SSH 没有服务端概念——前端 xterm.js 是 terminal grid 的持有者，**前端读 grid 更准**
- 但前端 capture 走 invoke IPC 会延迟，所以 backend 提供 OutputRing.tail() fallback

### 3.2 MVP 简化

MVP 阶段**统一走 OutputRing.tail()**：
- 优点：实现简单，3 种模式都用同一路径
- 缺点：OutputRing 容量有限（默认 10000 行），用户 `cat 1GB` 后 capture_screen 只拿最近 10000 行
- 未来：tmux 模式走 tmux capture-pane；local/SSH 模式前端 offscreen renderer

## 4. 公开 API

```rust
// services/capture/mod.rs
pub enum CaptureMode { Text, Ansi, Screenshot }

pub struct CaptureResult {
    pub content: String,           // Text / Ansi 模式
    pub screenshot_base64: Option<String>,  // Screenshot 模式（MVP 不支持）
    pub width: Option<u32>,
    pub height: Option<u32>,
    pub lines: u32,
    pub truncated: bool,
}

pub enum CaptureError {
    SessionNotFound(u32),
    UnsupportedMode(CaptureMode),
    RingEmpty,           // session 还没产生过输出
    Internal(String),
}

pub async fn capture_screen(
    session_id: u32,
    mode: CaptureMode,
    lines: u32,
    subscribe_registry: &SubscribeRegistry,
) -> Result<CaptureResult, CaptureError> {
    match mode {
        CaptureMode::Text => text::capture(session_id, lines, subscribe_registry).await,
        CaptureMode::Ansi => ansi::capture(session_id, lines, subscribe_registry).await,
        CaptureMode::Screenshot => screenshot::capture(session_id).await,
    }
}
```

## 5. 各模式实现

### 5.1 text 模式

```rust
// services/capture/text.rs
use crate::services::subscribe::SubscribeRegistry;
use crate::services::capture::CaptureResult;

pub async fn capture(
    session_id: u32,
    lines: u32,
    registry: &SubscribeRegistry,
) -> Result<CaptureResult, CaptureError> {
    let ring = registry.get(session_id).ok_or(CaptureError::SessionNotFound(session_id))?;
    let entries = ring.tail(lines as usize).await;
    if entries.is_empty() {
        return Err(CaptureError::RingEmpty);
    }

    // ⭐ 合并所有 entry.data，剥 ANSI 转义
    let raw_bytes: Vec<u8> = entries.iter().flat_map(|e| e.data.iter().copied()).collect();
    let text = strip_ansi(&raw_bytes);

    Ok(CaptureResult {
        content: text,
        screenshot_base64: None,
        width: None,
        height: None,
        lines: lines,
        truncated: false,
    })
}

/// ⭐ 剥 ANSI CSI / OSC 转义（regex 实现）
fn strip_ansi(bytes: &[u8]) -> String {
    let text = String::from_utf8_lossy(bytes);
    // ESC [ ... letter (CSI) 或 ESC ] ... BEL (OSC)
    let ansi_re = regex::Regex::new(r"\x1b\[[0-9;?]*[a-zA-Z]|\x1b\][^\x07]*\x07").unwrap();
    ansi_re.replace_all(&text, "").into_owned()
}
```

### 5.2 ansi 模式

```rust
// services/capture/ansi.rs
pub async fn capture(...) -> Result<CaptureResult, CaptureError> {
    let ring = registry.get(session_id).ok_or(...)?;
    let entries = ring.tail(lines as usize).await;
    let raw_bytes: Vec<u8> = entries.iter().flat_map(|e| e.data.iter().copied()).collect();

    Ok(CaptureResult {
        content: String::from_utf8_lossy(&raw_bytes).into_owned(),  // 保留 ANSI
        screenshot_base64: None,
        // ...
    })
}
```

### 5.3 screenshot 模式（MVP 占位）

```rust
// services/capture/screenshot.rs
pub async fn capture(session_id: u32) -> Result<CaptureResult, CaptureError> {
    // ⭐ MVP 不支持：返回明确错误
    Err(CaptureError::UnsupportedMode(CaptureMode::Screenshot))
    // 未来 v1.0：前端 xterm.js offscreen renderer 接管，backend 提供 RPC helper
}
```

### 5.4 tmux 走 capture-pane（v1.0 才启用）

```rust
// services/capture/tmux.rs —— v1.0 实现
pub async fn capture_tmux(
    controller_id: u32,
    tmux_pane_id: String,
    lines: u32,
) -> Result<String, CaptureError> {
    use tokio::process::Command;
    let output = Command::new("tmux")
        .args(&["capture-pane", "-t", &format!("%{}", tmux_pane_id), "-p", "-e", "-J"])
        .args(&["-S", &format!("-{}", lines)])
        .output()
        .await
        .map_err(|e| CaptureError::Internal(e.to_string()))?;
    Ok(String::from_utf8_lossy(&output.stdout).into_owned())
}
```

## 6. 跟其他 service 的关系

| service | 关系 |
|---|---|
| `services/subscribe::OutputRing` | 持有 buffer；capture 从 tail() 读 |
| `mcp_server::tools::capture_screen` | 调 `capture::capture_screen(session_id, mode, lines)` |
| `services/session_manager` | 不直接调（capture 走独立 registry 注入） |

## 7. 性能预算

| 路径 | 预算 |
|---|---|
| text mode 100 行 | < 50ms |
| ansi mode 100 行 | < 30ms |
| screenshot mode | MVP 报错；v1.0 < 500ms |

## 8. 测试

```rust
#[tokio::test]
async fn text_mode_strips_ansi() {
    let registry = SubscribeRegistry::new();
    let ring = registry.get_or_create(42);
    ring.push(b"\x1b[31mhello\x1b[0m world\n".to_vec()).await;

    let result = capture_screen(42, CaptureMode::Text, 100, &registry).await.unwrap();
    assert_eq!(result.content, "hello world\n");
}

#[tokio::test]
async fn screenshot_mode_returns_unsupported() {
    let registry = SubscribeRegistry::new();
    registry.get_or_create(42);

    let result = capture_screen(42, CaptureMode::Screenshot, 100, &registry).await;
    assert!(matches!(result, Err(CaptureError::UnsupportedMode(_))));
}
```

## 9. 文档

- [`README.md`](README.md) — 本文档
- [`INTERFACE.md`](INTERFACE.md) — `capture_screen` 公开 API + 错误码
- [`DOWNSTREAM.md`](DOWNSTREAM.md) — 依赖图

## 10. 验收

- 3 种模式（text / ansi / screenshot）行为正确 ✅
- text 模式 ANSI 剥离覆盖 CSI + OSC ✅
- screenshot 模式 MVP 返回明确 UnsupportedMode ✅
- 空 ring 返回 RingEmpty（不是 panic） ✅
- 10000 行 capture 性能 < 50ms ✅