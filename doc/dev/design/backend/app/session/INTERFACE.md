# Module · App Session — 对外接口

> **位置**：`src-tauri/src/app/modules/session/api.rs`（落地 `src-tauri/src/commands/session.rs`）
> **唯一进口**：`use crate::app::modules::session::api::*;` 或直接 `use crate::commands::session::*`

## 1. 对外暴露什么

session module 暴露**两类符号**：

1. **Pure functions**（`pub fn`）—— 内部 service 委托入口，可被同 module `commands/` 子模块调用
2. **`#[tauri::command]` wrappers**（`pub async fn`）—— 注入 `State<Arc<SessionManager>>` / `AppHandle` 后调用 (1)

外部 module 调 session **必须**通过 `#[tauri::command]` wrapper（因为跨 module 调用本质上就是 IPC）；同 module `commands/` 子模块调 (1) 即可。

## 2. 核心接口

### 2.1 create 系列

```rust
use crate::infrastructure::app_backend::AppBackend;
use crate::models::session::{LocalSessionConfig, SSHSessionConfig, SessionConfig, SessionInfo, TmuxCcConfig};
use crate::services::session_manager::SessionManager;

/// 纯函数入口：创建 local session（被 commands/local/create.rs 调用）
pub fn create_local(
    state: &SessionManager,
    backend: Arc<dyn AppBackend>,
    config: LocalSessionConfig,
) -> Result<SessionInfo, String>;

/// 纯函数入口：创建 SSH session（被 commands/ssh/create.rs 调用）
pub fn create_ssh(
    state: &SessionManager,
    backend: Arc<dyn AppBackend>,
    config: SSHSessionConfig,
) -> Result<SessionInfo, String>;

/// 纯函数入口：generic dispatcher（被 commands/dispatch.rs 调用）
/// 内部按 SessionConfig variant 分流：
///   - Local → create_local
///   - Ssh   → create_ssh
///   - TmuxCc → app::modules::terminal::api::create_tmux
pub async fn create_session(
    state: &SessionManager,
    backend: Arc<dyn AppBackend>,
    config: SessionConfig,
) -> Result<serde_json::Value, String>;

// ============ #[tauri::command] wrappers ============

#[tauri::command]
pub async fn create_local_session(
    config: LocalSessionConfig,
    state: State<'_, Arc<SessionManager>>,
    app: AppHandle,
) -> Result<SessionInfo, String>;

#[tauri::command]
pub async fn create_ssh_session(
    config: SSHSessionConfig,
    state: State<'_, Arc<SessionManager>>,
    app: AppHandle,
) -> Result<SessionInfo, String>;

#[tauri::command]
pub async fn create_session(
    config: SessionConfig,
    state: State<'_, Arc<SessionManager>>,
    app: AppHandle,
) -> Result<serde_json::Value, String>;
```

### 2.2 通用 lifecycle

```rust
#[tauri::command]
pub async fn write_session(
    session_id: u32,
    data: Vec<u8>,
    state: State<'_, Arc<SessionManager>>,
) -> Result<(), String>;
// ↑ MAX_WRITE_PAYLOAD_BYTES = 1 MiB 上限；超出返回 Err
// ↑ Payload 含 true；Data 中转粘贴在前端执行

#[tauri::command]
pub async fn close_session(
    session_id: u32,
    state: State<'_, Arc<SessionManager>>,
) -> Result<(), String>;

#[tauri::command]
pub fn list_sessions(state: State<'_, Arc<SessionManager>>) -> Result<Vec<SessionInfo>, String>;
```

### 2.3 resize 系列

```rust
#[tauri::command]
pub async fn resize_pty_session(
    session_id: u32,
    rows: u16,
    cols: u16,
    state: State<'_, Arc<SessionManager>>,
) -> Result<(), String>;

#[tauri::command]
pub async fn resize_ssh_session(
    session_id: u32,
    rows: u16,
    cols: u16,
    state: State<'_, Arc<SessionManager>>,
) -> Result<(), String>;
```

### 2.4 SSH 特有

```rust
/// 上传图片到 SSH 服务器（前端 paste-image 流程调用）
#[tauri::command]
pub fn upload_image_to_ssh_session(
    session_id: u32,
    filename: String,
    data: Vec<u8>,
    state: State<'_, Arc<SessionManager>>,
) -> Result<String, String>;  // 返回远端路径
```

### 2.5 binary output channel

