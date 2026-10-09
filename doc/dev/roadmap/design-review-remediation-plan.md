# doc/dev/design/ 评审整改 Plan

> **For Hermes:** 本 plan 是 doc-only 整改清单,**不动代码**,**不动 src/** 或 src-tauri/src/。每项任务都是 patch 级,5 分钟内独立可验证。
> **范围来源**:2026-10-09 对 doc/dev/design/{frontend,backend}/ 共 179 份 .md 的 doc-vs-doc 内部一致性评审 (评 5.5/10)。
> **不重复**:本次 plan 不创建 `doc/dev/design/_REVIEW_REMEDIATION_PLAN.md` 内嵌副 plan;位于 `doc/dev/roadmap/`,与 target-architecture.md 等 RFC 同级。
>
> **历史**:2026-09-29 上一次评审曾生成 `_REVIEW_REMEDIATION_PLAN.md` (a373f3f),已由后续 commit 删除;本次 plan 是同等位置的 follow-up。

---

## 评审基础信息

- backend 33 × R/I/D = 99 份契约 docs + 2 models 文件 + 1 README
- frontend 25 × R/I/D = 75 份契约 docs + 1 README + 1 ai_takeover.md
- 总 179 份
- P0 (12 项) / P1 (6 项) / P2 (4 项) / NOT-TO-FIX (8 项)
- 修复优先级排序按 ROI:**P0-#2/#3/#5/#6/#9/#10 是机械 patch,P0-#1/#11/#12 各自需先决策**

---

## 任务规模说明

本 plan 的"修复"= `patch` 工具的 `old_string → new_string` 单点替换 + 1 个空目录清理。
TDD 不适用 (无代码改动)。每任务的验证 = 跑 verify grep 期望符合。

---

## 阶段 0 — 立项决策 (开始 patch 前)

> **目标**:对 3 项需设计决策的 P0 锁定路径,避免改到一半返工。
> **耗时**:1 个决定 (~2 min),无 patch。

### Task 0:确认 3 项设计决策

**决策点**:

A. **[P0-§2.B] backend/models/ 子树缺失** (顶层 README §2.4/§5.4/§13 描述 8 domain × 3 = 24 份 R/I/D,tree 实际 0 份)
   - 选 1:**生成 8 × 3 = 24 份 R/I/D**(工作量:每 domain × 3 doc × ~150 行 = ~3600 行,~3-5 PR)
   - 选 2:**改 README §2.4/§5.4/§13 标记 ⏳ 拆分 plan**(1 行 patch × 3 处,~5 min)
   - **建议**:选 2 (本轮只整改 doc 内不一致,不补 generation;generation 走独立 RFC)

B. **[P0-§2.A] services/ 子目录 11 vs 描述 7**
   - 选 1:**改 README §2.2 树形图加 audit/ 行** (5 行 patch,~15 min)
   - 选 2:**拆 services/audit/ 为独立 RFC** (出本 plan 范围)
   - **建议**:选 1 (readme 与 tree 对齐是 doc 内部一致性的范畴)

C. **[P0-§2.X] services/capture/ 缺 mod.rs/README.md**
   - 选 1:**加 services/capture/README.md (5 行目录指引)** (~10 min)
   - 选 2:**改 README §2.2 mod.rs 描述删掉** (~2 min)
   - **建议**:选 1 (capture 是唯一的 services 子 group,加指引 doc 比删 README 描述更完整)

**验证**:决策后用 `clarify` 跑一次,3 选 1 全部确认后进入阶段 1。
**提交**:无。

---

## 阶段 1 — P0 机械 patch (6 项,~30 min)

> **目标**:完成 P0-#2/#3/#5/#9/#10 + §13 算术修正。每项独立 commit。

### Task 1: [P0-#2] 修 app/session/ai_takeover.md 8 处 `integration/mcp` 引用

**Files:**
- Modify: `doc/dev/design/frontend/app/session/ai_takeover.md` (8 行: 4/9/18/27/80/81/175/199)

**Step 1:确认替换表**

| 行 | old (关键词) | new (关键词) |
|---|---|---|
| 4 | `integration/mcp` | `app/mcp` (frontend TS module) |
| 9 | `backend \`integration/mcp\`` | `backend \`commands/mcp\` + \`services/registry/attach_registry\`` |
| 18 | `integration/mcp::McpAttachState` | `app/mcp::client_state.ts` (frontend mirror state) |
| 27 | `integration/mcp` | `app/mcp` |
| 80 | `integration/mcp::tools::attach_session` | `app/mcp/tools/attach_session.ts` |
| 81 | `commands/mcp 自身不持有状态 —— 全权委托给 \`integration/mcp\`` | `commands/mcp 自身不持有状态 —— 全权委托给 \`services/registry/attach_registry\`` |
| 175 | `integration/mcp` | `services/registry/attach_registry` |
| 199 | `integration/mcp/RESPONSIBILITY.md` | `app/mcp/RESPONSIBILITY.md` + `services/registry/attach_registry/RESPONSIBILITY.md` |

**Step 2:用 `patch` 工具逐行替换**
- 5 处行 4/9/27/80/175/199 中 `integration/mcp` 直接替换为对应新行名
- 行 18/199 含完整句号 `::`,单独 patch (replace_all=False 模式)

**Step 3:验证**
```bash
grep -rn 'integration/mcp' doc/dev/design/
# 期望: 空
```

**Step 4:Commit**
```bash
git add doc/dev/design/frontend/app/session/ai_takeover.md
git commit -m "docs(design/frontend): replace phantom integration/mcp path with RFC 0002-revised paths"
```

---

### Task 2: [P0-#3] 修 services/registry/attach_registry/DOWNSTREAM.md 自指路径

**Files:**
- Modify: `doc/dev/design/backend/services/registry/attach_registry/DOWNSTREAM.md` (行 3/9/17/45/46/47/65/82-88/103)

**Step 1:替换表**

| 行 | old | new |
|---|---|---|
| 3 | `> **位置**:\`src-tauri/src/services/attach/\`` | `> **位置**:\`src-tauri/src/services/registry/attach_registry.rs\` (RFC 0007 下沉自 \`services/attach/\`)` |
| 9 | `services/attach/registry.rs` | `services/registry/attach_registry.rs` |
| 17 | `services/attach/idle_timeout.rs` | `services/registry/attach_registry.rs::idle_timeout` (内联函数) |
| 65 | `// services/config/mod.rs` | `// services/persistence/store.rs` (config 已下沉到 persistence) |
| 82-88 (7 处) | `services/attach/*` | `services/registry/attach_registry` |
| 85 | `services/attach/* → \`mcp_server/*\`` | `services/registry/attach_registry → \`app/mcp/*\` (frontend MCP, RFC 0002-revised)` |
| 103 | `src-tauri/src/services/attach/` | `src-tauri/src/services/registry/attach_registry.rs` |

**Step 2:同样替换 INTERFACE.md** (见 Task 4,合并到一个 commit 也可)

**Step 3:验证**
```bash
grep -rnE 'services/attach/|mcp_server/' doc/dev/design/backend/services/registry/attach_registry/
# 期望: 仅命中 RFC 0007 历史说明段 (如"已下沉自 services/attach/")和"被替换为"说明
```

**Step 4:Commit**
```bash
git add doc/dev/design/backend/services/registry/attach_registry/DOWNSTREAM.md
git commit -m "docs(design/backend): fix attach_registry self-reference paths (RFC 0007 + 0002-revised)"
```

---

### Task 3: [P0-#4] 修 §5.1 命令计数 table (build 45 → 真实数)

**Files:**
- Modify: `doc/dev/design/backend/README.md` (行 404-415)

**Step 1:重写 §5.1 表格为来源 truth**

把行 404-412 的"X 命令"列替换为"IPC 数"列,把"已生成"改成"声明"。

**Step 2:重写行 415 "完整 45 命令"**

实际加和: §5.1 9 命令 module 声明数 = 26+5+4+14+4+6+9+4+4 = 76 (与 §14 行 415 "45" 不符)

**Step 3:两种修法 (Task 0-A 决策时定一个)**

- 修法 1:**修正所有声明数**:从 INTERFACE 实证 16+10+4+14+3+6+9+4+4 = 70
- 修法 2:**在 §5.1 表前加注释行**:`> 注:本表 IPC 数声明 = 设计目标数;以 commands/<m>/INTERFACE.md 实证为准 (合计 70)`
- **建议**:修法 1 (彻底)

**Step 4:验证**
```bash
# §5.1 各行声明数 = INTERFACE 实证数
# 例: commands/session/INTERFACE.md 的 `^pub async fn` 数 = §5.1 session.rs 行声明数
grep -cE '^pub async fn' doc/dev/design/backend/commands/{session,workspace,terminal,tmux,settings,mcp,persistence,logging,tunnel}/INTERFACE.md
```

**Step 5:Commit**
```bash
git add doc/dev/design/backend/README.md
git commit -m "docs(design/backend): fix §5.1 IPC count table to match INTERFACE.md"
```

---

### Task 4: [P0-#8] 修 §13 行 861 + 877 算术与描述

**Files:**
- Modify: `doc/dev/design/backend/README.md` (行 861, 877, 879)

**Step 1:行 861 替换**

old:
```
> **唯一权威**：本文档。每个 module 配 RESPONSIBILITY / INTERFACE / DOWNSTREAM 3 份独立契约文档（共 32 module × 3 = **96 份 module docs**，已全部生成）。
```

new:
```
> **唯一权威**：本文档。每个 module 配 RESPONSIBILITY / INTERFACE / DOWNSTREAM 3 份独立契约文档（共 33 module × 3 = **99 份 module docs**，已全部生成)。
> **注**:`models/` 子树 (RFC 0007 plan) 尚未生成 R/I/D,见 §2.4 ⏳ 拆分 plan 段;`capture` 是单 doc 例外。
```

**Step 2:行 877 替换**

old:
```
| **models/README.md** | [`models/README.md`](models/README.md)（7 domain 索引） |
```

new:
```
| **models/README.md** | [`models/README.md`](models/README.md)（8 domain **plan**,含 mod.rs re-export;⏳ RFC 0007 拆分未执行) |
| **models/capture.md** | [`models/capture.md`](models/capture.md)（pure function,例外单 doc) |
```

**Step 3:行 879 替换**

old:
```
| ~~`services/config / capture / config.rs`~~ | ❌ 删除 / 下沉（RFC 0003/0006） |
```

new:
```
| ~~`services/config / config.rs`~~ | ✅ RFC 0003-revised 删除 services/config/ 模块
| ~~`services/capture`~~ | ✅ 下沉到 `models/capture.md` (RFC 0006) — 但 `services/capture/{ansi,tmux}` 保留为业务编排层 |
```

**Step 4:验证**
```bash
grep -n '32 module' doc/dev/design/backend/README.md
# 期望: 空
grep -n '96 份' doc/dev/design/backend/README.md
# 期望: 空 (或仅"曾经 96"历史说明)
```

**Step 5:Commit**
```bash
git add doc/dev/design/backend/README.md
git commit -m "docs(design/backend): fix §13 + §14 doc-count math and mark models subtree as plan"
```

---

### Task 5: [P0-#5] 删除 services/ 3 个空目录

**Files:**
- Remove: `doc/dev/design/backend/services/attach/` (空)
- Remove: `doc/dev/design/backend/services/subscribe/` (空)
- Remove: `doc/dev/design/backend/services/reverse_tunnel/` (空)

**Step 1:`git rm`**
```bash
git rm -r doc/dev/design/backend/services/attach
git rm -r doc/dev/design/backend/services/subscribe
git rm -r doc/dev/design/backend/services/reverse_tunnel
```

**Step 2:验证**
```bash
find doc/dev/design/backend/services -maxdepth 1 -type d -empty
# 期望: 空
find doc/dev/design/backend/services -maxdepth 1 -type d | sort
# 期望: 8 个 (audit, capture, io, lifecycle, output, persistence, registry, transport)
```

**Step 3:Commit**
```bash
git commit -m "docs(design/backend): remove RFC 0007 empty orphan dirs (attach/subscribe/reverse_tunnel)"
```

---

### Task 6: [P0-#6] 修 §14 表格缺 M10 行

**Files:**
- Modify: `doc/dev/design/backend/README.md` (行 899 与 901 之间插入新行)

**Step 1:插入行 900 (M10)**

位置:行 899 (M9 行) 与 行 901 (M11 行) 之间。

新行:
```
| §2 M10 Microsoft Store 上架 | (未来) | frontend + 平台商店通道 + backend 无依赖 (MSIX / EV 证书 / Store UX 由 frontend PM 负责) | |
```

**Step 2:验证**
```bash
grep -nE 'M1[0-9]' doc/dev/design/backend/README.md | head
# 期望: M10 + M11 都出现
```

**Step 3:Commit**
```bash
git add doc/dev/design/backend/README.md
git commit -m "docs(design/backend): add M10 Microsoft Store row to §14 PRD mapping"
```

---

### Task 7: [P0-#9] 修 §14 行 900 M9 PRD supersede 注释

**Files:**
- Modify: `doc/dev/design/backend/README.md` (行 900)

**Step 1:替换**

old:
```
| **§2 M9 配置 JSON** | RFC 0003-revised | `commands/persistence.rs` 扩展（settings IPC + `after_settings_changed`） | |
```

new:
```
| **§2 M9 配置 JSON** | RFC 0003-revised (supersede PRD §2 M9 原文 TOML+watch) | `commands/persistence.rs` 扩展（settings IPC + `after_settings_changed`） | |
```

**Step 2:验证**
```bash
grep -n 'M9 配置' doc/dev/design/backend/README.md
# 期望: 含 supersede 字样
```

**Step 3:Commit**
```bash
git add doc/dev/design/backend/README.md
git commit -m "docs(design/backend): annotate M9 row as supersede of PRD TOML+watch text"
```

---

## 阶段 2 — P0 路径决策后 patch (3 项, Task 0 决策驱动)

> **目标**:执行 Task 0 锁定的 3 项决策对应的 patch。

### Task 8: [P0-#1] 标记 models 置 ⏳ plan state

**前置**: Task 0-A 选 2 改 README。

**Files:**
- Modify: `doc/dev/design/backend/README.md` (§2.4 行 178-223 + §5.4 行 459-482)

**Step 1:§2.4 行 178 加 ⏳ 标记**

old:
```
### 2.4 `models/` — 纯数据 + 类型契约（8 module 按 data domain 切）
```

new:
```
### 2.4 `models/` — 纯数据 + 类型契约（**⏳ RFC 0007 拆分 plan, 8 module R/I/D 尚未生成**; 当前 `capture.md` + `models/README.md` 2 文件)
```

**Step 2:§5.4 行 459 加 ⏳ 标记**

old:
```
### 5.4 `models/` 子模块（8 domain，按数据 domain 切）
```

new:
```
### 5.4 `models/` 子模块（**⏳ RFC 0007 拆分 plan, 8 domain R/I/D 尚未生成**）
```

**Step 3:验证**
```bash
grep -n '⏳ RFC 0007 拆分 plan' doc/dev/design/backend/README.md
# 期望: 命中 2 处 (§2.4 + §5.4)
```

**Step 4:Commit**
```bash
git add doc/dev/design/backend/README.md
git commit -m "docs(design/backend): mark models/ subtree as RFC 0007 plan not implemented"
```

---

### Task 9: [P0-§2.A] §2.2 树形图加 audit/ 行

**前置**: Task 0-B 选 1。

**Files:**
- Modify: `doc/dev/design/backend/README.md` (行 116-118)

**Step 1:在 services/ 树形图末加 audit/ 行**

old:
```
├── io/                        IO 处理
│   ├── log.rs                 ⭐ session_log 文件 writer（拆分自原 services/session_log.rs）
│   └── wire.rs                ⭐ binary_frame encoding/decoding（移自原 infrastructure/binary_frame.rs）
│
└── audit/                     审计日志（MCP 速率限制 + audit）
    └── mod.rs                 ⭐ AuditLog + rate_limit + token 重生成
```

new (树内 reorder):
```
├── io/                        IO 处理
│   ├── log.rs                 ⭐ session_log 文件 writer（拆分自原 services/session_log.rs）
│   └── wire.rs                ⭐ binary_frame encoding/decoding（移自原 infrastructure/binary_frame.rs）
│
└── audit/                     审计日志（MCP 速率限制 + audit）
    └── mod.rs                 ⭐ AuditLog + rate_limit + token 重生成
```

(树本身已含 audit/ — 验证 §5.2 行 417 "7 子 module + 1 audit" 与树形图一致)

**Step 2:实际 verify 是 grep 行数**

```bash
grep -n 'audit/' doc/dev/design/backend/README.md | head
# 期望: §2.2 树形图 + §5.2 表格 都有
```

如果树本身已经有 audit/ 行,这个 task 简化为 **grep 验证** 即可,无需 patch。

**Step 3:Commit**(或 N/A if no patch needed)

---

### Task 10: [P0-§2.X] 加 services/capture/README.md

**前置**: Task 0-C 选 1。

**Files:**
- Create: `doc/dev/design/backend/services/capture/README.md`

**Step 1:写内容**

```markdown
# services/capture/ · 目录指引

> **位置**: src-tauri/src/services/capture/

## 子 module

| module | 文档 | 职责 |
|---|---|---|
| `mod.rs` (源码) | — | 路由层 (tmux / OutputRing tail / 未来 offscreen) |
| `tmux/` | RESPONSIBILITY + INTERFACE + DOWNSTREAM | tmux capture-pane backend 命令封装 |
| `ansi/` | RESPONSIBILITY + INTERFACE + DOWNSTREAM | ANSI 处理 (thin wrapper, 调 `models/capture` pure function) |

## 关系

- 上游: `services/lifecycle/{local,ssh,tmux}` 触发 capture
- 下游: `models/capture` 提供 `strip_ansi()` / `extract_text()` pure function
- 触发方: `commands/{session,terminal}` 通过 IPC 调 capture_*

详见 [顶层 README §2.2 + §5.2](../../README.md)。
```

**Step 2:验证**
```bash
ls doc/dev/design/backend/services/capture/
# 期望: README.md + ansi/ + tmux/
```

**Step 3:Commit**
```bash
git add doc/dev/design/backend/services/capture/README.md
git commit -m "docs(design/backend): add services/capture/ directory guide"
```

---

## 阶段 3 — 剩余 P0 路径 patch (3 项,~40 min)

> **目标**:完成 P0-#7 (frontend README 模型树) + P0-#8 (mcp_server v0 路径) + P0-#10 (shared/ v3 路径)

### Task 11: [P0-#7 / §2.E / §4.R/S/T] 修 frontend README §2.3 + §2.4 列表与 tree 对齐

**Files:**
- Modify: `doc/dev/design/frontend/README.md` (行 17-20, 102-114, 127, 142-143, 158)

**Step 1:§1 行 17-20 ASCII 树 (新增 model/cross-cutting 子目录)**

old:
```
├── model/           数据 + 算法（5 + 1 = 6 domain）
```

new:
```
├── model/           数据 + 算法（4 + 1 + 1 = 6 domain; cross-cutting 是 helper, 不算正式 domain）
```

**Step 2:§2.3 行 102-114 + 127 改为正式列表**

old:
```
### 2.3 `model/` — 数据 + 算法（5 + 1 = 6 domain）

**5 + 1 = 6 个目录**：

```
src/model/
├── session/        Session / SessionConfig / SessionDisplayConfig
├── workspace/      Workspace / Window / Group / PaneNode（含 paneTree 算法）
├── terminal/       TerminalTheme / 5 个 ANSI 调色板
├── settings/       Settings / SettingsCategory / LogLevel（含 TerminalTheme / 5 个 ANSI 调色板）
├── tmux/           TmuxController / AttachedServer / TmuxPane / TmuxWindow
└── common/         跨域纯函数（textTransform / constants / generateId）
```

**每个 domain 文件模板**(template)：
```typescript
model/<domain>/
├── types.ts          # 数据 shape / enum / union
├── repository.ts     # Repository 接口（service 实现）
├── events.ts         # event 契约（event name + payload 类型）
├── accessor.ts       # query 纯函数（getActiveXxx(items)）
├── rules.ts          # mutation 纯函数（applyXxx(item, patch)）
└── *.test.ts
```

**例外**：
- `cross-cutting/`：无 types / repository / events / accessor / rules——只有 helper 文件
- `settings/terminal/`：terminal 是 settings 的视觉子集，不独立成 domain
- `workspace/rules/`：按子域分子目录（paneTree 是最大子目录）
```

new:
```
### 2.3 `model/` — 数据 + 算法（4 + 1 + 1 = 6 项; 5 个正式 domain + 1 个 helper）

**5 个正式 domain + 1 个 helper**:

| 文件 | 内容 |
|---|---|
| `session/` | Session / SessionConfig / SessionDisplayConfig |
| `workspace/` | Workspace / Window / Group / PaneNode（含 paneTree 算法） |
| `settings/` | Settings / SettingsCategory / LogLevel（**含** TerminalTheme / 5 个 ANSI 调色板 —— terminal 是 settings 的视觉子集, 不独立成 domain) |
| `tmux/` | TmuxController / AttachedServer / TmuxPane / TmuxWindow |
| `cross-cutting/` | 跨域纯函数 (textTransform / constants / generateId) — **helper, 不是正式 domain** |

**每个正式 domain 文件模板** (template):
```typescript
model/<domain>/
├── types.ts          # 数据 shape / enum / union
├── repository.ts     # Repository 接口（service 实现）
├── events.ts         # event 契约（event name + payload 类型）
├── accessor.ts       # query 纯函数（getActiveXxx(items)）
├── rules.ts          # mutation 纯函数（applyXxx(item, patch)）
└── *.test.ts
```

**例外 / 子结构**:
- `cross-cutting/`: helper 文件 (无 types / repository / events / accessor / rules)
- `settings/terminal/`: terminal 是 settings 的视觉子集, 不独立成 domain
- `workspace/rules/`: 按子域分子目录 (paneTree 是最大子目录)
```

**Step 3:§2.4 行 142-143 + 158 列表与 tree 对齐**

old:
```
### 2.4 `service/` — 运行时状态 + IPC 桥（6 domain）

**6 个 domain 划分**：
- 业务 domain：`session` / `workspace` / `tmux` / `settings` / `persistence`
- 工具 domain：`logger`（基础设施辅助）
```

new:
```
### 2.4 `service/` — 运行时状态 + IPC 桥（5 个 domain）

**5 个 domain 划分**：
- 业务 domain：`session` / `workspace` / `tmux` / `settings` / `persistence`
- ~~工具 domain `logger`~~ → 已合并到 `infra/logger/` (logger 是底层原语, 见下面"已删除/合并")
```

**Step 4:验证**
```bash
grep -n 'common/' doc/dev/design/frontend/README.md
# 期望: 空 (或仅历史说明)
grep -n 'logger' doc/dev/design/frontend/README.md | head -5
# 期望: 仅在"已删除/合并"出现
```

**Step 6:Commit**
```bash
git add doc/dev/design/frontend/README.md
git commit -m "docs(design/frontend): align §2.3 + §2.4 domain lists with actual tree"
```

---

### Task 12: [P0-#8] 修 attach_registry/INTERFACE.md 9 处 mcp_server 引用

**Files:**
- Modify: `doc/dev/design/backend/services/registry/attach_registry/INTERFACE.md` (行 102/103/104/121/124/289/290, 8 处 + 1 章节标题)

**Step 1:替换表**

| 行 | old | new |
|---|---|---|
| 102 | `mcp_server::tools::attach_session` | `app/mcp/tools/attach_session.ts` (frontend, RFC 0002-revised) |
| 103 | `mcp_server::tools::detach_session` | `app/mcp/tools/detach_session.ts` (frontend, RFC 0002-revised) |
| 104 | `mcp_server::server` (EOF handler) | `app/mcp/server.ts` (frontend HTTP server EOF handler, RFC 0002-revised) |
| 114 | `mcp_server/*` 直接调 `attach_registry.inner` | `app/mcp/tools/*` 调 `attach_registry` 公开 API |
| 121 | `### 3.1 mcp_server ↔ attach` | `### 3.1 app/mcp ↔ attach (RFC 0002-revised)` |
| 124 | `// mcp_server/tools/attach_session.rs` | `// app/mcp/tools/attach_session.ts (RFC 0002-revised)` |
| 289 | `mcp_server/tools/attach_session` | `app/mcp/tools/attach_session.ts` |
| 290 | `mcp_server/tools/detach_session` | `app/mcp/tools/detach_session.ts` |

**Step 2:验证**
```bash
grep -rn 'mcp_server' doc/dev/design/backend/services/registry/attach_registry/
# 期望: 仅命中 RFC 0002 0002-revised supersede 说明
```

**Step 3:Commit**
```bash
git add doc/dev/design/backend/services/registry/attach_registry/INTERFACE.md
git commit -m "docs(design/backend): replace mcp_server/* paths in attach_registry/INTERFACE.md"
```

---

### Task 13: [P0-#10] 修 ui/{shell,terminal,workspace}/DOWNSTREAM.md 4 处 shared/ 引用

**Files:**
- Modify: `doc/dev/design/frontend/ui/shell/DOWNSTREAM.md` (行 17)
- Modify: `doc/dev/design/frontend/ui/terminal/DOWNSTREAM.md` (行 13, 15)
- Modify: `doc/dev/design/frontend/ui/workspace/DOWNSTREAM.md` (行 15)

**Step 1:替换表**

| 文件:行 | old | new |
|---|---|---|
| ui/shell/DOWNSTREAM.md:17 | `shared/persistence` | `model/cross-cutting/persistence` (RFC 0007-revise, cross-cutting) |
| ui/terminal/DOWNSTREAM.md:13 | `shared/ui` | `model/cross-cutting/ui` |
| ui/terminal/DOWNSTREAM.md:15 | `shared/types` | `model/cross-cutting/types` |
| ui/workspace/DOWNSTREAM.md:15 | `shared/persistence` | `model/cross-cutting/persistence` |

**Step 2:验证**
```bash
grep -rn 'shared/' doc/dev/design/frontend/ui/
# 期望: 空
```

**Step 3:Commit**
```bash
git add doc/dev/design/frontend/ui/{shell,terminal,workspace}/DOWNSTREAM.md
git commit -m "docs(design/frontend): replace v3 shared/ paths with model/cross-cutting/"
```

---

## 阶段 4 — P1/P2 patch (6 项,~30 min)

> **目标**:完成 §2.2 vs §5.2 重复消除 + SessionManager 字段可见性 + mcp.rs "4→6" 描述 + 其他轻量 patch

### Task 14: [P1-#13] §2.2 vs §5.2 services 描述重复处理

**Files:**
- Modify: `doc/dev/design/backend/README.md` (§2.2 行 81-118 + §5.2 行 417-441)

**Step 1:决策**
- 选 1: 删 §5.2 表格, 让 §2.2 树形图唯一权威
- 选 2: 删 §2.2 树形图, 让 §5.2 表格唯一权威 (developer-oriented)
- **建议**: 选 2 (§5.2 表格更适合 dev 扫读)

**Step 2:删 §2.2 树形图 (行 81-118 整段)**
- 替换为单行摘要: `> services/ 子模块完整描述见 §5.2 表格`

**Step 3:验证** + **Step 4:Commit**

---

### Task 15: [P1-#16] SessionManager struct 字段可见性显式化

**Files:**
- Modify: `doc/dev/design/backend/README.md` (§4.6 行 309-326)

**Step 1:为所有无 pub 字段加 pub(crate)**

old 行 311-316:
```rust
sessions: DashMap<u32, Arc<ActiveSession>>,
session_id_source: Arc<SessionIdSource>,
pty_system: Box<dyn PtySystem>,
ssh_backend: Arc<dyn SshBackend>,
tmux_controllers: DashMap<u32, Arc<TmuxController>>,
next_controller_id: AtomicU32,
```

new:
```rust
pub(crate) sessions: DashMap<u32, Arc<ActiveSession>>,
pub(crate) session_id_source: Arc<SessionIdSource>,
pub(crate) pty_system: Box<dyn PtySystem>,
pub(crate) ssh_backend: Arc<dyn SshBackend>,
pub(crate) tmux_controllers: DashMap<u32, Arc<TmuxController>>,
pub(crate) next_controller_id: AtomicU32,
```

**Step 2:在 §4.6 顶部加注释**: `// fields are pub(crate) by friend-module pattern; reader should call methods, not access fields directly`

**Step 3:验证** + **Step 4:Commit**

---

### Task 16: [P1-#15] mcp.rs "4→6" 描述模糊修正

**Files:**
- Modify: `doc/dev/design/backend/README.md` (行 44 + 行 409)

**Step 1:行 44 + 行 409 "4→6" 改 "6 commands"**

old:
```
| `mcp.rs` | MCP attach/state/status/token | `app/mcp` | ⚠️ 简化（4→6 命令） |
```

new:
```
| `mcp.rs` | MCP attach/state/status/token | `app/mcp` | 6 commands (attach/detach/get_state/list/status/regenerate_token) |
```

**Step 2:验证** + **Step 3:Commit**

---

### Task 17: [P2-#19] 9 份 commands/RESPONSIBILITY.md 末段 RFC reminder 精简

**Files:**
- Modify: `doc/dev/design/backend/commands/{logging,mcp,persistence,session,settings,terminal,tmux,tunnel,workspace}/RESPONSIBILITY.md`

**Step 1:每份末段 "RFC 0002-revised：12 个 MCP 工具移到 frontend" 段落改为 1 行引用**

old:
```
... (RFC 0002-revised 长段) ...
```

new:
```
> 详见顶层 README §14 M6 行 + RFC 0002-revised ADR
```

**Step 2:验证**
```bash
grep -rn '12 个 MCP 工具' doc/dev/design/backend/commands/*/RESPONSIBILITY.md
# 期望: 空 (顶层 README 仍可保留)
```

**Step 3:Commit**

---

### Task 18: [P2-#20] §1 ASCII 树加 cross-cutting + §2.5 infra/tauri 子目录细化

**Files:**
- Modify: `doc/dev/design/frontend/README.md` (§1 行 18 + §2.5 行 207-209)

**Step 1:§1 行 18 改 tree**(同 Task 11 改动,合并 1 个 commit 即可)

**Step 2:§2.5 行 207-209 ASCII 树加 `tauri/{commands,events,repositories,eventBuses}/`**

old:
```
src/infra/
├── tauri/         IPC 适配（invoke 封装 + listen 封装 + Repository 实现 + 事件总线）
├── store/         tauri-plugin-store 包装（持久化底层）
├── clipboard/     剪贴板读写
└── logger/        日志（命令式 API，全局单例）
```

new:
```
src/infra/
├── tauri/         IPC 适配（invoke 封装 + listen 封装 + Repository 实现 + 事件总线）
│   ├── commands/      invoke 封装 (按 backend domain 拆)
│   ├── events/        listen 封装 (按 backend event name 拆)
│   ├── repositories/  Repository 接口实现 (对应 model/repository.ts)
│   └── eventBuses/    事件总线 (双层: 底层通用 + 上层 typed)
├── store/         tauri-plugin-store 包装（持久化底层）
├── clipboard/     剪贴板读写
└── logger/        日志（命令式 API，全局单例）
```

**Step 3:验证** + **Step 4:Commit**

---

### Task 19: [P2-#22] README 加 capture 命名区分后缀

**Files:**
- Modify: `doc/dev/design/backend/README.md` (§5.4 行 424 + §2.2 行 99)

**Step 1:§5.4 行 424** "capture/ 2 module × 3 docs" 加 "(业务编排)" 后缀
**Step 2:§2.2 行 99** capture 加 "(业务) vs models/capture (算法)" 说明

**Step 3:验证** + **Step 4:Commit**

---

## 阶段 5 — 验证与文档更新

### Task 20:跑全部 verify grep

```bash
# 1. models/ subtree 状态
find doc/dev/design/backend/models -type f | wc -l
# 期望: 3 (capture.md + README.md + 1 个 ⏳ marker file, 如果 Task 8 改了)

