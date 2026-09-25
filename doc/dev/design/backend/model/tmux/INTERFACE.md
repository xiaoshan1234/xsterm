# Model · Tmux — 对外接口

> **位置**：`src-tauri/src/models/tmux/`
> **唯一进口**：`use crate::models::tmux::*;` 或精确 `use crate::models::tmux::types::TmuxCcConfig;`

## 1. 对外暴露什么

tmux domain 暴露 4 类符号:

1. **Types**——`TmuxCcConfig / TmuxSessionInit / TmuxWindowInit / TmuxPaneInit / TmuxControlWindowInit / AttachedTmuxServer / TmuxSshConfig`(预留)
2. **Accessor function**——`tmux_pane_info()`(pure helper,返回 SessionInfo)
3. **Error types**——`TmuxConfigError`(预留, MVP 不用)
4. **debug_redacted** helper(可选)

## 2. 核心接口

### 2.1 Types

```rust
use serde::{Deserialize, Serialize};

// ============ 创建 / attach tmux -CC controller 的配置 ============

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TmuxCcConfig {
    pub name: Option<String>,
    pub tmux_session_name: Option<String>,
    pub socket_name: Option<String>,
    pub base_config_id: Option<String>,
    pub start_command: Option<String>,
    pub env_config: Option<EnvConfig>,
    pub initial_rows: Option<u16>,
    pub initial_cols: Option<u16>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub ssh: Option<TmuxSshConfig>,
}

// SSH 配置(可选,空则本地 tmux)
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TmuxSshConfig {
    pub host: String,
    pub port: u16,
    pub user: String,
    // ... 与 SSHSessionConfig 类似
}

// ============ 同步返回的初始状态 ============

/// tmux controller 启动后**同步**返回的完整初始状态(IA: Initial-state Architecture)
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TmuxSessionInit {
    pub session: SessionInfo,           // bootstrap pane 的 SessionInfo
    pub windows: Vec<TmuxWindowInit>,
    pub panes: Vec<TmuxPaneInit>,
    pub control_window: TmuxControlWindowInit,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TmuxWindowInit {
    pub tmux_window_id: String,         // tmux "@N"
    pub name: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TmuxPaneInit {
    pub tmux_pane_id: String,           // tmux "%N"
    pub tmux_window_id: String,
    pub active: bool,
    pub title: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TmuxControlWindowInit {
    pub tmux_controller_id: u32,
    pub name: String,
}

// ============ 持久化的 attached server ============

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AttachedTmuxServer {
    pub session_name: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub socket_name: Option<String>,
    pub attached_at: u64,               // unix ms
}
```

### 2.2 Accessor functions

```rust
// models/tmux/accessor.rs
use crate::models::session::{SessionInfo, SessionType};
use crate::models::cross_cutting::types::CapabilityFlags;

/// 构造 tmux pane 的 SessionInfo(纯函数)
/// 
/// Parameters:
/// - `session_id` —— xsterm session id
/// - `controller_id` —— tmux controller id
/// - `tmux_pane_id` —— server-side tmux pane id (e.g. "%5")
/// - `session_name` —— tmux session name
/// - `name` —— xsterm session 显示名
/// - `is_hidden` —— 是否隐藏(true for attach 模式 bootstrap pane)
/// - `tmux_window_id` —— server-side tmux window id (e.g. "@5")
pub fn tmux_pane_info(
    session_id: u32,
    controller_id: u32,
    tmux_pane_id: String,
    session_name: Option<&str>,
    name: Option<&str>,
    is_hidden: bool,
    tmux_window_id: Option<&str>,
) -> SessionInfo {
    SessionInfo {
        id: session_id,
        name: name.unwrap_or("tmux").to_string(),
        session_type: SessionType::TmuxCc {
            controller_id,
            pane_id: tmux_pane_id.clone(),
            session_name: session_name.unwrap_or("default").to_string(),
            socket_name: None,
        },
        is_connected: true,
        capabilities: CapabilityFlags::for_tmux(),
        tmux_pane_id: Some(tmux_pane_id),
        tmux_controller_id: Some(controller_id),
        tmux_window_id: tmux_window_id.map(String::from),
        is_hidden,
    }
}

/// (debug) redact sensitive fields for log output
pub trait DebugRedacted {
    fn debug_redacted(&self) -> String;
}

impl DebugRedacted for TmuxCcConfig {
    fn debug_redacted(&self) -> String {
        // ssh password 等敏感字段被 redact
        format!("{:?}", self)  // stub
    }
}
```

