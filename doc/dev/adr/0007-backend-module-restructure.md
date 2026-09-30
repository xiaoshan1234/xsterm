# RFC 0007: Backend Module 重新划分

| 字段 | 值 |
|---|---|
| 状态 | Accepted |
| 日期 | 2026-09-29 |
| 作者 | dev（基于用户反馈：backend 设计"太次，每层没划分 module，每层职责不清"） |
| 触发 | frontend 5 层 6 module + 3 份契约 docs 模板规范 vs backend 4 层 1 大目录 |

---

## 1. 问题

之前 backend 4 层划分太粗糙：
- `commands/` 一个目录，所有 IPC 命令混在一起（23 session + 23 tmux 等散在 session.rs 662 行）
- `services/` 6 module 但命名混乱（`local_session` / `attach` / `subscribe` / `reverse_tunnel` 风格不统一）
- `infrastructure/` 7 module 但也命名混乱
- `models/` 8 module 但全是 enum + struct 平铺（如 `session.rs` 1167 行混杂 7 enum + 30 struct）

**对比 frontend**：
- frontend 5 层，每个 module 配 **3 份契约 docs**（RESPONSIBILITY + INTERFACE + DOWNSTREAM）
- backend 每个 module 只有 INTERFACE + DOWNSTREAM 两份，且不完整

**核心问题**：
1. 每层内部没按职责切 module（粗糙）
2. module 命名没有统一规则
3. 各 module 边界 / 职责 / 对外接口不清晰
4. 三份契约 docs 不齐全

## 2. 决策

**保持 4 层架构**（commands / services / infrastructure / models），**重划 module 按职责切**。

每个 module 配 **3 份契约 docs**（跟 frontend 一致）：
- `RESPONSIBILITY.md` — 单一职责、边界、禁止项
- `INTERFACE.md` — 公开 API（类型 + 函数签名）
- `DOWNSTREAM.md` — 依赖图（调谁 + 被谁调 + 强约束 grep）

## 3. 新 module 划分

### 3.1 `commands/` — 按 frontend app module 镜像切（9 module）

| module | IPC 归属 | frontend 对应 |
|---|---|---|
| `session.rs` | session 全生命周期（create/close/write/resize） | `app/session` |
| `workspace.rs` | workspace / window / pane / group CRUD | `app/workspace` |
| `terminal.rs` | terminal 显示（resize/cursor/theme） | `app/terminal` |
| `tmux.rs` | tmux -CC（controller/pane/window/script） | `app/terminal` |
| `settings.rs` | settings 持久化（load/save/patch） | `app/settings` |
| `mcp.rs` | MCP attach/state/status/token | `app/mcp` |
| `persistence.rs` | 业务持久化（sessions/groups/attached_tmux） | `service/persistence` |
| `logging.rs` | logging（log_message/config） | `infra/logger` |
| `tunnel.rs` | reverse_tunnel 启停 | `app/mcp` |
| `mod.rs` | `all_handlers()` 注册 | — |

**每个 module 内部**：
- 按 IPC 命令名分组（一个命令一个 `#[tauri::command]` 函数）
- 共享 types 提到 module 顶部（避免跨命令重复定义）
- 内部 helper 私有（pub(crate) 或 mod-private）

### 3.2 `services/` — 按生命周期 / 状态类型 / 资源切（7 子 module）

```
services/
├── registry/                  注册表类（无 IO，全 DashMap + Atomic）
│   ├── mod.rs                 re-exports
│   ├── session_manager.rs     ⭐ 核心注册表（Arc<SessionManager>）
│   ├── attach_registry.rs     attach 独占状态机（DashMap<u32, AttachState>）
│   ├── subscribe_registry.rs  subscribe OutputRing 全局索引（DashMap<u32, Arc<OutputRing>>）
│   └── profile_registry.rs    profile 缓存（DashMap<String, Profile>）
│
├── lifecycle/                 session 生命周期
│   ├── mod.rs                 spawn / close / reconnect 编排
│   ├── local.rs               local PTY 生命周期
│   ├── ssh.rs                 SSH session 生命周期
│   └── tmux.rs                tmux controller 生命周期
│
├── output/                    输出流处理（OutputRing 实际拥有者）
│   ├── mod.rs                 re-exports
│   ├── ring.rs                OutputRing 环形缓冲
│   └── publisher.rs           subscriber fan-out + 50ms 批处理
│
├── capture/                   screen capture 逻辑
│   ├── mod.rs                 路由（tmux / OutputRing tail）
│   ├── tmux.rs                tmux capture-pane backend
│   └── ansi.rs                ANSI 处理（thin wrapper，调 models/capture）
│
├── transport/                 网络传输
│   ├── mod.rs                 re-exports
│   ├── tunnel.rs              reverse_tunnel russh -R + 指数退避
│   └── http.rs                （future）stdio/TCP bridge
│
├── persistence/               持久化业务
│   ├── mod.rs                 re-exports
│   ├── store.rs               tauri-plugin-store wrapper
│   └── migration.rs           JSON 版本迁移
│
├── io/                        IO 处理
│   ├── mod.rs                 re-exports
│   ├── log.rs                 session_log 文件 writer
│   └── wire.rs                binary_frame encoding/decoding
│
└── audit/                     审计日志（MCP）
    └── mod.rs                 AuditLog + rate_limit + token
```

