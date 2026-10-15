# xsterm — Layers

> `ARCHITECTURE.md` 的配套。每层一节。重复信息已避免，跨层关系以本文件为准。
>
> 阅读顺序：先读 `ARCHITECTURE.md` 的 §1 / §4 / §6，再按需跳到本文件。

---

## L0 — Core (Pure Rust)

**位置**：`src-tauri/src/core/`

**目的**：所有与 OS / PTY / 进程交互的逻辑集中在此。**不依赖 Tauri 运行时**——可单独 `cargo test -p xsterm_lib core`。

**拥有**：
- portable-pty 的薄封装（read/write/resize/kill）
- `Shell` trait + impl（PowerShell / Wsl / GitBash / Bash）
- `SessionHandle`（一个 PTY + 一个 child process）
- `SessionManager`（id → handle 映射，锁粒度 = handle）
- `BufferStore`（M4，scrollback 持久化）

**依赖**：仅 `portable-pty`、`tokio`（reader thread）、`serde`（用于跨边界序列化）。

**依赖等级**：L1（由 L1 调用 L0 的公共 API）。

**被依赖**：L1（命令 handler 直接调用 L0）。

**关键导出（提议，命名遵循 `doc/rules/rust-name-rules.md`）**：

```rust
// core/pty.rs
pub struct Pty {
    pub master: Box<dyn MasterPty + Send>,
    pub child: Box<dyn Child + Send + Sync>,
}
impl Pty { pub fn open(size: PtySize) -> Result<Self>; pub fn resize(&mut self, size: PtySize) -> Result<()>; }
pub trait PtyReader: Send { fn read_chunk(&mut self, buf: &mut [u8]) -> Result<usize>; }

// core/shell.rs
pub trait Shell: Send + Sync {
    fn kind(&self) -> ShellKind;
    fn build_command(&self) -> Command;
    fn default_size(&self) -> PtySize;
    fn env_overrides(&self) -> Vec<(String, String)>; // M5 起应用
}
pub enum ShellKind { PowerShell, Wsl, GitBash, Bash }
pub fn detect_default() -> ShellKind; // Windows → PowerShell; 其他 → Bash

// core/session.rs
pub struct SessionHandle { pty: Pty, shell_kind: ShellKind }
pub struct SessionManager { map: HashMap<SessionId, SessionHandle>, next_id: u64 }
impl SessionManager {
    pub fn spawn(&mut self, shell: ShellKind, size: PtySize) -> Result<SessionId>;
    pub fn write(&mut self, id: SessionId, data: &[u8]) -> Result<()>;
    pub fn resize(&mut self, id: SessionId, size: PtySize) -> Result<()>;
    pub fn close(&mut self, id: SessionId) -> Result<()>;
    pub fn list(&self) -> Vec<SessionInfo>;
    pub fn get(&self, id: SessionId) -> Option<&SessionHandle>;
}
pub type SessionId = u64;  // 简化为进程内序号；uuid 留作 Q3 待定
pub struct SessionInfo { pub id: SessionId, pub shell_kind: ShellKind, pub alive: bool }

// core/buffer.rs  (M4)
pub struct BufferStore { root: PathBuf }
impl BufferStore { pub fn append(&self, id: SessionId, chunk: &[u8]); pub fn load(&self, id: SessionId) -> Vec<u8>; }
```

**反模式**：
- ❌ `use tauri::...`（违反 R4）
- ❌ 在 `core/` 持有 `tauri::State` / `tauri::Window` / `tauri::Emitter`
- ❌ 把 reader thread 的 closure 直接 `app.emit(...)`——reader 只往 channel 写，emit 在 L1
- ❌ 锁整个 `SessionManager` 做 IO——锁粒度应是单个 handle

**关联测试策略**（M1 不做）：
- `Pty::open` 在 CI 上 mock `portable-pty`，验证 harness 通过 fixture
- `SessionManager` 用 `cargo test` 单测，纯内存

---

## L1 — Tauri Glue

**位置**：`src-tauri/src/`

**目的**：把 L0 的 API 包成 `#[tauri::command]`，把 reader thread 的输出 emit 到前端。**唯一**接触 `tauri::AppHandle` 的层。

**拥有**：
- 命令模块（`commands/spawn.rs`、`commands/write.rs`、`commands/resize.rs`、M2 起 `commands/session.rs`、M4 起 `commands/buffer.rs`、M5 起 `commands/store.rs`）
- `events.rs`（事件名常量 + payload 结构）
- `state.rs`（`AppState { manager: Mutex<SessionManager> }`）
- `error.rs`（`AppError → String` 的 IPC 错误转换）
- `lib.rs`（`tauri::Builder` + plugin 注册 + `generate_handler!` + `setup` hook）

**依赖**：L0（`core::`）、`tauri` 2、`tauri-plugin-*`（按需）、`serde`。

