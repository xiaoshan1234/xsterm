# Domain · Terminal — 职责

> **位置**：`src-tauri/src/domain/terminal/`
> **类型**：⭐ 派生 domain（tmux -CC control mode 子系统）
> **被调用方**：`commands/terminal`、`domain/session`（代理给 `TmuxController` 公开方法）、`commands/shell`（auto_attach 启动）
> **Frontend 对应**：[`../../../frontend/service/tmux/RESPONSIBILITY.md`](../../../frontend/service/tmux/RESPONSIBILITY.md)

## 1. 这个 domain 负责什么

terminal domain 持有**tmux -CC control mode 子系统的全部逻辑**——backend 的 tmux controller 状态机 + tmux 协议层 + 事件 bridge + tmux 纯类型 + 算法。


- "tmux 状态机"（原 `services/tmux/`）当独立 domain——但 tmux 是**terminal 产品功能的子集**，不是独立业务
- tmux domain 改名 `services/tmux/` → `domain/terminal/`（按产品功能切）
- `models/tmux/` 合并到 `domain/terminal/`（service + model 合并）

承担 6 大类职责（合并后）：

### 1.1 状态机层

1. **TmuxController 状态机** —— `spawn_create_tmux / attach_tmux`，每个 controller 持 1 个 `tmux -CC` 子进程
2. **tmux pane / window 注册表** —— `pane_bindings: HashMap<tmux_pane_id, xsterm_session_id>` + `window_bindings: HashMap<tmux_window_id, xsterm_window_id>`
3. **tmux 协议层** —— octal 解码 / 命令 ID 分配 / `ProtocolEvent` 解析
4. **tmux Bridge** —— `ProtocolEvent → Tauri 事件` 转换（推给 frontend listener）
5. **dispatch task** —— 从 `tmux -CC` 子进程 stdout 读事件 → dispatch 到 controller
6. **11 个用户面向的 tmux command** —— send-keys / split-window / kill-pane / capture-pane / new-window / kill-window / rename-window / list-windows / list-panes 等

### 1.2 数据 + 算法层

1. **tmux 配置类型** —— `TmuxCcConfig`（创建 / attach 的入参）
2. **tmux 初始化返回类型** —— `TmuxSessionInit / TmuxWindowInit / TmuxPaneInit / TmuxControlWindowInit`（同步返回的初始状态）
3. **tmux 持久化类型** —— `AttachedTmuxServer`（attached_tmux.json 序列化形态）
4. **纯 helper 函数** —— `tmux_pane_info()`（构造 `SessionInfo` 的 helper）

### 1.3 错误处理

- `TmuxError`（thiserror derive）—— TmuxError 内部使用
- 与 `infra/tmux/errors.rs::TmuxInfraError` 区分（infra 层用 TmuxInfraError）

## 2. 这个 domain **不**负责什么

- **不持有 tmux pane handle** —— `TmuxPaneHandle` 在 `domain/session/backends/tmux_pane.rs`（session 的 backend impl）
- **不持有 session 元数据** —— 归 `domain/session/`
- **不持有 workspace 状态** —— workspace 状态完全 frontend 持有
- **不渲染 UI** —— backend 无 UI
- **不直接被 commands/terminal 调** —— commands/terminal 调 `domain/session::SessionManager::create_tmux`（session 代理），不直接调 terminal 内部

## 3. 子结构（合并后）

