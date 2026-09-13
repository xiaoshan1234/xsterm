# xsterm 架构总览（Architecture Overview）

> **当前快照**（2026-09）：文档描述 P3-P5 重构**后**的实际代码结构。P1-P5 把 `controller.rs`（3622 行 monolith）拆到 `controller/{mod,id_map,handshake,subscriber}.rs`，新增 `protocol/{wire,codec,events,parser,version,command}.rs` 子模块。完整 PR 切片见 [roadmap/migration-prs.md](../../roadmap/migration-prs.md)。

> **历史快照**：P1-P5 之前的架构描述在 [`history/prd-0.1-arch-snapshot/architecture-map.md`](../../history/prd-0.1-arch-snapshot/architecture-map.md)（633 行 Wave 0-6 演化历史）。

## 1. 一句话总结

xsterm 是 Tauri 2 桌面终端模拟器：Rust 后端管 PTY/SSH/tmux 进程，React 前端用 xterm.js 渲染。状态按"职责拆分到 11 个 React hook"集中在 SessionContext，通过 Tauri IPC (`invoke` + `listen`) 与后端通讯。Shell UI 走 Cursor 风格设计系统（独立于 xterm ANSI 主题）。

## 2. 当前代码结构

```
xsterm/
├── apps/desktop/                  Tauri 主项目（仓库根即此目录）
│   ├── src/                       React + TS + Vite 前端
│   │   ├── components/            42 个 .tsx（按职责分子目录：sidebar/、dialogs/、settings/、ui/、icons/）
│   │   ├── contexts/              SessionContext / ThemeContext / LoggerContext
│   │   │   └── session/           Session context — 11 文件按职责拆分
│   │   ├── hooks/                 7 个自定义 hook
│   │   ├── services/              IPC 调用层（sessionService / sessionStorage）
│   │   ├── types/                 session / theme / log / capabilities 类型定义
│   │   ├── utils/                 paneTree / clipboard / sessionOutputBuffer
│   │   └── styles/                全局样式（design-system token 在 :root）
│   └── src-tauri/                 Rust 后端（Tauri 2 + Tauri commands）
│       └── src/
│           ├── commands/          Tauri command handlers
│           ├── services/          业务逻辑
│           │   ├── session_manager.rs   中枢：所有 session 注册表 + trait-based 可测试
│           │   ├── local_session/       本地 PTY session（resolution / spawn / bytes）
│           │   ├── ssh_session/         SSH session
│           │   ├── tmux/                tmux -CC 集成（详见 §5）
│           │   │   ├── controller/      状态机层（详见 §5.7）
│           │   │   │   ├── mod.rs            入口 + SpawnMode 字段
│           │   │   │   ├── id_map.rs        CommandRegistry（PR-T3）
│           │   │   │   ├── handshake.rs    v2 handshake plan_for + execute_step（PR-T4）
│           │   │   │   └── subscriber.rs   RouterState 命令响应路由（PR-T5）
│           │   │   ├── parser.rs           line → ProtocolEvent
│           │   │   ├── dispatch.rs         通知分发（旧 5 层 fallthrough，PR-T8 删除）
│           │   │   ├── commands.rs         wire builders
│           │   │   ├── events.rs           ProtocolEvent enum（旧 ControlEvent，已 deprecated alias）
│           │   │   ├── escape.rs           octal codec（旧，已迁到 protocol/codec.rs）
│           │   │   └── controller.rs       旧 monolith（已迁到 controller/mod.rs）
│           │   ├── session_log.rs          per-session 日志模块
│           │   └── config/               NEW (M3): toml 配置 + 热更新
│           ├── infrastructure/      外部资源抽象（trait）
│           │   ├── pty.rs                portable-pty 实现
│           │   ├── ssh.rs                russh 实现 + known_hosts（**host key 验证默认 disabled — AGENTS.md 已知 gap**）
│           │   └── tmux/                 tmux transport 抽象
│           └── models/               数据模型
├── doc/                           文档（详见 doc/README.md）
├── prd.md, mcp.md, etc.           （已迁到 history/external/ai-terminal-spec/）
└── scripts/                        运维脚本
```

## 3. 进程模型

```
┌──────────────────────────────────────────────────────────┐
│ ai-terminal.exe (Tauri 主进程，Rust)                      │
│                                                          │
│  ┌──────────────┐  tokio::mpsc  ┌──────────────────┐   │
│  │ pty/ssh/tmux │ ────────────▶│ SessionManager    │   │
│  │ backends     │ ◀─────────── │ (DashMap<u32,…>)  │   │
│  └──────────────┘              └──────────────────┘   │
│                                                          │
│  ┌─────────────────────────────────────────────────┐     │
│  │ protocol/ 子模块（P1-P5 拆分）                  │     │
│  │ wire / codec / parser / events / version / cmd │     │
│  │   ↓                                            │     │
│  │ controller/ 子模块（P3-P5 拆分）              │     │
│  │ id_map / handshake / subscriber                │     │
│  │   ↓                                            │     │
│  │ dispatcher（reader → parser → router → bridge）│     │
│  └─────────────────────────────────────────────────┘     │
│                                                          │
│  ┌──────────────────┐                                     │
│  │ WebView2 (UI)    │◀──── invoke/listen ────         │
│  │ React + xterm.js │                                     │
│  └──────────────────┘                                     │
└──────────────────────────────────────────────────────────┘
```

## 4. 关键技术栈

