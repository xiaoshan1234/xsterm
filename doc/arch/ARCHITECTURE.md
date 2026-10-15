# xsterm — Architecture

> xsterm 的系统架构权威文档。本文件 + `doc/arch/LAYERS.md`（每层细节）+ `doc/blueprint/M*.md`（里程碑蓝图）三件套是**设计与施工依据**。
>
> 实现按本文件走。如果代码与本文档不一致——**改代码**而不是改文档；如果设计本身要变，先改文档再改代码。
>
> 与 `DESIGN.md` 的关系：`DESIGN.md` 约束 **chrome 视觉**（颜色 / 间距 / 圆角 / hairline）。本文件约束 **结构与模块边界**（谁拥有什么、谁不能依赖谁）。两份文档作用域正交，互不覆盖。

---

## 1. TL;DR

xsterm 是 Tauri 2 + React 19 的 Windows 桌面终端模拟器。架构是 **8 层单向依赖**，自底向上：

| 层 | 名称 | 拥有 | 一句话定位 |
|---|---|---|---|
| **L8** | Design System | `src/styles/tokens.css`、chrome 组件 | chrome 的视觉合约（DESIGN.md 的执行点） |
| **L7** | Chrome UI | `src/components/`（Terminal/TabBar/StatusBar/...） | 用户能碰到的 chrome 部分 |
| **L6** | App Shell + Routing | `src/App.tsx`、未来 `src/routes/` | 应用骨架与导航 |
| **L5** | Hooks / ViewModel | `src/hooks/` | 把 IPC 流对接到 React 生命周期 |
| **L4** | xterm Adapter | `src/lib/xterm/` | **唯一**接触 xterm.js API 的层 |
| **L3** | Domain Model | `src/domain/` | 纯 TS，零 IO，零 IPC，可单测 |
| **L2** | Services / IPC | `src/services/` | **唯一**调用 `invoke()`/`listen()` 的层 |
| **L1** | Tauri Glue | `src-tauri/src/commands/`、`state.rs` | 命令/事件名 + AppState 注入 |
| **L0** | Core (pure Rust) | `src-tauri/src/core/` | portable-pty、shell trait、session manager |

依赖方向：**上层可依赖下层，下层不知道上层存在**。`L2 ↔ L1` 是唯一的 IPC 边界，两边通过类型镜像沟通。`L4 ↔ L8` 是唯一的视觉边界——**不**互通。

---

## 2. 两条平行但独立的视觉轴

详见 `DESIGN.md` §3，这里只复述对架构有约束的部分：

| 轴 | 文件 / 入口 | 适用 | 受谁约束 |
|---|---|---|---|
| **Shell chrome** | `src/styles/tokens.css` `:root` + `var(--...)` | titlebar、tab、status、button、dialog... | `DESIGN.md` |
| **xterm content** | `src/types/theme.ts` 的 xterm `theme` 对象 | PTY 输出 / 光标 / 选区 / 256-color | 不受 `DESIGN.md` 约束，自有 hex |

约束：
- L8 组件 CSS **不写 hex**（除 `tokens.css` `:root` 本身）。
- L4 xterm theme 对象 **不读 CSS vars**（xterm 是 canvas 渲染）。
- 两套色值同号是巧合——不要从 L8 反推 L4 颜色，也不要从 L4 反推 L8 token。

---

## 3. 范围与非目标

### 3.1 范围内

- 单进程 PowerShell / WSL / Git Bash / bash（按平台默认）PTY 启动与 I/O
- 多 PTY 会话（M2）：横向 Tab + 纵向/横向 Split
- xterm.js 终端渲染 + 自适应 + 主题
- Chrome 设计系统（M3 起）
- Scrollback 持久化（M4）：Rust side store，重启后恢复
- 设置（M5）：shell 选择、主题、字体
- Tauri plugin：`opener`（已用）、`clipboard-manager`（M4）、`store`（M5）、`fs`（M4 buffer）、可选 `dialog`

### 3.2 范围外（明确不做）

