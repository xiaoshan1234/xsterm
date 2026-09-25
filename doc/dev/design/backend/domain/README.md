# Backend · Domain 层（合并 service + model + 砍 settings）

> **位置**：`src-tauri/src/domain/`（语义名）
> **关注点**：业务核心 = 状态机 + 进程级生命周期 + 纯数据 + 算法
> **平级于**：commands / infra（3 层架构的中间层）
> **Frontend 对应**：[`../../frontend/service/`](../../frontend/service/README.md)（frontend 是镜像状态，backend 是协议 + 状态机）

## 1. 为什么合并 service + model 为 domain + 砍 settings

Backend 当前 3 层：commands / domain / infra。原 4 层的问题：

| 旧问题 | 实证 |
|—|—|
| **service 跟 model 边界模糊** | `services/session/` 既做"中央状态机"又做"3 种 backend 实现"——`backends/local.rs` 跟 `infra/pty/` 是**两层 SSH/PTY 后端实现**（重叠代码） |
| **app/session/api.rs 是空壳** | `create_local(state, backend, config)` ≈ `SessionManager::create_local(config, backend)`——纯转发，业务价值 0 |
| **model 是"半状态机"** | `models/session/types.rs` 是纯数据，但 `services/session/manager.rs` 是状态机——混在两个目录反而需要双层映射 |
| **settings 杂货箱（已删除）** | LogConfig runtime + ReloadHandle + CapabilityFlags + SplitDirection + SizingMode + DisplayConfig + EnvConfig + SshAuthMethod + SavedSessionConfigV1 + SessionLoggingConfig + build_remote_image_path + 8 个 constants 全部拆到归属 domain |

当前结构：service 跟 model 合并为 domain（4 个 domain，按产品功能切），settings 类型字段全部拆到归属 domain。

**理由**：

1. **service 跟 model 在 Rust 里都是 `pub fn` + `pub struct`**——强制分层带来的实际收益小
2. **backend 不需要 ui 层**——frontend 5 层多 ui 是因为有视图，backend 没视图
3. **合并后按"产品功能"切**（domain/session/ terminal/ persistence/ workspace），每个 domain 内部按文件分（types / rules / state / persistence）反而更清晰
4. **settings 杂货箱拆解**——按字段归属（CapabilityFlags 等归 session，SplitDirection 归 workspace，LogConfig runtime 归 persistence）

## 2. 4 个 domain

```
src-tauri/src/domain/                          # 语义名（顶层 4 domain）
├── mod.rs                4 domain re-export 集合
├── session/              ⭐ 核心 domain：SessionManager 中央状态机 + 3 backend 实现 + settings 字段（CapabilityFlags/SizingMode/DisplayConfig/EnvConfig/SshAuthMethod/SessionLoggingConfig）+ types + rules + helpers + constants
│   ├── types.rs          SessionType / SessionInfo / SessionConfig / LocalSessionConfig / SSHSessionConfig / SessionLoggingConfig / SessionIdSource / SizingMode / DisplayConfig / EnvConfig / SshAuthMethod / CapabilityFlags
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
├── workspace/            ⭐ 主视图 domain：paneTree 算法 + SplitDirection 类型 + types
│   ├── types.rs          Workspace / Window / Group / GroupStore / PaneNode / SplitDirection / PaneBinding
│   ├── rules.rs          paneTree 算法（createLeafPane / createSplitNode / splitPane / closePane / resizePane / movePane）
│   ├── state.rs          预留（WorkspaceManager 预留位，MVP 无 backend 状态）
│   ├── api.rs            ⭐ 唯一对外入口
│   ├── errors.rs         WorkspaceError（thiserror，MVP 预留）
│   └── *.test.rs
│
├── terminal/             ⭐ 派生 domain：TmuxController + tmux 协议层 + types
│   ├── types.rs          TmuxCcConfig / TmuxSessionInit / TmuxWindowInit / TmuxPaneInit / TmuxControlWindowInit / AttachedTmuxServer
│   ├── controller/       TmuxController struct + 共享 helper
│   ├── dispatch.rs       spawn_dispatch_task + dispatch_event
│   ├── bridge.rs         TmuxBridge — ProtocolEvent → Tauri 事件
│   ├── protocol/         纯协议层（无 I/O）—— 不动
│   ├── api.rs            ⭐ 唯一对外入口（强制）
│   ├── errors.rs         TmuxError
│   └── *.test.rs
│
└── persistence/          ⭐ 横切 domain：attached_tmux + log_config 直存 + ReloadHandle 管理
    ├── api.rs            ⭐ 唯一对外入口（save_json_value / load_json_value / delete_json_value + LogConfig 运行时）
    ├── attached_tmux.rs  attached_tmux.json 的 typed wrapper
    ├── log_config.rs     LogConfig 类型 + LogConfigState + ReloadHandle 管理
    ├── constants.rs      LOG_FILE_MAX_BYTES / LOG_FILE_DEFAULT_KEEP
    ├── errors.rs         PersistenceError（thiserror）
    └── *.test.rs
```

