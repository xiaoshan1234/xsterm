# xsterm — Layers

> `ARCHITECTURE.md` 的配套。**前端 3 层** + **Rust 2 层**,共 5 层(L0/L1/L2/L3/L4)。重复信息已避免,跨层关系以本文件为准。
>
> 阅读顺序:先读 `ARCHITECTURE.md` 的 §1 / §4 / §6,再按需跳到本文件。
>
> **M2 重整**:前端从 5 层(L2 service / L3 model / L4 infra / L5 hooks / L7 ui)压到 3 层(L2 data / L3 adapter / L4 view)。R 规则从 8 条简化到 3 条核心。

---

## L0 — Core (Pure Rust)

**位置**:`src-tauri/src/core/`

**目的**:所有与 OS / PTY / 进程交互的逻辑集中在此。**不依赖 Tauri 运行时**——可单独 `cargo test -p xsterm_lib core`。

**拥有**:

- portable-pty 的薄封装(read/write/resize/kill)
- `Shell` trait + impl(PowerShell / Wsl / GitBash / Bash)
- `SessionHandle`(一个 PTY + 一个 child process)
- `SessionManager`(id → handle 映射,锁粒度 = handle)
- `BufferStore`(M4,scrollback 持久化)

**依赖**:仅 `portable-pty`、`tokio`(reader thread)、`serde`(用于跨边界序列化)。

**依赖等级**:L1(由 L1 调用 L0 的公共 API)。

**被依赖**:L1(命令 handler 直接调用 L0)。

**关键导出**(命名遵循 `doc/rules/rust-name-rules.md`):

```rust
// core/pty.rs
pub struct PtyPair { pub master: Box<dyn MasterPty + Send>, pub reader: Box<dyn Read + Send>, pub child: Box<dyn Child + Send + Sync> }
pub enum PtyError { Open(String), Spawn(String), CloneReader(String), CloneWriter(String), Resize(String), Write(String) }
pub fn open(shell: &dyn Shell, size: PtySize) -> Result<PtyPair, PtyError>;

// core/shell.rs
pub trait Shell: Send + Sync {
    fn kind(&self) -> ShellKind;
    fn build_command(&self) -> Result<CommandBuilder, ShellError>;
    fn default_size() -> PtySize where Self: Sized;
}
pub enum ShellKind { PowerShell, Wsl, GitBash, Bash }  // serde(rename = "powershell" 等)
pub fn build(kind: ShellKind) -> Result<Box<dyn Shell>, ShellError>;
pub fn detect_default_kind() -> ShellKind;
pub enum ShellError { Unsupported(ShellKind) }

// core/session.rs
pub struct SessionId(pub u64);  // newtype
pub struct SessionInfo { pub id: SessionId, pub shell_kind: ShellKind, pub alive: bool }  // serde(rename_all = "camelCase")
pub enum ReaderMessage { Data { id: SessionId, chunk: Vec<u8> }, Exit { id: SessionId } }
pub struct SessionHandle { pub shell_kind, pub writer, pub master, _child }
pub struct SessionManager { ... }  // impl spawn/write/resize/close/list/get
pub fn reader_channel() -> (Sender, Receiver);
pub enum SessionError { NotFound(SessionId), Shell(ShellError), Pty(PtyError), Io(String) }
```

**反模式**:

- ❌ `use tauri::...`(违反 R4)
- ❌ 持有 `tauri::State` / `tauri::Window` / `tauri::Emitter`
- ❌ reader 线程里直接 `app.emit(...)` — emit 是 L1 的事
- ❌ 锁整个 `SessionManager` 做 IO

---

## L1 — Tauri Glue

**位置**:`src-tauri/src/commands/`、`events.rs`、`state.rs`、`error.rs`、`lib.rs`

**目的**:把 L0 API 包成 `#[tauri::command]`,把 reader 线程的输出 dispatch 到前端。**唯一**接触 `tauri::AppHandle` 的层。

**拥有**:

- 命令模块:`commands/spawn.rs`、`write.rs`、`resize.rs`、`session.rs`(M2)
- `events.rs`:事件名常量 + payload 结构(M2: `TerminalDataPayload { id, data }` + `TerminalExitPayload { id }`)
- `state.rs`:`AppState { manager: Mutex<SessionManager> }`
- `error.rs`:`AppError` 枚举,序列化成字符串给前端
- `lib.rs`(≤ 100 行 M2):`tauri::Builder` + plugin 注册 + `generate_handler!` + dispatch 线程

