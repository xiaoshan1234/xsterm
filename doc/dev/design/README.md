# 设计 (Design) — 目标态架构地图

| 本目录描述 xsterm 的**目标态架构**。现状代码按各层 README 末尾的「现状 → 目标」一节映射改造。|

## 1. 全景

frontend 是 **5 个并列的顶层目录**，没有"上层下层"——它们是**正交**的 5 大关注点：

```
                          ┌──────────────────────────┐
                          │      Tauri WebView       │
                          │   (React + xterm.js)     │
                          └─────────────┬────────────┘
                                        │ invoke / listen
       ╔════════════════════════════════╪════════════════════════════════╗
       ║              Frontend (src/) — 5 个并列顶层目录                ║
       ║                                                                   ║
       ║   ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌──────────┐ ║
       ║   │   app    │  │   ui     │  │  model   │  │ service  │  │  infra   │ ║
       ║   │ 业务编排  │  │ 视图渲染  │  │ 数据+算法 │  │ 运行时   │  │ 物理适配 │ ║
       ║   │ 5 module │  │ 5 module │  │ 5+cc     │  │ 6 domain │  │ 4 子模块 │ ║
       ║   └────┬─────┘  └────┬─────┘  └────▲─────┘  └────▲─────┘  └────▲─────┘ ║
       ║        │             │            │             │             │        ║
       ║        └─────────────┴────────────┴─────────────┴─────────────┘        ║
       ║                       都被 app 和 ui 调用                            ║
       ╠════════════════════════════════╪════════════════════════════════╣
       ║              Backend (src-tauri/src/) — 4 层架构                    ║
       ║                                                                   ║
       ║   app ───► service ───► infra ───► model                          ║
       ║  (命令)   (业务逻辑)    (外部资源) (纯数据)                        ║
       ╚══════════════════════════════════════════════════════════════════╝
```

**前端 5 个顶层目录的关注点**：

| 目录 | 关注点 | 子结构数 | 子结构 |
|---|---|---|---|
| `app/` | 业务编排 | 5 module | shell / workspace / terminal / session / settings |
| `ui/` | 视图渲染 | 5 module | shell / workspace / terminal / session / settings |
| `model/` | 纯数据 + 算法 | 5 + cross-cutting | session / workspace / tmux / settings / cross-cutting |
| `service/` | 跨 module 状态 + IPC 桥 | 6 domain | session / workspace / tmux / settings / persistence |
| `infra/` | 物理适配 | 4 子模块 | tauri / store / clipboard / logger |

**依赖关系**：

```
app  ──►  ui     (UI 通过 useXxxApi() hook 调 app 的业务能力)
 │     │
 └──┬──┘
    ├──►  model      (读 types + 调 accessor/rules)
    ├──►  service    (读写 store + 调 IPC 桥)
    └──►  infra      (调 IPC 封装 — 实际只有 service 间接调；ui 可以直跳 clipboard/logger)
```

**通用依赖规则**：

- **app ↔ ui**：ui 通过 `useXxxApi()` 调 app；app **不** import ui 内部组件
- **app / ui → model**：自由 import（types + 派生 + rules）
- **app / ui → service**：通过 service 的 api.ts 边界
- **app / ui → infra**：**禁止直跳 infra/tauri**；**特例**：ui 可以直跳 `infra/clipboard` 和 `infra/logger`
- **model → 任何**：禁止（model 是最底层）
- **service → infra**：允许（service 是 IPC 桥）
- **service → model**：允许（service 持有 model 实例）

## 2. 5 个顶层目录的速查表

| 层 | 目录 | 职责一句话 | 子结构 |
|---|---|---|---|
| **app** | `app/modules/` | 业务编排：5 module 按产品功能切分 | shell / workspace / terminal / session / settings |
| **ui** | `ui/modules/` | 视图渲染：5 module 按产品功能切分 | shell / workspace / terminal / session / settings |
| **model** | `model/` | 纯数据 + 派生 + 算法（含 rules） | session / workspace / tmux / settings / cross-cutting |
| **service** | `service/` | 跨 module 状态 + IPC 桥 | session / workspace / tmux / settings / persistence |
| **infra** | `infra/` | 物理适配（唯一允许 `@tauri-apps/api`） | tauri / store / clipboard / logger |

### app ↔ ui 5 ↔ 5 对应表

