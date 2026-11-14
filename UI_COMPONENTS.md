# XSTerm UI 组件与 Shell 设计

> 本文档定义 XSTerm 应用级 UI 组件、布局归属、状态边界和 Model 契约。
> 视觉规范以 [DESIGN.md](./DESIGN.md) 为权威；本文档不得覆盖颜色、字体、圆角、
> 间距和组件视觉模式。

## 1. 状态

- 当前阶段：设计稿
- 实施状态：Phase 1–4 已完成；新 Shell 是唯一运行时入口，旧 Sidebar / BottomBar / CommandSendPanel 已移除
- 目标：先固定 UI 壳层和组件边界，再实现功能，最后迁移现有组件

默认入口：

```powershell
npm run tauri dev
```

纯静态组件稿：

```text
http://localhost:1420/#ui-preview
```

## 2. 设计目标

1. 应用级区域全局唯一，不随 Workspace、Window 或 Pane 重建。
2. 业务状态和 UI 壳层状态分离。
3. UI 组件不直接消费 Tauri DTO，也不直接依赖 infra。
4. Terminal 与 tmux 在 Model 层保持不同聚合，在 UI 层通过明确 View Model 汇合。
5. 全局 TextSender 只有一个实例，通过 `PaneTargetRef` 指定目标 Pane。
6. 现有实现按阶段迁移，不为满足目标结构一次推倒重写。

## 3. 层级与依赖规则

```text
app
  → features
  → shared/ui

features
  → models
  → shared/ui
  → feature-local infrastructure

shared/ui
  ↛ app
  ↛ features
  ↛ models
  ↛ infra
```

UI 数据流固定为：

```text
Domain Model
  → Selector
  → View Model
  → Component Props
  → User Action
  → Feature Application Action
```

禁止：

- 组件直接 `invoke()` 或 `listen()`；
- 组件消费后端原始 DTO；
- UI 自行解析 snake_case Tauri 事件；
- `shared/ui` 导入业务 Model；
- 一个 UI 组件直接修改多个领域聚合。

## 4. 应用布局

```text
AppShell
├─ NavBar
├─ Body
│  ├─ LeftSidebar
│  │  ├─ Toolbar               固定窄栏，常驻
│  │  └─ ToolPanel             默认隐藏
│  │     ├─ TerminalManager
│  │     ├─ TmuxManager
│  │     ├─ WindowManager
│  │     ├─ WorkspaceManager
│  │     └─ SettingsPanel
│  └─ MainArea
│     ├─ WorkspaceView
│     │  ├─ WindowTabBar
│     │  └─ WindowPaneArea
│     └─ GlobalTextSender      默认隐藏，仅占 MainArea 底部
├─ BottomBar
│  ├─ WorkspaceQuickSwitch
│  └─ TextSenderToggle
└─ GlobalOverlayHost
```

### 布局约束

- `NavBar`、`LeftSidebar`、`MainArea`、`BottomBar` 都是 AppShell 单实例。
- `Toolbar` 始终显示。
- `ToolPanel` 展开后位于 Toolbar 右侧，同一时间只显示一个面板。
- `GlobalTextSender` 只横跨 `MainArea`，不覆盖 LeftSidebar。
- `BottomBar` 中的 Workspace 按钮打开快速切换菜单，不直接打开 WorkspaceManager。
- Dialog、ContextMenu、Toast 统一由 `GlobalOverlayHost` 承载。

## 5. 全局单实例与可见性

“全局单实例”表示组件在应用生命周期中只有一个逻辑实例，不代表始终可见。

| 区域              | 实例数 | 默认可见 | 关闭后状态                      |
| ----------------- | -----: | -------: | ------------------------------- |
| NavBar            |      1 |       是 | 不可关闭                        |
| Toolbar           |      1 |       是 | 不可关闭                        |
| ToolPanel         |      1 |       否 | 保留当前激活工具和宽度          |
| MainArea          |      1 |       是 | 不可关闭                        |
| GlobalTextSender  |      1 |       否 | 保留选中 Target、草稿和任务状态 |
| BottomBar         |      1 |       是 | 不可关闭                        |
| GlobalOverlayHost |      1 |   视内容 | 不持有业务状态                  |

