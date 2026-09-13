# 0009 — tmux-control-window：在 workspace 顶部挂一个 session/window 控制 UI

> **状态：Accepted（待落地）** —— 2026-09-13 用户拍板 A1-A9 默认假设。

## 1. Context

xsterm 当前模型里"tmux session" 没有 UI 表示。一个 `TmuxController`（≈ 1 个 tmux server-side session）只通过 `attached_tmux.json` 一行记录 + 多个 `Window{ xstermWindowId }` 体现，用户视角只能从 workspace 顶部 tab 条看出"这里有些 tmux window"。缺失：

- **session 级操作**：断链当前 xsterm ↔ tmux server、重连、远程删 tmux session
- **window 级操作的批量入口**：列出所有 tmux window + 它们下面的 pane、对每个做 rename / 断链 / 远程删 / 新建

当前 `Pane.tsx` 右键菜单有 `New Tmux Window / Rename Tmux Window / Close Tmux Window` 三个 item（src/components/Pane.tsx:222-254），但**只能从单一 pane 进入**；用户视角下"我在操作哪个 window" 不直观。

**本 ADR 决定**：给一个 tmux controller 配一个特殊的"control-window"（`windowType: "tmux-control"`），和其他 tmux window 一起混排在 workspace 顶部 tab 条；control-window 内部渲染 `session-control` 和 `windows-control` 两个区。

## 2. 决策

### 2.1 术语

| 术语 | 定义 |
|---|---|
| **tmux-control-window** | `Window{ windowType: "tmux-control", tmuxControlWindowId: u32, tmuxControlName: string }` —— 一个 controller 一个，**不带** `xstermWindowId`（因为它不对应 tmux window） |
| **普通 tmux-window** | `Window{ windowType: "terminal", xstermWindowId: u32 }` —— 1:1 对应 tmux server 上的一个 window |
| **tmuxControlWindowId** | control-window 的"id"——直接用 `TmuxController::controller_id`（u32）。让 listener 在 attach 时把 windows 关联到正确的 controller，让 windows-control 区域调 kill/rename/new-window 时知道往哪个 controller 发 |
| **tmuxControlName** | control-window 的 tab 名 = 创建 tmux session 时的 `tmuxSessionName` |

### 2.2 一个 tmux session ≠ 一个 workspace

attach / create tmux session 时，把 "1 control + N 普通 windows" **追加到当前活动 workspace**的 `windows[]`；**不**新建 workspace、**不**调 `createWorkspaceFromSession`。

- 若活动 workspace 不存在（首次启动），先 `createDefaultWorkspace()` 再追加。
- 多个 tmux session 的 windows 可混排在同一 workspace（按 attach / 创建顺序）。

### 2.3 Window 类型扩展（src/types/session.ts:29-45）

```ts
export interface Window {
  //既有字段不变 ...
  windowType?: "terminal" | "init" | "tmux-control";   // 新增 "tmux-control"

  /** tmux window 对应的 xsterm_window_id（u32）。仅"普通 tmux-window" 携带。*/
  xstermWindowId?: number;

  /** tmux controller id（u32）。tmux-control-window 专用：让 listener / windows-control 定位到 controller。*/
  tmuxControlWindowId?: number;

  /** tmux session name。tmux-control-window 专用：tab 名 + windows-control 区标题。*/
  tmuxControlName?: string;
}
```

### 2.4 关闭语义（关键约束）

