# tmux -CC 当前实现状态报告（debug 交接）

> 2026-09-14。用户决定自己 debug，本文档是当前所有改动、bug、关键文件位置的清单。

## 1. 总体进度

| 任务 | 状态 |
|---|---|
| Bug 0009 root cause（control-window 不出现）| **已修**，需验证重启后 4 个 tab 出现 |
| Bug 0009b（每次 Create 多开1 个 window）| **已修**，删 Create 模式 unconditional `new-window` |
| Bug 0009c（attach 路径本地 < server windows）| **修复不完整**，仍有问题见 §3 |
| HMR hook state 不刷新 | 已知 dev 体验问题，不影响功能 |
| Rust 测试覆盖 | 321 passed, 0 failed |
| TypeScript 类型 | tsc 0 errors |
| Vitest | 205 passed |

工作树状态：未 commit。所有修改都在工作区。

## 2. 文件改动清单

### 后端（Rust）

| 文件 | 关键改动 |
|---|---|
| `src-tauri/src/services/tmux/controller/mod.rs` | • `record_pane_window` 加 `xsterm_window_id: u32` 第3 参数<br>• Create模式移除 `send new-window_in_current`（Bug0009b 修复）<br>• Attach模式发 `list-windows` + `list-panes` 两命令<br>• `spawn_with_backend` 末尾加7 个 `[DEBUG-0009-RUST]` log |
| `src-tauri/src/services/tmux/dispatch.rs` | • `emit_window_list` 同步写 `controller.window_bindings`<br>• 4 处 `record_pane_window` 调用点（行 113/135/199/629）签名更新<br>• 行 582 加 `emit_window_list` 调试 log |
| `src-tauri/src/services/session_manager.rs` | • `create_tmux` 加7 个 `[DEBUG-0009-RUST]` log<br>• `xsterm_window_id_for` helper 查 `window_bindings`（这是关键查找点）<br>• `attach_tmux` 同样加 log |
| `src-tauri/src/commands/session.rs` | • `create_tmux_session` command 加 log<br>• `create_session`（unified）加 log |
| `src-tauri/src/models/session.rs` | • `SessionInfo` 加 `tmux_window_id` / `xsterm_window_id` 字段 |

### 前端（TypeScript）

| 文件 | 关键改动 |
|---|---|
| `src/types/session.ts` | `Window.windowType: "tmux-control"`, `tmuxControlWindowId`, `tmuxControlName` 字段 |
| `src/services/sessionService.ts` | `detachTmux` / `killServerViaController` / `unmarkAttachedTmux`；`SessionInfo` interface 增字段；`createTmuxWindow` 加可选 name |
| `src/contexts/session/useSessionLifecycle.ts` | tmux-cc 路径调 `insertTmuxControlAndBootstrapWindow` sync insert；导出该函数 |
| `src/contexts/session/useSessionActions.ts` | `openFromConfigInternal` tmux-cc 路径调 sync insert；hoist `workspaceActions` |
| `src/contexts/session/useTauriListeners.ts` | `tmux-window-list` listener **同步 insert 每个 row 为 xsterm Window**（Bug0009c 关键修复）；`tmux-window-added` dedupe by xstermWindowId；保留 control-window lazy insert |
| `src/contexts/session/useWindowActions.ts` | `closeWindow` / `renameWindow` / `createWindow` 三分支（tmux-control / 普通 tmux / 其他） |
| `src/contexts/session/useSessionState.ts` + `SessionContext.tsx` + `types.ts` | `tmuxWindowListsRef` |
| `src/components/TmuxControlWindowView.tsx` + `TmuxSessionControl.tsx` + `TmuxWindowsControl.tsx` + `.css` | 新组件；session-control / windows-control 两区 |
| `src/components/TmuxControllerErrorBanner.tsx` | Retry 改用 `createTmuxSession` hook |
| `src/components/WindowTabBar.tsx` | tmux-control 加 `▶` 前缀；close confirm |
| `src/components/Pane.tsx` + `paneContextMenu.ts` | "Close Tmux Window" → "Delete from tmux server" |

