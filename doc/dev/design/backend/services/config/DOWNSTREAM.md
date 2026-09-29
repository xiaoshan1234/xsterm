# Services · Config — 对下依赖

> **位置**：`src-tauri/src/services/config/`
> **依赖层级**：核心配置服务——被多个 caller 依赖

## 1. 依赖图

```
services/config/mod.rs
├── services/config/store.rs        ConfigStore
├── services/config/loader.rs       toml::from_str + validate
├── services/config/watcher.rs      notify 热更新
├── services/config/migration.rs    store.json → config.toml
├── services/config/whitelist.rs    字段过滤
└── models/config.rs                AppConfig + 子 struct

services/config/store.rs
├── models::config::AppConfig
├── tauri::AppHandle + Emitter
├── toml crate
├── serde_json
└── tokio::sync::RwLock

services/config/loader.rs
├── toml::from_str
├── serde_json
├── models::config::AppConfig
└── schemars (validate)

services/config/watcher.rs
├── notify crate
├── notify-debouncer-full
└── tokio::time

services/config/migration.rs
├── tauri-plugin-store (读旧 .json)
├── serde_json
└── toml crate
```

## 2. 外部 crate 依赖

| crate | 用途 |
|---|---|
| `toml` | config.toml 序列化 |
| `serde` | AppConfig 派生 |
| `serde_json` | patch 解析 + emit |
| `schemars` | AppConfig JSON Schema |
| `notify` | config.toml 热更新 |
| `notify-debouncer-full` | notify 事件去抖 |
| `tokio` | async runtime |
| `tauri-plugin-store` | 旧 store.json 读取（过渡期） |

## 3. 内部模块依赖

| 模块 | 来源 | 用途 |
|---|---|---|
| `models::config::AppConfig` + 子 struct | `models/config.rs` | 完整 schema 定义 |

## 4. 上游 caller

| caller | 调什么 | 何时 |
|---|---|---|
| `lib.rs::run()` setup | `ConfigStore::load(app)` + `start_watcher` | 启动 |
| `commands/config::get_config` | `config_store.get()` | UI settings |
| `commands/config::set_config` | `config_store.write_allowlist(patch)` | UI settings save |
| `mcp_server/tools/get_config` | `config_store.get()` | MCP 读 config |
| `mcp_server/tools/set_config` | `config_store.write_allowlist(patch)` | MCP 写 config |
| `mcp_server/tools/list_profiles` | `config_store.get().profiles.entries` | MCP list |
| `mcp_server::start` | `config_store.get().mcp` | 启动时读 mcp 配置 |
| `services/attach` | `set_idle_timeout` | config reload 联动 |
| `services/reverse_tunnel::start_if_enabled` | `config_store.get().tunnel` | 启动时读 tunnel |
| `services/logging_setup` | `config_store.get().logging` | 启动时读 logging |
| `services/ssh_session` | `config_store.get().ssh` | ssh host_key_verify |

## 5. 下游被调

| callee | 来源 | 何时 |
|---|---|---|
| `tauri::Emitter::emit("config-reloaded", ...)` | tauri | reload 完成后 |
| `attach_registry.set_idle_timeout` | `services/attach/` | reload 时联动 |
| `tunnel_handle.stop / start_if_enabled` | `services/reverse_tunnel/` | reload 时联动 |
| `ssh_backend.notify_config_change` | `infrastructure/ssh/` | reload 时联动（host_key_verify 变化） |
| `logging.reload_filter` | `services/logging_setup` | reload 时联动（log level 变化） |

## 6. 不允许的依赖

- ❌ `services/config/*` → `services/session_manager / attach / subscribe / capture`（config 不感知 session 状态）
- ❌ `services/config/*` → `commands/*`（services 不依赖 commands）
- ❌ `services/config/*` → `mcp_server/*`（config 是 MCP 的下层）

## 7. config-reloaded 事件订阅契约

每个联动模块实现一个 callback：

```rust
// services/attach/mod.rs
pub fn on_config_reloaded(config: &AppConfig, registry: &AttachRegistry) {
    registry.set_idle_timeout(config.mcp.idle_timeout.seconds);
}

// 注册到 ConfigStore
config_store.on_reloaded(|new_config| {
    services::attach::on_config_reloaded(new_config, &state.attach_registry);
    services::logging::on_config_reloaded(new_config, &state.logging_handle);
    // ...
});
```

## 8. 强制约束

```bash
# config 写入必须经过 whitelist
grep -rn 'config_store\.write\|config\.write' src-tauri/src/ --include='*.rs' | grep -v 'whitelist\|tests\|//'
# 必须只出现在 services/config/whitelist.rs / commands/config.rs / mcp_server/tools/set_config.rs

# migration 是 idempotent
grep -rn 'migration::from_store_json' src-tauri/src/ --include='*.rs'
# 必须只出现在 services/config/store.rs::load

# notify watcher 不允许 duplicate spawn
grep -rn 'start_watcher' src-tauri/src/ --include='*.rs'
# 必须只出现在 lib.rs::run() 的 setup block

# config 不依赖 session / attach / subscribe
grep -rnE 'session_manager\.|attach_registry\.|subscribe_registry\.' src-tauri/src/services/config/ --include='*.rs' | grep -v 'tests\|//'
# 必须为空
```

## 9. 依赖变更流程

1. **新增上游 caller** → §4 加一行 + 检查 §6
2. **新增 AppConfig 字段** → models/config.rs + Default + 白名单更新（如可写）+ README + INTERFACE.md
3. **修改 write_allowlist 行为** → 同步 INTERFACE.md + whitelist + 测试
4. **新增 config-reloaded 联动** → 在 services/<module>/mod.rs 加 `on_config_reloaded` + 在 lib.rs::run() 注册