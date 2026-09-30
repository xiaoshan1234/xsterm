# RFC 0006: services 精简——下沉无状态 module

| 字段 | 值 |
|---|---|
| 状态 | Accepted |
| 日期 | 2026-09-29 |
| 作者 | dev（基于用户反馈） |
| 影响阶段 | 所有未来 service 设计 |
| 决策 | services 只保留"真有状态需要集中管理"的 module |

---

## 1. 背景

最初设计 backend services 时，按 frontend domain 5 + 1 个 mcp_server 镜像成 9 个 service 子 module：
- attach / subscribe / capture / config / reverse_tunnel（5 个新）
- local_session / ssh_session / tmux_session / session_log / session_manager（5 个现有）

**问题**：不是每个 service 都"真有状态需要集中管理"。具体：

| module | 真有状态? | 实际作用 | 问题 |
|---|---|---|---|
| `services/attach` | ✅ DashMap<u32, AttachState> | 独占状态机 + 互斥 CAS | 必要 |
| `services/subscribe` | ✅ DashMap<u32, Arc<OutputRing>> | 跨 session 全局索引 + 环形缓冲 | 必要（用户确认） |
| `services/reverse_tunnel` | ✅ TunnelHandle + 重连 task | 长跑 task + 状态机 | 必要 |
| `services/session_manager` | ✅ DashMap<u32, Arc<ActiveSession>> | 核心注册表 | 必要 |
| `services/local_session / ssh_session / tmux_session / session_log` | ✅ 句柄持有 | PTY/russh/tmux 句柄 | 必要（已有） |
| `services/config` | ❌ 无自有状态 | 包装 tauri-plugin-store | **过度抽象** |
| `services/capture` | ❌ 无自有状态 | 纯函数（strip_ansi regex） | **过度抽象** |

## 2. 决策

**services 只保留"真有状态需要集中管理"的 module**。无状态的 module 下沉：

- ❌ **下沉到 model**（纯算法 / pure function）—— `services/capture/` → `models/capture.rs`
- ❌ **下沉到 commands**（包装 IO / 跟外部库绑定）—— `services/config/` → `commands/persistence.rs` 扩展

## 3. 调整后 services 精简到 6 个 module

```
src-tauri/src/services/
├── mod.rs                            6 行 re-exports
│
├── session_manager.rs                ⭐ 核心注册表（扩展字段 attach_registry / subscribe_registry / profiles）
│
├── local_session/                    ✅ PTY handle 持有 + read_loop
├── ssh_session/                      ✅ russh channel 持有
├── tmux_session/                     ✅ tmux controller 持有
├── session_log.rs                    ✅ tracing 文件 writer
│
├── attach/                           ✅ DashMap<u32, AttachState> 状态机 + 60min idle timeout
└── subscribe/                        ✅ DashMap<u32, Arc<OutputRing>> 全局索引 + 环形缓冲 + fan-out

reverse_tunnel/                       ✅ TunnelHandle + 重连 task
```

**删除**（无状态，下沉）：
- ❌ `services/config/` —— 包装 tauri-plugin-store，无自有状态
- ❌ `services/capture/` —— pure function（strip_ansi + 文本处理）
- ❌ `services/session_manager_extension.md` —— 设计文档，合并到 backend/README.md §4

## 4. 下沉到哪里？

### 4.1 capture → `models/capture.rs`

**理由**：capture 是**纯算法**（regex strip_ansi + 文本处理），没状态、没 IO、没长跑 task。

```rust
// models/capture.rs —— pure functions
pub enum CaptureMode { Text, Ansi, Screenshot }

pub fn capture_text(bytes: &[u8], lines: usize) -> String {
    // strip ANSI 转义
    strip_ansi(bytes)
}

pub fn capture_ansi(bytes: &[u8], lines: usize) -> String {
    String::from_utf8_lossy(bytes).into_owned()
}

pub fn strip_ansi(bytes: &[u8]) -> String {
    let text = String::from_utf8_lossy(bytes);
    let ansi_re = regex::Regex::new(r"\x1b\[[0-9;?]*[a-zA-Z]|\x1b\][^\x07]*\x07").unwrap();
    ansi_re.replace_all(&text, "").into_owned()
}
```