**依赖**:L0(`core/`)、`tauri` 2、`tauri-plugin-opener`、M5+ 加 `tauri-plugin-store`/`clipboard-manager`

**被依赖**:无(前端不直接 import Rust)

**关键约定**:

- 命令 handler 第一行 `state.manager.lock()`,主体委托 L0
- reader 线程产出 → `mpsc::Sender<ReaderMessage>` → L1 dispatch 线程 → `app.emit("terminal-data", payload)`
- payload 必须 `#[derive(Serialize)]` 且与 L2 的镜像类型字段一致
- 错误返回 `Result<T, AppError>`,由 serde 序列化成字符串给前端

**反模式**:

- ❌ 命令 handler 内做 IO 编排——调用 L0 即可
- ❌ `unwrap()`——返回 `AppError::*`
- ❌ `panic!` 处理预期错误

---

## L2 — Data (Types + IPC)

**位置**:`src/data/`

**目的**:**业务领域 + IPC 契约** 的纯 TS 层。零 React、零 xterm。view 通过它接触 IPC,不知道 IPC 细节。

**Why this layer exists**(关键,常被误删):

- **测试性**:`PaneTree.splitLeaf()` 是纯函数,跑测试不需要 mock IPC / jsdom / Tauri runtime
- **重构安全**:Tauri 改 wire format(`Vec<u8>` → `{id, data}`)只动 service,view 不知道;React 改 reducer 只动 hook,service 不知道
- **R1 边界**:view 拿不到 `@tauri-apps/api`(防"懒得封装直接 invoke");adapter 拿不到 invoke(防绕过 IPC)
- **反例** — 没 data 层会怎样:把 `PaneNode` 写进 PaneChrome ×,因为 PaneChrome 要写 IPC(订阅 terminal-exit)和数据(leaf.status),耦合爆掉

**子目录**:

### L2.model — 纯类型(`src/data/model/`)

零依赖。拥有:

- `shell.ts`:`SHELL_KINDS` 常量 + `ShellKind` 字面量联合 + `DEFAULT_SHELL`
- `session.ts`:`SessionId` 类型 + `SessionInfo` 接口
- `pane.ts`(M2):`PaneNode` 判别联合(Leaf | Init | HSplit | VSplit) + `PaneTree` + `Tab` + 不可变操作(`splitLeaf` / `closeLeaf` / `focusLeaf` / `markLeafDead` / `replaceLeafSession` / `initToLeaf` / `createStartTree` / `collectSessions`)

**依赖**:无

**被依赖**:L2.service、L4 view

**关键约定**:

- 类型用 TS 字面量联合而非 `enum`(避免 `IUser` 风格,见 ts-name-rules)
- 不可变操作返回新 tree,调用方替换 state
- `PanePath` 用 `ReadonlyArray<0 | 1>` 表示 0/1 序列

**反模式**:

- ❌ 持有 `Uint8Array` 之外的运行时 IO
- ❌ 引入 React / xterm / Tauri 任何包
- ❌ 复用 L1 字符串字面量(如 `"terminal-data"`)——L3 不知道 IPC 名字

### L2.service — IPC 契约(`src/data/service/`)

唯一调 `invoke()`/`listen()` 的层。拥有:

- `pty.ts`:spawnTerminal / writeTerminal / resizeTerminal / onTerminalData
- `session.ts`(M2):closeSession / listSessions / onSessionExit
- `types.ts`:IPC 序列化形状(`SpawnRequest` / `WriteRequest` / `ResizeRequest` / `CloseSessionRequest` / `ListSessionsResponse` / `TerminalDataPayload` / `TerminalExitPayload`)

**依赖**:`@tauri-apps/api`、L2.model 类型镜像

**被依赖**:L4 view(通过 hook)

**关键约定**:

- `*Request` 接口含 `[key: string]: unknown` 索引签名,以满足 `invoke` 的 `InvokeArgs` 类型
- `TerminalDataPayload` 在 M2 含 `{id, data}` 字段(M1 是裸 `number[]`)
- 命令名常量在文件顶部,与 Rust `#[tauri::command]` 函数名精确匹配(R5)

**反模式**:

- ❌ L3 / L4 / adapter 调 `invoke` / `listen`——R1
- ❌ 写 React hook——hook 在 L4 view
- ❌ 持有 xterm / DOM / window 引用
- ❌ 把 IPC payload 类型放到 model/model——payload 是协议层关注点

