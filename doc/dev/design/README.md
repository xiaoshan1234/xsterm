# 设计 (Design) — 目标态架构地图

> 本目录描述 xsterm 的**目标态架构**。
> 它不是代码现状的镜像，而是基于现状设计改进的蓝图。代码改造按各层 README 末尾的「改进方向」一节推进。

## 1. 全景

frontend 是 **5 个并列的顶层目录**，没有"上层下层"——它们是**正交**的 5 大关注点：

```
                          ┌──────────────────────────┐
                          │      Tauri WebView       │
                          │   (React + xterm.js)     │
                          └─────────────┬────────────┘
                                        │ invoke / listen
       ╔════════════════════════════════╪════════════════════════════════╗
       ║                  Frontend (src/) — 5 个并列顶层                    ║
       ║                                                                   ║
       ║   ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌──────────┐ ║
       ║   │   app    │  │   ui     │  │  model   │  │ service  │  │  infra   │ ║
       ║   │ 业务编排  │  │ 视图渲染  │  │ 数据+算法 │  │ 运行时   │  │ 物理适配 │ ║
       ║   │ 5 module │  │ 5 module │  │ 8 domain │  │ 8 domain │  │ IPC/store│ ║
       ║   └────┬─────┘  └────┬─────┘  └────▲─────┘  └────▲─────┘  └────▲─────┘ ║
       ║        │             │            │             │             │        ║
       ║        └─────────────┴────────────┴─────────────┴─────────────┘        ║
       ║                          都被 app 和 ui 调用                          ║
       ╠════════════════════════════════╪════════════════════════════════╣
       ║                  Backend (src-tauri/src/) — 4 层架构                 ║
       ║                                                                   ║
       ║   app ───► service ───► infra ───► model                          ║
       ║  (命令)   (业务逻辑)    (外部资源) (纯数据)                        ║
       ╚══════════════════════════════════════════════════════════════════╝
```

**前端 5 个顶层目录的关注点**：

| 目录 | 关注点 | 例子 |
|---|---|---|
| `app/` | 业务编排（5 module） | `createLocalSession()`、`splitPane()` |
| `ui/` | 视图渲染（5 module） | `<Terminal>`、`<Sidebar>`、`<SettingsDrawer>` |
| `model/` | 数据 + 算法（按 domain 拆，含 rules） | `Session` 类型、`paneTree` 算法 |
| `service/` | 运行时状态 + IPC 桥（按 domain 拆） | session store、output channel |
| `infra/` | 物理适配（Tauri / store / clipboard） | invoke 封装、listen 适配 |

**依赖关系**：

```
app  ──►  ui     (UI 通过 useXxxApi() hook 调 app 的业务能力)
 │     │
 └──┬──┘
    ├──►  model      (读 types + 调 accessor/rules)
    ├──►  service    (读写 store + 调 IPC 桥)
    └──►  infra      (调 IPC 封装 — 实际只有 service 间接调)
```

**通用依赖规则**：

- **app ↔ ui**：ui 通过 `useXxxApi()` 调 app；app **不** import ui 内部组件
- **app / ui → model**：自由 import（types + 派生 + rules）
- **app / ui → service**：通过 service 的 api.ts 边界
- **app / ui → infra**：**禁止直跳**，必须经过 service
- **model → 任何**：禁止（model 是最底层）
- **service → infra**：允许（service 是 IPC 桥）
- **service → model**：允许（service 持有 model 实例）

## 2. 5 个顶层目录的速查表

| 层 | 目录 | 职责一句话 | 谁依赖它 |
|---|---|---|---|
| **app** | `app/modules/` | 业务编排：5 个 module 按产品功能切分 | ui（通过 hook） |
| **ui** | `ui/modules/` | 视图渲染：5 个 module 按产品功能切分 | app 不依赖 ui |
| **model** | `model/` | 纯数据 + 派生 + 算法（含 rules） | app / ui / service |
| **service** | `service/` | 跨 module 状态 + IPC 桥 | app / ui |
| **infra** | `infra/` | 物理适配（唯一允许 `@tauri-apps/api`） | service（间接被 app/ui 调） |

## 3. 各层 README 索引

### Frontend（5 个顶层目录）

