# Model · Settings — 职责

> **位置**：`src-tauri/src/models/settings/`
> **类型**：⭐ 横切 domain — settings 字段的纯类型
> **被使用方**：`services/settings`(只管 log_config)、`app/session`(saved config 序列化)、`commands/persistence.rs`(MVP)
> **Frontend 对应**：[`../../../frontend/model/settings/RESPONSIBILITY.md`](../../../frontend/model/settings/RESPONSIBILITY.md)

## 1. 这个 domain 负责什么

settings model 定义 **backend 侧的所有 settings 字段的纯类型**。

承担 4 类职责:

1. **LogConfig 类型**——`{ log_level, max_log_files, max_file_size }`(backend settings 唯一持有)
2. **Session 配置字段**——`SizingMode / DisplayConfig / EnvConfig`(嵌入 LocalSessionConfig / SSHSessionConfig)
3. **持久化 saved config 类型**——`SavedSessionConfigV1 / SavedSessionConfigKind`(持久化形态,跨 IPC 边界)
4. **构建 helper**——`build_remote_image_path(filename) -> String`(MVP 在 session.rs 内,v1 迁到 cross_cutting)

**MVP 范围**:backend settings 只管 LogConfig + saved config 类型。其他 settings 字段(theme / font / sidebar width / defaultShell 等)只在前端 store 维护。

## 2. 这个 domain **不**负责什么

- **不持有运行时 settings store**——backend settings 不缓存,每次读 disk
- **不渲染 UI**——backend 无 UI
- **不存 theme / font**——MVP backend 不持有这些字段
- **不实现 LogConfig 持久化**——持久化归 `services/persistence/`(未来)+ `services/settings/api.rs`(MVP)
- **不持有 Session 元数据**——session 归 `models/session/`

## 3. 子结构

```
models/settings/
├── mod.rs               re-export types / accessor / rules / errors
├── types.rs             LogConfig / SizingMode / DisplayConfig / EnvConfig / SavedSessionConfigV1 / SavedSessionConfigKind
├── accessor.rs          get_default_log_level / get_effective_log_config
├── rules.rs             merge_defaults / validate_log_config
└── errors.rs            SettingsError(thiserror)
```

## 4. v0 → v1 拆分映射

| v0 位置(在 session.rs) | v1 位置 | 改动 |
|---|---|---|
| `SizingMode` enum (line 590) | `models/settings/types.rs::SizingMode` | 迁入 |
| `DisplayConfig` (line 600) | `models/settings/types.rs::DisplayConfig` | 迁入 |
| `EnvConfig` (line 671) | `models/settings/types.rs::EnvConfig` | 迁入 |
| `SavedSessionConfigV1` (line 710) | `models/settings/types.rs::SavedSessionConfigV1` | 迁入 |
| `SavedSessionConfigKind` (line 729) | `models/settings/types.rs::SavedSessionConfigKind` | 迁入 |

**关键**:v0 的 `models/session.rs` 内含 5 个 settings 专属类型——v1 全部迁到 `models/settings/`。

**LogConfig 当前在 `crate::logging_setup.rs`**(infra-level 工具)——v1 决策:**保留在 `logging_setup.rs`**(理由:`LogConfig` 是 logging_setup 的核心数据结构;settings domain re-export 它)。

## 5. 跟其他 model domain 的关系

| domain | 关系 |
|---|---|
| `models/session` | session 通过 `LocalSessionConfig.env_config / display_config` 字段引用本 domain 的类型(纯类型字段) |
| `models/tmux` | tmux 通过 `TmuxCcConfig.env_config` 字段引用本 domain 的类型 |
| `models/workspace` | settings **不依赖** workspace |
| `models/cross_cutting` | settings **不依赖** cross_cutting(settings 是横切 domain 之一) |

**关键约束**:
- settings model **不** import 其他 domain 的函数 / trait
- settings model **不** import `services/*` / `app/*` / `infrastructure/*`

## 6. 跟 service / app / infra 的关系

| 层 | 怎么用 models/settings |
|---|---|
| `services/settings` | `LogConfig` 是 load/save/apply 的入参 / 返回类型 |
| `services/session` | 通过 `LocalSessionConfig.env_config / display_config` 字段引用 |
| `services/tmux` | 通过 `TmuxCcConfig.env_config` 字段引用 |
| `app/session` | `SavedSessionConfigV1` 是 saved_session_config IPC 返回类型(未来)|
| `app/settings` | `LogConfig` 是 `set_log_config / get_log_config` IPC 类型 |
| `commands/persistence.rs` (MVP) | `GroupStore` 已经迁出(v0 group.rs → models/workspace/types.rs) |
| `commands/logging.rs` (MVP) | `LogConfig` 是 IPC 类型 |
| `crate::logging_setup` | `LogConfig` 类型当前定义在此(settings re-export) |

## 7. 这个 domain 的"产品语言"术语

