# Backend · Service 层（v1：按数据 domain 切分）

> **位置**：`src-tauri/src/services/`（目录名沿用 Rust 习惯）
> **关注点**：跨 module 共享状态 + 业务编排 + 持有进程级生命周期
> **平级于**：app / model / infra（4 个顶层目录之一）
> **前端对应**：[`../../frontend/service/`](../../frontend/service/README.md)（同样按数据 domain 切）

## 0. 为什么重写这一层

v0 把 `services/` 按**资源类型**切：`session_manager / session_log / local_session / ssh_session / tmux_session`。问题是：

- 改一个产品功能（如"split pane"）要跨 3 个子目录调：`local_session`（创建子 PTY）+ `session_manager`（注册 Session）+ `tmux_session`（如果是 tmux）
- `session_manager.rs` 一个文件 3000+ 行——同时管 local/ssh/tmux 三种 session 的注册、回收、reconnect
- bug 0009 的根因：`SessionManager::create_tmux` 直接读 `TmuxController.window_bindings` 内部 HashMap——跨子目录的字段直读

v1（本文档）把 `services/` 重新切为 **5 个数据 domain**——与 frontend `service/` 的 5 domain **镜像**：

| v0 (按资源类型) | v1 (按数据 domain) | 依据 |
|---|---|---|
| `session_manager.rs` | `services/session/` | session 元数据 = 跨 module 共享的"核心 domain" |
| `local_session/` | `services/session/local/`（子模块）| local 是 session 的一种 backend 实现 |
| `ssh_session/` | `services/session/ssh/`（子模块）| ssh 是 session 的一种 backend 实现 |
| `tmux_session/` | `services/tmux/` | tmux 是独立的"派生 domain"（frontend 同样独立）|
| `session_log.rs` | `services/session/log.rs`（子模块）| session 日志是 session 的子关注点 |
| —（缺） | `services/workspace/` | MVP backend 无 workspace 状态，**预留位** |
| —（缺） | `services/settings/` | settings 持久化在 `commands/persistence.rs` + `logging_setup`，应抽出 |
| —（缺） | `services/persistence/` | tauri-plugin-store wrapper 应独立 |

## 1. 5 个 domain

```
src-tauri/src/services/                          # 语义名（顶层 5 domain）
├── mod.rs                 5 domain re-export 集合
├── session/               ⭐ 核心 domain：所有 session 元数据 + lifecycle
│   ├── api.rs             (pub SessionManager + AppSession + Trait)
│   ├── manager.rs         SessionManager（中央状态机）—— 拆自 v0 session_manager.rs
│   ├── registry.rs        DashMap<u32, ActiveSession>（按 id 索引）
│   ├── backends/
│   │   ├── local.rs       LocalSession + PtyPair 持有（拆自 v0 local_session/）
│   │   ├── ssh.rs         SshSession + russh 连接（拆自 v0 ssh_session/）
│   │   └── tmux_pane.rs   TmuxPaneHandle（拆自 v0 tmux_session/ 内嵌部分）
│   ├── log.rs             start_session_logging（拆自 v0 session_log.rs）
│   ├── id.rs              SessionIdSource（u32 分配器）
│   ├── errors.rs          SessionError / TmuxError（thiserror）
│   └── *.test.rs
│
├── workspace/             预留位：MVP 无 backend workspace 状态（pane tree 在 frontend store）
├── tmux/                  ⭐ 派生 domain：tmux -CC control mode 状态机 + 协议层
│   ├── api.rs             (pub TmuxController + 注册表 + Trait)
│   ├── controller/
│   │   ├── mod.rs         TmuxController struct + 共享 helper
│   │   ├── spawn.rs       4 个构造函数
│   │   ├── commands.rs    11 个用户面向的 tmux command
│   │   ├── io_tasks.rs    spawn_*_task（reader/writer/stderr/monitor）
│   │   ├── registry.rs    binding 访问器（pane_bindings / window_bindings）
│   │   ├── sync.rs        close + bootstrap rendezvous
│   │   ├── id_map.rs      CommandRegistry
│   │   ├── subscriber.rs  RouterState — %begin..%end body 累积
│   │   └── tests.rs       29 个 #[tokio::test]
│   ├── dispatch.rs        spawn_dispatch_task + dispatch_event
│   ├── bridge.rs          TmuxBridge — ProtocolEvent → Tauri 事件
│   ├── protocol/          纯协议层（无 I/O）—— 不动
│   └── errors.rs          TmuxError（thiserror）
│
├── settings/              ⭐ 横切 domain：应用配置 + log 配置
│   ├── api.rs             load_log_config / set_log_config / get_log_dir
│   ├── log_config.rs      LogConfig struct + reload handle 管理
│   └── defaults.rs        默认值（fallback）
│
└── persistence/           ⭐ 横切 domain：tauri-plugin-store 业务 wrapper
    ├── api.rs             save_*/load_* 纯函数入口
    ├── sessions.rs        sessions.json 读写
    ├── groups.rs          groups.json 读写
    ├── attached_tmux.rs   attached_tmux.json 读写
    └── errors.rs          PersistenceError
```

