# 03 开发视图 (Development View)

> **关心什么**：源码怎么组织、模块怎么依赖、怎么构建、构建时有什么约束。
> 不关心：运行时 task 怎么跑、Tauri capability 配置、UI 树。

## 1. 分层与依赖方向

```
┌─────────────────────────────────────────┐
│  Tauri commands (薄层)                  │  ← src-tauri/src/commands/
└──────────────┬──────────────────────────┘
               │ 调用
               ▼
┌─────────────────────────────────────────┐
│  services (业务逻辑)                    │  ← src-tauri/src/services/
│  - session_manager.rs                   │
│  - local_session/  ssh_session/         │
│  - tmux/  session_log.rs                │
└──────────────┬──────────────────────────┘
               │ 调用
               ▼
┌─────────────────────────────────────────┐
│  infrastructure (外部资源 trait)        │  ← src-tauri/src/infrastructure/
│  - pty.rs  ssh.rs  tmux/backend.rs      │
└──────────────┬──────────────────────────┘
               │ 调用
               ▼
┌─────────────────────────────────────────┐
│  models (纯数据)                        │  ← src-tauri/src/models/
└─────────────────────────────────────────┘
```

**约束**：依赖**只能向下**。`models` 不依赖任何人；`infrastructure` 不引用 `services`；`services` 不引用 `commands`；`commands` 是入口，不被任何内部模块引用。

## 2. 前端依赖方向

```
┌─────────────────────────────────────────┐
│  components/                            │  ← 只 import contexts + services + types
└──────────────┬──────────────────────────┘
               │
               ▼
┌─────────────────────────────────────────┐
│  contexts/ + hooks/                     │  ← import services + types
└──────────────┬──────────────────────────┘
               │
               ▼
┌─────────────────────────────────────────┐
│  services/ + utils/                     │  ← 只 import types
└──────────────┬──────────────────────────┘
               │
               ▼
┌─────────────────────────────────────────┐
│  types/                                 │  ← 无依赖（pure）
└─────────────────────────────────────────┘
```

**约束**：组件**不直接** import `@tauri-apps/api`；所有 Tauri IPC 走 `src/services/sessionService.ts`（invoke）和 `src/contexts/session/useTauriListeners.ts`（listen）。

## 3. tmux 子系统模块树（重构后）

> P1-P5 把 `tmux/controller.rs`（3622 行 monolith）拆成 `controller/` 子模块，新增 `protocol/` 子模块。
> PR 切片见 `dev/roadmap/migration-prs.md`，设计意图见 `dev/adr/0005-tmux-redesign-v0.md`。

```
src-tauri/src/services/tmux/
├── mod.rs                    模块入口；re-export TmuxController + From<TmuxError> for String
├── commands.rs               老 shim，re-export protocol::wire（**保留供旧调用方**）
├── events.rs                 老 shim，ProtocolEvent 别名 ControlEvent（已 deprecated）
├── parser.rs                 老 shim，re-export protocol::parser
├── escape.rs                 老 shim，re-export protocol::codec
├── errors.rs                 thiserror 派生的 TmuxError 枚举
├── dispatch.rs               spawn_dispatch_task + dispatch_event
├── bridge/
│   └── mod.rs                TmuxBridge — 把 ProtocolEvent 翻译成 Tauri 事件 + JSON
├── protocol/                 纯协议层，无 I/O 无 runtime state
│   ├── mod.rs
│   ├── codec.rs              octal \nnn 编解码
│   ├── command.rs            CommandId / CommandKind / ResponseWaiter / TaggedCommand
│   ├── events.rs             ProtocolEvent 枚举（30+ 变体）
│   ├── parser.rs             line → Option<ProtocolEvent> 状态机
│   ├── version.rs            CapabilityMatrix + parse_version + infer_capabilities
│   └── wire.rs               高层 "send-keys" / "split-window" / ... 文本构造器
└── controller/               状态机 + task 管理
    ├── mod.rs                TmuxController 主类 + reader/writer/monitor 任务
    ├── id_map.rs             CommandRegistry — id → waiter + event_waiters FIFO
    ├── handshake.rs          PR-T4 v2 handshake 计划 (version + capability → 步骤序列)
    └── subscriber.rs         RouterState — 在 %begin..%end 之间累积 body line
```

