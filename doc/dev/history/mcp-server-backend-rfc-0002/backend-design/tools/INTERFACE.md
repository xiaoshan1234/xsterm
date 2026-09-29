# MCP Server · Tools — 对外接口（JSON Schema）

> **位置**：`src-tauri/src/mcp_server/tools/`
> **协议**：MCP JSON-RPC 2.0 over stdio / HTTP（SSE）
> **生成方式**：每个工具 1 个 Rust struct + `#[derive(JsonSchema)]` → `schemars::schema_for!()` 生成 schema

## 1. `list_sessions`

**调用**：
```json
{
  "method": "list_sessions",
  "params": { "filter": { "type": "tmux", "attached": true } }  // filter 可选
}
```

**Rust 入参**：
```rust
#[derive(Debug, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct ListSessionsParams {
    pub filter: Option<Filter>,
}

#[derive(Debug, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct Filter {
    /// session 类型过滤
    #[serde(rename = "type")]
    pub type_: Option<String>,  // "local" | "ssh" | "tmux"
    /// profile 名过滤
    pub profile: Option<String>,
    /// 是否被 attach
    pub attached: Option<bool>,
}
```

**返回**：
```json
{
  "sessions": [
    {
      "id": 42,
      "name": "pwsh-main",
      "kind": "local",
      "status": "running",
      "attachedByMcp": "claude-desktop"  // null = 未 attach
    }
  ]
}
```

**错误**：
- 无（只读）

## 2. `create_session`

**调用**：
```json
{
  "method": "create_session",
  "params": { "profile": "pwsh-default" }
}
```

**Rust 入参**：
```rust
#[derive(Debug, Deserialize, JsonSchema)]
pub struct CreateSessionParams {
    /// profile 名（已保存的 session config 名）
    pub profile: String,
    /// 可选：覆盖启动选项
    pub overrides: Option<SessionOverrides>,
}

#[derive(Debug, Deserialize, JsonSchema)]
pub struct SessionOverrides {
    pub shell: Option<String>,
    pub cwd: Option<String>,
    pub cols: Option<u16>,
    pub rows: Option<u16>,
}
```

**返回**：
```json
{
  "sessionId": "tab-7f3a9b",  // ⭐ 字符串 MCP id（不是 u32）
  "name": "pwsh-default"
}
```

**错误**：
- `ProfileNotFound` (-32009): profile 名不存在
- `SessionCreateFailed` (-32010): backend 启动失败
- `QuotaExceeded` (-32011): 已达 100 session 上限
- `RateLimitExceeded` (-32006): 100 req/s 触发

## 3. `close_session`

**调用**：
```json
{
  "method": "close_session",
  "params": { "sessionId": "tab-7f3a9b" }
}
```

**Rust 入参**：
```rust
#[derive(Debug, Deserialize, JsonSchema)]
pub struct CloseSessionParams {
    pub session_id: String,
    /// 强制关闭（即使被别的 agent attach）
    pub force: Option<bool>,
}
```

**返回**：
```json
{ "closed": true }
```

**错误**：
- `SessionNotFound` (-32001): session_id 不存在
- `SessionNotOwnedByYou` (-32012): close 被别的 agent attach 的 session 且未指定 force
- `Internal` (-32603): backend 关闭失败

## 4. `send_keys` ⭐ 安全敏感

**调用（3 种入参形式）**：
```json
// 形式 1: 文本输入
{
  "method": "send_keys",
  "params": {
    "sessionId": "tab-7f3a9b",
    "text": "ls -la\n",
    "pressEnter": false
  }
}

// 形式 2: 组合键
{
  "method": "send_keys",
  "params": {
    "sessionId": "tab-7f3a9b",
    "keys": [
      { "type": "char", "value": "l" },
      { "type": "char", "value": "s" },
      { "type": "key", "value": "Enter" }
    ]
  }
}

// 形式 3: 原始字节（base64）
{
  "method": "send_keys",
  "params": {
    "sessionId": "tab-7f3a9b",
    "raw": "bHMgLWxhCg=="
  }
}
```

