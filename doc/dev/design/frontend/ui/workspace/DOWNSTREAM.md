# Module · Workspace — 对下依赖接口

> **位置**：`src/ui/modules/workspace/`
> workspace 是中间层 module，依赖 terminal + session + shell 提供的 api。

## 1. 依赖图

```
modules/workspace/
├── api.ts    ────►  terminal/api.ts        (嵌入 <TerminalApp>)
├── view/    ────►  session/api.ts         (侧栏读 session 列表)
├── view/    ────►  shell/api.ts           (UI 原子 <Button> <Icon>)
├── view/    ────►  shell/api.ts           (useAppShell().openDialog 触发 dialog)
├── store.ts ────►  session/api.ts         (订阅 session store)
├── store.ts ────►  shared/persistence     (load/save workspaces)
├── model.ts ────►  session/types          (跨 module 类型引用)
└── *.test.ts
```

**禁止**：

- ❌ `modules/workspace/` → `infra/`（任何路径）
- ❌ `modules/workspace/` → `app/`（UI 层不调 useCase——useCase 由 service 层 + model 模块编排）
- ❌ `modules/workspace/` → `modules/settings/`（settings 通过 props 注入）

## 2. terminal module

| 调用 | 来源 | 何时调 |
|---|---|---|
| `<TerminalApp>` | `terminal/api.ts` | `<TabContent>` 嵌入 |
| `TerminalTheme` 类型 | `terminal/api.ts` | 透传给 terminal |
| `useTerminal(sessionId)` | `terminal/api.ts` | 副作用场景（极少用） |

**关键**：workspace **不**知道 xterm 实例的存在。`<TabContent>` 内部把 sessionId / paneTree 传给 `<TerminalApp>`，剩下的渲染由 terminal 自己负责。

## 3. session module

| 调用 | 来源 | 何时调 |
|---|---|---|
| `<CreateSessionDialog>` 等 | `session/api.ts` | 通过 shell dialog 触发（**不**直接渲染） |
| `useSessionStore()` 订阅 | `session/api.ts` | 侧栏读 session 列表 |
| `Session` / `PersistedSessionConfig` 类型 | `session/api.ts` | 侧栏列表项类型 |
| session open / rename / close 操作 | `session/api.ts` 的 hook | `useWorkspaceApi()` 内部编排 |

**关键**：workspace 想"打开一个 session"是**调 session module 的 hook**，而不是 workspace 内部实现——这样 session 模块可以独立演进（加 display config、auto-attach 等）。

## 4. shell module

| 调用 | 来源 | 何时调 |
|---|---|---|
| `<Icon>` `<Button>` `<Tooltip>` | `shell/api.ts` | 侧栏 / tab bar 的按钮 |
| `useAppShell()` | `shell/api.ts` | 触发 dialog |
| shell 不持有的 state | （不调用） | workspace 自己 store 管自己 |

**dialog 编排流程**：

```
侧栏 SessionList 点击"新建"按钮
    ↓
const shell = useAppShell();
shell.openDialog({ kind: "createSession", payload: { workspaceId: ws.id } });
    ↓
shell 内部根据 activeDialog.kind 渲染 <CreateSessionDialog>（由 session 模块提供）
    ↓
用户提交 → session module 的 onSubmit 回调
    ↓
回调内调 useWorkspaceApi().openSession(...) 把 session 装到当前 window
    ↓
shell 自动 closeDialog
```

## 5. 平级层（infra / service / model）

| 调用 | 来源 | 何时调 |
|---|---|---|
| 持久化 save/load workspace | `service/persistence` | `useWorkspaceApi().saveWorkspace` |
| 持久化 save/load groups | `service/persistence` | group CRUD |
| Workspace / Window / Group 类型 | `model/workspace` | store schema |
| session store | `service/session/store` | 订阅 session 列表变化 |

## 6. 设计意图：workspace 为什么包含 sidebar

sidebar 归 workspace：

- **sidebar 在认知上属于 workspace**——它是 workspace 的视觉组成（打开 app 主视图 = workspace + sidebar）
- **sidebar 的所有操作（rename session / delete group）都是 workspace 业务**——抽出来要跨 module 协调
- **workspace 跟 sidebar 共享 store**——抽出来要双 store 同步

如果未来 sidebar 演化成"独立导航栏"（比如多 workspace 切换器），再抽独立 module。

## 7. 不允许的依赖

- ❌ `modules/workspace/` → `modules/terminal/` 内部组件（必须走 `api.ts`）
- ❌ `modules/workspace/` → `modules/session/` 内部 dialog（必须走 `api.ts` + shell dialog 编排）
- ❌ `modules/workspace/` → `infra/` 任何路径
- ❌ `modules/workspace/view/*` 被其他 feature module 直接 import

## 9. 依赖变更流程

1. **terminal api.ts 变化**——同步更新 INTERFACE.md §2 + §4
2. **session api.ts 新增 hook**——影响 `useWorkspaceApi().openSession` 实现，更新 §3
3. **shell 新增 DialogDescriptor 类型**——同步更新 §4 dialog 编排流程
4. **service/persistence 接口变化**——更新 §5