```
src-tauri/src/infrastructure/tmux/
├── mod.rs
└── backend.rs                TmuxBackend trait + LocalTmuxBackend + SshTmuxBackend
```

### 3.1 协议层内部模块依赖

```
codec.rs       (无依赖，纯函数)
    ↑
command.rs     (无依赖，定义 ID/waiter 结构)
    ↑
events.rs      (无依赖，纯枚举)
    ↑
version.rs     (无依赖，纯函数)
    ↑
parser.rs      (依赖 events + command)
    ↑
wire.rs        (无依赖，构造字符串)
```

**关键原则**：`protocol/` 子模块**完全无 I/O、无 runtime state**，可独立单元测试。重构后这部分是测试最密集的区域。

### 3.2 controller 子模块依赖

```
controller/
├── id_map.rs        CommandRegistry — 单一等待队列
├── handshake.rs     handshake 步骤计划（纯函数）
├── subscriber.rs    RouterState — body 累积（持有 Mutex）
└── mod.rs           TmuxController 主类（用上面三个）
```

`mod.rs` 是唯一与 IO / tokio runtime 交互的文件；其他三个可独立单测。

### 3.3 前端对应物

```
src/
├── services/sessionService.ts              invoke 包装层
│   ├── createTmux / attachTmux
│   ├── splitTmuxPane / killTmuxPane
│   ├── createTmuxWindow / killTmuxWindow
│   ├── captureTmuxPane / detachTmux
│   └── probeTmuxSessionExists / autoAttachTmuxServers
│
├── contexts/session/useTauriListeners.ts   listen 包装层
│   ├── tmux-pane-added / tmux-window-added
│   ├── tmux-window-list / tmux-pane-list
│   ├── tmux-window-closed / tmux-pane-removed
│   ├── tmux-paused / tmux-continued
│   └── tmux-controller-exit
│
├── hooks/
│   ├── useTauriTerminalOutput.ts           listen("session-output")
│   ├── sessionOutputChannel.ts             共享 binary Channel<Uint8Array>
│   └── useTmuxAutoAttach.ts                启动时重连 attached_tmux.json
```

## 4. TmuxBridge：事件 → Tauri 事件翻译表

> `src-tauri/src/services/tmux/bridge/mod.rs`

| Bridge 方法 | Tauri 事件名 | Payload shape | 触发源 |
|---|---|---|---|
| `emit_session_output` | `session-output` | `[xsterm_session_id, data[]]` (binary) | `%output` |
| `emit_tmux_pane_added` | `tmux-pane-added` | `{xsterm_session_id, tmux_pane_id, tmux_controller_id, tmux_window_id, session_type}` | split-result path 的 `%window-pane-changed` |
| `emit_tmux_pane_added_with_window` | `tmux-pane-added` | `{controllerId, tmuxPaneId, xstermSessionId, parentTmuxWindowId}` | bootstrap path `emit_pane_list`（**字段复用**，前端两个都吃） |
| `emit_tmux_window_added` | `tmux-window-added` | `{xsterm_window_id, tmux_window_id, tmux_controller_id, session_name, xsterm_session_id?, xsterm_pane_id?}` | new-window 完成 |
| `emit_tmux_window_added_for_list` | `tmux-window-list` | `{controller_id, windows: [...]}` | `list-windows` 响应 |
| `emit_tmux_pane_added_for_list` | `tmux-pane-list` | `{controller_id, panes: [...]}` | `list-panes` 响应 |
| `emit_tmux_window_closed` | `tmux-window-closed` | `{controller_id, tmux_window_id, xsterm_window_id}` | `%window-close` |
| `emit_tmux_window_renamed` | `tmux-window-renamed` | `{controller_id, tmux_window_id, xsterm_window_id, name}` | `%window-renamed` |
| `emit_tmux_pane_removed` | `tmux-pane-removed` | `{controller_id, tmux_pane_id, xsterm_session_id}` | `%pane-exited` |
| `emit_tmux_paused` / `emit_tmux_continued` | `tmux-paused` / `tmux-continued` | `{tmux_pane_id}` | `%pause` / `%continue` |
| `emit_tmux_controller_exit` | `tmux-controller-exit` | `{controller_id, reason}` | monitor 任务 Exit |

