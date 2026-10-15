# xsterm — Architecture

> xsterm 的系统架构权威文档。本文件 + `doc/arch/LAYERS.md`（每层细节）+ `doc/blueprint/M*.md`（里程碑蓝图）三件套是**设计与施工依据**。
>
> 实现按本文件走。如果代码与本文档不一致——**改代码**而不是改文档；如果设计本身要变，先改文档再改代码。
>
> 与 `DESIGN.md` 的关系：`DESIGN.md` 约束 **chrome 视觉**（颜色 / 间距 / 圆角 / hairline）。本文件约束 **结构与模块边界**（谁拥有什么、谁不能依赖谁）。两份文档作用域正交，互不覆盖。

---

## 1. TL;DR

xsterm 是 Tauri 2 + React 19 的 Windows 桌面终端模拟器。架构是 **5 层单向依赖**（M2 重整后从 8 层压到 5 层），自底向上：

| 层             | 名称             | 拥有                                                    | 一句话定位                                             |
| -------------- | ---------------- | ------------------------------------------------------- | ------------------------------------------------------ |
| **L4 view**    | React 视图层     | `src/view/`(layout / components / hooks / styles / App) | 用户能碰到的所有 chrome;唯一调 React 的层              |
| **L3 adapter** | 外部库适配       | `src/adapter/xterm/`                                    | 唯一接触 `@xterm/*`;每外部库一个子目录                 |
| **L2 data**    | 数据 + IPC       | `src/data/{model,service}/`                             | model 是纯类型,service 是唯一调 `@tauri-apps/api` 的层 |
| **L1**         | Tauri Glue       | `src-tauri/src/commands/`、`events.rs`、`state.rs`      | 命令/事件名 + AppState + dispatch 线程                 |
| **L0**         | Core (pure Rust) | `src-tauri/src/core/`                                   | portable-pty、shell trait、session manager             |

依赖方向:**上层可依赖下层,下层不知道上层存在**。`L2 ↔ L1` 是唯一 IPC 边界,两边通过类型镜像沟通。`L3` 隔离外部库,view 只能通过 adapter 拿。

子结构:

- **L4 view** 内部:view.layout(布局 chrome)/ view.components(叶子 chrome)/ view.hooks(状态)/ view.styles(L8 tokens)
- **L2 data** 内部:data.model(纯类型,无 IO)/ data.service(IPC,唯一调 `@tauri-apps/api`)
- **L6 composition root**:`src/view/App.tsx`,装 Provider + 组合根布局,不在 view 子类中(见 §4)

---

## 2. 两条平行但独立的视觉轴

详见 `DESIGN.md` §3,这里只复述对架构有约束的部分:

| 轴                | 文件 / 入口                                         | 适用                                     | 受谁约束                       |
| ----------------- | --------------------------------------------------- | ---------------------------------------- | ------------------------------ |
| **Shell chrome**  | `src/view/styles/tokens.css` `:root` + `var(--...)` | titlebar、tab、status、button、dialog... | `DESIGN.md`                    |
| **xterm content** | `src/adapter/xterm/theme.ts` 的 xterm `theme` 对象  | PTY 输出 / 光标 / 选区 / 256-color       | 不受 `DESIGN.md` 约束,自有 hex |

约束:

- L4 view 组件 CSS **不写 hex**(除 `view/styles/tokens.css` `:root` 本身)。
- L3 adapter xterm theme 对象 **不读 CSS vars**(xterm 是 canvas 渲染)。
- 两套色值同号是巧合——不要从 L4 反推 L3 颜色,也不要从 L3 反推 L4 token。

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

## 4. 硬规则(跨层不变式)

违反任何一条 = 重构。**M2 重整后 8 条简化到 3 条核心**(其余默认从前面推到)。

