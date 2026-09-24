# Module · App Workspace — 对下依赖接口

> **位置**：`src/app/modules/workspace/`

## 1. 依赖图

```
modules/workspace/
├── api.ts    ────►  app/session/api.ts             (openSession 跨 module)
├── api.ts    ────►  app/terminal/api.ts            (tmux split 跨 module)
├── usecases/ ────►  shared/infra/api.ts            (invoke create_window / close_window 等)
├── usecases/ ────►  shared/service/workspace/store (workspace / window / pane 树状态)
├── usecases/ ────►  shared/service/persistence    (save / load workspace)
├── usecases/ ────►  shared/service/settings       (sidebar 宽度 / 可见性)
└── model.ts  ────►  shared/model/workspace
```

## 2. app/session

| 调用 | 来源 | 何时调 |
|---|---|---|
| `useSessionApi().openInWorkspace(...)` | `app/session/api.ts` | splitPane / createWindow 时 |

**关键**：workspace 通过 `useSessionApi()` 调 session，不直接 import session 内部。

## 3. app/terminal

| 调用 | 来源 | 何时调 |
|---|---|---|
| `useTerminalApi().attachTmuxSession(sessionId)` | `app/terminal/api.ts` | tmux session 装到 pane |
| `useTerminalApi().createTmuxPane(...)` | `app/terminal/api.ts` | tmux session split pane |
| `useTerminalApi().capturePaneContent(...)` | `app/terminal/api.ts` | pane 内容查询 |

## 4. shared/infra

| 调用 | 来源 | 何时调 |
|---|---|---|
| `infra.invoke('create_window', ...)` | `shared/infra/api.ts` | createWindow |
| `infra.invoke('close_window', ...)` | `shared/infra/api.ts` | closeWindow |
| `infra.invoke('rename_window', ...)` | `shared/infra/api.ts` | renameWindow |
| `infra.invoke('reorder_windows', ...)` | `shared/infra/api.ts` | reorderWindows |
| `infra.invoke('save_workspace', ...)` | `shared/infra/api.ts` | saveWorkspace |
| `infra.invoke('load_workspace', ...)` | `shared/infra/api.ts` | loadWorkspace |

## 5. shared/service/

| 调用 | 来源 | 何时调 |
|---|---|---|
| workspace tree store | `shared/service/workspace/store` | usecases |
| pane tree 状态 | `shared/service/workspace/paneStore` | splitPane / closePane |
| 持久化 save / load | `shared/service/persistence` | saveWorkspace / loadWorkspace |
| sidebar 宽度 / 可见性 | `shared/service/settings` | applySidebarConfig |

## 6. shared/model/

| 调用 | 来源 |
|---|---|
| `Workspace` / `Window` / `Group` / `PaneNode` | `shared/model/workspace` |
| `SplitDirection` | `shared/model/terminal` |
| `PersistedWorkspace` | `shared/model/persistence` |

## 7. shared/rules/

| 调用 | 来源 | 何时调 |
|---|---|---|
| `paneTree.createLeafPane` | `shared/rules/paneTree.ts` | createInitWindow / splitPane |
| `paneTree.createSplitNode` | `shared/rules/paneTree.ts` | splitPane |
| `paneTree.findPaneNode` | `shared/rules/paneTree.ts` | closePane / resizePane |
| `paneTree.replacePaneNode` | `shared/rules/paneTree.ts` | replaceInitWindow |
| `sessionRules.getUniqueWindowName` | `shared/rules/sessionRules.ts` | createWindow |
| `sessionRules.assertSessionNotUsedElsewhere` | `shared/rules/sessionRules.ts` | replaceInitWindow |
| `workspaceRules.sortWorkspaces` | `shared/rules/workspaceRules.ts` | render |

## 8. 设计意图：workspace 编排最复杂

workspace module 是 app 层**最复杂**的 module：

- 它有 4 个子域（workspace / window / pane / group）
- 它编排最多 useCase（30+）
- 它调用 3 个其他 app module（session / terminal / settings）
- 它调用 4 个 shared 子目录（infra / service / model / rules）

**应对复杂性的策略**：

1. **usecases/ 按子域分子目录**（workspace/ window/ pane/ group/ persistence/）
2. **每个 useCase 一个文件**——>100 行的拆 2 个 useCase
3. **跨 module 协调单独成文件**——openSession.ts / replaceInitWindow.ts
4. **跨 module 调用通过 api.ts**——不直接 import 兄弟 module 内部

## 9. 当前架构债 → 设计意图说明

| 旧 v3 现状 | 新设计意图 |
|---|---|
| `createTmuxWindow` 是独立 useCase（跨 session + window） | 归 workspace 的 `window/create.ts`（跨 module 通过 api.ts 编排） |
| `replaceInitWindowWithSession` 是独立 useCase | 归 workspace 的 `window/create.ts` |
| `saveWindow` / `loadWindow` / `deleteSavedWindow` 是 3 个独立 useCase | 归 workspace 的 `persistence/savedWindow.ts` |
| `paneTreeRules.ts` 是独立文件 | 归 `shared/rules/paneTree.ts`（跨 module 共享） |

## 10. 不允许的依赖

- ❌ `modules/workspace/` → `app/session/usecases/*` 或 `app/terminal/usecases/*`（必须走 api.ts）
- ❌ `modules/workspace/` → `infra/` 直接（必须经过 shared/infra）
- ❌ `modules/workspace/` → `shared/rules/*` 内部文件（必须经过 shared/rules/api.ts）

## 11. 依赖变更流程

1. **新增 useCase** → 加 usecases + api.ts + 更新 §4
2. **backend 新增 IPC** → 加 shared/infra/commands + 加 usecases 调用
3. **新增 pane 操作** → 加 usecases/pane/ + 加 api.ts 方法
4. **新增 group 操作** → 加 usecases/group/ + 加 api.ts 方法
5. **shared/rules/paneTree 算法变化** → 同步更新 §7
