# xsterm 架构地图

> 本文档是 xsterm 项目的全栈架构地图，目的是让不熟悉代码的人能在一小时内形成清晰的心智模型。重点在**模块边界、职责划分、复杂度热点**，细节请直接看代码。
>
> 与 `doc/frontend-architecture.md` 的关系：那份文档描述的是 **2026-07-02 时的目标态**（包含若干尚未实现或已被移除的 tmux 相关文件：`tmuxService.ts` / `TmuxSessionView.tsx` / `tmuxStateReducer.ts` / `types/tmux.ts`）。本文档描述的是 **当前仓库实际存在的文件**（2026-07-27 验证）。若两份文档冲突，以本文档为准。

---

## 1. 一句话总结

xsterm 是一个 Tauri 2 桌面终端模拟器：Rust 后端管 PTY/SSH 进程，前端用 React + xterm.js 渲染。状态集中在 SessionContext 里，通过 invoke 命令和 listen 事件与后端通讯。

---

## 2. 技术栈

| 层级 | 技术 |
|---|---|
| 桌面壳 | Tauri 2（WebView2 on Windows, WKWebView on macOS, WebKitGTK on Linux） |
| 前端 | React 19 + TypeScript 5.8 + Vite 7 |
| 终端渲染 | xterm.js 6 + `@xterm/addon-fit` |
| 后端 | Rust（`portable-pty` + `russh` + `tauri-plugin-store` + `tracing`） |
| 持久化 | `tauri-plugin-store`（JSON 文件） |
| 样式 | 原生 CSS（无 CSS-in-JS / Tailwind） |
| 状态管理 | React Context + `useState` / `useRef`（无 Redux/Zustand） |
| 测试 | Vitest（前端） + mockall（Rust 后端） |

---

## 3. 仓库布局

```
xsterm/
├── src/                          # 前端
│   ├── main.tsx                  # 入口
│   ├── App.tsx                   # Provider 组合
│   ├── components/               # 全部 UI 组件（30 个 .tsx）
│   ├── contexts/                 # SessionContext / ThemeContext / LoggerContext
│   │   └── session/              # Session 上下文拆分：state / actions / persistence / listeners / paneUtils / types
│   ├── hooks/                    # 7 个自定义 Hook（xterm 生命周期、IPC 桥接、拖拽、快捷键）
│   ├── services/                 # IPC 调用层（sessionService / sessionStorage）
│   ├── types/                    # session / theme / log 类型定义
│   ├── utils/                    # paneTree / clipboard / sessionOutputBuffer
│   └── styles/                   # 全局样式（global.css / layout.css / pane.css）
│
├── src-tauri/                    # 后端
│   └── src/
│       ├── main.rs               # 进程入口
│       ├── lib.rs                # Tauri builder + 插件注册 + SessionManager 状态
│       ├── logging_setup.rs      # tracing 初始化
│       ├── error.rs              # 错误类型
│       ├── commands/             # #[command] 函数（薄壳，包一层 with_manager）
│       │   ├── session.rs
│       │   ├── persistence.rs
│       │   └── logging.rs
│       ├── services/             # 业务逻辑
│       │   ├── session_manager.rs    # 中枢：所有会话注册表 + trait-based 可测试
│       │   ├── local_session.rs
│       │   └── ssh_session.rs
│       ├── infrastructure/       # 外部资源抽象（trait）
│       │   ├── pty.rs                # PtySystem trait（portable-pty 实现）
│       │   ├── ssh.rs                # SshBackend trait（russh 实现）
│       │   └── app_backend.rs        # AppBackend trait（解耦 emit from Tauri）
│       └── models/               # 数据模型
│           ├── session.rs
│           └── group.rs
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
| `NavBar.tsx` | 自定义标题栏（`decorations: false`）。通过 `getCurrentWindow()` 读窗口状态。无业务逻辑。 |
| `WorkspaceContainer.tsx` | 单个 workspace 的容器：WindowTabBar + PaneTree/InitWindowView，处理窗口级 save/rename/close。 |
| `PaneTree.tsx` | `PaneNode` 树的递归渲染。叶子 → `<Pane>`，split → `<SplitNode>`（div + 拖拽分隔条）。 |
| `Pane.tsx` | 单个叶子 pane：渲染 `<Terminal>` 或 `<PaneInitCard>`。右键菜单提供 split / attach / close，配合 `<SelectSessionDialog>` 完成"分屏还是绑定"二选一。 |
| `Terminal.tsx` | **xterm.js 封装层**：xterm 生命周期、xterm.onData → `writeSession`、粘贴去重（防重复触发，参考 bug 003）、sessionId 变化时 `xterm.reset()`（bug 004）。 |
| `dialogs/CreateSessionDialog.tsx` | 创建 local / SSH 会话表单。 |
| `dialogs/SelectSessionDialog.tsx` | 选择已存在会话或 saved config 用于分屏。**Bug 002 修复点**：用 `isSubmittingRef` 防止重复点击。 |
| `sidebar/SessionManager.tsx` | SavedSessionConfig 列表（按 group 分组），CRUD。 |
| `sidebar/WorkspaceManager.tsx` / `WindowManager.tsx` | saved workspace / saved window 的管理。 |
| `settings/SettingsView.tsx` | 主题、快捷键、about。 |
| `ui/ContextMenu.tsx`, `ui/Dialog.tsx`, `ui/FormField.tsx` | 通用 UI 原语。 |

### 4.3 Context 形状

**`SessionContext`**（最复杂，详见 `src/contexts/session/types.ts`）—— 由 5 个子 hook 组合：

```ts
SessionContext = useSessionState()
              + useSessionPersistence()
              + useSessionActions()        // 40+ 个 action
              + useTauriListeners()
              + (派生 helpers)
