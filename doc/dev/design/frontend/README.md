# Frontend · 顶层架构

> **位置**：`src/` 下的 5 个并列顶层目录
> **关注点**：5 个正交的关注点——业务编排 / 视图渲染 / 数据 / 运行时 / 物理适配

## 1. 5 个顶层目录

```
src/
├── app/             业务编排（5 module 按产品功能切分）
├── ui/              视图渲染（5 module 按产品功能切分）
├── model/           数据 + 算法（含 rules，8 domain）
├── service/         运行时状态 + IPC 桥（按 domain 拆）
└── infra/           物理适配（唯一允许直跳 @tauri-apps/api）
```

## 2. 各层职责

### 2.1 `app/` — 业务编排

5 个 module 按产品功能切分（跟 ui 5 module 一一对应）：

| module | 产品功能 |
|---|---|
| `app/shell` | app 启动序列 + 关闭序列 |
| `app/workspace` | workspace + window + pane + group CRUD |
| `app/terminal` | tmux + terminal preferences |
| `app/session` | session CRUD + display config |
| `app/settings` | 设置持久化 + 跨 module 应用 |

详见 [`app/README.md`](app/README.md)

### 2.2 `ui/` — 视图渲染

5 个 module 按产品功能切分（跟 app 5 module 一一对应）：

| module | 产品功能 |
|---|---|
| `ui/shell` | app 物理壳（标题栏 + 布局 + UI 原子） |
| `ui/workspace` | 主视图（工作区 + tab + 侧栏） |
| `ui/terminal` | 终端渲染（xterm + pane + tmux） |
| `ui/session` | session CRUD UI（dialog + list） |
| `ui/settings` | 设置 UI（5 tab 抽屉） |

详见 [`ui/README.md`](ui/README.md)

### 2.3 `model/` — 数据 + 算法

按 domain 拆分子目录，每个 domain 5 个文件：

```
model/
├── session/         types + repository + events + accessor + rules
├── workspace/        types + repository + events + accessor + rules
├── terminal/         types + repository + events + accessor + rules
├── persistence/      types + repository + events + accessor + rules
├── settings/         types + repository + events + accessor + rules
├── tmux/             types + repository + events + accessor + rules
├── output/           types + repository + events + accessor + rules
├── theme/            types + repository + events + accessor + rules
└── common/           跨 domain 纯函数（textTransform、constants）
```

详见 [`model/README.md`](model/README.md)

### 2.4 `service/` — 运行时状态

按 domain 拆分，每个 domain 一个 store + api.ts：

```
service/
├── session/          session store（跨 module 状态）
├── workspace/        workspace / window / pane 树 store
├── output/           输出缓冲 + channel
├── theme/            主题切换
├── persistence/      持久化 store
├── logger/           前端日志 → backend
├── settings/         settings store
└── terminal/         terminal preferences store
```

详见 [`service/README.md`](service/README.md)

### 2.5 `infra/` — 物理适配

**唯一允许直跳 `@tauri-apps/api` 的地方**：

```
infra/
├── tauri/            IPC 适配
│   ├── commands/     invoke 封装
│   ├── events/       listen 封装
│   ├── repositories/ Repository 接口实现
│   └── eventBuses/   事件总线
├── store/            本地持久化（tauri-plugin-store）
├── clipboard/        剪贴板读写
├── buffers/          输出帧缓冲
├── logger/           前端 logger
├── icons/            Icon 组件
└── styles/           设计系统 CSS
```

详见 [`infra/README.md`](infra/README.md)

## 3. 依赖方向

```
app  ──►  ui     (UI 通过 useXxxApi() hook 调 app)
 │     │
 └──┬──┘
    ├──►  model      (读 types + 调 accessor + 调 rules)
    ├──►  service    (读写 store + 调 IPC 桥)
    └──►  infra      (实际只有 service 间接调；app/ui 不直跳)
```

**详细规则**：

