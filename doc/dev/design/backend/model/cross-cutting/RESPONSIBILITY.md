# Model · Cross-Cutting — 职责

> **位置**：`src-tauri/src/models/cross_cutting/`
> **类型**：⭐ 横切 domain — 跨域纯类型 + 算法 + 常量
> **被使用方**：`models/session`、`models/workspace`、`models/tmux`、`models/settings`、`services/*`、`app/*`
> **Frontend 对应**：[`../../../frontend/model/cross-cutting/RESPONSIBILITY.md`](../../../frontend/model/cross-cutting/RESPONSIBILITY.md)

## 1. 这个 domain 负责什么

cross-cutting model 定义 **跨多个业务 domain 共享的纯类型 + 纯算法 + 常量**。

承担 4 类职责:

1. **跨域纯类型**——`CapabilityFlags / SplitDirection / SessionLoggingConfig`(被所有 session backend 用)
2. **pure helper 函数**——`build_remote_image_path(filename) -> String`(被 SSH image upload 用)
3. **id 分配器**——(未来)统一 id 分配器
4. **常量**——(未来)文件大小上限 / 超时默认值

## 2. 为什么叫 cross-cutting 不叫 common

**命名陷阱警告**(与 frontend 同构):

> "common" 太宽泛——是"杂物桶"的代名词。`cross-cutting` 是 AOP 术语,精确描述"横切多个业务域"的角色。

跨域纯函数和值(`build_remote_image_path / SplitDirection / CapabilityFlags`)不属于任何具体业务,但被多个 domain 共享——这是 cross-cutting 的语义。

## 3. 这个 domain **不**负责什么

- **不持有运行时状态**——纯类型 + 纯函数
- **不调 IPC**——所有 IPC 走 service / app
- **不存业务数据**——session / workspace / tmux / settings 归各自的 domain
- **不 import 其他 model domain**——cross-cutting 是最底层
- **不实现网络 / IO / async**——纯函数 + 纯类型

## 4. 子结构

```
models/cross_cutting/
├── mod.rs               re-export types / helpers / ids / constants
├── types.rs             ⭐ CapabilityFlags / SplitDirection / SessionLoggingConfig
├── helpers.rs           ⭐ build_remote_image_path()(pure helper)
├── ids.rs               (未来)统一 id 分配器(预留)
└── constants.rs         (未来)文件大小上限 / 超时默认值
```

## 5. v0 → v1 拆分映射

| v0 位置 | v1 位置 | 改动 |
|---|---|---|
| `models/session.rs::SplitDirection` enum (line 222) | `models/cross_cutting/types.rs::SplitDirection` | 迁入 |
| `models/session.rs::build_remote_image_path()` (line 1516) | `models/cross_cutting/helpers.rs::build_remote_image_path` | 迁入 |
| `models/capabilities.rs::CapabilityFlags` | `models/cross_cutting/types.rs::CapabilityFlags` | 迁入(从独立文件迁入)|
| `models/session.rs::SessionLoggingConfig` (line 564) | `models/cross_cutting/types.rs::SessionLoggingConfig` | 迁入 |

**关键**:v0 的 `models/capabilities.rs` 整个文件迁入本 domain——capability flags 是横切关注点。

## 6. 跟其他 model domain 的关系

| domain | 关系 |
|---|---|
| `models/session` | session types 引用 `SplitDirection / CapabilityFlags / SessionLoggingConfig`(纯类型字段) |
| `models/workspace` | workspace types 引用 `SplitDirection`(纯类型字段) |
| `models/tmux` | tmux types 引用 `CapabilityFlags::for_tmux()`(构造 SessionInfo) |
| `models/settings` | settings **不依赖** cross_cutting(平级横切 domain) |

**关键约束**:
- cross-cutting **不** import 其他任何 model domain(最底层)
- cross-cutting **不** import service / app / infrastructure
- cross-cutting 是**唯一允许被所有 domain import**的横切层

## 7. 跟 service / app / infra 的关系

