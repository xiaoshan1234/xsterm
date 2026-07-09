# 前端代码审读发现

## 高优先级 Bug

### 1. Terminal.tsx 主题变化重建 xterm
- 文件：`src/components/Terminal.tsx`
- 问题：`useEffect` 依赖数组包含 `currentTheme`，主题切换导致 dispose + rebuild。
- 影响：焦点、滚动位置丢失；StrictMode 下更明显。

### 2. Terminal.tsx listen Promise 未处理 rejection
- 文件：`src/components/Terminal.tsx:234-260`
- 问题：`listen(...).then(...)` 无 `.catch()`。

### 3. SessionContext.tsx 监听竞态 + 未捕获 rejection
- 文件：`src/contexts/SessionContext.tsx:757-874`
- 问题：多个 `await listen(...)` 无 catch，unmount 时存在竞态。

### 4. loadWorkspace 部分失败不回滚
- 文件：`src/contexts/SessionContext.tsx:388-435`
- 问题：workspace 中某个 session 创建失败时，已创建 session 不关闭。

### 5. CommandSendPanel.tsx 闭包陷阱
- 文件：`src/components/CommandSendPanel.tsx:123-174`
- 问题：`runNext` 闭包捕获 `breakpoints`、`count`、`interval` 等，参数变化后定时器仍用旧值。

### 6. NavBar.tsx onResized 写法隐患
- 文件：`src/components/NavBar.tsx:28-30`
- 问题：`appWindow.onResized?.(...).then(...)` 在 `onResized` 为 undefined 时会抛 TypeError。

## 已修复 Bug

### 7. SSH 多 session 共用显示 buffer
- 文件：
  - `src/hooks/useTauriTerminalOutput.ts`
  - `src/components/Terminal.tsx`
  - `src/components/PaneTree.tsx`
- 现象：两个 SSH session 看上去共用同一个显示 buffer，新的 session 输出覆盖旧的 session 内容；输入仍然能正确路由到各自 session。
- 根因：
  1. `useTauriTerminalOutput` 在 `flushWrites` 和 cleanup 中读取 `termRef.current`，而该 ref 在 effect 重新运行后可能指向新的 xterm 实例，导致旧 session 的待写入数据被写入新 session 的终端。
  2. 当 pane 的 `sessionId` 变化时，xterm 实例被复用，旧 session 的输出仍残留在 buffer 中，新 session 输出与之混合。
  3. `PaneTree.tsx` 中的 `<Pane>` 没有 `key` 属性，React 在 pane 树变化时无法保证 terminal 实例的稳定身份。
- 修复：
  1. 在 `useTauriTerminalOutput` 的 effect 开始处捕获 `xterm = termRef.current`，后续 `flushWrites` 和 cleanup 都只写入该捕获的实例，并用 try/catch 处理 dispose 后的写异常。
  2. 在 `Terminal.tsx` 的 `sessionId` effect 中调用 `xterm.clear()`，确保新 session 开始时 buffer 被清空。
  3. 在 `PaneTree.tsx` 的 `<Pane>` 上添加 `key={node.id}`。
- 验证：
  - `npx tsc --noEmit`：通过
  - `npm run build`：通过

## 中低风险 Bug

- `SessionContext.tsx` 多处使用 stale `sessions` state 而非 `sessionsRef.current`。
- `closeSession` 抛出异常后 UI 不清理。
- settings store 未单例化。
- `Sidebar.tsx` / `PaneTree.tsx` 拖拽监听器 unmount 时可能泄漏。
- `ContextMenu.tsx` / `CommandSendPanel.tsx` 使用数组索引作为 key。

## 结构/行为发现

### 1. Workspace 实例现在显式维护 session 集合
- 运行时 `Workspace` 新增 `sessionIds: number[]`。
- `loadWorkspace` 从保存的 `configId` 重建会话后，把会话 ID 收集到 `workspace.sessionIds`。
- `closeWorkspace` 关闭 `workspace.sessionIds` 中的所有会话。
- 所有会改变 workspace 内 session 分布的 mutation 都会通过 `withRecomputedSessionIds` 重新计算该集合。

### 2. 保存的 workspace/window 配置不再包含 runtime sessionId
- `saveWorkspace`、`saveWindow`、`saveAllWindows` 调用 `stripSessionIdFromPaneTree` 后再持久化。
- `loadWorkspace`、`loadWindow` 的 `buildTree` 忽略已保存的 `sessionId`，只根据 `configId` 重建会话。

## 文件变更
- `src/types/session.ts` — `Workspace` 增加 `sessionIds`。
- `src/contexts/session/paneUtils.ts` — 新增 `collectSessionIdsFromPaneTree`、`collectSessionIdsFromWorkspace`、`withRecomputedSessionIds`、`stripSessionIdFromPaneTree`。
- `src/contexts/session/useSessionActions.ts` — 更新加载、保存、关闭、创建窗口等逻辑以维护 session 集合。
- `src/contexts/session/useTauriListeners.ts` — session 关闭/错误处理时重新计算 workspace 的 `sessionIds`。
- `src/hooks/useTauriTerminalOutput.ts` — 捕获 xterm 实例，避免跨 session 输出污染。
- `src/components/Terminal.tsx` — `sessionId` 变化时清空 xterm buffer。
- `src/components/PaneTree.tsx` — 为 `<Pane>` 添加 `key` 属性。

## 验证
- `npx tsc --noEmit` 通过。
- `npm run build` 通过（运行前需 `npm install` 以修复 `@rollup/rollup-linux-x64-gnu` 缺失）。