**7 个子 module 的切分逻辑**：
| 子 module | 切分依据 | 内容 |
|---|---|---|
| `registry/` | 无 IO / 纯内存状态 | 全是 DashMap + Atomic + 状态机 |
| `lifecycle/` | session 全生命周期 | spawn / read_loop / close / reconnect |
| `output/` | 输出流处理 | OutputRing 实际拥有者 + fan-out |
| `capture/` | screen capture 路由 | tmux / OutputRing tail / 未来 offscreen |
| `transport/` | 网络传输 | tunnel + 未来 http bridge |
| `persistence/` | 持久化业务 | settings.json + store wrapper + migration |
| `io/` | 其他 IO | log writer + binary wire |
| `audit/` | MCP 审计 | AuditLog + rate_limit |

### 3.3 `infrastructure/` — 按平台能力切（8 module）

| module | 平台依赖 | 现状 |
|---|---|---|
| `pty.rs` | portable-pty + ConPTY/winpty | ✅ 现有 |
| `ssh.rs` | russh + known_hosts + 3 种认证 | ✅ 现有 + RFC 0003-revised 修复 host_key_verify |
| `tmux.rs` | tmux -CC 控制模式 | ✅ 现有 |
| `session_backend.rs` | trait SessionBackend + PtyBackend / SshBackend 适配 | ✅ 现有 + RFC 0006 扩展 capture_* |
| `app_backend.rs` | trait AppBackend + RealAppBackend | ✅ 现有 + RFC 0006 扩展 emit |
| `binary_frame.rs` | 0xA1 0x01 wire format | ✅ 现有（迁移到 services/io/wire.rs） |
| `clipboard.rs` | tauri-plugin-clipboard-manager 包装 | ✅ 现有 |
| `logging_setup.rs` | tracing 初始化 | ✅ 现有（独立 module） |
| `mod.rs` | re-exports | — |

**binary_frame.rs 迁移**：原 `infrastructure/binary_frame.rs` 内容（`encode_session_output_frame` / `decode_session_output_header`）搬到 `services/io/wire.rs`——因为是 OutputRing 的 wire 格式编码，更贴近业务层。

### 3.4 `models/` — 按数据 domain 切（8 module，每个 module 单文件）

| module | 现状 | 内容 |
|---|---|---|
| `session/` | ⚠️ 拆分现有混杂 1167 行 | SessionInfo / SessionType / SessionConfig / 4 个 Config 子 struct |
| `workspace/` | ⭐ NEW 单文件 | Workspace / Window / Group / PaneNode + paneTree 算法（独立子目录） |
| `settings/` | ⚠️ 拆分现有混杂 | Settings + McpSettings / SshSettings / TunnelSettings |
| `attach/` | ✅ 单文件 | AttachState / AttachSource / McpAttachChangedEvent |
| `subscription/` | ✅ 单文件 | RingEntry / SubscribeResult / OutputChunk / OutputOverflowEvent |
| `profile/` | ✅ 单文件 | Profile / ProfileType / SessionConfig / SshAuthConfig |
| `capture/` | ✅ 单文件 | CaptureMode / CaptureResult / 3 个 pure function |
| `mod.rs` | ⭐ 重写 | 8 domain 模块 re-exports |
| ~~`capabilities.rs`~~ | ❌ 删除 | 并入 `models/session/capabilities.rs`（按归属） |
| ~~`group.rs`~~ | ❌ 删除 | 并入 `models/workspace/group.rs`（按归属） |

**每个 module 内部**：
```
models/<domain>/
├── mod.rs               re-exports + 公开 API
├── types.rs             enum + struct 定义
├── events.rs            event 契约（如果有）
└── rules/               （workspace）paneTree 算法子目录
```