```

- **State**：`sessions[]`、`savedConfigs[]`、`workspaces[]`、`activeWorkspaceId`、`savedWorkspaces[]`、`savedWindowConfigs[]`、`groups[]`、`globalLocalEcho`、`sessionLocalEchoOverrides`（`Map<number, bool>`）。
- **Actions**（38 个，分组）：
  - 会话生命周期：`createLocalSession` / `createSshSession` / `openFromConfig` / `closeSession` / `reconnectSession`
  - Pane 布局：`splitPane` / `updateWindowPaneTree` / `setActivePane` / `closePane`
  - Window：`createWindow` / `createWindowFromSession` / `createWindowFromSavedConfig`
  - Workspace：`createWorkspaceFromSession` / `saveWorkspace` / `loadWorkspace` / `closeWorkspace`
  - Group：`createGroup` / `addToGroup` / `moveConfigToGroup` / `renameGroup` / `deleteGroup` / `toggleGroup`
  - 杂项：`updateConfig` / `renameSession` / `renameWindow`
- **Refs**（用于 stale-closure）：`sessionsRef` / `workspacesRef` / `establishingSessionsRef`。
- **Persistence**（`useSessionPersistence`）：每次 state 变更自动写入 `sessions.json` / `settings.json`。

**`ThemeContext`** —— `currentTheme: TerminalTheme`、`currentThemeKey`、`setTheme(key)`，数据源是 `types/theme.ts` 里的 `PRESET_THEMES`。

**`LoggerContext`** —— 4 个级别（debug/info/warn/error），同时写到 `console` 和 `invoke("log_message")`（Rust 侧 rolling log 文件）。**额外导出**一个 `logger` 单例，供 service 层等 React 树外模块使用。

### 4.4 IPC 服务层

`src/services/sessionService.ts` 是全部 invoke 的统一出口（6 个函数，全部薄壳）：

| 函数 | Tauri 命令 |
|---|---|
| `createLocal(config)` | `create_local_session` |
| `createSsh(config)` | `create_ssh_session` |
| `writeSession(id, data)` | `write_session` |
| `resizeSession(id, rows, cols)` | `resize_session` |
| `closeSession(id)` | `close_session` |
| `uploadImageToSshSession(id, filename, data)` | `upload_image_to_ssh_session` |

`src/services/sessionStorage.ts` 封装 `tauri-plugin-store`：单例 store + 异步 get/set，缓存于 module-level。

### 4.5 自定义 Hooks

| 文件 | 用途 |
|---|---|
| `useXterm.ts` | 创建 `new XTerm()` + FitAddon，绑定到容器 div；包含纯函数 `themeToXtermTheme`（**易测**）。 |
| `useTauriTerminalOutput.ts` | `listen("session-output")` → 字节流解码 + OSC52 剪贴板提取 + RAF 批量写入 xterm + 缓冲回放。包含纯函数 `decodeOutput` / `decodeBase64Utf8` / `extractAndCopyOsc52`（**易测**）。 |
| `useTerminalResize.ts` | ResizeObserver → `FitAddon.fit()` → `resizeSession` IPC。 |
| `useDragResize.ts` | 鼠标拖拽分隔条 → 更新子 pane 百分比。 |
| `useAppShortcuts.ts` / `useShortcut.ts` | 全局快捷键注册。 |

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
    sessions: HashMap<u32, Session>,    // id → Session
    next_id: u32,
    pty_system: Arc<dyn PtySystem + Send + Sync>,
    ssh_backend: Arc<dyn SshBackend + Send + Sync>,
    app_backend: Arc<dyn AppBackend + Send + Sync>,
}

enum Session {
    Local(LocalSession),
    Ssh(SshSession),
}
```

