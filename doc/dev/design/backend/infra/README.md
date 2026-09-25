# Backend · Infra 层（v1：按外部资源切分）

> **位置**：`src-tauri/src/infrastructure/`（目录名沿用 Rust 习惯）
> **关注点**：物理适配（PTY 子进程 / SSH 协议 / tmux 协议 / Tauri runtime）
> **平级于**：app / service / model（4 个顶层目录之一）
> **前端对应**：[`../../frontend/infra/`](../../frontend/infra/README.md)（同样按外部资源切 4 子模块）

## 0. 为什么重写这一层

v0 把 `infrastructure/` 当作"几个 trait 文件"的混合包：`pty.rs / ssh.rs / app_backend.rs / session_backend.rs / binary_frame.rs / tmux/`。问题：

- **混了"外部资源"与"抽象 trait"**：`session_backend.rs` 是 3 种 backend 的**抽象接口**，不该放在 infra（它是 service 关注）
- **`binary_frame.rs` 归属混乱**：服务于 Tauri event 推送的 binary payload，**不**独立成 infra 顶层模块
- **`app_backend.rs` 是 Tauri 适配**：但放在 `infrastructure/` 顶层，命名上不清楚它属于 Tauri runtime
- **tmux 子目录只有 1 文件**：`tmux/{mod.rs, backend.rs}` 与平铺的 `pty.rs` 不一致

v1（本文档）把 `infrastructure/` 重构为 **4 子模块按外部资源切分**，与 frontend `infra/` 镜像：

| v0 现状 | v1 落点 | 依据 |
|---|---|---|
| `infrastructure/pty.rs` | `infrastructure/pty/` | 外部资源：OS PTY 子进程 |
| `infrastructure/ssh.rs` | `infrastructure/ssh/` | 外部资源：SSH 协议 |
| `infrastructure/tmux/` | `infrastructure/tmux/` | 外部资源：tmux 控制模式（保留） |
| `infrastructure/app_backend.rs` | `infrastructure/tauri/app_backend.rs` | Tauri runtime 适配 |
| `infrastructure/binary_frame.rs` | `infrastructure/tauri/binary_frame.rs` | Tauri event binary payload 编解码 |
| `infrastructure/session_backend.rs` | ❌ **迁出** `infrastructure/` → `services/session/backends/traits.rs` | service-level 抽象，**不是**外部资源 |

## 1. 4 子模块

```
src-tauri/src/infrastructure/
├── mod.rs                re-export 4 子模块
│
├── pty/                  ⭐ 外部资源 1:OS PTY 子进程
│   ├── mod.rs            PtySystem trait + PtyPair + NativePtySystem impl
│   ├── traits.rs         PtySystem trait 定义
│   ├── native.rs         NativePtySystem impl(portable-pty)
│   ├── pair.rs           PtyPair struct(PTY master + slave)
│   ├── mock.rs           mockall 自动 mock(#[automock])
│   └── errors.rs         PtyError(thiserror)
│
├── ssh/                  ⭐ 外部资源 2:SSH 协议
│   ├── mod.rs            SshBackend trait + SshBackendImpl(russh)
│   ├── traits.rs         SshBackend trait 定义
│   ├── backend.rs        SshBackendImpl(russh 连接 + 读写循环)
│   ├── upload.rs         upload_file_via_ssh / upload_image(SCP)
│   ├── probe.rs          run_command_capture_stdout(tmux probe 用)
│   ├── session.rs        SshSession struct(russh channel + 读循环)
│   ├── mock.rs           mockall 自动 mock
│   └── errors.rs         SshError(thiserror,含 host-key 警告)
│
├── tmux/                 ⭐ 外部资源 3:tmux 控制模式
│   ├── mod.rs            re-export traits + 子模块
│   ├── backend.rs        TmuxBackend trait + LocalTmuxBackend + SshTmuxBackend
│   ├── errors.rs         TmuxInfraError(与 services/tmux/errors.rs 区分)
│   └── mock.rs           mockall 自动 mock
│
└── tauri/                ⭐ Tauri runtime 适配
    ├── mod.rs            re-export
    ├── app_backend.rs    ⭐ AppBackend trait + RealAppBackend(Tauri AppHandle wrapper)
    ├── binary_frame.rs   ⭐ binary payload 编解码(session-output frames)
    └── errors.rs         TauriError(thiserror)
```

