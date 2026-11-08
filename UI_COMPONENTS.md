# XSTerm UI 组件与 Shell 设计

> 本文档定义 XSTerm 应用级 UI 组件、布局归属、状态边界和 Model 契约。
> 视觉规范以 [DESIGN.md](./DESIGN.md) 为权威；本文档不得覆盖颜色、字体、圆角、
> 间距和组件视觉模式。

## 1. 状态

- 当前阶段：设计稿
- 实施状态：Phase 1–2 静态 Shell 与占位组件已落地
- 目标：先固定 UI 壳层和组件边界，再实现功能，最后迁移现有组件

预览入口：

```powershell
$env:VITE_UI_PREVIEW = "true"
npm run tauri dev
```

浏览器预览可使用：

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
- Terminal Status Manager
- tmux Status Manager
- Settings

约束：

- 仅图标或紧凑图标加标签。
- 同一时间只有一个 Active Tool。
- 所有按钮必须有 `aria-label` 和 tooltip。
- 焦点不会因 ToolPanel 开关而丢失。
- Toolbar 按“配置管理 / 运行状态 / 设置”分组，使用 hairline 分隔。

分组建议：

```text
Configuration
├─ TerminalManager
├─ TmuxManager
├─ WindowManager
└─ WorkspaceManager

Runtime Status
├─ TerminalStatusManager
└─ TmuxStatusManager

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
  | "terminal-manager"
  | "terminal-status-manager"
  | "tmux-manager"
  | "tmux-status-manager"
  | "window-manager"
  | "workspace-manager"
  | "settings";
```

### 6.6 Manager 组件

Managers 都是 feature UI，不直接挂在 MainArea。

| 组件                  | Model 来源                       | 主要动作                              |
| --------------------- | -------------------------------- | ------------------------------------- |
| TerminalManager       | `SavedLaunchConfig[]` View Model | 创建、编辑、删除、打开 Terminal 配置  |
| TerminalStatusManager | `Terminal[]` View Model          | 查看 Local/SSH Terminal 运行状态      |
| TmuxManager           | `SavedLaunchConfig[]` View Model | 创建、编辑、attach、打开 tmux 配置    |
| TmuxStatusManager     | `TmuxController[]` View Model    | 查看 tmux Controller/Window/Pane 状态 |
| WindowManager         | `SavedWindowSnapshot[]`          | 加载、重命名、删除 Window 配置        |
| WorkspaceManager      | `WorkspaceSnapshot[]`            | 加载、重命名、删除 Workspace 配置     |
| SettingsPanel         | Settings View Model              | 修改全局设置                          |

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
TerminalStatusManager 展示。

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
TmuxStatusManager 展示。

约束：

- 不使用 Group。
- 不显示 New Group。
- New tmux Session 打开 `CreateTmuxDialog`。

#### TerminalStatusManager

用途：

- 显示当前所有 Live `Terminal`。
- 不显示保存配置。
- 不提供创建操作。

列表字段：

- Terminal title
- Local/SSH 类型
- Connected / Connecting / Disconnected / Failed
- 所在 Workspace / Window / Pane
- 关联的 `SavedLaunchConfig` 名称（如有）
- 最近活动时间

行操作：

- Focus：切换到对应 Pane。
- Reconnect：仅当 capability 支持时显示。
- Close：关闭运行实例。

Footer：

- 默认不显示创建按钮。
- 状态统计和筛选可以放在 Header。

#### TmuxStatusManager

用途：

- 显示当前所有 Live `TmuxController`。
- 展开后显示其 Window 和 Pane。
- 不显示保存配置。

Controller 字段：

- tmux session / socket 或配置名称
- Connected / Connecting / Exited / Failed
- Local/SSH 启动方式
- Window 数量
- Pane 数量

Window/Pane 字段：

- `@window` / `%pane`
- Window name
- Active Pane
- 对应 Workspace / Window

行操作：

- Focus：切换到对应 tmux Window/Pane。
- Retry：Controller exited 时可重试。
- Dismiss Error：清理错误状态。

Footer：

- 默认不显示创建按钮。

#### 状态 Manager 布局例外

TerminalStatusManager 和 TmuxStatusManager 属于只读状态面板：

