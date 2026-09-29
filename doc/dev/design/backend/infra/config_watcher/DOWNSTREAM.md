# Module · Infra Config Watcher — 对下依赖

> **位置**：`src-tauri/src/infrastructure/config_watcher/`

## 1. 依赖图

```rust
config_watcher/
├── config.rs               ────►  serde::{Deserialize, Serialize}       (config.toml 序列化)
│                           ────►  schemars::JsonSchema                  (schema derive)
├── path.rs                 ────►  tauri::Manager::path()                (%APPDATA% 解析)
├── load.rs                 ────►  std::fs::read + toml::from_str        (启动期 read)
│                           ────►  jsonschema crate                      (schema 校验)
├── write.rs                ────►  std::fs::write + std::fs::rename       (atomic write)
│                           ────►  toml::to_string_pretty                (序列化)
├── schema.rs               ────►  schemars::schema_for!                (生成 JSON Schema)
├── watch.rs                ────►  notify::recommended_watcher          (文件监听)
│                           ────►  tokio::sync::mpsc                    (debounce channel)
├── migration.rs            ────►  std::fs (读 store.json)
│                           ────►  serde_json                           (解析旧 store)
└── errors.rs               ────►  thiserror::Error                      (ConfigError derive)
```

## 2. 外部 crate 依赖

| crate | 用途 | 备注 |
|---|---|---|
| `serde` | config 序列化 | 已存在 |
| `schemars` | JSON Schema derive from Rust types | **新增**——MVP 必须 |
| `toml` | TOML 解析 + 序列化 | **新增** |
| `notify` | 文件监听 | **新增** |
| `jsonschema` | schema 校验（独立 crate，不是 schemars） | **新增**——schema 校验独立用 |
| `tokio` | async runtime | 已存在 |
| `thiserror` | 错误派生 | 已存在 |
| `tracing` | watch reload 错误日志 | 已存在 |

## 3. 跟 backend module 的依赖

| module | 怎么用 |
|---|---|
| `commands/shell/api.rs::initialize` | 调 `infra::config_watcher::load::load_and_validate()` + `start_watcher()` + 启动期 migration |
| `commands/shell/commands/config.rs` | `read_config` / `write_config` / `watch_config_start` / `watch_config_stop` 4 个 IPC handler |
| `domain/session` | 启动期从 `Arc<RwLock<AppConfig>>` 读字段；不直接 import infra/config_watcher |
| `domain/terminal` | 同上 |
| `infra/tauri` | 通过 `AppBackend::emit("config-reloaded", ...)` 推送事件；不依赖 tauri runtime 直接 API |

## 4. 跨层依赖规则

- ❌ `infra/config_watcher` → `commands/*`（本模块是 commands 的依赖，不是反过来）
- ❌ `infra/config_watcher` → `domain/*`（domain 通过 `Arc<AppConfig>` state 读字段，不直 import infra）
- ❌ `infra/config_watcher` → `frontend/*`（通过 Tauri 事件单向通信）
- ✅ `infra/config_watcher` → `infra/tauri`（用 `AppBackend::emit`）
- ✅ `infra/config_watcher` → `crate::logging_setup`（写迁移日志 + reload 错误日志）

## 5. 内部依赖关系

```rust
config_watcher/
├── errors.rs               ← 被所有文件共享
├── path.rs                 ← 提供 path 解析（被 load / write / schema / watch / migration 用）
├── config.rs               ← AppConfig 类型定义（被 load / write / schema / watch / migration 用）
├── schema.rs               ← 用 config.rs 的 AppConfig derive 生成 JSON Schema
├── load.rs                 ← 用 path + config + schema 校验
├── write.rs                ← 用 path + config
├── watch.rs                ← 用 path + load（重新加载 + validate）+ emit
└── migration.rs            ← 用 path + config + load + write（旧 store.json → 新 config.toml）
```

**关键约束**：
- `config.rs` 是 leaf（被最多文件依赖）
- `errors.rs` 是 leaf（被最多文件依赖）
- `path.rs` 是 leaf（提供路径解析）
- 其他文件之间不互相依赖，全部走 `config.rs` / `errors.rs` / `path.rs` 三个 leaf

## 6. 设计意图：PRD §2 M9 完整方案 — backend 是 source of truth

反模式：frontend `service/persistence` 直存 `settings.json`（之前 v4 设计）—— 失去 PRD §2 M9 三个核心价值（手编 / 热加载 / schema 提示）。

