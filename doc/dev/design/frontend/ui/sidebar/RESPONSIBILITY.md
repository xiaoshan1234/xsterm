# Module · Sidebar — 职责

> **位置（目标态 / 现状一致）**：`src/ui/sidebar/`
> **L 层**：L2 业务视图（详见 [`../README.md` §5](../../README.md)）
> **主语**：左侧三栏（session / window / workspace）+ toolbar
> **唯一进口**：`layout/AppLayout.tsx`

## 1. 这个 module 负责什么

把"用户在侧栏看见的所有导航、列表、操作按钮"做成一个**自包含**的视图块。layout 喂入 workspace 列表 / session 列表 / window 列表，sidebar 负责：

1. **三栏渲染**：3 个 manager（SessionManager / WindowManager / WorkspaceManager）按 design-system 摆位
2. **toolbar**：顶部按钮（新建 session / 新建 workspace / 设置入口）
3. **拖拽 resize**：用户拖拽侧栏右边界调宽度（ResizeHandle）
4. **右键菜单**：每个 manager 项右键弹出 ContextMenu（rename / delete / move to group）
5. **新建 group / 编辑 group**：通过 dialogs 模块的 NewGroupDialog / EditGroupDialog

## 2. 这个 module **不**负责什么

- **不创建 session 本身**——点击"新建 session"调 `app/modules/session/create.useCreateLocalSession` 之类，sidebar 只触发回调
- **不渲染 pane 内容**——侧栏不放终端，pane 渲染归 terminal module
- **不渲染设置页**——设置按钮跳转到 settings module（layout 切换 view）
- **不直接调 backend IPC**——所有 `invoke` 走 service 层或 useCase

## 3. 子文件职责

| 文件 | 职责 | 关键 prop |
|---|---|---|
| `Sidebar.tsx` | 三栏容器 + ResizeHandle | `width`, `onResize` |
| `SidebarToolbar.tsx` | 顶部按钮（新建 / 设置入口）+ 侧栏菜单 | onNewSession / onOpenSettings |
| `SessionManager.tsx` | session 列表 + 排序 + 拖拽排序 | sessions, onSelect, onRename |
| `WindowManager.tsx` | 当前 workspace 的 window 列表 | windows, activeWindowId |
| `WorkspaceManager.tsx` | workspace 列表 + group 折叠 | workspaces, activeWorkspaceId, groups |

## 4. 跟其他 module 的关系

| 邻居 | 关系 | 接缝位置 |
|---|---|---|
| `terminal/` | 无直接依赖，sidebar 只显示「这个 session 存在」 | props 边界（layout 同时持有两者） |
| `settings/` | 无直接依赖，sidebar 的"设置"按钮触发 layout 切换 view | layout callback |
| `dialogs/` | sidebar 调 `dialogs/NewGroupDialog` / `EditGroupDialog` / `EditSessionDialog` | **L2 → L3 是合规的**，详见 [`../README.md` §5.3](../../README.md) |
| `primitives/` | sidebar 调 `primitives/ContextMenu` / `FormField` / `Dialog` | L2 → L4 合规 |
| `app/hooks/useSessionDragDrop` | 拖拽排序逻辑 | UI 编排 hook |

## 5. 子目录组织（现状 = 目标态）

```
ui/sidebar/
├── Sidebar.tsx                三栏容器 + ResizeHandle
├── SidebarToolbar.tsx         顶部按钮 + 菜单
├── SessionManager.tsx         session 列表
├── WindowManager.tsx          window 列表
└── WorkspaceManager.tsx       workspace + group 列表
```

每个文件配 `.test.tsx` 位于同目录。