### 4.1 两个 `tmux-pane-added` payload —— 已知 schema 真相

> ⚠️ **重要**：bridge 在两个路径下 emit 同一个事件名 `tmux-pane-added`，但**字段名不同**：
>
> | 字段 | split-result path | bootstrap path |
> |---|---|---|
> | xsterm pane id | `xsterm_session_id` | `xstermSessionId` |
> | tmux pane id | `tmux_pane_id` | `tmuxPaneId` |
> | controller id | `tmux_controller_id` | `controllerId` |
> | tmux window id | `tmux_window_id` | `parentTmuxWindowId` |
>
> **前端 handler 两个都吃**（`useTauriListeners.ts:278-307`）。这是历史包袱，**不是统一设计**。
> 修这个会涉及前端 deserialize 改造；当前任务（按规格实现）**不动**。

`try_emit` (`bridge/mod.rs:392-405`) 是统一包装：emit 失败只 `warn!` 不 panic（前端可以从下一个 list 事件恢复）。

## 5. Tauri command 层

> 注册在 `src-tauri/src/commands/mod.rs::all_handlers()`。

| Tauri 命令 | 前端 wrapper | 说明 |
|---|---|---|
| `create_tmux_session` | `createTmux` | 走 `SessionManager::create_tmux` |
| `attach_tmux_session` | `attachTmux` | 走 `SessionManager::attach_tmux`，spawn 路径走 `SpawnMode::Attach` |
| `probe_tmux_session_exists` | `probeTmuxSessionExists` | 让前端决定走 create 还是 attach |
| `create_tmux_pane` | `createTmuxPane` | 内部 `TmuxController::split_pane`，等 `%window-pane-changed` |
| `kill_tmux_pane` | `killTmuxPane` | 内部发 `kill-pane` |
| `create_tmux_window` | `createTmuxWindow` | 内部发 `new-window`，等 `%window-pane-changed` |
| `kill_tmux_window` | `killTmuxWindow` | 内部发 `kill-window` |
| `rename_tmux_window` | (内部) | 内部发 `rename-window` |
| `capture_tmux_pane` | `captureTmuxPane` | 走 `Controller::capture_pane` 走 `%begin..%end` |
| `detach_tmux_controller` | `detachTmux` | 内部发 `detach-client -s <session>` |
| `kill_server` | (内部) | 内部发 `kill-server` |
| `auto_attach_tmux_servers` | `autoAttachTmuxServers` | 重连 attached_tmux.json 持久列表 |
| `get_attached_tmux_servers` | `getAttachedTmuxServers` | 列已 attach |
| `write_session` / `resize_session` / `close_session` | `writeSession`/... | 通用 |
| `get_session_output_channel` | (启动一次) | 返回共享 binary Channel<Uint8Array>（Perf 001） |

**注意**：
- `invoke()` **不是类型安全的**（无 tauri-specta / 无生成 binding）。命令名拼错 / 参数 shape 不匹配只在 runtime 暴露。
- `list_sessions` 已注册但**前端 wrapper 未暴露**（AGENTS.md gotcha）。需要用时先加前端 wrapper。
- 新增 Tauri command **必须**同步更新 `src-tauri/capabilities/default.json`（详见 `04-physical-view.md`）。

## 6. wire 层（高层文本构造器）

> `src-tauri/src/services/tmux/protocol/wire.rs`。每个返回 `'\n'`-terminated 字符串直接喂 stdin。