## 2. 4 子模块索引

每个子模块有 3 份文档：**职责 / 对外接口 / 对下依赖**

| 子模块 | 职责 | 对外接口 | 对下依赖 | 外部资源 |
|---|---|---|---|---|
| **pty** | [RESPONSIBILITY](./pty/RESPONSIBILITY.md) | [INTERFACE](./pty/INTERFACE.md) | [DOWNSTREAM](./pty/DOWNSTREAM.md) | OS PTY 子进程 |
| **ssh** | [RESPONSIBILITY](./ssh/RESPONSIBILITY.md) | [INTERFACE](./ssh/INTERFACE.md) | [DOWNSTREAM](./ssh/DOWNSTREAM.md) | SSH 协议（russh） |
| **tmux** | [RESPONSIBILITY](./tmux/RESPONSIBILITY.md) | [INTERFACE](./tmux/INTERFACE.md) | [DOWNSTREAM](./tmux/DOWNSTREAM.md) | tmux 控制模式（外部子进程） |
| **tauri** | [RESPONSIBILITY](./tauri/RESPONSIBILITY.md) | [INTERFACE](./tauri/INTERFACE.md) | [DOWNSTREAM](./tauri/DOWNSTREAM.md) | Tauri runtime（AppHandle / Channel / Emitter） |

## 3. 4 子模块 ↔ 4 frontend infra 子模块镜像表

| backend 子模块 | frontend 子模块 | 对应关系 |
|---|---|---|
| `infra/pty/` | `infra/tauri/commands/*`（前端无 PTY）| backend 用 `portable-pty` crate；frontend 不需要 |
| `infra/ssh/` | （前端无 SSH）| backend 用 `russh` crate；frontend 不需要 |
| `infra/tmux/` | （前端无 tmux）| backend 用 `tmux -CC` 子进程；frontend 通过 IPC 镜像 |
| `infra/tauri/`（AppBackend + binary_frame）| `infra/tauri/{commands,events,repositories,eventBuses}` + `infra/store` + `infra/clipboard` | 都是 Tauri 适配层 |

**关键观察**：

- backend **独有**：`pty / ssh / tmux` 三个外部资源子模块——前端不需要（前端通过 IPC 接收 backend 推送的状态）
- frontend **独有**：`clipboard / logger` 两个横切工具——backend 通过 `tauri_plugin_clipboard_manager` plugin + `crate::logging_setup` 实现,不在 infra 顶层
- **共有**：`tauri` 子模块——两边都是 Tauri runtime 适配（前端是 `invoke / listen`，backend 是 `AppHandle / Channel / emit`）

## 4. 关键设计决策

### 4.1 为什么按"外部资源"切,不按"trait 类型"切

v0 反模式：`infrastructure/{pty,ssh,tmux,app_backend,session_backend,binary_frame}.rs` 6 个文件混在一起。问题是：

- **抽象 trait 与实现混在一起**：`app_backend.rs` / `session_backend.rs` 是抽象 trait，但和其他 trait 实现文件平铺
- **找不到外部资源的对应模块**：`tmux/` 是子目录，`ssh.rs / pty.rs` 是顶层文件——视觉上不一致
- **`session_backend.rs` 不属于 infra**——它是 3 种 backend 的抽象接口，是 service 关注

v1 边界：

- **4 子模块按"外部资源"切**：`pty / ssh / tmux / tauri`——每个对应一个外部系统
- **每个子模块内**：`traits.rs / native.rs / mock.rs / errors.rs`——清晰的"trait + impl + mock + error"4 件套
- **`session_backend.rs` 迁出 infra** → `services/session/backends/traits.rs`（service 关注）

### 4.2 为什么 `session_backend.rs` 不该在 infra

`SessionBackend` trait 定义了 PTY / SSH / tmux pane 三种 backend 的**共同接口**——它是**抽象**，不是"外部资源"。

关键判据：

- **infra 是"对外部世界的接口"**——如 `PtySystem::openpty()` 调用 `portable-pty` crate
- **`SessionBackend` 是"对 service 的接口"**——它抽象 3 种 backend 让 `SessionManager` 统一调度

