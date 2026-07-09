# Findings: tmux 后端迁移到 -CC 控制模式

> **方向变更（2026-07-08）：** 原 underlay-session 方案被废弃，改为迁移到 `tmux -CC` 控制模式。以下内容已更新为当前方向的关键发现；旧内容作为历史参考保留。

## 1. Current Backend Architecture

### 1.1 Active module: `tmux_underlay`
- 路径：`src-tauri/src/services/tmux_underlay/`
- 包含：
  - `commander.rs`：构造 `tmux list-windows`、`list-panes`、`capture-pane` 等命令字符串。
  - `poller.rs`：后台线程以 500ms 轮询结构、200ms 轮询 pane 输出。
  - `underlay_session.rs`：通过 `UnderlayWriter` / `UnderlayReader` 在交互式 shell PTY 上写入/读取。
  - `state.rs` / `events.rs`：内部状态与 `tmux-state-sync` / `tmux-pane-output` 事件发射。
- 关键问题：`-F` 格式字符串中的 `\t` 在交互式 shell 中触发 readline 补全，导致 tmux 回退到默认格式，解析器得到 0 个 window。

### 1.2 计划中的模块：`services/tmux`（已不存在）
- 仓库中有 `tmux_cc_plan.md` 和 `.omo/notepads/tmux_refactor/findings.md` 详细描述了完整的 `services/tmux/` 模块设计。
- 原设计包含 13 个文件：parser、commands、state、state_tracker、channel_io、events、notification、handlers、forwarder、session、session/local、session/ssh。
- 当前代码中未找到 `src-tauri/src/services/tmux/**/*.rs`，说明该模块已随方向变更被移除或未实际合入。

## 2. `tmux -CC` Protocol Summary