---

## L3 — Adapter (External Library Bridge)

**位置**:`src/adapter/`

**目的**:**外部库的薄适配层**。M2 只有 xterm;M3+ 可能加 clipboard / 文件 IO / ssh。每个 adapter 独立成子目录。

**Why this layer exists**:

- **R3 边界**:view 拿不到 `@xterm/*`(防"绕开 TerminalView 直接 new Terminal()");data 拿不到 xterm(防耦合)
- **替换性**:哪天换 xterm → 改一个 adapter 目录,view/data 不动
- **测试性**:view 可以 mock adapter,测组件不需要真实 xterm 实例

**拥有 (M2)**:

- `xterm/`:
  - `theme.ts` — `XTERM_THEME` 常量(xterm 是 canvas 渲染,不读 CSS 变量)
  - `xterm.ts` — `createXterm()` 工厂 + `Terminal` 类型 re-export(L4 view 拿类型走这条,避免直接 import `@xterm/*`)
  - `useXterm.ts` — 创建 xterm 实例并挂载到容器
  - `useContainerFit.ts` — ResizeObserver per-pane(M2 用,替代 M1 的 window-resize only)
  - `useXtermTheme.ts` — 读 `theme.ts` 常量并 memo
  - `TerminalView.tsx` — 用 `useXterm` 渲染 div;`onTermReady` 回调把 xterm 实例交给 L4 view

**依赖**:`@xterm/xterm`、`@xterm/addon-fit`

**被依赖**:L4 view(`TerminalView` 是 L4 唯一可以渲染 xterm 的地方)

**关键约定**:

- L4 view 拿 xterm 实例通过 `TerminalView` 的 `onTermReady` 回调;拿类型通过 `import type { Terminal } from "../adapter/xterm/xterm"`(R3 re-export)
- theme 对象在 mount 时锁死(xterm 不支持热更新;Q5 待评估)

**反模式**:

- ❌ L2 / L4 其他位置 `new Terminal()`(违反 R3)
- ❌ 调 `invoke()` / `listen()`(IPC 在 L2)
- ❌ 写 chrome CSS(chrome 在 L4 view / tokens.css)

---

## L4 — View (React 视图层)

**位置**:`src/view/`

**目的**:**所有 React 代码**:组件 + hooks + composition root + 设计 tokens。这是用户能看到的全部。

**子目录**:

### L4.view.layout — 布局 chrome(`src/view/layout/`)

结构性 chrome,定义 UI 形状。拥有:

- `TabBar.tsx/css` — tab 条 + +/× 按钮
- `SplitContainer.tsx/css` — 递归 `PaneNode` 渲染

### L4.view.components — 叶子 chrome(`src/view/components/`)

叶子/可复用单元。拥有:

- `PaneChrome.tsx/css` — 单 leaf 容器:TerminalView + banner + toolbar
- `PaneInitCard.tsx/css` — "New local shell" 入口(参考 ref/xsterm)

### L4.view.hooks — React state/lifecycle(`src/view/hooks/`)

把 L2 service 桥到 React 生命周期,管理本地 state。拥有:

- `usePaneTree.ts`(M2)— tab + PaneTree 状态机,所有 actions(createTab / closeTab / initToLeaf / splitActivePane / closeLeaf / reconnectLeaf / markDead / focusLeaf)
- `useTerminalSession.ts`(M2)— 接管外部 sessionId,订阅 `terminal-data` / `terminal-exit` 并路由到 xterm;**race fix**:不等 xterm ready 就订阅,buffer flush
- `paneTreeContext.ts` — Context
- `PaneTreeProvider.tsx` — Provider 包装

事件 handler 归属(本层内):

- **本地事件**(按钮 onClick 改 state)— inline 到 .tsx 里
- **跨组件事件**(tab close / pane split / shell spawn)— 进 `view/hooks/`(如 `usePaneTree` 的 actions)
- **纯事件 helper**(防抖 / 格式化)— 需要时进 `view/hooks/`

### L4.view.styles — Design tokens(`src/view/styles/`)

L8 design tokens(M2 提前落地子集)。拥有:

- `tokens.css` — `--canvas` / `--accent` / `--hairline` 等 DESIGN.md §4 子集

### L6 composition root(`src/view/App.{tsx,css}`)