| 层 | 怎么用 models/cross_cutting |
|---|---|
| `services/session` | `CapabilityFlags::for_local() / for_ssh() / for_tmux()` 构造 backend capability |
| `services/tmux` | `CapabilityFlags::for_tmux()` 在 tmux pane handle 构造时使用 |
| `infrastructure/ssh` | `build_remote_image_path()` 在 SCP 上传图片前构造远端路径 |
| `app/*` | 跨域常量(未来) |

## 8. 这个 domain 的"产品语言"术语

- **CapabilityFlags** —— backend capability 探测结果(`paste / resize / tmux / image_upload` 等)
- **SplitDirection** —— split 方向(`Horizontal` / `Vertical`)
- **SessionLoggingConfig** —— session 日志配置(`enabled / log_path / max_file_size`)
- **build_remote_image_path()** —— 在 SSH 服务器上构造图片保存路径(`/tmp/xsterm-image-{timestamp}-{filename}`)
- **横切关注点** —— 不属于任何具体业务但被多个 domain 共享的概念

## 9. 关键设计约束

### 9.1 cross-cutting 是最底层(被所有 domain 引用)

```bash
# cross-cutting 不 import 其他 model domain
grep -rn 'use crate::models::\(session\|workspace\|tmux\|settings\)::' src-tauri/src/models/cross_cutting/
# 必须为空
```

**这是 cross-cutting 与 settings 的关键差异**:
- cross-cutting:最底层,被所有 domain 引用
- settings:横切 domain 之一,与 cross-cutting 平级

### 9.2 types 必须 Serialize + Deserialize(IPC 序列化)

```rust
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct CapabilityFlags {
    pub supports_paste: bool,
    pub supports_resize: bool,
    pub supports_tmux: bool,
    pub supports_image_upload: bool,
    pub supports_clipboard: bool,
}

impl CapabilityFlags {
    pub fn for_local() -> Self {
        Self {
            supports_paste: true,
            supports_resize: true,
            supports_tmux: false,
            supports_image_upload: false,
            supports_clipboard: true,
        }
    }

    pub fn for_ssh() -> Self {
        Self {
            supports_paste: true,
            supports_resize: true,
            supports_tmux: false,
            supports_image_upload: true,  // SSH 支持 SCP 上传
            supports_clipboard: true,
        }
    }

    pub fn for_tmux() -> Self {
        Self {
            supports_paste: true,
            supports_resize: true,
            supports_tmux: true,
            supports_image_upload: false,  // tmux pane 走 SSH 时才支持
            supports_clipboard: true,
        }
    }
}
```

### 9.3 helpers 是 pure function(无 IO / 无状态)

```rust
// models/cross_cutting/helpers.rs
use std::time::{SystemTime, UNIX_EPOCH};

/// 在 SSH 服务器上构造图片保存路径
/// 返回类似 "/tmp/xsterm-image-1719427200000-screenshot.png" 的字符串
pub fn build_remote_image_path(filename: &str) -> Result<String, String> {
    let timestamp = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_err(|e| e.to_string())?
        .as_millis();
    Ok(format!("/tmp/xsterm-image-{}-{}", timestamp, filename))
}

/// shell-quote 单一参数(用于 tmux probe 命令)
/// (从 v0 services/tmux_session/controller/mod.rs::tmux_probe_quote 迁入)
pub fn tmux_probe_quote(s: &str) -> String {
    format!("'{}'", s.replace('\'', "'\\''"))
}
```

**关键**:
- helpers 不持有状态(纯函数)
- helpers 不调 IO / 不 spawn task
- helpers 的输入输出都是纯数据(String / number)

### 9.4 ids 是预留位(未来扩展)

```rust
// models/cross_cutting/ids.rs(预留, MVP 不用)
// 未来:统一 id 分配器(Snowflake / UUID / etc.)
pub trait IdAllocator {
    type Id;
    fn allocate(&self) -> Self::Id;
}
```

**MVP 决策**:`SessionIdSource` 保留在 `models/session/types.rs`(它是 session 生命周期的一部分)。未来如果需要统一所有 id(workspace id / window id / pane id)分配器,迁移到 `models/cross_cutting/ids.rs`。

