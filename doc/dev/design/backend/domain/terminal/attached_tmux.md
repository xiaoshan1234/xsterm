# Domain · Terminal — Attached Tmux 持久化

> **位置**：`src-tauri/src/domain/terminal/attached_tmux.rs`
> **职责**：attached_tmux.json 的 typed wrapper + 进程级状态序列化
> **归属说明**：attached_tmux 是 tmux controller Arc 注册表的状态，**属于 tmux 业务的一部分**——v6 从原 `domain/terminal/attached_tmux.rs` 合并进来

## 1. 这个子模块负责什么

attached_tmux 子模块持有 **tmux controller 注册表的进程级状态**——只有 backend 进程里持有 `Arc<TmuxController>`，所以 shutdown/auto_attach 必须 backend 自己持久化。

**承担 2 类职责**：

1. **Save on shutdown** —— tmux controller 在 shutdown 时序列化 attached server 列表到 `attached_tmux.json`
2. **Load on startup** —— 启动时读 `attached_tmux.json`，遍历每个 server 调 `TmuxController::spawn_attach`，auto_attach 重连

**明确不做**：

- saved session configs（`sessions.json`）—— frontend 直存
- saved groups（`groups.json`）—— frontend 直存
- log_config（`log_config.json`）—— 归 `commands/shell` runtime

## 2. 为什么 attached_tmux 归 domain/terminal 而不归独立 persistence domain

| 原因 | 说明 |
|---|---|
| **attached_tmux 是 tmux 状态的一部分** | tmux controller 持有 `Arc<DashMap<u32, Arc<TmuxController>>` 注册表——attached server 列表是这个注册表的序列化投影 |
| **生命周期强耦合** | `TmuxController::spawn_attach()` 内部触发 save；`TmuxController::spawn_create()` / `detach()` / `close()` 内部触发 save——持久化跟 controller 生命周期绑死 |
| **不是 generic 抽象** | generic JSON IO layer（`save_json_value` / `load_json_value`）只服务 attached_tmux 一家——没有"机制层"价值 |
| **frontend persistence 是另一种东西** | frontend `service/persistence` 直存 sessions/groups/settings 是 frontend-only 多份配置；backend attached_tmux 是单份进程状态——职责**完全不重叠** |

## 3. 子模块结构

```rust
// domain/terminal/attached_tmux.rs
pub const ATTACHED_TMUX_FILE: &str = "attached_tmux.json";
pub const ATTACHED_TMUX_KEY: &str = "servers";

pub fn save_attached_tmux_typed(app: &AppHandle, servers: &[AttachedTmuxServer]) -> Result<(), String> {
    let value = serde_json::to_value(servers).map_err(|e| e.to_string())?;
    save_json_value(app, ATTACHED_TMUX_FILE, ATTACHED_TMUX_KEY, &value)
}

pub fn load_attached_tmux_typed(app: &AppHandle) -> Result<Vec<AttachedTmuxServer>, String> {
    let value = load_json_value(app, ATTACHED_TMUX_FILE, ATTACHED_TMUX_KEY)?
        .ok_or_else(|| "attached_tmux.json key missing".to_string())?;
    serde_json::from_value(value).map_err(|e| e.to_string())
}

// Generic JSON IO helper（v6 之前归 tauri_plugin_store::save_json_value（直接下沉到归属域），现在下沉到 domain/terminal/attached_tmux.rs 内部）
fn save_json_value(app: &AppHandle, file: &str, key: &str, value: &serde_json::Value) -> Result<(), String> {
    let store = app.store(file).map_err(|e| e.to_string())?;
    store.set(key, value.clone());
    store.save().map_err(|e| e.to_string())?;
    Ok(())
}

fn load_json_value(app: &AppHandle, file: &str, key: &str) -> Result<Option<serde_json::Value>, String> {
    let store = app.store(file).map_err(|e| e.to_string())?;
    Ok(store.get(key))
}
```

**关键**：

- typed wrapper 集中 `serde_json::from_value` 错误处理 + 隐藏 store key 字面量
- generic JSON IO helper **只在本文件内**——不再有独立的 `tauri_plugin_store::save_json_value（直接下沉到归属域）`
- 直接 import `tauri_plugin_store::StoreExt` —— terminal 现在是 backend 中**唯一**允许直接 import tauri-plugin-store 的 domain

## 4. 跟其他 domain 的关系

| domain / module | 关系 |
|---|---|
| `domain/terminal::TmuxController` | attached_tmux 子模块**内部调用**——`spawn_create()` / `detach()` / `close()` / `auto_attach_on_startup()` 触发 save/load |
| `domain/session` | **不依赖**——session 通过 `domain/terminal::TmuxPaneHandle` 间接引用 TmuxController |
| `infra/tauri::tauri-plugin-store` | terminal 是 backend 中**唯一**允许直接 import tauri_plugin_store 的 domain |
| `commands/terminal/api.rs` | 跨 module 调用时——通过 `commands/terminal/api.rs::save_attached_tmux_servers` 触发 `domain/terminal::api::save_attached_tmux` |

