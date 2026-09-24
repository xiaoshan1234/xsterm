# Module · Hooks — 对下依赖接口

> **位置（目标态）**：`src/ui/hooks/`
>
> 本文档描述 Hooks module **调用的下层接口**。

## 1. 依赖图

```
ui/hooks/  ──►  app/modules/      (useCase 编排)
            ──►  app/rules/        (纯函数)
            ──►  service/          (store 订阅 + IPC 桥)
            ──►  model/            (类型)
            ──►  react             (useState / useEffect / useRef)
            ──►  (无 infra / 无 ui 其他 module)
```

## 2. app/modules/ — useCase 编排

| 调用 | 来源 | 何时调 |
|---|---|---|
| `app/modules/session/create.*` | useCommandExecutor | "new session" target run |
| `app/modules/window/create.*` | useCommandExecutor | "new window" target run |
| `app/modules/workspace/persistence.saveWorkspace` | useCommandExecutor | "save workspace" target run |
| `app/modules/pane/lifecycle.resizePane` | useTerminalResize | onResizeEnd |
| `app/modules/workspace/group/lifecycle.moveConfigToGroup` | useSessionDragDrop | onReorder 触发 |
| `app/modules/session/lifecycle.reorderSessions` | useSessionDragDrop | onReorder 触发 |

## 3. app/rules/

| 调用 | 来源 | 何时调 |
|---|---|---|
| `app/rules/sessionRules.ts` 的 `getUniqueWindowName` | 命令执行前校验 | useCommandExecutor.run |
| `app/rules/workspaceRules.ts` | workspace 排序检查 | useCommandTargets |

## 4. service/

| 调用 | 来源 | 何时调 |
|---|---|---|
| `service/workspace/store` | 读 workspace 列表 | useSessionDragDrop items |
| `service/session/store` | 读 session 列表 | useSessionDragDrop items |
| `service/theme/store` | 读主题 | （命令面板 UI 用） |

**约束**：hook 内部通过 `useXxxStore()` 订阅（响应式），不通过 `getState()`（不订阅）。

## 5. model/

| 调用 | 来源 |
|---|---|
| `Session`、`Workspace`、`Group` types | props 类型 |
| `CommandDescriptor` / `CommandTarget` | 命令面板接口 |

## 6. react

`useState` / `useEffect` / `useRef` / `useCallback` / `useMemo` 标准 hook。**不允许** import `@tauri-apps/api` 或其他非 React 副作用库（draggable 用 HTML5 native drag）。

## 7. 当前架构债

| 现状 | 问题 | 改造方向 |
|---|---|---|
| `useCommandExecutor` 直接调 service | 应走 useCase | 改造 |
| `useSessionDragDrop` 散落在 `src/ui/` 顶层 | 应在 `ui/hooks/` | 改造 PR-1 收编 |
| `useTerminalResize` / `useSidebarResize` 内联在 terminal/sidebar 组件内 | 应抽到 hooks/ | 改造 PR 抽出 |

**可机械校验**：

```bash
# hooks 不允许直跳 infra
grep -rn 'from\s*"@tauri-apps/api' src/ui/hooks/ --include='*.ts' --include='*.tsx'
# 必须为空

# hooks 不允许 import ui 其他 module
grep -rn 'from\s*"\.\./[a-z]' src/ui/hooks/ --include='*.ts' --include='*.tsx'
# 必须为空（除 ../model ../service ../app 这种层路径）
```

## 8. 不允许的依赖

- ❌ `ui/hooks/` → `infra/`（任何路径）
- ❌ `ui/hooks/` → `ui/terminal/` 或 `ui/sidebar/` 或 `ui/layout/`（hooks 是被消费的，不是消费 ui module 的）
- ❌ `ui/hooks/` → `ui/ui-kit/`（同上）

## 9. 依赖变更流程

1. **新增 useCase**——检查 useCommandTargets 是否需要注册新 target
2. **store schema 变更**——同步更新 §4
3. **新增 hook**——加到 `RESPONSIBILITY.md` §4 + `INTERFACE.md` §1 或 §2
4. **重命名 hook**——同步更新所有引用方 + INTERFACE/DOWNSTREAM
