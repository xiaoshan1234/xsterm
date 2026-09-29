# Backend · Infrastructure — 设计

> **位置**：`src-tauri/src/infrastructure/`
> **职责**：平台 API 唯一封装点（PTY / SSH / tmux / wire / 日志 / 剪贴板）
> **拆分**：7 个 module（5 现有 + 0 NEW + 1 未来 docker）

## 1. 子 module 索引

```
src-tauri/src/infrastructure/
├── mod.rs                    7 行 re-exports
│
├── pty.rs                    ✅ 现有——portable-pty 封装 + ConPTY/winpty 适配
│                             [trait PtySystem + NativePtySystem]
│
├── ssh.rs                    ✅ 现有——russh 封装 + known_hosts + 3 种认证
│                             [trait SshBackend + SshBackendImpl + SshSession]
│                             ⭐ 扩展：host_key_verify 默认改为 ask
│
├── tmux/                     ✅ 现有——tmux -CC 控制模式
│                             [TmuxController + parser + dispatch + protocol]
│
├── session_backend.rs        ✅ 现有——trait SessionBackend + PtyBackend / SshBackend 适配
│                             ⭐ 扩展：capture_text / capture_ansi / upload_image
│
├── app_backend.rs            ✅ 现有——trait AppBackend + RealAppBackend (Tauri 实现)
│                             ⭐ 扩展：emit "mcp-attach-changed" / "config-reloaded"
│
├── binary_frame.rs           ✅ 现有——0xA1 0x01 wire format 编码/解码
│                             [encode_session_output_frame / decode_session_output_header]
│
└── clipboard.rs              ✅ 现有——tauri-plugin-clipboard-manager 包装
```

**未来**：`docker.rs`（Docker exec — PRD §2 M2 待 P1-2 优先级）

## 2. 设计原则

### 2.1 trait 边界

每个子 module 暴露 1 个 trait + 1 个真实实现 + mock 实现（mockall 单测用）：

```rust
// 例: pty.rs
#[automock]  // mockall
pub trait PtySystem: Send + Sync {
    fn open(&self, config: LocalSessionConfig) -> Result<Box<dyn SessionBackend + Send>, PtyError>;
}

pub struct NativePtySystem;
impl PtySystem for NativePtySystem { /* portable-pty 调用 */ }
```

这样 `services/session_manager` 可以 mock `PtySystem` 来单测，不依赖真实 PTY。

### 2.2 不持有业务状态

- `infrastructure/*` 只持有平台句柄（PTY master fd / russh Channel / file handle）
- 不持有业务数据（attach 状态 / output ring / 配置）

### 2.3 禁止

- ❌ `infrastructure/*` 调 `services/*` 或 `commands/*`（只被动被调用）
- ❌ `infrastructure/*` 持有跨调用的可变状态
- ❌ `infrastructure/*` 持有 AppHandle 以外的业务类型

## 3. SessionBackend trait 扩展（⭐ target-arch §4.3）

```rust
pub trait SessionBackend: Send + Sync {
    // 现有 5 个方法保留
    fn get_session_info(&self) -> &SessionInfo;
    fn get_capabilities(&self) -> CapabilityFlags;
    fn write(&self, data: &[u8]) -> Result<(), String>;
    fn resize(&self, rows: u16, cols: u16) -> Result<(), String>;
    fn close(self: Box<Self>) -> Result<(), String>;

    // ⭐ NEW: capture_screen fallback（target-arch §4.3）
    fn capture_text(&self, start: i32, end: i32, strip_ansi: bool) -> Result<String, String>;
    fn capture_ansi(&self, start: i32, end: i32) -> Result<String, String>;

    // ⭐ NEW: image upload (Kitty graphics protocol)
    fn upload_image(&self, filename: &str, data: &[u8]) -> Result<String, String>;
}
```

**实现**：
- `LocalBackend`：`capture_text` / `capture_ansi` 返回 `""`（推荐走 OutputRing tail fallback——backend 不持有 terminal grid）
- `SshBackend`：同 LocalBackend
- `TmuxPaneHandle`：`capture_text` / `capture_ansi` 调 `tmux capture-pane -p -e -J`
- `DockerHandle`（未来）：同 LocalBackend
- 所有：`upload_image` 调 `KittyGraphicsProtocol` 写入（Image data → base64 + OSC sequence）

## 4. AppBackend trait 扩展（⭐ 事件新增）