**Rust 入参**：
```rust
#[derive(Debug, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct SendKeysParams {
    pub session_id: String,
    /// 普通文本（含 \n 等转义）
    pub text: Option<String>,
    /// 组合键序列
    pub keys: Option<Vec<KeySpec>>,
    /// 原始字节（base64 编码）
    pub raw: Option<String>,
    /// text 末尾追加 \n
    pub press_enter: Option<bool>,
    /// bracketed paste mode 包裹
    pub bracketed: Option<bool>,
    /// 字符间延迟（毫秒）—— 0 表示无延迟
    pub delay_ms: Option<u64>,
}

#[derive(Debug, Deserialize, JsonSchema)]
#[serde(tag = "type", rename_all = "lowercase")]
pub enum KeySpec {
    /// 单个字符
    Char { value: String },
    /// 命名键（Enter / Tab / Escape / ArrowUp / F1 / ...）
    Key { value: KeyName },
    /// 组合键（如 Ctrl+C = modifiers=["ctrl"] + value="c"）
    Combo { modifiers: Vec<Modifier>, value: String },
}

#[derive(Debug, Deserialize, JsonSchema)]
#[serde(rename_all = "kebab-case")]
pub enum KeyName {
    Enter, Tab, Escape, Backspace, Delete,
    ArrowUp, ArrowDown, ArrowLeft, ArrowRight,
    Home, End, PageUp, PageDown,
    F1, F2, F3, F4, F5, F6, F7, F8, F9, F10, F11, F12,
    Insert,
}

#[derive(Debug, Deserialize, JsonSchema)]
#[serde(rename_all = "lowercase")]
pub enum Modifier {
    Ctrl, Alt, Shift, Meta, Cmd,
}
```

**返回**：
```json
{
  "delivered": true,
  "bytesSent": 8,
  "warnings": null  // 或 ["detected bracketed paste mode needed for newline"]
}
```

**错误**：
- `SessionNotAttached` (-32002): 必须先 attach
- `DestructiveShortcutRejected` (-32004): 含 `Ctrl+X` / `Alt+F4` 等非白名单键
- `PayloadTooLarge` (-32005): bytes > 1 MiB
- `InvalidKeys` (-32013): KeySpec 解析失败

## 5. `capture_screen`

**调用**：
```json
{
  "method": "capture_screen",
  "params": {
    "sessionId": "tab-7f3a9b",
    "mode": "ansi",  // "text" | "ansi" | "screenshot"
    "lines": 100     // 可选，默认 100
  }
}
```

**Rust 入参**：
```rust
#[derive(Debug, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct CaptureScreenParams {
    pub session_id: String,
    pub mode: CaptureMode,
    pub lines: Option<u32>,  // 默认 100
}

#[derive(Debug, Deserialize, JsonSchema)]
#[serde(rename_all = "lowercase")]
pub enum CaptureMode {
    /// 纯文本（剥 ANSI 转义）
    Text,
    /// 带 ANSI 转义
    Ansi,
    /// PNG 截图（offscreen renderer）
    Screenshot,
}
```

**返回（Text / Ansi 模式）**：
```json
{
  "content": "$ ls -la\ntotal 8\ndrwxr-xr-x  ..\n...",
  "mode": "ansi",
  "lines": 23,
  "truncated": false
}
```

**返回（Screenshot 模式）**：
```json
{
  "screenshot": "iVBORw0KGgoAAAANSUhEUg...",  // base64 PNG
  "width": 1024,
  "height": 768
}
```

**错误**：
- `SessionNotFound` (-32001)
- `UnsupportedMode` (-32014): 当前 session 不支持某种模式（如 local PTY 不支持 screenshot MVP）

## 6. `subscribe_output`

**调用**：
```json
{
  "method": "subscribe_output",
  "params": {
    "sessionId": "tab-7f3a9b",
    "sinceSeq": 12345  // 可选，增量订阅起点
  }
}
```