### 新文件
- `src-tauri/src/services/tmux/protocol/wire.rs`：新增 `detach_client` / `kill_server`
- `src-tauri/src/services/tmux/controller/mod.rs`：`detach_client()` / `kill_server()` 方法

### 调试日志（[DEBUG-0009-RUST]）
后端共 **12 个** 调试 log，分布在：
- `commands/session.rs:156-159, 168-171`：command 入口/出口
- `services/session_manager.rs:316-319, 322-325, 332-334, 342-344, 348-350, 371-378`：create_tmux 全链路
- `services/tmux/controller/mod.rs:1370-1374`：record_pane_window 写入 window_bindings
- `services/tmux/controller/mod.rs:497-499` (新)：Create 模式决定不 enqueue new-window
- `services/tmux/dispatch.rs:556-560`：emit_window_list 写入 window_bindings
- `services/tmux/dispatch.rs:582-588`：emit_window_list 总条数

## 3. 待解决的 Bug（你来 debug）

### 3.1 `record_pane_window` 第3 参数语义混淆 + 3 处调用错误

**位置**：`src-tauri/src/services/tmux/dispatch.rs:113, 135, 199`

`record_pane_window` 签名（controller/mod.rs:1360）：
```rust
pub(crate) fn record_pane_window(
    &self,
    pane_id: String,
    tmux_window_id: String,
    xsterm_window_id: u32,  // <-- 参数语义
)
```

**问题**：3 处调用都传 `xsterm_id`（pane id）当作 `xsterm_window_id`（window id）：
- 行 113（split-result 路径）：`xsterm_id` 是新分配的 pane xsterm id
- 行 135（new-window / bootstrap 路径）：`xsterm_id` 同上
- 行 199（first-pane 路径）：`xsterm_id` 同上

只有行 629（emit_pane_list 路径）传的是真正的 `xsterm_window_id`（从 `window_to_xsterm` 映射）。

**后果**：
- `controller.window_bindings` 写入的 "tmux_window_id -> xsterm_window_id" 实际是 "tmux_window_id -> pane_xsterm_id"
- `xsterm_window_id_for(&controller, tmux_window_id)` 在 create_tmux 时返回 `Some(pane_xsterm_id)` —— 不是真正 window id
- 前端 `SessionInfo.xstermWindowId` 是 pane id（不是 window id）→ sync insert 的 bootstrap window 与其他 window 用同一个 pane id → dedupe 把其他 window 跳过 → 本地 windows 仍然 < server

**修法建议**（3 处都需要修复）：
- 行 113：split-result 路径之前在 NewWindowResult 的 waiter 里已有 `pending.xsterm_window_id`，需通过其他机制拿。新 split 路径的 window id 应从 `window_bindings` 查（split 之前先创建了 window）或者从 `pending` 拿
- 行 135：直接用 `pending.xsterm_window_id.unwrap()`（已经在 case 3 第 139 行用它做 window_bindings insert）
- 行 199：bootstrap first-pane 路径，window 已在 `is_first_window` 分支（dispatch.rs:268-282）通过 `allocate_xsterm_window_id` 分配并 stash 到 EventWaiter。需要从 registry 查或额外保存

`emit_window_list`（已修，row 555）的修复**只能解决**从 list-windows 响应触发的路径。**`%window-pane-changed` 路径 3 处仍然有 bug**。

### 3.2 `xsterm_window_id` 在 frontend dedupe 仍被跳过

**位置**：`src/contexts/session/useTauriListeners.ts` 的 `tmux-window-list` listener 内同步 insert 逻辑第 727 行
```ts
if (xid === undefined || xid === 0) continue;
```

