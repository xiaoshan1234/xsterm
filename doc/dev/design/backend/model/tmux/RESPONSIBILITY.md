# Model · Tmux — 职责

> **位置**：`src-tauri/src/models/tmux/`
> **类型**：⭐ 派生 domain — tmux 协议层的纯数据投影
> **被使用方**：`services/tmux`、`services/session`(代理 tmux 操作)、`app/terminal`、`infrastructure/tmux`
> **Frontend 对应**：[`../../../frontend/model/tmux/RESPONSIBILITY.md`](../../../frontend/model/tmux/RESPONSIBILITY.md)

## 1. 这个 domain 负责什么

tmux model 定义 **tmux -CC 子系统的所有纯数据类型**——tmux 协议层的"data shape"。

承担 4 类职责:

1. **tmux 配置类型**——`TmuxCcConfig`(创建 / attach 的入参)
2. **tmux 初始化返回类型**——`TmuxSessionInit / TmuxWindowInit / TmuxPaneInit / TmuxControlWindowInit`(同步返回的初始状态)
3. **tmux 持久化类型**——`AttachedTmuxServer`(attached_tmux.json 序列化形态)
4. **纯 helper 函数**——`tmux_pane_info()`(构造 `SessionInfo` 的 helper)

## 2. 这个 domain **不**负责什么

- **不持有 controller 状态**——controller 在 `services/tmux/controller/`(`pane_bindings / window_bindings` 等运行时数据)
- **不实现 tmux 协议层**——协议层在 `services/tmux/protocol/`(octal codec / CommandKind / ProtocolEvent)
- **不持有 tmux 子进程**——子进程在 `services/tmux/controller/io_tasks.rs`
- **不渲染 UI**——backend 无 UI
- **不解析 tmux 命令输出**——parser 在 `services/tmux/protocol/parser.rs`

## 3. 子结构

```
models/tmux/
├── mod.rs               re-export types / accessor / errors
├── types.rs             TmuxCcConfig / TmuxSessionInit / TmuxWindowInit / TmuxPaneInit / TmuxControlWindowInit / AttachedTmuxServer
├── accessor.rs          tmux_pane_info() pure helper(构造 SessionInfo)
└── errors.rs            TmuxConfigError(预留——MVP 不用)
```

## 4. v0 → v1 拆分映射

| v0 位置(在 models/session.rs) | v1 位置 | 改动 |
|---|---|---|
| `AttachedTmuxServer` (line 258) | `models/tmux/types.rs` | 迁入 |
| `TmuxCcConfig` (line 291) | `models/tmux/types.rs` | 迁入 |
| `tmux_pane_info()` fn (line 418) | `models/tmux/accessor.rs` | 迁入 |
| `TmuxSessionInit` (line 481) | `models/tmux/types.rs` | 迁入 |
| `TmuxWindowInit` (line 499) | `models/tmux/types.rs` | 迁入 |
| `TmuxPaneInit` (line 513) | `models/tmux/types.rs` | 迁入 |
| `TmuxControlWindowInit` (line 532) | `models/tmux/types.rs` | 迁入 |

**关键**:v0 的 `models/session.rs` 1670 行中,有 8 个 tmux 专属类型 + 1 个 helper 函数——v1 全部迁到 `models/tmux/`。

## 5. 跟其他 model domain 的关系

| domain | 关系 |
|---|---|
| `models/session` | session 通过 `SessionConfig::TmuxCc(TmuxCcConfig)` 引用本 domain 的 `TmuxCcConfig`(纯类型引用)|
| `models/workspace` | workspace 通过 `SessionType::TmuxCc` 引用本 domain 的字段(纯类型引用)|
| `models/settings` | tmux **不依赖** settings(tmux 配置由用户传,不读 settings) |
| `models/cross_cutting` | tmux 引用 `SplitDirection`(from cross_cutting) |

**关键约束**:
- tmux model **不** import session model 的函数 / trait(`tmux_pane_info()` 构造 `SessionInfo` 但返回 `SessionInfo` 类型引用是允许的——这是 pure helper 的语义)
- tmux model **不** import 其他 domain 的**函数 / trait**(纯类型字段允许)

## 6. 跟 service / app / infra 的关系

| 层 | 怎么用 models/tmux |
|---|---|
| `services/tmux` | `TmuxCcConfig` 是 spawn_create 的参数;`TmuxSessionInit` 是 create_tmux 返回类型;`AttachedTmuxServer` 是 list_attached_tmux_servers 的返回类型 |
| `services/session` | 通过 `SessionConfig::TmuxCc(TmuxCcConfig)` 引用;`tmux_pane_info()` 在 `create_tmux` 内被调 |
| `app/terminal` | `TmuxCcConfig` 是 `create_tmux_session / attach_tmux_session` IPC 入参;`TmuxSessionInit` 是返回类型 |
| `infrastructure/tmux` | `TmuxCcConfig` 是 spawn_tmux_child 的参数 |

## 7. 这个 domain 的"产品语言"术语