**Rust 入参**：
```rust
#[derive(Debug, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct SubscribeOutputParams {
    pub session_id: String,
    pub since_seq: Option<u64>,
}
```

**返回**：
```json
{
  "subscribed": true,
  "currentSeq": 12350  // 当前已发布序号
}
```

**MCP notification（服务器推）**：
```json
{
  "method": "session-output",
  "params": {
    "sessionId": "tab-7f3a9b",
    "seq": 12351,
    "data": "bHMgLWxhCg==",  // base64 bytes
    "timestampMs": 1737123456789
  }
}
```

**错误**：
- `SessionNotAttached` (-32002): 必须先 attach
- `MaxSubscribersReached` (-32015): 单 session 上限 100
- `Internal` (-32603): OutputRing 注册失败

## 7. `unsubscribe_output`

**调用**：
```json
{
  "method": "unsubscribe_output",
  "params": {
    "sessionId": "tab-7f3a9b",
    "subscriptionId": "sub-uuid"  // 可选；不传则取消所有
  }
}
```

**Rust 入参**：
```rust
#[derive(Debug, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct UnsubscribeOutputParams {
    pub session_id: String,
    pub subscription_id: Option<String>,
}
```

**返回**：
```json
{ "unsubscribed": true, "count": 3 }
```

**错误**：
- `SessionNotAttached` (-32002)
- `SubscriptionNotFound` (-32016)

## 8. `attach_session` ⭐ 状态机核心

**调用**：
```json
{
  "method": "attach_session",
  "params": { "sessionId": "tab-7f3a9b" }
}
```

**Rust 入参**：
```rust
#[derive(Debug, Deserialize, JsonSchema)]
pub struct AttachSessionParams {
    pub session_id: String,
}
```

**返回**：
```json
{
  "attached": true,
  "attachedAtMs": 1737123456789,
  "expiresAtMs": 1737127056789  // 默认 1 小时 idle timeout
}
```

**错误**：
- `SessionNotFound` (-32001)
- `SessionAlreadyAttached` (-32003): 已被别的 client attach

## 9. `detach_session`

**调用**：
```json
{
  "method": "detach_session",
  "params": { "sessionId": "tab-7f3a9b" }
}
```

**Rust 入参**：
```rust
#[derive(Debug, Deserialize, JsonSchema)]
pub struct DetachSessionParams {
    pub session_id: String,
}
```

**返回**：
```json
{ "detached": true }
```

**错误**：
- `SessionNotAttached` (-32002): 未 attach 或被别的 client attach

## 10. `wait_for`

**调用**：
```json
{
  "method": "wait_for",
  "params": {
    "sessionId": "tab-7f3a9b",
    "pattern": "READY|ERROR",  // 正则
    "timeoutMs": 10000
  }
}
```

**Rust 入参**：
```rust
#[derive(Debug, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct WaitForParams {
    pub session_id: String,
    pub pattern: String,
    pub timeout_ms: u32,  // 1-60000
}
```

**返回**：
```json
{
  "matched": true,
  "matchedLine": "[2026-09-29] Server READY on port 8080",
  "matchedSeq": 12367,
  "elapsedMs": 1234
}
```

**错误**：
- `SessionNotAttached` (-32002)
- `TimeoutMsOutOfRange` (-32017): timeoutMs > 60000 或 < 1
- `InvalidRegex` (-32018): pattern 解析失败

## 11. `list_profiles`

**调用**：
```json
{ "method": "list_profiles", "params": {} }
```

**返回**：
```json
{
  "profiles": [
    {
      "name": "pwsh-default",
      "type": "local",
      "description": "PowerShell 7",
      "default": true
    },
    {
      "name": "prod-server",
      "type": "ssh",
      "description": null,
      "default": false
    }
  ]
}
```

**错误**：
- 无

## 12. `get_config`

**调用**：
```json
{
  "method": "get_config",
  "params": {
    "fields": ["terminal.fontSize", "appearance.theme"]  // 可选；不传返回全部白名单字段
  }
}
```

