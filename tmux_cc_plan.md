# tmux `-CC` 控制模式支持计划

## Goal
让 xsterm 支持连接本地或远程的 tmux 控制模式（`tmux -CC`），将 tmux 的 session/window/pane 结构映射到 xsterm 的会话/标签/分屏模型中，实现类似 iTerm2 的 tmux 集成体验。

## Scope
- Rust 后端：新增 tmux 控制模式解析层、命令构造器、状态同步逻辑
- 前端类型：扩展 `Session` / `SessionType` 以表达 tmux 层级
- 前端状态：在 `SessionContext` 中维护 tmux session → window → pane 树
- 前端 UI：`TerminalContainer` 支持按 tmux window 分标签、按 pane 布局分屏
- 先支持本地 tmux 会话（`tmux -CC new-session`），再扩展到 SSH 上运行 tmux

## Background

### tmux `-CC` 协议要点
- `-C`：控制模式，协议行从 stdout 输出，命令从 stdin 输入
- `-CC`：无 echo 模式，协议数据用 DCS 序列包装：
  - 开始：`ESC P 1000p tmux;`
  - 结束：`ESC \`
  - 中间每行以 `\r\n` 分隔
- 行协议：输入命令，输出以 `%` 开头的通知
- 关键通知：
  - `%output %<pane_id> <escaped_data>`：pane 的终端输出
  - `%extended-output %<pane_id> <age_ms> : <data>`：带延迟的输出
  - `%window-add @<wid>`、`%window-close @<wid>`、`%window-renamed @<wid> <name>`
  - `%session-changed $<sid> <name>`、`%session-renamed <name>`
  - `%layout-change @<wid> <layout> <visible> <flags>`：窗口布局变化
  - `%pane-mode-changed %<pid>`
  - `%pause %<pid>` / `%continue %<pid>`：流控
  - `%exit [reason]`：客户端断开
- 命令响应块：
  ```
  %begin <timestamp> <cmd_num> <flags>
  ...
  %end <timestamp> <cmd_num> <flags>
  ```
  或 `%error ...`
- `%output` 数据使用八进制转义（如 `\134` 表示反斜杠）
- 标识符：session `$N`、window `@N`、pane `%N`

### xsterm 现状
- 后端：Rust 通过 `session-output` 事件把原始字节透传给前端，不解析 ANSI
- 前端：`Terminal.tsx` 监听 `session-output`，解码后直接 `xterm.write(text)`
- 状态：`SessionContext` 维护扁平 `sessions[]` 数组，无 pane/window 层级
- UI：`TabBar` 一个标签对应一个 session；`TerminalContainer` 把 sessions 渲染为全宽堆叠面板

## Proposed Architecture

### 集成点选择：Rust 后端做协议解析
在 `spawn_output_forwarder`（本地）和 `run_data_loop` 后的转发线程（SSH）中插入 `TmuxControlParser`，将字节流拆分为：
1. **普通 pane 输出**：继续通过 `session-output` 事件发给前端，按 pane ID 路由
2. **tmux 控制通知**：通过新事件 `tmux-control-event` 发给前端，更新 React 状态
3. **tmux 命令输入**：前端通过 `write_tmux_command` 命令发送

选择 Rust 解析的原因：
- `%output` 的八进制转义需要在进入 xterm.js 前还原
- 可以把每个 pane 输出作为独立 `session-output` 事件，复用现有 `Terminal` 组件
- 流控（`%pause` / `%continue`）和命令响应相关性在后端更容易处理

### 状态映射
```
tmux session ($N)  → xsterm Session (type: "tmux")
tmux window (@N)   → xsterm Tab / Window (同一 tmux session 内的多个窗口)
tmux pane (%N)     → xsterm Terminal 实例（真正的 xterm.js 渲染目标）
```

一个 xsterm "tmux session" 下面包含多个 window，每个 window 有自己的布局（layout string）和 pane 列表。前端需要维护这个树：
```ts
interface TmuxState {
  sessions: Map<string, TmuxSession>;   // key: $<sid>
  windows: Map<string, TmuxWindow>;     // key: @<wid>
  panes: Map<string, TmuxPane>;         // key: %<pid>
}
```

### 命令通道
前端通过 Tauri 命令把 tmux 命令字符串发到后端，后端写入对应 tmux 进程的 stdin：
- `write_tmux_command(session_id: number, command: string) -> Result<(), String>`

tmux 命令示例：
- `list-sessions`
- `list-windows -t $<sid>`
- `list-panes -t @<wid>`
- `send-keys -t %<pid> <keys>`
- `resize-pane -t %<pid> -x <cols> -y <rows>`
- `new-window` / `kill-window -t @<wid>`
- `kill-session -t $<sid>`

## Phases

### Phase 1 — Rust 后端基础设施
- [ ] 创建 `src-tauri/src/tmux/` 模块
- [ ] 创建 `tmux/parser.rs`：行解析器、DCS 包装/解包、八进制转义还原、通知枚举
- [ ] 创建 `tmux/commands.rs`：命令构造器（`send_keys`、`resize_pane`、`list_*` 等）
- [ ] 创建 `tmux/state.rs`：内部状态模型（TmuxSession/TmuxWindow/TmuxPane）
- [ ] 创建 `tmux/session.rs`：TmuxSession 生命周期管理（创建、命令写入、输出转发）
- [ ] 扩展 `models/session.rs`：新增 `SessionType::Tmux { socket?: String }` 和 `TmuxSessionConfig`
- [ ] 扩展 `SessionManager`：新增 `create_tmux_session()`、`write_tmux_command()`、`resize_tmux_pane()`
- [ ] 扩展 `commands/session.rs`：新增 `create_tmux_session`、`write_tmux_command`、`resize_tmux_pane`
- [ ] 新增事件发射：`tmux-control-event` 和按 pane ID 路由的 `session-output`

### Phase 2 — 前端类型与状态
- [ ] 扩展 `src/types/session.ts`：
  - `Session["type"]` 增加 `"tmux"`
  - 新增 `TmuxSessionConfig`、`TmuxWindow`、`TmuxPane` 类型
- [ ] 扩展 `SessionContext`：
  - 新增 `createTmuxSession` 方法
  - 维护 `tmuxState`（session/window/pane 树）
  - 提供 `activeTmuxWindowId`、切换 window 方法
  - 把 pane 输出路由到对应 pane 的 terminal
- [ ] 新增 `tmuxService.ts`：封装 `create_tmux_session`、`write_tmux_command`、`resize_tmux_pane` invoke

### Phase 3 — 前端 UI 改造
- [ ] 改造 `TerminalContainer`：
  - 支持两种渲染模式：普通 session（现有堆叠模式）和 tmux session 的分屏模式
  - tmux session 按 active window 渲染 pane 网格，使用 tmux layout string 计算位置/大小
- [ ] 改造 `TabBar`：
  - 普通 session：保持现有行为
  - tmux session：二级标签表示 tmux window，或增加 window 切换下拉/子标签
- [ ] 新增 `TmuxWindowTabs` 组件（可选）：在 TabBar 下方显示当前 tmux session 的 windows
- [ ] 扩展 `Terminal` 组件：支持按 pane ID 接收输出（输出事件需携带 pane id 而非 session id）
- [ ] 新增 `CreateSessionDialog` 中 tmux 会话选项（本地 tmux 默认命令）

### Phase 4 — 用户输入与流控
- [ ] `Terminal.onData` 在 tmux pane 上发送 `send-keys -t %<pid>` 命令，而非直接 `write_session`
- [ ] `Terminal` resize 时发送 `resize-pane -t %<pid> -x <cols> -y <rows>`
- [ ] 后端实现 `%pause` / `%continue` 处理：收到 `%pause` 时暂停向该 pane 写入 `session-output`，收到 `%continue` 后恢复
- [ ] 支持 `pause-after` 配置

### Phase 5 — 高级功能
- [ ] 支持 tmux window 创建/关闭/重命名通过 UI 触发
- [ ] 支持在 SSH session 中启动 tmux -CC（在现有 SSH channel 上运行 tmux，复用同一 channel）
- [ ] 支持重连/attach 到已有 tmux session（`tmux -CC attach -t $<sid>`）
- [ ] 支持 tmux 复制模式状态同步（`%pane-mode-changed`）

### Phase 6 — 验证
- [ ] `cargo check` / `cargo build` 通过
- [ ] `npm run build` 通过
- [ ] 手动测试：本地启动 `tmux -CC new-session`，验证 pane 输出、输入、resize、window 切换
- [ ] 手动测试：SSH 到远程运行 tmux -CC

## Files to Create

### Rust
- `src-tauri/src/tmux/mod.rs`
- `src-tauri/src/tmux/parser.rs`
- `src-tauri/src/tmux/commands.rs`
- `src-tauri/src/tmux/state.rs`
- `src-tauri/src/tmux/session.rs`

### TypeScript
- `src/types/tmux.ts`
- `src/services/tmuxService.ts`
- `src/components/TmuxWindowTabs.tsx`
- `src/components/TmuxLayoutGrid.tsx`（可选，用于按 layout string 分屏）

## Files to Modify

### Rust
- `src-tauri/src/models/session.rs` — 新增 Tmux 类型
- `src-tauri/src/services/session_manager.rs` — 新增 create_tmux_session / write_tmux_command / resize_tmux_pane
- `src-tauri/src/services/local_session.rs` — 提供可重用的输出转发 hook 或抽象
- `src-tauri/src/infrastructure/ssh.rs` — 可选：在 SSH channel 上运行 tmux
- `src-tauri/src/commands/session.rs` — 新增 Tauri 命令
- `src-tauri/src/commands/mod.rs` / `src-tauri/src/lib.rs` — 注册命令

### TypeScript
- `src/types/session.ts` — 新增 tmux 类型
- `src/contexts/SessionContext.tsx` — 维护 tmux 状态
- `src/services/sessionService.ts` — 可选：拆分为 local/ssh/tmux 服务
- `src/components/Terminal.tsx` — 支持 pane id 路由
- `src/components/TerminalContainer.tsx` — 支持 tmux 分屏布局
- `src/components/TabBar.tsx` — 支持 tmux window 标签
- `src/components/CreateSessionDialog.tsx` — 新增 tmux 会话类型

## Success Criteria
- [ ] 用户可以新建一个 tmux 控制模式会话
- [ ] 一个 tmux session 内的多个 window 能在 xsterm 中切换
- [ ] 一个 window 内的多个 pane 按 tmux 布局正确分屏显示
- [ ] 每个 pane 的输入/输出正常，大小调整同步到 tmux
- [ ] 普通 local/ssh 会话行为不受影响
- [ ] 构建命令通过

## Open Questions
1. tmux layout string 的解析是否在前端做几何计算，还是让后端预先解析成结构化布局？
2. xsterm 的 `SessionContext` 是扩展为包含 tmux 树，还是新建独立的 `TmuxContext`？
3. 是否优先复用 `par-term-emu-core-rust`/`par-term-tmux` 库，还是自研解析器？
4. SSH tmux 支持是否作为独立 `SessionType::SshTmux`，还是在 `SessionType::Ssh` 中嵌套运行？

## References
- [tmux Control Mode Wiki](https://github.com/tmux/tmux/wiki/Control-Mode)
- [tmux control.c](https://github.com/tmux/tmux/blob/master/control.c)
- [iTerm2 TmuxGateway.m](https://github.com/gnachman/iTerm2/blob/master/sources/TmuxGateway.m)
- [par-term-emu-core-rust](https://crates.io/crates/par-term-emu-core-rust)
- [par-term-tmux](https://crates.io/crates/par-term-tmux)
