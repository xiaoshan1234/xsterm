# Refactoring Findings

## Duplication

1. **Two nearly identical shortcut hooks**
   - `src/hooks/useShortcut.ts` (30 lines)
   - `src/hooks/useKeyboardShortcut.ts` (37 lines)
   - Both register a window `keydown` listener and match key + modifiers.

2. **Two identical logger implementations**
   - `src/hooks/useLogger.ts`
   - `src/contexts/LoggerContext.tsx`
   - Both log to console and call `invoke("log_message", ...)`.

3. **Duplicate icon SVGs**
   - `getConfigIcon` in `Sidebar.tsx` and `getIcon` in `TabBar.tsx` render the same local/ssh icons.
   - `Sidebar.tsx` defines 7 inline icon components (`ChatIcon`, `SettingsIcon`, `LogIcon`, `ChevronIcon`, `FolderIcon`, `CloseIcon`, `PlusIcon`).

4. **Duplicate session creation logic**
   - `createLocalSession`, `createSshSession`, and `openFromConfig` in `SessionContext.tsx` all build a `Session` object with the same shape, set active session, and append to `sessions`.
   - Only the invoke command name and saved-config payload differ.

5. **Duplicate dialog structure**
   - `CreateSessionDialog.tsx` and the inline New Group dialog in `Sidebar.tsx` both implement overlay + dialog card + header + content + footer.

## Architectural Issues

1. **`KeyboardContext` violates Rules of Hooks**
   - `registerShortcut` calls `useShortcut(config)` inside a callback. Hooks cannot be called conditionally or inside callbacks.

2. **`SessionContext` violates Single Responsibility Principle**
   - 389 lines.
   - Mixes state management, Tauri store persistence, Tauri invoke calls, group management, and active-session tracking.
   - Hard to test and reason about.

3. **`App.tsx` does too much**
   - Defines 4 shortcuts inline.
   - Renders empty-state UI, tab bar, terminal container, and dialog.
   - Should be a thin layout shell.

4. **Monolithic CSS**
   - `App.css` is 767 lines with styles for every component.
   - No co-location of styles with components.

## Type Issues

1. `CreateSessionConfig` in `src/types/session.ts` is unused.
2. Frontend `SSHSessionConfig` manually mirrors backend `SSHAuth` enum; should align explicitly with backend serialization.
3. `Session["session_type"]` is cast with `as Session["session_type"]` in multiple places instead of being typed correctly from the invoke result.

## Recommendations

- Consolidate to one shortcut hook and delete `KeyboardContext` (or rewrite it to manage a list of shortcuts without violating hook rules).
- Keep logger as a Context provider; delete the duplicate hook.
- Extract a shared `createSession` helper in `SessionContext` to remove duplication.
- Extract services for storage and Tauri invocation so context only orchestrates React state.
- Build a small icon library and dialog/form primitives.
- Split CSS alongside components.

# tmux `-CC` Support Findings

## tmux Control Mode Protocol