**类型分类依据**（与 frontend service README §1 一致）：

| 类型 | 判定标准 | backend 例子 |
|—|—|—|
| **核心** | 跨多个 commands module 共享的状态机 | `domain/session`（被 commands/session、commands/terminal、commands/workspace、commands/shell 用）|
| **派生** | 不存原数据，存"原数据的视图"或独立子系统 | `domain/terminal`（独立 tmux -CC 子系统）|
| **横切** | 独立子系统，被所有 commands 用 | `domain/persistence`（attached_tmux + log_config runtime 持久化）|

## 3. 4 个 domain ↔ 5 个 frontend service domain 镜像表

| backend domain | frontend service domain | 对应关系 |
|—|—|—|
| `domain/session` | `service/session` | 都是 session 元数据状态机 + IPC 桥的 source of truth；backend 持有 3 种 backend 实现 + 多种 settings 字段 |
| `domain/workspace` | `service/workspace` | MVP backend 预留位；frontend 持有 workspace store |
| `domain/terminal` | `service/tmux` | backend 是 tmux 协议的 source；frontend 镜像 backend 推过来的状态 |
| `domain/persistence` | `service/persistence` | backend 持 attached_tmux + log_config；frontend 持 sessions/groups/settings 直存 |

**砍掉 backend `domain/settings`**：前端 settings service 镜像的是 frontend 自己的 store——backend 不需要同名 domain。backend 的"settings 概念"被拆到：
- `domain/persistence`（log_config runtime + ReloadHandle）
- `domain/session`（CapabilityFlags / SizingMode / DisplayConfig / EnvConfig / SshAuthMethod / SessionLoggingConfig / build_remote_image_path / 部分 constants）
- `domain/workspace`（SplitDirection）

## 4. 4 个 domain 之间的依赖

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
                  │ （派生：与 session 平行）│
                  └─────────┬────────────────┘
                            │
                            ▼
                  ┌──────────────────────────┐
                  │      persistence         │
                  │ （横切：tauri-plugin-store）│
                  └──────────────────────────┘
                            ▲
                            │
                  ┌─────────┴────────────────┐
                  │       workspace          │
                  │ （预留位：MVP 无 backend）│
                  └──────────────────────────┘
