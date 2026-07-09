# 迁移 tmux 后端到 tmux -CC 控制模式

> **方向变更（2026-07-08）：** 本计划取代原 underlay-session 轮询方案。当前 `tmux_underlay` 模块仍保留但将迁移到 `tmux -CC` 控制模式；原 underlay 方案作为历史参考保留在 `tmux_cc_plan.md` 与下方旧记录中。

## Goal
将 xsterm 的 tmux 后端从 `tmux_underlay`（交互式 shell PTY + 轮询）迁移到 `tmux -CC` 控制模式（事件驱动协议），使 Connect 能稳定地创建并显示 tmux window/pane，并为本地和 SSH tmux 会话提供统一、可重连的控制通道。

## Current State
- 当前代码仅存在 `src-tauri/src/services/tmux_underlay/` 模块，使用交互式 shell 轮询 `list-windows` / `list-panes` / `capture-pane`。
- 仓库中已有 `tmux_cc_plan.md` 详细设计文档，规划了 `src-tauri/src/services/tmux/` 模块的 -CC 控制模式实现（parser、commands、state、session/local、session/ssh 等）。
- 前端已维护 `TmuxState`（session/window/pane 树）并通过 `TmuxSessionView`/`TmuxLayoutGrid`/`TmuxWindowTabs` 渲染，事件契约（`tmux-state-sync` / `tmux-pane-output`）可复用。
- 需要重新实现 Rust 后端，并替换 `SessionManager` 与 `commands/session.rs` 中的 tmux 连接逻辑。

## Proposed Architecture

### 1. Rust 后端：`tmux -CC` 控制模式
创建新模块 `src-tauri/src/services/tmux/`：
- `parser.rs`：DCS 包装/解包、八进制转义还原、通知/响应块解析。
- `commands.rs`：tmux 命令构造器（`send_keys`、`resize_pane`、`list_windows`、`capture_pane` 等）。
- `state.rs`：内部状态模型与前端事件序列化（camelCase）。
- `state_tracker.rs`：`%pause`/`%continue` 与 copy-mode 状态。
- `channel_io.rs`：同步 I/O 适配异步通道/PTY 写入。
- `events.rs`：向前端发射 `tmux-state-sync` / `tmux-pane-output` 等事件。
- `notification.rs`：通知名 → `TmuxControlEvent` 映射。
- `handlers.rs`：解析消息 → 事件分发。
- `forwarder.rs`：后台读取/解析/分发线程。
- `session.rs` / `session/local.rs` / `session/ssh.rs`：本地 PTY 和 SSH exec 通道创建。

创建新会话时使用 `tmux -CC new-session -A -s <name>`；重连使用 `tmux -CC attach-session -t <name>`。命令与输出通过 stdin/stdout 直接交互，不再经过 shell 转译。

### 2. 与现有系统的关系
- 替换 `SessionManager` 中的 `connect_tmux_underlay` 为 `connect_tmux_cc`。
- 保留非 tmux 的 local/ssh 会话（`services/local_session.rs`、`services/ssh_session.rs`）不变。
- 保留 `tmux_underlay` 模块在过渡期内，连接成功后逐步废弃。

### 3. 前端
- 事件契约保持不变：`tmux-state-sync` 更新状态树，`tmux-pane-output` 写入对应 pane。
- 最小调整：创建入口、命令调用、错误处理路径。
- 不需要重新实现 `TmuxSessionView` / `TmuxLayoutGrid` / `TmuxWindowTabs` 的渲染逻辑。

## Phases

### Phase 1 — 需求与现状梳理
- [x] 确认当前使用 `tmux_underlay` 模块及其轮询实现。
- [x] 梳理 `tmux -CC` 协议要点、事件类型、生命周期和 SSH 差异。
- [x] 复用已有的 `tmux_cc_plan.md` 设计文档。
- [x] 记录关键发现到 `findings.md`。
- **Status:** complete