| #      | 规则                                                                                                                                             | 理由                                                                                     |
| ------ | ------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------- |
| **R1** | L2 data 是**唯一**调 `@tauri-apps/api` 的层。L3 adapter / L4 view 不得 `import` `invoke` / `listen`。                                            | IPC 翻译器集中在一处,type 镜像只此一处维护;view 拿不到 IPC 细节(防"懒得封装直接 invoke") |
| **R3** | L3 adapter 是**唯一** import `@xterm/*` 的层。L2 data / L4 view 不得直接 `new Terminal()`,拿类型通过 `src/adapter/xterm/xterm.ts` 的 re-export。 | xterm 实例生命周期集中管理,theme 单点;view 不知道 `@xterm/*` 的存在                      |
| **R4** | L0 不依赖 Tauri。`src-tauri/src/core/` 不得 `use tauri::...`。                                                                                   | core 可单元测试;不耦合 WebView 运行时                                                    |

### 隐式约定(以前 R2/R5/R6/R7/R8 的并入)

- **L2.model 是纯 TS**——无 IO、无 IPC、无 DOM、无 React。导出 `interface` / `type` / 常量(以前 R2)
- **L1 命令名 = Rust 函数名**(`snake_case`),事件名同。两边是字符串字面量,精确匹配(以前 R5)
- **L0 → L1 的类型不引入 serde 之外的属性**;L2 → L2.model 镜像类型手写(M5 之前不上 codegen)(以前 R7)
- **PaneTree 在 L2.model**(原 R8)。Rust 不感知 split / tab。`session_id` 是 L0 ↔ L2.model 的外键。L1/L0 不知道"用户在第 3 个 split"。新建 pane = `usePaneTree` action 调 L2.service 拿 `SessionId` + 改 L2.model tree;关闭同理。

### 关于 L6(App.tsx)的位置

`src/view/App.tsx` 是 **L6 composition root**,不在 L4 子分类。它的工作是装 `PaneTreeProvider`、组合根布局(`Workspace` = TabBar + SplitContainer)。它不归"布局/组件/事件"任何一类 — 是它们的粘合层。如果未来加 `src/routes/`,也放 L6。

---

## 5. 跨层契约

### 5.1 IPC 命令表（M1 起逐步落地）

| 命令              | 方向      | Payload (Rust)                    | Response                  | 事件                      | 备注               |
| ----------------- | --------- | --------------------------------- | ------------------------- | ------------------------- | ------------------ |
| `spawn_terminal`  | TS → Rust | `{rows, cols, shell: ShellKind}`  | `SessionId` (string/uuid) | `terminal-data` (start)   | M0 已存在，M1 重构 |
| `write_terminal`  | TS → Rust | `{id: SessionId, data: number[]}` | `()`                      | —                         | M1 实现写          |
| `resize_terminal` | TS → Rust | `{id, rows, cols}`                | `()`                      | —                         | M1 实现            |
| `close_session`   | TS → Rust | `{id}`                            | `()`                      | `terminal-data` (stop)    | M2                 |
| `list_sessions`   | TS → Rust | `()`                              | `SessionInfo[]`           | —                         | M2                 |
| `shell_list`      | TS → Rust | `()`                              | `ShellDescriptor[]`       | —                         | M5                 |
| `buffer_load`     | TS → Rust | `{id}`                            | `BufferChunk[]`           | —                         | M4                 |
| `buffer_append`   | Rust → TS | —                                 | —                         | `terminal-buffer` (event) | M4                 |

`ShellKind` 枚举：`PowerShell`、`Wsl`、`GitBash`、`Bash`（仅 Linux）。字符串值同 Tauri 命令约定（UPPER_SNAKE）。

### 5.2 事件载荷约定

| 事件              | Payload                           | 说明                                                                    |
| ----------------- | --------------------------------- | ----------------------------------------------------------------------- |
| `terminal-data`   | `{id: SessionId, data: number[]}` | 单向流。新增 `id` 字段是 M2 的前置；M1 加字段 → TS 解构判断 id 是否存在 |
| `terminal-exit`   | `{id, code: number}`              | M2                                                                      |
| `terminal-buffer` | `{id, chunks: BufferChunk[]}`     | M4，buffer 恢复用                                                       |

### 5.3 类型镜像（L0/L1 ↔ L3/L2）

- 镜像是**手写**，不上 codegen（M5 之前）
- 字段顺序保持一致便于 review
- 任一侧字段重命名/重排，必须同步另一侧并在 commit body 写 `BREAKING: <name>`

---

## 6. 依赖方向图(M2 重整后 5 层)

