# Backend · Service 层 (= `src-tauri/src/services/`)

> **职责**：业务编排。会话生命周期、PTY/SSH/tmux 后端的协调、binding 表维护、日志写入，都在这一层。service 知道**为什么**这样调用 infra，不只是「转发」。

## 1. 模块清单（现状）

```
src-tauri/src/services/
├── mod.rs                       re-export 4 个子模块
├── session_manager.rs           SessionManager — 中央状态机，所有 session 的注册表
├── session_log.rs               前端 log_message → rolling file writer
├── local_session/               本地 PTY 会话
│   ├── mod.rs                   LocalSession struct + PtyPair 持有
│   ├── spawn.rs                 启动 pty + 写首字节
│   ├── bytes.rs                 read 循环 → emit("session-output")
│   ├── resolution.rs            解析命令字符串（quote/escape/env var）
│   └── tests.rs                 mockall 单测
├── ssh_session/                 SSH 会话（russh）
│   └── mod.rs                   SshSession + 连接/认证/读循环
└── tmux_session/                tmux -CC control mode（最大子系统）
    ├── mod.rs                   入口 + From<TmuxError> for String
    ├── dispatch.rs              spawn_dispatch_task + dispatch_event
    ├── errors.rs                TmuxError 枚举（thiserror）
    ├── bridge/mod.rs            TmuxBridge — ProtocolEvent → Tauri 事件
    ├── protocol/                纯协议层（无 I/O）
    │   ├── mod.rs
    │   ├── codec.rs             octal \nnn 编解码
    │   ├── command.rs           CommandId / CommandKind / ResponseWaiter / TaggedCommand
    │   ├── events.rs            ProtocolEvent 枚举（30+ 变体）
    │   ├── parser.rs            line → Option<ProtocolEvent>
    │   ├── version.rs           CapabilityMatrix
    │   └── wire.rs              "send-keys" / "split-window" 文本构造
    └── controller/              状态机 + task 管理
        ├── mod.rs               TmuxController struct + 共享 helper
        ├── spawn.rs             4 个构造函数
        ├── commands.rs          11 个用户面向的 tmux command
        ├── io_tasks.rs          spawn_*_task（reader/writer/stderr/monitor）
        ├── registry.rs          binding 访问器
        ├── sync.rs              close + bootstrap rendezvous
        ├── id_map.rs            CommandRegistry
        ├── handshake.rs         v2 handshake 计划
        ├── subscriber.rs        RouterState — %begin..%end body 累积
        └── tests.rs             29 个 #[tokio::test]
```

## 2. 关键约束

- **service 持有状态，infra 是 stateless trait 实现**。`SessionManager` 是单例 `Arc<Mutex<...>>`，里面维护 session id → LocalSession/SshSession/TmuxController 的映射。
- **service 之间不互调**。所有跨子系统的协作（如 `session_manager` 创建 tmux 时查询 window_bindings）通过 `models/` 的共享数据类型，而不是直接 `use crate::services::tmux_session::*`。
- **service 是唯一允许使用 `tokio::spawn` 的层**。infra trait 是同步的（或者返回 `BoxFuture`），由 service 决定如何调度。
- **service 不知道 Tauri 命令的存在**。错误不预设 IPC 序列化形式；`Result<T, ServiceError>` 留给 commands 层 `map_err`。

## 3. tmux 子系统专题

tmux 是本层最大的子系统，已经有 5 个 ADR + 1 篇专题文档。本 README 不重复描述字段级设计，链接如下：

- 设计意图：[`../../adr/0005-tmux-redesign-v0.md`](../../adr/0005-tmux-redesign-v0.md)
- 字段 / task / waiter 详解：[`../../architecture/06-tmux-runtime-architecture.md`](../../architecture/06-tmux-runtime-architecture.md)
- 路由 handshake：[`../../adr/0008-tmux-handshake-v2.md`](../../adr/0008-tmux-handshake-v2.md)
- 历史 bug 记录（含 0009 window_bindings 双写）：[`../../changelog/bugs.md`](../../changelog/bugs.md)

## 4. 依赖方向

```
services/  ──►  infrastructure/  ──►  models/
    │
    └─►  models/  (跨子系统的 binding 数据：session_id、xsterm_window_id 等)
```

**禁止**：`services/tmux_session::*` 被 `services/session_manager::*` 直接调用；共享数据走 `models/group.rs` 或 `models/session.rs` 里定义的 binding 类型。

## 5. 改进方向

- **`SessionManager` 拆分**：现状一个 1500+ 行的 `session_manager.rs` 同时负责 local/ssh/tmux 三种 session 的注册、回收、reconnect。建议拆为 `services/session_manager/{core,local,ssh,tmux}_registry.rs`，对应 4 个 sub-state。
- **service 之间共享走 trait 接口而非直接 import**：`SessionManager::create_tmux` 现在直接读 `TmuxController` 的内部 HashMap（导致 bug 0009），目标态用 `trait TmuxSessionRegistry { fn xsterm_window_id_for(xsterm_id) -> Option<u64>; }` 由 controller 实现。
- **`tmux_session/` 已经按 sub-module 拆完**：本层是其他三个（local/ssh/session_log）接下来要复制的样板。
- **session_log.rs 体积小**，可以保留；下一步给它加 `tracing` span 关联 `session_id`，让一次会话的日志能 grep 出来。
