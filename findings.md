# 前端代码审读发现

## 高优先级 Bug

### 1. tmuxStateReducer.ts 违反不可变性
- 文件：`src/contexts/tmuxStateReducer.ts`
- 问题：`cloneTmuxState()` 只浅拷贝 Map，Map 内对象被直接修改。
- 影响：React 无法可靠检测状态变化，tmux UI 更新延迟/丢失。

### 2. Terminal.tsx 主题变化重建 xterm
- 文件：`src/components/Terminal.tsx`
- 问题：`useEffect` 依赖数组包含 `currentTheme`，主题切换导致 dispose + rebuild。
- 影响：焦点、滚动位置丢失；StrictMode 下更明显。

### 3. Terminal.tsx listen Promise 未处理 rejection
- 文件：`src/components/Terminal.tsx:234-260`
- 问题：`listen(...).then(...)` 无 `.catch()`。

### 4. SessionContext.tsx 监听竞态 + 未捕获 rejection
- 文件：`src/contexts/SessionContext.tsx:757-874`
- 问题：多个 `await listen(...)` 无 catch，unmount 时存在竞态。

### 5. loadWorkspace 部分失败不回滚
- 文件：`src/contexts/SessionContext.tsx:388-435`
- 问题：workspace 中某个 session 创建失败时，已创建 session 不关闭。

### 6. CommandSendPanel.tsx 闭包陷阱
- 文件：`src/components/CommandSendPanel.tsx:123-174`
- 问题：`runNext` 闭包捕获 `breakpoints`、`count`、`interval` 等，参数变化后定时器仍用旧值。

### 7. NavBar.tsx onResized 写法隐患
- 文件：`src/components/NavBar.tsx:28-30`
- 问题：`appWindow.onResized?.(...).then(...)` 在 `onResized` 为 undefined 时会抛 TypeError。

## 中低风险 Bug

- `SessionContext.tsx` 多处使用 stale `sessions` state 而非 `sessionsRef.current`。
- `closeSession` 抛出异常后 UI 不清理。
- settings store 未单例化。
- `Sidebar.tsx` / `PaneTree.tsx` 拖拽监听器 unmount 时可能泄漏。
- `ContextMenu.tsx` / `CommandSendPanel.tsx` 使用数组索引作为 key。
- `TmuxLayoutGrid.tsx` 残留 `console.log`、非空断言、`parseInt` 缺 radix。
- `TmuxSessionForm.tsx` / `SessionContext.tsx` 存在类型断言 `as`。

## 结构问题

- `SessionContext.tsx` 941 行，混合状态/业务逻辑/工具函数/Tauri 监听。
- `Terminal.tsx` 313 行，单个 effect 管理 xterm 全生命周期。
- 多处重复代码：`replacePaneNode`、`findPaneNode`、拖拽模板、SSH 默认值。