```
   ┌─────────────────────────────────────────────────────┐
   │ L4 view: src/view/                                  │
   │   ├─ App.{tsx,css}    L6 composition root         │
   │   ├─ layout/         布局 chrome                    │
   │   │   ├─ TabBar                                       │
   │   │   └─ SplitContainer                              │
   │   ├─ components/     叶子 chrome                    │
   │   │   ├─ PaneChrome                                  │
   │   │   └─ PaneInitCard                                │
   │   ├─ hooks/          React state/lifecycle          │
   │   │   ├─ usePaneTree                                 │
   │   │   └─ useTerminalSession                          │
   │   └─ styles/tokens.css  L8 design tokens            │
   └────────────┬─────────────────────┬──────────────────┘
                │                     │
   ┌────────────▼──────────┐  ┌───────▼──────────────┐
   │ L3 adapter:           │  │ L2 data:              │
   │ src/adapter/xterm/    │  │ src/data/             │
   │   ├─ xterm.ts (工厂)  │  │   ├─ model/  纯类型  │
   │   ├─ theme.ts         │  │   │   ├─ shell.ts     │
   │   ├─ TerminalView.tsx │  │   │   ├─ session.ts   │
   │   ├─ useXterm.ts      │  │   │   └─ pane.ts      │
   │   ├─ useContainerFit  │  │   └─ service/ IPC   │
   │   └─ useXtermTheme    │  │       ├─ pty.ts       │
   │      (唯一 import      │  │       ├─ session.ts   │
   │       @xterm/*)       │  │       └─ types.ts     │
   └───────────────────────┘  │      (唯一 import      │
                              │       @tauri-apps/api)│
                              └────────────┬──────────┘
                                           │ IPC
═══════════════════════════════════════════╪══════════════════
                                           │
                              ┌────────────▼──────────┐
                              │ L1 Tauri Glue          │
                              │ src-tauri/src/         │
                              │   ├─ commands/         │
                              │   │   ├─ spawn.rs       │
                              │   │   ├─ write.rs       │
                              │   │   ├─ resize.rs      │
                              │   │   └─ session.rs     │
                              │   ├─ events.rs         │
                              │   ├─ state.rs          │
                              │   ├─ error.rs          │
                              │   └─ lib.rs            │
                              └────────────┬──────────┘
                                           │
                              ┌────────────▼──────────┐
                              │ L0 Core (pure Rust)    │
                              │ src-tauri/src/core/    │
                              │   ├─ pty.rs            │
                              │   ├─ shell.rs          │
                              │   └─ session.rs        │
                              │   (no tauri::* 依赖)   │
                              └───────────────────────┘
```

**关键边界**:

- L4 view 调 L2 data **必须经 hook**——不允许 view 组件直接 `import { spawnTerminal }`
- L2 data 调 L1 Tauri 走 IPC(类型镜像约束)
- L3 adapter 是 view 拿外部库类型的唯一入口
- L0 不依赖 L1(可在没有 Tauri runtime 的环境跑测试)

---

## 7. 里程碑

每个里程碑**必须**：

- 跑通既有路径（行为不退化）
- `npm run build` + `cargo build --release` 全绿
- `lib.rs` 不超过阶段定义的上限
- 文档先于代码（如有新增层 / 新增 IPC 契约）

| M      | 主题              | 涉及层                      | 验收摘要                                              | 蓝图                                            |
| ------ | ----------------- | --------------------------- | ----------------------------------------------------- | ----------------------------------------------- |
| **M0** | 骨架(原始)        | L0+L1+L7 雏形               | 单 PTY + PowerShell                                   | —                                               |
| **M1** | **内聚**(重构)    | L0–L7(8 层)                 | 行为与 M0 一义;`lib.rs`< 80 行;目录分层完成           | [`M1-REFACTOR.md`](../blueprint/M1-REFACTOR.md) |
| **M2** | 多会话            | L0+L1+L2+L3+L4              | Tab + Split(h/v);至少 4 pane 可同时存活               | [`M2-SESSIONS.md`](../blueprint/M2-SESSIONS.md) |
| **M3** | 设计系统          | L4 view + tokens            | `tokens.css` 补全;TitleBar/StatusBar/Dialog 等 chrome | 待写                                            |
| **M4** | Buffer + 复制粘贴 | L0 core/buffer + L2 service | 重启恢复上次会话 scrollback;复制粘贴                  | 待写                                            |
| **M5** | 设置              | L2 service + L4 view        | 主题切换、shell 选择、字体;`tauri-plugin-store`       | 待写                                            |