- **TmuxCcConfig** —— 创建 / attach tmux -CC controller 的配置(ssh / name / session_name / socket / rows / cols 等)
- **TmuxSessionInit** —— 创建 / attach 后**同步**返回的初始状态(n windows + m panes + 1 control window)
- **TmuxWindowInit** —— 单个 window 的初始化数据(window id + name)
- **TmuxPaneInit** —— 单个 pane 的初始化数据(pane id + window id + active flag)
- **TmuxControlWindowInit** —— tmux control window 的初始化数据(controller id + name)
- **AttachedTmuxServer** —— 持久化的 attached server 列表(`session_name / socket_name / attached_at`)
- **bootstrap pane** —— tmux -CC 启动后的第一个 pane(new 模式 visible;attach 模式 hidden)
- **control window** —— tmux -CC 用来跑控制命令的内部 window(隐藏)

## 8. 关键设计约束

### 8.1 types 必须 Serialize + Deserialize(IPC 序列化)

```rust
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TmuxCcConfig {
    pub name: Option<String>,
    pub tmux_session_name: Option<String>,
    pub socket_name: Option<String>,
    pub base_config_id: Option<String>,
    pub start_command: Option<String>,
    pub env_config: Option<EnvConfig>,            // 来自 models/settings
    pub initial_rows: Option<u16>,
    pub initial_cols: Option<u16>,
    pub ssh: Option<TmuxSshConfig>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AttachedTmuxServer {
    pub session_name: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub socket_name: Option<String>,
    pub attached_at: u64,  // unix ms
}
```

### 8.2 TmuxSessionInit 是同步返回的初始状态(Perf)

```rust
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TmuxSessionInit {
    pub session: SessionInfo,           // ← bootstrap pane 的 SessionInfo
    pub windows: Vec<TmuxWindowInit>,   // ← 所有 window
    pub panes: Vec<TmuxPaneInit>,       // ← 所有 pane
    pub control_window: TmuxControlWindowInit,
}
```

**关键**:v1 的 IA(Initial-state Architecture)——等待 dispatch task 处理 BOTH `list-windows` AND `list-panes` 后,组装完整初始状态一次返回。前端不需要等异步事件即可渲染 workspace。

### 8.3 tmux_pane_info 是 pure helper

```rust
// models/tmux/accessor.rs
use crate::models::session::SessionInfo;
use crate::models::cross_cutting::types::CapabilityFlags;

pub fn tmux_pane_info(
    session_id: u32,
    controller_id: u32,
    tmux_pane_id: String,
    session_name: Option<&str>,
    name: Option<&str>,
    is_hidden: bool,
    tmux_window_id: Option<&str>,
) -> SessionInfo {
    // 构造 SessionInfo with SessionType::TmuxCc
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
```

**关键**:`tmux_pane_info()` 返回 `SessionInfo`——这是 tmux domain **唯一**允许引用 `models/session::SessionInfo` 的地方(因为它是 pure helper,语义上必须返回 SessionInfo 类型)。

### 8.4 bug 0009 防御:binding 数据走 model,不走 controller 字段

v0 的 bug 0009 根因:`SessionManager::create_tmux` 直接读 `TmuxController.window_bindings` HashMap 找 tmux window id。

v1 的防御:
- `TmuxController::tmux_window_id_for_pane(&pane_id)` 是 controller 公开方法(见 `services/tmux/INTERFACE.md` §2.2)
- 返回类型是 `Option<String>`(纯数据)
- 调用方在 `services/session/manager.rs::create_tmux` 通过公开方法获取,不读字段

## 9. 强制约束(可机械校验)

```bash
# models/tmux 不 import service / app / infra
grep -rn 'use crate::\(services\|app\|infrastructure\)' src-tauri/src/models/tmux/
# 必须为空

# models/tmux 不 import tokio / tauri
grep -rn 'use \(tokio\|tauri\)' src-tauri/src/models/tmux/
# 必须为空

# models/tmux 不 import models/session 函数(只允许引用 SessionInfo 类型字段)
grep -rn 'use crate::models::session::' src-tauri/src/models/tmux/ | grep -v 'types::'
# 必须为空
```

## 10. 跟 v0 的差异

| 维度 | v0 | v1 |
|---|---|---|
| tmux 类型位置 | 内嵌在 `models/session.rs`(8 个类型 + 1 个 helper) | 独立 `models/tmux/` domain |
| `tmux_pane_info()` 位置 | `models/session.rs::tmux_pane_info` | `models/tmux/accessor.rs::tmux_pane_info` |
| `AttachedTmuxServer` 位置 | `models/session.rs` | `models/tmux/types.rs` |
| bug 0009 防御 | 字段直读 window_bindings | `tmux_window_id_for_pane()` 公开方法 |
| 与 frontend model 镜像 | ❌ 不存在(frontend `model/tmux/` 已存在) | ✅ `models/tmux/` ↔ `model/tmux/` |

## 11. 依赖变更流程

### 11.1 新增 TmuxCcConfig 字段

```
1. models/tmux/types.rs           # 加 field + 更新 struct
2. services/tmux/controller/spawn.rs  # 更新 spawn_create 参数
3. app/terminal/commands/tmux/session.rs  # 更新 IPC payload key
4. frontend `model/tmux/types.ts`  # 同步
5. 更新本文档 §7
```

### 11.2 拆分类型(从 session 迁到 tmux)

```
1. models/tmux/types.rs           # 加新 struct(迁入目标)
2. models/session/types.rs         # 删旧 struct,改引用新位置
3. 所有 use crate::models::session::TmuxCcConfig → use crate::models::tmux::types::TmuxCcConfig
4. 更新本文档 §4
5. cargo check 全仓(批量改名)
```