| app module | ui module | 产品功能 |
|---|---|---|
| `app/shell` | `ui/shell` | app 启动序列 + 窗口 shell |
| `app/workspace` | `ui/workspace` | 主视图（workspace + tab + 侧栏） |
| `app/terminal` | `ui/terminal` | 终端渲染 + tmux |
| `app/session` | `ui/session` | session CRUD |
| `app/settings` | `ui/settings` | 设置 |

**改一个产品功能 = 改 1 个 app module + 1 个 ui module**。

### model ↔ service 对应表

| model domain | 对应 service domain |
|---|---|
| `model/session` | `service/session` |
| `model/workspace`（含 pane） | `service/workspace` |
| `model/tmux` | `service/tmux` |
| `model/settings`（含 terminal） | `service/settings` |
| `model/cross-cutting` | （无对应 service——被所有 domain 用）|
| （无对应 model） | `service/persistence`（generic wrapper） |

**算法归 model，状态归 service**——`paneTree` 算法在 `model/workspace/rules/paneTree.ts`，pane tree 状态在 `service/workspace/store.ts`。

### ui → infra 的特例

| ui 子模块 | 调用 infra | 理由 |
|---|---|---|
| `ui/dialogs` | `infra/clipboard` | 剪贴板是 UI 操作 |
| `ui/shell` | （窗口控制已归 ui 内部） | 窗口装饰是 shell 职责 |
| `ui/terminal` | （输出 buffer 已归 ui 内部） | 渲染队列是 UI 实现 |
| **任何 ui module** | `infra/logger` | logger 全局可用 |

**关键**：`ui → infra/tauri` 仍然**禁止**（必须经过 service）。

## 3. 各层 README 索引

### Frontend（5 个顶层目录 + 5 + cross-cutting model + 6 service + 4 infra = 27 份 README）

#### app（5 module × 3 文档 = 16 份）

- [`frontend/README.md`](frontend/README.md) — frontend 顶层架构图
- [`frontend/app/README.md`](frontend/app/README.md) — 业务编排层
- [`frontend/app/shell/`](frontend/app/shell/) — 启动序列 + 关闭序列
  - [RESPONSIBILITY](frontend/app/shell/RESPONSIBILITY.md) / [INTERFACE](frontend/app/shell/INTERFACE.md) / [DOWNSTREAM](frontend/app/shell/DOWNSTREAM.md)
- [`frontend/app/workspace/`](frontend/app/workspace/) — 主视图业务
- [`frontend/app/terminal/`](frontend/app/terminal/) — 终端特有业务（tmux）
- [`frontend/app/session/`](frontend/app/session/) — session CRUD
- [`frontend/app/settings/`](frontend/app/settings/) — 设置持久化 + 应用
- [`frontend/app/shared/README.md`](frontend/app/shared/README.md) — **废弃占位**

#### ui（5 module × 3 文档 = 16 份）

- [`frontend/ui/README.md`](frontend/ui/README.md) — 视图层
- [`frontend/ui/shell/`](frontend/ui/shell/) — app 物理壳
- [`frontend/ui/workspace/`](frontend/ui/workspace/) — 主视图
- [`frontend/ui/terminal/`](frontend/ui/terminal/) — 终端渲染
- [`frontend/ui/session/`](frontend/ui/session/) — session UI（dialog + list）
- [`frontend/ui/settings/`](frontend/ui/settings/) — 设置 UI

每个 module 三份文档：RESPONSIBILITY / INTERFACE / DOWNSTREAM（详细链接见各 module README 内的"5 module 索引"表）。

#### model（5 + cross-cutting × 3 文档 = 16 份）

- [`frontend/model/README.md`](frontend/model/README.md) — 数据 + 算法层
- [`frontend/model/session/`](frontend/model/session/) — Session / SessionConfig / SessionDisplayConfig
- [`frontend/model/workspace/`](frontend/model/workspace/) — Workspace / Window / Group / PaneNode + paneTree 算法
- [`frontend/model/tmux/`](frontend/model/tmux/) — TmuxController / AttachedServer / TmuxPane / TmuxWindow
- [`frontend/model/settings/`](frontend/model/settings/) — Settings + 5 个 ANSI 调色板
- [`frontend/model/cross-cutting/`](frontend/model/cross-cutting/) — textTransform / constants / id（跨域纯函数）

每个 domain 三份文档：RESPONSIBILITY / INTERFACE / DOWNSTREAM。

#### service（6 domain × 3 文档 = 18 份）

