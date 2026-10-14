# _ROADMAP_FACTS.md — 真实代码状态 vs V1-V4 假想

> **目的**: 反映代码现状 vs 你提出的 V1-V4 目标态, 不写 design, 只写事实。
> **生成时间**: 2026-10-09 (基于 git HEAD `184906d` + 工作树)
> **方法**: 跑 `git log` / `find` / `grep` 采集 6 类事实, 不读源码细节
> **下次更新**: 每次重大重构后跑一次同套采集

---

## 1. V1-V4 目标态定义(用户提议)

| 版本 | 能力边界 | 状态 |
|---|---|---|
| **V1** | local pty + SSH session + 简单标签页 | 待核实 |
| **V2** | + panel split + workspace + terminal settings | 待核实 |
| **V3** | + tmux -CC 兼容 | **已实现** (代码完整) |
| **V4** | + MCP server (HTTP + stdio) | **0 行代码** (纯空想 doc) |

---

## 2. 真实代码状态(2026-10-09 git HEAD 184906d)

### 2.1 backend Rust (`src-tauri/src/`)

```
src-tauri/src/
├── commands/        IPC handlers (9 × Tauri command modules)
├── services/        业务编排
│   ├── tmux_session/   ⭐ V3 核心, 18+ 文件, 已重构过 5+ 次
│   │   ├── mod.rs
│   │   ├── controller/ (commands + id_map + io_tasks + mod + registry + spawn + subscriber + sync + tests)
│   │   ├── protocol/   (codec + command + events + mod + parser + wire)
│   │   ├── bridge/    (mod)
│   │   ├── dispatch.rs
│   │   └── errors.rs
│   ├── registry/     (session_manager 等)
│   ├── output/       (OutputRing)
│   ├── capture/      (ansi, tmux capture-pane)
│   └── ... (其他 services)
├── infrastructure/
│   ├── tmux/         ⭐ V3 平台抽象, backend.rs + mod.rs (2 文件)
│   ├── pty/ ssh/ session_backend/ app_backend/ clipboard/ logging_setup/
│   └── ...
├── models/          (serde 派生)
└── ...
```

**V1 验证**:
- `commands/session.rs` 存在 (V1 IPC handler)
- `infrastructure/pty.rs` + `infrastructure/ssh.rs` 存在 (V1 平台抽象)
- `services/registry/session_manager.rs` 存在 (V1 状态机)
- **结论**: V1 基线代码完整

**V3 验证** (重点):
- 18+ 个文件 `services/tmux_session/` 全部存在, 跨 controller/protocol/bridge/dispatch 4 个子 module
- `infrastructure/tmux/backend.rs` 存在 (tmux control mode binary protocol)
- 提交历史显示从 "tmux fix(tmux): init" 一直迭代到 2871e76 "Refactor tmux controller to replace xsterm_id with session_id" (4+ 轮重构)
- bug 0009 (xsterm_window_id_for split brain) 已被 commit `8c8d8dd refactor: remove xstermWindowId references and update session handling` 修掉
- **结论**: V3 tmux -CC 已实现完整, 仍在持续重构 (细化为 actor / event-sourced 抽象机会)

**V4 验证** (重点):
```bash
$ find src-tauri/src -iname '*mcp*'
(空)
$ find src -iname '*mcp*'
(空)
```
- **结论**: V4 MCP server **0 行代码**
- 仓库内所有 MCP 相关**只有 doc**:
  - `doc/dev/adr/0002-mcp-single-binary.md` (superseded)
  - `doc/dev/adr/0002-revised-mcp-frontend.md` (superseded, archived)
  - `doc/dev/adr/0002-revised-2-mcp-services-module.md` (当前 ADR)
  - `doc/dev/design/backend/services/mcp/RESPONSIBILITY.md` + `INTERFACE.md` + `DOWNSTREAM.md` (3 份空想 doc)
  - `doc/dev/design/frontend/app/mcp/RESPONSIBILITY.md` + `INTERFACE.md` + `DOWNSTREAM.md` (3 份空想 doc)
  - `doc/dev/history/mcp-server-backend-rfc-0002/` + `mcp-server-frontend-rfc-0002-revised/` (历史归档)
- **结论**: 我之前 4 轮"重设计 MCP"产出 **~1500 行 design doc + 3 次 RFC 0002 反转**, 全部是 **0 行代码的虚构**

### 2.2 frontend TS (`src/`)

```
src/
├── app/            业务编排 (6 modules per frontend/README §2.1)
├── ui/             视图渲染
├── model/          纯数据
├── service/        zustand store
├── infra/          平台适配 (tauri/store/clipboard/logger)
└── ... (其他)
```