```

**依赖规则**（与 frontend `service/` 镜像 + 适配 Rust 习惯）：

- **session** → terminal（注册 controller 时通过 controller 公开接口）
- **session** → persistence（save attached_tmux——但走 `commands/` 触发，domain 只提供能力）
- **session** → workspace（预留：MVP 不调）
- **terminal** → persistence（auto_attach 读 attached_tmux.json——走 `commands/` 触发）
- **workspace** → 任何（预留位，未来激活）
- **persistence** → 任何（**禁止**——persistence 是最底层）

**砍掉 settings 后的 settings 依赖被吸收到归属 domain**：
- `session → settings (default shell 等)` → session types 字段直接拼装，不需要跨 domain 调
- `settings → persistence (log_config.json)` → persistence 内置 LogConfig runtime（合并）

## 5. 每个 domain 的内部约定

```rust
domain/<name>/
├── types.rs              # 纯数据 + serde derive（API 序列化 + IPC 序列化）
├── rules.rs              # 纯算法（不可变 mutation，纯函数，可单测）
├── state.rs              # 状态机（持有 Arc<Mutex/DashMap>，提供 public method）
│   # 或拆文件：<state_machine_name>.rs（如 controller.rs、manager.rs）
├── persistence.rs        # 持久化 IO（typed wrapper over domain/persistence/*）
├── api.rs                # ⭐ 唯一对外入口（其他 module 只能 import 这个）
├── errors.rs             # XxxError（thiserror）
└── *.test.rs
```

**强制规则**：

- `api.rs` 是**唯一对外入口**——其他 module 只 import 这个
- `state.rs` / `controller.rs` 等持有可变状态——只能通过 `api.rs` 暴露
- types / rules 是**纯函数 + 纯数据**——可自由 import
- persistence.rs 只 import `domain/persistence/*`（typed wrapper），不直接调 `infra/tauri-plugin-store`

**例外**：

- 简单 domain（如 `domain/workspace` MVP 预留位）只有 types + rules + 占位
- 复杂 domain（如 `domain/terminal/TmuxController`）按状态机子目录拆（controller/、dispatch.rs、bridge.rs、protocol/）

## 6. domain → commands 边界

```
commands/session/                    domain/session/
├── create_local_session.rs  ──────► ├── api.rs::create_local()
│   #[tauri::command]              │   └── manager.rs::create_local()
│   State<Arc<SessionManager>>     │       └── backends/local.rs::LocalSession
└── close_session.rs  ─────────────► └── api.rs::close()
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
```

**关键**：

- domain 持有 `Box<dyn Trait>` 引用——通过 trait 抽象 infra
- infra 提供 `NativePtySystem` impl trait——不依赖 domain
- **不**允许：domain import `infra::pty::NativePtySystem`——必须用 `PtySystem` trait
- **不**允许：infra import `domain::*`——infra 是最底层

## 8. 占位与未来工作

backend 设计文档里**保留**所有「（未来）」占位——它们标记 MVP 暂未实现但设计已规划的部分：

- `domain/workspace/state.rs`：MVP backend 无 workspace 状态，pane tree 在 frontend store
- `domain/persistence/migrations/`：schema 升级时的 migration 框架（MVP 单版本无 migration）
- 各类「（未来）」标注的字段、命令、helper

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

### 9.3 类型字段归属

- cross-cutting 内容是 types + constants + helpers——是 settings 的"基础设施"（SessionType / SplitDirection / CapabilityFlags / build_remote_image_path / constants）
- 单独成 domain 是过度切分（types/constants/helper 不构成独立业务）
- 合并到 domain/settings；进一步拆到归属 domain（CapabilityFlags 等 → session，SplitDirection → workspace）

### 9.4 为什么 domain/persistence 保留为独立 domain

虽然 persistence 内容很少（attached_tmux typed wrapper + generic IO + errors），但：

- persistence 是**最底层数据 IO**——被所有 domain 用（terminal → persistence，settings → persistent）
- persistence 不依赖任何 service（是最底层）
- 合并到 settings 会模糊 settings 跟 persistence 的边界

**保留为独立 domain，但实际只剩 1 个 typed wrapper**（attached_tmux.rs）—— generic IO 是 settings 通过 persistence 间接用的。

### 9.5 为什么 domain 内部不强制 types/rules/state 三文件分离

- 简单 domain（如 `domain/session`）`state.rs` 可能有 SessionManager struct 等
- 复杂 domain（如 `domain/terminal/TmuxController`）需要拆 `controller/mod.rs` + `commands.rs` + `io_tasks.rs` 等多个文件
- **按代码实际需要组织文件**——模板是参考，不是强制

## 10. 跟 frontend service 的职责分叉

| 维度 | frontend service | backend domain |
|—|—|—|
| 类型定义 | TS interface | Rust serde struct |
| 状态机 | zustand store + reducer | `Arc<Mutex/DashMap>` + method |
| 算法 | pure function（accessor / rules）| pure function（rules）|
| IPC 桥 | `bridge.ts` listen backend → mutate store | 不存在——backend 直接 emit |
| 持久化 | frontend `infra/store` 直存 frontend-only | backend `domain/persistence` 直存 backend-only |
| 跨 service 协调 | 通过 app 编排 | 通过 commands 编排 |

**frontend 是镜像状态 + IPC 桥，backend 是协议 + 状态机 + 持久化**——两边自然分叉，但**域命名相同**便于跨语言导航。

## 11. 文档地图

- 顶层（本文）：domain 4 domain 总览 + 与 commands/infra 边界 + 与 frontend service 镜像关系
- 各 domain 子文档：每个 domain 3 份（RESPONSIBILITY / INTERFACE / DOWNSTREAM）
- 镜像验证：每份 domain README 顶部 "Frontend 对应" 链接

**TM 验收入口**：先读本文档（domain 总览）→ 读 `domain/session/RESPONSIBILITY.md`（最大、最复杂的 domain）→ 读 `domain/persistence/DOWNSTREAM.md`（看 domain 跨 module 持久化示例）。