- 多用户、远程、SSH、串口 —— 不是本期
- **插件系统 / 自定义 shell SDK** —— `ref/oxideterm` 那条路不在本期
- 自定义键位 / 宏 / snippet —— M5 之后讨论
- AI 增强（命令建议、补全）—— 不在范围
- Linux / macOS 一等公民 —— 通过 `cfg(target_os)` 分支跑通，但不是验证场景

---

## 4. 硬规则（跨层不变式）

违反任何一条 = 重构。

| # | 规则 | 理由 |
|---|---|---|
| **R1** | L2 是**唯一**调用 `@tauri-apps/api` 的层。L3 / L4 / L5 / L7 不得 `import` `invoke` 或 `listen`。 | IPC 翻译器集中在一处，type 镜像只此一处维护 |
| **R2** | L3 是**纯 TS**——无 IO、无 IPC、无 DOM、无 React。导出 `interface` / `type` / 常量；不导出 `class` 持有状态（除了 `PaneTree` 这种不可变数据结构）。 | 单测性 + 可换实现 |
| **R3** | L4 是**唯一** import `@xterm/xterm` / `@xterm/addon-*` 的层。L7 不得直接 new `Terminal`。 | xterm 实例生命周期集中管理，theme 单点 |
| **R4** | L0 不依赖 Tauri。`src-tauri/src/core/` 不得 `use tauri::...`。 | core 可单元测试；不耦合 WebView 运行时 |
| **R5** | L1 命令名 = Rust 函数名（`snake_case`），事件名同。两边是字符串字面量，必须精确匹配。 | 序列化契约 |
| **R6** | Tauri 命令 payload 的 `Vec<u8>` 在 TS 侧按 `number[]` 接收，必须 `new Uint8Array(payload)` 再 `TextDecoder`（见 `AGENTS.md` §IPC）。 | 已有约定，新命令类型必须保持 |
| **R7** | L0 → L1 的类型不引入 serde 之外的属性。L2 → L3 的镜像类型手动维护（M5 之前不上 `ts-rs`/`specta`）。 | 工具链最小化 |
| **R8** | PaneTree 在 L3。Rust 不感知 split / tab。`session_id` 是 L0 ↔ L3 的外键。 | UI 布局不应污染后端状态机 |

R8 详细：
- L0 的 `SessionManager` 只持有 `SessionId → SessionHandle`
- L3 的 `PaneTree` 是纯数据结构，叶子节点是 `Pane { sessionId, ... }`
- L5 hooks 持有 `PaneTree` 状态；新建 pane = 调用 L2 服务拿 `SessionId` + 在 L3 PaneTree 上插入叶子
- 关闭 pane = 从 PaneTree 移除叶子 + 调用 L2 `close_session(id)`
- L1 / L0 不知道"用户在第 3 个 split"

---

## 5. 跨层契约

### 5.1 IPC 命令表（M1 起逐步落地）

| 命令 | 方向 | Payload (Rust) | Response | 事件 | 备注 |
|---|---|---|---|---|---|
| `spawn_terminal` | TS → Rust | `{rows, cols, shell: ShellKind}` | `SessionId` (string/uuid) | `terminal-data` (start) | M0 已存在，M1 重构 |
| `write_terminal` | TS → Rust | `{id: SessionId, data: number[]}` | `()` | — | M1 实现写 |
| `resize_terminal` | TS → Rust | `{id, rows, cols}` | `()` | — | M1 实现 |
| `close_session` | TS → Rust | `{id}` | `()` | `terminal-data` (stop) | M2 |
| `list_sessions` | TS → Rust | `()` | `SessionInfo[]` | — | M2 |
| `shell_list` | TS → Rust | `()` | `ShellDescriptor[]` | — | M5 |
| `buffer_load` | TS → Rust | `{id}` | `BufferChunk[]` | — | M4 |
| `buffer_append` | Rust → TS | — | — | `terminal-buffer` (event) | M4 |

`ShellKind` 枚举：`PowerShell`、`Wsl`、`GitBash`、`Bash`（仅 Linux）。字符串值同 Tauri 命令约定（UPPER_SNAKE）。

### 5.2 事件载荷约定

