# M1 — Refactor (内聚)

> 状态：**规划中**，未开始实施。
>
> 目标读者：实施者 + reviewer。
>
> 父文档：[`ARCHITECTURE.md`](../arch/ARCHITECTURE.md)、[`LAYERS.md`](../arch/LAYERS.md)
>
> 上游约束：`AGENTS.md`（WSL/Windows 工具链 / 命名规范 / 无 lint 脚本）

---

## 1. 目标

**纯重构**。零新功能，零行为变化。把 M0 的"一个文件里塞所有逻辑"切成 ARCHITECTURE.md 定义的 8 层雏形，让 M2 起加 Tab/Split 时不用动 IPC 边界。

## 2. 验收口径（行为不退化）

| #   | 检查      | 通过条件                                                              |
| --- | --------- | --------------------------------------------------------------------- |
| V1  | 启动      | 启动 `npm run tauri dev` 后 5 秒内出现 xterm 容器 + PowerShell 提示符 |
| V2  | 输入回显  | 键入字符，xterm 正确显示；回车后 PowerShell 执行                      |
| V4  | 关闭      | 关窗后 PTY 子进程退出（不留僵尸 powershell.exe）                      |
| V5  | 文件大小  | `src-tauri/src/lib.rs` ≤ 80 行                                        |
| V6  | 文件大小  | `src/components/Terminal.tsx` ≤ 40 行(已迁到 `src/ui/`,历史记录)      |
| V7  | 构建      | `npm run build` 通过                                                  |
| V8  | 构建      | `cargo build --release` 通过                                          |
| V9  | 依赖方向  | ARCHITECTURE 附录 A 矩阵无违规（grep 验证）                           |
| V10 | grep 红线 | `Terminal.tsx` 仍允许内联 xterm theme（这是 L4 的雏形，不算违规）     |

不在 V1–V10 内：多 session、tab、split、设置、buffer、clipboard、store。M2+ 范围。

## 4. 文件级变更

### 4.1 Rust（src-tauri/src/）

**新增**：

```
core/
  mod.rs            # re-exports
  pty.rs            # portable-pty 薄封装
  shell.rs          # Shell trait + PowerShell/Bash impl + detect_default
  session.rs        # SessionHandle, SessionManager, SessionId, SessionInfo

commands/
  mod.rs            # pub use 三个 handler
  spawn.rs          # spawn_terminal({rows, cols, shell}) -> SessionId
  write.rs          # write_terminal({id, data}) -> ()
  resize.rs         # resize_terminal({id, rows, cols}) -> ()

state.rs            # AppState { manager: Mutex<SessionManager>, reader_tx: mpsc::Sender<ReaderMsg> }
events.rs           # const TERMINAL_DATA: &str = "terminal-data"; + payload struct
error.rs            # AppError enum + serde impl
```

**修改**：

- `lib.rs`：从 ~140 行缩到 ≤ 80 行。只剩 `tauri::Builder::new().plugin(...).manage(AppState::default()).invoke_handler(generate_handler![...]).setup(setup).run(tauri::generate_context!())` + `setup` 函数挂 reader dispatch thread。
- `main.rs`：不变（Windows 上必须保留的 bin 入口）。

**删除**：无（既有 `Mutex<PtyState>` 的逻辑被吸收到 `core/session.rs` + `commands/*`）。

### 4.2 TS（src/）

**新增**：

```
domain/
  shell.ts          # ShellKind type + 常量 + DEFAULT_SHELL
  session.ts        # SessionId type + SessionInfo

services/
  pty.ts            # spawnTerminal / resizeTerminal / writeTerminal / onTerminalData + types
  types.ts          # IPC 序列化形状（与 domain/ 区分：IPC 是协议层）

hooks/
  useTerminalSession.ts  # 单一会话生命周期；返 containerRef + term

lib/xterm/
  TerminalView.tsx  # <TerminalView onInput={...} onResize={...} ref={...} />
  useFit.ts         # ResizeObserver + FitAddon.fit() 触发
  useXtermTheme.ts  # 读 domain/theme.ts 常量，传 theme prop（M1 theme 直接 inline，无 styles/）
  theme.ts          # xterm 主题对象（独立 hex，与 chrome tokens 无关）
```