`SessionBackend` 不与任何外部资源对应——它是 service 层的多态边界。**正确归位**：`services/session/backends/traits.rs`（service-level trait 定义）。

### 4.3 为什么 `app_backend.rs` 归 `infra/tauri/`

`AppBackend` trait 提供：

- `emit(event, payload)` —— 调用 Tauri 的 `app.emit()`
- `emit_binary(bytes)` —— 调用 Tauri 的 `Channel::send()`
- `spawn(f)` —— 调用 `std::thread::spawn()`

所有方法都依赖 Tauri runtime（`tauri::AppHandle` / `tauri::Emitter` / `tauri::ipc::Channel`）。`AppBackend` 是 Tauri runtime 的**抽象层**——正确归位：`infra/tauri/app_backend.rs`。

### 4.4 为什么 `binary_frame.rs` 归 `infra/tauri/`

`binary_frame.rs` 定义 `BinaryFrame` 编解码格式，专门用于 Tauri `Channel<Vec<u8>>` 推送 `session-output` 二进制帧（Perf 001）。

它服务于 Tauri event 推送——正确归位：`infra/tauri/binary_frame.rs`。

### 4.5 frontend `infra/store` 与 backend 持久化的边界

frontend `infra/store` 是 `tauri-plugin-store` 的 wrapper——通过 IPC 调 backend 持久化。

backend **没有** `infra/store` 子模块——`tauri-plugin-store` 由 `services/persistence/api.rs` 直接持有（**唯一**允许直接 import `tauri_plugin_store` 的 service）。

frontend `infra/store` ↔ backend `services/persistence/` 镜像——两端职责互补：前端 wrapper、后端物理 IO。

### 4.6 frontend `infra/clipboard` 在 backend 不存在

frontend `infra/clipboard` 是 `tauri-plugin-clipboard-manager` 的 wrapper。

backend **没有** `infra/clipboard`——`tauri-plugin-clipboard-manager` 在 `lib.rs::run()` 注册为 Tauri plugin（`tauri_plugin_clipboard_manager::init()`），由 frontend 通过 IPC 直接调。backend 不持有 clipboard 业务逻辑。

### 4.7 frontend `infra/logger` 在 backend 等价于 `crate::logging_setup`

frontend `infra/logger` 是 console forwarder（前端 console → 后端 tracing）。

backend 等价物是 `crate::logging_setup`（在 `src-tauri/src/logging_setup.rs`）——但它是 **infra-level 工具模块**，**不**在 `src-tauri/src/infrastructure/` 顶层下。理由：

- `logging_setup` 是跨多个 service 的工具（services/settings + services/session_log 都用）
- 它不是"对单一外部资源的接口"——而是跨层工具
- v1 backend 设计保持现状：`logging_setup` 在 `src-tauri/src/` 顶层（与 `error.rs / main.rs` 同级）

## 5. 关键约束

### 5.1 trait 必须能 mock

每个对外暴露的 trait 必须有 mock 实现（`mockall` 自动 mock 或手写）：

- `PtySystem`（在 `infra/pty/mock.rs`）
- `SshBackend`（在 `infra/ssh/mock.rs`）
- `TmuxBackend`（在 `infra/tmux/mock.rs`）
- `AppBackend`（在 `infra/tauri/mock.rs`——v1 新增）

### 5.2 不做业务规则

"如果收到 EOF 就关闭 session"这种逻辑在 service 层；infra 只暴露 `read() -> Result<Vec<u8>, IoError>`。

### 5.3 错误用 `thiserror` 派生

每个子模块有自己的 `errors.rs`，统一用 `thiserror::Error` derive：

- `infra/pty/errors.rs::PtyError`
- `infra/ssh/errors.rs::SshError`
- `infra/tmux/errors.rs::TmuxInfraError`（与 `services/tmux/errors.rs::TmuxError` 区分）
- `infra/tauri/errors.rs::TauriError`

service 层通过 `?` 运算符 + `From<...> for String` 自动转换。

### 5.4 不依赖 service / app / commands

infra 只依赖 `models/*`（纯数据类型）+ 外部 crate（`portable-pty / russh / tokio / tauri`）。

**禁止**：