## 6. App Shell 组件

### 6.1 AppShell

职责：

- 组合 NavBar、LeftSidebar、MainArea、BottomBar 和 OverlayHost。
- 管理全局面板可见性和尺寸。
- 不持有 Terminal、TmuxController 或 Workspace 领域数据。

建议状态：

```ts
interface AppShellUiState {
  activeTool: ToolId | null;
  toolPanelWidth: number;
  isTextSenderOpen: boolean;
  textSenderHeight: number;
}
```

### 6.2 NavBar

职责：

- 自定义窗口标题栏和拖拽区。
- 窗口最小化、最大化、恢复和关闭。
- 应用级菜单入口。

不负责：

- Workspace 切换；
- Terminal 创建；
- TextSender 目标选择。

### 6.3 LeftSidebar

由 Toolbar 与 ToolPanel 组成：

```text
LeftSidebar
├─ Toolbar
└─ ToolPanel（activeTool != null 时显示）
```

行为：

- 点击未激活工具：打开 ToolPanel 并切换到该工具。
- 点击当前激活工具：关闭 ToolPanel。
- 切换工具不重建 LeftSidebar。
- ToolPanel 宽度可调整并持久化。

### 6.4 Toolbar

工具项：

- Terminal Manager
- tmux Manager
- Window Manager
- Workspace Manager
- Settings

约束：

- 仅图标或紧凑图标加标签。
- 同一时间只有一个 Active Tool。
- 所有按钮必须有 `aria-label` 和 tooltip。
- 焦点不会因 ToolPanel 开关而丢失。
- Toolbar 按“配置管理 / 设置”分组，运行状态统一位于 BottomBar。

分组建议：

```text
Configuration
├─ TerminalManager
├─ TmuxManager
├─ WindowManager
└─ WorkspaceManager

Settings
└─ SettingsPanel
```

### 6.5 ToolPanel

职责：

- 承载当前 Active Tool。
- 提供统一面板头部和可访问标题。
- 负责自身宽度边界，不负责具体 Manager 数据。

状态：

```ts
type ToolId =
  "terminal-manager" | "tmux-manager" | "window-manager" | "workspace-manager" | "settings";
```

### 6.6 Manager 组件

Managers 都是 feature UI，不直接挂在 MainArea。

| 组件             | Model 来源                       | 主要动作                             |
| ---------------- | -------------------------------- | ------------------------------------ |
| TerminalManager  | `SavedLaunchConfig[]` View Model | 创建、编辑、删除、打开 Terminal 配置 |
| TmuxManager      | `SavedLaunchConfig[]` View Model | 创建、编辑、attach、打开 tmux 配置   |
| WindowManager    | `SavedWindowSnapshot[]`          | 加载、重命名、删除 Window 配置       |
| WorkspaceManager | `WorkspaceSnapshot[]`            | 加载、重命名、删除 Workspace 配置    |
| SettingsPanel    | Settings View Model              | 修改全局设置                         |

Manager 不得直接操作 Tauri，也不得持有其他 Manager 的内部状态。

#### Manager 统一布局

每个 Manager 使用相同的三段式结构：

```text
ManagerPanel
├─ ManagerHeader
├─ ManagerScrollArea
└─ ManagerFooter                固定，不随列表滚动
```

布局要求：

- ManagerPanel 必须为 `display: flex; flex-direction: column`。
- ManagerScrollArea 使用 `flex: 1; min-height: 0; overflow-y: auto`。
- ManagerFooter 使用 `flex-shrink: 0`，固定在 ToolPanel 底部。
- Header 和 Footer 不参与列表滚动。
- 空列表只替换 ScrollArea 内容，不隐藏 Footer。

#### TerminalManager

底部固定操作：

1. New Terminal
2. New Group

列表主体：

- 默认分组 / Ungrouped
- 用户创建的 Terminal Groups
- 每个 Group 内的 `SavedLaunchConfig`

TerminalManager 只显示保存配置，不显示 Live Terminal 状态列表。运行状态统一由
BottomBar RuntimeStatus 展示。