## 5. 跟 commands 的关系

| commands module | 怎么用 domain/terminal::attached_tmux |
|---|---|
| `commands/terminal` | `commands/terminal/api.rs::save_attached_tmux_servers` 调 `domain/terminal::api::save_attached_tmux`（shutdown 时） |
| `commands/terminal` | `commands/terminal/api.rs::auto_attach_tmux_servers` 调 `domain/terminal::api::load_attached_tmux`（启动时） |

**关键**：commands **不**直接调 attached_tmux 子模块——必须通过 `domain/terminal::api.rs::save_attached_tmux` 公开入口。

## 6. 这个子模块的"产品语言"术语

- **attached tmux server** —— 一个 `TmuxController` 实例 + 它的 socket 连接
- **server name** —— 唯一标识一个 attached server（controller 创建时分配）
- **auto_attach** —— 启动时根据 `attached_tmux.json` 自动重新连接之前 attach 过的 server
- **store file** —— tauri-plugin-store 的一个文件（如 `attached_tmux.json`）
- **store key** —— 文件内的字段名（如 `"servers"`）

## 7. 关键设计约束

### 7.1 attached_tmux 是 terminal 的"内部持久化"——不是 generic 机制

```rust
// domain/terminal/state.rs::TmuxController
impl TmuxController {
    pub async fn spawn_create(...) -> Result<(Arc<Self>, TmuxSessionInit), TmuxError> {
        // ... 创建 controller ...
        // 内部触发 save_attached_tmux_typed
        let servers = self.collect_attached_servers();
        crate::domain::terminal::attached_tmux::save_attached_tmux_typed(&self.app, &servers)?;
        Ok(...)
    }

    pub async fn detach(&self) -> Result<(), TmuxError> {
        // ... 断开连接 ...
        let servers = self.collect_attached_servers();
        crate::domain::terminal::attached_tmux::save_attached_tmux_typed(&self.app, &servers)?;
        Ok(())
    }
}
```

**关键**：TmuxController 生命周期内**自动**调用 attached_tmux save——**外部代码不需要手动调**。

### 7.2 store key 字面量集中在 attached_tmux.rs 内部

```rust
// domain/terminal/attached_tmux.rs
pub const ATTACHED_TMUX_FILE: &str = "attached_tmux.json";
pub const ATTACHED_TMUX_KEY: &str = "servers";
```

**关键**：文件路径 + store key 字面量集中在 attached_tmux.rs 的 const——避免散落在 commands / state 模块。

## 8. 错误处理

```rust
// domain/terminal/errors.rs（继承自原 domain/terminal）
#[derive(Debug, Error)]
pub enum TmuxError {
    // ... 其他错误 ...
    #[error("attached_tmux persistence failed: {0}")]
    AttachedTmuxPersistence(String),
    #[error("attached_tmux.json missing 'servers' key")]
    AttachedTmuxMissing,
    #[error("attached_tmux.json corrupt: {0}")]
    AttachedTmuxCorrupt(String),
}
```

## 9. 测试

```rust
#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn save_then_load_roundtrip() {
        let app = mock_app_handle();
        let servers = vec![
            AttachedTmuxServer::local("main"),
            AttachedTmuxServer::ssh("dev", "user@host"),
        ];
        save_attached_tmux_typed(&app, &servers).unwrap();
        let loaded = load_attached_tmux_typed(&app).unwrap();
        assert_eq!(loaded.len(), 2);
    }

    #[test]
    fn load_missing_file_returns_empty() {
        let app = mock_app_handle_fresh();
        let loaded = load_attached_tmux_typed(&app).unwrap();
        assert!(loaded.is_empty());
    }
}
```

## 10. MVP 范围之外（未来扩展）

| 功能 | 触发条件 |
|---|---|
| Schema migration | `AttachedTmuxServer` 加字段 |
| Store 损坏自动 fallback + 备份 | store 文件 corrupt 但不能丢数据 |
| 加密 store | saved tmux config 含 SSH key 等敏感信息 |
| Store 缓存 + 失效策略 | 频繁读 store 导致 IO 性能问题 |

## 11. 跟 frontend service 的职责分叉

| 维度 | frontend service/persistence | backend domain/terminal::attached_tmux |
|---|---|---|
| 类型定义 | TS interface + TS 类型 | Rust struct + serde derive |
| 状态机 | zustand store（前端持有镜像） | `Arc<DashMap>` TmuxController 注册表 |
| 持久化 store | frontend `infra/store` 直存 sessions/groups/settings | backend `infra/tauri::tauri-plugin-store` 直存 attached_tmux.json |
| 跨 module 协调 | 通过 `service/persistence` 调用 | 通过 `domain/terminal::TmuxController` 生命周期自动触发 |

frontend 和 backend persistence **职责分叉**——frontend 直存 frontend-only 配置；backend 直存 backend-only 进程状态。两边持久化**不重叠**。