- ❌ `infra/` → `crate::services::*`
- ❌ `infra/` → `crate::app::*`
- ❌ `infra/` → `crate::commands::*`

## 6. 依赖方向

```
infra/pty / ssh / tmux / tauri
       │
       ▼
   models/*      (纯数据类型作为 trait 关联类型)
       │
       ▼
   外部 crate: portable-pty / russh / tokio::process / tauri / ...
```

infra 层**禁止**依赖 service / app / commands。

## 7. 强制约束（可机械校验）

```bash
# infra 不依赖 service / app / commands
grep -rn 'use crate::\(services\|app\|commands\)' src-tauri/src/infrastructure/
# 必须为空

# infra 不依赖 tokio::main / actix / async-std（只允许 tokio::process / tokio::io 等具体 API）
grep -rn 'use \(tokio::main\|actix\|async_std\)' src-tauri/src/infrastructure/
# 必须为空

# infra 只能读 models 类型，不调用 model 函数
grep -rn 'use crate::models::' src-tauri/src/infrastructure/ | grep -v '::types\|::accessor\|::helpers'
# 必须为空（只允许读 types / accessor / helpers 的纯数据）
```

## 8. 跟 v0 的核心差异

| 维度 | v0 | v1（本文档）|
|---|---|---|
| 顶层结构 | 平铺 6 文件 + 1 子目录 | **4 子模块按外部资源切** |
| `session_backend.rs` | 在 `infrastructure/` 顶层 | ❌ 迁出 → `services/session/backends/traits.rs` |
| `app_backend.rs` | 在 `infrastructure/` 顶层 | 移入 `infrastructure/tauri/app_backend.rs` |
| `binary_frame.rs` | 在 `infrastructure/` 顶层 | 移入 `infrastructure/tauri/binary_frame.rs` |
| `pty.rs` / `ssh.rs` | 单文件（trait + impl 混合）| 子目录（traits.rs + native.rs + mock.rs + errors.rs 拆分）|
| `tmux/` | `{mod, backend}.rs` | 扩展为 `{mod, backend, errors, mock}.rs` |
| mock 风格 | 不一致（手写 + 自动混用）| **统一规则**：infra 用 `#[automock]`，service 用手写 fixture |
| 错误聚合点 | `crate::error.rs::AppError` 预留位置 | 每个子模块独立 `errors.rs`（thiserror derive）|

## 9. 入口链

```
src-tauri/src/lib.rs::run()
  ├─► app::shell::api::initialize(app)
  │    └─► services::settings::api::load_log_config
  │         └─► infra::tauri::RealAppBackend::new(app)   ← infra 在最底
  │              └─► tauri::AppHandle / Channel::new
  └─► tauri::Builder::default()
       .invoke_handler(app::mod::all_handlers())
       └─► app::{session,terminal,settings}::api::*
           └─► services::{session,tmux,settings,persistence}::api::*
               └─► infra::{pty,ssh,tmux,tauri}::*            ← infra 在最底
                   └─► models::{session,workspace,tmux,settings,cross_cutting}::*
                       └─► 外部 crate: portable-pty / russh / tokio / tauri
```

## 10. 重要警告（继承 v0）

- **`ssh.rs` 禁用了 host-key 校验**（AGENTS.md 已记录）。这是已知安全债，**禁止**在本层之外的位置重新打开或绕过
- **`binary_frame.rs` 只服务于 Tauri Channel 推送 session-output 二进制帧**——非 SSH 专用。如果以后出现非 Tauri 场景的二进制 I/O，再讨论是否提到更通用的位置
- **mockall 风格统一**：`#[automock]`（infra 层）+ 手写 fixture（service 层）——两种风格保持，不混

## 11. 文档地图

- 顶层（本文）：设计契约 / 现状映射 / 依赖方向 / v0→v1 diff
- 4 子模块子文档：每个子模块 3 份（RESPONSIBILITY / INTERFACE / DOWNSTREAM）
- 镜像验证：每份子模块 README 的 §3 列 frontend 对应子模块的同构说明

**TM 验收入口**：先读本文档，再对照 `src-tauri/src/infrastructure/mod.rs` 的 4 子模块 re-export + `src-tauri/src/services/session/backends/traits.rs::SessionBackend`（已迁出 infra）。