# 2. services/ 子目录数
find doc/dev/design/backend/services -maxdepth 1 -type d | wc -l
# 期望: 8 (audit, capture, io, lifecycle, output, persistence, registry, transport)

# 3. integration/mcp 应为空
grep -rn 'integration/mcp' doc/dev/design/
# 期望: 空

# 4. mcp_server 在 attach_registry 仅作为 supersede 说明
grep -rn 'mcp_server' doc/dev/design/backend/services/registry/attach_registry/
# 期望: 仅命中 RFC 0002-revised 上下文说明

# 5. shared/ 在 ui/ 应为空
grep -rn 'shared/' doc/dev/design/frontend/ui/
# 期望: 空

# 6. §5.1 算术
grep -n '45 命令' doc/dev/design/backend/README.md
# 期望: 空 (Task 3 已改)

# 7. §13 算术
grep -n '32 module × 3' doc/dev/design/backend/README.md
grep -n '96 份' doc/dev/design/backend/README.md
# 期望: 空 (Task 4 已改)

# 8. §14 M10 行
grep -n 'M10 Microsoft Store' doc/dev/design/backend/README.md
# 期望: 命中 1 行

# 9. frontend model domain 列表
grep -n 'common/' doc/dev/design/frontend/README.md
grep -n 'terminal/       TerminalTheme' doc/dev/design/frontend/README.md
# 期望: 空 (Task 11 已改)