| 操作 | 行为 | 后端调用 |
|---|---|---|
| tab × / 双击关闭**普通 tmux-window** | **仅断链**该 xsterm Window ↔ tmux server；tmux server 上的 window **保留** | `closeSession` 每个 leaf pane（当前行为，不调 `kill_tmux_window`） |
| tab × / 双击关闭**tmux-control-window**（带 confirm）| **断链**同 workspace 内该 controller 的**所有**普通 tmux window + 删 control-window 自身；tmux server 上的 session + windows **全部保留** | `closeSession` 每个 leaf + `unmark_attached_tmux(controllerId)` |
| session-control "Disconnect" | fire-and-forget 写 `detach-client` 到 controller stdin，drop controller；前端所有该 controller 的 window 断链变灰 | `detach_tmux_controller(controllerId)` 新增命令 |
| session-control "Reconnect" | 用 `attached_tmux.json` 里的 config 重新走 `attachTmux` | `attachTmux(config)` |
| session-control "Remote delete" | tmux server 上 `kill-server` + 关闭 control-window（→ §2.4 第 2 行触发） | `kill_server_via_controller(controllerId)` + 关闭 |
| windows-control 单项 "Rename" | tmux server 上 `rename-window` | `rename_tmux_window(xid, name)` |
| windows-control 单项 "Disconnect" | 仅断链该 xsterm Window | （同 tab × 关闭）|
| windows-control 单项 "Delete from tmux server" | tmux server 上 `kill-window` | `kill_tmux_window(xid)` |
| windows-control "+ New Window" | tmux server 上 `new-window` | `create_tmux_window(controllerId, name?)` |

### 2.5 tab bar 渲染

`WindowTabBar`（src/components/WindowTabBar.tsx）按 `workspace.windows[]` 顺序渲染。control-window 的 tab 名称加 ⏵ 前缀视觉区分（可选，但建议加 —— 让用户一眼看出"这是 session 控制 tab"）。

关闭 control-window 的 × / 双击触发 `confirm()` 防误关，文案：
> "Close this session? All windows will disconnect from tmux server. The session itself stays on the server."

### 2.6 control-window 内容（TmuxControlWindowView）

两区并排（doc/design-system.md §10 hairline-only + radius 12px card）：

**session-control 区**（左侧）：
- 状态指示：connected / disconnected（轮询 controller 是否还在）
- 三个按钮：Disconnect / Reconnect / Remote delete（后者 danger 样式）
- 显示当前 tmux session name + controller id（debug 用）

**windows-control 区**（右侧）：
- 标题 "Windows of <tmuxSessionName>"
- 列表：每行 = `[@N] <name> [rename] [disconnect] [delete from server]`，缩进展示 pane
- 列表来源：`tmux-window-list` 事件（bridge 已发）+ `tmux-window-added/closed/renamed` 增量更新
- 底部 "+ New Window" 按钮（弹出名字输入 prompt，可选）

### 2.7 attach / create 路径行为

**删除** src/contexts/session/useSessionLifecycle.ts:155-169 中 `createAndActivateSession` 对 tmux-cc 的 `createWorkspaceFromSession` 分支。改为：

1. 调 backend `createTmux` / `attachTmux`（不变）。
2. 等 `%window-pane-changed` / `%window-list` 事件把所有现有 tmux window 映射完。
3. 在当前活动 workspace：
   - 若 workspace 不存在，先 `createDefaultWorkspace()`。
   - 插入 1 个 control-window，设 `activeWindowId` 指向它。
4. 现有 `tmux-window-added` listener（src/contexts/session/useTauriListeners.ts:320-415）继续往该 workspace 追加普通 window。

`tmux-window-added` listener 新增逻辑：判断"target workspace 是否已有 `tmuxControlWindowId === controllerId` 的 control-window"。**有** → 直接追加普通 window；**没有** → 先插入 control-window 再追加普通 window（同 controller id 的情况下）。这样同步创建和异步 attach 逻辑统一。

### 2.8 事件 listener 新增 / 微调

- `tmux-window-list`（bridge 已发）：前端新增 listener，把 controller 的全 window 列表写入前端 ref（用于 windows-control 初次渲染）。
- `tmux-window-added`：见 §2.7。
- `tmux-window-closed`：保留当前行为不变（删 xsterm Window）。
- `tmux-window-renamed`：保留当前行为不变（更新 xsterm Window name）。
- **新增** `tmux-controller-detached`：session-control Disconnect 触发后，关闭同 controller 下所有 xsterm Window。

### 2.9 后端最小新增

| 命令 | 用途 | 实现 |
|---|---|---|
| `detach_tmux_controller(controllerId)` | session-control Disconnect | fire-and-forget 写 `detach-client` 到 controller stdin + drop controller |
| `kill_server_via_controller(controllerId)` | session-control Remote delete | fire-and-forget 写 `kill-server` 到 controller stdin（fire-and-forget 因为命令会让 controller 自己死）|
| `unmark_attached_tmux(controllerId)` | control-window 关闭 / Remote delete 时清 `attached_tmux.json` | 直接改 store |