所有会话操作（write / resize / close）通过 match 分发到对应变体。trait 注入使得 `mockall` 可以在测试中替换 PtySystem / SshBackend / AppBackend——这一点是**Rust 单测能跑得好的核心原因**。

### 5.4 命令清单

| 文件 | 命令 | 说明 |
|---|---|---|
| `session.rs` | `create_local_session` | 启 PTY + 输出转发线程 |
| `session.rs` | `create_ssh_session` | SSH 连接 + 通道 + 输出线程 |
| `session.rs` | `write_session` / `resize_session` / `close_session` | 基础生命周期 |
| `session.rs` | `list_sessions` | 列所有活跃会话元数据（**已在 Rust 注册但前端未调用**，见下方"已知债"） |
| `session.rs` | `upload_image_to_ssh_session` | SSH exec channel 传图 |
| `persistence.rs` | `save_sessions` / `load_sessions` / `save_groups` / `load_groups` | sessions.json + groups.json |
| `logging.rs` | `log_message` / `get_log_config` / `set_log_config` / `get_log_dir` | 日志桥接 |

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
Session::Local → PTY master.write_all                   [5a. 本地]
  或 Session::Ssh → channel.write_tx.send               [5b. SSH]
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

---

## 6. 持久化

| 数据 | 位置 | 写入时机 |
|---|---|---|
| `savedConfigs[]` | `sessions.json / savedConfigs` | 创建/修改/删除保存配置时 |
| `groups[]`, `nextGroupId` | `sessions.json / groups` | 同上 |
| `savedWorkspaces[]` | `sessions.json / savedWorkspaces` | 保存 workspace 时 |
| `savedWindowConfigs[]` | `sessions.json / savedWindowConfigs` | 保存 window 时 |
| 全局设置（`globalLocalEcho`、`currentThemeKey` 等） | `settings.json` | 设置变更时 |
| **运行时会话** (`sessions[]`)、**活跃 workspace** (`workspaces[]`) | **不持久化** | 应用重启后清空 |

---

## 7. 复杂度热点（必读）

按"修改风险 × 复杂度"排序：

| 文件 | 行数 | 为什么是热点 |
|---|---|---|
| `src/contexts/session/useSessionActions.ts` | ~1276 | **最大的认知负担**。40+ 个业务 action 全堆在一个 hook 里，session 生命周期、workspace 持久化（带回滚）、window/pane 树变更、group 管理、reconnect 全混在一起。**未来重构的首要目标**（建议拆成 `useSessionMutations` / `useWorkspaceActions` / `usePaneActions` / `useGroupActions`）。 |
| `src/contexts/session/paneUtils.ts` | 253 | 25 个纯函数，整个布局系统的核心。已加 Vitest 覆盖（48 个用例），行为已锁定。**已知 bug 006**：`isSessionUsedInOtherWindow` 早返回逻辑错误。 |
| `src/components/Terminal.tsx` | ~304 | xterm 生命周期 + 输入/输出/粘贴/选择。**粘贴去重（bug 003）**、**reset on sessionId change（bug 004）** 两处修复都在这里。 |
| `src/components/Pane.tsx` | ~277 | 会话绑定 vs. 分屏的二选一流，配合 `SelectSessionDialog` 协同时序复杂。**Bug 002** 的 `isSubmittingRef` 防线在这里。 |
| `src/components/WorkspaceContainer.tsx` | ~299 | 多 window 管理 + 命令面板 + window 级 save/rename，组件本身偏重，没拆子组件。 |
| `src-tauri/src/services/session_manager.rs` | ~662（含测试） | 所有 session 注册表 + 写读分发，trait-based 易测。 |
| `src-tauri/src/infrastructure/ssh.rs` | ~419 | russh 异步生命周期，`tokio::select!` 三路事件循环。**安全债**：`ClientHandler::check_server_key` 无条件 `return true`（不验证主机密钥）。 |