# 10. frontend service logger 不在 domain 列表
grep -nE 'logger.*基础设施辅助|logger.*domain' doc/dev/design/frontend/README.md
# 期望: 仅在已删除段出现
```

### Task 21:更新 design 评审跟踪表 (在 doc/dev/roadmap/ 下)

**Files:**
- Modify: `doc/dev/roadmap/design-review-remediation-plan.md` (本文件)

**Step 1:把所有 task checkbox 从 `[ ]` 改为 `[x]` (执行过的)**

**Step 2:加"执行结果"段**: 列出实际 commits hash + 任何偏离 plan 的说明

**Step 3:Commit**
```bash
git add doc/dev/roadmap/design-review-remediation-plan.md
git commit -m "docs(roadmap): mark design-review-remediation-plan tasks complete"
```

---

## 后续 (出本 plan 范围)

1. **P0-#1 models/ 24 份 R/I/D 生成**: 独立 RFC, 走 subagent-driven-development。
2. **§2.2/§5.2 §2.4/§5.4 重复消除**: P1 task 14 选了选 2,但完整"冗余度"清理需要架构组评审。
3. **ui/ai_takeover.md 是否独立成文件**: P2-#21, 评估合并入 app/session/RESPONSIBILITY.md。
4. **PRD M9 TOML+watch vs README JSON 直存 supersede**:已在本 plan Task 7 处理;但 RFC 0003-revised 应同步更新 ADR 文件 (`doc/dev/adr/0003-revised-...`)。
5. **PRD M10 Microsoft Store 上架** 在 design 树只补了 1 行说明;完整的 MSIX / EV 证书 / Store UX 由 frontend PM 负责 (不在 backend 设计范围)。
6. **§1 ASCII 树扩到全部 33 module** (P2-#20): 列入 backlog, 不在本 plan。

---

## 风险与回滚

- **风险 1**: grep 验证失败 (某 task 替换不全): 重跑该 task 的 verify grep,定位未替换的旧字符串,补 patch。
- **风险 2**: patch 中文失败 (skill pitfall 18,full-width 括号/em-dash 字节不一致): 改用 `write_file` 全文件重写该段。
- **风险 3**: 期间 sibling agent 修改同一文件: 每次 commit 前 `git status -s` 确认。
- **风险 4**: PR review 拒绝,要求更激进重构 (例如合并 §2.4/§5.4): 按 reviewer 反馈,本 plan 是 max-effort mechanical patch, 不含架构级改动。

---

## NOT-TO-FIX 回顾 (防止过度工程化)

> 本 plan 不做以下事项 (即使发现 P0/P2 也跳过):

1. **不生成 models/ 24 份 R/I/D** (走独立 RFC, 见后续 #1)
2. **不追溯 v3 shared/ / services/{attach,subscribe} 同类历史路径** (本 plan Task 5 只删 v0 RFC 0007 空目录, 不追溯)
3. **不回滚 PRD M9 RFC 0003-revised** (JSON 直存是合理偏离, Task 7 加 supersede 注释而非回滚)
4. **不合并 §2.2/§5.2 audience-specific 冗余** (Task 14 二选一, 不硬合并)
5. **不为 C1-C7/R1-R12 补 design doc** (合规/风险在 doc/pdm/ 独立 doc, README §0 边界声明出本 plan)
6. **不扩 §1 ASCII 树到全部 33 module** (Task 18 限于 cross-cutting + infra 子目录细化)