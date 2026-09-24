# Module · Shell — 职责

> **位置**：`src/ui/modules/shell/`
> **用户认知里的位置**：「app 的壳」——打开 app 看见的最外层（标题栏、窗口控制、整体布局、初始化）
> **依赖**：所有 feature module（shell 是顶层）

## 1. 这个 module 负责什么

shell 是 xsterm 的**物理容器**。它承担 4 个产品功能：

1. **窗口装饰**——自定义标题栏 + 最小化/最大化/关闭按钮（Tauri 给的 `getCurrentWindow()` 接口）
2. **整体布局**——决定工作区 + 侧栏 + 设置抽屉的相对位置
3. **跨 module UI 原子**——`<Icon>` `<Button>` `<Tooltip>` `<Dialog>` 等**纯展示、无业务**的可复用组件
4. **应用初始化**——启动时加载持久化的 workspace / theme / settings

## 2. 这个 module **不**负责什么

- **不渲染终端**——terminal 是 terminal module 的事
- **不管理 session**——session 是 session module 的事
- **不管理 workspace 业务逻辑**——workspace module 提供 `<App>`，shell 只装它
- **不持有任何 feature 数据**——shell 的 store 只放"shell 自身状态"（当前激活的 dialog、侧栏宽度）

## 3. 子结构

```
modules/shell/
├── api.ts                            # 对外暴露 <App> 入口 + <Icon> <Button> 等原子
├── view/
│   ├── App.tsx                       # 最顶层组件，main.tsx 入口
│   ├── TitleBar.tsx                  # 自定义标题栏
│   ├── WindowControls.tsx            # min/max/close 按钮
│   ├── Layout.tsx                    # 4 槽位布局（workspace / sidebar / settings drawer）
│   ├── StatusBar.tsx                 # 底部状态栏
│   └── primitives/                   # 跨 module UI 原子
│       ├── Icon.tsx
│       ├── Button.tsx
│       ├── Tooltip.tsx
│       ├── Dialog.tsx
│       ├── FormField.tsx
│       └── ContextMenu.tsx
├── store.ts                          # shell 自身状态（activeDialog, sidebarWidth, isMaximized）
├── init.ts                           # 应用启动序列（load settings, hydrate stores）
├── index.ts                          # barrel：只 re-export from api.ts
└── *.test.ts
```

## 4. 用户故事

- **作为用户**，我希望打开 app 看见熟悉的标题栏和关闭按钮 → `TitleBar.tsx` + `WindowControls.tsx`
- **作为用户**，我希望侧栏可以拖拽改变宽度 → `Layout.tsx` + `store.ts`
- **作为用户**，我希望点"设置"打开抽屉 → shell 通过 activeDialog 状态控制
- **作为用户**，我希望其他功能（session/workspace/terminal）都能用统一的 `<Button>` `<Icon>` → shell 提供原子

## 5. 跟其他 module 的关系

shell 是顶层 module，**所有** feature module 都可以被 shell 嵌入：

| module | shell 怎么用 |
|---|---|
| `workspace` | shell 把 `<WorkspaceApp>` 装在 Layout 的主槽位 |
| `terminal` | terminal 提供 `<TerminalApp>`，workspace 嵌入它；shell 不直接调 terminal |
| `session` | session 提供 `<CreateSessionDialog>`，shell 通过 `activeDialog` 状态控制显示 |
| `settings` | settings 提供 `<SettingsDrawer>`，shell 装在 Layout 的抽屉槽位 |

shell 还提供**跨 module 共用 UI 原子**（`<Icon>` `<Button>` 等）——其他 module 通过 `shell/api.ts` 引用。

## 6. 这个 module 的"产品语言"术语

- **shell** — app 的物理容器
- **title bar** — 顶部自定义标题栏
- **layout** — 整体布局策略（侧栏 + 主区 + 抽屉 + 状态栏）
- **primitive** — 跨 module 共用的纯展示 UI 组件
- **init sequence** — 启动时的状态加载顺序
