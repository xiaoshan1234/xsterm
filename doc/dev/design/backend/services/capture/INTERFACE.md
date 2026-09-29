# Services · Capture — 对外接口

> **位置**：`src-tauri/src/services/capture/mod.rs`
> **唯一入口**：`use crate::services::capture::{capture_screen, CaptureMode, CaptureResult, CaptureError}`
> **被使用方**：`mcp_server::tools::capture_screen`

## 1. 公开类型

```rust
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
    #[error("session {0} not found")]
    SessionNotFound(u32),
    #[error("mode {0:?} not supported")]
    UnsupportedMode(CaptureMode),
    #[error("output ring empty for session")]
    RingEmpty,
    #[error("internal: {0}")]
    Internal(String),
}
```

## 2. 公开函数

```rust
pub async fn capture_screen(
    session_id: u32,
    mode: CaptureMode,
    lines: u32,
    subscribe_registry: &SubscribeRegistry,
) -> Result<CaptureResult, CaptureError>;
```

## 3. 接缝契约

```rust
// mcp_server/tools/capture_screen.rs
use crate::services::capture::{capture_screen, CaptureMode};

pub async fn handle(ctx: &McpContext, params: CaptureScreenParams) -> Result<...> {
    let session_id = ctx.resolve_session_id(&params.session_id)?;
    let result = capture_screen(
        session_id,
        params.mode,
        params.lines.unwrap_or(100),
        &ctx.subscribe_registry,
    ).await?;
    Ok(CallToolResult::success(serde_json::to_value(result)?))
}
```

## 4. 错误码映射

| CaptureError | McpError |
|---|---|
| `SessionNotFound(u32)` | `SessionNotFound` (-32001) |
| `UnsupportedMode(mode)` | `UnsupportedMode` (-32014) |
| `RingEmpty` | `RingEmpty` (-32023) |
| `Internal(_)` | `Internal` (-32603) |

## 5. 不对外暴露

- `text::strip_ansi` 内部 regex
- `ansi::format_output` 内部格式化

## 6. 变更流程

1. **新增 CaptureMode variant** → 更新 enum + 各分支实现 + INTERFACE.md §1 + McpError 映射
2. **修改 capture_screen 签名** → 同步 INTERFACE.md + 测试
3. **删除 CaptureMode variant** → 三处一起删除

## 7. 性能

| 模式 | 100 行预算 | 10000 行预算 |
|---|---|---|
| Text | < 50ms | < 200ms |
| Ansi | < 30ms | < 150ms |
| Screenshot | MVP 报错 | MVP 报错 |

## 8. 文档

- [`README.md`](README.md) — 职责
- [`INTERFACE.md`](INTERFACE.md) — 本文档
- [`DOWNSTREAM.md`](DOWNSTREAM.md) — 依赖图