- `-CC` 启动无 echo 控制模式，协议数据用 DCS 序列包装：
  - 开始：`ESC P 1000p tmux;`
  - 结束：`ESC \`
- 输入：每行一个命令，例如 `send-keys -t %0 hello\n`。
- 输出：
  - 异步通知以 `%` 开头，如 `%output %0 ...`、`%window-add @1`、`%layout-change @1 ...`。
  - 命令响应块：`%begin <time> <cmd_num> <flags>` ... `%end` / `%error`。
- `%output` 数据使用八进制转义（如 `\134` 表示反斜杠）。
- 退出：tmux 发送 `%exit [reason]`（例如 300s 未读取时的 `too far behind`）。
- 版本差异：tmux 3.2+ 支持 `pause-after`、`refresh-client -B subscriptions`、`ignore-size` 等高级特性。

## 3. Integration Points

### 3.1 后端 → 前端事件
- `tmux-state-sync`：携带 `(session_id, TmuxStateSnapshot)`，前端 `tmuxStateReducer` 合并到 `TmuxState`。
- `tmux-pane-output`：携带 `(session_id, TmuxPaneOutput { pane_id, data })`，前端 `useTauriTerminalOutput` 写入对应 xterm。
- `tmux-connection-error` / `session-closed`：错误与生命周期事件。

### 3.2 前端状态
- `src/contexts/tmuxStateReducer.ts` 已维护 `TmuxState`（sessions/windows/panes Map）。
- `TmuxSessionView` / `TmuxWindowTabs` / `TmuxLayoutGrid` 已能渲染 tmux 结构。
- 迁移到 -CC 后，事件来源改变但数据结构不变，前端改动应最小化。

## 4. Risks & Pitfalls

1. **SSH 通道选择**：`-CC` 需要 stdin/stdout 全双工通信，`ssh.exec` 的 exec 通道是正确选择；shell 通道会有 shell 转译风险。
2. **重连状态恢复**：-CC 是长连接，EOF/`%exit` 后需要重新 `attach-session -t <name>` 并做 hydration 快照。
3. **300s 超时**：tmux 会在客户端 300s 未读取后强制断开，需处理 `%pause`/`%continue` 或准备重连。
4. **版本兼容**：macOS 系统 tmux 可能较旧，需决定最低版本或运行时检测。
5. **初始快照竞态**：在 (re)attach 时，需先 `refresh-client -A '%*:pause'`，然后 `capture-pane`，再 `refresh-client -A '%*:continue'`，否则可能丢/重输出。
6. **DCS 解析边界**：协议字节流可能跨 read 边界，解析器必须支持增量解析。

## 5. Reference Implementation & Libraries

- `tmux_cc_plan.md` — 项目内已有的详细设计文档。
- `.omo/notepads/tmux_refactor/findings.md` — 原模块依赖分析、测试覆盖、代码质量问题。
- 外部参考：
  - [tmux Control Mode Wiki](https://github.com/tmux/tmux/wiki/Control-Mode)
  - [iTerm2 TmuxGateway.m](https://github.com/gnachman/iTerm2/blob/master/sources/TmuxGateway.m)
  - [tmuxctl](https://github.com/ace-rs/tmuxctl) / [par-term-tmux](https://crates.io/crates/par-term-tmux) — Rust 控制模式库。

## 6. Key Decision: Direction Reversal

- 2026-07-08 用户确认：将 tmux 后端从 `tmux_underlay` 反向迁移回 `tmux -CC` 控制模式。
- 旧 `task_plan.md`（underlay 方向）已被覆盖更新为新的 -CC 迁移计划。
- 保留 `tmux_underlay` 模块在过渡期内作为可回退方案，待 -CC 通路稳定后删除。

## 7. Next Steps

- 完成 Phase 2 规划细节（模块接口、版本策略、重连策略）。
- 进入 Phase 3：实现 `services/tmux` 模块。
- 进入 Phase 4：与 `SessionManager` / Tauri 命令集成。
- 进入 Phase 5：前端最小调整与测试。

---

## 历史发现（underlay 方案，已废弃）

## 高优先级发现

### 1. 当前 tmux 实现基于 `tmux -CC` 控制模式
- 文件：`src-tauri/src/services/tmux/*`
- 现状：Rust 后端直接启动 `tmux -CC` 进程（本地 PTY 或 SSH exec 通道），解析 DCS 协议、事件通知、输出流。
- 影响：与 `req-006-tmux.md` 要求的“先创建 underlay session，再运行 tmux 命令”的架构不一致，需要替换底层通信方式。

### 2. 缺少 underlay-session-window 概念
- 文件：`src/components/Pane.tsx`、`src/components/TmuxSessionView.tsx`
- 现状：tmux session 被当作一个普通 pane 渲染，内部用 `TmuxWindowTabs` 叠加多个 tmux window。
- 影响：需求要求 underlay session 对应一个独立的、只用于连接/断开的控制窗口，而非可输入输出的终端。

### 3. 没有 tmux pane 级别的右键操作菜单
- 文件：`src/components/TmuxLayoutGrid.tsx`
- 现状：每个 pane cell 渲染 `Terminal`，但没有右键菜单提供关闭/水平分割/垂直分割。
- 影响：无法满足 `req-006-tmux.md` 的 pane 配置需求。

### 4. 连接探测与错误弹窗未实现
- 文件：`src/components/dialogs/TmuxSessionForm.tsx`、`src/contexts/session/useSessionActions.ts`
- 现状：创建 tmux session 时直接启动控制模式，没有“探测 tmux 是否安装、探测 session 是否存在”的阶段性错误反馈。
- 影响：需要新增错误事件、弹窗组件和连接状态管理。

### 5. tmux window 命名未使用 `session-name:window-name` 格式
- 文件：`src/components/TmuxWindowTabs.tsx`、`src/contexts/tmuxStateReducer.ts`
- 现状：window tab 显示 `window.name` 或 `window.id`。
- 影响：需要按需求格式生成 xsterm window 名称。

## 中低风险发现

- `TmuxSessionForm.tsx` 使用 `as` 类型断言（`config.ssh!`），重构时可用更严格的类型推导替换。
- `TmuxLayoutGrid.tsx` 中 `parseInt` 缺少 radix 参数，虽然当前代码已显式传入 `10`，仍可注意保持一致。
- `cloneTmuxState()` 在 `tmuxStateReducer.ts` 中只浅拷贝 Map，内部对象在 reducer 中会被替换，但仍需注意不可变性。

## 结构/行为发现

### 1. SessionManager 已支持 local/ssh 会话创建
- `SessionManager` 内部可创建 `Local` 和 `Ssh` session，这是新的 underlay session 的基础。
- 新的 tmux 实现可以复用这些会话来运行 tmux 命令。

### 2. 前端 pane 树模型与 tmux layout 已兼容
- `PaneNode` 树支持 `split` 与 `leaf`，`TmuxLayoutGrid` 已能解析 tmux layout 字符串并绝对定位子 pane。
- 命令式模式下仍可从 `list-panes -F '#{window_layout}'` 获取 layout，因此现有布局解析可复用。

### 3. Terminal 组件已支持 paneId 路由
- `Terminal.tsx` 在 `paneId` 存在时调用 `sendKeysToTmuxPane`，否则调用 `writeSession`。
- 命令式模式下只需继续让 `paneId` 存在，并保持输入走 `sendKeysToTmuxPane`。

### 4. Tauri 事件通道已可用
- 现有事件：`session-closed`、`tmux-pane-output`、`tmux-control-event`、`tmux-request-sync`。
- 新架构可复用 `tmux-pane-output` 作为 capture-pane 输出，新增 `tmux-state-sync` 作为状态快照。

## 待决策问题

1. 是否完全移除 `tmux -CC` 相关代码？建议保留文件但逐步替换引用，降低回归风险。
2. capture-pane 轮询频率与历史行数：建议默认 500ms、250 行，可后续配置化。
3. 远端 tmux 结构外部变更的同步：依赖 poller 的 `list-windows`/`list-panes` 轮询。
4. 当 xsterm window 被关闭时，是否同步关闭 tmux window？需求明确“双击关闭 tmux window，远端的 tmux window 也要关闭”。

## 文件变更预期

### 新增
- `src-tauri/src/services/tmux_underlay/*`
- `src/components/TmuxUnderlayWindow.tsx`

### 修改
- Rust：`session_manager.rs`、`commands/session.rs`、`commands/mod.rs`、`models/session.rs`
- TypeScript：`types/session.ts`、`types/tmux.ts`、`services/tmuxService.ts`、`contexts/session/*`、`components/Tmux*.tsx`、`components/Pane.tsx`、`components/WorkspaceContainer.tsx`、`components/dialogs/TmuxSessionForm.tsx`、`components/dialogs/CreateSessionDialog.tsx`
