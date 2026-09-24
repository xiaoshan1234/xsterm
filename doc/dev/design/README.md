# 设计 (Design) — 目标态架构地图

> 本目录描述 xsterm 的**目标态 4 层架构**。
> 它不是代码现状的镜像，而是基于现状设计改进的蓝图。代码改造按各层 README 末尾的「改进方向」一节推进。

## 1. 全景

```
                          ┌──────────────────────────┐
                          │      Tauri WebView       │
                          │   (React + xterm.js)     │
                          └─────────────┬────────────┘
                                        │ invoke / listen
       ╔════════════════════════════════╪════════════════════════════════╗
       ║                  Frontend (src/)                                ║
       ║                                                                   ║
       ║   app ───► service ───► model ───► infra ───► Tauri IPC           ║
       ║   (用例)    (编排)      (状态)   (适配)       (commands)          ║
       ╠════════════════════════════════╪════════════════════════════════╣
       ║                  Backend (src-tauri/src/)                        ║
       ║                                                                   ║
       ║   app ───► service ───► infra ───► model                          ║
       ║  (命令)   (业务逻辑)    (外部资源) (纯数据)                        ║
       ╚══════════════════════════════════════════════════════════════════╝
```

**通用依赖规则**：依赖只能**自上而下**。上层可调用下层，下层严禁反向引用上层。

## 2. 8 个分层的速查表

| 层 | frontend (`src/`) | backend (`src-tauri/src/`) | 职责一句话 |
|---|---|---|---|
| **app** | `app/useCases/`, `app/rules/`, `ui/` | `commands/` | 暴露给外部的入口（IPC、React 组件、用例编排）。最薄。 |
| **service** | `service/` | `services/` | 跨多个 model 的业务流程，把底层能力编排成用例。 |
| **model** | `model/` | `models/` | 纯数据 + 不变量 + 派生计算。无 I/O、无 UI、无 IPC。 |
| **infra** | `infra/` | `infrastructure/` | 与外部世界（PTY、SSH、tmux、Tauri API、store、clipboard）的适配层。 |

> **命名差异说明**：frontend 用 `app/model/service/infra` 简称，backend 沿用现状 `commands/services/infrastructure/models`。两层是**同一组语义**的不同名字。

## 3. 与已有文档的关系

- **不替代** [`dev/architecture/03-development-view.md`](../architecture/03-development-view.md)：那里描述**现状**代码怎么组织，本目录描述**目标态**应该如何组织。
- **不替代** [`dev/architecture/01-logical-view.md`](../architecture/01-logical-view.md)：那是 4+1 视图里的逻辑视图，关注运行时组件。
- **不替代** [`dev/architecture/06-tmux-runtime-architecture.md`](../architecture/06-tmux-runtime-architecture.md)：tmux 子系统专题文档，本目录只在 `backend/service/README.md` 给一个索引链接。
- **替代** `dev/roadmap/migration-prs.md` 里「架构目标态」相关条目：本目录是新的权威来源。

## 4. 阅读顺序建议

新人按这个顺序读，10 分钟建立完整心智模型：

1. 本 README（你正在读）
2. `backend/model/README.md` — 最底层纯数据，最容易看懂
3. `backend/infra/README.md` — 外部资源 trait
4. `backend/service/README.md` — 业务编排
5. `backend/app/README.md` — IPC 入口
6. `frontend/infra/README.md` — Tauri IPC 前端适配
7. `frontend/model/README.md` — 前端纯状态
8. `frontend/service/README.md` — 前端业务编排
9. `frontend/app/README.md` — 用例 + UI

## 5. 改进方向（为什么本目录会跟现状不同）

按用户要求，本目录设计**优于现状**。每个分层 README 末尾都列「改进方向」一节，主要改进方向集中在：

- **frontend service 与 model 边界模糊** — 现状 `service/` 有 hook、bridge、legacy 三种角色混在一起，目标态应当按 domain 拆分（见 `frontend/service/README.md`）。
- **backend commands 太大** — `commands/session.rs` 一个文件承担 24 个 tauri::command，目标是按 sub-domain 拆为 `commands/session/{local,ssh,tmux}_commands.rs`。
- **frontend model 已有但 service 还没完成 domain 拆分** — model 已经按 session/workspace/window/pane/tmux/persistence/output/theme 8 个 domain 落位，service 仍以单文件方式散落，需要对齐。
- **infra 层两侧都需要 trait 抽象** — backend 已经有 `PtySystem`/`SshBackend`/`TmuxBackend` trait（mockall 测试），frontend `infra/tauri/` 缺少统一的 Repository 接口，所有调用都直接 `invoke()`。

## 6. 维护规则

- 改任何一层代码前，先看对应 README 确认「约束」一节没被破坏。
- 新增一个 module 时，更新所在层 README 的「模块清单」。
- 改变依赖方向时，**必须**更新本目录对应 README 并通过 review —— 这违反架构约束。
