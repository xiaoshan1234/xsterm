# History（已废弃但保留可追溯）

本目录是 2026-09 文档重组前的**历史快照**。

- 路径**不再维护**——文档描述的状态可能与当前代码不一致
- AGENTS.md 和新文档已**不引用**这些文件
- 保留目的：追溯决策、保留旧 RFC 路径、避免历史信息丢失

## 子目录

| 子目录 | 来源 | 内容 |
|---|---|---|
| `prd-0.1-requirements/` | `doc/requirements/prd-0.1/` | xsterm v0.1 PRD 拆解 + 需求文档（req-001..008）+ session-config 字段详表 |
| `prd-0.1-arch-snapshot/` | `doc/arch/` | P1-P5 重构**前**的架构快照（含 633 行 architecture-map.md + tmux-cc-protocol.md + ui.md + live-data.md）|
| `external/ai-terminal-spec/` | `doc/prd/` | 2026-09 制定的 ai-terminal 外部目标产品规格（**与 xsterm 当前代码无直接关系**，仅作为演进目标参考）|
| `00-ai-terminal-migration-handoff.md` | `doc/ai-terminal-migration/README.md` | tm 接手迁移交接入口（已被 `adr/0005` + `roadmap/*` 取代）|
| `05-doc-restructure-plan.md` | 重组本身的设计稿 | 本次重组的执行计划 |

## 何时可以删除

- 当对应代码已大改（如 controller.rs 重写为多层模块），且 `architecture/` + `changelog/` 已完整描述新状态
- 提议删除前先开 RFC，给 dev + tm 1 周评审

## 维护规则

- **不修改**本目录文件内容（除 banner / README 外）
- 新历史快照按"目标态过时"原则归档到此