**修改**：

- `src/components/Terminal.tsx`(已迁到 `src/ui/Terminal.tsx` → M2 重构为 `PaneChrome.tsx`):从 ~65 行缩到 ≤ 40 行。只组合 `useTerminalSession` + 渲染 `<TerminalView />`。
- `src/App.tsx`：不变。
- `src/App.css`：不变。
- `src/main.tsx`：不变。

**删除**：无。

### 4.3 文件树（M1 末态）

```
xsterm/
├── src/
│   ├── App.tsx                              # L6, ~unchanged
│   ├── App.css                              # global reset
│   ├── main.tsx                             # entry, ~unchanged
│   ├── components/
│   │   └── Terminal.tsx                     # L7, ≤ 40 行
│   ├── hooks/
│   │   └── useTerminalSession.ts            # L5
│   ├── lib/
│   │   └── xterm/
│   │       ├── TerminalView.tsx             # L4
│   │       ├── useFit.ts                    # L4
│   │       ├── useXtermTheme.ts             # L4
│   │       └── theme.ts                     # L4
│   ├── domain/
│   │   ├── shell.ts                         # L3
│   │   └── session.ts                       # L3
│   └── services/
│       ├── pty.ts                           # L2
│       └── types.ts                         # L2
└── src-tauri/src/
    ├── main.rs                              # bin entry
    ├── lib.rs                               # L1, ≤ 80 行
    ├── state.rs                             # L1
    ├── events.rs                            # L1
    ├── error.rs                             # L1
    ├── core/
    │   ├── mod.rs                           # L0
    │   ├── pty.rs                           # L0
    │   ├── shell.rs                         # L0
    │   └── session.rs                       # L0
    └── commands/
        ├── mod.rs                           # L1
        ├── spawn.rs                         # L1
        ├── write.rs                         # L1
        └── resize.rs                        # L1
```

## 5. 关键接口草稿

### 5.1 IPC（M1 实际落地的）

```rust
// commands/spawn.rs
#[derive(Deserialize)]
pub struct SpawnArgs { rows: u16, cols: u16, shell: ShellKind }
#[tauri::command]
pub async fn spawn_terminal(app: AppHandle, state: tauri::State<'_, AppState>, args: SpawnArgs) -> Result<SessionId, AppError>;

// commands/write.rs
#[derive(Deserialize)]
pub struct WriteArgs { id: SessionId, data: Vec<u8> }
#[tauri::command]
pub async fn write_terminal(state: tauri::State<'_, AppState>, args: WriteArgs) -> Result<(), AppError>;

// commands/resize.rs
#[derive(Deserialize)]
pub struct ResizeArgs { id: SessionId, rows: u16, cols: u16 }
#[tauri::command]
pub async fn resize_terminal(state: tauri::State<'_, AppState>, args: ResizeArgs) -> Result<(), AppError>;

// events.rs
pub const TERMINAL_DATA: &str = "terminal-data";
#[derive(Serialize, Clone)]
pub struct TerminalDataPayload { pub data: Vec<u8> }  // M1 不含 id（M2 加）
```

> **M1 事件 payload 仍是 `{ data: number[] }`**——ARCHITECTURE §5.2 标注 M2 加 `id`。本里程碑保持现状避免破坏现有 wire format。

### 5.2 TS 服务

```typescript
// services/pty.ts
export interface SpawnOptions {
  rows: number;
  cols: number;
  shell: ShellKind;
}
export async function spawnTerminal(opts: SpawnOptions): Promise<SessionId>;
export async function writeTerminal(id: SessionId, data: Uint8Array): Promise<void>;
export async function resizeTerminal(id: SessionId, rows: number, cols: number): Promise<void>;
export function onTerminalData(handler: (data: number[]) => void): UnlistenFn;
```

### 5.3 Hook

```typescript
// hooks/useTerminalSession.ts
export interface UseTerminalSessionOpts {
  rows: number;
  cols: number;
}
export function useTerminalSession(opts: UseTerminalSessionOpts): {
  containerRef: RefObject<HTMLDivElement>;
  isReady: boolean;
};
```