- 保留 Header 和可滚动列表。
- 不显示创建型 Footer。
- 行级操作通过 Context Menu 或紧凑 Action Button 提供。

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
├─ TextSenderHeader
├─ PaneTargetSelector
├─ CommandEditor
├─ ExecutionControls
├─ ScheduleControls
└─ TargetExecutionStatus
```

### 8.3 Target 选择

- 必须显式选择目标 Pane。
- 支持 Raw Pane 与 tmux Pane。
- 主显示使用标题、breadcrumb 和可用状态。
- 原始后端 Terminal ID 不作为主标识。
- tmux `@window`、`%pane` 可以作为辅助技术 ID 显示。

View Model：

```ts
interface TextSenderViewData {
  targets: PaneTargetDisplayInfo[];
  selectedTarget: PaneTargetRef | null;
  resolvedTarget: ResolvedPaneTarget | null;
  draft: string;
  executionState: CommandExecutionState;
}
```

### 8.4 状态归属

TextSender 全局只有一个 UI 实例，但每个 Target 独立保存：

- 草稿；
- 发送模式；
- 次数；
- 间隔；
- 断点；
- 队列；
- 当前执行状态；
- 错误信息。

Target 失效时：

- 历史记录保留；
- 标记 Unavailable；
- 禁止继续发送；
- 不自动迁移到其他 Pane。

### 8.5 显示位置

- 只占 MainArea 底部。
- 高度可拖动调整。
- 打开状态和高度持久化。
- 与 MainArea 之间使用 `--hairline` 分隔。
- 不把 TextSender 建模为新的 PaneNode。

## 9. BottomBar

常驻应用底部，主要入口：

```text
BottomBar
├─ WorkspaceQuickSwitch
└─ TextSenderToggle
```

### 9.1 WorkspaceQuickSwitch

- 打开 Workspace 快速切换菜单。
- 显示当前 Workspace 名称。
- 支持切换和关闭 Workspace。
- 菜单包含 Manage Workspaces 入口，跳转到 WorkspaceManager。
- 不直接展开 LeftSidebar，除非用户选择 Manage。

### 9.2 TextSenderToggle

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

#### CreateTmuxDialog

- 独立于 CreateTerminalDialog。
- 必须选择基础 Local/SSH 配置。
- 字段分组遵循 TmuxLaunchConfig。
- 支持创建新 tmux 或 attach 现有 tmux。

#### EditTerminalDialog

- 编辑保存配置，不直接修改现有运行时 Terminal 身份。
- 显示配置可以应用到当前运行实例。
- 连接配置的修改默认用于下一次启动，界面必须明确提示。

#### EditTmuxDialog

- 编辑保存的 tmux launch config。
- 不直接修改 tmux-owned window/pane 拓扑。
- 显示配置可以应用到当前 pane view。

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

## 12. 组件与 Model 映射

| UI 组件               | 主要 Model                            | 派生 View Model          |
| --------------------- | ------------------------------------- | ------------------------ |
| NavBar                | 无业务 Model                          | Window UI State          |
| Toolbar               | 无业务 Model                          | Active Tool              |
| TerminalManager       | `SavedLaunchConfig`                   | TerminalManagerItem      |
| TerminalStatusManager | `Terminal[]`                          | TerminalStatusItem       |
| TmuxManager           | `SavedLaunchConfig`                   | TmuxManagerItem          |
| TmuxStatusManager     | `TmuxController[]`                    | TmuxStatusItem           |
| WindowManager         | `SavedWindowSnapshot`                 | SavedWindowItem          |
| WorkspaceManager      | `WorkspaceSnapshot`                   | SavedWorkspaceItem       |
| WindowTabBar          | `WorkspaceWindow[]`                   | WindowTabItem            |
| WindowPaneArea        | `RawWindow`、`TmuxWindowReference`    | WindowPaneViewData       |
| Pane                  | `RawPaneNode`、`TmuxPane`、`Terminal` | PaneViewData             |
| TerminalView          | `Terminal`                            | TerminalViewData         |
| GlobalTextSender      | `PaneTargetRef`、`TerminalStreamRef`  | TextSenderViewData       |
| BottomBar             | `Workspace[]`                         | WorkspaceQuickSwitchData |

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
  → 保留上次 Target 和每个 Target 的状态
```

### 13.3 指定 Pane

```text
用户打开 TargetSelector
  → 按 Workspace / Window / Pane 展示
  → 用户选择 PaneTargetRef
  → Application Resolver 解析当前 TerminalStreamRef
  → TextSender 显示该 Target 的草稿和执行状态
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
- GlobalTextSender 默认高度建议 220px，最小 120px，最大不超过 MainArea 的 50%。
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

- View Model / Selector
- PaneTargetRef 解析
- Terminal 与 tmux 的 View Model 汇合

### Phase 4：现有代码改造

- 迁移 Sidebar
- 迁移 BottomBar
- 迁移 CommandSendPanel
- 拆分全局 Context
- 更新 AGENTS.md 和目录规则

## 18. 验收标准

- 应用级区域只有一个实例。
- ToolPanel 同一时间只显示一个工具。
- TextSender 只存在于 MainArea 底部。
- BottomBar Workspace 按钮打开快速切换菜单。
- TerminalManager 底部固定显示 New Terminal 和 New Group。
- Tmux/Window/Workspace 配置 Manager 底部固定操作且不使用 Group。
- TerminalManager 和 TmuxManager 只显示保存配置。
- TerminalStatusManager 和 TmuxStatusManager 分别显示 Live Terminal 和 TmuxController 状态。
- 四个创建/编辑 Dialog 独立存在。
- ErrorDialog 关闭前阻止其他操作。
- 所有 Pane 可以通过 `PaneTargetRef` 被选中。
- UI 不直接调用 Tauri。
- `shared/ui` 不依赖任何 Model。
- Terminal 与 tmux 的布局所有权保持分离。
- 现有 Terminal、tmux 和 Workspace 功能在迁移期间不中断。
