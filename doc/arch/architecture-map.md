# xsterm 架构地图

> 本文档是 xsterm 项目的全栈架构地图，目的是让不熟悉代码的人能在一小时内形成清晰的心智模型。重点在**模块边界、职责划分、复杂度热点**，细节请直接看代码。
>
> 与 `doc/frontend-architecture.md` 的关系：那份文档描述的是 **2026-07-02 时的目标态**（包含若干尚未实现或已被移除的 tmux 相关文件：`tmuxService.ts` / `TmuxSessionView.tsx` / `tmuxStateReducer.ts` / `types/tmux.ts`）。本文档描述的是 **当前仓库实际存在的文件**（2026-08-20 验证）。若两份文档冲突，以本文档为准。

---

## 1. 一句话总结

xsterm 是一个 Tauri 2 桌面终端模拟器：Rust 后端管 PTY/SSH 进程，前端用 React + xterm.js 渲染。状态集中在 SessionContext 里（按职责拆分到 11 个文件），通过 invoke 命令和 listen 事件与后端通讯。Shell UI 遵循一套 Cursor 风格的设计系统（见 `doc/design-system.md`），与终端 ANSI 主题是**两套独立系统**。

---

## 2. 技术栈

| 层级 | 技术 |
 | |
|---|---|
| 桌面壳 | Tauri 2（WebView2 on Windows, WKWebView on macOS, WebKitGTK on Linux） |
| 前端 | React 19 + TypeScript 5.8 + Vite 7 |
| 终端渲染 | xterm.js 6 + `@xterm/addon-fit` |
| 后端 | Rust（`portable-pty` + `russh` + `tauri-plugin-store` + `tracing`） |
| 持久化 | `tauri-plugin-store`（JSON 文件） |
| 样式 | 原生 CSS（无 CSS-in-JS / Tailwind）；设计系统 token 在 `src/styles/global.css` `:root` |
| 设计语言 | **Cursor 风格（暗色 IDE 适配版）** —— Cursor Orange `#f54e00` 强调色，hairline-only 深度，8px / 12px 圆角，Inter / system-ui sans + JetBrains Mono。完整规范见 [`doc/design-system.md`](design-system.md)。 |
| 状态管理 | React Context（**按职责拆分到 11 个文件**）+ `useState` / `useRef`（无 Redux/Zustand） |
| 测试 | Vitest（前端 `paneUtils.test.ts` 等）+ mockall（Rust 后端 `session_manager.rs` 内部 `#[cfg(test)]`） |

---

## 3. 仓库布局

```
xsterm/
├── src/                          # 前端（47 个 .tsx，23 个 .css）
│   ├── main.tsx                  # 入口
│   ├── App.tsx                   # Provider 组合
│   ├── assets/                   # 静态资源
│   │   ├── logo.svg              # NavBar wordmark（Cursor Orange tilde + xsterm path 几何字）
│   │   └── logo-icon.svg         # Favicon / app icon（单 tilde 波浪）
│   ├── components/               # 全部 UI 组件（42 个 .tsx，按职责分子目录）
│   │   ├── *.tsx                 # 顶层组件（14 个：AppLayout, NavBar, Pane, Terminal 等）
│   │   ├── sidebar/              # 侧栏（5 个：Sidebar, SessionManager, WorkspaceManager, WindowManager, SidebarToolbar）
│   │   ├── dialogs/              # 对话框（15 个：CreateSession, EditSession, LocalSession, SshSession, CommonSettings 等）
│   │   ├── settings/             # 设置页（1 个：SettingsView）
│   │   ├── ui/                   # UI 原语（3 个：Dialog, ContextMenu, FormField）
│   │   └── icons/                # SVG 图标合集（1 个：Icon.tsx，30+ 个 stroke 图标）
│   ├── contexts/                 # SessionContext / ThemeContext / LoggerContext
│   │   └── session/              # Session 上下文：**11 个文件**按职责拆分（详见 §4.3）
│   ├── hooks/                    # 7 个自定义 Hook（xterm 生命周期、IPC 桥接、拖拽、快捷键）
│   ├── services/                 # IPC 调用层（sessionService / sessionStorage）
│   ├── types/                    # session / theme / log / capabilities 类型定义
│   ├── utils/                    # paneTree / clipboard / sessionOutputBuffer
│   └── styles/                   # 全局样式（global.css / layout.css / pane.css）—— 设计系统 token 在 :root
│
├── src-tauri/                    # 后端（22 个 .rs）
│   └── src/
│       ├── main.rs               # 进程入口
│       ├── lib.rs                # Tauri builder + 插件注册 + SessionManager 状态
│       ├── logging_setup.rs      # tracing 初始化（注意：故意 mem::forget guard）
│       ├── error.rs              # 错误类型
│       ├── commands/             # #[command] 函数（薄壳，包一层 with_manager）
│       │   ├── mod.rs            # all_handlers() 聚合
│       │   ├── session.rs        # create_local_session / create_ssh_session / write_session 等
│       │   ├── persistence.rs    # save_sessions / load_sessions / save_groups / load_groups
│       │   └── logging.rs        # log_message / get_log_config / set_log_config / get_log_dir
│       ├── services/             # 业务逻辑
│       │   ├── session_manager.rs    # 中枢：所有会话注册表 + trait-based 可测试（~2545 行含测试）
│       │   ├── local_session/        # 本地 PTY session（详见 §5 业务模块统一为目录）
│       │   │   ├── mod.rs            # 公开 API: create_local_session
│       │   │   ├── resolution.rs     # shell path / cwd / WSL detection 等 pre-spawn 纯函数
│       │   │   ├── spawn.rs          # PTY output forwarder（含 drain budget + UTF-8 边界处理）
│       │   │   ├── bytes.rs          # drain_should_break + utf8_safe_prefix_len 纯工具
│       │   │   └── tests.rs          # 单元测试（RecordingBackend fixture + 所有 tests）
│       │   ├── ssh_session/          # SSH session（919 行的 ssh.rs 由它消费）
│       │   │   └── mod.rs            # 公开 API: create_ssh_session（薄壳，与 tmux 对称）
│       │   ├── session_log.rs        # per-session 日志模块
│       │   └── tmux/                 # tmux -CC 集成（详见 §5.7）—— 类比 local_session / ssh_session 放在 services
│       │       ├── mod.rs            # facade + 重导出 TmuxController
│       │       ├── controller.rs     # 主状态机：TmuxController struct + 公开 API + 4 个 spawn_*_task
│       │       ├── dispatch.rs       # dispatch_event + spawn_dispatch_task（独立出来提高可读性）
│       │       ├── parser.rs         # line → ControlEvent 纯函数
│       │       ├── escape.rs         # unescape_output (octal → bytes)
│       │       ├── commands.rs       # 高层 API: send_keys / split_window / ...
│       │       └── events.rs         # ControlEvent enum
│       ├── infrastructure/       # 外部资源抽象（trait）
│       │   ├── pty.rs                # ptySystem trait（portable-pty 实现）
│       │   ├── ssh.rs                # SshBackend trait（russh 实现，919 行）
│       │   ├── app_backend.rs        # AppBackend trait（解耦 emit from Tauri）
│       │   └── tmux/                 # tmux transport 抽象（与 PtySystem / SshBackend 对齐）
│       │       ├── mod.rs
│       │       └── backend.rs        # Wave 5: TmuxBackend trait + Local / SSH impls
│       └── models/               # 数据模型
│           ├── session.rs            # LocalSessionConfig / SSHSessionConfig / TmuxCcConfig / SessionInfo
│           ├── group.rs
│           ├── capabilities.rs
│           └── log.rs
│
├── test/                         # 系统测试（不走 Vitest）
│   ├── smoke.spec.ts             # Selenium + node:test 启动 Tauri 应用
│   └── remote/                   # WebDriver 远程驱动（详见 test/README.md）
│
├── scripts/                      # 运维脚本
│   ├── start-webdriver.sh        # WSL 一键启动 WebDriver stack
│   └── windows/                  # PowerShell 脚本
│       ├── start-webdriver.ps1
│       └── screenshot-window.ps1
│
└── doc/                          # 设计 / 需求 / 缺陷文档
    ├── design-system.md          # ⭐ 设计系统完整规范（Cursor 暗色 IDE 适配版）—— 必读
    ├── architecture-map.md       # 本文件
    ├── frontend-architecture.md  # ⚠️ 过期文档（2026-07-02 目标态，与实际仓库不符）
    ├── bug.md                    # 已知 bug 历史 + 修复记录
    ├── create-session-config.md  # Create Session 配置完整参考
    ├── session-config-*.md       # Shell / SSH / Common 配置字段详表
    └── req-*.md                  # 需求文档
```

