# xsterm 文档索引

> **结构**：3 个角色目录 + 2 个顶层文件。每个角色有自己的入口 README，按职责查找。

## 顶层结构

```
doc/
├── README.md                              ← 你正在读
├── design-system.md                       UI 设计规范（AGENTS.md 强引用，不动）
│
├── dev/                                   "dev 视角"（dev 写的代码 + 决策 + 路线）
│   ├── rules/                             团队代码规范（命名 / 风格）
│   │   ├── ts-name-rules.md               TypeScript / TSX 命名规范
│   │   └── rust-name-rules.md             Rust 命名规范
│   ├── architecture/                      当前代码长什么样（按 4+1 视图）
│   │   ├── README.md                      索引 + 阅读路径
│   │   ├── 01-logical-view.md             概念/职责/UI 树/数据契约
│   │   ├── 02-process-view.md             运行时 task/channel/并发/生命周期
│   │   ├── 03-development-view.md         源码组织/构建/wire/bridge
│   │   ├── 04-physical-view.md            部署/capabilities/跨主机路径
│   │   └── 05-scenarios.md                关键场景把 4 视图串起来
│   ├── flows/                             代码流程（端到端 path:line + ASCII 流程图）
│   │   ├── README.md                      命名约定 + 模板
│   │   └── 01-open-tmux-session.md        打开 tmux session 端到端
│   ├── adr/                               决策记录
│   │   ├── README.md
│   │   ├── legacy-rfcs/0001..0004.md
│   │   └── 0005-tmux-redesign-v0.md
│   ├── roadmap/                           接下来做什么
│   │   ├── gap-analysis.md
│   │   ├── target-architecture.md
│   │   └── migration-prs.md
│   ├── changelog/                         已经发生什么
│   │   ├── bugs.md
│   │   └── perf.md
│   └── history/                           已废弃但保留可追溯
│       ├── README.md
│       ├── prd-0.1-requirements/
│       ├── prd-0.1-arch-snapshot/
│       ├── external/ai-terminal-spec/
│       ├── 00-ai-terminal-migration-handoff.md
│       └── 05-doc-restructure-plan.md
│
├── pdm/                                   "pdm 视角"（产品输入 / 外部规格）
│   ├── prd.md                             ai-terminal 外部目标产品规格
│   ├── mcp.md                             MCP server 协议契约
│   ├── acceptance.md                      验收标准
│   ├── compliance.md                      合规要求
│   ├── mvp-checklist.md                   MVP 验收清单
│   └── dev-handoff.md                     pdm 给 dev 的输入
│
└── tm/                                    "tm 视角"（验收 / 拍板 / PR review）
    ├── README.md                          tm 入口
    └── handoff.md                         tm 90 分钟入门指南
```

## 按角色找文档

### 我是 dev（改代码前）

| 我想…… | 看 |
|---|---|
| 了解整个项目 | `dev/architecture/README.md` → `01-logical-view.md` §1-§2 |
| 了解 tmux 子系统 | `dev/architecture/01-logical-view.md` §3 + `02-process-view.md` §3 + `03-development-view.md` §3 + [`dev/architecture/06-tmux-runtime-architecture.md`](dev/architecture/06-tmux-runtime-architecture.md)（30 分钟入门）+ `dev/adr/0005-tmux-redesign-v0.md` |
| 改 UI 之前 | `design-system.md`（必读）+ AGENTS.md §"Pre-commit verification" |
| 写 / 改前端代码之前 | `dev/rules/ts-name-rules.md`（命名规范） |
| 写 / 改 Rust 后端代码之前 | `dev/rules/rust-name-rules.md`（命名规范） |
| 改 bug 之前 | `dev/changelog/bugs.md`（最近踩过什么坑）|
| 改性能之前 | `dev/changelog/perf.md` Perf 001-009（按 ROI 排序）|
| 排查 race / 死锁 / 卡顿 | `dev/architecture/02-process-view.md` §3-§4 + `dev/changelog/perf.md` |
| 改 session/window/pane 之前 | `dev/architecture/01-logical-view.md` §3（概念层级）+ AGENTS.md §"命名禁忌" |
| 加 Tauri command | `dev/architecture/04-physical-view.md` §2.2（三步流程） |
| 改 CreateSessionDialog 之前 | `dev/history/prd-0.1-requirements/create-session-config.md`（**已归档**，可能过时）|
| 看接下来要做什么 | `dev/roadmap/migration-prs.md` |
| 看为什么选 tmux -CC | `dev/adr/legacy-rfcs/0001-keep-tmux-cc.md` |
| 看未来目标态 | `dev/roadmap/target-architecture.md` |
| 看 P1-P5 tmux 重设计 | `dev/adr/0005-tmux-redesign-v0.md` |
| 看关键场景怎么串起来 | `dev/architecture/05-scenarios.md` |
| 跟一个用户动作的端到端代码路径 | `dev/flows/01-open-tmux-session.md`（打开 tmux session 流程） |
| 找被废弃的旧文档 | `dev/history/README.md`（顶部 banner + 子目录索引）|