行为：

- New Terminal 打开 `CreateTerminalDialog`。
- New Group 打开小型 Create Group Dialog。
- 双击保存配置打开对应 Terminal。
- Context Menu 提供编辑、删除等操作。
- 支持把 Terminal 配置拖入分组。
- 空分组仍显示 Group Header 和 Empty State。

#### TmuxManager

底部固定操作：

- New tmux Session

列表主体：

- Saved tmux launch configs

TmuxManager 只显示保存配置，不显示 Live TmuxController 状态列表。运行状态统一由
BottomBar RuntimeStatus 展示。

约束：

- 按 `baseConfigId` 自动分组，相同 Base Configuration 的 tmux session 位于同一目录。
- 自动分组可折叠，但不提供用户新建、编辑或删除目录。
- 同一个 tmux session 只能存在一个运行实例；再次打开时聚焦已有实例。
- tmux entry 的右键菜单始终提供 Detach；未运行时禁用，运行时可点击。
- Detach 后若 Workspace 不再包含任何 Window，自动构造一个 init window。
- 已连接的 tmux entry 使用 Success 色圆角边框和状态点。
- 同一个 Base Configuration 分组内 tmux display name 不得重复；不同分组允许同名。
- 默认名称为 `<session>:<socket>`，socket 为空时使用 `default`。
- 不显示 New Group。
- New tmux Session 打开 `CreateTmuxDialog`。

#### BottomBar RuntimeStatus

BottomBar 是运行状态的唯一常驻入口：

- 显示当前 Active Workspace / Active Window 中聚焦 Pane 的终端名称。
- 显示终端类型、目标或 tmux `session / window / pane` 层级。
- 显示当前 Pane 的 `cols × rows` 尺寸和 Pane 序号。
- 正常连接显示状态点；断开状态使用 Error 语义。
- RuntimeStatus 是纯展示信息，不实现按钮或 popover。
- Toolbar 不再提供独立的 Terminal Status 或 Tmux Status 工具。

#### WindowManager

底部固定操作：

- New Window

列表主体：

- Saved Window Configs

约束：

- 不使用 Group。
- 双击 Saved Window 加载到当前 Workspace。
- Context Menu 提供 Load、Rename、Delete。

#### WorkspaceManager

底部固定操作：

- New Workspace

列表主体：

- Saved Workspace Configs

约束：

- 不使用 Group。
- 双击 Saved Workspace 切换或加载。
- Context Menu 提供 Switch/Load、Rename、Delete。

#### SettingsPanel

- 不使用 ManagerFooter。
- 不使用 Group。
- 内容区自行滚动。

## 7. MainArea

### 7.1 WorkspaceView

职责：

- 渲染当前 Active Workspace。
- 根据 Active Window 展示 `WindowTabBar` 和 `WindowPaneArea`。
- 不决定 TextSender 是否打开。

### 7.2 WindowTabBar

职责：

- 渲染 `WorkspaceWindow[]`。
- 区分 `RawWindow` 与 `TmuxWindowReference` 的菜单动作。
- 显示 Active Window。

禁止：

- 把 tmux pane 插入 `RawPaneTree`；
- 用同一个布局编辑器修改 tmux-owned pane layout。

### 7.3 WindowPaneArea

```text
WindowPaneArea
├─ RawPaneTree
│  └─ Pane
│     └─ TerminalView
│
└─ TmuxWindowView
   └─ TmuxPane
      └─ TerminalView
```

Raw 与 tmux 最终共享 TerminalView，但布局所有权不同：

- RawWindow：前端拥有 `RawPaneTree`。
- TmuxWindowReference：tmux controller 拥有 Window/Pane 拓扑，前端只镜像。

### 7.4 TerminalView

职责：

- 挂载 xterm。
- 处理键盘、粘贴、resize、滚动和显示配置。
- 显示连接状态。

输入：

```ts
interface TerminalViewData {
  terminalId: TerminalId;
  title: string;
  status: TerminalStatus;
  capabilities: TerminalCapabilities;
  displayConfig: ResolvedTerminalDisplayConfig;
}
```