---

## 4. 前端架构

### 4.1 入口链

```
index.html → src/main.tsx → src/App.tsx → 3 个 Provider → <AppLayout>
```

`App.tsx` 依次包裹 `LoggerProvider` → `ThemeProvider` → `SessionProvider`（顺序敏感：Session 内的 `logger` 依赖 LoggerContext）。

### 4.2 组件树（按职责分组）

| 文件 | 职责 |
|---|---|
| `AppLayout.tsx` | 根布局：NavBar + Sidebar + 主区（activeWorkspaceId 决定渲染哪个 WorkspaceContainer）。维护 `activeView`（terminal/settings）和 `showCreateDialog`。 |
| `NavBar.tsx` | 自定义标题栏（`decorations: false`）。通过 `getCurrentWindow()` 读窗口状态。**Logo** 用 path 几何字 + Cursor Orange tilde（见 `assets/logo.svg`）。 |
| `WindowTabBar.tsx` | 单个 window 内的标签栏（在 WorkspaceContainer 内使用）。 |
| `TabBar.tsx` | 顶层 workspace 标签栏。 |
| `WorkspaceContainer.tsx` | 单个 workspace 的容器：WindowTabBar + PaneTree/InitWindowView，处理 window 级 save/rename/close。 |
| `PaneTree.tsx` | `PaneNode` 树的递归渲染。叶子 → `<Pane>`，split → `<SplitNode>`（div + 拖拽分隔条）。 |
| `Pane.tsx` | 单个叶子 pane：渲染 `<Terminal>` 或 `<PaneInitCard>`。右键菜单提供 split / attach / close，配合 `<SelectSessionDialog>` 完成"分屏还是绑定"二选一。 |
| `Terminal.tsx` | **xterm.js 封装层**：xterm 生命周期、xterm.onData → `writeSession`、粘贴去重、sessionId 变化时 `xterm.reset()`、断连时仅 Enter 触发重连。 |
| `TerminalContainer.tsx` | **已废弃**（15 行空壳），保留以兼容外部引用。实际渲染走 `<Terminal>`。 |
| `EmptyState.tsx` / `InitWindowView.tsx` / `PaneInitCard.tsx` | 空态 / 初始化的不同展示形态。 |
| `CommandSendPanel.tsx` | 命令广播面板（行 / 字符分割模式、重复次数、间隔、目标 window/pane 选择、breakpoint gutter、textarea 编辑器）。 |
| `WorkspaceBottomBar.tsx` | 底部状态栏：workspace 切换下拉、Emit toggle。 |
| **dialogs/**（15 个） | |
| `dialogs/CreateSessionDialog.tsx` | 创建 local / SSH 会话表单（Shell / SSH top tabs + 7 个 sidebar sections + 右侧滚动 panel）。 |
| `dialogs/EditSessionDialog.tsx` | 编辑已保存的 session config（同 CreateSessionDialog 结构）。 |
| `dialogs/SelectSessionDialog.tsx` | 选择已存在会话或 saved config 用于分屏。**Bug 002 修复点**：用 `isSubmittingRef` 防止重复点击。 |
| `dialogs/LocalSessionForm.tsx` / `SshSessionForm.tsx` / `SshConnectionSection.tsx` | Session 配置的细分表单。 |
| `dialogs/CommonSettingsForm.tsx` | Display / Keyboard / Security / Logging 的 `< `< details `>` 折叠分组，**被 CreateSessionDialog 和 EditSessionDialog 共用**。 |
| `dialogs/DisplayConfigForm.tsx` | Terminal display 配置（font family、font size、cursor style、scrollback、bell、colors）。 |
| `dialogs/FormTextField.tsx` / `FormSelectField.tsx` / `FormNumberField.tsx` / `FormCheckboxField.tsx` | 4 个表单字段原子组件（重构自旧的 FormField + 内联 input）。 |
| `dialogs/CollapsibleSection.tsx` | 可折叠面板组件（被多个 form 使用）。 |
| `dialogs/SessionFormLayout.tsx` | SessionForm 的统一布局壳（top tabs + sidebar + panel）。 |
| `dialogs/SaveDialog.tsx` / `SaveWorkspaceDialog.tsx` | 通用保存对话框。 |
| `dialogs/EditGroupDialog.tsx` / `NewGroupDialog.tsx` | Group 编辑/创建。 |
| **sidebar/**（5 个） | |
| `sidebar/Sidebar.tsx` / `SidebarToolbar.tsx` | 左侧栏（48px icon toolbar + 可拖拽 submenu）。 |
| `sidebar/SessionManager.tsx` | SavedSessionConfig 列表（按 group 分组），CRUD。 |
| `sidebar/WorkspaceManager.tsx` / `WindowManager.tsx` | saved workspace / saved window 的管理。 |
| **settings/**（1 个） | |
| `settings/SettingsView.tsx` | 终端主题选择器（5 个 ANSI 主题）+ 快捷键列表 + about。 |
| **ui/**（3 个） | |
| `ui/ContextMenu.tsx` | 右键菜单（imperative ref API，positioned fixed）。 |
| `ui/Dialog.tsx` | 通用对话框壳（overlay / header / footer / 可选 sidebar 布局 / 关闭按钮）。 |
| `ui/FormField.tsx` | label + child wrapper（**保留以兼容老代码**，新代码应优先用 dialogs/FormXxxField）。 |
| **icons/**（1 个） | |
| `icons/Icon.tsx` | SVG 图标合集（30+ 个 stroke 图标，用 currentColor 传播）。 |

### 4.3 Context 形状

#### SessionContext（**按职责拆分到 11 个文件**）

| 文件 | 行数 | 职责 |
|---|---|---|
| `useSessionState.ts` | ~120 | 持有 sessions / savedConfigs / savedWorkspaces / savedWindowConfigs / groups / nextGroupId / globalLocalEcho / sessionLocalEchoOverrides（Map）和它们的 setter。 |
| `useSessionPersistence.ts` | 122 | 把上述 state 每次变更自动写入 `sessions.json` / `settings.json`（通过 `sessionStorage` 服务 + `tauri-plugin-store`）。 |
| `useSessionLifecycle.ts` | ~268 | **会话生命周期**：createLocalSession / createSshSession / openFromConfig / closeSession / reconnectSession。 |
| `useGroupActions.ts` | ~100 | createGroup / addToGroup / moveConfigToGroup / renameGroup / deleteGroup / toggleGroup。 |
| `usePaneActions.ts` | ~258 | splitPane / updateWindowPaneTree / setActivePane / closePane。 |
| `useWindowActions.ts` | ~188 | createWindow / createWindowFromSession / createWindowFromSavedConfig / renameWindow。 |
| `useWorkspaceActions.ts` | ~370 | createWorkspaceFromSession / saveWorkspace / loadWorkspace / closeWorkspace / 持久化（带回滚）。 |
| `useSavedWindowActions.ts` | ~157 | saved window config CRUD。 |
| `useSavedWorkspaceActions.ts` | ~29 | saved workspace CRUD（薄壳）。 |
| `useSessionActions.ts` | **198** | **组合入口**：导出最终的 `SessionContextType`（这是过去 1276 行单文件的产物，已大幅拆分）。 |
| `useSessionActions.helpers.ts` | 84 | 组合用的辅助函数（unique name 解析等）。 |
| `useTauriListeners.ts` | ~80 | `listen("session-disconnected")` / `listen("session-closed")` → 更新 React state。 |
| `types.ts` | ~150 | SessionContextType 接口（一个文件看完所有 action 签名）。 |
| `paneUtils.ts` | 271 | 25 个**纯函数**（布局系统的核心算法，已加 Vitest 覆盖，48 个用例）。 |

**关键改进**：过去 `useSessionActions.ts` 单文件 **1276 行**是最大复杂度热点，2026-08 重构后**降至 198 行**，每个职责一个 hook，单 hook 最大 ~370 行（`useWorkspaceActions.ts`）。详情见 §11 "重构记录"。

#### ThemeContext

- `currentTheme: TerminalTheme` / `currentThemeKey` / `setTheme(key)`
- 数据源：`src/types/theme.ts` 里的 `PRESET_THEMES`（5 个 ANSI 主题：dark / light / monokai / oneDark / dracula）
- **作用域**：**仅控制 xterm.js 终端内容**（ANSI 颜色）。**Shell UI chrome 的主题**（`src/styles/global.css` `:root`）是独立系统，不受 ThemeContext 控制。详见 `doc/design-system.md` §"Two independent theme systems"。

#### LoggerContext

- 4 个级别（debug / info / warn / error），同时写到 `console` 和 `invoke("log_message")`（Rust 侧 rolling log 文件）
- **额外导出**一个 `logger` 单例，供 service 层等 React 树外模块使用

### 4.4 IPC 服务层

`src/services/sessionService.ts` 是全部 invoke 的统一出口（**7 个函数**）：

| 函数 | Tauri 命令 | 备注 |
|---|---|---|
| `createSession(config)` | `create_session` | 通用入口（按 config.type 分发到 local/ssh） |
| `createLocal(config)` | `create_local_session` | |
| `createSsh(config)` | `create_ssh_session` | |
| `writeSession(id, data)` | `write_session` | Fire-and-forget（rAF 批量） |
| `resizeSession(id, rows, cols)` | `resize_session` | |
| `closeSession(id)` | `close_session` | |
| `listSessions()` | `list_sessions` | 列活跃会话（**有 wrapper，但当前未被任何调用点使用**） |
| `uploadImageToSshSession(id, filename, data)` | `upload_image_to_ssh_session` | SSH exec channel 传图 |

> 注：`createSession` 是新的通用入口；`createLocal` / `createSsh` 保留以兼容旧调用。

`src/services/sessionStorage.ts` 封装 `tauri-plugin-store`：单例 store + 异步 get/set，缓存于 module-level。

### 4.5 自定义 Hooks（7 个）

| 文件 | 用途 |
|---|---|
| `useXterm.ts` | 创建 `new XTerm()` + FitAddon，绑定到容器 div；包含纯函数 `themeToXtermTheme`（**易测**）。 |
| `useTauriTerminalOutput.ts` | `listen("session-output")` → 字节流解码 + OSC52 剪贴板提取 + RAF 批量写入 xterm + 缓冲回放。包含纯函数 `decodeOutput` / `decodeBase64Utf8` / `extractAndCopyOsc52`（**易测**）。 |
| `useTerminalResize.ts` | ResizeObserver → `FitAddon.fit()` → `resizeSession` IPC。 |
| `useDragResize.ts` | 鼠标拖拽分隔条 → 更新子 pane 百分比。 |
| `useAppShortcuts.ts` / `useShortcut.ts` | 全局快捷键注册。 |
| `useClampedPanelHeight.ts` | CommandSendPanel 高度自适应（clamp 在 min/max 之间）。 |

---

## 5. 后端架构

### 5.1 入口链

```
src-tauri/src/main.rs → lib.rs::run()
  → .plugin(...)
  → .setup(|app| { ... SessionManager 初始化 ... })
  → .invoke_handler(generate_handler![commands::all_handlers()])
  → .run(...)
```

### 5.2 分层与依赖方向

```
commands  →  services  →  infrastructure  →  models
   ↑             ↑              ↑
   └─────────────┴──────────────┘
              全部持有 State<Arc<Mutex<SessionManager>>>
```

- **`commands/`**：Tauri `#[command]` 函数。每个都是薄壳：`with_manager(state, |manager| manager.xxx(...))`。
- **`services/`**：纯业务逻辑。`SessionManager` 是中枢；`local_session` / `ssh_session` 处理各自会话类型。
- **`infrastructure/`**：trait 抽象外部资源（PTY / SSH / emit）。真实实现在 `NativePtySystem` / `RusshBackend` / `RealAppBackend`。
- **`models/`**：DTO 和配置结构。

### 5.3 SessionManager 是怎么组织的

```rust
// src-tauri/src/services/session_manager.rs
pub struct SessionManager {
    sessions: HashMap<u32, ActiveSession>,  // id → ActiveSession (Pty | Ssh)
    next_id: u32,
    pty_system: Box<dyn PtySystem + Send>,
    ssh_backend: Box<dyn SshBackend + Send>,
}

enum ActiveSession {
    Pty(Box<dyn SessionBackend + Send>),    // 本地 PTY session（type-erased）
    Ssh(Box<SshSessionWrapper>),            // SSH session（concrete 以读 SSHSessionConfig）
}
```

所有会话操作（write / resize / close）通过 `to_session_info()` 统一元数据，通过 `backend()` 统一读写分发。trait 注入使得 `mockall` 可以在测试中替换 PtySystem / SshBackend ——**Rust 单测能跑得好的核心原因**（见文件内 `#[cfg(test)] mod tests` 块，含 MockPtySystemM / MockSshBackendM 等）。

### 5.4 命令清单（14 个 #[command]）

| 文件 | 命令 | 说明 |
|---|---|---|
| `session.rs` | `create_local_session` | 启 PTY + 输出转发线程 |
| `session.rs` | `create_ssh_session` | SSH 连接 + 通道 + 输出线程 |
| `session.rs` | `write_session` / `resize_session` / `close_session` | 基础生命周期 |
| `session.rs` | `list_sessions` | 列所有活跃会话元数据 |
| `session.rs` | `upload_image_to_ssh_session` | SSH exec channel 传图 |
| `persistence.rs` | `save_sessions` / `load_sessions` | sessions.json |
| `persistence.rs` | `save_groups` / `load_groups` | groups.json |
| `logging.rs` | `log_message` / `get_log_config` / `set_log_config` / `get_log_dir` | 日志桥接 |

> **重要变化**：2026-08 之前 `list_sessions` 仅在 Rust 注册但**前端 `sessionService.ts` 没有 wrapper**。当前已加 wrapper，但**没有调用点**。如需用，看 §9。

### 5.5 数据流：用户键入到 xterm 显示

```
Terminal.tsx: xterm.onData(data)                        [1. 用户键入]
  ↓
writeSessionRef.current(sessionId, data)                [2. 前端编码]
  ↓
sessionService.writeSession → invoke("write_session")   [3. IPC]
  ↓
commands/session.rs: with_manager(...) → manager.write  [4. Rust 命令]
  ↓
ActiveSession::Pty → PTY master.write_all                [5a. 本地]
  或 ActiveSession::Ssh → channel.write_tx.send          [5b. SSH]
  ↓
shell / 远程命令产生输出
  ↓
输出转发线程 (本地 in local_session.rs / SSH in ssh_session.rs)
  reader loop → backend.emit("session-output", [id, bytes])
  ↓
infrastructure/app_backend.rs: RealAppBackend::emit
  ↓
Tauri 事件总线
  ↓
useTauriTerminalOutput.ts: listen("session-output")
  decode bytes → 提取 OSC52 → 入 buffer → RAF 批量 → xterm.write(text)
                                                           [6. 渲染到屏幕]
```

### 5.6 后端 spec 字段（Wave 1-3）

2026-08 完成的 session-config-enhancement 把 LocalSessionConfig / SSHSessionConfig / SessionDisplayConfig / SessionLoggingConfig 扩展成完整 spec。详见 `doc/create-session-config.md`、`doc/session-config-{shell,ssh,common}.md`。对应字段全部在 Rust 端镜像 + 默认值 + 持久化兼容（commit `7dbfa27` / `367b383` / `d8b4103` / `b292056`）。

### 5.7 tmux -CC 集成（Wave 0–5）

需求与设计见 [`doc/requirements/prd-0.1/req-006-tmux.md`](../requirements/prd-0.1/req-006-tmux.md)。本节只描述实际落地的架构。

**模块分层**（与 local / ssh 的分层方式一致）：

| 层 | 模块 | 职责 |
|---|---|---|
| 服务（业务/编排） | `services/tmux/` | tmux 客户端完整模块：协议解析 + 状态机 + 4 个 spawn task + dispatch + Promise 协调。**类比**：`services/local_session.rs`（PTY session 业务）/ `services/ssh_session.rs`（SSH session 业务）。 |
| 抽象（transport） | `infrastructure/tmux/backend.rs` | `TmuxBackend` trait + `LocalTmuxBackend` / `SshTmuxBackend` 实现。**类比**：`infrastructure/pty.rs`（`PtySystem`）/ `infrastructure/ssh.rs`（`SshBackend`）。 |

**为什么这么分**：local / ssh 的现有约定是"业务编排在 services，trait 抽象在 infrastructure"。tmux 因为有"多 pane controller + 协议编解码"，自然变成 services 子目录（5 个文件 + 1 facade），与单文件 `local_session.rs` / `ssh_session.rs` 形式不同但**分层逻辑一致**。

#### 5.7.1 `TmuxBackend` 抽象（Wave 5）

`infrastructure/tmux/backend.rs` 定义 trait：

```rust
pub trait TmuxBackend: Send + Sync + 'static {
    fn take_stdout(&mut self) -> Result<Box<dyn AsyncRead + Send + Unpin>, String>;
    fn take_stdin(&mut self)  -> Result<Box<dyn AsyncWrite + Send + Unpin>, String>;
    fn take_stderr(&mut self) -> Result<Box<dyn AsyncRead + Send + Unpin>, String>;
    fn wait(&mut self)         -> BoxFuture<'_, Result<i32, String>>;
    fn kill(&mut self)         -> Result<(), String>;
}
```

| 实现 | 来源 | 用途 |
|---|---|---|
| `LocalTmuxBackend` | `tokio::process::Child` | `TmuxController::spawn_local` (Wave 1 路径，spawn `tmux -CC`) |
| `SshTmuxBackend` | `SshConnectResult` (russh exec channel) | `TmuxController::spawn_with_ssh` (Wave 5 路径，远端 `tmux -CC`) |

`take_*` 是一次性的：`controller` 在 `spawn_*` 时各取一次后把 stream 交给 reader / writer / drain 三个 task。所有权转移由 trait 自身强制，避免重复消费同一个 `Child` / russh 通道。

#### 5.7.2 `TmuxController`（central orchestrator）

`TmuxController` 自身不是 `SessionBackend` —— 它**拥有** N 个 xsterm session。`SessionManager` 通过 `TmuxPaneHandle`（薄壳，见 §5.7.6）注册每个 pane。

| 字段 / 方法 | 作用 |
|---|---|
| `pane_bindings: HashMap<tmux_pane_id, xsterm_id>` | 主映射表 |
| `pane_window_bindings: HashMap<tmux_pane_id, tmux_window_id>` | 桥接 `WindowPaneChanged → WindowAdd` |
| `window_bindings: HashMap<tmux_window_id, xsterm_window_id>` | 主窗口映射 |
| `spawn_local(argv)` | 启动本地 `tmux -CC` 子进程（Wave 1） |
| `spawn_attach(session_name)` | 启动本地 `tmux -CC attach-session` 子进程（Wave 4） |
| `spawn_with_ssh(connect_result)` | 复用 russh exec channel（Wave 5） |
| `send_keys / resize_pane / capture_pane` | 入栈到 writer task |
| `split_window / kill_pane / new_window / kill_window / rename_window` | 高级 API；带 Promise 协调 |
| `close()` | 关闭 backend、清空所有 pending Promise |

Controller 启动后 spawn 三个长期 task：
- **reader task**：`stdout` → 行解析 → `mpsc::UnboundedSender<ControlEvent>` → dispatch task
- **writer task**：从 `mpsc::UnboundedReceiver<String>` 取命令 → `stdin.write_all`
- **stderr drain task**：`stderr` 字节流丢弃（不应有内容；落 rolling log）
- **monitor task**：`backend.wait()` → `tmux-controller-exit` 事件

加 dispatch task：消费 `ControlEvent` → 应用路由规则 → emit Tauri 事件 / 解析 Promise。

#### 5.7.3 Promise 协调（4 种）

所有 Promise 用 `tokio::sync::oneshot` + `std::sync::Mutex`：

| 字段 | 用途 | 来源 Wave |
|---|---|---|
| `pending_splits: Mutex<VecDeque<oneshot::Sender<SplitResult>>>` | `split-window` 命令的 round-trip：`%window-pane-changed` for the new pane 解析 front sender | Wave 2 |
| `pending_windows: Mutex<VecDeque<oneshot::Sender<NewWindowResult>>>` | `new-window` 命令的 round-trip：`%window-add` 解析 front sender | Wave 3 |
| `pending_window_pane: Mutex<HashMap<tmux_window_id, PendingWindow>>` | 桥接 `WindowAdd → WindowPaneChanged`：前者 push sender，后者 pop sender + 注册 pane + emit `tmux-pane-added` + (user-driven only) emit `tmux-window-added` | Wave 3 |
| `pending_capture: Mutex<Option<oneshot::Sender<CaptureResult>>>` + `pending_capture_body: Mutex<Vec<String>>` | `capture-pane` 单飞（一次只允许一个 capture in flight）：body lines 累积在 `pending_capture_body`，`%end` 触发并清空 | Wave 4 |

`close()` 在终止前 `drain_pending_*_with_error` 唤醒所有等待者，避免前端 Promise 永远 hang。

#### 5.7.4 Dispatch 路由（三分支 / 五级 case fallthrough）

`dispatch_event` 对每个 `ControlEvent` 走不同路径。最复杂的两条：

**`%window-pane-changed`**（Wave 2 §4.4 五级 fallthrough）：
1. **already-bound**：`pane_bindings` 已有此 pane id → ignore（tmux 在 active pane 切换时会重复 emit）
2. **split-result**：`pending_splits` front pop → 分配 xsterm id → emit `tmux-pane-added` → resolve oneshot
3. **new-window / bootstrap**：`pending_window_pane` remove for this window id → 分配 xsterm id → emit `tmux-pane-added` + (if user-driven) emit `tmux-window-added` + resolve oneshot；bootstrap 路径只 emit `tmux-pane-added`（前端已经有对应 Window）
4. **bootstrap fallback**（Wave 1/2 legacy）：`first_pane_result` 仍 `None` → 同上但走 `record_first_pane` 而非 emit `tmux-window-added`
5. **external pane**：tmux 报告了我们没请求的新 pane（用户在 inner shell 跑了 `splitw` 等）→ 不 auto-bind，只 log。**已知缺口** —— 没有 re-bind UI。

**`%window-add`**（Wave 3 三分支 trichotomy）：
- (a) `pending_windows` 非空 → user-driven `new-window` reply：pop front → 分配 xsterm window id → 存 `pending_window_pane` 等 `%window-pane-changed`
- (b) `pending_windows` 空 AND `window_bindings` + `pending_window_pane` 都空 → bootstrap window（`tmux -CC new-session` 创建的第一个 window）：同 (a) 但 sender = None
- (c) 否则 → external new-window（用户在 tmux 内手动 `:new-window`）→ 不 auto-bind，只 log

#### 5.7.5 `SessionManager::create_tmux` / `attach_tmux`

两个入口（`services/session_manager.rs`）：

| 方法 | 调用 | 行为 |
|---|---|---|
| `create_tmux(config: TmuxCcConfig)` | `create_tmux_session` Tauri 命令 | `TmuxController::spawn_local` 或 `spawn_with_ssh`（取决于 `TmuxCcConfig.ssh`）→ 等第一个 pane 上来 → 构造 `TmuxPaneHandle` + `SessionInfo` → 注册到 `sessions` + `tmux_controllers` |
| `attach_tmux(config: TmuxCcConfig)` | `attach_tmux_session` Tauri 命令 | 同上，但走 `spawn_attach(session_name)` 而非 `spawn_local` |

`list_attached_tmux_servers` / `auto_attach_all`（Wave 4）从 `attached_tmux.json` 读 → 对每条调用 `attach_tmux`。

#### 5.7.6 `ActiveSession::TmuxPane(TmuxPaneHandle)`

`TmuxPaneHandle` 实现 `SessionBackend`，但 `write` / `resize` / `close` 全部转发到 controller：

```rust
impl SessionBackend for TmuxPaneHandle {
    fn write(&self, data: &[u8]) -> Result<(), String> {
        self.controller.send_keys(&self.tmux_pane_id, data)
    }
    fn resize(&self, rows: u16, cols: u16) -> Result<(), String> {
        self.controller.resize_pane(&self.tmux_pane_id, rows, cols)
    }
    fn close(self: Box<Self>) -> Result<(), String> {
        // Dropping one pane binding must NOT kill the controller —
        // other panes owned by the same tmux -CC process may still be live.
        self.controller.unbind_pane(&self.tmux_pane_id)
    }
}
```

`TmuxPaneHandle` 持有 `Arc<TmuxController>`，所以 `SessionManager::sessions[id].controller` 与 `SessionManager::tmux_controllers[id]` 是同一个引用，`Arc::clone` 廉价。

#### 5.7.7 事件表面

复用 + 新增：

| 事件 | payload | 触发 |
|---|---|---|
| `session-output` | `[sessionId, bytes]` (UTF-8 byte array) | `%output` / `%extended-output`（复用 Wave 1 之前的事件名） |
| `tmux-pane-added` | `{controllerId, tmuxPaneId, xstermSessionId, parentTmuxWindowId}` | dispatch path case 2/3/4 |
| `tmux-pane-removed` | `{controllerId, tmuxPaneId, xstermSessionId}` | `%pane-exited` / `%pane-died` / 主动 kill-pane round-trip |
| `tmux-window-added` | `{controllerId, tmuxWindowId, xstermWindowId, xstermSessionId, xstermPaneId}` | dispatch path case 3 user-driven only |
| `tmux-window-closed` | `{controllerId, tmuxWindowId, xstermWindowId}` | `%window-close` for bound window |
| `tmux-window-renamed` | `{controllerId, tmuxWindowId, xstermWindowId, name}` | `%window-renamed` for bound window |
| `tmux-paused` | `{tmuxPaneId}` | `%pause`（read-only marker，Wave 1+） |
| `tmux-continued` | `{tmuxPaneId}` | `%continue` |
| `tmux-controller-exit` | `{controllerId, reason?}` | `%exit` 或 monitor task 看到 backend wait 失败 |

所有 `tmux-*` 事件 payload schema 见 `src/types/session.ts`（`TmuxPaneAddedEvent` 等 interface），与 Rust 端 `serde_json::json!({...})` 构造一一对应。

#### 5.7.8 已知架构特性 / 债务

| 特性 / 债务 | 位置 | 说明 |
|---|---|---|
| 外部 pane 不自动绑定 | `controller.rs::dispatch_event` case 5 | `splitw` 等 inner-shell 动作产生的 pane 只 log；future iteration 加 re-bind UI |
| 外部 window 不自动绑定 | `controller.rs::dispatch_event` case 3c | 用户在 tmux 内手动 `:new-window` 同理；MVP 用户用 in-app 的 `New Tmux Window` 命令 |
| Bootstrap window id 未暴露前端 | `models/session.rs::SessionInfo` | `xsterm_window_id` 仅 backend 持有；前端无法 `kill_tmux_window` bootstrap window |
| 6 个 Wave-0 命令 builder 保留 dead-code | `commands.rs::split_window` / `new_window` / `list_panes` / `list_sessions` / `refresh_client` | spec'd in req-006 §3.4 + 单元测试覆盖；production 走 inline wire payload |

---

## 6. 持久化

| 数据 | 位置 | 写入时机 |
|---|---|---|
| `savedConfigs[]` | `sessions.json / savedConfigs` | 创建/修改/删除保存配置时（含 Wave 1-3 spec 字段） |
| `groups[]`, `nextGroupId` | `sessions.json / groups` | 同上 |
| `savedWorkspaces[]` | `sessions.json / savedWorkspaces` | 保存 workspace 时 |
| `savedWindowConfigs[]` | `sessions.json / savedWindowConfigs` | 保存 window 时 |
| 全局设置（`globalLocalEcho`、`currentThemeKey` 等） | `settings.json` | 设置变更时 |
| **运行时会话** (`sessions[]`)、**活跃 workspace** (`workspaces[]`) | **不持久化** | 应用重启后清空 |

---

## 7. 复杂度热点（必读）

按"修改风险 × 复杂度"排序（**2026-09 数据，Wave 0–5 后**）：

| 文件 | 行数 | 为什么是热点 |
|---|---|---|
| `src-tauri/src/infrastructure/tmux/controller.rs` | ~3700（含测试） | **当前最大单文件**。tmux -CC 主状态机：reader / writer / monitor / dispatch 四个 task + 4 种 Promise 协调（split / window / window-pane / capture）+ dispatch 路由（5 级 `%window-pane-changed` fallthrough + 3 分支 `%window-add` trichotomy）。改 dispatch 路由前必须读完整文件 + 跑 Wave 2/3/4 测试套件。 |
| `src-tauri/src/services/session_manager.rs` | ~2545（含测试） | **当前最大业务文件**。所有 session 注册表（含 tmux_controllers / tmux_pane_bindings）+ trait-based dispatch + Wave 1–5 spec 字段处理 + 大型 mockall 测试 + `create_tmux` / `attach_tmux` / `create_tmux_pane` / `kill_tmux_pane` / `create_tmux_window` / `capture_tmux_pane` / `list_attached_tmux_servers` / `auto_attach_all` 共 8 个 tmux 相关方法。修改前必须读完整文件。 |
| `src-tauri/src/infrastructure/ssh.rs` | 919 | russh 异步生命周期 + Wave 1-3 SSH 配置字段（keepalive / TCP nodelay / so_keepalive / null_packet_keepalive / known_hosts_path / proxy_jump 等）。**安全债**：`ClientHandler::check_server_key` 无条件 `return true`（不验证主机密钥）。 |
| `src-tauri/src/infrastructure/tmux/backend.rs` | 666（含测试） | Wave 5 `TmuxBackend` trait + `LocalTmuxBackend`（`tokio::process::Child`）+ `SshTmuxBackend`（russh exec channel 适配）+ `SshAsyncRead` / `SshAsyncWrite` 适配器（`sync_mpsc` ↔ `tokio::io` 桥接）。 |
| `src/contexts/session/useWorkspaceActions.ts` | 370 | **前端最大 hook**。Workspace 持久化（带回滚）+ save/load + window 重组。复杂度仅次于 useSessionActions 拆分前。 |
| `src/contexts/session/paneUtils.ts` | 271 | 25 个**纯函数**，整个布局系统的核心。已加 Vitest 覆盖（48 个用例），行为已锁定。**已知 bug 006**：`isSessionUsedInOtherWindow` 早返回逻辑错误。 |
| `src/components/Terminal.tsx` | 294 | xterm 生命周期 + 输入/输出/粘贴/选择 + 断连检测（仅 Enter 触发重连）。**粘贴去重（bug 003）**、**reset on sessionId change（bug 004）**、**断连横幅 UI** 三处修复都在这里。 |
| `src/components/Pane.tsx` | 269 | 会话绑定 vs. 分屏的二选一流，配合 `SelectSessionDialog` 协同时序复杂。**Bug 002** 的 `isSubmittingRef` 防线在这里。 |
| `src/contexts/session/useSessionLifecycle.ts` | 268 | **会话生命周期**（create / openFromConfig / close / reconnect）。**Bug fix `937e4fb`** 统一了连接 banner 命名约定并修复了 connection banner 状态判断。 |
| `src/contexts/session/usePaneActions.ts` | 258 | Pane 树变更（split / attach / setActive / close）的核心算法。tmux-aware split 分支走 `splitTmuxPane`。 |
| `src/components/WorkspaceContainer.tsx` | 192 | 多 window 管理 + 命令面板 + window 级 save/rename（已经瘦身，从 299 → 192）。 |
| `src/components/dialogs/CreateSessionDialog.tsx` | 369 | 4 个 sidebar sections × 4 个 top tabs（Shell / SSH / Tmux Local / Tmux SSH）+ 大量 sub-form 组合。**Bug fix `937e4fb`** 涉及这里。 |

---

## 8. Onboarding Path（新开发者推荐阅读顺序）

按这个顺序读，能在最短时间内理解全栈：

1. **本文件第 5.5 节** —— 数据流图，建立端到端心智模型。
2. **[`doc/design-system.md`](design-system.md) §1** —— Cursor 风格设计语言的核心规则（任何 UI 改动前必读）。
3. **`src/main.tsx` → `src/App.tsx`** —— Provider 栈。
4. **`src/contexts/session/useSessionState.ts`** —— 字段定义。
5. **`src/contexts/session/types.ts`** —— SessionContextType 接口（一个文件看懂所有 action 的签名）。
6. **`src/contexts/session/useSessionLifecycle.ts`** —— 会话生命周期。
7. **`src/components/Terminal.tsx`** —— xterm 与 IPC 的双向绑定（最具体的"端到端"代码）。
8. **`src/services/sessionService.ts`** —— IPC 出口（注意 `createSession` 是新通用入口）。
9. **`src-tauri/src/lib.rs`** —— 后端启动。
10. **`src-tauri/src/services/session_manager.rs`** —— 后端 session 注册中心。
12. **`src-tauri/src/infrastructure/pty.rs` / `ssh.rs`** —— 理解 PTY/SSH 怎么跑（trait 抽象很优雅）。
13. **`src/contexts/session/paneUtils.ts`** + `paneUtils.test.ts` —— 布局系统的核心算法（**先看测试再看实现**，因为测试就是规范）。

读完后想动手改：先翻 `doc/maintenance/bug.md` 看历史教训，再翻 `doc/requirements/prd-0.1/req-*.md` 看需求文档。任何 UI 改动必须查 [`doc/design-system.md`](design-system.md) §2 token 表 + §10 允许例外清单。

### 8.1 tmux 集成专项阅读

如果改动涉及 tmux -CC，按这个顺序读（基于上面 1–13 节）：

1. 本文件 §5.7 — tmux 集成整体架构（必读）
2. [`doc/requirements/prd-0.1/req-006-tmux.md`](../requirements/prd-0.1/req-006-tmux.md) — 需求 + 协议摘要 + 决策记录
3. `src-tauri/src/infrastructure/tmux/mod.rs` — 模块布局 + 公开 API
4. `src-tauri/src/infrastructure/tmux/parser.rs` + `events.rs` — 协议解码（纯函数，**先看测试**）
5. `src-tauri/src/infrastructure/tmux/controller.rs::dispatch_event` — 路由规则（**§5.7.4 三分支 / 五级 case**）
6. `src-tauri/src/services/session_manager.rs::create_tmux` / `attach_tmux` / `create_tmux_pane` — 注册路径
7. `src/contexts/session/useTauriListeners.ts` — 前端事件 reducer
8. `src/types/session.ts::TmuxPaneAddedEvent` 等 — 事件 payload schema

---

## 9. 已知技术债 / 风险

源自 `AGENTS.md` + 实际代码观察：

| 风险 | 位置 | 建议 |
|---|---|---|
| **SSH 主机密钥验证关闭** | `src-tauri/src/infrastructure/ssh.rs:check_server_key` | 上线前必须加 known_hosts |
| **`session_manager.rs` 2545 行单文件** | `src-tauri/src/services/session_manager.rs` | trait 已经分好；可考虑拆 `LocalSessionRegistry` / `SshSessionRegistry` / `TmuxPaneRegistry` / `SessionBackend` 默认 impl |
| **`tmux/controller.rs` 3700 行单文件** | `src-tauri/src/infrastructure/tmux/controller.rs` | 当前 dispatch + reader/writer/monitor task + Promise 协调全在一个文件；可拆 `dispatch.rs` / `tasks.rs` / `promises.rs` |
| **`invoke()` 无类型安全** | 整个前端 | 接入 `tauri-specta` 或同类生成 TypeScript binding |
| **版本号不一致** | `package.json` / `Cargo.toml` 是 0.1.1，`tauri.conf.json` 是 0.1.3 | 发版前统一 |
| **`list_sessions` 命令有 wrapper 但无调用点** | `src/services/sessionService.ts:listSessions` | 要么删掉 wrapper，要么加 settings/health-check UI 调用 |
| **`TerminalContainer.tsx` 空壳** | `src/components/TerminalContainer.tsx` | 15 行未使用；删除前 grep 确认无外部 import |
| **`logging_setup` 故意泄漏 guard** | `src-tauri/src/logging_setup.rs` | 这是有意为之（保持 rolling writer alive），但新人读代码容易误解 |
| **Bug 006 未修** | `src/contexts/session/paneUtils.ts:isSessionUsedInOtherWindow` | 测试有 `.todo` 占位 |
| **WebView2 SVG `<text>` 静默失败** | `src/components/NavBar.tsx` 等使用 `<img src="*.svg>` 处 | **2026-08 已修复**：`logo.svg` / `logo-icon.svg` 全部用 path，避免字体回退链断开 |
| **Disconnect banner 状态依赖 React state** | `src/components/Pane.tsx:245` + `src/components/Terminal.tsx:193-201` | 当前文案已软化为 `var(--warning)`（可恢复），但根因诊断（PowerShell 实际退出 vs PTY 误判）需要 `doc/maintenance/bug.md` 跟踪 |
| **tmux 外部 pane / window 不自动绑定** | `controller.rs::dispatch_event` case 5 / case 3c | 用户在 inner shell 跑 `splitw` 或在 tmux 内手动 `:new-window` 产生的 pane/window 只 log 不绑定；future iteration 加 re-bind UI |
| **CSP scope 限于本地** | `src-tauri/tauri.conf.json: csp` | 已开启严格 CSP（Wave 6），但策略目前允许 `ipc:` + `http://ipc.localhost`；引入任何远程脚本/asset 前需重新评估 |

---

## 10. 与 `doc/frontend-architecture.md` 的差异

为避免被过期文档误导，列出已知差异：

- ❌ `tmuxService.ts` — 不存在
- ❌ `TmuxSessionView.tsx`、`TmuxWindowTabs.tsx` — 不存在
- ❌ `tmuxStateReducer.ts` — 不存在
- ❌ `types/tmux.ts` — 不存在（types 目录只有 `log.ts`、`session.ts`、`theme.ts`、`capabilities.ts`、`session.test.ts`）
- ⚠️ `TerminalContainer.tsx` — 存在但是 15 行空壳，未被实际使用
- ⚠️ `src/styles/` 实际存在（global.css / layout.css / pane.css），但很多组件 CSS 也与 .tsx 同目录
- ⚠️ 实际 `Pane` 渲染的是 `Terminal` 或 `PaneInitCard`，**不是**文档里说的 `TmuxSessionView`
- ⚠️ `SessionContext` 已从单文件 1276 行**拆分为 11 个文件**（详见 §4.3）
- ⚠️ **`doc/design-system.md` 是 2026-08 新增的必读规范**，frontend-architecture.md 没有提到

若你正在做 tmux 相关功能，请先把这份过期的 frontend-architecture.md 更新或删除。

---

## 11. 重构记录（2026-07-27 之后）

按时间倒序：

### 2026-09 — tmux -CC 集成 Wave 0–5 完成

- **Wave 0**：基础设施先行。`infrastructure/tmux/{parser,escape,events,commands,controller}.rs`；parser 40+ 测试；escape round-trip；controller skeleton（spawn child + reader + writer，不接 SessionManager）
- **Wave 1**：单 pane MVP。`ActiveSession::TmuxPane(TmuxPaneHandle)` + `create_tmux_session` / `write_session` / `resize_session` / `close_session` tmux 分支 + bootstrap pane `is_hidden = true` + `CapabilityFlags::for_tmux()` + 前端 `tmux-cc` SessionType + CreateSessionDialog "Tmux" tab
- **Wave 2**：split / kill pane + Promise 协调 (`pending_splits`)。前端 `Pane.tsx` 启用 split 右键菜单项（capability 检查）+ `Ctrl+\` / `Ctrl+Shift+\` 快捷键 + `usePaneActions.splitPane` tmux-aware 分支
- **Wave 3**：tabs & windows 映射。`create_tmux_window` / `kill_tmux_window` / `rename_tmux_window` + `%window-add` / `%window-close` / `%window-renamed` 事件 + `pending_windows` + `pending_window_pane` 桥接 + dispatch 3 分支 trichotomy
- **Wave 4**：scrollback & reconnect。`capture_tmux_pane` 单飞（`pending_capture` + `pending_capture_body`）+ `attach_tmux_session` + `attached_tmux.json` 持久化 + `auto_attach_all` + `TmuxControllerErrorBanner` + `useTmuxAutoAttach`
- **Wave 5**：SSH + tmux。`TmuxBackend` trait 抽象 + `LocalTmuxBackend` / `SshTmuxBackend` impls + `SshAsyncRead` / `SshAsyncWrite` 适配器（`sync_mpsc` ↔ `tokio::io` 桥接）+ `TmuxCcConfig.ssh` 字段 + Create Session dialog 单一 "Tmux" tab，下拉框选 saved SSH/Local config 作 base，`baseConfigId` 决定 transport（不再有 Radio 切换）
- **Wave 6**（本波）：抛光。详见 §5.7.8 + 重新启用 CSP + `tmux/` 模块级 `#[allow(dead_code)]` 拆为 per-item + doc sync

### 2026-08-20 — 设计系统永久化 + 文档同步
- 新建 `doc/design-system.md`（302 行）—— Cursor 暗色 IDE 适配版的完整规范
- AGENTS.md 新增 "Design System — Standing Rule" 段（任何 agent 第二眼看到）
- 引入新 token 系统：`--canvas` / `--ink` / `--accent` (#f54e00 Cursor Orange) / hairline / `--font-ui` (Inter) / `--font-mono` (JetBrains Mono)
- 重写 23 个 CSS 文件统一用 token
- 软化 `.pane-disconnect-banner`（`--error` 红 → `--warning` 琥珀，反映"可恢复"语义）
- 重设计 Create Session dialog 的 panel 视觉
- 新建 path-based `logo.svg` / `logo-icon.svg`（修复 WebView2 `<text>` 静默失败）

### 2026-08 — SessionContext 拆分
- `useSessionActions.ts` 从 1276 行**降至 198 行**
- 新增 8 个专用 hook：`useSessionLifecycle` / `useGroupActions` / `usePaneActions` / `useWindowActions` / `useWorkspaceActions` / `useSavedWindowActions` / `useSavedWorkspaceActions` / `useSessionActions.helpers`
- `listSessions()` wrapper 加入 `sessionService.ts`（之前未暴露）

### 2026-08 — Session-config Wave 1-3 完成
- `bc51697` types: LocalSessionConfig / SSHSessionConfig 扩展（shell args, env, TERM, LC_ALL, initial_rows/cols, charset, keepalive, tcp_nodelay, so_keepalive, null_packet_keepalive, known_hosts_path, proxy_jump, startup_command, startup_delay_ms）
- `7dbfa27` / `367b383` Rust 端镜像 + 默认值 + per-session logging
- `41f7e79` 前端表单（LocalSessionForm / SshSessionForm / CommonSettingsForm）应用新字段
- `d8b4103` 持久化兼容验证
- 新增 `DisplayConfigForm.tsx` 和 4 个表单原子（FormTextField / FormSelectField / FormNumberField / FormCheckboxField）

### 2026-07-31 — Bug 003/004 修复（粘贴去重 + xterm reset on sessionId change）
- `Terminal.tsx` 中粘贴路径重构
- sessionId 变化时调用 `xterm.reset()` 防止新 PTY 收到旧 xterm 模式的乱码输出

### 2026-08 — 其他
- `937e4fb` 修复 connection banner 状态判断 + 统一命名约定（`is_connected` vs `session.is_connected`）
- `aec3010` / `92eae1f` 一系列可访问性 + 表单字段样式增强

---

*文档生成时间：2026-09-04（Wave 6 抛光 + tmux §5.7 + CSP 重新启用）*
*基础来源：仓库实际文件清单 + 实际 grep/ls/wc 核验 + 最近 30 个 commit 历史 + 已合并的设计系统重构 + Wave 0–5 tmux 集成落地*