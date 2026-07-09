# Workspace Session Ownership / tmux -CC 迁移 — 进度日志

> **方向变更（2026-07-08）：** 用户确认将 tmux 后端从 `tmux_underlay` 迁移到 `tmux -CC` 控制模式。下方历史记录是已完成的 underlay 方案实现；新的 -CC 迁移从 2026-07-08 开始记录。

## 2026-07-08 — 迁移到 tmux -CC 控制模式（续）
- [x] 用户确认方向反转：从 underlay 迁移到 -CC。
- [x] 完成 Phase 1：梳理当前架构、复用 `tmux_cc_plan.md`。
- [x] 完成 Phase 2：更新计划文件，读取关键集成点。
- [x] 完成 Phase 3 Rust `-CC` 模块实现：13 个文件已存在，parser/commands/state/session/forwarder/events 等核心子模块完整。
- [ ] 进行中：Phase 4 后端集成——已在 `services/mod.rs`、`session_manager.rs`、`commands/session.rs`、`commands/mod.rs` 启动并行改造（任务 T-533e5128）。
- [ ] 进行中：修复 `tmux-state-sync` 事件为完整快照（任务 T-4eb4607b）。
- [ ] 待开始：Phase 5 前端最小调整（移除 underlay connect/disconnect，更新 Pane 加载态）。

---

## 历史记录（underlay 方案，已废弃）

## 2026-07-07
- [x] 探索现有 workspace/session 类型与生命周期
- [x] 确定改造点：运行时 Workspace 增加 `sessionIds`、保存时剥离 `sessionId`、加载时重建 session、关闭 workspace 时关闭其 sessions
- [x] Phase 1 — 扩展类型与辅助函数
- [x] Phase 2 — 保存配置不保留 runtime sessionId
- [x] Phase 3 — Workspace 显式维护其 session 集合
- [x] Phase 4 — 构建验证 (`npm run build` 通过)
- [x] Debug — 修复 `createWindowFromSession`/`splitPane` 因 `sessionsRef` 未同步导致 `configId` 丢失
- [x] 新增 — 右键 pane 菜单增加 "Close Pane"，关闭 pane 同时关闭其 session
- [x] 修复 — 已加载的 saved workspace 修改后保存应覆盖旧配置，而不是提示 "Workspace name already exists"

## 2026-07-08 — 重构 tmux 支持（按 req-006-tmux.md）

### Phase 1 — Rust tmux underlay 后端
- [x] 创建 `tmux_underlay` 模块骨架
- [x] 实现 underlay session 包装（复用 local/ssh）
- [x] 实现 tmux 命令构造器
- [x] 实现输出读取与解析
- [x] 实现 poller
- [x] 定义事件类型与状态快照
- [x] 更新 `SessionManager` 中的 tmux 创建逻辑
- [x] `cargo check` 通过

### Phase 2 — Rust 命令与事件
- [x] 新增 Tauri 命令：connect/disconnect、send_keys、resize_pane、window/pane CRUD
- [x] 在 `commands/mod.rs` 注册命令
- [x] 实现事件发射：`tmux-state-sync`、`tmux-pane-output`、`tmux-connection-error`
- [x] 实现连接探测与错误事件

### Phase 3 — 前端类型与服务
- [x] 更新 `src/types/tmux.ts`：underlay 状态、新的事件类型
- [x] 更新 `src/services/tmuxService.ts`：新的 invoke 封装
- [x] 更新 `src/contexts/tmuxStateReducer.ts`：处理 `tmux-state-sync` 快照
- [x] 更新 `src/contexts/session/useTauriListeners.ts`：处理 `tmux-state-sync` 和 `tmux-connection-error`

### Phase 4 — 前端 UI 与交互
- [x] 创建 `TmuxUnderlayWindow.tsx` 控制面板组件
- [x] 修改 `Pane.tsx` 对 tmux session 的渲染分支
- [x] 修改 `TmuxLayoutGrid` 添加 pane 右键菜单
- [x] 修改 `TmuxWindowTabs` 命名格式与右击新建窗口
- [x] 修改 `WorkspaceContainer` 右键 underlay window tab 添加 "New Tmux Window" 菜单项
- [x] `npm run build` 通过
- [x] 更新 `useSessionActions.ts`：创建 tmux session 时打开 underlay window，连接后自动创建 tmux windows
- [x] 修复 `onTmuxStateSync` 重复创建 tmux window 的问题
- [x] 修复 Rust 后端在创建 tmux session 时自动启动 poller 的问题（改为点击 Connect 后启动）
- [x] 更新 `useTauriListeners.ts`：处理连接错误、状态同步、session 关闭
- [x] `npm run build` 通过
- [x] `cargo check` 通过
- [x] `cargo test` 通过（57 个测试）
- [x] 类型检查无 `as any` / `@ts-ignore`

### Errors Encountered
| Error | Attempt | Resolution |
|-------|---------|------------|
