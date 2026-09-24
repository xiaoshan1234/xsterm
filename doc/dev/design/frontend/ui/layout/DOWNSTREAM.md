# Module · Layout — 对下依赖接口

> **位置（目标态）**：`src/ui/layout/`
>
> 本文档描述 Layout module **调用的下层接口**。

## 1. 依赖图

```
ui/layout/  ──►  ui/terminal/                  (Terminal + WindowTabBar)
             ──►  ui/sidebar/                  (Sidebar)
             ──►  ui/ui-kit/settings/          (SettingsView 抽屉)
             ──►  ui/ui-kit/dialogs/           (31 dialogs，通过 useAppShell 注入)
             ──►  ui/hooks/                    (useCommandExecutor 等编排 hook)
             ──►  app/modules/workspace/persistence/  (启动时加载会话)
             ──►  service/                     (workspace / session / persistence / theme store)
             ──►  model/                       (Workspace / Session / Settings types)
             ──►  infra/                       (window control — 唯一允许直跳 infra 的 module)
```

**调用统计（基于现状 grep）**：

layout 散落 src/ui/ 顶层的 5 个文件共：
- `model` × 43（最重）
- `service` × 40
- `primitives` × 24
- `icons` × 6
- `app` × 5（**应清理为 0**，详见 §6）
- `infra` × 4（**唯一允许直跳 infra 的 module**，window control 需要）
- `dialogs` × 3
- `useSessionDragDrop` × 1

## 2. ui/ — 同层 module

| 调用 | 文件 | 何时调 |
|---|---|---|
| `<Sidebar />` | `ui/sidebar/Sidebar.tsx` | layout 装配 |
| `<Terminal />` + `<WindowTabBar />` | `ui/terminal/` | WorkspaceContainer 装配 |
| `<SettingsView />` | `ui/ui-kit/settings/SettingsView.tsx` | 按需挂载抽屉 |
| `<NewGroupDialog />` / `<EditSessionDialog />` 等 | `ui/ui-kit/dialogs/` | `useAppShell().openDialog(...)` 触发 |
| `useCommandExecutor` / `useCommandTargets` | `ui/hooks/` | 顶层 useEffect 装配命令系统 |

## 3. app/modules/ — useCase 编排

| 调用 | 来源 | 何时调 |
|---|---|---|
| `app/modules/workspace/persistence.loadWorkspace` | 启动时 hydration | AppLayout useEffect onMount |
| `app/modules/workspace/persistence.saveWorkspace` | 关闭前 | AppLayout useEffect beforeunload |
| `app/modules/workspace/create.createWorkspace` | 用户"新建 workspace" | useAppShell.openSettings / toolbar |
| `app/modules/session/create.*` | CreateSessionDialog 提交回调 | onSubmit handler |
| `app/modules/window/*` | WindowTabBar 回调 | onCloseWindow 等 |
| `app/modules/pane/*` | pane 操作回调 | split / resize / close |
| `app/modules/workspace/group/*` | group CRUD 回调 | NewGroupDialog 等 onSubmit |

**当前架构债**：layout 当前直接 `useWorkspaceStore.getState().setX(...)` 写 store 而不走 useCase。改造 PR 应改为"读 store / 写走 useCase"。

## 4. app/rules/

| 调用 | 来源 | 何时调 |
|---|---|---|
| `app/rules/paneTree.ts` | init pane → 真实 session 转换 | WorkspaceContainer 初始化 |
| `app/rules/sessionRules.ts` | session 唯一命名 | create session 时 |
| `app/rules/workspaceRules.ts` | workspace 排序 | render |

## 5. service/ — 状态与 IPC 桥

| 调用 | 来源 | 何时调 |
|---|---|---|
| `service/workspace/store` | 读 workspace 树 | 每次 render |
| `service/session/store` | 读 session 元数据 | 每次 render |
| `service/persistence/store` | 读 saved configs / groups | 每次 render |
| `service/theme/store` | 读主题 | theme 切换时 |
| `service/legacy/contexts/SessionContext` | legacy 读取（**已废弃**） | 迁移到 useSessionStore |

**约束**：layout 读 store 通过 `useXxxStore()` hook（订阅），不通过 `getState()`（不订阅）。layout 写 store 通过 useCase。

## 6. infra/ — **唯一允许直跳 infra 的 module**

```typescript
import { getCurrentWindow } from "@tauri-apps/api/window";
// NavBar 内部使用
getCurrentWindow().minimize();
getCurrentWindow().toggleMaximize();
getCurrentWindow().close();
```

**为什么 layout 唯一允许**：窗口控制按钮（min/max/close）是 OS 级别的，没有任何"业务编排"可言，也不在 useCase 的覆盖范围内。AGENTS.md 也明确写了"Window decorations are disabled ... getCurrentWindow()"。

其他 ui module **禁止**直接 import `@tauri-apps/api`。

## 7. model/ — 类型

| 调用 | 来源 |
|---|---|
| `Workspace`、`TerminalWindow`、`Session`、`SessionConfig` | props + store schema |
| `PersistedWorkspace`、`PersistedWindow` | 持久化结构 |
| `Settings`、`SettingsCategory` | 设置视图 |
| `SplitDirection` | split pane UI |

## 8. 当前架构债

| 现状 | 问题 | 改造方向 |
|---|---|---|
| `app` × 5 直引 | layout 直跳 useCase，但应在 `useAppShell` 内编排 | useAppShell 持有回调，layout 只 render |
| layout 散落 src/ui/ 顶层 | 跟 terminal / tmux / hooks 混在一起 | 改造 PR-1 收编到 `layout/` |
| InitWindowView 跟 layout 同级 | 应在 layout 内部 | 移入 layout/ |

**可机械校验**：

```bash
# layout 散落情况（应在 src/ui/layout/，不在 src/ui/ 顶层）
ls src/ui/AppLayout.tsx src/ui/NavBar.tsx src/ui/WorkspaceContainer.tsx src/ui/WorkspaceBottomBar.tsx src/ui/InitWindowView.tsx
# 应当全部不存在（已迁移到 src/ui/layout/）

# layout 不允许直写 store
grep -rn 'useWorkspaceStore.getState().set\|useSessionStore.getState().set\|usePersistenceStore.getState().set' src/ui/layout/ --include='*.tsx' --include='*.ts'
# 必须为空（除 useAppShell 内部编排点）

# 只有 layout 允许直跳 infra
grep -rn 'from\s*"@tauri-apps/api' src/ui/ --include='*.tsx' --include='*.ts' -l
# 必须只有 src/ui/layout/ 下的文件
```

## 9. 不允许的依赖

- ❌ `ui/layout/` → `infra/` 除 `getCurrentWindow` 以外的 API
- ❌ `ui/layout/` 写 store setter（除 useAppShell 集中编排点）
- ❌ `ui/layout/` 持有 xterm 实例（xterm 归 terminal）

## 10. 依赖变更流程

当下层接口变更时：

1. **store schema 变更**——同步更新 `INTERFACE.md` §2（useAppShell 返回）+ `DOWNSTREAM.md` §5
2. **app/modules useCase 签名变更**——同步更新 `DOWNSTREAM.md` §3
3. **新增 ui 业务 module**——layout 需要在 useAppShell 里装配，§2 表格加一行
4. **新增 dialog 类型**——同步更新 `INTERFACE.md` §2 DialogKind union
5. **window control API 变更**（@tauri-apps/api 升级）——同步更新 §6