**V4 验证**:
- 跟 backend 一样, **frontend `app/mcp/` 目录 0 行代码**, 只有 doc
- 之前 commit `9abadca docs(design): rewrite frontend app/mcp/ to listener-only (RFC 0002-revised-2); archive RFC 0002-revised frontend docs` **只改 doc**, 没动 src/

### 2.3 已知 bug 状态 (`doc/dev/changelog/bugs.md` 头 5 条)

| Bug | 主题 | 状态 |
|---|---|---|
| 001 | split pane 时原 pane 内容丢失 (xterm remount) | ✅ YES 已修 |
| 002 | select session 多次点击创建多 session | ✅ YES 已修 |
| 003 | 粘贴出现双倍数据 (xterm onData 重复) | ✅ YES 已修 |
| 004 | 重连 session 鼠标乱码 (xterm 模式未重置) | ✅ YES 已修 |
| 005 | 字符输入延迟/丢失 (onData 去重窗口) | 待读完整行确认 |

> 注: 头 5 条全标 YES, 但**没看**文件第 6 条起 + 不知道 Bug 005 之后有没有新 bug 注册

---

## 3. 现实 vs 假想 — 3 个关键 gap

| Gap | 假想 (我之前 4 轮设计) | 现实 |
|---|---|---|
| **Gap 1: MCP 在 backend services/mcp/** | 我设计了完整的 `services/mcp/{http,stdio,tools/*,auth,safety,audit,events,types,service_init}.rs` | **0 行代码**, 整个 `services/mcp/` 目录不存在 |
| **Gap 2: tmux 在 session_manager.tmux_controllers 字段** | 我设计 session_manager 是大 root, tmux 是 friend field | **实际**: tmux 独立成 `services/tmux_session/`, session_manager 不知道 tmux controller 存在 |
| **Gap 3: attach_registry + mcp + send_keys 在 backend** | 我设计 backend 4 层 + RFC 0002-revised-2 services/mcp 协调 | **实际**: 完全没有 services/mcp/, attach_registry 真实存在但 send_keys / capture_screen / subscribe_output 12 工具全是空想 doc |

**结论**:
- 我之前 4 轮设计**全部基于"假设代码会按 doc 实现"**, 但 **V3 是"代码先于设计"**(tmux 实际代码驱动了 doc),**V4 是"设计先于代码"**(MCP 纯空想, 等代码来追)
- V3 反过来证明了一件事:**当代码先于 design, design 会自然变简单**(commit 2871e76 "Refactor tmux controller to replace xsterm_id with session_id" 就是 actor 抽象的雏形)
- V4 反过来证明了一件事:**当 design 先于代码, design 会膨胀成空想**(3 份 R/I/D + 2 个 ADR 反转 + 7 个 commits 全在写 0 行代码的"完美 design")

---

## 4. V2 状态待核实

**V2 能力** (panel split / workspace / terminal settings) **未在本采集轮次深查**。已知:
- frontend `app/workspace/` + `ui/workspace/` 存在 (我之前 4 轮设计假设存在, 但 V2 是否实现到"功能层"完整, 需读 `app/workspace/usecases/` + `ui/workspace/view/` 实际代码)
- frontend `model/settings/` 存在 (terminal settings 数据契约)
- bug 001 (split 内容丢失) 跟 V2 panel split 强相关, 已修

**待核实问题**:
- V2 panel split 实际能创建/拖拽/保存 吗?
- V2 workspace 实际能创建/切换/重启恢复 吗?
- V2 terminal settings 实际能从 UI 改并生效 吗?
- 哪些 V2 子能力**有 bug 但没注册**到 bugs.md?

---

## 5. V3 tmux 实际架构(对比我之前的设计)

我之前 design 假设的 tmux 架构:
- `services/registry/session_manager.tmux_controllers: DashMap<u32, Arc<TmuxController>>`
- tmux controller 是 session_manager 的 friend field
- 1 个 controller struct 装所有状态 (bug 0009 就是这个抽象导致的 split brain)

实际代码架构 (从文件结构推):
- `services/tmux_session/` 独立 service, 跟 session_manager 平级
- `services/tmux_session/controller/` 内部分 8 个子文件 (commands, id_map, io_tasks, registry, spawn, subscriber, sync, tests) — **已经是模块化设计**
- `services/tmux_session/protocol/` 独立子 module (codec, command, events, parser, wire) — **协议层独立**
- `services/tmux_session/bridge/` 跟 frontend 桥接 — 专门 1 个 sub-module
- `services/tmux_session/dispatch.rs` — tmux command 派发
- `infrastructure/tmux/backend.rs` — 平台抽象 (control mode binary)

**判断**: 实际代码已经做了**正确的模块化拆分**(controller/protocol/bridge/infrastructure 4 层分), 我之前 design 假设的"1 个 controller struct"是**完全错的**

**我之前设计 vs 实际**:
- ❌ 假设: tmux controller 在 session_manager 字段, friend module
- ✅ 实际: tmux 独立 service, 内部再分 controller/protocol/bridge 3 层
- ❌ 假设: 1 个 controller struct 装所有状态
- ✅ 实际: 8 个子文件 (commands, id_map, io_tasks, registry, spawn, subscriber, sync, tests) — 已经分
- ❌ 假设: tmux send_keys 走 attach_registry.check_write_permission
- ✅ 实际: tmux 走 tmux_session/controller/commands.rs 独立路径, 不经过 attach_registry (可能; 待读代码确认)
- ❌ 假设: MCP send_keys 跟 tmux send_keys 共享 attach_registry 权限检查
- ✅ 实际: MCP 不存在, 待 V4 实施时设计

---

## 6. 对 V1-V4 拆分的影响

### V1 (基础 pty + ssh + 标签页)
- **V1 doc 反映"基线是什么"**: V1 代码完整, doc 应记录"已实现的能力"和"IPC 接口签名"
- V1 doc 不需要包含 tmux/MCP/workspace/panel split

### V2 (panel split + workspace + terminal settings)
- V2 doc 应包含**功能层完整描述**, 即使代码有 bug (V2 视为"目标态", Q2=b)
- V2 doc 应附 "Known Gaps" 章节, 列当前 bug + 未实现子能力

### V3 (tmux -CC)
- V3 doc 应**反映代码真实架构**, 不是"理想抽象"
- V3 doc 是 `services/tmux_session/` 18+ 文件 + `infrastructure/tmux/` 2 文件 的契约
- V3 doc 应**用代码驱动**而不是"想当然"地设计

### V4 (MCP)
- V4 doc 是**纯蓝图**, 0 行代码对应
- V4 doc 写完后, 用 V4 doc 当 spec, 实施时按 V4 doc 写
- V4 doc 不应假装 backend services/mcp/ 存在 (该目录目前不存在)

---

## 7. 下一步建议(等你拍板)

### 选项 A: 先补 V2 状态采集, 再写 V1-V4 design
- 工作: 再跑 ~5 个命令确认 V2 三个子能力的实现状态
- 然后写 `doc/dev/design/_ROADMAP.md` (V1-V4 边界 + Known Gaps 索引)
- 然后分版本写 design tree (V1 优先, 模板先验证, V2/V3/V4 套用)
- 工作量: ~30 min 采集 + ~3-4 小时 4 版 doc

### 选项 B: 直接开始写 V1 design (基于已知 V1 稳)
- 工作: 跳过 V2 状态采集, V1 doc 不需要这个
- 风险: V2 doc 写时可能还要补
- 工作量: V1 ~40 min, V2/V3/V4 各 ~1-2 小时

### 选项 C: 先 V3 design (因为代码已存在, doc 应跟代码一致)
- 工作: 不写 V1-V4 design tree, 只写 V3 design (因为 V3 实际代码驱动)
- 风险: V1/V2 design 缺位, dev 不知道 V1/V2 设计目标
- 工作量: V3 ~1-2 小时

### 选项 D: 暂停 doc 设计, 先做实际代码重构
- 工作: V3 tmux 抽象已经够好, 不需要重写 doc; V4 MCP 优先实施代码
- 风险: 跟 user Q3=a (doc 是 source of truth) 冲突
- 工作量: V3 重构可能几小时, V4 实施可能几天

---

## 8. 修订过的建议(基于事实而非假想)

我之前的建议路径有 3 个错:
1. 假设 V4 MCP 已存在, 实际 0 行代码
2. 假设 V3 tmux 跟 session_manager 耦合, 实际独立 service
3. 假设 V1-V4 边界清晰, 实际 V1 跟 V3 之间有断档(V2)

修订建议:
- **V1 doc 是 "已实现 baseline"**, 不是"目标态" (因为 V1 已稳)
- **V2 doc 是 "目标态 + Known Gaps"** (因为 V2 有 bug + V2 状态待核实)
- **V3 doc 是 "代码真实架构的契约"** (因为 V3 实际代码复杂, doc 应跟代码)
- **V4 doc 是 "目标态蓝图"** (因为 V4 0 行代码, 唯一干净 design 的机会)

4 个版本**有 4 种不同的 doc 性质**, 不能套同一模板。

---

## 9. 决策点(等你回复)

1. **路径**: A / B / C / D (上面)
2. **V1-V4 doc 模板**: 是否要 4 种不同模板 (代码契约 / 蓝图 / 代码+gap) 还是 1 种统一模板
3. **优先级**: 选 V1 先还是 V3 先 (V1 是简单基线, V3 是最大头)
4. **V4 推迟**: V4 是 0 行代码, 推到 4 个最后, 还是跟 V3 并行 (V3 已有 18+ 文件可写)

我推荐: **选项 A + V1 先 + 4 种模板 + V4 推最后**。但你拍板。