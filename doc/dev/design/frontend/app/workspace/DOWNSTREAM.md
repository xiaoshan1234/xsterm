# Module · App Workspace — 对下依赖接口

> **位置**：`src/app/modules/workspace/`

## 1. 依赖图

```
modules/workspace/
├── api.ts    ────►  app/session/api.ts             (openSession 跨 module)
├── api.ts    ────►  app/terminal/api.ts            (tmux split 跨 module)
├── usecases/ ────►  infra/tauri/commands/workspace (invoke create_window / close_window 等)
├── usecases/ ────►  service/workspace/store        (workspace / window / pane 树状态)
├── usecases/ ────►  service/persistence            (save / load workspace)
├── usecases/ ────►  service/settings               (sidebar 宽度 / 可见性)
└── model.ts  ────►  model/workspace/types
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

## 4. infra/tauri/commands/workspace

| 调用 | 来源 | 何时调 |
|---|---|---|
| `invoke('create_window', ...)` | `infra/tauri/commands/workspace/window` | createWindow |
| `invoke('close_window', ...)` | `infra/tauri/commands/workspace/window` | closeWindow |
| `invoke('rename_window', ...)` | `infra/tauri/commands/workspace/window` | renameWindow |
| `invoke('reorder_windows', ...)` | `infra/tauri/commands/workspace/window` | reorderWindows |
| `invoke('save_workspace', ...)` | `infra/tauri/commands/workspace/persistence` | saveWorkspace |
| `invoke('load_workspace', ...)` | `infra/tauri/commands/workspace/persistence` | loadWorkspace |

## 5. service/

| 调用 | 来源 | 何时调 |
|---|---|---|
| workspace tree store | `service/workspace/store` | usecases |
| pane tree 状态 | `service/workspace/paneStore` | splitPane / closePane |
| 持久化 save / load | `service/persistence/api` | saveWorkspace / loadWorkspace |
| sidebar 宽度 / 可见性 | `service/settings/api` | applySidebarConfig |

## 6. model/

| 调用 | 来源 |
|---|---|
| `Workspace` / `Window` / `Group` / `PaneNode` | `model/workspace/types` |
| `SplitDirection` | `model/workspace/types`（pane 算法归属 workspace） |
| `PersistedWorkspace` | `model/workspace/types`（持久化结构内嵌 workspace） |

## 7. model/workspace/rules/

| 调用 | 来源 | 何时调 |
|---|---|---|
| `paneTree.createLeafPane` | `model/workspace/rules/paneTree.ts` | createInitWindow / splitPane |
| `paneTree.createSplitNode` | `model/workspace/rules/paneTree.ts` | splitPane |
| `paneTree.findPaneNode` | `model/workspace/rules/paneTree.ts` | closePane / resizePane |
| `paneTree.replacePaneNode` | `model/workspace/rules/paneTree.ts` | replaceInitWindow |
| `sessionRules.getUniqueWindowName` | `model/session/rules.ts` | createWindow |
| `sessionRules.assertSessionNotUsedElsewhere` | `model/session/rules.ts` | replaceInitWindow |
| `workspaceRules.sortWorkspaces` | `model/workspace/rules/workspace.ts` | render |

## 8. 设计意图：workspace 编排最复杂

workspace module 是 app 层**最复杂**的 module：

- 它有 4 个子域（workspace / window / pane / group）
- 它编排最多 useCase（30+）
- 它调用 3 个其他 app module（session / terminal / settings）
- 它调用 3 个平级层（infra / service / model）

**应对复杂性的策略**：

1. **usecases/ 按子域分子目录**（workspace/ window/ pane/ group/ persistence/）
2. **每个 useCase 一个文件**——>100 行的拆 2 个 useCase
3. **跨 module 协调单独成文件**——openSession.ts / replaceInitWindow.ts
4. **跨 module 调用通过 api.ts**——不直接 import 兄弟 module 内部
5. **算法归 model/rules/**——paneTree / sessionRules / workspaceRules 都是纯函数

## 9. 不允许的依赖

- ❌ `modules/workspace/` → `app/session/usecases/*` 或 `app/terminal/usecases/*`（必须走 api.ts）
- ❌ `modules/workspace/` → `infra/` 直接（必须经过 `infra/tauri/commands/workspace`）

## 10. 依赖变更流程

1. **新增 useCase** → 加 usecases + api.ts + 更新 §4
2. **backend 新增 IPC** → 加 `infra/tauri/commands/workspace/<子域>` + 加 usecases 调用
3. **新增 pane 操作** → 加 `usecases/pane/` + 加 api.ts 方法
4. **新增 group 操作** → 加 `usecases/group/` + 加 api.ts 方法
5. **`model/workspace/rules/paneTree` 算法变化** → 同步更新 §7