- **LogConfig** —— log 配置:`{ log_level: String, max_log_files: u32, max_file_size: u64 }`
- **SizingMode** —— session 布局模式:`Fit`(fit terminal size) / `Fixed`(固定行列)
- **DisplayConfig** —— runtime display patch:`{ font_family, font_size, theme_id, ... }`
- **EnvConfig** —— 环境变量配置:`{ vars: HashMap<String, String> }`
- **SavedSessionConfigV1** —— 持久化的 saved config(包含 v1 版本号,支持未来 schema migration)
- **SavedSessionConfigKind** —— saved config 的类型:`Local` / `Ssh` / `TmuxCc`

## 8. 关键设计约束

### 8.1 types 必须 Serialize + Deserialize(IPC 序列化)

```rust
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DisplayConfig {
    pub font_family: String,
    pub font_size: u16,
    pub theme_id: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub cursor_blink: Option<bool>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EnvConfig {
    pub vars: HashMap<String, String>,
}
```

### 8.2 LogConfig 当前在 logging_setup.rs(v1 暂不迁)

```rust
// src-tauri/src/logging_setup.rs(现状)
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LogConfig {
    pub log_level: String,
    pub max_log_files: u32,
    pub max_file_size: u64,
}
```

**v1 决策**:`LogConfig` 暂留 `crate::logging_setup`——因为它是 logging_setup 的核心数据结构(rolling writer 初始化参数)。settings model 通过 `pub use crate::logging_setup::LogConfig;` re-export。

**未来迁移路径**(如果 settings domain 扩展到全字段):
1. 把 `LogConfig` 移到 `models/settings/types.rs`
2. `crate::logging_setup` 只保留 `init_logging / cleanup_old_logs` 函数
3. service/settings 通过 `models/settings::types::LogConfig` 引用

### 8.3 saved config 支持 schema migration(v1 命名约定)

```rust
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SavedSessionConfigV1 {
    pub version: u32,                  // = 1 (预留 schema migration)
    pub id: String,
    pub name: String,
    pub kind: SavedSessionConfigKind,
    pub base_config_id: Option<String>,
    // ...
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "camelCase")]
pub enum SavedSessionConfigKind {
    Local(LocalSessionConfig),
    Ssh(SSHSessionConfig),
    TmuxCc(TmuxCcConfig),
}
```

**关键**:`version: u32` 字段是 schema migration 的入口——未来 `SavedSessionConfigV2` 加字段时,可以根据 `version` 字段做迁移。

### 8.4 构造器返回 Result<Self, SettingsError>

未来 settings 字段加多后,构造器必须返回 `Result<Self, SettingsError>`(typed error)。

```rust
impl LogConfig {
    pub fn try_new(
        log_level: impl Into<String>,
        max_log_files: u32,
        max_file_size: u64,
    ) -> Result<Self, SettingsError> {
        let log_level = log_level.into();
        if log_level.is_empty() {
            return Err(SettingsError::EmptyLogLevel);
        }
        if max_log_files == 0 {
            return Err(SettingsError::ZeroMaxLogFiles);
        }
        if max_file_size == 0 {
            return Err(SettingsError::ZeroMaxFileSize);
        }
        Ok(Self { log_level, max_log_files, max_file_size })
    }
}
```

## 9. 强制约束(可机械校验)

```bash
# models/settings 不 import service / app / infra
grep -rn 'use crate::\(services\|app\|infrastructure\)' src-tauri/src/models/settings/
# 必须为空

# models/settings 不 import tokio / tauri
grep -rn 'use \(tokio\|tauri\)' src-tauri/src/models/settings/
# 必须为空
```

## 10. 跟 v0 的差异

| 维度 | v0 | v1 |
|---|---|---|
| settings 类型位置 | 内嵌在 `models/session.rs`(5 个类型)| 独立 `models/settings/` domain |
| LogConfig 位置 | `crate::logging_setup.rs` | 保留(未来可迁) |
| SizingMode / DisplayConfig / EnvConfig | `models/session.rs` | `models/settings/types.rs` |
| SavedSessionConfigV1 / SavedSessionConfigKind | `models/session.rs` | `models/settings/types.rs` |
| 与 frontend model 镜像 | ❌ 不存在 | ✅ `models/settings/` ↔ `model/settings/` |

## 11. 依赖变更流程

### 11.1 新增 settings field

```
1. models/settings/types.rs           # 加 field + 更新 struct
2. models/settings/rules.rs           # 加 immutable update function
3. models/settings/accessor.rs        # 加 query helper
4. models/settings/errors.rs          # 加 SettingsError 变体(如有校验)
5. services/settings/api.rs           # 更新 load/save/apply
6. app/settings/commands/logging/config.rs  # 更新 IPC payload key
7. frontend `model/settings/types.ts`  # 同步
8. 更新本文档 §7
```

### 11.2 拆分类型(从 session 迁到 settings)

```
1. models/settings/types.rs           # 加新 struct(迁入目标)
2. models/session/types.rs             # 删旧 struct,改引用新位置
3. 所有 use crate::models::session::SizingMode → use crate::models::settings::types::SizingMode
4. 更新本文档 §4
5. cargo check 全仓(批量改名)
```