| 函数 | 生成的命令 | 用途 |
|---|---|---|
| `send_keys(pane_id, bytes)` | `send-keys -l -t <pane> "<escaped>"` | 写数据到 pane |
| `split_window(pane, horiz)` | `split-window [-h\|-v] -t <pane>` | 拆 pane |
| `kill_pane(pane)` | `kill-pane -t <pane>` | 销毁 pane |
| `new_window_in_current(name)` | `new-window [-n "<name>"]` | 创建 window |
| `kill_window(win)` | `kill-window -t <win>` | 销毁 window |
| `rename_window(win, name)` | `rename-window -t <win> <name>` | 改名 window |
| `resize_pane(pane, x, y)` | `resize-pane -t <pane> -x <x> -y <y>` | 调 pane 尺寸 |
| `capture_pane(pane, lines)` | `capture-pane -p -e -J -S -<lines> -t <pane>` | 拉 scrollback |
| `attach_session_create()` | `attach-session -c ""` | bootstrap（>=2.6） |
| `refresh_client_control()` | `refresh-client -C` | **第一个**命令（>=2.2） |
| `list_windows(_s)` | `list-windows -a -F '<fmt>'` | bootstrap 拉窗口 |
| `list_panes_with_format(win, fmt)` | `list-panes -a [-t <win>] -F '<fmt>'` | bootstrap 拉 pane |
| `detach_client(session)` | `detach-client -s <session>` | 优雅断开 |
| `kill_server()` | `kill-server` | 关掉整个 tmux server |

### 6.1 `send_keys` 的精妙处（Bug 024 的修复）

`wire.rs:78-87`：
1. `escape_output(keys)` 把所有控制字节 / `\` / 高位字节变 `\nnn`。
2. 外面再套 `"..."`，并替换嵌入的 `"` 为 `\"`。
3. 用 `-l` 让 tmux 把整个参数当字面量（不然 `hello` 不是 key name，会被静默丢弃）。

## 7. 构建与工具链

> 详细命令见 AGENTS.md §"Build Toolchain"。WSL 环境必须用 **Windows 工具链**（cargo.exe / npm via powershell.exe）。

### 7.1 关键脚本（package.json）

| 命令 | 作用 |
|---|---|
| `npm run dev` | 起 Vite dev server（端口 1420，**strictPort**） |
| `npm run tauri dev` | 起 Vite + 编译 + 启动 Rust 桌面 app |
| `npm run build` | `tsc`（类型检查）+ `vite build` → `dist/` |
| `npm run tauri build` | `npm run build` + `cargo build --release` + 打包 MSI/NSIS |
| `npm run preview` | 静态预览 `dist/` |
| `npm run tauri` | pass-through 给 tauri CLI |

### 7.2 关键 Rust 命令

```bash
cargo.exe check  --manifest-path src-tauri/Cargo.toml   # 快速类型检查
cargo.exe test   --manifest-path src-tauri/Cargo.toml   # 单元测试（**仅 src-tauri 自测**）
cargo.exe clippy --manifest-path src-tauri/Cargo.toml   # lint（不强制 CI）
```

### 7.3 版本同步约束

**三个文件必须同步**（AGENTS.md gotcha）：
- `package.json` → npm scripts 用
- `src-tauri/Cargo.toml` → MSI/NSIS bundle version
- `src-tauri/tauri.conf.json` → MSI/NSIS bundle version

## 8. 测试约束

| 层级 | 测试类型 | 工具 |
|---|---|---|
| Rust 后端 | 单元测试（`#[cfg(test)]` inline in session_manager.rs）+ `mockall` mock `PtySystem` / `PtyPair` / `Child` / `SshBackend` | cargo test |
| tmux 协议层 | 纯函数单测（codec / parser / wire） | cargo test |
| tmux controller | Mock TmuxBackend 跑完整生命周期 | cargo test |
| 前端 | Vitest（如 `paneUtils.test.ts`） | npm run test（**当前无 script**，需手动跑） |

**没有**：ESLint、Prettier、Vitest config、Playwright、CI 流水线。
**当前验证脚本**（AGENTS.md）：
- 前端类型检查：`powershell.exe -NoProfile -Command "Set-Location 'C:/path'; npx tsc --noEmit"`
- 后端：`cargo.exe check / test --manifest-path src-tauri/Cargo.toml`

## 9. 自动生成文件（不要手改）

- `src/vite-env.d.ts` — Vite 生成
- `src-tauri/gen/schemas/` — Tauri 在 `tauri dev` / `tauri build` 时生成

## 10. 跨视图引用

- 想看 task 怎么**跑**起来 → `02-process-view.md`
- 想看源码**组织** → §3 本视图
- 想看代码**怎么调用 IPC** → §5 本视图 + `01-logical-view.md` §6 前端模块职责
- 想看代码**怎么部署** → `04-physical-view.md`