---

## 8. Onboarding Path（新开发者推荐阅读顺序）

按这个顺序读，能在最短时间内理解全栈：

1. **本文件第 5.5 节** —— 数据流图，建立端到端心智模型。
2. **`src/main.tsx` → `src/App.tsx`** —— Provider 栈。
3. **`src/contexts/session/useSessionState.ts`** —— 字段定义。
4. **`src/contexts/session/types.ts`** —— SessionContextType 接口（一个文件看懂所有 action 的签名）。
5. **`src/components/Terminal.tsx`** —— xterm 与 IPC 的双向绑定（最具体的"端到端"代码）。
6. **`src/services/sessionService.ts`** —— IPC 出口。
7. **`src-tauri/src/lib.rs`** —— 后端启动。
8. **`src-tauri/src/services/session_manager.rs`** —— 后端 session 注册中心。
9. **`src-tauri/src/infrastructure/pty.rs` / `ssh.rs`** —— 理解 PTY/SSH 怎么跑（trait 抽象很优雅）。
10. **`src/contexts/session/paneUtils.ts`** + `paneUtils.test.ts` —— 布局系统的核心算法（**先看测试再看实现**，因为测试就是规范）。

读完后想动手改：先翻 `doc/bug.md` 看历史教训，再翻 `doc/req-*.md` 看需求文档。

---

## 9. 已知技术债 / 风险

源自 `AGENTS.md` + 实际代码观察：

| 风险 | 位置 | 建议 |
|---|---|---|
| **SSH 主机密钥验证关闭** | `src-tauri/src/infrastructure/ssh.rs:54-64` | 上线前必须加 known_hosts |
| **CSP 关闭** | `src-tauri/tauri.conf.json: "csp": null` | 加 remote script/asset 时必须先恢复 CSP |
| **`useSessionActions.ts` 1276 行单文件** | `src/contexts/session/useSessionActions.ts` | 按职责拆分；Vitest 测试先行锁住行为 |
| **`invoke()` 无类型安全** | 整个前端 | 接入 `tauri-specta` 或同类生成 TypeScript binding |
| **版本号不一致** | `package.json` / `Cargo.toml` 是 0.1.1，`tauri.conf.json` 是 0.1.3 | 发版前统一 |
| **`list_sessions` 命令已注册但未在前端暴露** | `src-tauri/src/commands/session.rs` + 缺失 `src/services/sessionService.ts` 包装 | 若需要用，加 wrapper |
| **logging_setup 故意泄漏 guard** | `src-tauri/src/logging_setup.rs` | 这是有意为之，但新人读代码容易误解 |
| **Bug 006 未修** | `src/contexts/session/paneUtils.ts:174-188` | 测试有 `.todo` 占位 |

---

## 10. 与 `doc/frontend-architecture.md` 的差异

为避免被过期文档误导，列出已知差异：

- ❌ `tmuxService.ts` — 不存在
- ❌ `TmuxSessionView.tsx`、`TmuxWindowTabs.tsx` — 不存在
- ❌ `tmuxStateReducer.ts` — 不存在
- ❌ `types/tmux.ts` — 不存在（只有 `types/log.ts`、`types/session.ts`、`types/theme.ts`）
- ❌ `styles/` 目录 — 当前不存在（CSS 与组件 .tsx 同目录）
- ⚠️ `TerminalContainer.tsx` — 存在但基本是空壳，未被实际使用
- ⚠️ `src/styles/` 实际存在（global.css / layout.css / pane.css），文档里写 `└── styles/  # 全局样式` 是对的；但很多组件 CSS 也与 .tsx 同目录，文档未提
- ⚠️ 实际 `Pane` 渲染的是 `Terminal` 或 `PaneInitCard`，**不是**文档里说的 `TmuxSessionView`

若你正在做 tmux 相关功能，请先把这份过期的 frontend-architecture.md 更新或删除。

---

*文档生成时间：2026-07-27*
*基础来源：两次并行 `explore` agent 扫描（前端 + 后端）+ 实际文件清单核验 + 已合并的 Vitest 测试与 bug.md*