**L6** 是 App Shell,不在 L4。`App.tsx` 装 `PaneTreeProvider`、组合根布局(Workspace = TabBar + SplitContainer)。它不归"布局/组件/事件"任何一类 — 是它们的粘合层。

**依赖**:L2(通过 hook)、L3(通过 TerminalView)、L8(tokens.css)

**被依赖**:无(顶层)

**关键约定**:

- React 组件放 `view/{layout,components}/`,hook 放 `view/hooks/`,不动 IO
- view 拿 L2 类型用 `import type { ... }`(类型),运行时不依赖 L2.service — L4 view 通过 hook 间接访问 IPC
- view 拿 L3 类型用 `import type { Terminal } from "../adapter/xterm/xterm"`
- chrome CSS 只用 `var(--...)`(读 `view/styles/tokens.css`)

**反模式**:

- ❌ L2 / L3 调 `invoke` / `listen`——R1
- ❌ L2 / L3 写 React hook——hook 在 view
- ❌ 直接 `new Terminal()`——R3,通过 `TerminalView` 拿
- ❌ 写 hex 字面量(用 `var(--...)`)
- ❌ 在 chrome 上用 `box-shadow` / bold ≥ 600 / 渐变(DESIGN.md 红线)

---

## 附录 A:依赖矩阵(谁允许依赖谁)

| ↓ 依赖 / 上游 → | L8  | L4 view | L3 adapter | L2 data      | L1 (Rust) | L0 (Rust) |
| --------------- | --- | ------- | ---------- | ------------ | --------- | --------- |
| **L8**          | —   |         |            |              |           |           |
| **L4 view**     | ✅  | —       | ✅         | ✅(via hook) |           |           |
| **L3 adapter**  |     |         | —          |              |           |           |
| **L2 data**     |     |         |            | —            |           |           |
| **L1**          |     |         |            |              | —         | ✅        |
| **L0**          |     |         |            |              |           | —         |

读法:列依赖行。**任何反方向 import 都是架构违规**。

### 验证命令

```bash
# R1: L4 view / L3 adapter 不得 import @tauri-apps/api(只能 L2 data import)
grep -rn "@tauri-apps" src/view src/adapter

# R3: L2 data / L4 view 不得 import @xterm/*(只能 L3 adapter)
grep -rn "from \"@xterm" src/data src/view

# R4: L0 不得 use tauri
grep -rn "use tauri" src-tauri/src/core
```

---

## 附录 B:每个文件的归属层

```
src-tauri/src/                 (L0/L1,Rust)
  main.rs                      bin entry
  lib.rs                       L1 (≤ 100 行 M2)
  state.rs                     L1
  events.rs                    L1
  error.rs                     L1
  commands/                    L1
    mod.rs / spawn.rs / write.rs / resize.rs / session.rs
  core/                        L0
    mod.rs / pty.rs / shell.rs / session.rs / (M4: buffer.rs)

src/                           (L2/L3/L4,TS)
  main.tsx                     entry
  architecture/README.md       目录 ↔ L 层说明

  data/                        L2 (R1 边界,model+service 同根)
    model/                     L2.model  纯类型
      shell.ts / session.ts / pane.ts (M2)
    service/                   L2.service  IPC
      pty.ts / session.ts / types.ts

  adapter/                     L3 (R3 边界,每外部库一个子目录)
    xterm/
      theme.ts / xterm.ts / useXterm.ts
      useContainerFit.ts / useXtermTheme.ts / TerminalView.tsx

  view/                        L4 (所有 React 代码)
    App.{tsx,css}              L6 composition root
    layout/                    布局 chrome
      TabBar.{tsx,css} / SplitContainer.{tsx,css}
    components/                叶子 chrome
      PaneChrome.{tsx,css} / PaneInitCard.{tsx,css}
    hooks/                     React state/lifecycle
      usePaneTree.ts / useTerminalSession.ts
      paneTreeContext.ts / PaneTreeProvider.tsx
    styles/                    L8 design tokens (M2 子集)
      tokens.css
```

---

## 修订记录

| 日期           | 变更                                                                                                                |
| -------------- | ------------------------------------------------------------------------------------------------------------------- |
| 初版           | 8 层架构 L0–L8 + D1–D8 决策                                                                                         |
| 2025-10 A 重整 | 前端 5 层 → 3 层;删除 L5/L7 章节,合并入 L4 view;删除 L8 独立章节,合并入 L4.view.styles;R 规则从 8 条简化到 3 条核心 |