## 2. 5 个 domain 索引

每个 domain 有 3 份文档：**职责 / 对外接口 / 对下依赖**

| domain | 职责 | 对外接口 | 对下依赖 | 类型 |
|---|---|---|---|---|
| **session** | [RESPONSIBILITY](./session/RESPONSIBILITY.md) | [INTERFACE](./session/INTERFACE.md) | [DOWNSTREAM](./session/DOWNSTREAM.md) | 核心 domain |
| **workspace** | [RESPONSIBILITY](./workspace/RESPONSIBILITY.md) | [INTERFACE](./workspace/INTERFACE.md) | [DOWNSTREAM](./workspace/DOWNSTREAM.md) | 预留位（无实现）|
| **tmux** | [RESPONSIBILITY](./tmux/RESPONSIBILITY.md) | [INTERFACE](./tmux/INTERFACE.md) | [DOWNSTREAM](./tmux/DOWNSTREAM.md) | 派生 domain |
| **settings** | [RESPONSIBILITY](./settings/RESPONSIBILITY.md) | [INTERFACE](./settings/INTERFACE.md) | [DOWNSTREAM](./settings/DOWNSTREAM.md) | 横切 domain |
| **persistence** | [RESPONSIBILITY](./persistence/RESPONSIBILITY.md) | [INTERFACE](./persistence/INTERFACE.md) | [DOWNSTREAM](./persistence/DOWNSTREAM.md) | 横切 domain |

**类型分类依据**（与 frontend service README §1 一致）：

| 类型 | 判定标准 | backend 例子 |
|---|---|---|
| **核心** | 跨多个 app module 共享的元数据 | `session`（被 app/session、app/terminal、app/workspace 用）|
| **派生** | 不存原数据，存"原数据的视图"或独立子系统 | `tmux`（独立 control mode 子系统）|
| **横切** | 独立子系统，被所有 module 用 | `settings`、`persistence` |

## 3. 5 个 domain ↔ 5 个 frontend service domain 镜像表

| backend domain | frontend domain | 对应关系 |
|---|---|---|
| `services/session/` | `service/session/` | 都是 session 元数据 + IPC 桥的 source of truth |
| `services/workspace/` | `service/workspace/` | frontend 持有 workspace store；backend MVP 预留位 |
| `services/tmux/` | `service/tmux/` | backend 是 tmux 协议的 source；frontend 镜像 backend 推过来的状态 |
| `services/settings/` | `service/settings/` | backend 持有 log config；frontend 持有其他 settings 字段 |
| `services/persistence/` | `service/persistence/` | backend 持有 tauri-plugin-store 物理 IO；frontend wrapper 调用 backend |

**关键**：frontend 是"镜像 + 状态管理"，backend 是"协议 + 状态机 + 持久化"。两边**名字相同但职责相反**——这是 Three-Cut Principle 的体现（app/ui 按产品功能切 1:1 镜像；service/model/infra 按数据 domain 切，名字镜像但职责互补）。