- [`frontend/README.md`](frontend/README.md) — frontend 顶层架构图
- [`frontend/app/README.md`](frontend/app/README.md) — 业务编排层（5 module × 3 文档）
- [`frontend/ui/README.md`](frontend/ui/README.md) — 视图层（5 module × 3 文档）
- [`frontend/model/README.md`](frontend/model/README.md) — 数据 + 算法层
- [`frontend/service/README.md`](frontend/service/README.md) — 运行时层
- [`frontend/infra/README.md`](frontend/infra/README.md) — 物理适配层

### Backend（4 层架构，独立）

- [`backend/README.md`](backend/README.md) — backend 顶层
- [`backend/app/README.md`](backend/app/README.md) — commands 层
- [`backend/service/README.md`](backend/service/README.md) — 业务编排
- [`backend/infra/README.md`](backend/infra/README.md) — 外部资源
- [`backend/model/README.md`](backend/model/README.md) — 纯数据

## 4. 阅读顺序建议

新人按这个顺序读，10 分钟建立完整心智模型：

1. 本 README（你正在读）
2. `frontend/model/README.md` — 纯数据 + 算法，最容易看懂
3. `frontend/service/README.md` — 运行时状态
4. `frontend/infra/README.md` — 物理适配
5. `frontend/app/README.md` — 业务编排（5 module）
6. `frontend/ui/README.md` — 视图渲染（5 module）

## 5. 关键设计决策

### 5.1 为什么 frontend 不是严格的 4 层架构

现状 frontend 是 `app → service → model → infra` 的 4 层结构。新设计改成 5 个并列顶层（app / ui / model / service / infra），理由：

- **ui 跟 app 同级**——UI 也是产品功能（5 module），不是 app 的"渲染层"
- **model / service / infra 都独立**——3 个关注点正交（数据 / 运行时 / 物理）
- **依赖方向清晰**——app/ui 都依赖 model/service，infra 通过 service 间接被调用

### 5.2 为什么 rules 并入 model

v3 设计里 rules 是 `app/rules/` 独立目录。v4 改成 `model/<domain>/rules.ts`，理由：

- **rules 是算法，算法是 model 的派生**——跟 accessor 同类
- **paneTree 操作 PaneNode**——跟 PaneNode 类型同目录更内聚
- **sessionRules 操作 Session**——跟 Session 类型同目录更内聚
- **跨 domain 的纯函数**（textTransform、constants）放 `model/common/`
- **app 不再持有 rules 目录**——app 只负责编排业务

### 5.3 为什么 app 和 ui 各有 5 个 module

**app 5 module** 跟 **ui 5 module** **一一对应**：

| app module | ui module | 产品功能 |
|---|---|---|
| app/shell | ui/shell | app 启动 + 窗口 shell |
| app/workspace | ui/workspace | 主视图（workspace + tab + 侧栏） |
| app/terminal | ui/terminal | 终端渲染 + tmux |
| app/session | ui/session | session CRUD |
| app/settings | ui/settings | 设置 |

**改一个产品功能 = 改 1 个 app module + 1 个 ui module**。

### 5.4 为什么 service/infra 跟 app/ui 平级而不是下层

v3 设计里 service/infra 是 app/ui 的"下层"。新设计改成平级，理由：

- **service/infra 是基础设施**——它们不参与业务，但被多个 module 共享
- **平级表达"基础设施层"的独立地位**——service 改 store schema 不应该改 app/ui 的代码
- **依赖方向仍然单向**——app/ui → service/infra，但 service/infra 不依赖 app/ui

## 6. 改进方向

每个分层 README 末尾都列「改进方向」一节。主要改进方向：

- **frontend service 跟 model 边界模糊** — 现状 `service/` 有 hook、bridge、legacy 三种角色混在一起，目标态按 domain 拆分
- **backend commands 太大** — `commands/session.rs` 一个文件承担 24 个 tauri::command，目标是按 sub-domain 拆
- **frontend model 已有但 service 还没完成 domain 拆分** — model 已经按 8 个 domain 落位，service 仍以单文件方式散落
- **infra 层两侧都需要 trait 抽象** — backend 已经有 `PtySystem`/`SshBackend`/`TmuxBackend` trait，frontend `infra/tauri/` 缺少统一的 Repository 接口

## 7. 维护规则

- 改任何一层代码前，先看对应 README 确认「约束」一节没被破坏
- 新增一个 module 时，更新所在层 README 的「模块清单」
- 改变依赖方向时，**必须**更新本目录对应 README 并通过 review —— 这违反架构约束
- **app module 跟 ui module 改一个就改两个**——保持 5 ↔ 5 对应
