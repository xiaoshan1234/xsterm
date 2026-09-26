# Backend · Domain 层（合并 service + model + 砍 settings + 砍 workspace + 砍 persistence）

> **位置**：`src-tauri/src/domain/`（语义名）
> **关注点**：业务核心 = 状态机 + 进程级生命周期 + 纯数据 + 算法
> **平级于**：commands / infra（3 层架构的中间层）
> **Frontend 对应**：[`../../frontend/service/`](../../frontend/service/README.md)（frontend 是镜像状态，backend 是协议 + 状态机）

## 1. 为什么合并 service + model 为 domain + 砍 settings / workspace / persistence

之前 backend 分 4 层：`app / service / model / infra`。问题：

| 旧问题 | 实证 |
|---|---|
| **service 跟 model 边界模糊** | `services/session/` 既做"中央状态机"又做"3 种 backend 实现"——`backends/local.rs` 跟 `infra/pty/` 是**两层 SSH/PTY 后端实现**（重叠代码） |
| **app/session/api.rs 是空壳** | `create_local(state, backend, config)` ≈ `SessionManager::create_local(config, backend)`——纯转发，业务价值 0 |
| **model 是"半状态机"** | `models/session/types.rs` 是纯数据，但 `services/session/manager.rs` 是状态机——混在两个目录反而需要双层映射 |
| **settings 杂货箱（已删除）** | LogConfig runtime + ReloadHandle + CapabilityFlags + SplitDirection + SizingMode + DisplayConfig + EnvConfig + SshAuthMethod + SavedSessionConfigV1 + SessionLoggingConfig + build_remote_image_path + 8 个 constants 全部拆到归属 domain |
| **workspace 空占位（已删除）** | MVP backend 无 workspace 状态、paneTree 算法、WorkspaceManager——workspace 状态完全 frontend 持有 |
| **persistence 机制不是业务（已删除）** | attached_tmux 是 tmux 状态的一部分 → 归 `domain/terminal`；log_config 是 shell runtime 的一部分 → 归 `commands/shell`——`persistence` 不构成独立业务边界 |

当前结构：service 跟 model 合并为 domain（**2 个 domain**，按产品功能切），所有"机制层"都被吸收到归属 domain 或 commands shell。

**理由**：

1. **service 跟 model 在 Rust 里都是 `pub fn` + `pub struct`**——强制分层带来的实际收益小
2. **backend 不需要 ui 层**——frontend 5 层多 ui 是因为有视图，backend 没视图
3. **合并后按"产品功能"切**（domain/session + domain/terminal），每个 domain 内部按文件分（types / rules / state / persistence）反而更清晰
4. **persistence 不是业务边界**——attached_tmux 持久化是 tmux 状态的一部分，log_config 是 logging runtime 的一部分——generic JSON IO 不是独立 domain 的充分理由

## 2. 2 个 domain

```
src-tauri/src/domain/                          # 语义名（顶层 2 domain）
├── mod.rs                2 domain re-export 集合
├── session/              ⭐ 核心 domain：SessionManager 中央状态机 + 3 backend 实现 + settings 字段 + SplitDirection
│   ├── types.rs          SessionType / SessionInfo / SessionConfig / LocalSessionConfig / SSHSessionConfig / SessionLoggingConfig / SessionIdSource / SizingMode / DisplayConfig / EnvConfig / SshAuthMethod / CapabilityFlags / SplitDirection
│   ├── rules.rs          withStatus / applyDisplayConfig / apply_session_settings / mergeDefaults / validateConfig / withCapability
│   ├── state.rs          SessionManager + 注册表 + id 分配
│   ├── helpers.rs        build_remote_image_path (SSH image upload helper)
│   ├── constants.rs      MAX_WRITE_PAYLOAD_BYTES / SSH_CONNECT_TIMEOUT_SECS / DEFAULT_SHELL_UNIX / DEFAULT_SHELL_WINDOWS
│   ├── backends/         3 种 backend 实现（local / ssh / tmux_pane）
│   │   ├── traits.rs     SessionBackend trait
│   │   ├── local.rs      LocalSession + PtyPair
│   │   ├── ssh.rs        SshSessionHandle + russh
│   │   └── tmux_pane.rs  TmuxPaneHandle
│   ├── log.rs            start_session_logging
│   ├── api.rs            ⭐ 唯一对外入口
│   ├── errors.rs         SessionError（thiserror）
│   └── *.test.rs
│
└── terminal/             ⭐ 派生 domain：TmuxController + tmux 协议层 + types + **attached_tmux 持久化**
    ├── types.rs          TmuxCcConfig / TmuxSessionInit / TmuxWindowInit / TmuxPaneInit / TmuxControlWindowInit / AttachedTmuxServer
    ├── controller/       TmuxController struct + 共享 helper
    ├── dispatch.rs       spawn_dispatch_task + dispatch_event
    ├── bridge.rs         TmuxBridge — ProtocolEvent → Tauri 事件
    ├── protocol/         纯协议层（无 I/O）—— 不动
    ├── attached_tmux.rs  attached_tmux.json 的 typed wrapper（v6 合并自原 domain/persistence；向下调用 `infra/tauri::tauri-plugin-store`）
    ├── api.rs            ⭐ 唯一对外入口
    ├── errors.rs         TmuxError
    └── *.test.rs
```

