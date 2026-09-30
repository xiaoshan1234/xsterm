# Backend · Models — 设计

> **位置**：`src-tauri/src/models/`
> **职责**：纯数据 + serde 类型契约（mirror frontend TS types）
> **拆分**：7 个 module（现有 3 + NEW 4；删除原 `mcp.rs` 移到 frontend `model/mcp/types.ts`）

## 1. 7 个 module 索引

| module | 现状 | 行数预估 | 内容 |
|---|---|---|---|
| `session.rs` | ✅ 现有 | 现有 ~1667 + 扩展 200 | SessionInfo / SessionType / LocalSessionConfig / SSHSessionConfig / TmuxCcConfig / CapabilityFlags / AttachedTmuxServer / SplitDirection / TmuxSessionInit |
| `capabilities.rs` | ✅ 现有 | 现有 + 扩展 50 | CapabilityFlags（+ image_protocol / unicode11） |
| `group.rs` | ✅ 现有 | ~100 | GroupStore |
| `attach.rs` | ⭐ NEW | ~200 | AttachState / AttachSource / McpAttachChangedEvent |
| `subscription.rs` | ⭐ NEW | ~150 | OutputRingEntry / SubscribeResult / OutputOverflowEvent |
| `profile.rs` | ⭐ NEW | ~250 | Profile / ProfileType / SessionConfig union |
| `config.rs` | ⚠️ 简化（RFC 0003-revised） | ~400 | Settings + 5 个子 struct（见 services/config 历史） |
| `capture.rs` | ⭐ NEW（RFC 0006） | ~150 | CaptureMode + CaptureResult + capture_text/ansi/screenshot pure functions |
| ~~`mcp.rs`~~ | ❌ 删除（RFC 0002-revised） | n/a | 12 个 MCP 工具的 params/result 类型镜像移到 frontend `model/mcp/types.ts` |

## 2. 设计原则

### 2.1 拆分原则（user profile memory）

> "types go where their consumers live" — 按 destination-of-payload 拆。

| 类型 | 归宿 | 理由 |
|---|---|---|
| `AttachState` | `models/attach.rs` | attach service 是唯一消费者 |
| `OutputRingEntry` | `models/subscription.rs` | subscribe service 是唯一消费者 |
| `SessionConfig` | `models/profile.rs` | profile / create_session 业务 |
| `Settings` | `models/config.rs` | config service |
| `SendKeysParams` 等 12 个 MCP 工具类型 | ~~`models/mcp.rs`~~ → frontend `model/mcp/types.ts` | frontend `app/mcp/tools/` 是唯一消费者（RFC 0002-revised） |

### 2.2 禁止

- ❌ `models/*` import `crate::commands / services / infrastructure`（最底层）
- ❌ `models/*` 持有运行时状态（Vec<u8> / DashMap / Mutex）
- ❌ `models/*` 派生 `Display` / `From` / trait 实现（除 `Default` / serde）
- ❌ `models/*` 调外部 crate（除 `serde` / `serde_json` / `schemars`）

### 2.3 必备 derive

每个公开类型必须 derive：
```rust
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Xxx { ... }
```

如果需要默认值：`#[derive(Default)]`。

> **注**：MCP JSON Schema 派生（`schemars`）**已删除**（RFC 0002-revised + 0003-revised）——MCP 12 工具在 frontend `app/mcp/tools/` 通过 zod / valibot 派生；Settings schema 校验在 frontend 通过 zod 承担。backend 不需要 JsonSchema 派生。

## 3. `models/attach.rs` —— NEW

```rust
use serde::{Deserialize, Serialize};
use schemars::JsonSchema;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum AttachSource {
    Mcp {
        client_id: String,
        agent_name: String,
        agent_pid: u32,
    },
    Ui {
        client_id: String,
    },
    Tunnel {
        client_id: String,
        remote_user: String,
    },
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AttachState {
    pub source: AttachSource,
    pub attached_at_ms: u64,
    pub last_activity_at_ms: u64,
}

impl AttachState {
    pub fn is_owned_by(&self, client_id: &str) -> bool;
    pub fn refresh(&mut self);
}

/// emit 给 frontend 的事件 payload
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct McpAttachChangedEvent {
    pub session_id: u32,
    pub client_id: String,
    pub action: String,  // "attach" | "detach"
}
```

## 4. `models/subscription.rs` —— NEW

