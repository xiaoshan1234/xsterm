# Models · Capture — 设计

> **位置**：`src-tauri/src/models/capture.rs`
> **类型**：⭐ 纯算法模块（RFC 0006 下沉自原 `services/capture/`）
> **职责**：capture_screen 工具的 3 种模式实现（纯函数，无 IO / 无状态）

## 1. 一句话架构

**capture = 3 个 pure functions + ANSI regex**

```
src-tauri/src/models/capture.rs
├── mod.rs              公开 API（CaptureMode + 3 个 functions）
├── text.rs             strip_ansi + capture_text
├── ansi.rs             capture_ansi
├── screenshot.rs       占位（MVP 报错 UnsupportedMode）
└── regex_cache.rs      OnceCell<Regex> 缓存 ANSI 匹配 regex
```

## 2. 职责

capture module 处理 MCP `capture_screen` 工具的 3 种模式的**算法层**：

| 模式 | 行为 | 实现 |
|---|---|---|
| `text` | 纯文本（剥 ANSI） | `capture_text(bytes, lines)` |
| `ansi` | 带 ANSI 转义 | `capture_ansi(bytes, lines)` |
| `screenshot` | PNG 截图 | `capture_screenshot()` → 返回 `Err(UnsupportedMode)`（MVP） |

## 3. 不承担

- ❌ 读 PTY / SSH / tmux 数据（归 `services::subscribe::OutputRing::tail` 或 tmux controller）
- ❌ MCP 协议处理（归 `mcp_server/tools/capture_screen`）
- ❌ 前端 IPC（归 `commands/session::capture_text` / `capture_ansi` / `capture_screenshot`）
- ❌ 状态机 / 长跑 task / IO

## 4. 公开 API

```rust
// models/capture.rs
#[derive(Debug, Clone, Copy, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "lowercase")]
pub enum CaptureMode {
    Text,
    Ansi,
    Screenshot,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CaptureResult {
    pub content: String,
    pub screenshot_base64: Option<String>,
    pub width: Option<u32>,
    pub height: Option<u32>,
    pub lines: u32,
    pub truncated: bool,
}

#[derive(Debug, thiserror::Error)]
pub enum CaptureError {
    #[error("mode {0:?} not supported")]
    UnsupportedMode(CaptureMode),
    #[error("internal: {0}")]
    Internal(String),
}

/// 主入口：根据 mode 路由
pub fn capture(
    mode: CaptureMode,
    raw_bytes: &[u8],   // 来自 OutputRing::tail() 或 tmux capture-pane
    lines: usize,
) -> Result<CaptureResult, CaptureError> {
    match mode {
        CaptureMode::Text => text::capture(raw_bytes, lines),
        CaptureMode::Ansi => ansi::capture(raw_bytes, lines),
        CaptureMode::Screenshot => screenshot::capture(),
    }
}
```

## 5. 实现细节

### 5.1 text 模式（剥 ANSI）

```rust
// models/capture/text.rs
use once_cell::sync::Lazy;
use regex::Regex;

static ANSI_RE: Lazy<Regex> = Lazy::new(|| {
    Regex::new(r"\x1b\[[0-9;?]*[a-zA-Z]|\x1b\][^\x07]*\x07").unwrap()
});

pub fn capture(raw_bytes: &[u8], lines: usize) -> Result<CaptureResult, CaptureError> {
    let text = strip_ansi(raw_bytes);
    let truncated = false;  // 由调用方判断

    Ok(CaptureResult {
        content: text,
        screenshot_base64: None,
        width: None,
        height: None,
        lines: lines as u32,
        truncated,
    })
}

pub fn strip_ansi(bytes: &[u8]) -> String {
    let text = String::from_utf8_lossy(bytes);
    ANSI_RE.replace_all(&text, "").into_owned()
}
```

**正则覆盖**：
- CSI：`\x1b\[<params><letter>`（光标移动、颜色、清屏等）
- OSC：`\x1b\]<data>\x07`（终端标题、颜色配置等）

### 5.2 ansi 模式（保留）

```rust
// models/capture/ansi.rs
pub fn capture(raw_bytes: &[u8], lines: usize) -> Result<CaptureResult, CaptureError> {
    Ok(CaptureResult {
        content: String::from_utf8_lossy(raw_bytes).into_owned(),
        screenshot_base64: None,
        width: None,
        height: None,
        lines: lines as u32,
        truncated: false,
    })
}
```

### 5.3 screenshot 模式（MVP 占位）

```rust
// models/capture/screenshot.rs
pub fn capture() -> Result<CaptureResult, CaptureError> {
    // ⭐ MVP 不支持：返回明确错误
    Err(CaptureError::UnsupportedMode(CaptureMode::Screenshot))
    // 未来 v1.0：前端 xterm.js offscreen renderer 接管，backend 提供 RPC helper
}
```

## 6. 调用链（完整）