**关键**：
- `mod.rs` 是**唯一对外入口**（跟 frontend model 一致）
- `types.rs` 是数据 shape 定义
- `events.rs` 是 event 契约
- `mod.rs` 只 re-export `pub use types::*` + `pub use events::*`

## 4. module 命名规则（统一）

| 后缀 | 含义 | 例 |
|---|---|---|
| `_registry.rs` | 注册表（无 IO，DashMap/Atomic） | `attach_registry.rs` |
| `_manager.rs` | 核心协调器 | `session_manager.rs` |
| `_service.rs` | 服务（带 IO） | `tunnel.rs` / `http.rs` |
| `_handler.rs` | 事件 handler | (future) |
| `_store.rs` | 持久化 wrapper | `store.rs` |
| `local.rs` / `ssh.rs` / `tmux.rs` | 生命周期子模块（无后缀） | `lifecycle/local.rs` |

**禁止**：
- ❌ `_session.rs`（session 是 domain，应该放 module 名里）
- ❌ `_helper.rs` / `_utils.rs` / `_common.rs`（杂物桶，user profile memory 警告）

## 5. 3 份契约 docs 标配

每个 backend module 配 **3 份 docs**（RESPONSIBILITY + INTERFACE + DOWNSTREAM），跟 frontend 一致：

```
backend/<layer>/<module>/
├── <module>.rs            实现
├── RESPONSIBILITY.md      ⭐ 单一职责 + 边界 + 禁止项
├── INTERFACE.md           ⭐ 公开 API（类型 + 函数）
└── DOWNSTREAM.md          ⭐ 依赖图 + 强约束 grep
```

**RESPONSIBILITY.md 模板**：
```markdown
# <Module> — 职责
> **位置**：`<path>`
> **职责**：<一句话>

## 1. 这个 module 负责什么
<3-5 条要点>

## 2. 这个 module **不**负责什么
<明确的边界>

## 3. 公开 API 边界
<谁可以调，调什么>

## 4. 内部实现约束
<数据结构 + 算法约束>

## 5. 关键设计决策
<为什么这样设计>
```

**INTERFACE.md 模板**：
```markdown
# <Module> — 对外接口
> **位置**：`<path>`
> **唯一入口**：`<入口签名>`

## 1. 公开类型
<struct + enum 签名>

## 2. 公开函数
<函数签名 + 用途>

## 3. 接缝契约
<caller 调用示例>

## 4. 错误码
<Error enum + 含义>

## 5. 性能
<复杂度 + 预算>
```

**DOWNSTREAM.md 模板**：
```markdown
# <Module> — 对下依赖

## 1. 依赖图
<ASCII tree>

## 2. 外部 crate 依赖
<table>

## 3. 内部模块依赖
<table>

## 4. 上游 caller
<table>

## 5. 下游被调
<table>

## 6. 强约束
<机械校验 grep>
```

## 6. 调整前后对比

### 6.1 commands 之前 vs 之后

| 之前 | 之后 |
|---|---|
| `commands/session.rs` 662 行混杂 23 session + 23 tmux + 7 capture + 5 resize 命令 | `commands/session.rs`（session 生命周期）+ `commands/tmux.rs`（tmux -CC）+ `commands/terminal.rs`（display）+ `commands/workspace.rs`（workspace）+ `commands/settings.rs`（settings）+ `commands/mcp.rs`（mcp attach）+ `commands/persistence.rs`（业务持久化）+ `commands/logging.rs`（logging）+ `commands/tunnel.rs`（tunnel） |

**模块数**：1 → 9（+800%）

### 6.2 services 之前 vs 之后

| 之前 | 之后 |
|---|---|
| `services/session_manager.rs`（混杂 attach/subscribe/profiles 字段） | `services/registry/session_manager.rs`（核心注册表）+ `services/registry/{attach,subscribe,profile}_registry.rs` |
| `services/local_session/ ssh_session/ tmux_session/`（平铺 module） | `services/lifecycle/{local,ssh,tmux}.rs`（按生命周期子目录） |
| `services/session_log.rs`（单文件） | `services/io/log.rs`（归类 IO 子模块） |
| `services/attach/`（575 行）+ `services/subscribe/`（488 行）+ `services/reverse_tunnel/`（476 行） | `services/registry/attach_registry.rs`（状态机）+ `services/output/{ring,publisher}.rs`（OutputRing + fan-out）+ `services/transport/tunnel.rs`（russh -R） |