**调用链**（frontend MCP `capture_screen` tool）：
```
frontend app/mcp/tools/capture_screen.ts
    ↓
invoke('capture_text', { sessionId, lines })
    ↓ Tauri IPC
backend commands/session::capture_text(session_id, lines)
    ↓
1. session_manager.capture_text(session_id, lines)
   ├─ tmux → tmux capture-pane backend 命令
   └─ 其他 → services::subscribe::OutputRing::tail(n) 拿最近 N 行 bytes
2. models::capture::strip_ansi(bytes)  ⭐ 算法在此
3. return String
```

**关键**：capture 算法在 `models/`，IO 在 `commands/`，PTY 数据在 `services::subscribe::OutputRing`——**职责清晰分层**。

### 4.2 config → `commands/persistence.rs` 扩展

**理由**：config service 只是包装 `tauri-plugin-store` API + 触发 apply_to_subsystems callback。**没自有状态**——所有状态都在 store 里（store 自管）。

```rust
// commands/persistence.rs —— 扩展
const SETTINGS_STORE: &str = "settings.json";
const SETTINGS_KEY: &str = "settings";

#[tauri::command]
pub async fn load_settings(app: AppHandle) -> Result<Settings, String> {
    let store = app.store(SETTINGS_STORE).map_err_string()?;
    match store.get(SETTINGS_KEY) {
        Some(value) => serde_json::from_value::<Settings>(value.clone()).map_err_string(),
        None => Ok(Settings::default()),
    }
}

#[tauri::command]
pub async fn save_settings(
    settings: Settings,
    app: AppHandle,
) -> Result<(), String> {
    let store = app.store(SETTINGS_STORE).map_err_string()?;
    store.set(SETTINGS_KEY, serde_json::to_value(settings).map_err_string()?);
    store.save().map_err_string()?;

    // ⭐ 联动更新（之前是 services/config::apply_to_subsystems）
    after_settings_changed(&app).await?;

    Ok(())
}

#[tauri::command]
pub async fn patch_settings(
    patch: serde_json::Value,
    app: AppHandle,
) -> Result<Settings, String> {
    // merge + save + emit config-reloaded
    let mut settings = load_settings_internal(&app).await?;
    merge_patch(&mut settings, patch);
    save_settings_internal(&app, settings.clone()).await?;

    // ⭐ 联动更新
    after_settings_changed(&app).await?;

    // ⭐ emit config-reloaded 事件
    app.emit("config-reloaded", ConfigReloadedEvent {
        config: settings.clone(),
        source: ConfigReloadedSource::ManualWrite,
    })?;

    Ok(settings)
}

async fn after_settings_changed(app: &AppHandle) -> Result<(), String> {
    // 1. attach idle_timeout
    if let Some(attach_registry) = app.try_state::<Arc<AttachRegistry>>() {
        let settings = load_settings_internal(app).await?;
        attach_registry.set_idle_timeout(settings.mcp.idle_timeout_seconds);
    }

    // 2. log level
    if let Some(logging) = app.try_state::<Arc<LoggingHandle>>() {
        let settings = load_settings_internal(app).await?;
        logging.reload_filter(&settings.log_level)?;
    }

    // 3. ssh host_key_verify（如果改了，需要 reconnect）
    if let Some(ssh_backend) = app.try_state::<Arc<SshBackendImpl>>() {
        let settings = load_settings_internal(app).await?;
        ssh_backend.notify_config_change(&settings.ssh).await?;
    }

    // 4. tunnel enable/disable
    if let Some(tunnel_handle) = app.try_state::<Option<Arc<TunnelHandle>>>() {
        let settings = load_settings_internal(app).await?;
        if settings.tunnel.enabled {
            if tunnel_handle.is_none() {
                // start
                let new_handle = reverse_tunnel::start_if_enabled(...).await?;
                app.manage(Some(Arc::new(new_handle)));
            }
        } else if tunnel_handle.is_some() {
            // stop
            if let Some(h) = tunnel_handle.as_ref() {
                h.stop();
            }
            app.manage::<Option<Arc<TunnelHandle>>>(None);
        }
    }

    Ok(())
}
```

