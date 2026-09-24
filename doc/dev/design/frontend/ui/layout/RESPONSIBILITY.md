# Module · Layout — 职责

> **位置（目标态）**：`src/ui/layout/`
> **位置（现状）**：散落在 `src/ui/` 顶层（`AppLayout.tsx`、`NavBar.tsx`、`InitWindowView.tsx`、`WorkspaceContainer.tsx`、`WorkspaceBottomBar.tsx`）——改造 PR-1 收编到 `layout/`。
> **L 层**：L1 shell（详见 [`../README.md` §5](../../README.md)）
> **主语**：app 的"壳"——决定整个应用"长什么样"、5 大槽位怎么摆
> **唯一进口**：`src/main.tsx` → `src/App.tsx` → `<AppLayout>` → `<WorkspaceContainer>` → 各业务 module

## 1. 这个 module 负责什么

把"用户打开 app 第一眼看见的所有东西"做成一个**自包含**的壳层。layout 负责：

1. **窗口装饰**：自定义标题栏（NavBar）+ 最小化/最大化/关闭按钮（用 `@tauri-apps/api` 的 window control，详见 AGENTS.md）
2. **主装配**：决定侧栏 + 终端区 + 底部栏 + 设置抽屉 4 个槽位的相对位置
3. **store hydration**：启动时从 `service/persistence` 加载上次会话状态
4. **view 路由**：在「主工作区视图」和「设置视图」之间切换（不开新路由库，用 useState 即可）
5. **dialog 编排**：当前激活的 dialog 通过 layout 集中管理（`useDialogOpenState`），避免每个 manager 各自 useState

## 2. 这个 module **不**负责什么

- **不渲染 pane 内容**——只装配 4 个槽位，pane 渲染归 terminal module
- **不渲染侧栏列表**——槽位里塞的是 `<Sidebar>`，sidebar 自己管三栏
- **不写业务规则**——store hydration 调 `service/persistence` 的纯加载逻辑，layout 不写派生计算
- **不持有 xterm 实例**——xterm 由 terminal module 持有

## 3. 子文件职责（目标态）

| 文件 | 职责 |
|---|---|
| `AppLayout.tsx` | 顶层壳：决定侧栏 + 终端 + 底部栏 + 设置抽屉 4 槽位布局 |
| `NavBar.tsx` | 自定义标题栏（窗口控制 + 应用标题 + 设置入口按钮） |
| `WorkspaceContainer.tsx` | 当前激活 workspace 的容器：装载 `<Sidebar>` + `<Terminal>` + 底部栏 |
| `WorkspaceBottomBar.tsx` | 底部状态栏（显示当前激活 session 名 / tmux 状态等） |
| `InitWindowView.tsx` | 启动时的占位视图（"点击新建 session"） |

## 4. 跟其他 module 的关系

| 邻居 | 关系 | 接缝位置 |
|---|---|---|
| `terminal/` | layout 把 `WorkspaceContainer` 的 pane 渲染位置让给 terminal | props 注入 + render 函数回调 |
| `sidebar/` | layout 把侧栏槽位让给 sidebar | props 注入 |
| `ui-kit/settings/` | layout 提供"切换到设置视图"的入口按钮 | props callback |
| `ui-kit/dialogs/` | layout 持有 dialog 状态（`useDialogOpenState`） | 通过 context 注入到 sidebar / terminal |
| `hooks/` | layout 调 `useCommandExecutor` 等编排 hook 装配整个应用 | layout 内部 useEffect |
| `app/` | layout 在启动时调 `app/modules/workspace/persistence.loadWorkspace` | useEffect / onMount |

## 5. 子目录组织（目标态）

```
ui/layout/
├── AppLayout.tsx                 顶层壳
├── NavBar.tsx                    自定义标题栏
├── WorkspaceContainer.tsx        工作区容器
├── WorkspaceBottomBar.tsx        底部状态栏
└── InitWindowView.tsx            启动占位视图
```

每个文件配 `.test.tsx` 位于同目录。