```rust
/// 获取 binary session-output channel（前端启动时调用一次）
#[tauri::command]
pub fn get_session_output_channel(
    backend: State<'_, Arc<RealAppBackend>>,
) -> Channel<Vec<u8>>;
// ↑ 见 perf.md Perf 001；wire 格式见 infrastructure/binary_frame.rs
```

## 3. 跨 module 调用的具体实现

### 3.1 session → settings（持久化 saved config）

```rust
// commands/local/create.rs
use crate::app::modules::settings::api as settings_api;

#[tauri::command]
pub async fn create_local_session(
    config: LocalSessionConfig,
    state: State<'_, Arc<SessionManager>>,
    app: AppHandle,
) -> Result<SessionInfo, String> {
    let backend: Arc<dyn AppBackend> = Arc::new(RealAppBackend::new(app.clone()));
    let info = session_api::create_local(state.inner(), backend, config.clone())?;

    // 触发持久化（如果 should_save）
    if config.should_save.unwrap_or(false) {
        if let Err(e) = settings_api::save_session_config(&app, &info, &config) {
            tracing::warn!("create_local_session: persistence failed: {e}");
        }
    }

    Ok(info)
}
```

**关键**：

- session **不**直接 import `commands::persistence::*`
- session 通过 `app::modules::settings::api::save_session_config` 间接调

### 3.2 session → terminal（generic dispatcher 内部路由 tmux）

```rust
// commands/dispatch.rs
use crate::app::modules::terminal::api as terminal_api;

#[tauri::command]
pub async fn create_session(
    config: SessionConfig,
    state: State<'_, Arc<SessionManager>>,
    app: AppHandle,
) -> Result<serde_json::Value, String> {
    let backend: Arc<dyn AppBackend> = Arc::new(RealAppBackend::new(app));
    let backend_ref = Arc::clone(&backend);
    match config {
        SessionConfig::Local(local) => session_api::create_local(state.inner(), backend, local)
            .map(serde_json::to_value)
            .and_then(|r| r.map_err(|e| e.to_string())),
        SessionConfig::Ssh(ssh) => session_api::create_ssh(state.inner(), backend, ssh)
            .map(serde_json::to_value)
            .and_then(|r| r.map_err(|e| e.to_string())),
        SessionConfig::TmuxCc(tmux) => {
            // 跨 module 调用 —— 走 terminal api
            terminal_api::create_tmux(state.inner(), backend, &tmux).await
                .map(serde_json::to_value)
                .and_then(|r| r.map_err(|e| e.to_string()))
        }
    }
}
```

**关键**：

- dispatcher 内部调 `terminal_api::create_tmux`（不是直接 `state.create_tmux`）
- session **不** import `services::tmux_session::*` 字段

## 4. 接缝契约

```typescript
// 前端 app/session/api.ts
import { invoke } from "@tauri-apps/api/core";

export async function createLocal(config: LocalSessionConfig) {
  return invoke<SessionInfo>("create_local_session", { config });
}
```

**接缝约束**：

- 前端只通过 `invoke('<command_name>')` 调 backend session api
- 前端 **不** import backend `commands::session::*`
- 业务逻辑（id 分配 / 日志启动 / session 插入）完全在 backend session module 内部

## 5. 不对外暴露

- `services/session_manager` 的字段 / DashMap —— 只能通过 `state.method()` 访问
- `commands/session/*` 内部 helper（如 `RealAppBackend::new` 构造）—— 只能在 module 内部使用
- `MAX_WRITE_PAYLOAD_BYTES` 常量 —— module 内部使用（IPC payload 校验）

## 6. api.rs 变更流程

1. **新增 IPC 命令** → 加 `commands/<domain>.rs` + 在 `api.rs` 加 `#[tauri::command]` wrapper
2. **修改命令签名** → 同步更新 `api.rs` + INTERFACE.md §2 + 前端 `app/session/api.ts` 类型
3. **删除命令** → 从 `commands/<domain>.rs` + `api.rs` + `all_handlers()` 一起删除
4. **新增跨 module 调用** → 在 §3 同步 + 在 frontend `app/session/api.ts` 同步

## 7. 关键的 IPC 契约

下列 payload key 是 frontend ↔ backend 契约的一部分，**禁止重命名**：

| 命令 | 参数名 | 原因 |
|---|---|---|
| `write_session` | `data` | `sessionService.writeSession({ sessionId, data })` |
| `upload_image_to_ssh_session` | `data` | `sessionService.uploadImageToSshSession(...)` |
| `create_local_session` | `config` | generic param name |
| `create_session` (generic) | `config` | 同上 |

详见 `app/session/DOWNSTREAM.md` §3 的 IPC contract 注释块。