**被依赖**：无（前端不直接 import Rust）。

**`lib.rs` 上限**：
- M1：≤ 80 行
- M2：≤ 100 行
- M3+：按需，但 plugin 注册不应让 `lib.rs` 超过 150 行——溢出时挪到 `lib/setup.rs`

**关键约定**：
- 命令 handler 第一行 `let state = app.state::<AppState>();`
- reader thread 产出 → `app.emit("terminal-data", payload)`（**不在** reader 里 emit）
- payload 结构必须 `#[derive(Serialize)]` 且与 L2 的镜像类型字段一致
- 错误返回 `Result<T, AppError>`，由 `serde` 序列化成字符串给前端

**反模式**：
- ❌ 命令 handler 内做 IO 编排——调用 L0 即可
- ❌ 命令 handler 持有 `MutexGuard` 跨 `.await`（reader 同步，无 await，但仍要避免）
- ❌ 直接 `unwrap()`——返回 `AppError::Pty(_)`
- ❌ 用 `panic!` 处理预期错误——返回错误

---

## L2 — Services (TS IPC)

**位置**：`src/services/`

**目的**：把 `invoke()` / `listen()` 集中在一层，提供强类型的 RPC 接口给 L5 / L7。

**拥有**：
- `pty.ts`（M1）—— `spawnTerminal`、`writeTerminal`、`resizeTerminal`、`onTerminalData`
- `session.ts`（M2）—— `closeSession`、`listSessions`、`onSessionExit`
- `clipboard.ts`（M4）—— 包装 `tauri-plugin-clipboard-manager`
- `store.ts`（M5）—— 包装 `tauri-plugin-store`
- `buffer.ts`（M4）—— `loadBuffer`、`onTerminalBuffer`
- `types.ts`——L2 ↔ L1 类型镜像（与 `domain/` 中的纯类型区分：本层是 IPC 序列化形状）

**依赖**：`@tauri-apps/api` 的 `invoke` / `listen`（**仅本层**）；`@tauri-apps/plugin-store`（M5）；L3 类型。

**被依赖**：L5（hooks）。

**关键导出（提议）**：

```typescript
// services/pty.ts
import type { SessionId, ShellKind } from "@/domain/shell";

export interface SpawnOptions { rows: number; cols: number; shell: ShellKind }
export async function spawnTerminal(opts: SpawnOptions): Promise<SessionId>;
export async function writeTerminal(id: SessionId, data: Uint8Array): Promise<void>;
export async function resizeTerminal(id: SessionId, rows: number, cols: number): Promise<void>;
export function onTerminalData(handler: (e: TerminalDataEvent) => void): UnlistenFn;
export interface TerminalDataEvent { id: SessionId; data: number[] } // M2 才用 id；M1 时 payload 退化为 data: number[]
```

**反模式**：
- ❌ L3 / L4 / L5 / L7 直接 `import { invoke } from "@tauri-apps/api"`（违反 R1）
- ❌ L2 写 React hook——L2 是纯函数模块；hook 在 L5
- ❌ L2 持有 xterm / DOM / window 引用——纯逻辑
- ❌ 把 IPC payload 类型放到 L3——L3 是业务领域，IPC 序列化形状是协议层关注点

---

## L3 — Domain Model (Pure TS)

**位置**：`src/domain/`

**目的**：业务领域的纯类型 + 不变量数据结构。**零依赖**：`@tauri-apps/api`、React、xterm、DOM 全部不允许。

**拥有**：
- `shell.ts`（M1）—— `ShellKind` 常量与类型；shell descriptor（name / icon / available 标志；M5 完整化）
- `session.ts`（M1）—— `SessionId` 类型；`SessionInfo`
- `pane.ts`（M2）—— `PaneNode = Leaf | HSplit | VSplit`；`PaneTree`（不可变操作：`split`、`close`、`focus`）
- `buffer.ts`（M4）—— `BufferChunk`、`BufferMetadata`
- `theme.ts`（xterm 端）—— `XtermTheme` 常量；**与 L8 完全独立**

**依赖**：无。

**被依赖**：L2、L4、L5、L7。

**关键导出（提议）**：

```typescript
// domain/shell.ts
export type ShellKind = "powershell" | "wsl" | "git_bash" | "bash";
export const SHELL_KINDS: ReadonlyArray<ShellKind> = ["powershell", "wsl", "git_bash", "bash"];
export const DEFAULT_SHELL: ShellKind = "powershell";

// domain/session.ts
export type SessionId = number; // 与 Rust SessionId = u64 对齐
export interface SessionInfo { id: SessionId; shell: ShellKind; alive: boolean }

// domain/pane.ts  (M2)
export type PaneNode =
  | { kind: "leaf"; sessionId: SessionId }
  | { kind: "hsplit"; left: PaneNode; right: PaneNode; ratio: number }
  | { kind: "vsplit"; top: PaneNode; bottom: PaneNode; ratio: number };
export interface PaneTree { root: PaneNode; focusedPath: number[] }  // path 是 0/1 序列
export function split(tree: PaneTree, leaf: SessionId, axis: "h" | "v"): PaneTree;
export function close(tree: PaneTree, leaf: SessionId): PaneTree;
export function focus(tree: PaneTree, leaf: SessionId): PaneTree;
```