### 2.3 Error types(预留)

```rust
// models/tmux/errors.rs(预留, MVP 不用)
use thiserror::Error;

#[derive(Debug, Error)]
pub enum TmuxConfigError {
    #[error("tmux_session_name is required")]
    MissingSessionName,

    #[error("ssh config is incomplete")]
    IncompleteSshConfig,

    #[error("invalid initial size: rows {0} cols {1}")]
    InvalidInitialSize(u16, u16),
}
```

## 3. 跨 domain 类型引用

```rust
// models/tmux/types.rs
use crate::models::session::{SessionInfo, SessionType};  // ← 允许:tmux_pane_info 返回 SessionInfo
use crate::models::settings::types::EnvConfig;          // ← 允许:TmuxCcConfig.env_config 字段

// models/tmux/accessor.rs
use crate::models::cross_cutting::types::CapabilityFlags;  // ← 允许:CapabilityFlags::for_tmux()
```

**关键**:
- tmux model **不** import session model 的**函数 / trait**(只引用 SessionInfo / SessionType 类型)
- tmux model **不** import settings model 的**函数 / trait**(只引用 EnvConfig 类型)
- tmux model **不** import 任何 service / app / infra

## 4. 接缝契约

```rust
// services/tmux/controller/spawn.rs
use crate::models::tmux::{TmuxCcConfig, TmuxSessionInit};

impl TmuxController {
    pub fn spawn_create(
        config: &TmuxCcConfig,           // ← models/tmux 类型
        // ...
    ) -> Result<Arc<Self>, String> {
        // ...
    }
}
```

```rust
// services/session/manager.rs
use crate::models::tmux::{TmuxCcConfig, AttachedTmuxServer, tmux_pane_info};

impl SessionManager {
    pub async fn create_tmux(
        &self,
        config: &TmuxCcConfig,           // ← models/tmux 类型
        backend: Arc<dyn AppBackend>,
    ) -> Result<TmuxSessionInit, String> {  // ← models/tmux 类型
        // ...
        let info = tmux_pane_info(session_id, controller_id, tmux_pane_id.clone(), ...);
        // ...
    }
}
```

```rust
// app/terminal/commands/tmux/session.rs
use crate::models::tmux::types::{TmuxCcConfig, TmuxSessionInit};

#[tauri::command]
pub async fn create_tmux_session(
    config: TmuxCcConfig,                // ← IPC 反序列化
    // ...
) -> Result<TmuxSessionInit, String> {  // ← IPC 序列化
    // ...
}
```

**接缝约束**:
- service / app / infra 都 import `models/tmux::*` 作为参数 / 返回类型
- 禁止 import `models/tmux` 的**内部**(子模块文件)
- 禁止 `models/tmux` import `services/*` 或 `app/*`

## 5. 不对外暴露

- `TmuxSessionInit` 的内部字段的 setter(只能通过 `tmux_pane_info()` 等 helper 构造)
- `AttachedTmuxServer.attached_at` 是时间戳,只能通过 service 的 `now_ms()` 间接赋值
- Tmux 控制命令构造细节(归 `services/tmux/protocol/wire.rs`)

## 6. api.rs 变更流程

1. **新增 TmuxCcConfig 字段** → 加 `types.rs` 字段 + §2.1 + frontend `model/tmux/types.ts` 同步
2. **新增 tmux pane helper** → 加 `accessor.rs` 函数 + §2.2
3. **新增 Error 变体** → 加 `errors.rs` 变体(预留)
4. **修改 tmux 协议常量**(port / 行数) → 在 types.rs 调整

## 7. 错误传播约定

- 模型层内部:目前返回 `Self`(无校验);未来返回 `Result<Self, TmuxConfigError>`(typed error)
- 模型层对外:`From<TmuxConfigError> for String` 在 `models/tmux/mod.rs` 根级实现(预留)
- service 层:`Result<T, TmuxError>`(typed error, 见 `services/tmux/errors.rs`)
- app 层:`Result<T, String>`(IPC 序列化)