**当前边界**（v4 改造后）：
- AppConfig 类型定义**全部**在 Rust `infra/config_watcher/config.rs`（schemars derive）
- schema.json 由 backend 启动期从 AppConfig 自动生成
- frontend 不持有 AppConfig 类型——通过 IPC payload 拿到 typed 对象
- frontend UI 改 settings → `invoke('write_config', { partial })` → backend 写 + emit reload
- frontend `config-reloaded` 事件订阅 → 重读 backend → 本地 store 同步

**唯一 source of truth = backend config.toml**。前端 store 是 mirror，永远可能跟 backend 不一致（emit reload 失败 / 用户手编 file）——这是 PRD §5 期望行为（高级用户手编 file 是 first-class）。

## 7. 强制约束（可机械校验）

```bash
# infra/config_watcher 是 backend 唯一允许直接 import notify / schemars / toml 的地方
grep -rn 'use notify\|use schemars\|use toml' src-tauri/src/ | grep -v 'src-tauri/src/infrastructure/config_watcher/' | grep -v 'src-tauri/src/lib.rs' | grep -v 'src-tauri/src/Cargo.toml'
# 必须为空

# config 解析只用 toml，不用 JSON
grep -rn 'serde_json.*from.*config\|json.*from_str.*config' src-tauri/src/infrastructure/config_watcher/
# 必须只出现于 migration.rs（处理旧 store.json 用）

# schema 校验失败必须拒绝启动（不降级）
grep -rn 'ConfigError::SchemaValidation' src-tauri/src/infrastructure/config_watcher/load.rs
# 必须 return Err，不返回 Ok(fallback)
```

## 8. 测试

- `config.rs` 类型 derive 单测（serde round-trip + schemars 生成）
- `path.rs` 路径解析单测（mock AppHandle）
- `load.rs` schema 校验失败单测（故意写错 config → 期望具体错误）
- `write.rs` atomic write 单测（tmp 文件 + rename 验证）
- `schema.rs` JSON Schema 生成 + 跟 AppConfig 字段一致
- `watch.rs` 集成测试（修改 tmp 文件 → watcher reload → emit 事件）
- `migration.rs` RFC 0003 迁移单测（旧 store.json → config.toml 字段映射 + .bak 生成 + 日志）

**为什么 config_watcher 测试最重要**：
- schema 校验是启动期 gate，bug = app 起不来
- atomic write bug = config 半截读，app 状态错乱
- watch debounce 不准 = 用户每次按键触发多次 reload，性能灾难
- 迁移脚本 bug = 旧用户 config 丢失

## 9. 依赖变更流程

1. **新增 AppConfig 字段** → 加字段 + Default impl + schema 自动更新 + frontend UI 表单同步
2. **修改字段类型** → ⚠️ breaking——启动期 schema 校验会拒绝旧 config；需写迁移脚本
3. **新增 IPC** → 加 `commands/shell/commands/config.rs::new_ipc` + INTERFACE.md §3 + frontend 对应
4. **升级 schemars / notify / toml crate 版本** → ⚠️ 跑兼容测试 + INTERFACE.md 同步

## 10. 安全警告

- **atomic write 是必需的**——非 atomic 写 → 用户读到半截 → app 启动失败 + 用户困惑
- **schema 校验不降级**——启动失败比静默错误好（PRD §6 G4）
- **watcher 文件路径必须验证**——防止 symlink 攻击（指向其他文件）
- **migration 保留 30 天 .bak**——出错可回退（PRD §5 R12）
- **reload 失败保留旧 config**——不 emit reload，不破坏 frontend 状态
- **不带凭据**——config.toml 跟 `attached_tmux.json` 一样不带 SSH password（避免泄漏）

## 11. 不允许的依赖

- ❌ `infra/config_watcher` → `commands/*`（本模块是 commands 的依赖）
- ❌ `infra/config_watcher` → `domain/*`（domain 通过 state 读字段）
- ❌ `infra/config_watcher` → `frontend/*`（通过 Tauri 事件单向通信）
- ❌ `infra/config_watcher` → `tauri::*` 直接 import（通过 `infra::tauri::AppBackend` trait 间接）
- ❌ `infra/config_watcher` → 直接 JSON schema validator 之外的 schema 库（统一用 schemars）
- ❌ `infra/config_watcher` → 直接 fs 操作之外的 IO 库
- ❌ `infra/config_watcher` → 任何 frontend 业务模块
