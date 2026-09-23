# xsterm 架构文档（按 4+1 视图组织）

> **方法论**：4+1 视图（Kruchten, 1995）—— 用四个独立视图加一个场景视图描述同一架构。
> 选这个模型的目的是给 dev / tm / pdm 三方一个**同一份骨架、不同切片**的认知入口：
> 改 UI 时只看逻辑视图；排查 race 只看进程视图；改构建只看开发视图；做部署只看物理视图。
>
> **范围**：本目录描述 P1-P5 重构**后**的实际代码结构（commit 范围 ac213c8..8618336 on dev）。
> 历史快照（Wave 0-6 monolith）在 `dev/history/prd-0.1-arch-snapshot/`。

## 5 个视图

| # | 视图 | 关心什么 | 主要受众 | 文件 |
|---|---|---|---|---|
| 1 | 逻辑视图 (Logical) | 领域概念、模块职责、UI 树层级、数据契约 | dev（改模块前）、pdm（确认范围） | `01-logical-view.md` |
| 2 | 进程视图 (Process) | 运行时 task/channel、并发原语、生命周期、shutdown 顺序 | dev（排查 race / 调性能） | `02-process-view.md` |
| 3 | 开发视图 (Development) | 源码组织、模块依赖、构建链、构建时约束 | dev（新人入门、改构建） | `03-development-view.md` |
| 4 | 物理视图 (Physical) | 部署拓扑、Tauri capabilities、安全边界、跨 SSH 路径差异 | dev（写 command 加权限）、tm（验收安全） | `04-physical-view.md` |
| +1 | 场景视图 (Scenarios) | 关键场景把上面 4 个视图串起来 | 所有人（验证视图一致性） | `05-scenarios.md` |
| ⊕ | **tmux 深入**（任意编号后） | 21 字段、4 task、waiter 注册表、生命周期、跨 transport 抽象 | dev（第一次读 tmux 代码） | [`06-tmux-runtime-architecture.md`](06-tmux-runtime-architecture.md) |

## 阅读路径

新人第一次读：**`01-logical-view.md`** 一句话总结 + 概念层级表 → **`05-scenarios.md`** 三个关键场景 → 按需要深入对应视图。

| 我想…… | 先看 |
|---|---|
| 了解整个项目（5 分钟） | `01-logical-view.md` §1-§2 |
| 了解 tmux 子系统（30 分钟） | `01-logical-view.md` §3 tmux 概念层级 + `02-process-view.md` §3 controller tasks + `03-development-view.md` §3 protocol/ + controller/ 模块树 |
| 改 UI 之前 | `01-logical-view.md` §2 UI 树层级 + `doc/design-system.md`（必读） |
| 排查 race / 死锁 / 卡顿 | `02-process-view.md` §3-§4（task/channel）+ `dev/changelog/perf.md` Perf 001-009 |
| 改模块组织 / 拆 monolith | `03-development-view.md` §1-§3（分层 + 模块依赖） |
| 第一次接触 `tmux_session/` Rust 代码 | [`06-tmux-runtime-architecture.md`](06-tmux-runtime-architecture.md) 30 分钟入门（字段、task、waiter、生命周期） |
| 加 Tauri command | `04-physical-view.md` §1-§2（capabilities + IPC 边界） |
| 看关键场景怎么串起来 | `05-scenarios.md` |
| 看 ADR 为什么这么设计 | `dev/adr/`（不在本目录） |

## 与其他文档目录的关系

```
dev/
├── architecture/        ← 本目录（4+1 视图，描述"现在长什么样"）
├── adr/                 决策记录（"为什么这么选"）
├── roadmap/             演进路线（"未来要变什么"）
├── changelog/           已发生事件（bug/perf）
└── history/             已废弃但保留可追溯
```

- 想改代码 → 先读 `architecture/` 对应视图
- 想看决策原因 → `adr/`
- 想看接下来要做什么 → `roadmap/`
- 想看之前踩过什么坑 → `changelog/`

## 维护规则

- 代码结构变（新增模块 / 拆 monolith / 改进程拓扑）→ 同步更新对应视图文件
- bug 修完 → `changelog/bugs.md`，不归本目录
- 决策变 → `adr/`，不归本目录
- 本目录不留历史快照 —— 历史在 `dev/history/`

## AGENTS.md 引用方式

`AGENTS.md` 不直接列 5 个视图路径，而是引用本 README（顶部 "Architecture" 一节）。
修本目录结构时**只需更新本 README 的路径表**，不需要改 AGENTS.md。
