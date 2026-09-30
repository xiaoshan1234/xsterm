# Services · Config — 对下依赖

> **位置**：`src-tauri/src/services/config/`
> **依赖层级**：核心配置服务——被多个 caller 依赖

## 1. 依赖图

```
services/config/mod.rs
├── services/config/store.rs        ConfigStore（包装 tauri-plugin-store）
├── services/config/defaults.rs     Settings::default() 默认值
└── models/config.rs                Settings + 子 struct

services/config/store.rs
├── tauri-plugin-store (Arc<Store>)
├── tauri::AppHandle + Emitter
├── serde_json
├── tokio::sync::RwLock
└── services::attach::AttachRegistry (联动)
```

## 2. 外部 crate 依赖

| crate | 用途 |
|---|---|
| `tauri-plugin-store` | JSON 持久化（已有，xsterm 现状） |
| `serde` | Settings 派生 |
| `serde_json` | patch 解析 + store API |
| `tokio` | async runtime |
| `tauri` | AppHandle + Emitter |

**删除**（RFC 0003-revised）：
- ❌ `toml`
- ❌ `notify`
- ❌ `notify-debouncer-full`
- ❌ `schemars`

## 3. 内部模块依赖

| 模块 | 来源 | 用途 |
|---|---|---|
| `models::config::Settings` + 子 struct | `models/config.rs` | 完整 schema 定义 |

## 4. 上游 caller

| caller | 调什么 | 何时 |
|---|---|---|
| `lib.rs::run()` setup | `ConfigStore::load(app)` | 启动 |
| `commands/persistence::load_settings` | `config_store.get()` | UI settings load |
| `commands/persistence::save_settings` | `config_store.write_full(settings)` | UI settings save 整替换 |
| `commands/persistence::patch_settings` | `config_store.write(patch)` | UI settings 部分改 |
| `commands/mcp::mcp_status` | `config_store.get().mcp` | MCP server 启动检查 |
| `commands/mcp::regenerate_mcp_token` | `config_store.write_full(new)` | token 重生成 |
| `commands/tunnel::tunnel_start` | `config_store.get().tunnel` | 启动反向隧道 |
| `services/attach` | `set_idle_timeout` | config 变化时联动 |
| `services/reverse_tunnel::start_if_enabled` | `config_store.get().tunnel` | 启动 |
| `services/logging_setup` | `config_store.get().logging` | log level 联动 |

## 5. 下游被调

| callee | 来源 | 何时 |
|---|---|---|
| `tauri_plugin_store::Store::get/set/save` | tauri-plugin-store | 读 / 写 settings.json |
| `tauri::Emitter::emit("config-reloaded", ...)` | tauri | reload 完成后 |
| `attach_registry.set_idle_timeout` | `services/attach/` | write 时联动 |
| `tunnel_handle.stop / start_if_enabled` | `services/reverse_tunnel/` | write 时联动 |
| `ssh_backend.notify_config_change` | `infrastructure/ssh/` | write 时联动（host_key_verify 变化） |
| `logging.reload_filter` | `services/logging_setup` | write 时联动（log level 变化） |

## 6. 不允许的依赖

- ❌ `services/config/*` → `services/session_manager / attach / subscribe / capture`（config 不感知 session 状态）
- ❌ `services/config/*` → `commands/*`（services 不依赖 commands）
- ❌ `services/config/*` → `mcp_server/*`（无 mcp_server module——RFC 0002-revised 删除）

## 7. config-reloaded 联动契约

每个联动模块实现一个 callback：

```rust
// services/attach/mod.rs
pub fn on_config_reloaded(settings: &Settings, registry: &AttachRegistry) {
    registry.set_idle_timeout(settings.mcp.idle_timeout_seconds);
}

// 在 lib.rs::run() 启动时注册
config_store.on_reloaded(|new_settings| {
    services::attach::on_config_reloaded(new_settings, &state.attach_registry);
    services::logging::on_config_reloaded(new_settings, &state.logging_handle);
    services::ssh_backend::on_config_reloaded(new_settings, &state.ssh_backend);
    services::reverse_tunnel::on_config_reloaded(new_settings, &state.tunnel_handle);
});
```

## 8. 强制约束（可机械校验）

```bash
# ❌ 不再有 toml 依赖
grep -rn 'toml::' src-tauri/src/services/config/
# 必须为空

# ❌ 不再有 notify 依赖
grep -rn 'notify::' src-tauri/src/services/config/
# 必须为空

# ❌ 不再有 schema migration
grep -rn 'migration::from_' src-tauri/src/services/config/
# 必须为空

# ❌ 不再有白名单
grep -rn 'whitelist\|WRITABLE_FIELDS' src-tauri/src/services/config/
# 必须为空

# Settings 字段必须有 default
grep -rnE 'pub\s+\w+:' src-tauri/src/models/config.rs
# 每行必须有 #[serde(default)] 紧邻（grep 上下文）

# config 不依赖 session / attach / subscribe / capture（除 attach 联动）
grep -rnE 'session_manager\.|subscribe_registry\.|capture::' src-tauri/src/services/config/ --include='*.rs' | grep -v 'tests\|//'
# 必须为空（除 attach_registry 在 apply_to_subsystems 内部）
```

## 9. 依赖变更流程

1. **新增上游 caller** → §4 加一行 + 检查 §6
2. **新增 Settings 字段** → models/config.rs 加 `#[serde(default)]` + README.md §4 + INTERFACE.md §2 同步
3. **修改 write 行为** → INTERFACE.md §2 同步 + 测试
4. **新增 config-reloaded 联动** → services/<module>/mod.rs 加 `on_config_reloaded` + 在 lib.rs::run() 注册