`xsterm_window_id = 0` 在 Rust `unwrap_or(0)` 兜底时写入 payload。即使后端修复了 §3.1，list-panes 响应里的 `xsterm_window_id` 仍可能是 0（如果某个 window 没在 list-windows 中）—— 前端应该改用 `null` 而非 0 表示"未分配"。

### 3.3 list-windows vs list-panes 顺序竞态

`emit_window_list` 之后调 `trigger_followup_list_panes`（dispatch.rs:700）发送第二个命令。tmux 服务器**可能**先返回 list-panes 响应——但响应按 cmd_id 单调处理，dispatch task 单线程处理，所以**应该** list-windows 的 %begin..%end 先完整处理（emit_window_list），再处理 list-panes 的响应（emit_pane_list）。Rust 这里**应该**是顺序的。但 tmux 端能不能保证 cmd_id 单调递增？这点没验证。

## 4. 复现路径

### 4.1 当前状态
- dev binary: `src-tauri/target/debug/xsterm.exe`
- 启动命令: `powershell.exe -NoProfile -Command "Set-Location 'C:/Users/LONER/1111/prj/xsterm'; npm run tauri dev"`
- 服务端 tmux session "test" 在 10.0.100.158（shanclaw）通过 SSH

### 4.2 已知场景
| 场景 | 现象 | 关联代码 |
|---|---|---|
| Create + 1 个 window | 应该 OK（控制台显示 1 control + 1 普通 tab） | — |
| Create 后再 Create | server 上 `tmux list-windows` 显示 2 个（修后）| dispatch.rs:497 |
| Attach 到有 4 个 windows 的 session | 本地只显示 1 control + 1 普通（应该 1+4）| useTauriListeners.ts:725, dispatch.rs:113/135/199 |

### 4.3 验证步骤
1. 重启 dev
2. 创建新 tmux session "test1"
4. attach 到 server 上 `tmux new-session -s multi ; for i in 1 2 3; do tmux new-window; done` 创建的 "multi"
5. 期望：本地的 WorkspaceContainer 渲染时 `windows` 数组 length = 1 (control) + N (普通)
6. 实际：本地 windows 数组 length = 1 (control) + 1 (普通 bootstrap)，缺 N-1 个

## 5. 关键代码路径（建议优先看这些）

### 5.1 Bug0009c 真正根因 —— `record_pane_window` 在 3 处被误用

**最优先修复**。即使你修了 frontend sync insert，**%window-pane-changed** 路径仍然把 pane id 当 window id 写到 `window_bindings`。

```
src-tauri/src/services/tmux/dispatch.rs:113  ← 错
src-tauri/src/services/tmux/dispatch.rs:135  ← 错
src-tauri/src/services/tmux/dispatch.rs:199  ← 错
src-tauri/src/services/tmux/dispatch.rs:629  ← 对（list-panes 路径）
src-tauri/src/services/tmux/controller/mod.rs:1360  ← 定义（语义不歧义，参数名 xsterm_window_id）
```

### 5.2 后端所有调试 log 入口

后端启动后，按时间序会输出这些 `[DEBUG-0009-RUST]`：

```
[DEBUG-0009-RUST] create_tmux_session command ENTRY config=...
[DEBUG-0009-RUST] create_session routing to create_tmux config=...
[DEBUG-0009-RUST] SessionManager::create_tmux ENTRY controller_id=pending config=...
[DEBUG-0009-RUST] await_first_pane returned xsterm_id=... tmux_pane_id=...
[DEBUG-0009-RUST] tmux_window_id_for_pane returned ... for pane ...
[DEBUG-0009-RUST] xsterm_window_id resolved = ... (raw tmux_window_id=...)
[DEBUG-0009-RUST] tmux_pane_info returned SessionInfo: ... xstermWindowId=...
[DEBUG-0009-RUST] create_tmux_session command EXIT ok=true info=...
[DEBUG-0009-RUST] emit_window_list: controller ... cmd_id=... entries=N windows=[...]
[DEBUG-0009-RUST] emit_window_list: inserting tmux_window_id=... -> xsterm_window_id=...
[DEBUG-0009-RUST] record_pane_window: inserting tmux_window_id=... -> xsterm_window_id=...
[DEBUG-0009-RUST] Session created via generic command: ... xsterm_window_id=...
```