## 6. 风险与对策

| 风险                                                         | 影响                    | 对策                                                                                               |
| ------------------------------------------------------------ | ----------------------- | -------------------------------------------------------------------------------------------------- |
| Reader thread 与 Tauri `Emitter` 生命周期耦合出错            | 关闭时 panic / 数据丢失 | reader 写 mpsc channel；L1 `setup` 起 dispatch 线程从 channel 读 + `app.emit`。emit 不在 reader 里 |
| `Mutex<SessionManager>` 粒度太粗，所有命令排队               | resize 体感卡顿         | M1 可接受；M2 起按 `SessionId` 分锁（`DashMap<SessionId, Mutex<Handle>>`）                         |
| `SessionId` 用 `u64` 进程内序号 vs uuid                      | 多窗口/RPC 扩展性       | M1 用 u64；M2 评估 uuid。ARCHITECTURE §L0 已标记 Q3                                                |
| `Vec<u8>` payload 在多 session 时无法路由                    | M2 起致命               | M1 不动；M2 在 reader dispatch 加 `id`，payload 升级——已在 ARCHITECTURE §5.2 标注                  |
| WSL 命令行 `AppData` 路径解析在 Linux 跑 cargo test 时 panic | Linux CI 跑不通         | M1 不做 Linux 测试；只在 Windows 验证                                                              |
| 事件名 / 命令名拼写错位（TS ↔ Rust）                         | 静默失败                | 把名称抽到 `events.rs` / `services/types.ts` 常量；两端 `grep` 一致性检查（自验）                  |
| 重构过程中 xterm 主题被 chrome 变量污染                      | DESIGN.md §3 红线       | xterm theme 在 `lib/xterm/theme.ts` 独立；reviewer grep `var(--` 应在 `lib/xterm/` 找不到          |

## 7. 实施顺序（建议）

1. **Rust 先行
   **。先写 `core/`（不依赖 Tauri，可在 WSL `cargo check` 跑通），再写 `commands/`，最后改 `lib.rs` 接入。
2. **TS 后行
   **。先写 `domain/`，再写 `services/`，再写 `lib/xterm/`，再写 `hooks/`，最后改 `Terminal.tsx`。
3. **验证
   **。每步后 `npm run build` + `cargo build --release`（V7/V8）。最后 `npm run tauri dev` 跑 V1/V2/V3/V4。

## 8. 不在 M1 范围（Out of Scope）

- 多 session / tab / split —— M2
- 持久化 / buffer —— M4
- 设置 / store / shell 选择 UI —— M5
- 主题切换 —— 独立里程碑
- 测试 —— M2 起补（per ARCHITECTURE §8 D5）

## 9. Definition of Done

- V1–V10 全过
- reviewer 用 ARCHITECTURE §6 + LAYERS §附录 A 跑一次 grep 验证依赖方向无违规
- reviewer grep 红线：xterm theme 不在 chrome CSS；chrome CSS 不写 hex（M1 tokens.css 不存在，所以 Terminal.tsx 外的任何 hex 都应 review；目前预期 0 个）
- commit message 遵循 `AGENTS.md`（无 lint 脚本，所以 prettier 自己跑一遍）

---

## 附录：M1 不动但需验证的现状

为减少 review 噪音，以下文件 M1 **不**碰，但要在最后一步验证仍正确：

- `src/App.tsx` — `import Terminal from "./components/Terminal"` 签名不变
- `src/App.css` — 全局 reset 不动
- `src/main.tsx` — entry 不动
- `src-tauri/src/main.rs` — Windows bin 入口不动
- `src-tauri/Cargo.toml` — 不加新依赖（portable-pty 已存在；如需 `tokio` 已存在）
- `src-tauri/tauri.conf.json` — 不动
- `package.json` — 不动（无新 npm 依赖）
- `vite.config.ts` — 不动
- `index.html` — 不动

---

## 修订记录

| 日期 | 变更          |
| ---- | ------------- |
| 初版 | M1 文件级蓝图 |