**类型分类依据**：

| 类型 | 判定标准 | backend 例子 |
|---|---|---|
| **核心** | 跨多个 commands module 共享的状态机 | `domain/session`（被 commands/session、commands/terminal、commands/shell 用）|
| **派生** | 不存原数据，存"原数据的视图"或独立子系统 | `domain/terminal`（独立 tmux -CC 子系统 + attached_tmux 持久化）|

## 3. 2 个 domain ↔ 5 个 frontend service domain 镜像表

| backend domain | frontend service domain | 对应关系 |
|---|---|---|
| `domain/session` | `service/session` | 都是 session 元数据状态机 + IPC 桥的 source of truth；backend 持有 3 种 backend 实现 + 多种 settings 字段 |
| `domain/terminal` | `service/tmux` | backend 是 tmux 协议的 source + attached_tmux 持久化；frontend 镜像 backend 推过来的状态 |

**砍掉的 3 个 module / domain 与 frontend 的关系**：

- `commands/settings`（砍）：attached_tmux 持久化归 terminal（tmux 业务），log runtime 归 shell（启动时调）
- `commands/workspace` + `domain/workspace`（砍）：workspace 状态完全 frontend 持有（Zustand store + paneTree 算法）
- `domain/persistence`（砍）：attached_tmux 持久化是 tmux 状态的一部分 → 归 `domain/terminal`；log_config 是 shell runtime 的一部分 → 归 `commands/shell`

## 4. 2 个 domain 之间的依赖

```
                  ┌──────────────────────────┐
                  │       session            │
                  │  （核心 domain：唯一允许  │
                  │    跨 domain 协调的）    │
                  └─────────┬────────────────┘
                            │ 注册 controller
                            ▼
                  ┌──────────────────────────┐
                  │         terminal         │
                  │ （派生：tmux -CC 子系统  │
                  │   + attached_tmux 持久化）│
                  └──────────────────────────┘
```

**依赖规则**：

- **session** → terminal（注册 controller 时通过 controller 公开接口）
- **terminal** → session（仅通过 session 公开方法，不直接 import）
- **persistence** → 任何（**禁止**——已不存在，IO 逻辑下沉到归属 domain / shell）

**跨 module 协调**（**不通过 persistence domain**）：

- `commands/terminal` 触发 attached_tmux 保存 → 直接调 `domain/terminal::api::save_attached_tmux`（不绕道）
- `commands/shell` 启动 → 直接调 `infra/tauri::tauri_plugin_store` 读 log_config + 创建 ReloadHandle（不绕道）
- `commands/shell` 调 log_message → 直接 emit Tauri 事件给 frontend listener

## 5. 每个 domain 的内部约定