**关键**：
- ❌ 不再有 `services/config/ConfigStore` class —— 只剩 `commands/persistence` 几个 IPC 函数
- ✅ "联动更新"概念保留，但作为 `after_settings_changed` helper 函数，不是独立 service
- ✅ frontend 调 `invoke('load_settings')` / `invoke('save_settings', ...)` / `invoke('patch_settings', ...)` —— IPC 边界清晰

### 4.3 session_manager_extension.md → backend/README.md §4

**理由**：设计文档与 README 重叠，独立文件增加维护成本。

**合并到 backend/README.md §4 "核心注册表扩展"**，约 200 行集中说明：
- SessionManager 扩展字段（attach_registry / subscribe_registry / profiles / quota / session_id_index）
- SessionBackend trait 扩展（capture_text / capture_ansi）
- write() 权限检查集成
- close() 清理逻辑
- mcp_session_id 双向映射

**`session_manager_extension.md` 归档**到 `doc/dev/history/services-simplification-rfc-0006/`。

## 5. 调整后的依赖图

```
commands/                  ⭐ 新增 capture_text IPC + settings 读写 IPC
├── session.rs
├── persistence.rs            ⭐ 扩展 load_settings / save_settings / patch_settings + after_settings_changed
├── logging.rs
├── mcp.rs                    ⭐ 简化（attach / detach / mcp_status）
├── tunnel.rs
└── ~~config.rs~~             ❌ 删除

services/                  ⭐ 精简到 6 个 module
├── session_manager.rs        ⭐ 扩展字段
├── local_session/
├── ssh_session/
├── tmux_session/
├── session_log.rs
├── attach/                   ⭐ 真状态（DashMap）
├── subscribe/                ⭐ 真状态（DashMap + OutputRing）
└── reverse_tunnel/           ⭐ 真状态（TunnelHandle）
  ❌ config/                   下沉到 commands/persistence
  ❌ capture/                  下沉到 models/capture

models/                    ⭐ 新增 capture.rs
├── session.rs
├── capabilities.rs
├── group.rs
├── attach.rs
├── subscription.rs
├── profile.rs
├── config.rs
├── capture.rs                ⭐ NEW（pure function：strip_ansi + capture_text/ansi）
└── ~~mcp.rs~~                ❌ 删除（移到 frontend）
```

**依赖方向**（不变）：
```
commands ─┬──► services ──► infrastructure
          │             ╲
          │              ╰──► models
          ╰──► models
```

## 6. 关键设计原则（适用于所有未来 service 设计）

### 6.1 3 问判断 service 是否该存在

```
问 1: 这个 module 持有可变状态吗？（DashMap / Mutex / Atomic* / 长跑 task handle）
  ├─ 是 → service ✅
  └─ 否 → 问 2

问 2: 这个 module 是 pure function / pure data transform 吗？
  ├─ 是 → model ✅
  └─ 否 → 问 3

问 3: 这个 module 是 IO wrapper（包装外部库 API）吗？
  ├─ 是 → commands 或 infrastructure ✅
  └─ 否 → 重新评估
```

### 6.2 避免"层级洁癖"

不为了"每层对应"硬拆 module。例如：
- ❌ "frontend 有 6 个 module → backend 也要 6 个 service" → 错！frontend 的 ui/service/infra/... 是按"产品功能"切分，backend 按"状态"切分
- ❌ "每个 frontend service 都对应 backend service" → 错！frontend service 是 zustand store（frontend 状态），backend 状态是独立的

### 6.3 service 的边界判定

**真正需要 service** 的标志（满足任一）：
1. 持有跨调用的可变状态（DashMap / Mutex）
2. 长跑 task（tokio::spawn 后台循环）
3. 跨多 module 共享的全局索引（registry pattern）
4. 复杂的内部状态机（attach / tunnel）

