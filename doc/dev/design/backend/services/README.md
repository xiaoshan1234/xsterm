# Backend · Services — 设计（RFC 0006 精简后）

> **位置**：`src-tauri/src/services/`
> **职责**：业务编排 + 跨 layer 状态 + 子系统独立 module
> **拆分**：⭐ **6 个 module**（RFC 0006 精简后）—— 只保留"真有状态需要集中管理"

## 1. 6 个 module 索引

```
src-tauri/src/services/
├── mod.rs                       6 行 re-exports
│
├── session_manager.rs           ⭐ 核心注册表（DashMap<u32, Arc<ActiveSession>> + 扩展字段）
│
├── local_session/               ✅ PTY handle 持有 + bytes read_loop
├── ssh_session/                 ✅ russh connection 持有
├── tmux_session/                ✅ tmux -CC controller 持有
├── session_log.rs               ✅ tracing 文件 writer
│
├── attach/                      ✅ DashMap<u32, AttachState> 状态机 + 60min idle timeout
├── subscribe/                   ✅ DashMap<u32, Arc<OutputRing>> 全局索引 + 环形缓冲
└── reverse_tunnel/              ✅ TunnelHandle + 重连 task
```

**删除**（RFC 0006 下沉）：
- ❌ `services/config/` —— 没自有状态，下沉到 `commands/persistence.rs` 扩展
- ❌ `services/capture/` —— 没自有状态，pure function 下沉到 `models/capture.rs`

详见 [`doc/dev/adr/0006-services-simplification.md`](../../adr/0006-services-simplification.md)。

## 2. 设计原则（RFC 0006）

### 2.1 3 问判断 service 是否该存在

```
问 1: 这个 module 持有可变状态吗？（DashMap / Mutex / Atomic* / 长跑 task handle）
  ├─ 是 → service ✅
  └─ 否 → 问 2

问 2: 这个 module 是 pure function / pure data transform 吗？
  ├─ 是 → model ✅
  └─ 否 → 问 3

问 3: 这个 module 是 IO wrapper（包装外部库 API）吗？
  ├─ 是 → commands 或 infrastructure ✅
  └─ 否 → 重新评估
```

### 2.2 避免"层级洁癖"

**反例**（不要做）：
- ❌ "frontend 有 6 个 module → backend 也要 6 个 service" → 错！frontend 按"产品功能"切分，backend 按"状态"切分
- ❌ "每个 frontend service 都对应 backend service" → 错！frontend service 是 zustand store（前端状态），backend 状态是独立的
- ❌ "wrapper service"——只是 API 包装，无状态无 IO 调度 → 应该下沉到 commands 或 models

### 2.3 service 边界判定

**真正需要 service** 的标志（满足任一）：
1. 持有跨调用的可变状态（DashMap / Mutex）
2. 长跑 task（tokio::spawn 后台循环）
3. 跨多 module 共享的全局索引（registry pattern）
4. 复杂的内部状态机（attach / tunnel）

**反例**（已下沉）：
- `services/config` —— 只是 tauri-plugin-store wrapper，无自有状态
- `services/capture` —— 纯函数（strip_ansi + 文本处理）

## 3. 依赖图

```
session_manager
├── attach        (friend, 通过 Arc<AttachRegistry>)
├── subscribe     (friend, 通过 Arc<SubscribeRegistry>)
├── local_session (owned, 持有 PTY handle)
├── ssh_session   (owned, 持有 russh client)
├── tmux_session  (owned, 持有 tmux controller)
├── session_log   (owned, 持有 log writer)
└── reverse_tunnel (owned, 持有 TunnelHandle)

attach       ←─ mcp_server/tools/attach_session + commands/mcp::attach_session + reverse_tunnel
subscribe    ←─ mcp_server/tools/subscribe_output + services::capture (调 OutputRing::tail)
local_session ←─ commands/session::create_local_session
ssh_session  ←─ commands/session::create_ssh_session
tmux_session ←─ commands/session::create_tmux_session + commands/session::capture_pane
```

## 4. 公开 / 内部规则

| module | 必须对外暴露 | 不对外暴露 |
|---|---|---|
| `session_manager` | `Arc<SessionManager>` + 所有 pub 方法 | private DashMap 字段 |
| `local_session` | `create()` 公开函数 | PTY handle 内部状态 |
| `ssh_session` | `create()` 公开函数 | russh client 内部状态 |
| `tmux_session` | `TmuxController` (Arc) + 公开方法 | parser / dispatch 内部 |
| `attach` | `AttachRegistry` (Arc) + `AttachSource` / `AttachState` 类型 | idle_timeout task handle |
| `subscribe` | `SubscribeRegistry` (Arc) + `OutputRing` (Arc) + `RingEntry` | sweep task handle |
| `reverse_tunnel` | `TunnelHandle` + `TunnelStatus` / `TunnelConfig` | russh client + reconnect loop |
| `session_log` | `start_session_logging()` | tracing-subscriber 内部 |

## 5. 测试

| module | 测试类型 |
|---|---|
| `session_manager` | mockall（mock Pty/ssh/session_backend）+ attach 集成测试 |
| `local_session` | 集成测试（spawn PowerShell 验证 PTY 双向通信） |
| `ssh_session` | 集成测试（mock sshd） |
| `tmux_session` | 单元 + 集成（启动真实 tmux 进程） |
| `attach` | mockall（state machine 100% 覆盖） |
| `subscribe` | tokio test（ring + 多 subscriber + overflow） |
| `reverse_tunnel` | mock sshd + 5 次重连模拟 |
| `session_log` | 单元（log file rotation） |

## 6. 性能预算

详见各 module 的 "性能预算" 节。

## 7. 强约束（pre-commit 必跑）

```bash
# 子 module 不能互相调（除 friend module 通过 Arc 共享）
grep -rnE 'use\s+crate::services::(attach|subscribe|reverse_tunnel)' src-tauri/src/services/
# 必须只出现在 session_manager.rs（friend）

# 子 module 不能反向依赖 commands / mcp_server / infrastructure
grep -rnE 'use\s+crate::(commands|mcp_server|infrastructure)' src-tauri/src/services/
# 必须为空

# 子 module 必须真有状态（每个 module 都有 pub DashMap / Atomic / 长跑 task）
# 通过人工 review 验证——新增 service 必须有"3 问"判定依据
```

## 8. 文档

| 文档 | 内容 |
|---|---|
| [`services/README.md`](README.md) | 本文档 |
| [`services/attach/`](attach/README.md) | attach 状态机 |
| [`services/subscribe/`](subscribe/README.md) | OutputRing 详情 |
| [`services/reverse_tunnel/`](reverse_tunnel/README.md) | 反向 SSH 隧道 |
| [`../README.md §4`](../README.md) | **核心注册表扩展**（SessionManager，含 attach / subscribe 集成说明） |
| [`../models/capture.md`](../models/capture.md) | capture pure function（RFC 0006 下沉自 services/capture） |
| [`../../adr/0006-services-simplification.md`](../../adr/0006-services-simplification.md) | 决策 |

## 9. 验收

- 6 个 services module 全部满足"3 问"判定（有状态 / 真服务） ✅
- `services/config` + `services/capture` 已下沉 + 归档可追溯 ✅
- SessionManager 扩展合并到 backend/README.md §4 ✅
- backend docs 从 21 份精简到 16 份 ✅
- 所有 PRD §2 M1-M11 功能不变 ✅