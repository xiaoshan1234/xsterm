# Commands · Shell Config — IPC handlers

> **位置**：`src-tauri/src/commands/shell/commands/config/`（v5.1 新增）
> **类型**：⭐⭐ **新增 4 个 IPC**——PRD §2 M9 完整方案的 IPC 入口
> **被使用方**：`frontend/app/settings`（UI 表单提交）、`frontend/service/persistence/config.ts`（启动期 read + reload 订阅）、`frontend/app/shell`（启动期 initialize 链路）
> **Backend 实现**：实际工作委托给 [`../../../infrastructure/config_watcher/`](../../../infrastructure/config_watcher/RESPONSIBILITY.md) 子模块；本文件仅做 IPC handler 薄壳

## 1. 这个子模块负责什么

shell/config 子模块是 **PRD §2 M9 完整方案的 IPC 入口**——4 个 IPC 把 backend `infra/config_watcher/` 的能力暴露给 frontend：

| IPC | 调用方 | 行为 |
|---|---|---|
| `read_config` | frontend 启动 / UI 初始化 | 返回当前 `AppConfig`（backend state 持有） |
| `write_config` | frontend UI 表单提交 | merge partial + schema check + atomic write + emit `config-reloaded` |
| `watch_config_start` | frontend app/shell 启动时 | 启动 notify 后台 task（**MVP 默认启动,IPC 提供禁用能力**） |
| `watch_config_stop` | 高级用户暂停 watch | 关闭 notify 后台 task（高级 UI 用） |