```rust
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RingEntry {
    pub seq: u64,
    pub data: Vec<u8>,
    pub timestamp_ms: u64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SubscribeResult {
    pub subscribed: bool,
    pub since_seq: u64,
    pub current_seq: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OutputChunk {
    pub session_id: u32,
    pub seq: u64,
    pub data: Vec<u8>,            // base64 in MCP notification
    pub timestamp_ms: u64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OutputOverflowEvent {
    pub session_id: u32,
    pub message: String,
}
```

## 5. `models/profile.rs` —— NEW

```rust
use serde::{Deserialize, Serialize};
use schemars::JsonSchema;

/// ⭐ MCP 暴露的 profile（替换前端 savedSessionConfig 命名）
#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct Profile {
    pub name: String,
    pub profile_type: ProfileType,
    pub description: Option<String>,
    pub default: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
#[serde(tag = "type", rename_all = "lowercase")]
pub enum ProfileType {
    Local {
        shell: String,
        cwd: String,
    },
    Ssh {
        host: String,
        port: u16,
        user: String,
        auth: SshAuthConfig,
    },
    Wsl {
        distro: String,
    },
    Docker {
        container_id: String,
        shell: String,
    },
    Tmux {
        session_name: String,
    },
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
#[serde(tag = "method", rename_all = "lowercase")]
pub enum SshAuthConfig {
    Password,
    PrivateKey { path: std::path::PathBuf },
    Agent,
}
```

**关键**：
- `Profile` 替代旧的 `PersistedSessionConfig`（命名更清楚）
- `ProfileType` 是 serde tagged union（JSON `{ "type": "local", "shell": "pwsh", "cwd": "..." }`）

## 6. `models/config.rs` —— NEW

详见 [`services/config/README.md §4`](../services/config/README.md)。关键类型：

```rust
// 完整 Settings + 5 个子 struct
pub struct Settings {
    pub version: u32,
    pub general: GeneralConfig,
    pub terminal: TerminalConfig,
    pub appearance: AppearanceConfig,
    pub keybindings: KeybindingsConfig,
    pub profiles: ProfilesConfig,
    pub mcp: McpConfig,
    pub ssh: SshConfig,
    pub tunnel: TunnelConfig,
    pub updater: UpdaterConfig,
    pub logging: LoggingConfig,
}
```

## 7. ~~`models/mcp.rs`~~ —— ❌ 删除（移到 frontend）

12 个 MCP 工具的 params / result 类型**已移到 frontend** `model/mcp/types.ts`：

```typescript
// 每个工具一组
export interface ListSessionsParams { filter?: Filter }
export interface ListSessionsResult { sessions: SessionSummary[] }

export interface CreateSessionParams { profile: string; overrides?: SessionOverrides }
export interface CreateSessionResult { sessionId: string; name: string }  // ⭐ string MCP id

// ... 共 12 组

// 共享类型
export type CaptureMode = "text" | "ansi" | "screenshot"
export type KeyName = "Enter" | "Tab" | /* ... */
export type Modifier = "ctrl" | "alt" | /* ... */
export type KeySpec = { type: "char"; value: string } | { type: "key"; value: KeyName } | { type: "combo"; modifiers: Modifier[]; value: string }
```

详见 [`doc/dev/design/frontend/app/mcp/`](../../frontend/app/mcp/README.md) 完整 schema + JSON-RPC 协议层。

## 7.5 `models/capture.rs` —— ⭐ NEW（RFC 0006）

```rust
// models/capture.rs
#[derive(Debug, Clone, Copy, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "lowercase")]
pub enum CaptureMode {
    Text,
    Ansi,
    Screenshot,
}

#[derive(Debug, thiserror::Error)]
pub enum CaptureError {
    #[error("mode {0:?} not supported")]
    UnsupportedMode(CaptureMode),
    #[error("internal: {0}")]
    Internal(String),
}

/// 主入口：pure function，根据 mode 路由
pub fn capture(
    mode: CaptureMode,
    raw_bytes: &[u8],
    lines: usize,
) -> Result<CaptureResult, CaptureError>;
```

**关键**：
- ✅ Pure function（无 IO / 无状态）
- ✅ regex ANSI 转义剥离（OnceCell 缓存）
- ✅ screenshot MVP 返回 `UnsupportedMode`
- ✅ 下沉自原 `services/capture/`（RFC 0006）

详见 [`capture.md`](capture.md) 完整设计。

## 8. `models/session.rs` 扩展

现有 `SessionInfo` 加字段：

```rust
pub struct SessionInfo {
    // ... 现有字段 ...

    // ⭐ NEW
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub attached: Option<AttachState>,

    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub mcp_session_id: Option<String>,
}
```