### Phase 2 — 规划与结构设计
- [x] 确定 `services/tmux/` 模块的 13 个文件职责与接口边界。
- [x] 确认前端事件契约不变（`tmux-state-sync` / `tmux-pane-output`）。
- [x] 制定版本兼容性策略：先支持 tmux 2.5+ 的基础 -CC；tmux 3.2+ 的高级特性（pause-after、subscriptions）作为后续优化。
- [x] 制定重连/错误处理策略：本地检测 EOF/`%exit` 并 emit `session-closed`；SSH 后续实现自动重连。
- [x] 将 `tmux_cc_plan.md` 的 6 个阶段映射到可执行任务。
- [x] 读取关键集成点：`services/mod.rs`、`session_manager.rs`、`commands/session.rs`、`commands/mod.rs`、`models/session.rs`。
- **Status:** complete

### Phase 3 — Rust `-CC` 模块实现
- [ ] 创建 `services/tmux/mod.rs` 及子模块。
- [ ] 实现 `parser.rs`：DCS 包装/解包、八进制转义还原、通知/响应块解析。
- [ ] 实现 `commands.rs`：命令字符串构造器（`send_keys`、`resize_pane`、`list_windows`、`capture_pane` 等）。
- [ ] 实现 `state.rs`：内部状态模型与前端事件序列化（camelCase）。
- [ ] 实现 `state_tracker.rs`：pause/copy-mode 流控状态。
- [ ] 实现 `channel_io.rs`：同步 I/O 适配异步通道/PTY 写入。
- [ ] 实现 `events.rs`：向前端发射 `tmux-state-sync` / `tmux-pane-output` 等事件。
- [ ] 实现 `notification.rs`：通知名 → `TmuxControlEvent` 映射。
- [ ] 实现 `handlers.rs`：解析消息 → 事件分发。
- [ ] 实现 `forwarder.rs`：后台读取/解析/分发线程。
- [ ] 实现 `session.rs` / `session/local.rs` / `session/ssh.rs`：本地 PTY 和 SSH exec 通道创建。
- [ ] 编写 `parser.rs` 和 `commands.rs` 的单元测试；保留 `session.rs` 的集成测试（需要本地 tmux）。
- **Status:** in_progress

### Phase 4 — 与现有系统集成
- [ ] 在 `services/session_manager.rs` 中新增 `connect_tmux_cc` / `disconnect_tmux_cc` / `send_keys_to_tmux_pane` / `resize_tmux_pane`。
- [ ] 在 `commands/session.rs` 中新增 Tauri 命令，替换或复用现有 `connect_tmux_underlay`。
- [ ] 在 `commands/mod.rs` 和 `lib.rs` 中注册新命令。
- [ ] 确保 `models/session.rs` 中的 `SessionType` / `TmuxSessionConfig` 与新后端兼容。
- [ ] 保持 `tmux_underlay` 在过渡期可回退（可选），或一次性替换后删除。
- **Status:** pending

### Phase 5 — 前端最小调整
- [ ] 确认 `TmuxSessionView`、`TmuxWindowTabs`、`TmuxLayoutGrid` 已能消费现有事件契约。
- [ ] 在 `tmuxService.ts` 中封装新命令调用。
- [ ] 必要时调整 `SessionContext` 的创建入口。
- [ ] 确保普通 local/ssh 会话 UI 不受影响。
- **Status:** pending

### Phase 6 — 测试与验证
- [ ] `cargo check` 在 `src-tauri` 中无新增错误。
- [ ] 本地运行 `tmux -CC new-session`，验证 pane 输出、输入、resize、window 切换。
- [ ] 手动测试 SSH 上运行 `tmux -CC`。
- [ ] 验证前端能正确显示 tmux window/pane。
- [ ] 记录测试日志到 `progress.md`。
- **Status:** pending

### Phase 7 — 清理与交付
- [ ] 删除或标记废弃 `tmux_underlay` 模块（如果决定完全替换）。
- [ ] 更新 `tmux_cc_plan.md` 与 `task_plan.md` 状态。
- [ ] 最终 `cargo check` 与 `npm run build`（用户手动执行或 CI 执行）。
- [ ] 向用户汇报迁移结果。
- **Status:** pending

## Files to Create

### Rust
- `src-tauri/src/services/tmux/mod.rs`
- `src-tauri/src/services/tmux/parser.rs`
- `src-tauri/src/services/tmux/commands.rs`
- `src-tauri/src/services/tmux/state.rs`
- `src-tauri/src/services/tmux/state_tracker.rs`
- `src-tauri/src/services/tmux/channel_io.rs`
- `src-tauri/src/services/tmux/events.rs`
- `src-tauri/src/services/tmux/notification.rs`
- `src-tauri/src/services/tmux/handlers.rs`
- `src-tauri/src/services/tmux/forwarder.rs`
- `src-tauri/src/services/tmux/session.rs`
- `src-tauri/src/services/tmux/session/local.rs`
- `src-tauri/src/services/tmux/session/ssh.rs`