```rust
domain/<name>/
├── types.rs              # 纯数据 + serde derive（API 序列化 + IPC 序列化）
├── rules.rs              # 纯算法（不可变 mutation，纯函数，可单测）
├── state.rs              # 状态机（持有 Arc<Mutex/DashMap>，提供 public method）
│   # 或拆文件：<state_machine>.rs（如 controller.rs、manager.rs）
├── <persistence>.rs       # 持久化 IO（typed wrapper，**仅在自己 domain 内**——attached_tmux 归 terminal 不下沉到 generic 层）
├── api.rs                # ⭐ 唯一对外入口（其他 module 只能 import 这个）
├── errors.rs             # XxxError（thiserror）
└── *.test.rs
```

**强制规则**：

- `api.rs` 是**唯一对外入口**——其他 module 只 import 这个
- `state.rs` / `controller.rs` 等持有可变状态——只能通过 `api.rs` 暴露
- types / rules 是**纯函数 + 纯数据**——可自由 import
| persistence.rs 只在自己 domain 内（不再有 generic `infra::tauri::tauri_plugin_store` 抽出的 `save_json_value` 公共层）——**attached_tmux 在 `domain/terminal`**，**log_config 在 `commands/shell`** |

## 6. domain → commands 边界

```
commands/session/                    domain/session/
├── create_local_session.rs  ──────► ├── api.rs::create_local()
│   #[tauri::command]              │   └── state.rs::create_local()
│   State<Arc<SessionManager>>     │       └── backends/local.rs::LocalSession
└── close_session.rs  ─────────────► └── api.rs::close()

commands/terminal/                   domain/terminal/
├── create_tmux_pane.rs  ─────────► ├── api.rs::create_tmux_pane()
│   #[tauri::command]              │   └── state.rs::TmuxController
└── attached_tmux.rs  ────────────► └── api.rs::save_attached_tmux()
                                    │   └── attached_tmux.rs::save_attached_tmux_typed()

commands/shell/                      infra/tauri + crate::logging_setup
├── log_message.rs  ──────────────► emit Tauri event（直接调 infra/tauri）
├── set_log_config.rs  ───────────► 写 log_config.json + 调 ReloadHandle::reload
└── initialize.rs  ───────────────► 读 log_config.json + 创建 ReloadHandle + 注册 app state
```

**关键**：

- commands 持有 `State<Arc<DomainState>>`——Tauri 注入的 Arc 指针
- domain api 接收 `&self` 或 `&Arc<Self>`——纯 Rust 方法签名
- **不**允许：commands 直接 `state.field = ...`——必须调 `api.rs::method()`
- **不**允许：domain api 接收 `State<AppHandle>`——domain 不知道 Tauri 存在

## 7. domain → infra 边界

```
domain/session/backends/local.rs      infra/pty/
├── impl LocalSession {              ├── pub trait PtySystem
│   pub fn new(                     │   ├── fn openpty() -> PtyPair
│       pty_system: Box<dyn PtySystem> ───►
│   ) -> Self                        └── pub trait PtySystem + NativePtySystem impl
}

domain/terminal/attached_tmux.rs     infra/tauri
├── impl AttachedTmuxWrapper {      ├── pub trait AppBackend
│   pub fn save(server) {            ├── pub fn save_json_value(file, key, value)
│       infra::tauri::save_json_value(file, key, value) ───►
│   }                                └── pub fn load_json_value(file, key)
}
```

**关键**：

- domain 持有 `Box<dyn Trait>` 引用——通过 trait 抽象 infra
- infra 提供 `NativePtySystem` impl trait——不依赖 domain
- **不**允许：domain import `infra::pty::NativePtySystem` 等具体实现——只 import trait
- **不**允许：infra import `domain::*`——infra 是最底层

## 8. 占位与未来工作

backend 设计文档里**保留**所有「（未来）」占位——它们标记 MVP 暂未实现但设计已规划的部分：

- 各类「（未来）」标注的字段、命令、helper
- `domain/terminal/attached_tmux.rs`：MVP 已有 attached_tmux.json 持久化（save/load on startup + shutdown）
- schema migration 框架（MVP 单版本无 migration）

**保留占位的理由**：

- 设计文档是"目标态"——MVP 不实现不等于设计不规划
- 后续 PR 可以按占位逐项落地
- 删除占位会丢失设计意图