不负责：

- Pane 布局；
- Workspace 持久化；
- Command Sender 队列。

## 8. GlobalTextSender

### 8.1 定位

全局唯一，固定在 MainArea 底部；默认隐藏。

```text
MainArea
├─ WorkspaceView
└─ GlobalTextSender
```

不对每个 Window 创建独立 TextSender。

### 8.2 内部结构

```text
GlobalTextSender
├─ SenderControlHeader
│  ├─ PaneTargetSelector
│  ├─ SendModeSelector
│  ├─ RateControl
│  ├─ SendStatus
│  └─ ExecutionControls
├─ SenderTabBar
├─ CommandEditor
└─ SendProgress
```

Header 不显示产品名或工具名标签，所有目标、模式和发送操作集中在单行；空间不足时允许换行。

### 8.3 Target 选择

- 必须显式选择目标 Pane。
- 支持 Raw Pane 与 tmux Pane。
- 主显示使用标题、breadcrumb 和可用状态。
- breadcrumb 中的 Window 名称使用与 tab bar 一致的一基序号，例如 `1. Main`。
- 原始后端 Terminal ID 不作为主标识。
- tmux `@window`、`%pane` 可以作为辅助技术 ID 显示。

View Model：

```ts
interface TextSenderViewData {
  targets: PaneTargetDisplayInfo[];
  selectedTarget: PaneTargetRef | null;
  resolvedTarget: ResolvedPaneTarget | null;
  tabs: TextSenderTab[];
  activeTabId: string;
  mode: "line" | "character";
  rates: Record<"line" | "character", number>;
  executionState: CommandExecutionState;
}
```

### 8.4 状态归属

TextSender 全局只有一个 UI 实例，并保留：

- 多标签输入内容和当前标签；
- 按行 / 按字符发送模式；
- 两种模式各自的发送速率；
- 队列进度和暂停、取消状态；
- 当前执行状态；
- 错误信息。

按行模式逐行发送并使用 CR 模拟终端 Enter；按字符模式按 Unicode code point 逐字符发送，文本换行同样转换为 CR。暂停在发送单元之间生效，取消后不再发送剩余单元。

Target 失效时：

- 历史记录保留；
- 标记 Unavailable；
- 禁止继续发送；
- 不自动迁移到其他 Pane。

### 8.5 显示位置

- 只占 MainArea 底部。
- 展开高度可通过顶部横向分隔条上下拖拽，默认 400px，最小 180px，最大 720px。
- 高度写入 `ui-shell.json`，静默持久化；拖拽和键盘调整期间保持响应。
- 编辑器占满面板剩余宽度和高度。
- 折叠时只隐藏面板，不销毁输入标签和发送状态。
- 与 MainArea 之间使用 `--hairline` 分隔。
- 不把 TextSender 建模为新的 PaneNode。

## 9. BottomBar

常驻应用底部，主要入口：

```text
BottomBar
├─ WorkspaceQuickSwitch
├─ RuntimeStatus
└─ TextSenderToggle
```

### 9.1 RuntimeStatus

- 显示当前聚焦 Pane 的名称、类型、连接状态和目标/层级信息。
- 显示 Pane 尺寸与 Pane 序号。
- 正常连接只显示状态点；断开状态使用红色状态点。
- tmux 层级使用 `session / window / pane`。
- 该区域只读，不承担导航、重连或关闭操作。

### 9.2 WorkspaceQuickSwitch

- 打开 Workspace 快速切换菜单。
- 显示当前 Workspace 名称。
- 支持切换和关闭 Workspace。
- 菜单包含 Manage Workspaces 入口，跳转到 WorkspaceManager。
- 不直接展开 LeftSidebar，除非用户选择 Manage。

### 9.3 TextSenderToggle

- Toggle GlobalTextSender。
- 显示打开状态。
- 不改变当前 Target。

## 10. GlobalOverlayHost

统一承载：

- Dialog
- ConfirmDialog
- PromptDialog
- ErrorDialog
- ContextMenu
- Toast

要求：

