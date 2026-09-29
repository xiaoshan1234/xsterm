# Backend · Commands — 设计

> **位置**：`src-tauri/src/commands/`
> **职责**：Tauri IPC handlers（frontend invoke 入口）
> **拆分**：5 个 module（session / persistence / logging / mcp / tunnel）

## 1. 5 个 module 索引

| module | 命令数 | 职责 | 文档 |
|---|---|---|---|
| `session.rs` | 23 | 现有（create / close / write / resize / tmux / capture） | 现有源文件 |
| `persistence.rs` | 6 | 现有（save/load sessions / groups / attached_tmux） | 现有源文件 |
| `logging.rs` | 4 | 现有（log_message / get/set_log_config / get_log_dir） | 现有源文件 |
| `mcp.rs` | ⚠️ 简化（4） | 仅 attach / detach / mcp_status / regenerate_token | 本文档 §3 |
| `tunnel.rs` | ⭐ NEW (4) | tunnel_start / stop / status / generate_script | 本文档 §4 |
| `config.rs` | ⭐ NEW (2) | get_config / set_config | 本文档 §5 |

**⚠️ MCP 工具实现（12 工具）已移到 frontend `app/mcp/`**——详见 [`doc/dev/adr/0002-revised-mcp-frontend.md`](../../../adr/0002-revised-mcp-frontend.md)。backend `commands/mcp.rs` 只保留 attach 状态镜像的 4 个命令。

**all_handlers() 入口**（`commands/mod.rs`）：

```rust
pub fn all_handlers() -> impl Fn(tauri::ipc::Invoke) -> bool + Send + Sync + 'static {
    tauri::generate_handler![
        // ============ session ============
        session::create_local_session,
        session::create_ssh_session,
        session::create_tmux_session,
        session::probe_tmux_session_exists,
        session::create_session,
        session::write_session,
        session::resize_tmux_pane,
        session::resize_pty_session,
        session::resize_ssh_session,
        session::close_session,
        session::list_sessions,
        session::upload_image_to_ssh_session,
        session::get_session_output_channel,
        session::create_tmux_pane,
        session::kill_tmux_pane,
        session::create_tmux_window,
        session::kill_tmux_window,
        session::rename_tmux_window,
        session::attach_tmux_session,
        session::capture_tmux_pane,
        session::get_attached_tmux_servers,
        session::auto_attach_tmux_servers,
        session::detach_tmux_controller,
        session::kill_server_via_controller,
        session::unmark_attached_tmux,

        // ============ persistence ============
        persistence::save_sessions,
        persistence::load_sessions,
        persistence::save_groups,
        persistence::load_groups,
        persistence::save_attached_tmux_servers,
        persistence::load_attached_tmux_servers,

        // ============ logging ============
        logging::log_message,
        logging::get_log_config,
        logging::set_log_config,
        logging::get_log_dir,

        // ============ ⚠️ mcp（简化：4 个，仅 attach 状态镜像）============
        mcp::attach_session,
        mcp::detach_session,
        mcp::get_session_attach_state,
        mcp::list_attached_sessions,
        mcp::mcp_status,
        mcp::regenerate_mcp_token,

        // ============ ⭐ tunnel ============
        tunnel::tunnel_start,
        tunnel::tunnel_stop,
        tunnel::tunnel_status,
        tunnel::generate_tunnel_script,

        // ============ ⭐ config ============
        config::get_config,
        config::set_config,
    ]
}
```

## 2. 设计原则

### 2.1 每个命令的固定结构

```rust
#[tauri::command]
pub async fn <name>(
    <入参>: <Type>,
    state: State<'_, Arc<SessionManager>>,  // 或 ConfigStore / AttachRegistry 等
    app: AppHandle,
) -> Result<<返回 Type>, String> {
    // 1. 调 services/<module>::<fn>
    // 2. 错误转 String（Tauri IPC 标准）
    // 3. 返回 Result<T, String>
}
```

### 2.2 禁止

- ❌ 命令内 spawn 长跑任务（调 services）
- ❌ 命令持有可变全局状态（所有状态走 `State`）
- ❌ 命令跨 IPC 调用其他命令（共享走 services）
- ❌ 命令直接读 model state（model 是纯数据）

### 2.3 入参 / 返回约定

- **入参**：Rust 类型 → serde → JSON（自动）
- **返回**：`Result<T, String>`（T 必须是 serde Serializable）
- **特殊**：u32 session_id 在 IPC 上是 `number`；MCP mcp_session_id 是 `string`

## 3. `commands/mcp.rs` —— ⚠️ 简化（4 个命令）

**职责**：attach 状态的 IPC 镜像 + frontend MCP server 状态查询。

**为什么 backend 还要有 attach IPC**（frontend MCP 自己跑）：
- attach 状态唯一真相源在 backend `services::attach::AttachRegistry`（双层防御 + 持久化）
- frontend MCP attach_session / detach_session 通过 invoke 透传到 backend
- frontend UI "🤖 AI 接管" 按钮也通过 invoke 透传
- reverse_tunnel 远端 attach 也通过 invoke 透传