**反模式**：
- ❌ L3 持有 `Uint8Array` 之外的运行时 IO（不允许 `fetch`、不允许 `localStorage`、不允许 `window.*`）
- ❌ L3 引入 React / xterm / Tauri 任何包
- ❌ L3 的类型含业务 ID 之外的可变状态（除非是 `PaneTree` 这种不可变结构）
- ❌ L3 复用 L1 字符串字面量（如 `"terminal-data"`）——L3 不知道 IPC 名字

---

## L4 — xterm Adapter

**位置**：`src/lib/xterm/`

**目的**：xterm.js 的所有可见面向。**唯一** `import { Terminal } from "@xterm/xterm"` 的层。

**拥有**：
- `TerminalView.tsx`（M1）—— 把 xterm `Terminal` 实例挂到 DOM；处理 ref、mount/unmount
- `useFit.ts`（M1）—— `FitAddon` + ResizeObserver hook
- `useXtermTheme.ts`（M1）—— 读 `domain/theme.ts` 的 xterm 主题常量，传给 `theme` prop
- `useSelection.ts`（M4）—— 选区样式、复制粘贴桥接

**依赖**：`@xterm/xterm`、`@xterm/addon-fit`、`@xterm/addon-web-links`（可选）；L3（`theme.ts`）。

**被依赖**：L5（`useTerminalSession`）、L7（间接，通过 L5）。

**关键约定**：
- `TerminalView` 是 React 组件，但**不**接 `onInput` / `onData` prop——这些由 L5 通过 `useTerminalSession` 注入
- xterm 实例用 `useRef` 持有；`useEffect` 内 `new Terminal()` 并 `term.open(ref.current)`，return 里 `term.dispose()`
- theme 对象在 mount 时锁死（xterm 不支持热更新；Q5 待评估）

**反模式**：
- ❌ L7 / L3 / L1 直接 `new Terminal()`（违反 R3）
- ❌ L4 调 `invoke()` / `listen()`——IPC 在 L2
- ❌ L4 写 chrome CSS——chrome 在 L7/L8
- ❌ `term.options.theme = ...` 热切换——`document/design` 强调 chrome ≠ xterm

---

## L5 — Hooks / ViewModel

**位置**：`src/hooks/`

**目的**：把 L2 的服务流对接到 React 生命周期，把 L4 的 xterm 实例状态绑到 L3 的领域模型。

**拥有**：
- `useTerminalSession.ts`（M1）—— 单一会话生命周期：spawn → mount xterm → 订阅 `terminal-data` → 卸载时 close
- `usePaneTree.ts`（M2）—— `PaneTree` 状态 + reducer
- `useSessionList.ts`（M2）—— 拉取 `listSessions`
- `useShellSelector.ts`（M5）—— 读 `store.ts` + `shell_list`
- `useTheme.ts`（M3+）—— 读 chrome theme context；M5 加 xterm theme 切换
- `useFit.ts`（可选；M1 放 L4）—— `FitAddon` 状态

**依赖**：L2、L3、L4、React。

**被依赖**：L7。

**关键导出（提议）**：

```typescript
// hooks/useTerminalSession.ts
export interface UseTerminalSessionOptions {
  sessionId: SessionId;
  onExit?: (code: number) => void;
}
export interface UseTerminalSessionResult {
  containerRef: RefObject<HTMLDivElement>;
  term: Terminal | null;       // 给父组件做选区/搜索用
  isReady: boolean;
  write: (data: string) => void;  // 仅测试用；生产用 onData prop
}
export function useTerminalSession(opts: UseTerminalSessionOptions): UseTerminalSessionResult;
```

**反模式**：
- ❌ L5 持有 `invoke` / `listen` 调用——调 L2 函数
- ❌ L5 直接 `new Terminal()`——通过 `useFit`/`useXtermTheme` 拿到实例
- ❌ L5 写 chrome UI——只返 ref 给 L7

---

## L6 — App Shell + Routing

**位置**：`src/App.tsx`、未来 `src/routes/`

**目的**：应用骨架与导航。M1 期间几乎为空（`App.tsx` 渲染 `<Terminal />` 即可。

**拥有**：
- `App.tsx`（M1 维持现状）—— 顶层布局壳
- 未来 `routes/`（M2 起）—— Tab 切换、split 容器布局