### TypeScript
- 无需新增主要组件；复用现有 `TmuxSessionView` / `TmuxWindowTabs` / `TmuxLayoutGrid`。
- 可能需要新增 `src/services/tmuxService.ts` 或对现有服务进行封装。

## Files to Modify

### Rust
- `src-tauri/src/services/mod.rs` — 添加 `pub(crate) mod tmux;`
- `src-tauri/src/services/session_manager.rs` — 替换 `connect_tmux_underlay` 为 `connect_tmux_cc`，新增 disconnect/send_keys/resize 方法
- `src-tauri/src/commands/session.rs` — 新增/调整 tmux -CC 命令
- `src-tauri/src/commands/mod.rs` — 注册新命令
- `src-tauri/src/models/session.rs` — 确保 `SessionType` / `TmuxSessionConfig` 兼容新后端

### TypeScript
- `src/types/session.ts` — 调整 tmux 配置类型（如需）
- `src/services/tmuxService.ts` — 封装新的 invoke 调用
- `src/contexts/session/useSessionActions.ts` — 创建 tmux 会话入口
- `src/contexts/session/useTauriListeners.ts` — 处理连接错误与状态同步
- `src/contexts/tmuxStateReducer.ts` — 确认状态同步事件处理兼容新后端

## Success Criteria
- [ ] 可创建本地或 SSH 的 tmux -CC 会话
- [ ] 连接失败 / tmux 未安装 / tmux session 不存在时前端收到错误事件
- [ ] 一个 tmux session 内的多个 window 能在 xsterm 中切换
- [ ] 一个 window 内的多个 pane 按 tmux layout 正确分屏显示
- [ ] 每个 pane 的输入/输出正常，大小调整同步到 tmux
- [ ] 普通 local/ssh 会话行为不受影响
- [ ] `cargo check` 与 `npm run build` 通过

## Open Questions
1. 是否完全移除 `tmux_underlay`，还是保留为可切换/降级模式？
2. 是否要求最低 tmux 版本（3.2+），并需要运行时版本检测和降级？
3. SSH 上采用 `exec` 通道还是 `shell` 通道运行 `tmux -CC`？
4. 重连策略：断开时自动重试 attach，还是提示用户手动重连？
5. 是否复用现有第三方 crate（`par-term-tmux`、`tmuxctl`）还是自研解析器？
6. `%pause` / `%continue` 流控是否必须在本阶段实现，还是后续迭代？

## Decisions Made
| Decision | Rationale |
|----------|-----------|
| 复用 `tmux_cc_plan.md` 的模块设计 | 该文档已详细规划 parser/commands/state/session 分层，与当前研究发现一致。 |
| 前端事件契约保持不变 | 前端 `tmuxStateReducer` / `TmuxSessionView` 已支持 tmux 树结构，无需大规模改动。 |
| 分阶段替换 `tmux_underlay` | 降低风险：先让 -CC 通路跑通，再删除旧模块。 |
| 先支持本地，再扩展到 SSH | 与 `tmux_cc_plan.md` 阶段一致，SSH exec 通道风险更高，放在后面验证。 |

## Errors Encountered
| Error | Attempt | Resolution |
|-------|---------|------------|
| Metis consultation aborted | 1 | 直接基于已有 research 结果创建计划，不再等待。 |
| 旧 `task_plan.md` 方向相反 | 1 | 与用户确认后，更新本文件为 -CC 迁移方向。 |

## Notes
- 参见 `tmux_cc_plan.md` 获取原始详细设计（DCS 协议、事件列表、文件清单）。
- 当前 `tmux_underlay` 的问题是 `-F` 参数在交互式 shell 中受 readline/tab 影响，`-CC` 直接规避此问题。
- 实施中必须注意：`-CC` 是长连接协议，需要处理 `%exit`、`%pause`/`%continue`、300s 超时、重连快照恢复。
- AI 不能执行编译/构建命令，所有 build 验证需由用户或 CI 执行。