## 9. 关键设计决策

### 9.1 为什么 service + model 合并

- service/session 的 `backends/local.rs` 跟 infra/pty 的 `native.rs` 是**两层 backend 实现**——合并后只有一份（domain/session/backends/local.rs），infra/pty 只留 trait 抽象
- model/types.rs 跟 service/<state>.rs 是两类代码（纯数据 vs 状态机），但**合并后按文件分（types.rs vs state.rs）反而更清晰**
- frontend 5 层是因为有 ui 层——backend 没视图，砍掉 service/model 强制分层收益小、认知开销大

### 9.2 为什么 tmux 归 domain/terminal 而不是独立 domain

- 原 service/tmux 是"独立 domain"——但 tmux 是**terminal 产品功能的子集**，不是独立业务
- 前端 terminal module 包含 xterm + tmux + outputBuffer，backend terminal module 同理包含 TmuxController + protocol + 3 backend 实现
- 按产品功能切（不是按技术类型）——tmux 是 terminal 的子目录

### 9.3 为什么 attached_tmux 持久化归 domain/terminal 而不归独立 persistence

- attached_tmux.json 存的是 **tmux controller Arc 注册表**——是 tmux 运行时的状态
- TmuxController `spawn_attach()` 内部触发 save；`load_attached_on_startup()` 内部触发 load
- 持久化逻辑跟 tmux 生命周期强耦合——归 terminal 是天然归属
- generic JSON IO layer（save_json_value / load_json_value）只有 attached_tmux 一家用——不需要 generic 抽象

### 9.4 为什么 log_config runtime 归 commands/shell 而不归 domain/persistence

- ReloadHandle 是 backend 启动时 `crate::logging_setup::init_logging()` 创建的 tracing subscriber 重载句柄
- 它是 **shell 启动序列的一部分**，不是业务领域
- `commands/shell/api.rs::initialize()` 内部读 log_config.json + 创建 ReloadHandle + 注册 app state
- log_message / get_log_config / set_log_config / get_log_dir 这 4 个 IPC 都在 commands/shell——业务编排天然属于 shell

### 9.5 为什么 domain 内部不强制 types/rules/state 三文件分离

- 简单 domain（如 `domain/terminal`）按状态机子目录拆（controller/mod.rs + commands.rs + io_tasks.rs 等多个文件）
- 复杂 domain（如 `domain/terminal/TmuxController`）需要拆 `controller/`、dispatch.rs、bridge.rs、protocol/ 等多个文件
- **按代码实际需要组织文件**——模板是参考，不是强制

## 10. 跟 frontend service 的职责分叉

| 维度 | frontend service/session | backend domain/session |
|---|---|---|
| 类型定义 | TS interface | Rust serde struct |
| 状态机 | zustand store + reducer | `Arc<DashMap>` + method |
| 算法 | pure function（accessor / rules）| pure function（rules）|
| IPC 桥 | `bridge.ts` listen backend → mutate store | 不存在——backend 直接 emit |
| 持久化 | frontend `infra/store` 直存 sessions.json | backend **不持久化** sessions.json（frontend 直存） |
| 3 种 backend 实现 | 不存在（frontend 只持有镜像 + capability flags） | 存在——LocalSession / SshSession / TmuxPaneHandle |

**frontend 是镜像 + 状态管理，backend 是协议 + 状态机 + 持久化**——两边自然分叉，但**域命名相同**便于跨语言导航。

## 11. 文档地图

- 顶层（本文）：domain 2 domain 总览 + 与 commands/infra 边界 + 与 frontend service 镜像关系
- 各 domain 子文档：每个 domain 3 份（RESPONSIBILITY / INTERFACE / DOWNSTREAM）
- 镜像验证：每份 domain README 顶部 "Frontend 对应" 链接

**TM 验收入口**：先读本文档（domain 总览）→ 读 `domain/session/RESPONSIBILITY.md`（最大、最复杂的 domain）→ 读 `domain/terminal/RESPONSIBILITY.md`（TmuxController + attached_tmux 持久化示例）。