- 所有浮层通过 Portal 渲染到 AppShell 根层。
- 支持 Escape、焦点圈定和关闭后焦点恢复。
- 禁止业务组件自行使用 `window.alert`、`window.confirm` 或 `window.prompt`。

### 10.1 Dialog 基础能力

`Dialog` 是 shared/ui 原语，只负责：

- Overlay
- Header / Body / Footer
- 尺寸
- 焦点圈定
- Escape 策略
- Portal

业务 Dialog 负责：

- 表单字段
- Model 到表单值的映射
- 校验
- 提交动作
- 提交中状态
- 业务错误

### 10.2 创建与编辑 Dialog

第一批固定为四个业务 Dialog：

| Dialog               | 所属 feature | 用途                     |
| -------------------- | ------------ | ------------------------ |
| CreateTerminalDialog | terminal     | 创建 Local/SSH Terminal  |
| CreateTmuxDialog     | tmux         | 创建或 attach tmux       |
| EditTerminalDialog   | terminal     | 编辑已保存 Terminal 配置 |
| EditTmuxDialog       | tmux         | 编辑已保存 tmux 配置     |

#### CreateTerminalDialog

- Local 与 SSH 使用同一 Dialog 内的类型切换。
- 字段分组遵循 TerminalLaunchConfig。
- 支持 Save Config。
- 提交期间禁用重复提交和关闭。
- 不再包含 tmux 创建入口。

#### CreateTmuxDialog

- 独立于 CreateTerminalDialog。
- 必须选择基础 Local/SSH 配置。
- 字段分组遵循 TmuxLaunchConfig。
- 支持创建新 tmux 或 attach 现有 tmux。
- 不再包含 Local/SSH Terminal 创建入口。

#### EditTerminalDialog

- 编辑保存配置，不直接修改现有运行时 Terminal 身份。
- 显示配置可以应用到当前运行实例。
- 连接配置的修改默认用于下一次启动，界面必须明确提示。
- 只接受 Local/SSH 保存配置。

#### EditTmuxDialog

- 编辑保存的 tmux launch config。
- 不直接修改 tmux-owned window/pane 拓扑。
- 显示配置可以应用到当前 pane view。
- 可以编辑保存的 base config、tmux 名称、socket 和 start command。

### 10.3 PromptDialog

用于轻量单字段输入：

- Rename Window
- Rename Workspace
- Rename Group
- Rename saved launch

不为每个 Rename 功能创建独立 Dialog。

### 10.4 ConfirmDialog

用于：

- 删除 Terminal 配置
- 删除 tmux 配置
- 删除 Window 配置
- 删除 Workspace 配置
- 删除 Group
- 关闭仍有运行任务或 pane 的 Workspace/Window

危险操作按钮使用 Error 语义，取消按钮优先获得初始焦点。

### 10.5 字段校验与操作错误

必须区分：

- 字段校验错误：显示在对应字段附近，不弹 Modal。
- 提交操作错误：使用 blocking ErrorDialog。
- 后台生命周期错误：可在 Pane 内显示 Banner。

例如：

- SSH host 为空 → 字段级错误；
- 创建 SSH 连接失败 → ErrorDialog；
- tmux Controller 意外退出 → Pane Banner + Retry。

### 10.6 Blocking ErrorDialog

ErrorDialog 必须阻止用户在关闭之前执行其他操作。

行为：

1. 打开时给 AppShell 主体设置 `aria-hidden` / `inert`。
2. 禁止点击 Overlay 关闭。
3. 禁止 Escape 关闭。
4. 禁止打开其他 Dialog、ContextMenu 或执行快捷键。
5. 焦点固定在 ErrorDialog 内。
6. 只有明确点击 Acknowledge 才可关闭。
7. 若连续出现多个错误，使用队列，每次只显示一个。

结构：

```text
ErrorDialog
├─ ErrorTitle
├─ ErrorMessage
├─ OptionalDetails
└─ Acknowledge
```

选项：

- `Show details` 展开技术信息。
- `Copy details` 复制错误。
- 默认不显示堆栈和敏感信息。

### 10.7 Dialog 互斥与提交锁