## 4. 5 个 domain 之间的依赖

```
                  ┌──────────────────────────┐
                  │       session            │
                  │  （核心 domain：唯一允许  │
                  │    跨 domain 协调的）    │
                  └─────────┬────────────────┘
                            │ 注册 controller
                            ▼
                  ┌──────────────────────────┐
                  │         tmux             │
                  │ （派生：与 session 平行）│
                  └─────────┬────────────────┘
                            │
                            ▼
                  ┌──────────────────────────┐
                  │       settings           │
                  │  （横切：被所有 domain 用）│
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

- **session** → tmux（注册 controller 时通过 controller 公开接口）
- **session** → settings（session 创建时读 default shell 等）
- **session** → persistence（save attached_tmux / save groups——但走 `app/` 触发，service 只提供能力）
- **session** → workspace（预留：MVP 不调）
- **tmux** → persistence（auto_attach 读 attached_tmux.json——走 `app/` 触发）
- **tmux** → settings（不依赖）
- **workspace** → 任何（预留位，未来激活）
- **settings** → persistence（log_config.json 读写）
- **persistence** → 任何（**禁止**——persistence 是最底层）

## 5. 每个 domain 的内部约定

```
services/<domain>/
├── api.rs            ⭐ 唯一对外入口（pub trait + pub SessionManager 等）
├── mod.rs            re-export api.rs
└── <sub-modules>.rs  按子关注点拆（registry / backends / log / ...）
```

**强制规则**：

- 5 个 domain 之外**禁止**新加顶层子目录
- 跨 domain 调用通过 `domain::api` trait 或显式 `domain::manager.method()`——**禁止**直接读字段
- infra trait 是 stateless 抽象；service 持有所有可变状态

## 6. 跟 v0 的核心差异

| 维度 | v0 | v1（本文档）|
|---|---|---|
| 切分依据 | 资源类型（local/ssh/tmux backend 各 1 子目录）| 数据 domain（5 domain 与 frontend service 镜像）|
| `session_manager.rs` 体积 | 3000+ 行单文件 | 拆为 `session/manager.rs`（中央状态机）+ `session/backends/{local,ssh,tmux_pane}.rs` |
| session id 分配器 | `services/session_manager.rs:21` 内联 | `session/id.rs` 独立模块 + Arc 共享 |
| tmux 边界 | `services/tmux_session/` 内含 controller + bridge + protocol | `services/tmux/` 同名镜像，但 `tmux_pane` handle 移到 `services/session/backends/tmux_pane.rs` |
| session_log | `services/session_log.rs` 平铺 | `services/session/log.rs` 子模块 |
| persistence 入口 | 散在 `commands/persistence.rs` + `commands/logging.rs` | 统一在 `services/persistence/api.rs`（`commands/settings/` 通过 api.rs 调）|
| settings 入口 | `commands/logging.rs` 内联 | `services/settings/`（log_config + reload handle 管理）|
| workspace 预留位 | 不存在 | `services/workspace/` 空目录 + README 占位 |
| 跨 domain 字段直读 | `SessionManager::create_tmux` 直读 `TmuxController.window_bindings`（bug 0009 根因）| 全部通过 trait / public method |

## 7. 关键设计决策

### 7.1 为什么按数据 domain 切，不按 backend 类型切

v0 的反模式："session_manager + local_session + ssh_session + tmux_session"看起来**很 Rust**（按 backend 类型封装），但有 3 个问题：

1. **跨 backend 协调成本高**：一个产品功能（如"split tmux pane"）要碰 `tmux_session/`（建 controller）+ `session_manager/`（注册）+ `local_session/`（如果 fallback 要 new PTY）
2. **session 元数据被切碎**：`SessionManager` 同时管 3 种 session 的注册表——一个 3000 行文件
3. **与 frontend 不镜像**：frontend service 切 5 domain，backend service 切 4 子目录——两边对照时找不到对应关系

v1 按**数据 domain**切——切出来的"session domain"在 backend 和 frontend 都是同一个概念：

- **frontend** `service/session/`：Map<sessionId, Session> zustand store + IPC bridge
- **backend** `services/session/`：DashMap<u32, ActiveSession> + SessionManager 中央状态机 + 3 种 backend 实现

两边**名字相同**——开发者改 session 时知道两边是对称的。

### 7.2 backend 实现分类嵌在 session 内（local/ssh/tmux 都是 session）

session 的 3 种 backend 实现（local PTY / SSH / tmux pane）作为 `services/session/backends/` 子模块——**不**作为顶层 domain：

- 理由：3 种 backend 不是"独立的横切/核心/派生 domain"——它们都是 session 的具体实现
- 与 v0 的差异：v0 把 `local_session/` `ssh_session/` `tmux_session/` 当作顶层——子模块化降低层级
- 唯一例外：`tmux_session` 太大（11+ 文件），且 tmux 协议是独立的子系统——保留 `services/tmux/` 顶层
- tmux pane 句柄 (`TmuxPaneHandle`) 作为 `session/backends/tmux_pane.rs`——持有 controller Arc（"借" tmux domain 的 controller）

### 7.3 workspace domain 预留位

MVP backend 无 workspace 状态——pane tree 全部在 frontend store。预留 `services/workspace/` 目录 + 3 份占位 README，等"多窗口同步"激活。

### 7.4 settings domain 只管 log_config

MVP backend 的"settings"含义很窄——只有 `LogConfig`。其他 settings 字段（theme / font / sidebar width）只在 frontend store 维护。`services/settings/` 现状只暴露：

- `load_log_config(&app) -> LogConfig`
- `set_log_config(&app, &config) -> ReloadHandle`
- `get_log_dir(&app) -> PathBuf`

未来如果 backend 加 "settings 全字段持久化"（theme 等），再扩 settings domain。

### 7.5 persistence domain 跟 frontend 职责相反

frontend `service/persistence/` 是 tauri-plugin-store 的 wrapper；backend `services/persistence/` **直接持有** tauri-plugin-store 的 file IO（store key 是 backend 的字面量）。

frontend persistence 调 backend persistence 通过 IPC（`save_sessions` / `load_sessions`）。**两个 domain 名字相同但职责互补**——frontend wrapper、backend 物理 IO。

## 8. 入口链

```
src-tauri/src/lib.rs::run()
  ├─► app::shell::api::initialize(app)            (启动钩子)
  │    └─► services::settings::api::load_log_config
  │    └─► services::settings::api::init_logging_reload_handle
  └─► tauri::Builder::default()
       .manage(Arc::new(Services::new()))          (新：5 domain 单实例聚合)
       .invoke_handler(app::mod::all_handlers())
       └─► app::{session,terminal,settings}::api::*
           └─► services::{session,tmux,settings,persistence}::api::*
               └─► infrastructure::{pty,ssh,tmux,store,logger}::*
                   └─► models::*
```

**新增 `Services` struct**：聚合 5 domain 的单实例指针，让 Tauri 的 `State<Arc<Services>>` 一次注入。

```rust
pub struct Services {
    pub session: Arc<session::SessionManager>,
    pub tmux: Arc<tmux::TmuxControllerRegistry>,  // 可选，session 内部持有
    pub settings: Arc<settings::SettingsState>,
    pub persistence: Arc<persistence::PersistenceState>,
    pub workspace: Arc<workspace::WorkspaceState>,  // MVP 预留
}
```

MVP 兼容：保留 `app.manage(Arc::new(SessionManager::new()))` 单点注入——`Services` 在下一个 PR 引入。

## 9. 文档地图

- 顶层（本文）：设计契约 / 现状映射 / 依赖方向 / v0→v1 diff
- 5 domain 子文档：每个 domain 3 份（RESPONSIBILITY / INTERFACE / DOWNSTREAM）
- 镜像验证：每份 domain README 的 §3 列 frontend 对应 domain 的同构说明

**TM 验收入口**：先读本文档，再对照 `services/mod.rs` 的 5 domain re-export + `SessionManager::create_tmux` 等关键路径。