```rust
pub trait AppBackend: Send + Sync {
    fn emit(&self, event: &str, payload: &serde_json::Value) -> Result<(), String>;
    fn emit_binary(&self, bytes: Vec<u8>) -> Result<(), String>;
    fn spawn(&self, f: Box<dyn FnOnce() + Send>);

    // ⭐ NEW: event subscriptions（attach / config 状态变化）
    // 注：当前不需要——attach / config 自己 emit 给 Tauri（持有 AppHandle）
}
```

**实际新增事件**：
| 事件名 | emit 时机 | payload |
|---|---|---|
| `mcp-attach-changed` | attach / detach | `{ sessionId, clientId, action }` |
| `config-reloaded` | config.toml reload | `AppConfig` |
| `output-overflow` | OutputRing 满 | `{ sessionId, message }` |
| `tunnel-status-changed` | 反向隧道状态变化 | `TunnelStatus` |

## 5. SSH host_key_verify 修复（⭐ 已知 gap）

**现状**（`src-tauri/src/infrastructure/ssh.rs`）：`host_key_verify = false`（AGENTS.md 标注已知安全 gap）。

**修复**：
```rust
// infrastructure/ssh.rs
pub struct SshBackendImpl {
    // ...
    host_key_verify: HostKeyVerify,  // ⭐ 改为可配置
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "lowercase")]
pub enum HostKeyVerify {
    Ask,       // ⭐ 默认——首次连接 prompt
    Yes,       // 信任所有（开发用）
    No,        // 禁用（不推荐）
}

impl SshBackendImpl::new(config: SshConfig) {
    self.host_key_verify = config.host_key_verify;
}

// 连接时根据配置验证
async fn verify_host_key(&self, host: &str, key: &PublicKey) -> Result<(), SshError> {
    match self.host_key_verify {
        HostKeyVerify::No => Ok(()),
        HostKeyVerify::Ask => known_hosts::verify_or_prompt(host, key).await,
        HostKeyVerify::Yes => Ok(()),  // ⚠️ 仅 dev 用
    }
}
```

**联动**：`config.toml [ssh.host_key_verify] = "ask"`（默认）。

## 6. binary_frame.rs 保留 + 验证

现有 wire format 保持不变：

```
[FRAME_MAGIC: u8 = 0xA1] [FRAME_VERSION: u8 = 0x01] [session_id: u32 BE] [payload_len: u32 BE] [payload: bytes]
```

**frontend decoder** 在 `src/hooks/sessionOutputFrame.ts`——wire format 必须前后端完全一致。

## 7. 性能预算

| 操作 | 预算 |
|---|---|
| `NativePtySystem::open` | < 50ms (PowerShell 启动) |
| `SshBackendImpl::connect` | < 1s (TCP + SSH auth) |
| `TmuxController::start` | < 200ms (tmux -CC spawn) |
| `RealAppBackend::emit` | < 1ms (Tauri 内部) |
| `binary_frame::encode` | < 1ms / 4096 bytes |

## 8. 测试

- `pty.rs` mockall 单测 + 集成测试（spawn PowerShell）
- `ssh.rs` mockall 单测 + russh 测试 sshd
- `tmux/` 单元 + 集成（启动真实 tmux 进程）
- `session_backend.rs` mockall（trait 抽象保证）
- `app_backend.rs` 单元（Tauri mock app）
- `binary_frame.rs` roundtrip 单测（已有）

## 9. 强约束

```bash
# infrastructure 不能依赖业务 crate
grep -rn 'use\s\+crate::\(commands\|services\|mcp_server\)' src-tauri/src/infrastructure/
# 必须为空（除 RealAppBackend 用 tauri）

# infrastructure 不能持有业务状态
grep -rnE 'Arc<.*Mutex|DashMap|Atomic' src-tauri/src/infrastructure/ --include='*.rs' | grep -v 'tests\|//'
# 必须只出现在 RealAppBackend::session_output_channel（Channel 是 IO 不是业务状态）
```

## 10. 文档

- 现有源码（每个文件都有 inline doc）
- [`backend/README §2.3`](../README.md) — infrastructure 层概述

## 11. 验收

- 7 个子 module 全部按设计（5 现有 + 0 NEW + 1 未来 docker） ✅
- SessionBackend trait 扩展 capture_* / upload_image ✅
- AppBackend 支持 emit mcp-attach-changed / config-reloaded / output-overflow / tunnel-status-changed ✅
- SSH host_key_verify 修复（默认 ask） ✅