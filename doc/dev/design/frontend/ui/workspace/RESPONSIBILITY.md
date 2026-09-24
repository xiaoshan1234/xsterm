# Module · Workspace — 职责

> **位置**：`src/ui/modules/workspace/`
> **用户认知里的位置**：「app 主视图」——工作区 + 窗口 tab + 侧栏三栏
> **依赖**：`terminal`（嵌入）、`session`（侧栏展示 session 列表）
> **不依赖**：`shell` 内部组件（除初始化）

## 1. 这个 module 负责什么

workspace 是 xsterm 的**主视图模块**。它承担 4 个产品功能：

1. **工作区管理**——创建/切换/重命名/删除/保存 workspace
2. **窗口 tab 切换**——一个 workspace 内多个 window 的 tab 切换
3. **侧栏三栏**——左栏 session 列表、中栏 window 列表、右栏 workspace 列表 + group 折叠
4. **pane 业务**——把终端渲染委托给 terminal module，workspace 自己只管 pane 树在 workspace 维度上的布局（持久化、resize 编排）

## 2. 这个 module **不**负责什么

- **不渲染 xterm 终端**——委托给 terminal module
- **不创建 session**——session 模块提供 `<CreateSessionDialog>`，workspace 通过 `useAppShell().openDialog()` 触发
- **不渲染设置**——settings 是独立 module
- **不渲染标题栏 / 窗口控制**——shell 的事

## 3. 子结构

```
modules/workspace/
├── api.ts                            # 对外暴露 <App> 入口 + 工作区 CRUD hook
├── view/
│   ├── App.tsx                       # workspace 主入口（被 shell 嵌入）
│   ├── TabBar.tsx                    # window tab 切换条
│   ├── Sidebar/
│   │   ├── Sidebar.tsx               # 三栏容器
│   │   ├── SessionList.tsx           # 左栏
│   │   ├── WindowList.tsx            # 中栏
│   │   └── WorkspaceList.tsx         # 右栏（含 group 折叠）
│   ├── TabContent.tsx                # 单个 tab 的内容（嵌入 terminal）
│   ├── PaneContainer.tsx             # pane 树在 workspace 维度的布局
│   └── StatusBar.tsx                 # workspace 状态栏
├── store.ts                          # workspace / window / pane tree 状态
├── model.ts                          # Workspace / Window / PaneTree 类型 + 派生
├── index.ts                          # barrel
└── *.test.ts
```

## 4. 用户故事

- **作为用户**，我希望点击侧栏的 session 列表把它打开到当前 window → `SessionList.tsx` + `useWorkspaceApi().openSession()`
- **作为用户**，我希望点 tab 切换 window → `TabBar.tsx` + `setActiveWindow()`
- **作为用户**，我希望保存当前 workspace，下次打开恢复 → `saveWorkspace()` 调 persistence
- **作为用户**，我希望右键侧栏的 session 重命名 → 弹 session 模块的 `<EditSessionDialog>`

## 5. 跟其他 module 的关系

| module | 关系 |
|---|---|
| `shell` | shell 装 `<WorkspaceApp>`；workspace 通过 `useAppShell()` 触发 dialog（不改 store） |
| `terminal` | workspace 嵌入 `<TerminalApp>` 作为 `<TabContent>`；**workspace 管 pane 树在 workspace 维度的业务**，terminal 管 xterm 渲染 |
| `session` | workspace 通过 `session/api.ts` 拿到 `<CreateSessionDialog>` 等；session 是 workspace 显示的核心实体 |
| `settings` | workspace 通过 props 接收布局设置（侧栏宽度等），不直接 import settings |
| `terminal` ↔ `workspace` | 单向：workspace → terminal。terminal 不知道 workspace 的存在 |

## 6. 这个 module 的"产品语言"术语

- **workspace** — 一个工作区（一组 windows + 侧栏配置 + 持久化元数据）
- **window** — workspace 内的标签页（对应一个 pane tree）
- **tab** — window 在 tab bar 里的视觉表示
- **sidebar** — 左侧三栏（session / window / workspace）
- **group** — workspace 的二级组织（侧栏里把 session 归类）
- **pane tree** — 一个 window 内的分屏树（terminal module 负责渲染，workspace 负责持久化）