**不需要 service** 的反例：
- 只是 API wrapper（→ commands）
- 纯算法 / 数据 transform（→ models）
- 只是 IO 句柄持有 + 简单 read/write（→ infrastructure）

## 7. 影响

### 7.1 删除

- `src-tauri/src/services/config/` 整个 module
  - `mod.rs` / `store.rs` / `defaults.rs`
  - 配套 `services/config/INTERFACE.md` / `services/config/DOWNSTREAM.md` / `services/config/README.md`
- `src-tauri/src/services/capture/` 整个 module
  - `mod.rs` / `text.rs` / `ansi.rs` / `screenshot.rs` / `fallback.rs`
  - 配套 3 份 docs
- `src-tauri/src/services/session_manager_extension.md`（设计文档）

### 7.2 新增 / 重写

- `src-tauri/src/models/capture.rs`（pure functions）
- `src-tauri/src/commands/persistence.rs` 扩展：
  - `load_settings` / `save_settings` / `patch_settings` IPC
  - `after_settings_changed(app)` helper 函数
- `src-tauri/src/commands/session.rs` 扩展：
  - `capture_text` IPC（接 models::capture::strip_ansi + services::subscribe::OutputRing::tail）
  - `capture_ansi` IPC
  - `capture_screenshot` IPC（MVP 报错 UnsupportedMode）

### 7.3 文档调整

- 归档 `doc/dev/design/backend/services/config/` 到 `doc/dev/history/services-simplification-rfc-0006/services-config/`
- 归档 `doc/dev/design/backend/services/capture/` 到 `doc/dev/history/services-simplification-rfc-0006/services-capture/`
- 归档 `doc/dev/design/backend/services/session_manager_extension.md` 到 `doc/dev/history/services-simplification-rfc-0006/`
- 重写 `doc/dev/design/backend/README.md` §4 "核心注册表扩展"（合并 session_manager_extension 内容）
- 重写 `doc/dev/design/backend/services/README.md`（精简到 6 个 module）
- 重写 `doc/dev/design/backend/models/README.md`（新增 capture.rs）
- 更新 `doc/dev/design/backend/commands/README.md`（新增 capture_text IPC + settings IPC 内联说明）
- 更新 `doc/dev/roadmap/target-architecture.md` §4（合并 session_manager_extension）

### 7.4 净收益

- **backend services module 数**：9 → 6（-3 module）
- **backend docs**：21 → 16（-5 份，含 3 份 services/config + 3 份 services/capture 合并到 README + session_manager_extension.md 合并）
- **代码**：-500 行（services/config + services/capture boilerplate 删）
- **Cargo 依赖**：不变（RFC 0003-revised 已删 toml/notify）
- **build time -3%**

## 8. 演进路径

未来如果新增 service，先过 3 问判定（§6.1）：
- 满足任一 → services/
- 不满足 → 下沉到 models/ 或 commands/

**反例（不要做）**：
- ❌ `services/session_log` —— 是 file writer 没错，但只是 IO 包装。已存在，不动（历史包袱）。但**未来新增 logging 类不要建 service**
- ❌ `services/keybindings` —— pure function（按键 → 命令映射），应该放 models 或 frontend store
- ❌ `services/themes` —— 静态数据 + theme 切换 trigger，应该放 commands + settings store

## 9. 验收

- services 6 个 module 全部有"真状态需要管理"的明确理由 ✅
- models/capture.rs 是 pure functions（无 IO / 无状态） ✅
- commands/persistence.rs 包含 settings IPC + after_settings_changed 联动 ✅
- 3 问判定原则写入 backend/README.md 顶部（预防未来过度抽象） ✅
- backend docs 从 21 份精简到 16 份（-24%） ✅
- 所有 PRD §2 M1-M11 功能不变 ✅

## 10. 关联文档

- 现有：RFC 0002-revised（MCP 移到 frontend）+ RFC 0003-revised（保留 JSON）
- 新增：本文档 RFC 0006（services 精简）
- frontend 对应：frontend 5 层架构不变（frontend 按"产品功能"切分，backend 按"状态"切分——分层原则不同）

签字：
- [x] dev — 2026-09-29
- [ ] tm
- [ ] pdm