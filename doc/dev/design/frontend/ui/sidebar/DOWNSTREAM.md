# Module · Sidebar — 对下依赖接口

> **位置（目标态 / 现状一致）**：`src/ui/sidebar/`
>
> 本文档描述 Sidebar module **调用的下层接口**。任何下层接口变更（重命名、签名变化）需要先评估对 Sidebar 的影响。

## 1. 依赖图

```
ui/sidebar/  ──►  ui/dialogs/      (NewGroupDialog / EditGroupDialog / EditSessionDialog) — L2→L3 合规
             ──►  ui/primitives/   (ContextMenu / FormField / Dialog)                   — L2→L4 合规
             ──►  ui/icons/        (Icon)
             ──►  service/         (workspace / session / persistence / legacy context)  — store 读 + IPC 桥
             ──►  model/           (Workspace / Session / Group types)
             ──►  app/rules/       (sessionRules / workspaceRules)                       — 排序等纯函数
             ──►  app/hooks/useSessionDragDrop                                           — UI 编排 hook
```

**调用统计（基于现状 grep）**：
- `primitives` × 7
- `service` × 4
- `model` × 4
- `icons` × 4
- `dialogs` × 3（合规的 L2→L3）
- `useSessionDragDrop` × 1
- `app/modules/*` × 0（**当前架构债**：sidebar 直接调 service，没走 useCase）

## 2. ui/dialogs/ — L3 风格层

| 调用 | 文件 | 何时调 |
|---|---|---|
| `NewGroupDialog` | `dialogs/NewGroupDialog.tsx` | WorkspaceManager 点"新建 group"按钮 |
| `EditGroupDialog` | `dialogs/EditGroupDialog.tsx` | WorkspaceManager 右键 group → 编辑 |
| `EditSessionDialog` | `dialogs/EditSessionDialog.tsx` | SessionManager 右键 session → 编辑 |

**约束**：L2 → L3 是合规单向依赖。但 sidebar **应当**通过 layout 注入 dialog opener 回调，而不是直接 import——当前是改造项。

## 3. ui/primitives/ — L4 原子

| 调用 | 文件 | 何时调 |
|---|---|---|
| `ContextMenu` | `primitives/ContextMenu.tsx` | 右键菜单 |
| `FormField` | `primitives/FormField.tsx` | 侧栏内嵌表单 |
| `Dialog` | `primitives/Dialog.tsx` | 二次确认弹窗（删除前确认） |

## 4. service/ — 状态与 IPC 桥

| 调用 | 来源 | 何时调 |
|---|---|---|
| `service/workspace/store` 的 `useWorkspaceStore` | 读当前 workspace / window / pane 树 | 每次 render |
| `service/session/store` 的 `useSessionStore` | 读 session 元数据 | 每次 render |
| `service/persistence/store` 的 `usePersistenceStore` | 读 groups / saved configs | 每次 render |
| `service/legacy/contexts/SessionContext` 的 `useSession` | 读当前激活 sessionId（legacy） | **已废弃** |

**当前架构债**：sidebar 直接 `useWorkspaceStore.getState()` 读 + setter 写（如 `wsStore.setWorkspaces(...)`），完全绕过 `app/modules/*` useCase。改造 PR 应统一改为"读 store / 写走 useCase"。

## 5. model/ — 类型

| 调用 | 来源 |
|---|---|
| `Workspace`、`Session`、`TerminalWindow`、`Group` | props + store schema |
| `model/workspace/types.ts` 的 group sort helper | 派生计算 |
| `model/session/types.ts` 的 SessionStatus enum | 列表项状态展示 |

## 6. app/rules/ — 纯函数

| 调用 | 来源 | 何时调 |
|---|---|---|
| `app/rules/sessionRules.ts` 的 `getUniqueWindowName` | 防止重名 | 新建 session / window 时 |
| `app/rules/sessionRules.ts` 的 `assertSessionNotUsedElsewhere` | 防呆 | replaceInitWindowWithSession 前置校验 |
| `app/rules/workspaceRules.ts` | workspace 排序 | render 时 |

## 7. app/hooks/useSessionDragDrop — UI 编排 hook

封装 session 拖拽排序的副作用（mouse / touch 事件 + reordering 动画）。调用方提供 `onReorder(fromIndex, toIndex)` 回调，回调实现走 `app/modules/session/lifecycle` 或 `app/modules/workspace/group/lifecycle` useCase。

## 8. 当前架构债（应在下个改造 PR 清理）

| 现状 | 问题 | 改造方向 |
|---|---|---|
| sidebar 直接 `useWorkspaceStore.getState().setX(...)` | UI 写 store 绕过 useCase | 走 `app/modules/*` useCase |
| sidebar 直接 import `dialogs/*` | L2→L3 直跳，应当 layout 注入 | layout 提供 dialog opener 回调 |
| `service/legacy/contexts/SessionContext` 仍在使用 | 已废弃 | 迁到 `useSessionStore` |

**可机械校验**：

```bash
# sidebar 不允许写 store（只能读）
grep -rn 'useWorkspaceStore.getState().set\|useSessionStore.getState().set\|usePersistenceStore.getState().set' src/ui/sidebar/ --include='*.tsx' --include='*.ts'
# 必须为空

# sidebar 不允许直接 import app modules
grep -rn 'from\s*"[./]*app/modules' src/ui/sidebar/ --include='*.tsx' --include='*.ts'
# 必须为空
```

## 9. 不允许的依赖

- ❌ `ui/sidebar/` → `ui/terminal/` 或 `ui/settings/` 或 `ui/tmux/`（L2 之间互不依赖）
- ❌ `ui/sidebar/` → `infra/`（任何路径）
- ❌ `ui/sidebar/` → `service/*/store` 的 setter（只读）

## 10. 依赖变更流程

当下层接口变更时：

1. **dialog API 变更**（dialog props 变化）——同步更新 `INTERFACE.md` §2 + `DOWNSTREAM.md` §2
2. **store schema 变更**——同步更新 `INTERFACE.md` §1 + `DOWNSTREAM.md` §4
3. **rules 纯函数签名变更**——影响最小，commit 标注即可
4. **useSessionDragDrop 行为变更**——同步更新 `DOWNSTREAM.md` §7
