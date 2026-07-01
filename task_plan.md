# 前端重构计划

## 目标
对 xsterm 前端代码进行结构化重构，修复已确认的 bug 和反模式，同时保持现有功能不变。优先修 bug，再拆分超大模块、提取复用逻辑。

## 当前风险
- `tmuxStateReducer.ts` 违反不可变性，会导致 tmux UI 状态更新异常。
- `Terminal.tsx` 主题变化会重建 xterm，丢失焦点/滚动位置。
- `SessionContext.tsx` 941 行，职责过重。
- `CommandSendPanel.tsx` 异步循环存在闭包陷阱。
- 多处监听器泄漏、类型断言、索引 key 等 bug。

## 阶段

### Phase 1 — 修复 tmux reducer 不可变性
- [ ] 修改 `src/contexts/tmuxStateReducer.ts`
- [ ] 所有 reducer 分支返回新的 session/window/pane 对象
- [ ] 更新后 `npm run build` 通过

### Phase 2 — 修复 Terminal.tsx 生命周期与 listener 问题
- [ ] 拆分主题热更新为独立 effect，避免重建 xterm
- [ ] 为 `listen()` Promise 添加 `.catch()`
- [ ] 确保 cleanup 能正确取消 pending listener
- [ ] 检查 ResizeObserver / setTimeout 清理

### Phase 3 — 修复 SessionContext.tsx 关键 bug
- [ ] 监听设置加 catch + 竞态处理
- [ ] `loadWorkspace` 失败时回滚已创建 session
- [ ] `renameSession` / `writeSession` / `resizeSession` 使用 `sessionsRef.current`
- [ ] `closeSession` 异常时仍清理 UI state
- [ ] settings store 单例化

### Phase 4 — 修复 CommandSendPanel.tsx 闭包陷阱
- [ ] 用 ref 保存所有可变执行参数
- [ ] 保证 timer 回调读取最新值
- [ ] 清理逻辑完善

### Phase 5 — 修复其余低风险 bug
- [ ] 删除 `TmuxLayoutGrid.tsx` 残留 `console.log`
- [ ] 修复 `NavBar.tsx` `onResized` 写法
- [ ] 修复 `Sidebar.tsx` / `PaneTree.tsx` 拖拽监听器泄漏
- [ ] 修复 `ContextMenu.tsx` / `CommandSendPanel.tsx` 索引 key
- [ ] 修复 `TmuxLayoutGrid.tsx` 非空断言 + parseInt radix
- [ ] 修复 `TmuxSessionForm.tsx` / `SessionContext.tsx` 类型断言

### Phase 6 — 代码结构优化（可选，视时间而定）
- [ ] 提取 `utils/paneTree.ts`（findPaneNode / replacePaneNode / 树遍历）
- [ ] 提取 `hooks/useDragResize.ts`
- [ ] 拆分 `SessionContext.tsx` 为更小的 store/effect 模块
- [ ] 拆分 `Terminal.tsx` 为 custom hooks

### Phase 7 — 验证
- [ ] `npm run build` 通过
- [ ] `npx tsc --noEmit` 通过
- [ ] 无新增 lint/type 错误
- [ ] 关键改动通过 diff review

## 决策记录
- 优先修 bug，不追求一次重构完美。
- 保持 React 19 + Tauri v2 + xterm.js 6 的现有技术栈。
- 不引入新运行时依赖。

## 错误记录
| 错误 | 尝试 | 解决方案 |
|------|------|----------|
| 待记录 | - | - |