- 同一时间只允许一个主 Dialog 处于打开状态。
- Dialog submitting 时禁止重复提交和关闭。
- ErrorDialog 优先级高于普通 Dialog。
- 普通 Dialog 打开时，不允许再打开另一个普通 Dialog。
- Toast 不得抢占 Dialog 焦点。

## 11. View Model 规则

UI 只能消费 View Model，不直接组合多个领域聚合。

```text
Workspace + Terminal 索引
  → PaneViewData

Workspace + TmuxController
  → TmuxWindowViewData

Workspace + Terminal/TmuxPane
  → PaneTargetDisplayInfo[]

SavedLaunchConfig[]
  → ManagerListItemViewData[]
```

View Model 必须在 feature 内生成，不得放入 `shared/ui`。

### 11.1 状态切片

新代码不得继续依赖大而全的 `useSession()`。按实际职责使用：

| Hook                    | 职责                                           |
| ----------------------- | ---------------------------------------------- |
| `useSavedLaunchConfigs` | 保存的 Terminal/tmux 配置、分组及配置管理动作  |
| `useTerminalRuntime`    | Live Terminal 列表、运行状态、输入、关闭和重连 |
| `useWorkspaceLayout`    | Workspace、Window、Pane 布局及快照管理         |
| `useSessionPreferences` | 终端相关全局偏好                               |

`useSession()` 仅作为 legacy 兼容聚合入口保留，不得在新增组件中继续使用。

## 12. 组件与 Model 映射

| UI 组件                 | 主要 Model                                | 派生 View Model          |
| ----------------------- | ----------------------------------------- | ------------------------ |
| NavBar                  | 无业务 Model                              | Window UI State          |
| Toolbar                 | 无业务 Model                              | Active Tool              |
| TerminalManager         | `SavedLaunchConfig`                       | TerminalManagerItem      |
| TmuxManager             | `SavedLaunchConfig`                       | TmuxManagerGroup         |
| WindowManager           | `SavedWindowSnapshot`                     | SavedWindowItem          |
| WorkspaceManager        | `WorkspaceSnapshot`                       | SavedWorkspaceItem       |
| WindowTabBar            | `WorkspaceWindow[]`                       | WindowTabItem            |
| WindowPaneArea          | `RawWindow`、`TmuxWindowReference`        | WindowPaneViewData       |
| Pane                    | `RawPaneNode`、`TmuxPane`、`Terminal`     | PaneViewData             |
| TerminalView            | `Terminal`                                | TerminalViewData         |
| GlobalTextSender        | `PaneTargetRef`、`TerminalStreamRef`      | TextSenderViewData       |
| BottomBar RuntimeStatus | `Workspace`、`Terminal`、`TmuxController` | RuntimeStatusViewData    |
| BottomBar               | `Workspace[]`                             | WorkspaceQuickSwitchData |

## 13. 交互流程

### 13.1 打开工具面板

```text
用户点击 Toolbar 工具
  → AppShell 更新 activeTool
  → ToolPanel 显示对应 Manager
  → Manager 从 selectors 读取 View Model
```

### 13.2 打开 TextSender

```text
用户点击 BottomBar TextSenderToggle
  → AppShell 更新 isTextSenderOpen
  → MainArea 底部展开 GlobalTextSender
  → 保留输入标签、模式、速率和当前执行状态
```

### 13.3 指定 Pane

```text
用户打开 TargetSelector
  → 按 Workspace / Window / Pane 展示
  → 用户选择 PaneTargetRef
  → Application Resolver 解析当前 TerminalStreamRef
  → TextSender 更新 Target 信息和发送可用状态
```

### 13.4 Workspace 快速切换

```text
用户点击 BottomBar WorkspaceQuickSwitch
  → 打开切换菜单
  → 选择 Workspace
  → 更新 Active Workspace
```

## 14. 尺寸与响应式

- Toolbar 保持固定宽度，不随 ToolPanel 变化。
- ToolPanel 默认 200px，最小 140px，最大 400px。
- LeftSidebar 总宽度 = Toolbar + 已展开 ToolPanel。
- GlobalTextSender 默认高度 400px，可垂直拖拽并限制在 180–720px。
- TextSender 折叠后不占高度。
- 所有尺寸使用 DESIGN.md token 或文档化常量。
- 窗口宽度不足时优先压缩 MainArea，不压缩 Toolbar。