### 3.1 attach_session IPC

```rust
// commands/mcp.rs
#[tauri::command]
pub async fn attach_session(
    session_id: u32,
    client_id: String,        // frontend 传 "ui-takeover" 或 "mcp-<uuid>"
    attach_registry: State<'_, Arc<AttachRegistry>>,
) -> Result<(), String> {
    // 区分 source：UI takeover vs MCP attach
    let source = if client_id.starts_with("mcp-") {
        AttachSource::Mcp {
            client_id: client_id.clone(),
            agent_name: ctx.client_info().name,  // 来自 MCP initialize
            agent_pid: ctx.client_info().pid,
        }
    } else if client_id == "ui-takeover" {
        AttachSource::Ui { client_id }
    } else {
        return Err("invalid client_id format".to_string());
    };

    attach_registry.try_attach(session_id, source).map_err(|e| e.to_string())
}
```

**frontend 调用**：
```typescript
// frontend app/mcp/tools/attach_session.ts
import { invoke } from "@/infra/tauri/api";
await invoke("attach_session", { sessionId: 42, clientId: `mcp-${this.clientId}` });

// frontend app/session/usecases/ai_takeover/attach.ts
await invoke("attach_session", { sessionId: 42, clientId: "ui-takeover" });
```

### 3.2 detach_session IPC

```rust
#[tauri::command]
pub async fn detach_session(
    session_id: u32,
    client_id: String,
    attach_registry: State<'_, Arc<AttachRegistry>>,
) -> Result<(), String> {
    attach_registry.detach(session_id, &client_id).map_err(|e| e.to_string())
}
```

### 3.3 get_session_attach_state IPC

```rust
#[tauri::command]
pub async fn get_session_attach_state(
    session_id: u32,
    attach_registry: State<'_, Arc<AttachRegistry>>,
) -> Result<Option<AttachState>, String> {
    Ok(attach_registry.get(session_id))
}
```

**frontend 启动时拉一次**：所有 attach state 灌入本地 mirror state（`app/mcp/client_state.ts`）。

### 3.4 list_attached_sessions IPC

```rust
#[tauri::command]
pub async fn list_attached_sessions(
    attach_registry: State<'_, Arc<AttachRegistry>>,
) -> Result<Vec<(u32, AttachState)>, String> {
    Ok(attach_registry.list())
}
```

### 3.5 mcp_status IPC

```rust
#[tauri::command]
pub async fn mcp_status(
    config_store: State<'_, Arc<ConfigStore>>,
) -> Result<McpStatus, String> {
    let config = config_store.get().await;
    Ok(McpStatus {
        enabled: config.mcp.enabled,
        http_port: config.mcp.http.port,
        http_token_masked: mask_token(&config.mcp.http.token),
        http_enabled: config.mcp.http.enabled,
    })
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct McpStatus {
    pub enabled: bool,
    pub http_port: u16,
    pub http_token_masked: String,  // "abcd***wxyz"
    pub http_enabled: bool,
}
```

**frontend 启动时调一次**：决定是否启动 app/mcp HTTP server + 用哪个 port。

### 3.6 regenerate_mcp_token IPC

```rust
#[tauri::command]
pub async fn regenerate_mcp_token(
    config_store: State<'_, Arc<ConfigStore>>,
) -> Result<String, String> {
    let new_token = generate_random_token();
    let mut config = config_store.get().await;
    config.mcp.http.token = Some(new_token.clone());
    config_store.write_allowlist(config).await.map_err(|e| e.to_string())?;
    Ok(new_token)
}
```

**返回**：新 token 明文（仅此一次返回完整 token——之后只能拿到 masked）。

## 4. `commands/tunnel.rs` —— NEW

**职责**：反向隧道 IPC 暴露（frontend UI 启动 / 停止 / 查看状态 / 生成脚本）。

### 4.1 tunnel_start IPC

```rust
#[tauri::command]
pub async fn tunnel_start(
    config_store: State<'_, Arc<ConfigStore>>,
    session_manager: State<'_, Arc<SessionManager>>,
    attach_registry: State<'_, Arc<AttachRegistry>>,
    tunnel_handle: State<'_, Option<Arc<TunnelHandle>>>,
) -> Result<(), String> {
    let config = config_store.get().await;
    let new_handle = reverse_tunnel::start_if_enabled(
        &config,
        session_manager.inner().clone(),
        attach_registry.inner().clone(),
    ).await.map_err(|e| e.to_string())?;

    if let Some(old) = tunnel_handle.inner().as_ref() {
        old.stop();
    }
    *tunnel_handle.inner() = Some(Arc::new(new_handle));

    Ok(())
}
```

### 4.2 tunnel_stop IPC