windows-control 区域**不需要**新后端命令：`tmux-window-list` 事件已提供全量数据。

### 2.10 Pane 右键菜单文案修订

src/components/paneContextMenu.ts:72-78 "Close Tmux Window" 文案改为 "Delete from tmux server"，强调破坏性操作。

## 3. Consequences

### 3.1 正面

- 一个 tmux session 在 UI 上有**显式的 session 级入口**（断链 / 重连 / 删）
- windows-control 区是 window 管理的"控制台"，比右键菜单更可发现
- 关闭 = 断链（默认）vs. 删除（明确入口）的语义清晰分离
- `attached_tmux.json` 在两条关闭路径下同步清理，下次启动不会"幽灵重连"

### 3.2 负面 / 风险

- 一个 workspace 可承载多个 tmux session 的 windows，UI 视角下"我现在看的是哪个 session" 需要靠 tab 前缀 + windows-control 区标题识别。**不引入** session 切换 UI（v0 之后再说）
- 首次 attach 时如果 listener 比 control-window 插入快，会出现"普通 window 先入 workspace 后补 control-window"。**风险低**：用 `tmux-window-list`（全量）+ `tmux-window-added`（增量）双事件兜底；若仍有时序问题，control-window 自动在 workspace **头部**重排
- control-window 关闭时序：先关所有普通 window（各自发 `tmux-window-closed` 事件）→ 再删 control-window → 再 unmark。**若中途出错**（如某 closeSession 失败），control-window 仍可下次手动关，不影响数据一致性
- "Disconnect" 后 Reconnect 期间，windows-control 列表来源会断流（listener 已 unlisten）—— **接受**：v0 期间 Disconnect 即"离开这个 session"，需重新 attach

### 3.3 不在本次范围

- 多 tmux session 跨 workspace 的 UI 切换
- tmux session 改名 / 贴标签 / key bindings
- windows-control 拖拽排序
- i18n（先英文，遵守 doc/design-system.md）

## 4. References

- 现有后端命令（已实现，本 ADR 不改）：`create_tmux_window` / `kill_tmux_window` / `rename_tmux_window`（src-tauri/src/commands/session.rs）
- 现有事件（已实现）：`tmux-window-added` / `tmux-window-closed` / `tmux-window-renamed` / `tmux-window-list`（src-tauri/src/services/tmux/bridge/mod.rs:190-250）
- 现有前端服务包装：src/services/sessionService.ts:270-317
- 现有 Pane 右键菜单：src/components/paneContextMenu.ts:65-79
- ADR 0005（tmux 分层重设计）—— 本 ADR 是其上的应用层改造
- ADR 0008（P8 删 v1 路径）—— 本 ADR 不动 v1/v2 内部，纯前端 + service 边界

## 5. 默认假设（A1-A9，用户已拍板）

| # | 假设 |
|---|---|
| A1 | control-window 的 "id" = `tmuxControllerId`（u32，对应 `TmuxController::controller_id`）|
| A2 | attach / create tmux session 时，"control + 普通 windows" 追加到**当前活动 workspace**（不新建 workspace）|
| A3 | 活动 workspace 不存在时（首次启动），先 `createDefaultWorkspace()` 再追加 |
| A4 | 一个 workspace 可承载多个 tmux session 的 windows（control + 普通混排）|
| A5 | control-window 的 tab 名称 = `tmuxSessionName`，不带前缀（⏵ 前缀可选）|
| A6 | 关闭 control-window 的确认 prompt 文案："Close this session? All windows will disconnect from tmux server. The session itself stays on the server." |
| A7 | 普通 tmux-window 的"远程删除" 入口放在 windows-control 区 + Pane 右键菜单 `Close Tmux Window` 文案改为 `Delete from tmux server` |
| A8 | session-control "Remote delete"：调 `kill_server_via_controller` + 关闭 control-window（→ §2.4 第 2 行触发）|
| A9 | `attached_tmux.json` 在"关闭 control-window" 和 "session-control Remote delete" 两条路径下都 remove 该 controller 记录 |