**关键**：
- **不**做 schema 生成 / TOML 解析 / notify 监听——这些**全归 backend infra/config_watcher/**
- IPC handler **只做**参数提取 + State 注入 + 调 `infra::config_watcher::*` 公开函数 + 错误传播
- 跟其他 commands/shell 子模块（如 log_config）**同 pattern**：薄壳 + 委托 infra

## 2. 子结构

```rust
commands/shell/commands/config/
├── mod.rs                  re-export 4 个 IPC + 公共类型
├── read.rs                 #[tauri::command] read_config
├── write.rs                #[tauri::command] write_config(PartialAppConfig)
├── watch_start.rs          #[tauri::command] watch_config_start
├── watch_stop.rs           #[tauri::command] watch_config_stop
└── types.rs                PartialAppConfig + ConfigReloadedEvent（与 infra/config_watcher/INTERFACE 对齐）
```

## 3. 核心接口

### 3.1 read_config

```rust
#[tauri::command]
pub async fn read_config(
    state: State<'_, Arc<RwLock<AppConfig>>>,
) -> Result<AppConfig, String> {
    Ok(state.read().await.clone())
}
```

**frontend 对应**：
```typescript
import { invoke } from "@tauri-apps/api/core";
const config = await invoke<AppConfig>("read_config");
```

### 3.2 write_config

```rust
#[tauri::command]
pub async fn write_config(
    partial: PartialAppConfig,
    state: State<'_, Arc<RwLock<AppConfig>>>,
    app: AppHandle,
) -> Result<AppConfig, String> {
    let mut current = state.write().await;
    let new_config = infra::config_watcher::write::write_config_partial(&current, partial)
        .map_err(|e| e.to_string())?;
    *current = new_config.clone();
    infra::config_watcher::emit::emit_reload_event(&app, &new_config, ReloadSource::Manual);
    Ok(new_config)
}
```

**关键**：
- merge partial → schema check → atomic write → 更新 state → emit reload → 返回新 config
- 错误（schema 校验失败）→ `Err(String)` 给 frontend
- 成功 → emit `config-reloaded` 事件，frontend 监听后同步本地 store

**frontend 对应**：
```typescript
const newConfig = await invoke<AppConfig>("write_config", { partial: { fontSize: 16 } });
```

### 3.3 watch_config_start

```rust
#[tauri::command]
pub async fn watch_config_start(
    state: State<'_, Arc<Mutex<Option<RecommendedWatcher>>>>,
    app: AppHandle,
) -> Result<(), String> {
    let mut guard = state.lock().await;
    if guard.is_some() {
        return Ok(()); // idempotent: 已经在 watch
    }
    let watcher = infra::config_watcher::watch::start_watcher(app)
        .map_err(|e| e.to_string())?;
    *guard = Some(watcher);
    Ok(())
}
```

**关键**：MVP 启动时 `commands/shell/api::initialize` 自动调一次，frontend UI 不需要主动触发；这个 IPC 是给"高级用户想重启 watch"用。

### 3.4 watch_config_stop

```rust
#[tauri::command]
pub async fn watch_config_stop(
    state: State<'_, Arc<Mutex<Option<RecommendedWatcher>>>>,
) -> Result<(), String> {
    let mut guard = state.lock().await;
    if let Some(watcher) = guard.take() {
        infra::config_watcher::watch::stop_watcher(watcher);
    }
    Ok(())
}
```

## 4. 跨 module 协调

| 调用方 | 调什么 | 行为 |
|---|---|---|
| `commands/shell/api::initialize` | `infra::config_watcher::load::load_and_validate()` + `start_watcher()` + `migration::migrate_from_store_json()` | 启动期编排，**先于** log_config 初始化（schema 校验失败 → app 拒绝启动） |
| `commands/shell/commands/logging/config.rs` | （**不调 config IPC**） | log_config 是独立的 backend-only 持久化，不在 AppConfig 里 |

**关键**：config.toml + log_config.json 是**两个独立配置**——config.toml 是用户可见的 settings（PRD §2 M9），log_config.json 是 backend runtime tracing 配置（不影响用户行为）。

## 5. 跟 frontend 的关系

| frontend | 调 IPC | 收到 |
|---|---|---|
| `frontend/app/settings`（UI 表单） | `write_config` | 新 AppConfig + `config-reloaded` 事件 |
| `frontend/app/shell`（启动） | `read_config` | 当前 AppConfig |
| `frontend/service/persistence/config.ts`（订阅） | listen `config-reloaded` | ConfigReloadedEvent 包含新 AppConfig + ReloadSource |

## 6. 用户故事

- **作为用户**，我改 settings → UI 表单提交 → `write_config` → backend atomic write + emit reload → UI 立刻响应（不重启 app）
- **作为高级用户**，我在 VS Code 手编 `config.toml` → `notify watcher` 检测文件改动 → `load_and_validate` → schema check → emit reload → UI 自动同步
- **作为 CI/集成测试**，我故意写错 config → `load_and_validate` 返回 `SchemaError { line, column, field }` → `lib.rs::run` 拒绝启动 → 测试通过
- **作为开发者**，我重启 app → `initialize` 调 `read_config` + `start_watcher` → UI 渲染 + watcher 后台跑

## 7. 关键设计约束

### 7.1 错误处理统一

所有 IPC handler 错误返回 `Result<T, String>`（Tauri 默认 wire 格式）：
- `infra::config_watcher::ConfigError::SchemaValidation` → `e.to_string()`（已含 line/column/field 信息）
- `infra::config_watcher::ConfigError::Write` → `e.to_string()`
- `infra::config_watcher::ConfigError::Watch` → `e.to_string()`

### 7.2 watch_config_start idempotent

`watch_config_start` 重复调用是 no-op（已有 watcher 不重建）。MVP 启动期 + UI 主动调用都不会冲突。

### 7.3 启动期 vs runtime 调用 read_config

`commands/shell/api::initialize` 启动期**不**调 `read_config` IPC——它直接调 `infra::config_watcher::load::load_and_validate` 拿 config，注入 `Arc<RwLock<AppConfig>>` state。`read_config` IPC 是给 frontend **启动后**调（frontend 启动期也要读 config，但走 IPC 而不是直接 state 访问）。

## 8. 不允许的依赖

- ❌ `commands/shell/commands/config/*` → `infra/config_watcher` 内部字段（只通过 `infra::config_watcher::*` 公开函数访问）
- ❌ `commands/shell/commands/config/*` → `frontend/*`（frontend 通过 IPC 调，不是直接 import）
- ❌ `commands/shell/commands/config/*` → `tokio::main`（不是独立 binary）
- ❌ `commands/shell/commands/config/*` → 直接 `notify` / `toml` / `schemars` crate（这些全归 infra/config_watcher）

## 9. 文档地图

- 顶层：[`../../RESPONSIBILITY.md` §3 内部约定](../../RESPONSIBILITY.md)（IPC 薄壳 + api.rs + commands/ 的分工）
- 后端实现：[`../../../infrastructure/config_watcher/RESPONSIBILITY.md`](../../../infrastructure/config_watcher/RESPONSIBILITY.md)
- IPC API：[`../../../infrastructure/config_watcher/INTERFACE.md §3`](../../../infrastructure/config_watcher/INTERFACE.md)
- frontend 消费侧：[`../../../../frontend/service/persistence/RESPONSIBILITY.md §3`](../../../../frontend/service/persistence/RESPONSIBILITY.md)（config sync 通道）
- frontend UI 触发：[`../../../../frontend/app/settings/RESPONSIBILITY.md §1`](../../../../frontend/app/settings/RESPONSIBILITY.md)
- PRD：§2 M9 + §3 数据 + §5 R12 RFC 0003 + §6 G4 校验 + §7 启动流程