- `-C` 模式：控制模式带 echo；`-CC` 模式：无 echo，协议数据用 DCS 序列 `ESC P 1000p tmux; ... ESC \` 包装。
- 行协议：前端向 tmux stdin 写命令，tmux 向前端 stdout 输出 `%` 开头的通知。
- 关键通知：
  - `%output %<pane_id> <escaped_data>`：pane 终端输出
  - `%extended-output %<pane_id> <age_ms> : <data>`
  - `%window-add @<wid>` / `%window-close @<wid>` / `%window-renamed @<wid> <name>`
  - `%session-changed $<sid> <name>` / `%session-renamed <name>`
  - `%layout-change @<wid> <layout> <visible> <flags>`：窗口布局变化
  - `%pause %<pid>` / `%continue %<pid>`：流控
  - `%exit [reason]`：断开
- 命令响应：用 `%begin <ts> <cmd_num>` ... `%end` / `%error` 块包裹。
- `%output` 数据采用八进制转义（如 `\134` 表示反斜杠）。
- 标识符：session `$N`、window `@N`、pane `%N`。

## Existing Libraries / References

- [tmux Control Mode Wiki](https://github.com/tmux/tmux/wiki/Control-Mode)
- [tmux control.c](https://github.com/tmux/tmux/blob/master/control.c)
- [iTerm2 TmuxGateway.m](https://github.com/gnachman/iTerm2/blob/master/sources/TmuxGateway.m)
- Rust crates: `par-term-emu-core-rust`（解析器）、`par-term-tmux`（完整集成）

## xsterm Architecture Relevance

- Rust 后端当前是“字节透传”：`session-output` 事件直接转发 PTY/SSH 原始字节，不做 ANSI 解析。
- 前端 `Terminal.tsx` 直接把 `session-output` 解码后喂给 xterm.js。
- `SessionContext` 维护扁平 `sessions[]` 数组，没有 pane/window 层级。
- `TerminalContainer` 把所有 session 渲染为全宽堆叠面板，只有 active session 可见。

## Key Implications

- tmux 控制模式解析建议放在 Rust 后端，因为：
  1. `%output` 的八进制转义需要在交给 xterm.js 前还原
  2. 可以按 pane ID 路由输出，复用现有 `Terminal` 组件
  3. `%pause` / `%continue` 流控在后端更容易实现
- 前端需要新增 tmux 状态树（session → window → pane）。
- UI 需要支持：tmux session 作为一级会话、tmux window 作为子标签、tmux pane 作为分屏布局。

# tmux Refactoring Findings (Current Task)

## Rust Backend (`src-tauri/src/tmux/`)

### Layering Issues
1. **`parser.rs` mixes protocol parsing with response classification**
   - Contains line parsing, DCS handling, octal unescaping, command-response classification, and list parsing.
   - Hard to navigate at 595 lines.

2. **`handlers.rs` mixes notification dispatch, state tracking, and sync requests**
   - `handle_notification` is a single 100-line match on notification names.
   - Pause/copy-mode state tracking is interleaved with event emission.
   - `request_state_sync` is a helper that emits to frontend; could live in a sync layer.

3. **`session.rs` mixes local PTY creation, SSH channel creation, and sync scheduling**
   - Two very different creation paths share one file.
   - `schedule_initial_sync` is a small but separate concern.

4. **`channel_io.rs` lacks module-level documentation**
   - `CapturePaneQueue` type and `ChannelReader`/`ChannelWriter` are not explained at file level.

5. **`commands.rs` has dead code and mixed command categories**
   - `#![allow(dead_code)]` suppresses useful signals.
   - Commands could be grouped: session, window, pane, flow-control, query.

### Readability Issues
- Some long functions (`handle_notification`, `handle_control_line`) could be split.
- Magic numbers in `parser.rs` (e.g., `splitn(2, ' ')`) lack named constants.
- `classify_command_response` uses heuristic column counts without comments.

## TypeScript Frontend

### Layering Issues
1. **`types/session.ts` mixes generic session types with tmux-specific types**
   - `TmuxPane`, `TmuxWindow`, `TmuxSessionState`, `TmuxState`, `TmuxControlEvent` should live in `types/tmux.ts`.

2. **`tmuxStateReducer.ts` is one large switch statement**
   - Each case mutates `next` directly; extracting per-event handlers improves testability.
   - Duplicated session/window lookup and creation logic.

3. **`tmuxService.ts` exports flat list of functions without grouping**
   - Hard to see lifecycle vs management vs query commands.

### Readability Issues
- `applyTmuxControlEvent` uses `_sessionId` parameter with underscore although it is actively used.
- Several cases fall through or use nested `if (!session)` blocks repeatedly.

## Files to Refactor

### Rust
- `src-tauri/src/tmux/parser.rs` → split or heavily comment
- `src-tauri/src/tmux/handlers.rs` → split notification mapper, state tracker, sync requester
- `src-tauri/src/tmux/session.rs` → split local/ssh creation; document lifecycle
- `src-tauri/src/tmux/channel_io.rs` → add docs
- `src-tauri/src/tmux/commands.rs` → group commands, remove dead code
- `src-tauri/src/tmux/state.rs` → add docs
- `src-tauri/src/tmux/events.rs` → add docs
- `src-tauri/src/tmux/forwarder.rs` → add docs

### TypeScript
- `src/types/session.ts` → extract tmux types to `src/types/tmux.ts`
- `src/types/tmux.ts` → create
- `src/services/tmuxService.ts` → group functions with comments
- `src/contexts/tmuxStateReducer.ts` → split into per-event handlers
- All consumers of tmux types (`SessionContext.tsx`, `TmuxWindowTabs.tsx`, `TmuxLayoutGrid.tsx`, `TmuxSessionView.tsx`, `TmuxSessionForm.tsx`, `Terminal.tsx`, `TerminalContainer.tsx`) → update imports