| 层级 | 技术 |
|---|---|
| 桌面壳 | Tauri 2（WebView2 on Windows / WKWebView on macOS / WebKitGTK on Linux） |
| 前端 | React 19 + TypeScript 5.8 + Vite 7 |
| 终端渲染 | xterm.js 6 + `@xterm/addon-fit`（**待升级**：addons-{image,unicode11,search,serialize,webgl}） |
| 后端 | Rust（`portable-pty` 0.8 + `russh` 0.50-beta.7 + `tauri-plugin-store` 2 + `tracing` + `dashmap`） |
| 持久化 | `tauri-plugin-store`（JSON，**目标：M3 W10-12 迁到 toml**）|
| 样式 | 原生 CSS（无 CSS-in-JS / Tailwind）；design-system token 在 `:root` |
| 状态管理 | React Context（**按职责拆到 11 文件**）+ `useState` / `useRef`（无 Redux/Zustand）|
| 测试 | Vitest（前端 `paneUtils.test.ts` 等）+ mockall（Rust 后端 `session_manager.rs::tests`）|

## 5. tmux 集成（§5.7 详解）

xsterm 通过 tmux `-CC`（control mode）协议，把**一个 tmux server**的所有 sessions / windows / panes 映射到 xsterm 的 window / pane tree，由 xsterm 的 React 渲染层替代 tmux 自带的 TUI。设计哲学：iTerm2 / WezTerm 路线。

### 5.1 概念层级（不能混淆）

| 概念 | 是什么 | 拥有方 |
|---|---|---|
| **xsterm session** | **backend 连接** —— 一个能读写 stdin/stdout 的活动实体 | Rust：`SessionManager.sessions` |
| **workspace** | UI 顶层容器 | React：`workspaces[]` |
| **xsterm Window** | UI 二级容器，承载一棵 `PaneTree`，对应 tmux window（1:1） | React：`workspace.windows[]` |
| **pane**（PaneTree leaf） | UI 三级容器，渲染一个 xterm.js 实例 | React：`window.rootPane` 树 |

### 5.2 进程模型（tmux 子系统）

```
IPC worker (write_session)
       │
       ▼
stdin_tx ──→ cmd_rx ──→ writer task ──→ backend.stdin
                                       (single dispatch)

backend.stdout ──→ reader task ──→ dispatch_tx ──→ dispatch_rx
                                    (parser.feed)        │
                                                       ▼
                                              dispatch task
                                                       │
                                                       ▼
                                              app_backend.emit(...)

first_pane_tx ◄─────── (signalled once, on the first WindowPaneChanged)

backend.wait() ──→ monitor task ──→ dispatch_tx (Exit event)
```

- `TmuxController::send_keys` / `resize_pane` / `kill_pane` 用 `UnboundedSender`，**永不阻塞 caller**——writer task 后台排空
- `TmuxController::split_pane` 用 **`oneshot::Sender`** 在 `pending_splits` 注册，dispatch task pop front sender 匹配 `%window-pane-changed` 响应
- reader task 独占 parser + stdout reader，唯一看到 tmux 原始字节的地方，EOF 时干净退出
- monitor task 与 `TmuxController::close` race 抢 backend 所有权

### 5.3 关键文档指针

- 协议层细节：`adr/0005-tmux-redesign-v0.md`（PR-T1..T5 拆分设计）+ `history/prd-0.1-arch-snapshot/tmux-cc-protocol.md`（Wave 0-6 协议历史）
- PR 切片：`roadmap/migration-prs.md`
- Bug 历史：`changelog/bugs.md`（Bug 001-022）

## 6. Capabilities

Tauri 2 capabilities 配置在 `src-tauri/capabilities/default.json`。当前包含：

- `core:default`, `opener:default`, `store:default`
- `clipboard-manager:default`, `clipboard-manager:allow-read-image`, `clipboard-manager:allow-read-text`, `clipboard-manager:allow-write-text`
- 窗口控制：`minimize`, `maximize`, `unmaximize`, `close`, `is-maximized`, `start-dragging`

新增 Tauri command **必须**同步更新 capability JSON（AGENTS.md 强约束）。

## 7. 已知风险（详见 `changelog/bugs.md` + `changelog/perf.md`）

| 风险 | 状态 | 文档 |
|---|---|---|
| SSH host key verification 默认 disabled | 已知 gap，**不动**除非 owner 拍板 | `AGENTS.md` §"Important Gotchas" |
| CSP `csp: null` | 已知 gap | `AGENTS.md` §"Important Gotchas" |
| tmux 启动 handshake 18 个连续 bug | P1-P5 已修 race 原因，但 v2 路径未启用 | `changelog/bugs.md` Bug 007-022 |
| TUI addon 缺失（image / unicode11 / webgl） | P5 目标 | `roadmap/migration-prs.md` |
| mockall mock 与 Box / Arc 转换 | 每次重构 SSH backend 都触发 | `changelog/perf.md` |

## 8. 演进方向（详见 `roadmap/target-architecture.md`）

- **M3**（W10-12）：MCP server + toml 配置迁移
- **M4**（W13-15）：反向 SSH tunnel + 远程 agent
- **M5**（W16-17）：Microsoft Store 打包 + 签名
- **M6**（W18-19）：i18n + a11y + 性能基线
- **M7+**：公测 + 准备 v1.1

## 9. Onboarding 路径

新人要快速上手，按顺序读：

1. **AGENTS.md**（项目根）—— 必读清单
2. **本文件**（`doc/architecture/overview.md`）—— 代码结构
3. **`adr/0005-tmux-redesign-v0.md`** —— tmux 子系统的设计意图
4. **`roadmap/migration-prs.md`** —— 当前 sprint 在做什么
5. **`changelog/bugs.md`** —— 最近踩过什么坑
6. 具体改代码时再查对应章节的 `architecture/*.md`（待 P1-P5 落地后补齐）

详细每个子模块的文档指针见各文件头部。