- [`frontend/service/README.md`](frontend/service/README.md) — 运行时层
- [`frontend/service/session/`](frontend/service/session/) — session 元数据 store + IPC 桥
- [`frontend/service/workspace/`](frontend/service/workspace/) — workspace / window / pane 树 store
- [`frontend/service/tmux/`](frontend/service/tmux/) — backend tmux controller 镜像
- [`frontend/service/settings/`](frontend/service/settings/) — settings store
- [`frontend/service/persistence/`](frontend/service/persistence/) — tauri-plugin-store 业务 wrapper

每个 domain 三份文档：RESPONSIBILITY / INTERFACE / DOWNSTREAM。

#### infra（4 子模块 × 3 文档 + 顶层 = 13 份）

- [`frontend/infra/README.md`](frontend/infra/README.md) — 物理适配层
- [`frontend/infra/tauri/`](frontend/infra/tauri/) — IPC 适配（commands + events + repositories + eventBuses）
- [`frontend/infra/store/`](frontend/infra/store/) — tauri-plugin-store wrapper
- [`frontend/infra/clipboard/`](frontend/infra/clipboard/) — 剪贴板读写
- [`frontend/infra/logger/`](frontend/infra/logger/) — 日志（单例 + ring buffer + 转发）

每个子模块三份文档：RESPONSIBILITY / INTERFACE / DOWNSTREAM。

### Backend（4 层架构，独立）

- [`backend/README.md`](backend/README.md) — backend 顶层
- [`backend/app/README.md`](backend/app/README.md) — commands 层
- [`backend/service/README.md`](backend/service/README.md) — 业务编排
- [`backend/infra/README.md`](backend/infra/README.md) — 外部资源
- [`backend/model/README.md`](backend/model/README.md) — 纯数据

## 4. 阅读顺序建议

新人按这个顺序读，10 分钟建立完整心智模型：

1. 本 README（你正在读）
2. [`frontend/model/README.md`](frontend/model/README.md) — 纯数据 + 算法，最容易看懂
3. [`frontend/service/README.md`](frontend/service/README.md) — 运行时状态
4. [`frontend/infra/README.md`](frontend/infra/README.md) — 物理适配
5. [`frontend/app/README.md`](frontend/app/README.md) — 业务编排（5 module）
6. [`frontend/ui/README.md`](frontend/ui/README.md) — 视图渲染（5 module）

## 5. 关键设计决策

### 5.1 为什么 frontend 是 5 个并列顶层目录而不是严格 4 层

frontend 是 5 个并列顶层目录：

- **ui 跟 app 平级**——UI 也是产品功能（5 module），不是 app 的"渲染层"
- **model / service / infra 都独立**——3 个关注点正交（数据 / 运行时 / 物理）
- **依赖方向清晰**——app/ui 都依赖 model/service/infra，下层不反向依赖上层

### 5.2 为什么 rules 并入 model（不独立成 layer）

rules 在 `model/<domain>/rules.ts`：

- **rules 是算法，算法是 model 的派生**——跟 accessor 同类
- **paneTree 操作 PaneNode**——跟 PaneNode 类型同目录更内聚
- **sessionRules 操作 Session**——跟 Session 类型同目录更内聚
- **跨 domain 的纯函数**（textTransform、constants）放 `model/cross-cutting/`
- **app 不持有 rules 目录**——app 只负责编排业务

### 5.3 为什么 `model/cross-cutting/` 不叫 `common`

"common" 太宽泛——是"杂物桶"的代名词。`cross-cutting` 是 AOP 术语，精确描述"横切多个业务域"的角色。

跨域纯函数和值（textTransform / constants / id）不属于任何具体业务，但被多个 domain 共享——这是 cross-cutting 的语义。

### 5.4 为什么 service 6 domain 不是按 5 module 切

service 不能按 `app 5 module` 切——service 是基础设施层，按**数据归属**切而非按产品功能切：

- `service/persistence` 没有对应 service module——它是 generic IO wrapper
- `service/persistence` 没有对应 model——它是 wrapper，不是业务数据
- 横切关注点（settings、tmux、persistence）不是产品功能 module

### 5.5 为什么 app 和 ui 各有 5 module（一一对应）

**改一个产品功能 = 改 1 个 app module + 1 个 ui module**——保证产品功能变更的"原子性"。

### 5.6 为什么 model workspace 包含 pane 算法

pane 算法（createLeafPane / createSplitNode / splitPane / closePane / resizePane）跟 Window 紧耦合（每个 Window 含 rootPaneId），分开会让算法归属混乱。