**子 module 数**：6 → 7（registry / lifecycle / output / capture / transport / persistence / io）+ audit（1 个 module）

### 6.3 infrastructure 之前 vs 之后

| 之前 | 之后 |
|---|---|
| `infrastructure/binary_frame.rs` | 移到 `services/io/wire.rs`（更贴近业务） |
| 现有 7 module（pty/ssh/tmux/session_backend/app_backend/binary_frame/clipboard）+ logging_setup.rs 散在 | 8 module（pty/ssh/tmux/session_backend/app_backend/clipboard/logging_setup）—— binary_frame 移到 services/io |

### 6.4 models 之前 vs 之后

| 之前 | 之后 |
|---|---|
| `models/session.rs` 1167 行混杂 7 enum + 30 struct | `models/session/mod.rs` + `types.rs` + `info.rs` + `config.rs` + `capabilities.rs` |
| `models/capabilities.rs` 单文件 | 移到 `models/session/capabilities.rs`（按归属） |
| `models/group.rs` 单文件 | 移到 `models/workspace/group.rs`（按归属） |
| `models/{attach,subscription,profile,config,capture}.rs` 单文件 | 每个拆成 `mod.rs` + `types.rs`（结构统一） |

**每个 module 结构**：`mod.rs` + `types.rs`（必要时加 `events.rs`）

## 7. 影响

### 7.1 删除

- `commands/session.rs` 混杂内容拆分（保留 session 生命周期命令）
- `services/session_log.rs` 单文件 → `services/io/log.rs`
- `services/capture/`（已下沉到 models/capture.rs）
- `services/config/`（已下沉到 commands/persistence.rs）
- `services/attach/` → `services/registry/attach_registry.rs`
- `services/subscribe/` → `services/output/`
- `services/reverse_tunnel/` → `services/transport/tunnel.rs`
- `services/session_manager_extension.md` → 合并到 backend/README.md §5.8
- `models/{capabilities,group}.rs` 单文件 → 按归属拆
- `infrastructure/binary_frame.rs` → `services/io/wire.rs`

### 7.2 新增

- `services/registry/` 子 module 4 个（session_manager / attach_registry / subscribe_registry / profile_registry）
- `services/lifecycle/` 子 module 4 个（mod / local / ssh / tmux）
- `services/output/` 子 module 3 个（mod / ring / publisher）
- `services/capture/` 子 module 3 个（mod / tmux / ansi）
- `services/transport/` 子 module 3 个（mod / tunnel / http）
- `services/persistence/` 子 module 3 个（mod / store / migration）
- `services/io/` 子 module 3 个（mod / log / wire）
- `services/audit/` 1 个（mod）
- `commands/{workspace,terminal,tmux,settings,mcp,tunnel}.rs` 独立 module
- 每个 module 配 3 份 docs（~50+ 份新 doc）

### 7.3 净变化

| 维度 | 之前 | 之后 |
|---|---|---|
| backend module 数 | ~25 | **~45**（+80%） |
| 每个 module docs | 0-3 份 | **3 份标配**（RESPONSIBILITY + INTERFACE + DOWNSTREAM） |
| 文档总数 | 9 | **~50+**（+450%） |

**注意**：docs 大量增加是**有意为之**——frontend 是 3 份契约 docs 标配，backend 之前缺太多；这是修复"模块边界不清"的必要代价。

## 8. 验收

- backend 4 层（commands / services / infrastructure / models）保留 ✅
- 每层按职责切 module（commands 按 frontend 镜像 / services 按 lifecycle / models 按 domain）✅
- module 命名规则统一（_registry / _manager / _service 等）✅
- 每个 module 配 3 份契约 docs（RESPONSIBILITY / INTERFACE / DOWNSTREAM）✅
- forbidden 文件名清理（`_session.rs` / `_helper.rs` / `_utils.rs`）✅
- forbidden 内容清理（capture / config 已下沉到 models / commands）✅
- 文档总数增加但每份质量更高（不再是 README 模板复制）✅

## 9. 关联文档

- frontend design：每 module 3 份 docs 已成规范（参考 baseline）
- ADR 0002-revised：MCP 移到 frontend（不影响 module 划分）
- ADR 0003-revised：JSON 直存（services/persistence 重划）
- ADR 0006：services 精简原则（仍有 module 划分，但只留真有状态的）

签字：
- [x] dev — 2026-09-29（基于用户反馈）
- [ ] tm
- [ ] pdm