# xsterm 文档索引

> **新结构**（2026-09 重组后）。共 38 个 markdown，**5 层职责独立**。从任意入口进入都能找到目标文档。

## 1. 5 层结构

```
doc/
├── README.md                          ← 你正在读
├── design-system.md                   Cursor 暗色 IDE 适配版 UI 设计规范（强引用，不动）
│
├── architecture/                      "代码现在长什么样"
│   └── overview.md                     ← 全栈架构地图 + tmux 子系统详解
│
├── adr/                               "为什么这样选"（决策记录）
│   ├── README.md                      ADR 怎么读 + 怎么写
│   ├── legacy-rfcs/                   2026-09 前的 4 份 RFC（保路径）
│   ├── 0001..0004.md                  （在 legacy-rfcs/）
│   └── 0005-tmux-redesign-v0.md       tmux 重设计（P1-P5 已落地）
│
├── roadmap/                           "接下来做什么"
│   ├── gap-analysis.md                xsterm 现状 vs ai-terminal 规格差距
│   ├── target-architecture.md         演进终态
│   └── migration-prs.md                PR 切片 + 验收标准
│
├── changelog/                         "已经发生什么"
│   ├── bugs.md                         bug 001-022 + 修复记录（按时间倒序）
│   └── perf.md                         性能瓶颈 + 与 oxideterm 对比 + Perf 001-009 ROI 排序
│
└── history/                           "已废弃但保留可追溯"
    ├── README.md                      本目录说明
    ├── prd-0.1-requirements/          v0.1 PRD 拆解 + req-001..008 + session-config 字段详表
    ├── prd-0.1-arch-snapshot/         P1-P5 前的架构快照（含 633 行 architecture-map.md）
    ├── external/ai-terminal-spec/     外部 ai-terminal 产品规格（与 xsterm 当前代码无关）
    ├── 00-ai-terminal-migration-handoff.md   tm 接手迁移交接（已并入 adr/0005 + roadmap/）
    └── 05-doc-restructure-plan.md     本次重组的设计稿
```

## 2. 按场景找文档

| 我想…… | 看 |
|---|---|
| 了解整个项目 | `architecture/overview.md` |
| 了解 tmux 子系统 | `architecture/overview.md` §5 + `adr/0005-tmux-redesign-v0.md` |
| 改 UI 之前 | `design-system.md`（必读）+ AGENTS.md §"Pre-commit verification" |
| 改 bug 之前 | `changelog/bugs.md`（最近踩过什么坑）|
| 改性能之前 | `changelog/perf.md` Perf 001-009（按 ROI 排序）|
| 改 session/window/pane 之前 | `architecture/overview.md` §5.1（概念层级）+ AGENTS.md §"命名禁忌" |
| 改 CreateSessionDialog 之前 | `history/prd-0.1-requirements/create-session-config.md` |
| 看接下来要做什么 | `roadmap/migration-prs.md` |
| 看为什么选 tmux -CC | `adr/legacy-rfcs/0001-keep-tmux-cc.md` |
| 看未来目标态 | `roadmap/target-architecture.md` |
| 看 P1-P5 tmux 重设计 | `adr/0005-tmux-redesign-v0.md` |
| 找被废弃的旧文档 | `history/README.md`（顶部 banner + 子目录索引）|

## 3. AGENTS.md 怎么改

`AGENTS.md`（项目根）已同步更新，所有 `doc/` 链接都指向新路径。如果你在其他 markdown 里看到老的 `doc/arch/` / `doc/requirements/` / `doc/maintenance/` 路径——这是历史快照，**不是当前文档**，请更新你的链接。

## 4. 维护规则

| 层 | 何时更新 | 谁负责 |
|---|---|---|
| `architecture/` | 代码变就更新 | dev（PR 的一部分）|
| `adr/` | 拍新决策时新建 ADR | 拍板人 |
| `roadmap/` | 季度切换或重大里程碑 | tm / pdm |
| `changelog/` | bug fix / perf fix 完成后 | dev（PR 的一部分）|
| `history/` | 不动；目标态过时由 `architecture/` 取代 | — |

## 5. 没在这里的文档

- **AGENTS.md**（项目根）—— 必读清单 + 关键命令 + 设计系统约束
- **README.md**（项目根）—— 5 行模板 README（未改）
- **代码注释**（`//!` / `///`）—— Rustdoc 自动生成，`cargo doc` 编译输出
