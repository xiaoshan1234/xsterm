# Workspace Session Ownership — 进度日志

## 2026-07-07
- [x] 探索现有 workspace/session 类型与生命周期
- [x] 确定改造点：运行时 Workspace 增加 `sessionIds`、保存时剥离 `sessionId`、加载时重建 session、关闭 workspace 时关闭其 sessions
- [x] Phase 1 — 扩展类型与辅助函数
- [x] Phase 2 — 保存配置不保留 runtime sessionId
- [x] Phase 3 — Workspace 显式维护其 session 集合
- [x] Phase 4 — 构建验证 (`npm run build` 通过)
- [x] Debug — 修复 `createWindowFromSession`/`splitPane` 因 `sessionsRef` 未同步导致 `configId` 丢失
- [x] 新增 — 右键 pane 菜单增加 "Close Pane"，关闭 pane 同时关闭其 session