### 9.5 constants 是预留位

```rust
// models/cross_cutting/constants.rs(预留, MVP 不用)
pub const MAX_WRITE_PAYLOAD_BYTES: usize = 1024 * 1024;  // 1 MiB
pub const MAX_LOG_FILE_SIZE: u64 = 1024 * 1024;          // 1 MiB
pub const TMUX_PROBE_TIMEOUT_SECS: u64 = 5;
pub const SESSION_OUTPUT_CHANNEL_BUFFER: usize = 4096;
```

**MVP 决策**:`MAX_WRITE_PAYLOAD_BYTES` 当前定义在 `commands/session.rs:17`(app 层 inline const)。未来抽到 `models/cross_cutting/constants.rs`。

## 10. 强制约束(可机械校验)

```bash
# cross-cutting 不 import 其他 model domain
grep -rn 'use crate::models::\(session\|workspace\|tmux\|settings\)::' src-tauri/src/models/cross_cutting/
# 必须为空

# cross-cutting 不 import service / app / infra
grep -rn 'use crate::\(services\|app\|infrastructure\)' src-tauri/src/models/cross_cutting/
# 必须为空

# cross-cutting 不 import tokio / tauri
grep -rn 'use \(tokio\|tauri\)' src-tauri/src/models/cross_cutting/
# 必须为空
```

## 11. 跟 v0 的差异

| 维度 | v0 | v1 |
|---|---|---|
| domain 存在 | ❌ 无(能力 / 工具散落) | ✅ 独立 `models/cross_cutting/` |
| `CapabilityFlags` 位置 | `models/capabilities.rs`(独立文件) | `models/cross_cutting/types.rs` |
| `SplitDirection` 位置 | `models/session.rs`(line 222) | `models/cross_cutting/types.rs` |
| `SessionLoggingConfig` 位置 | `models/session.rs`(line 564) | `models/cross_cutting/types.rs` |
| `build_remote_image_path()` 位置 | `models/session.rs`(line 1516) | `models/cross_cutting/helpers.rs` |
| `tmux_probe_quote()` 位置 | `services/tmux_session/controller/mod.rs` | `models/cross_cutting/helpers.rs`(纯 helper 应在 model)|
| `MAX_WRITE_PAYLOAD_BYTES` 位置 | `commands/session.rs:17` | 预留迁到 `models/cross_cutting/constants.rs` |
| 与 frontend model 镜像 | ❌ 不存在 | ✅ `models/cross_cutting/` ↔ `model/cross-cutting/` |

## 12. 设计意图:cross-cutting 是「backend model 的最底层边界」

xsterm backend 的 `models/` 分为 5 业务 + 1 横切(共 6 domain)。

**cross-cutting 的特殊性**:
- 是**唯一**被其他 5 个 domain 引用的 layer
- 是**唯一**不引用任何其他 model domain 的 layer
- 是 backend model 的**最底层边界**——任何想"通用化"的纯类型 / 算法都进这里

**类比 frontend**:frontend `model/cross-cutting/` 装 `textTransform / constants / generateId`——同样的横切关注点。

## 13. 依赖变更流程

### 13.1 新增横切类型

```
1. models/cross_cutting/types.rs           # 加新 struct / enum
2. 其他 domain(types.rs) 引用本 struct
3. services / app / infra 引用本 struct
4. 同步所有 domain 的 DOWNSTREAM.md
5. 更新本文档 §7
```

### 13.2 新增横切 helper

```
1. models/cross_cutting/helpers.rs         # 加新 pub fn
2. 调用方(通常是 service 或 app)使用
3. 加测试(must be pure)
4. 更新本文档 §9.3
```

### 13.3 迁移类型到 cross-cutting(从其他 domain 迁入)

```
1. models/cross_cutting/types.rs           # 加新 struct(迁入目标)
2. 旧 domain(types.rs) 删旧 struct,改引用
3. 所有 use crate::models::<old>::X → use crate::models::cross_cutting::types::X
4. cargo check 全仓
5. 更新本文档 §5
```