> M1 是**纯重构**，不加新功能。这是后续所有里程碑的基础。

---

## 8. 派生决策记录

> 这里只记录**会反复影响实现**的决策。已锁死。

| #   | 决策              | 选定方案                  | 否决方案                     | 影响                                                 |
| --- | ----------------- | ------------------------- | ---------------------------- | ---------------------------------------------------- |
| D1  | PaneTree 归属     | **L3（TS）**              | L0/L1 Rust 持有              | split 是 UI 概念，不污染后端                         |
| D2  | 多会话模型        | **Tab + Split(h/v)** 都做 | 只 Tab；只 Split             | L3 `PaneNode` = `Leaf \| HSplit(a,b) \| VSplit(a,b)` |
| D3  | 设置持久化        | **`tauri-plugin-store`**  | localStorage；纯 Rust 文件   | M5 引入；JSON 文件 in app data                       |
| D4  | Scrollback 持久化 | **做**（M4）              | 不做                         | L0 `core/buffer/`；Rust side store；按需重水合       |
| D5  | 测试基线          | **M1 不上测试**           | M1 起就加 Rust unit + Vitest | M2 视情况补                                          |
| D6  | 类型镜像          | **手写**                  | ts-rs / specta               | 工具链最小；M5 评估 codegen                          |
| D7  | Shell 抽象        | **M1 落地 Shell trait**   | 硬编码 PowerShell            | L0 `core/shell.rs`；M5 加 Shell 选择 UI              |
| D8  | 前端层数压缩       | **8 层 → 5 层**(L0/L1/L2/L3/L4)|保留 8 层细分(M1 末)|适合 M2 早期规模;R 规则从 8 条简化到 3 条核心;`view/{layout,components,hooks,styles}/` 内部子类化 |

---

## 9. 开放问题（待后续里程碑决定）

| #   | 问题                                                       | 计划阶段 | 备注                             |
| --- | ---------------------------------------------------------- | -------- | -------------------------------- |
| Q1  | Buffer 持久化介质：SQLite vs 二进制文件 vs xterm-only      | M4       | 当前倾向二进制文件 + 简单分页    |
| Q2  | WSL 接入方式：`wsl.exe` 子命令 vs Rust 端 Win→Linux bridge | M5       | 默认走 `wsl.exe`                 |
| Q3  | Clipboard：Tauri `clipboard-manager` vs 浏览器 API         | M4       | 倾向 Tauri plugin（OS 原生路径） |
| Q4  | 字体持久化粒度：全局 vs per-session                        | M5       | 倾向全局                         |
| Q5  | 主题切换：重建 xterm vs 热更新 theme                       | M5       | 待 `@xterm` API 验证             |
| Q6  | `ts-rs` / `specta` 是否引入                                | M5       | L1/L3 镜像 > 20 字段时考虑       |

---

## 10. 参考

- `DESIGN.md` — chrome 视觉约束
- `doc/arch/LAYERS.md` — 每层细节
- `doc/blueprint/M1-REFACTOR.md` — M1 施工图(8 层)
- `doc/blueprint/M2-SESSIONS.md` — M2 施工图
- `doc/arch/frontend-quick-ref.md` — 目录 ↔ L 层速查(精简版)
- `doc/rules/ts-name-rules.md`、`doc/rules/rust-name-rules.md` — 命名规范
- `AGENTS.md` — 项目协作规则

---

## 修订记录

| 日期           | 变更                                                                                                                 | 作者     |
| -------------- | -------------------------------------------------------------------------------------------------------------------- | -------- |
| 初版           | 8 层架构 L0–L8 + D1–D7 决策                                                                                          | Sisyphus |
| 2025-10 A 重整 | 前端 8 层 → 5 层;L0/L1 保留;L2/L3/L4 重整为 L2 data / L3 adapter / L4 view;R 规则从 8 条简化到 3 条核心;新增 D8 决策 | Sisyphus |
