# Backend · Services — 设计

> **位置**：`src-tauri/src/services/`
> **职责**：业务编排 + 跨 layer 状态 + 子系统独立 module
> **拆分**：核心（session_manager + 4 个 session 子 module）+ 5 个 NEW 子 module

## 1. 子 module 索引

```
src-tauri/src/services/
├── mod.rs                    5 行 re-exports
│
├── session_manager.rs        ⭐ 扩展现有（~3500 行）—— 核心注册表 + 状态机中心
│                             [详见 session_manager_extension.md]
│
├── local_session/            ✅ 现有——local PTY spawn + read_loop
├── ssh_session/              ✅ 现有——russh 连接 + tunnel channel
├── tmux_session/             ✅ 现有——tmux -CC 控制模式解析 + dispatch
├── session_log.rs            ✅ 现有——tracing → 文件
│
├── ⭐ attach/                独立状态机——AI 独占 session
│   [详见 services/attach/README.md]
│
├── ⭐ subscribe/             OutputRing 环形缓冲 + 序号 + 多 subscriber fan-out
│   [详见 services/subscribe/README.md]
│
├── ⭐ capture/               3 种 capture 模式（text / ansi / screenshot）
│   [详见 services/capture/README.md]
│
├── ⭐ config/                toml 加载 + notify 热更新 + migration
│   [详见 services/config/README.md]
│
└── ⭐ reverse_tunnel/        russh -R 反向隧道 + 指数退避重连
    [详见 services/reverse_tunnel/README.md]
```

## 2. 设计原则

### 2.1 子 module 边界严格

- 每个子 module **单一职责**
- 跨子 module 调用走 `SessionManager` 公开 API（不直读 private 字段）
- 子 module 之间**不互相调**——通过 SessionManager 间接

### 2.2 friend module 模式（attach / subscribe 是 SessionManager 的 friend）

```
session_manager.rs 持有 attach_registry / subscribe_registry 字段（pub）
attach/* 持有 DashMap<u32, AttachState>（pub）
subscribe/* 持有 DashMap<u32, Arc<OutputRing>>（pub）

session_manager.rs 直接读 attach_registry / subscribe_registry 字段
attach/* / subscribe/* 不读 session_manager.sessions 字段（走公开 API）
```

**这是 user profile memory 中的 "destination-of-payload" 拆分原则的体现**——attach 数据归 attach，subscribe 数据归 subscribe，session 数据归 session_manager。

### 2.3 子 module 公开 / 内部

每个子 module 的 `mod.rs` 暴露的符号：
- `pub use <file>::<公开类型>` —— 给 caller
- `<file>::private_helper` —— 子 module 内部 helper（pub(crate) 或 mod-private）

详见各子 module 的 INTERFACE.md。

## 3. 依赖图

```
session_manager
├── attach        (friend, 通过 Arc<AttachRegistry>)
├── subscribe     (friend, 通过 Arc<SubscribeRegistry>)
├── capture       (call, 通过 subscribe + session_manager.capture_*)
├── local_session (owned, 持有 PTY handle)
├── ssh_session   (owned, 持有 russh client)
├── tmux_session  (owned, 持有 tmux controller)
├── session_log   (owned, 持有 log writer)
└── config        (owned, 持有 ConfigStore for 联动更新)

attach       ←─ mcp_server/tools/attach_session
subscribe    ←─ mcp_server/tools/subscribe_output
capture      ←─ mcp_server/tools/capture_screen
config       ←─ mcp_server/tools/get_config/set_config
local_session ←─ commands/session::create_local_session
ssh_session  ←─ commands/session::create_ssh_session
tmux_session ←─ commands/session::create_tmux_session
reverse_tunnel ←─ commands/tunnel::tunnel_start

mcp_server    ←─ commands/mcp::mcp_status + 各工具
mcp_server    ←─ commands/session::write_session (镜像)
```

## 4. 子模块对外暴露规则

| 子 module | 必须对外暴露 | 不对外暴露 |
|---|---|---|
| `session_manager` | `Arc<SessionManager>` + 所有 pub 方法 | private DashMap 字段 |
| `local_session` | `create()` / `spawn()` 公开函数 | PTY handle 内部状态 |
| `ssh_session` | `create()` 公开函数 | russh client 内部状态 |
| `tmux_session` | `TmuxController` (Arc) + 公开方法 | parser / dispatch 内部 |
| `attach` | `AttachRegistry` (Arc) + `AttachSource` / `AttachState` 类型 | idle_timeout task handle |
| `subscribe` | `SubscribeRegistry` (Arc) + `OutputRing` (Arc) + `RingEntry` | sweep task handle |
| `capture` | `capture_screen()` + `CaptureMode` / `CaptureResult` / `CaptureError` | text / ansi 内部 regex |
| `config` | `ConfigStore` (Arc) + `AppConfig` (在 models/config.rs) | notify watcher handle |
| `reverse_tunnel` | `TunnelHandle` + `TunnelStatus` / `TunnelConfig` | russh client + reconnect loop |
| `session_log` | `start_session_logging()` | tracing-subscriber 内部 |

## 5. 测试

每个子 module 都有 `*.test.rs` 或 `#[cfg(test)] mod tests`：

| 子 module | 测试类型 |
|---|---|
| `session_manager` | mockall（mock PtySystem / SshBackend / SessionBackend） |
| `local_session` | 集成测试（spawn PowerShell 验证 PTY 双向通信） |
| `ssh_session` | 集成测试（mock sshd） |
| `tmux_session` | 单元 + 集成（mock tmux controller） |
| `attach` | mockall（state machine 100% 覆盖） |
| `subscribe` | tokio test（ring + 多 subscriber + overflow） |
| `capture` | tokio test（text / ansi / screenshot） |
| `config` | tempfile + tokio（migration roundtrip + notify） |
| `reverse_tunnel` | mock sshd + 5 次重连模拟 |

## 6. 性能预算

详见各子 module 的 "性能预算" 节。

## 7. 强约束（pre-commit 必跑）

```bash
# 子 module 不能互相调（除 friend module 通过 Arc 共享）
grep -rnE 'use\s+crate::services::(attach|subscribe|capture|config|reverse_tunnel)' src-tauri/src/services/
# 必须只出现在 session_manager.rs（friend）

# 子 module 不能反向依赖 commands / mcp_server / infrastructure
grep -rnE 'use\s+crate::(commands|mcp_server|infrastructure)' src-tauri/src/services/
# 必须为空
```

## 8. 文档

| 文档 | 内容 |
|---|---|
| [`services/README.md`](README.md) | 本文档 |
| [`services/session_manager_extension.md`](session_manager_extension.md) | SessionManager 扩展设计 |
| [`services/attach/README.md`](attach/README.md) | attach 状态机 |
| [`services/subscribe/README.md`](subscribe/README.md) | OutputRing 详情 |
| [`services/capture/README.md`](capture/README.md) | capture 路径 |
| [`services/config/README.md`](config/README.md) | toml 加载 + notify + migration |
| [`services/reverse_tunnel/README.md`](reverse_tunnel/README.md) | 反向 SSH 隧道 |

## 9. 验收

- 9 个子 module（4 现有 + 5 NEW）全部按设计落地 ✅
- SessionManager 扩展所有字段接入 ✅
- 子 module 边界无跨调（grep 校验通过） ✅
- 100% 测试覆盖关键路径（attach / subscribe / capture / config） ✅