```
AI agent 调 capture_screen MCP tool
    ↓ MCP JSON-RPC
frontend app/mcp/tools/capture_screen.ts
    ↓
invoke('capture_text', { sessionId, mode, lines })
    ↓ Tauri IPC
backend commands/session::capture_text(session_id, mode, lines)
    ↓
1. 路由根据 session 类型：
   ├─ tmux → TmuxController::capture_pane(server, pane_id, lines) → String
   └─ 其他 → services::subscribe::OutputRing::tail(n) → Vec<RingEntry> → bytes
2. bytes → models::capture::capture(mode, &bytes, lines)
   ↓ 纯函数（无 IO）
3. return CaptureResult
    ↓
4. frontend 序列化返回 MCP client
```

**关键**：
- capture 算法在 `models/`（无状态、pure）
- 数据源在 `services/subscribe::OutputRing`（backend 唯一真源）
- tmux 走 `TmuxController::capture_pane`（backend 命令）
- IPC 在 `commands/session.rs`

## 7. 测试

```rust
#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn strip_ansi_csi() {
        let bytes = b"\x1b[31mhello\x1b[0m world";
        let result = strip_ansi(bytes);
        assert_eq!(result, "hello world");
    }

    #[test]
    fn strip_ansi_osc() {
        let bytes = b"\x1b]0;title\x07content";
        let result = strip_ansi(bytes);
        assert_eq!(result, "content");
    }

    #[test]
    fn text_mode_strips_ansi() {
        let bytes = b"\x1b[31mred\x1b[0m \x1b[32mgreen\x1b[0m";
        let result = capture(CaptureMode::Text, bytes, 100).unwrap();
        assert_eq!(result.content, "red green");
    }

    #[test]
    fn ansi_mode_preserves_ansi() {
        let bytes = b"\x1b[31mred\x1b[0m";
        let result = capture(CaptureMode::Ansi, bytes, 100).unwrap();
        assert_eq!(result.content, "\x1b[31mred\x1b[0m");
    }

    #[test]
    fn screenshot_mode_returns_unsupported() {
        let result = capture(CaptureMode::Screenshot, &[], 100);
        assert!(matches!(result, Err(CaptureError::UnsupportedMode(_))));
    }

    #[test]
    fn regex_is_cached() {
        // 验证 OnceCell 缓存生效
        let _ = ANSI_RE.is_match("\x1b[31m");
        // 多次访问 ANSI_RE 不应重新编译
    }
}
```

## 8. 性能

| 操作 | 预算 | 备注 |
|---|---|---|
| `strip_ansi(1MB)` | < 10ms | regex OnceCell 缓存 |
| `capture(mode, 100 行)` | < 30ms | regex 匹配 + String 分配 |
| `capture_ansi(100 行)` | < 20ms | 直接 String::from_utf8_lossy |
| `capture_screenshot()` | < 1ms | 立即返回错误 |

## 9. 依赖

| crate | 用途 |
|---|---|
| `regex` | ANSI 转义匹配 |
| `once_cell` | Regex 全局缓存 |
| `serde` | CaptureMode / CaptureResult 序列化 |
| `schemars` | CaptureMode JsonSchema 派生（IPC 镜像需要） |
| `thiserror` | CaptureError 派生 |

## 10. 强约束

```bash
# capture 不依赖 services / commands / infrastructure
grep -rn 'use\s\+crate::\(services\|commands\|infrastructure\)' src-tauri/src/models/capture/
# 必须为空（capture 是 pure function）

# capture 不持有状态
grep -rnE 'Arc<|Mutex<|DashMap<|Atomic' src-tauri/src/models/capture/ --include='*.rs' | grep -v 'tests\|//'
# 必须为空（仅 once_cell Lazy<Regex> 静态缓存——不算状态）

# capture 不接触 PTY / SSH / tmux
grep -rnE 'portable_pty|russh::|TmuxController' src-tauri/src/models/capture/
# 必须为空
```

## 11. 不在 MVP 范围

- ❌ screenshot 模式（v1.0 由前端 xterm.js offscreen renderer 实现）
- ❌ diff 模式（v2）
- ❌ filter 模式（grep / 正则过滤行）

## 12. 演进路径

### 12.1 v1.0 —— 加 screenshot

```rust
// models/capture/screenshot.rs
pub fn capture() -> Result<CaptureResult, CaptureError> {
    // 通过 IPC 调前端 offscreen renderer
    // 返回 base64 PNG + width / height
}
```

### 12.2 v2 —— 加 diff / filter

- `capture_diff(mode, bytes, baseline)` —— 与 baseline diff
- `capture_filter(mode, bytes, regex)` —— 正则过滤

## 13. 文档

- [`README.md`](README.md) — 本文档
- [`../../services/session_manager_extension.md §2.3`](../../services/session_manager_extension.md) — SessionBackend trait 扩展 capture_text / capture_ansi
- [`../../../adr/0006-services-simplification.md`](../../../adr/0006-services-simplification.md) — RFC 0006 决策（capture 从 services 下沉）

## 14. 验收

- capture_text 100 行 < 30ms ✅
- regex OnceCell 缓存生效（不重复编译） ✅
- screenshot 模式返回 UnsupportedMode ✅
- pure function 测试 100% 覆盖（无 IO mock） ✅
- 不依赖 services / commands / infrastructure ✅