- **app ↔ ui**：ui 通过 `useXxxApi()` 调 app；app **不** import ui 内部组件
- **app / ui → model**：自由 import
- **app / ui → service**：通过 service 的 api.ts 边界
- **app / ui → infra**：**禁止直跳**，必须经过 service
- **model → 任何**：禁止（model 是最底层）
- **service → infra / model**：允许
- **infra → 任何**：禁止（infra 只依赖 `@tauri-apps/api`）

## 4. 跟现状的对应

| v4 设计目录 | 现状对应 |
|---|---|
| `app/` | 现状 `src/app/`（含 `useCases/` `rules/`） |
| `ui/` | 现状 `src/ui/` |
| `model/` | 现状 `src/model/`（已经是顶层） |
| `service/` | 现状 `src/service/`（已经是顶层） |
| `infra/` | 现状 `src/infra/`（已经是顶层） |

**目录结构不变**——v4 是把现状的 5 个顶层目录"重新解释"为正交的 5 层架构。模型层文档升级，业务编排和视图层按 5 module 重构。

## 5. 关键设计决策

### 5.1 rules 并入 model

rules 在 `model/<domain>/rules.ts`：

- **paneTree 操作 PaneNode**——跟 PaneNode 类型同目录更内聚
- **sessionRules 操作 Session**——跟 Session 类型同目录更内聚
- **跨 domain 的纯函数**（textTransform、constants）放 `model/cross-cutting/`
- **app 不持有 rules 目录**——app 只负责编排业务

### 5.2 app 和 ui 各有 5 个 module

5 ↔ 5 对应关系——改一个产品功能 = 改 1 个 app module + 1 个 ui module。

### 5.3 service/infra 跟 app/ui 平级

平级表达"基础设施层"的独立地位。service 改 store schema 不应该改 app/ui 的代码。

### 5.4 每个 module 强制 api.ts 入口

app/<module>/api.ts、ui/<module>/api.ts、service/<domain>/api.ts 都是**唯一对外入口**。其他 module **禁止**直接 import 内部文件。

## 6. 跨层关键流程

### 6.1 用户新建 session → 装到 workspace

```
ui/session: 用户点"新建"，调 useSessionApi()
    ↓
app/session/usecases/createLocal.ts
    ↓
1. service/infra.invoke('create_local_session', config)  → backend 启动 PTY
2. service/session/store 写入新 session
3. 如果 shouldSave: service/persistence 写入 saved config
    ↓
4. app/session/usecases/openInWorkspace.ts
   → app/workspace/api.ts 的 openSession()
    ↓
5. app/workspace/usecases/openSession.ts
   → 如果 tmux: app/terminal/api.ts 的 attachTmuxSession()
   → service/workspace/store 更新 pane 树
    ↓
ui/workspace: workspace store 变化 → React re-render → pane 显示 terminal
```

### 6.2 启动 app

```
ui/shell/App.tsx → main.tsx 调 useShellApi().initialize()
    ↓
app/shell/usecases/initialize.ts 按顺序：
    ↓
1. service/infra.checkBackendReady()
2. app/settings.load() → applyTheme / applyLogLevel / applyTerminalPreferences / applySidebarConfig
3. app/workspace.loadLastWorkspace()
4. app/terminal.autoAttachTmuxServers()
5. readiness.setReady(true)
    ↓
ui/shell: isReady() = true → 渲染主界面
```

## 7. 设计系统约束

所有 UI 改动必读 [`../../../design-system.md`](../../../design-system.md)。

三层校验 grep（pre-commit 必跑）：

```bash
grep -rn -E "(--bg-primary|--bg-secondary|--bg-tertiary|--text-primary|--text-secondary|--text-muted|--border-color|#0e639c|#1177bb|linear-gradient)" src/ --include="*.ts" --include="*.tsx" --include="*.css"
grep -rn "font-weight: ?(600|700|bold)" src/ --include="*.ts" --include="*.tsx" --include="*.css"
grep -rn "box-shadow:" src/components/ --include="*.css"
```

违反任何一条不允许 merge。