**算法归 model，状态归 service**——算法在 `model/workspace/rules/paneTree.ts`，状态在 `service/workspace/store.ts`。

### 5.7 为什么 model settings 包含 terminal 调色板

5 个 ANSI 调色板是 settings 的视觉子集（`Settings.terminalThemeId` 引用 `TerminalTheme`）。Theme 概念不存在独立——它是 settings 字段之一。

### 5.8 为什么 service/infra 跟 app/ui 平级

平级表达"基础设施层"的独立地位。service 改 store schema 不应该改 app/ui 的代码。依赖方向仍然单向——app/ui → service/infra，但 service/infra 不依赖 app/ui。

### 5.9 为什么 infra 是 4 子模块不是更多

候选：tauri / store / clipboard / logger / buffers / window / themes / static。

调整后只剩 4 个：

| 候选 | 调整 | 理由 |
|---|---|---|
| `infra/tauri` | ✅ 保留 | IPC 适配核心 |
| `infra/store` | ✅ 保留 | tauri-plugin-store wrapper |
| `infra/clipboard` | ✅ 保留 | 全局工具 |
| `infra/logger` | ✅ 保留 | 全局命令式 API |
| `infra/buffers` | ❌ 归 `ui/terminal` | 只 terminal 用，是渲染队列 |
| `infra/window` | ❌ 归 `ui/shell` | 只 shell 用 |
| `infra/themes` | ❌ 归 `model/settings/terminal` | 调色板是 model 数据 |
| `infra/static` | ❌ 归 `ui` | CSS/icons 是 UI 关注点 |

## 6. 改进方向

每个分层 README 末尾都列「改进方向」一节。主要改进方向：

- **frontend service 跟 model 边界模糊** — 现状 `service/` 有 hook、bridge、legacy 三种角色混在一起，目标态按 domain 拆分
- **frontend model 已有但 service 还没完成 domain 拆分** — model 已经按 domain 落位，service 仍以单文件方式散落
- **infra 层两侧都需要 trait 抽象** — backend 已经有 `PtySystem`/`SshBackend`/`TmuxBackend` trait，frontend `infra/tauri/` 现在通过 `Repository` 接口统一
- **backend commands 太大** — `commands/session.rs` 一个文件承担 24 个 tauri::command，目标是按 sub-domain 拆

## 7. 维护规则

- 改任何一层代码前，先看对应 README 确认「约束」一节没被破坏
- 新增一个 module / domain 时，更新所在层 README 的「模块清单」
- 改变依赖方向时，**必须**更新本目录对应 README 并通过 review —— 这违反架构约束
- **app module 跟 ui module 改一个就改两个**——保持 5 ↔ 5 对应
- **model 跟 service 改一个就同步改另一个**——保持 schema 一致
- **frontend infra 跟 backend 改 IPC 契约要同步**——任意一边变化都要同步另一边

## 8. 设计文档总览

5 层架构的**全部设计文档**已就位：

### Frontend（5 顶层目录 + 78 份）

| 层 | 文档数 | 详情 |
|---|---|---|
| app | 16 | 5 module × 3 + 顶层 |
| ui | 16 | 5 module × 3 + 顶层 |
| model | 16 | 5 + cross-cutting × 3 + 顶层 |
| service | 16 | **5** domain × 3 + 顶层（session / workspace / tmux / settings / persistence） |
| infra | 13 | 4 子模块 × 3 + 顶层 |
| 顶层 README | 1 | `frontend/README.md` |
| **小计** | **78** | |

### Backend（4 层架构 + 61 份，无 ui 层）

| 层 | 文档数 | 详情 |
|---|---|---|
| app | 16 | 5 module × 3 + 顶层 |
| model | 16 | 5 + cross-cutting × 3 + 顶层 |
| service | 16 | 5 domain × 3 + 顶层 |
| infra | 13 | 4 子模块（pty / ssh / tmux / tauri）× 3 + 顶层 |
| 顶层 README | 0 | backend 顶层 README 占位待建 |
| **小计** | **61** | |

### 顶层与合计

| 来源 | 文档数 |
|---|---|
| 顶层 README | 1（本文件） |
| frontend 全部 | 78 |
| backend 全部 | 61 |
| **合计** | **140 份** |

每份子文档固定 3 节：**RESPONSIBILITY**（职责）/ **INTERFACE**（对外接口）/ **DOWNSTREAM**（对下依赖）。