```rust
#[tauri::command]
pub async fn tunnel_stop(
    tunnel_handle: State<'_, Option<Arc<TunnelHandle>>>,
) -> Result<(), String> {
    if let Some(handle) = tunnel_handle.inner().as_ref() {
        handle.stop();
        *tunnel_handle.inner() = None;
    }
    Ok(())
}
```

### 4.3 tunnel_status IPC

```rust
#[tauri::command]
pub async fn tunnel_status(
    tunnel_handle: State<'_, Option<Arc<TunnelHandle>>>,
) -> Result<TunnelStatus, String> {
    Ok(tunnel_handle.inner().as_ref()
        .map(|h| h.status())
        .unwrap_or(TunnelStatus::Disconnected))
}
```

### 4.4 generate_tunnel_script IPC

```rust
#[tauri::command]
pub async fn generate_tunnel_script(
    shell: String,  // "powershell" | "bash"
    config_store: State<'_, Arc<ConfigStore>>,
) -> Result<String, String> {
    let config = config_store.get().await;
    Ok(match shell.as_str() {
        "powershell" => reverse_tunnel::scripts::generate_powershell_script(&config.tunnel),
        "bash" => reverse_tunnel::scripts::generate_bash_script(&config.tunnel),
        _ => return Err(format!("unsupported shell: {shell}")),
    })
}
```

## 5. `commands/config.rs` —— NEW

**职责**：config.toml 直读 / 白名单写入（前端 settings UI）。

### 5.1 get_config IPC

```rust
#[tauri::command]
pub async fn get_config(
    config_store: State<'_, Arc<ConfigStore>>,
) -> Result<AppConfig, String> {
    Ok(config_store.get().await)
}
```

**返回**：完整 AppConfig（不脱敏——前端 UI 是受信的）。

### 5.2 set_config IPC

```rust
#[tauri::command]
pub async fn set_config(
    patch: serde_json::Value,
    config_store: State<'_, Arc<ConfigStore>>,
) -> Result<AppConfig, String> {
    whitelist::validate(&patch)?;
    let partial: PartialAppConfig = serde_json::from_value(patch)
        .map_err(|e| ConfigError::ValidationError(e.to_string()).to_string())?;
    let new_config = config_store.write_allowlist(partial).await
        .map_err(|e| e.to_string())?;
    Ok(new_config)
}
```

## 6. capabilities/default.json 扩展

Tauri 2 capability 需要更新（PR 添加新命令时）：

```json
{
  "permissions": [
    "core:default",
    "opener:default",
    "store:default",
    "clipboard-manager:default",
    "clipboard-manager:allow-read-image",
    "core:window:allow-minimize",
    "core:window:allow-maximize",
    "core:window:allow-unmaximize",
    "core:window:allow-close",
    "core:window:allow-is-maximized",
    "core:window:allow-start-dragging",
    "core:event:allow-listen",
    "core:event:allow-emit",
    "core:event:allow-unlisten"
  ]
}
```

## 7. 测试

每个命令 happy path + 错误分支：

```rust
#[tokio::test]
async fn attach_session_command() {
    let sm = test_session_manager();
    let ar = test_attach_registry();
    let session_id = sm.create_local(test_config(), Arc::new(MockBackend::new())).unwrap().id;

    let result = attach_session(session_id, "ui-takeover".into(), ar.clone()).await;
    assert!(result.is_ok());
    assert!(ar.get(session_id).is_some());
}
```

## 8. 强约束

```bash
# commands 不能 spawn 长跑任务
grep -rn 'tokio::spawn' src-tauri/src/commands/
# 必须为空（除 mock 测试）

# commands 不能跨 IPC 调用其他命令
grep -rn 'invoke' src-tauri/src/commands/
# 必须为空（除 mock 测试）

# commands 不能持有 Arc<Mutex<...>> 状态
grep -rnE 'Arc<Mutex|Arc<RwLock' src-tauri/src/commands/ --include='*.rs' | grep -v 'tests'
# 必须为空

# ❌ 不再有 commands/mcp::create_session 等 12 工具镜像
grep -rn 'list_sessions\|create_session\|send_keys\|capture_screen\|subscribe_output' src-tauri/src/commands/mcp.rs
# 必须为空（这些都在 frontend app/mcp/tools/）
```

## 9. 文档

- 现有源文件 + 增量变更在 PR diff
- [`backend/README §6`](../../README.md) — 跨语言 wire 契约
- [`doc/dev/adr/0002-revised-mcp-frontend.md`](../../../adr/0002-revised-mcp-frontend.md) — MCP 移到 frontend 的决策

## 10. 验收

- 5 module 全部按设计落地 ✅
- `commands/mcp` 仅 6 个命令（attach / detach / get_attach_state / list_attached / mcp_status / regenerate_token）✅
- 错误分支完整（每个命令至少 2 个错误码）✅
- Tauri capability 权限更新 ✅
- frontend `infra/tauri/commands/*` 同步更新 ✅
- frontend `app/mcp/tools/*` 12 工具同步落地（独立 PR）✅