**最关键的值**：
- `xsterm_window_id resolved` —— 应该是 `Some(非零值)`，**不是 `Some(0)`** 或 `None`
- `tmux_pane_info ... xstermWindowId` —— 同步此值
- `emit_window_list entries=N` —— 应等于 `tmux list-windows` 的行数
- `record_pane_window inserting` —— 应该每个 pane 1 条

### 5.3 前端调试 log 入口

dev WebView 里 F12 打开 console，过滤 `DEBUG-0009`：

```
[DEBUG-0009] WorkspaceContainer render {windows: Array(N)}
[DEBUG-0009] createTmuxSession hook called {tmuxSessionName}
[DEBUG-0009] createAndActivateSession tmux-cc branch hit {xstermWindowId}
[DEBUG-0009] insertTmuxControlAndBootstrapWindow setWorkspaces callback {prevLen}
```

**最关键的值**：
- `WorkspaceContainer render windows.length` —— 应等于 1 + server_window_count
- `createAndActivateSession ... xstermWindowId` —— 应**不是 undefined**
- `insertTmuxControlAndBootstrapWindow ... sessionXid` —— 应**不是 undefined**

## 6. ADR 文档

`doc/dev/adr/0009-tmux-control-window.md` 是这次改动的总设计文档。所有 ADR A1-A9 默认假设都已锁定。

`doc/dev/adr/0009-opencode-task.md` 是 opencode 实施 prompt 备份。

## 7. 测试运行命令

```powershell
cd C:\Users\LONER\1111\prj\xsterm

# 后端
cargo.exe check --manifest-path src-tauri/Cargo.toml --lib
cargo.exe test --manifest-path src-tauri/Cargo.toml --lib

# 前端
npx tsc --noEmit
npx vite build
npm run test
```

## 8. 服务端验证命令

```bash
ssh openclaw@shanclaw "tmux list-windows -t test"
ssh openclaw@shanclaw "tmux list-sessions"
ssh openclaw@shanclaw "tmux list-panes -t test -F '#{pane_id} #{window_id}'"
```

## 9. 已知非 bug 问题

- **HMR hook state 不刷新**：React Fast Refresh 保留 hook callback 引用。改 `useSessionLifecycle.ts` 后需要 hard reload dev（F5）。**不是 bug**，是 React 行为。
- **SSH 5s 超时** `SshTmuxBackend::wait timed out after 5 s` —— SSH 子进程退出但 ExitStatus 没立即就绪。tmux controller monitor 已有 5s 等待。
- **dev 路径**：Rust 改动后必须重启 tauri dev。重 build binary。

## 10. 不要改的地方

- `controller/mod.rs` 顶层 P5-P8 重构（ad-hoc 修改会破坏 v1/v2 双路径）
- `commands/session.rs` 中已有的3 个 Tauri command（detach_tmux_controller / kill_server_via_controller / unmark_attached_tmux）— 不要新增第4个
- `design-system.md`（AGENTS.md 强引用，UI 改动需 grep 验证）
- ADR 0009 §2.4 关闭语义表（这是验收标准）

## 11. ADR 状态

ADR 0009 §5 默认假设 A1-A9 全部按字面执行，**无偏离**。但 §3.2"未完成风险"列表里写了 3 项：

- E5.1 `tmux-window-added` 复用现有的 controller-exit —— ✅ 实际是简化了，未偏离
- E5.2 `tmux-controller-detached` 事件不新增，复用 controller-exit —— ✅ 同样简化
- E5.3（implicit）bootstrap 路径不发 `tmux-window-added` —— ✅ 前端用 sync insert + tmux-window-list 兜底

ADR **不需要修正**。