**注**：前端 `service/session/store` 直接消费；migration 时字段向前兼容（default + skip_serializing_if）。

## 9. serde 约定

- **`rename_all = "camelCase"`** —— 所有 struct 跟字段名（IPC 跟 TS 镜像一致）
- **`#[serde(default)]`** —— 新增字段向前兼容（无 toml 迁移）
- **`#[serde(skip_serializing_if = ...)`** —— Option 字段不输出 None
- **`#[serde(tag = "type", rename_all = "lowercase")]`** —— tagged union（MCP 工具 / Profile）
- ⚠️ **不再用 `#[serde(deny_unknown_fields)]`** —— JSON 直存需要容忍前端新字段（RFC 0003-revised）；前端 zod 校验替代

## 10. ~~JsonSchema 派生~~ —— ❌ 删除（RFC 0003-revised）

`schemars` crate 不再使用。理由：
- MCP JSON Schema 派生移到 frontend `app/mcp/tools/`（通过 zod / valibot）
- Settings schema 校验在 frontend（zod）
- backend 不需要对外暴露 JSON Schema——frontend 直存 store.json 不需要 backend 校验

如果未来 backend 需要导出 schema 供 IDE / 文档使用：
```rust
// 可选：单独 crate `xsterm-schema` 生成 JSON Schema 文件（不依赖 schemars）
// 例如通过手动维护 JSON 文件 + serde_json::from_str 验证
```

## 11. 跟 frontend TS 镜像

每个 Rust struct 必须有对应 TS interface（在 `src/model/<domain>/types.ts`）：

| Rust | TS 镜像 |
|---|---|
| `AttachSource::Mcp { client_id, agent_name, agent_pid }` | `{ kind: "mcp", clientId, agentName, agentPid }` |
| `AttachState` | `AttachState` interface |
| `SessionInfo.attached: Option<AttachState>` | `attached?: AttachState \| null` |
| `SessionInfo.mcp_session_id: Option<String>` | `mcpSessionId?: string` |
| `Profile` | `Profile` interface（替代旧 SavedSessionConfig） |
| `Settings` | `Settings` interface |

详见 [`frontend model README`](../../design/frontend/model/README.md) §5。

## 12. 测试

```rust
#[test]
fn roundtrip_session_info() {
    let info = SessionInfo {
        id: 42,
        name: "test".into(),
        // ...
        attached: Some(AttachState { /* ... */ }),
        mcp_session_id: Some("tab-7f3a9b".into()),
    };
    let json = serde_json::to_string(&info).unwrap();
    let parsed: SessionInfo = serde_json::from_str(&json).unwrap();
    assert_eq!(parsed.id, 42);
    assert!(parsed.attached.is_some());
}

#[test]
fn settings_unknown_field_tolerated() {
    // ⚠️ JSON 直存不拒绝未知字段——前端可能加新字段
    let json = r#"{
        "theme": "dark",
        "unknownField": "x"
    }"#;
    let settings: Settings = serde_json::from_str(json).unwrap();
    assert_eq!(settings.theme, "dark");
    // unknownField 被忽略，不报错
}

#[test]
fn settings_defaults_fill_missing() {
    let json = r#"{}"#;
    let settings: Settings = serde_json::from_str(json).unwrap();
    assert_eq!(settings.terminal_font_size, 14);  // default
    assert_eq!(settings.mcp.rate_limit_rps, 100);
}
```

## 13. 强约束

```bash
# models 不能依赖业务 crate
grep -rn 'use\s\+crate::\(commands\|services\|infrastructure\)' src-tauri/src/models/
# 必须为空

# models 不能持有运行时状态
grep -rnE 'Arc<|Mutex<|DashMap<|Atomic' src-tauri/src/models/ --include='*.rs' | grep -v 'tests\|//'
# 必须为空

# models 只能 import serde / schemars
grep -rn 'use\s\+\w' src-tauri/src/models/ --include='*.rs' | grep -v 'serde\|schemars'
# 必须为空
```

## 14. 演进路径

如果未来要拆 crates：
- `models/session` → `crates/session-types/`
- `models/attach` → `crates/attach-types/`
- ...

类型 crate 边界已经清晰（纯数据），迁移成本低。

## 15. 验收

- 8 个 module 全部按 dependency rules 隔离 ✅
- 12 个 MCP 工具类型都有 JsonSchema ✅
- TS 镜像同步（双向命名一致） ✅
- migration 兼容性（新增字段 default + skip_serializing_if） ✅