```
domain/terminal/
├── types.rs              # 纯数据 + serde derive：TmuxCcConfig / TmuxSessionInit / TmuxWindowInit / TmuxPaneInit / TmuxControlWindowInit / AttachedTmuxServer
├── rules.rs              # 纯 helper：tmux_pane_info() (构造 SessionInfo)
├── controller/           # TmuxController struct + 共享 helper（`services/tmux/controller/`）
│   ├── mod.rs            TmuxController struct（状态机主体）
│   ├── spawn.rs          4 个构造函数（spawn_create / spawn_attach / spawn_local / spawn_ssh）
│   ├── commands.rs       11 个用户面向的 tmux command（send-keys / split-window / kill-pane / ...）
│   ├── io_tasks.rs       spawn_*_task（reader/writer/stderr/monitor）
│   ├── registry.rs       binding 访问器（pane_bindings / window_bindings）
│   ├── sync.rs           close + bootstrap rendezvous
│   ├── id_map.rs         CommandRegistry
│   └── subscriber.rs     RouterState — %begin..%end body 累积
├── dispatch.rs           spawn_dispatch_task + dispatch_event
├── bridge.rs             TmuxBridge — ProtocolEvent → Tauri 事件
├── protocol/             纯协议层（无 I/O）—— 不动
│   ├── wire.rs           octal codec
│   ├── command.rs        CommandKind 枚举
│   ├── events.rs         ProtocolEvent 枚举
│   ├── parser.rs         parser
│   └── version.rs        handshake
├── state.rs              ⭐ 新增：TmuxController 顶层结构（ controller/mod.rs）
├── api.rs                ⭐ 新增：唯一对外入口（，commands 直接调 controller 内部）
├── errors.rs             TmuxError（thiserror）
└── *.test.rs             29 个 #[tokio::test]
```

** 文件迁移**：

| 位置 | 位置 |
|--|--|
| `services/tmux/controller/mod.rs`（TmuxController struct） | `domain/terminal/state.rs`（独立成文件）+ `controller/mod.rs`（impl） |
| `services/tmux/controller/{spawn,commands,io_tasks,registry,sync,id_map,subscriber}.rs` | `domain/terminal/controller/{...}.rs`（不变） |
| `services/tmux/dispatch.rs` | `domain/terminal/dispatch.rs`（不变） |
| `services/tmux/bridge.rs` | `domain/terminal/bridge.rs`（不变） |
| `services/tmux/protocol/{wire,command,events,parser,version}.rs` | `domain/terminal/protocol/{...}.rs`（不变） |
| `services/tmux/errors.rs` | `domain/terminal/errors.rs`（合并） |
| `services/tmux/api.rs`（不存在——commands 直接调 controller 内部） | `domain/terminal/api.rs`（**新增**——强制 api.rs 唯一入口） |
| `models/tmux/types.rs` | `domain/terminal/types.rs`（合并 TmuxCcConfig + TmuxSessionInit 等） |
| `models/tmux/accessor.rs::tmux_pane_info()` | `domain/terminal/rules.rs`（纯 helper 归 rules） |
| `models/tmux/errors.rs::TmuxConfigError` | `domain/terminal/errors.rs`（合并） |

## 4. 跟其他 domain 的关系

| domain | 关系 |
|--|--|
| `domain/session` | session 持有 `Arc<TmuxController>` 引用 + 调公开方法（`send_keys / resize_pane / capture_pane / detach`）——**禁止**字段直读（bug 0009 防御） |
| （已删除——workspace 状态完全 frontend 持有）| workspace pane 可指向 tmux pane（`tmux_pane_id: Option<String>` 字段）——workspace 不调 terminal |
| （已删除——见各归属 domain）| MVP 不调；目标态下 terminal 可能读 settings（如终端默认 preference） |
| （已删除——v6 砍） | terminal **直接** import `tauri_plugin_store`——`attached_tmux.json` 由 `domain/terminal::attached_tmux` 内部触发持久化（typed wrapper） |
| `infra/tmux` | terminal 通过 `infra::tmux::TmuxBackend` trait 调外部 tmux -CC 子进程——terminal 持有 trait object |

## 5. 跟 commands 的关系

| commands module | 怎么用 domain/terminal |
|--|--|
| `commands/terminal` | frontend 调 `invoke('create_tmux_pane', ...)` → commands/terminal/commands/tmux/pane.rs 调 `domain/session::SessionManager::create_tmux_pane`（session 代理） |
| `commands/session` | `create_tmux_session` / `attach_tmux_session` 调 `domain/session::SessionManager::create_tmux`（session 内部转给 `TmuxController`） |
| `commands/shell` | 启动时 `auto_attach_on_startup` —— 通过 `domain/session::SessionManager::auto_attach_on_startup`（session 调 `TmuxController::attach`） |
| `commands/terminal` | 调 `domain/terminal::api::save_attached_tmux` 持久化 attached tmux 列表 |

**关键**：commands **不直接** import `domain/terminal::*` —— 全部通过 `domain/session::SessionManager` 代理。这是 bug 0009 防御的关键。