**Rust 入参**：
```rust
#[derive(Debug, Deserialize, JsonSchema)]
pub struct GetConfigParams {
    pub fields: Option<Vec<String>>,
}
```

**返回**：
```json
{
  "config": {
    "terminal": { "fontSize": 14, "fontFamily": "Cascadia Code" },
    "appearance": { "theme": "xsterm-dark" }
    // ⚠️ 不包含 ssh.host_key_verify / updater.channel 等敏感字段
  }
}
```

**错误**：
- `FieldNotReadable` (-32019): 字段不在白名单

## 13. `set_config` ⭐ 白名单写入

**调用**：
```json
{
  "method": "set_config",
  "params": {
    "patch": {
      "terminal": { "fontSize": 16 }
    }
  }
}
```

**Rust 入参**：
```rust
#[derive(Debug, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct SetConfigParams {
    /// 部分更新（嵌套结构按 JSON Merge Patch 语义）
    pub patch: PartialAppConfig,
}
```

**返回**：
```json
{
  "config": { /* 更新后的完整 AppConfig */ }
}
```

**错误**：
- `FieldNotWritable` (-32008): 尝试写入白名单外字段（如 ssh.host_key_verify）
- `ValidationError` (-32020): schema 校验失败
- `Internal` (-32603): 写盘失败

## 14. 错误码汇总

| code | 名称 | 触发条件 |
|---|---|---|
| -32001 | `SessionNotFound` | session_id 不存在 |
| -32002 | `SessionNotAttached` | 未 attach（send_keys / capture 等需要） |
| -32003 | `SessionAlreadyAttached` | 已被别的 client attach |
| -32004 | `DestructiveShortcutRejected` | 破坏性键不在白名单 |
| -32005 | `PayloadTooLarge` | bytes > 1 MiB |
| -32006 | `RateLimitExceeded` | 100 req/s 触发 |
| -32007 | `AuthFailed` | Bearer token 无效（HTTP 模式） |
| -32008 | `FieldNotWritable` | set_config 写白名单外字段 |
| -32009 | `ProfileNotFound` | profile 名不存在 |
| -32010 | `SessionCreateFailed` | 后端启动失败 |
| -32011 | `QuotaExceeded` | 100 sessions 上限 |
| -32012 | `SessionNotOwnedByYou` | close 别人 attach 的 session |
| -32013 | `InvalidKeys` | KeySpec 解析失败 |
| -32014 | `UnsupportedMode` | capture mode 不支持 |
| -32015 | `MaxSubscribersReached` | 单 session 上限 100 subscribers |
| -32016 | `SubscriptionNotFound` | unsubscribe 不存在的 subscription |
| -32017 | `TimeoutMsOutOfRange` | wait_for timeoutMs 越界 |
| -32018 | `InvalidRegex` | wait_for pattern 不是合法 regex |
| -32019 | `FieldNotReadable` | get_config 字段不在白名单 |
| -32020 | `ValidationError` | set_config schema 校验失败 |
| -32603 | `Internal` | 未分类内部错误 |

## 15. 类型与 frontend TS 镜像

每个 Rust struct 都有对应的 TS interface（约束见 backend README §6）：
- `models::mcp::*` ↔ `app/mcp/types.ts`
- 每个 tool 的 params / result 镜像在 `app/mcp/tools/<name>.ts`
- TS 端使用 zod / valibot 在 runtime 校验（防止 frontend 误传）

## 16. 变更流程

1. **新增 MCP 工具** → 加 `tools/<name>.rs` + 注册到 `tools/mod.rs` + `INTERFACE.md` 加一节 + 类型契约更新
2. **修改工具签名** → ⚠️ breaking 协议变更——同步更新 `INTERFACE.md` + 测试 + 通知 client 升级
3. **删除工具** → 从 `tools/<name>.rs` 删除 + `INTERFACE.md` 删除对应一节 + ⚠️ breaking 协议变更
4. **修改错误码** → ⚠️ 兼容性破坏——保持原 code，新增不破坏