| 事件 | Payload | 说明 |
|---|---|---|
| `terminal-data` | `{id: SessionId, data: number[]}` | 单向流。新增 `id` 字段是 M2 的前置；M1 加字段 → TS 解构判断 id 是否存在 |
| `terminal-exit` | `{id, code: number}` | M2 |
| `terminal-buffer` | `{id, chunks: BufferChunk[]}` | M4，buffer 恢复用 |

### 5.3 类型镜像（L0/L1 ↔ L3/L2）

- 镜像是**手写**，不上 codegen（M5 之前）
- 字段顺序保持一致便于 review
- 任一侧字段重命名/重排，必须同步另一侧并在 commit body 写 `BREAKING: <name>`

---

## 6. 依赖方向图

```
                        ┌──────────────────────────────────────────────┐
   Chrome UI            │ L7: src/components/                          │
                        │   ├─ Terminal (组合 useTerminalSession)       │
                        │   ├─ TabBar (M2)                             │
                        │   ├─ SplitContainer (M2)                     │
                        │   ├─ StatusBar                               │
                        │   ├─ Dialog / Banner (M3+)                   │
                        │   └─ Settings (M5)                           │
                        └────────────┬─────────────────────────────────┘
                                     │ uses
                        ┌────────────▼─────────────────────────────────┐
   Design System        │ L8: src/styles/tokens.css, src/components/ui/ │
                        │   (chrome tokens; xterm 不读这里)             │
                        └────────────┬─────────────────────────────────┘
                                     │ styling tokens
                        ┌────────────▼─────────────────────────────────┐
   Hooks / VM           │ L5: src/hooks/                               │
                        │   ├─ useTerminalSession                      │
                        │   ├─ usePaneTree (M2)                        │
                        │   ├─ useSessionList (M2)                     │
                        │   ├─ useShellSelector (M5)                   │
                        │   ├─ useTheme                                │
                        │   └─ useFit                                  │
                        └─────┬───────────────────────┬─────────────────┘
                              │                       │
                  ┌───────────▼─────────┐  ┌──────────▼──────────────┐
   xterm Adapter   │ L4: src/lib/xterm/    │  │ L3: src/domain/         │
                  │   ├─ TerminalView    │  │   ├─ session.ts         │
                  │   ├─ useFit          │  │   ├─ pane.ts (M2)       │
                  │   ├─ useXtermTheme    │  │   ├─ buffer.ts (M4)     │
                  │   └─ useSelection (M4)│  │   ├─ shell.ts          │
                  └───────────┬──────────┘  │   └─ theme.ts (xterm)   │
                              │ uses        │      (纯 TS，零依赖)    │
                              └──────────────┼─────────────┬───────────┘
                                             │             │
                                ┌────────────▼─────────────▼───────────┐
   Services / IPC              │ L2: src/services/                       │
                                │   ├─ pty.ts       (invoke/listen)      │
                                │   ├─ session.ts   (M2)                  │
                                │   ├─ clipboard.ts (M4)                  │
                                │   ├─ store.ts     (M5)                  │
                                │   └─ buffer.ts    (M4)                  │
                                └────────────────────┬───────────────────┘
                                                     │ IPC
═════════════════════════════════════════════════════╪══════════════════
                                                     │
                                ┌────────────────────▼───────────────────┐
   Tauri Glue    │ L1: src-tauri/src/                       │
                │   ├─ commands/spawn.rs                   │
                │   ├─ commands/write.rs                   │
                │   ├─ commands/resize.rs                  │
                │   ├─ commands/session.rs (M2)            │
                │   ├─ commands/buffer.rs (M4)              │
                │   ├─ commands/store.rs (M5)              │
                │   ├─ events.rs                           │
                │   ├─ state.rs                            │
                │   └─ error.rs                            │
                └────────────────────┬───────────────────┘
                                     │
                ┌────────────────────▼───────────────────┐
   Core (pure Rust) │ L0: src-tauri/src/core/            │
                │   ├─ pty/  (portable-pty wrapper)  │
                │   ├─ shell/ (Shell trait + 4 impls)  │
                │   ├─ session/ (Handle, Manager)      │
                │   └─ buffer/ (M4, scrollback store)  │
                └───────────────────────────────────────┘
```

---

## 7. 里程碑