## 7. 这个 domain 的"产品语言"术语

- **tmux controller** —— backend 维护的 tmux -CC 连接（每个 controller 持 1 个 tmux 子进程）
- **attach / detach** —— attach 到 / detach 自 tmux controller
- **tmux pane / window** —— tmux 自己的 pane / window 概念（跟 xsterm pane / window 不完全对应）
- **terminal preferences** —— terminal 偏好（font / fontSize / theme）
- **dispatch task** —— 后台 task，从 tmux -CC 子进程 stdout 读 octal-encoded 事件
- **subscriber** —— `RouterState` 累积 `%begin ... %end` body（command response body 累积）

## 8. 关键设计约束

### 8.1 TmuxController 公开方法（bug 0009 防御）

```rust
impl TmuxController {
    pub fn controller_id(&self) -> u32;
    pub fn session_name(&self) -> &str;
    pub fn tmux_window_id_for_pane(&self, pane_id: &str) -> Option<String>;
    pub fn send_keys(&self, pane_id: &str, bytes: &[u8]) -> Result<(), TmuxError>;
    pub fn resize_pane(&self, pane_id: &str, cols: u16, rows: u16) -> Result<(), TmuxError>;
    pub fn capture_pane(&self, pane_id: &str, lines: u32) -> Result<String, TmuxError>;
    pub fn detach(&self) -> Result<(), TmuxError>;
    pub fn close(&mut self, kill_server: bool) -> Result<(), TmuxError>;

    // 内部字段（bug 0009 直读这些字段——严格禁止）
    // pane_bindings: HashMap<...> (pub(crate))
    // window_bindings: HashMap<...> (pub(crate))
    // initial_state: Option<TmuxInitialState> (pub(crate))
    // dispatch_task: JoinHandle<()> (pub(crate))
}
```

**bug 0009 根因**：`SessionManager::create_tmux` 直读 `TmuxController.window_bindings` HashMap。**严格禁止字段直读**——所有跨 domain 访问走公开方法。

### 8.2 dispatch task 不感知 frontend

dispatch task 是**纯后台 task**——从 `tmux -CC` 子进程 stdout 读事件，写入 `TmuxController` 状态。

dispatch task 通过 `Bridge` 模块 emit 到 Tauri（推给 frontend listener）——但 dispatch task **不** import `tauri`（不感知 IPC 边界）。Bridge 模块隔离 Tauri 依赖。

### 8.3 protocol 层是纯协议（无 I/O）

`protocol/` 子目录是**纯协议层**——octal codec / CommandKind / ProtocolEvent 枚举 / parser。**不依赖任何 IO**——可纯函数测试。

**约束**：`protocol/` 子目录**不** import `tokio` / `tauri` / `std::process` / `std::net`——是 xsterm 中可纯函数测试的最纯模块之一。

### 8.4 auto_attach 是 startup 入口

启动时 `auto_attach_on_startup` 读 `attached_tmux.json`，遍历每个 server 调 `attach`——dispatch task 同步握手 + bootstrap pane 读取，然后返回 attach outcome。

**当前路径**：`commands/shell/api.rs::initialize` → `domain/session::SessionManager::auto_attach_on_startup` → `domain/terminal::TmuxController::spawn_attach` → bridge emit events。

## 10. 跟 frontend service 的职责分叉

| 维度 | frontend service/tmux | backend domain/terminal |
|--|--|--|
| 类型定义 | TS interface | Rust serde struct |
| 状态机 | zustand store（pane bindings / window bindings 镜像） | `Arc<DashMap>` + `TmuxController` 状态机 |
| tmux 协议层 | 不存在（frontend 只接收 backend 推的事件） | `domain/terminal/protocol/`（octal codec / parser） |
| dispatch task | 不存在 | 后台 tokio task |
| Bridge | 不存在 | `domain/terminal/bridge.rs`（ProtocolEvent → Tauri emit） |
| auto_attach | frontend 启动时调 `invoke('auto_attach_tmux_servers')` | backend `SessionManager::auto_attach_on_startup` |

**frontend 是镜像 + 状态同步；backend 是协议 + 状态机 + Bridge**——两边职责清晰分叉。