### 我是 tm（第一次接手验收）

5 分钟：读 `tm/README.md` + `tm/handoff.md` §0 入门 + `dev/architecture/README.md` + `01-logical-view.md` §1-§2。

30 分钟：通读 `dev/roadmap/target-architecture.md` §1–§5 + `dev/changelog/bugs.md` 最近 5 个 bug + `dev/roadmap/gap-analysis.md` §6 + `dev/architecture/05-scenarios.md`。

60 分钟：通读 `dev/adr/0005-tmux-redesign-v0.md` + `dev/architecture/02-process-view.md` §3-§4 + `03-development-view.md` §3-§4。

完整路径见 [`tm/handoff.md`](tm/handoff.md)。

### 我是 pdm（决策输入）

| 我想…… | 看 |
|---|---|
| 看产品目标规格 | `pdm/prd.md` |
| 看 MCP 协议契约 | `pdm/mcp.md` |
| 看验收标准 | `pdm/acceptance.md` |
| 看 MVP 验收清单 | `pdm/mvp-checklist.md` |
| 看合规要求 | `pdm/compliance.md` |
| 看 pdm → dev 完整交接 | `pdm/dev-handoff.md` |

## 维护规则

| 角色 | 何时更新 | 谁负责 |
|---|---|---|
| dev | 代码变就更新 `architecture/`，bug/perf 修完更新 `changelog/` | dev（PR 的一部分）|
| tm | 拍新决策开 ADR 在 `dev/adr/` | tm（拍板）+ dev（落地 PR）|
| pdm | 外部规格变了（罕见）| pdm |
| history | 不动；目标态过时由 `dev/architecture/` 取代 | — |

## AGENTS.md 怎么改

`AGENTS.md`（项目根）已同步更新，所有 `doc/` 链接都指向新路径。**注意**：

- `doc/design-system.md` 仍在顶层（AGENTS.md 强引用）
- `doc/architecture/` → `doc/dev/architecture/`
- `doc/maintenance/` → `doc/dev/changelog/`
- `doc/requirements/prd-0.1/` → `doc/dev/history/prd-0.1-requirements/`
- `doc/rfcs/` → `doc/dev/adr/`（RFC 平铺到 adr/ 根目录，不再用 `legacy-rfcs/` 子目录）
- `doc/prd/` → `doc/pdm/`（pdm 视角独立）
- `doc/ai-terminal-migration/` → 拆分到 `doc/dev/adr/0005`、`doc/dev/roadmap/`、`doc/dev/history/`
- 老的 handoff → `doc/tm/handoff.md`（保留可追溯版本在 `doc/dev/history/00-...`）

如果你在其他 markdown 里看到 `doc/arch/` / `doc/maintenance/` / `doc/requirements/` / `doc/rfcs/` / `doc/prd/` / `doc/ai-terminal-migration/` 路径——这是历史快照，不是当前文档。

## 没在这里的文档

- **AGENTS.md**（项目根）—— 必读清单 + 关键命令 + 设计系统约束
- **README.md**（项目根）—— 5 行模板 README（未改）
- **代码注释**（`//!` / `///`）—— Rustdoc 自动生成，`cargo doc` 编译输出