每个里程碑**必须**：
- 跑通既有路径（行为不退化）
- `npm run build` + `cargo build --release` 全绿
- `lib.rs` 不超过阶段定义的上限
- 文档先于代码（如有新增层 / 新增 IPC 契约）

| M | 主题 | 涉及层 | 验收摘要 | 蓝图 |
|---|---|---|---|---|
| **M0** | 骨架（现状） | L0+L1+L4 雏形 | 单 PTY + PowerShell | — |
| **M1** | **内聚**（重构） | L0–L5 | 行为与 M0 一致；`lib.rs`< 80 行；目录分层完成 | [`M1-REFACTOR.md`](../blueprint/M1-REFACTOR.md) |
| **M2** | 多会话 | L0+L2+L3+L5+L7 | Tab + Split(h/v)；至少 4 pane 可同时存活 | `[`M2-SESSIONS.md`](../blueprint/M2-SESSIONS.md)`（待写） |
| **M3** | 设计系统 | L7+L8 | `tokens.css` 落地；TitleBar/TabBar/StatusBar 三件套 chrome | 待写 |
| **M4** | Buffer + 复制粘贴 | L0 core/buffer + L2 + L4 | 重启恢复上次会话 scrollback；复制粘贴 | 待写 |
| **M5** | 设置 | L2 store + L7 | 主题切换、shell 选择、字体；`tauri-plugin-store` | 待写 |

> M1 是**纯重构**，不加新功能。这是后续所有里程碑的基础。

---

## 8. 派生决策记录

> 这里只记录**会反复影响实现**的决策。已锁死。

| # | 决策 | 选定方案 | 否决方案 | 影响 |
|---|---|---|---|---|
| D1 | PaneTree 归属 | **L3（TS）** | L0/L1 Rust 持有 | split 是 UI 概念，不污染后端 |
| D2 | 多会话模型 | **Tab + Split(h/v)** 都做 | 只 Tab；只 Split | L3 `PaneNode` = `Leaf \| HSplit(a,b) \| VSplit(a,b)` |
| D3 | 设置持久化 | **`tauri-plugin-store`** | localStorage；纯 Rust 文件 | M5 引入；JSON 文件 in app data |
| D4 | Scrollback 持久化 | **做**（M4） | 不做 | L0 `core/buffer/`；Rust side store；按需重水合 |
| D5 | 测试基线 | **M1 不上测试** | M1 起就加 Rust unit + Vitest | M2 视情况补 |
| D6 | 类型镜像 | **手写** | ts-rs / specta | 工具链最小；M5 评估 codegen |
| D7 | Shell 抽象 | **M1 落地 Shell trait** | 硬编码 PowerShell | L0 `core/shell.rs`；M5 加 Shell 选择 UI |

---

## 9. 开放问题（待后续里程碑决定）

| # | 问题 | 计划阶段 | 备注 |
|---|---|---|---|
| Q1 | Buffer 持久化介质：SQLite vs 二进制文件 vs xterm-only | M4 | 当前倾向二进制文件 + 简单分页 |
| Q2 | WSL 接入方式：`wsl.exe` 子命令 vs Rust 端 Win→Linux bridge | M5 | 默认走 `wsl.exe` |
| Q3 | Clipboard：Tauri `clipboard-manager` vs 浏览器 API | M4 | 倾向 Tauri plugin（OS 原生路径） |
| Q4 | 字体持久化粒度：全局 vs per-session | M5 | 倾向全局 |
| Q5 | 主题切换：重建 xterm vs 热更新 theme | M5 | 待 `@xterm` API 验证 |
| Q6 | `ts-rs` / `specta` 是否引入 | M5 | L1/L3 镜像 > 20 字段时考虑 |

---

## 10. 参考

- `DESIGN.md` — chrome 视觉约束
- `doc/arch/LAYERS.md` — 每层细节
- `doc/blueprint/M1-REFACTOR.md` — 下一阶段施工图
- `doc/rules/ts-name-rules.md`、`doc/rules/rust-name-rules.md` — 命名规范
- `AGENTS.md` — 项目协作规则

---

## 修订记录

| 日期 | 变更 | 作者 |
|---|---|---|
| 初版 | 8 层架构落地；D1–D8 决策记录 | Sisyphus |