**依赖**：L5、L7。

**被依赖**：无（顶层）。

**当前 M1 计划**：`App.tsx` 不变（已经够简单）；L6 在 M2 实际展开（PaneTree 容器 + tab 头）。

---

## L7 — Chrome UI

**位置**：`src/components/`

**目的**：用户看得到的所有 chrome 部分。

**拥有（M1 现状）**：
- `Terminal.tsx`（M1 缩到 < 40 行，只组合 `useTerminalSession` + `TerminalView`）

**计划新增**：
- `TabBar.tsx`（M2）
- `SplitContainer.tsx`（M2）—— 递归渲染 `PaneNode`
- `StatusBar.tsx`（M3）
- `TitleBar.tsx`（M3）
- `Dialog.tsx`、`Banner.tsx`（M3+）
- `Settings.tsx`（M5）

**依赖**：L3、L5、L8（CSS tokens）；**不**依赖 L2 / L4。

**被依赖**：L6。

**关键约定**：
- 文件名 `PascalCase.tsx`（见 `doc/rules/ts-name-rules.md`）
- props 类型在文件内 `type XxxProps = {...}`，默认 export 组件
- 组件不引入 `useEffect` 做 IO——IO 在 L5
- CSS 只用 `var(--...)`（见 `DESIGN.md` §4）

**反模式**：
- ❌ L7 调 `invoke`（违反 R1）—— 调 L5 hook，hook 调 L2 service
- ❌ L7 直接 `new Terminal()`（违反 R3）
- ❌ L7 写 hex 字面量 / 自定义颜色
- ❌ L7 硬编码 spacing / radius / font——读 L8 tokens

---

## L8 — Design System

**位置**：`src/styles/tokens.css`（M3 创建）、未来 `src/components/ui/`（M3+）

**目的**：chrome 视觉合约。**DESIGN.md 的执行点**。

**拥有**：
- `tokens.css` 的 `:root` 块（DESIGN.md §4 全量）
- 未来通用 chrome 组件：`<Button />`、`<FormField />`、`<Card />`、`<Tabs />` 等（DESIGN.md §8）

**依赖**：无（纯 CSS + 未来纯组件）。

**被依赖**：L7。

**关键约定**：
- `:root` 块是 hex 唯一合法栖息地（见 DESIGN.md §4）
- 切换主题用 `data-theme` attribute + 第二个 `:root[data-theme="..."]` 块
- M1 期间 tokens.css**不创建**——DESIGN.md 已声明；L7 临时 hex 集中在 `Terminal.tsx`（xterm 主题，与 chrome 无关）

**反模式**：
- ❌ L7 chrome 组件硬编码 hex
- ❌ 跨主题变量（如 `--bg-primary`）——使用 DESIGN.md §4 词汇
- ❌ chrome 用 bold（font-weight ≥ 600）——`DESIGN.md` §1 红线
- ❌ 在 chrome 上 `box-shadow`——hairline-only
- ❌ xterm theme 反向依赖本层（违反 R3 / DESIGN.md §3）

---

## 附录 A：依赖矩阵（谁允许依赖谁）

| ↓ 依赖 / 上游 → | L8 | L7 | L6 | L5 | L4 | L3 | L2 | L1 | L0 |
|---|---|---|---|---|---|---|---|---|---|
| **L8** | — |   |   |   |   |   |   |   |   |
| **L7** | ✅ | — |   |   |   |   |   |   |   |
| **L6** | ✅ | ✅ | — |   |   |   |   |   |   |
| **L5** |   |   |   | — | ✅ | ✅ | ✅ |   |   |
| **L4** |   |   |   |   | — | ✅ |   |   |   |
| **L3** |   |   |   |   |   | — |   |   |   |
| **L2** |   |   |   |   |   | ✅ | — |   |   |
| **L1** |   |   |   |   |   |   |   | — | ✅ |
| **L0** |   |   |   |   |   |   |   |   | — |

读法：行依赖列。例如 L7 可依赖 L8（CSS tokens）；L7 **不**可依赖 L2 / L4 / L1。

## 附录 B：每个文件的归属层

最终态参考树：

```
src/
  components/        # L7
  App.tsx            # L6
  hooks/             # L5
  lib/xterm/         # L4
  domain/            # L3
  services/          # L2
  styles/tokens.css  # L8  (M3)
  components/ui/     # L8  (M3+, 通用 chrome 组件)

src-tauri/src/
  lib.rs             # L1 (≤ 80 行 M1)
  state.rs           # L1
  events.rs          # L1
  error.rs           # L1
  commands/          # L1
  core/              # L0
```

---

## 修订记录

| 日期 | 变更 |
|---|---|
| 初版 | 8 层细节落齐；每层含关键导出 / 反模式 / 依赖矩阵 |