## 15. 可访问性

- Toolbar 和 BottomBar 按钮必须有可访问名称。
- 当前 Tool、Workspace、Target 和 TextSender 开关状态必须通过 ARIA 暴露。
- 关闭 ToolPanel 后焦点回到对应工具按钮。
- TextSender 打开时不会强制抢占 Terminal 焦点。
- 目标失效、连接错误和执行状态不能只通过颜色表达。
- 所有 Dialog 使用统一焦点管理。

## 16. 加载与错误状态

所有全局区域至少定义：

- Initializing
- Empty
- Ready
- Error

### Left ToolPanel

- 无数据：显示 Manager 空状态；
- 加载失败：在 Panel 内显示可重试错误；
- 不阻塞 MainArea。

### MainArea

- 无 Workspace：显示创建入口；
- 无 Window：显示 Empty Window；
- Terminal 异常：只影响对应 Pane；
- Tmux Controller 异常：只影响引用该 Controller 的 Windows。

### GlobalTextSender

- 无可用 Target：显示引导；
- Target 失效：显示 Unavailable；
- 发送失败：停留在当前 Target 并显示错误。

### Manager

- ScrollArea 为空时显示 Empty State；
- Header 和 Footer 始终显示；
- Footer 操作不会因列表为空而隐藏。

### Dialog

- 字段校验留在 Dialog 内；
- 操作失败使用 blocking ErrorDialog；
- 同一时间只有一个主 Dialog；
- 提交中不能重复触发表单动作。

## 17. 分阶段落地

### Phase 1：Shell 布局

- AppShell
- NavBar
- LeftSidebar / Toolbar / ToolPanel
- MainArea
- BottomBar
- GlobalOverlayHost

此阶段只做容器和占位内容。

### Phase 2：全局唯一组件

- Manager 面板接入
- WorkspaceQuickSwitch
- GlobalTextSender 壳和 TargetSelector

此阶段保留现有功能动作，不迁移全部业务逻辑。

### Phase 3：Model 对接

- Terminal/tmux Tauri command 与 event adapter
- 配置 Manager View Model
- Terminal/tmux 状态 Manager View Model
- Workspace Pane 位置选择器
- PaneTargetRef 解析和用户显示信息

### Phase 4：现有代码改造

- 新 Shell 已接入配置/状态 Manager
- 新 Shell 已接入 WorkspaceView、BottomBar 和 TextSender
- 四个 Dialog 已拆分并接入运行时新 Shell
- 会话/workspace/pane 状态内核已迁移到 `features/sessions/state`
- 全局状态已拆为配置、运行时、布局和偏好四个切片
- 旧 Sidebar / BottomBar / CommandSendPanel 已移除
- Terminal/tmux 命令与事件统一经过 feature-local infrastructure adapter
- AGENTS.md 和目录规则已同步

## 18. 验收标准

- 应用级区域只有一个实例。
- ToolPanel 同一时间只显示一个工具。
- TextSender 只存在于 MainArea 底部。
- BottomBar Workspace 按钮打开快速切换菜单。
- TerminalManager 底部固定显示 New Terminal 和 New Group。
- Tmux Manager 按 Base Configuration 自动分组；Window/Workspace Manager 不使用 Group。
- TerminalManager 和 TmuxManager 只显示保存配置。
- BottomBar RuntimeStatus 只显示当前聚焦 Pane 的名称、类型、目标/层级、尺寸和 Pane 序号。
- 四个创建/编辑 Dialog 独立存在。
- ErrorDialog 关闭前阻止其他操作。
- 所有 Pane 可以通过 `PaneTargetRef` 被选中。
- UI 不直接调用 Tauri。
- `shared/ui` 不依赖任何 Model。
- Terminal 与 tmux 的布局所有权保持分离。
- 现有 Terminal、tmux 和 Workspace 功能在迁移期间不中断。
