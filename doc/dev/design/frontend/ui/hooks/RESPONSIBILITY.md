# Module · Hooks — 职责

> **位置（目标态）**：`src/ui/hooks/`
> **位置（现状）**：散落在 `src/ui/` 顶层（`useCommandExecutor.ts`、`useCommandTargets.ts`、`useSessionDragDrop.ts`）——改造 PR-1 收编到 `hooks/`。
> **L 层**：UI 内部支撑层（详见 [`../README.md` §5](../../README.md)）
> **主语**：view-level 编排 hook——给 layout / 业务视图用的"已组合好副作用"的 hook
> **唯一进口**：layout / terminal / sidebar

## 1. 这个 module 负责什么

把"业务 module 自己组合 useCase + store + React state 比较啰嗦"的副作用统一封装成可复用 hook。典型例子：

- **useCommandExecutor**：把"用户敲命令 → 查找匹配 target → 调对应 useCase"封装成一个 hook
- **useCommandTargets**：注册所有可被命令面板调起的"target"（如新建 session、关闭 window）
- **useSessionDragDrop**：把"鼠标拖拽 + reordering 状态 + onReorder 回调"封装

hooks module **只**提供 hook，**不**提供 UI 组件。

## 2. 为什么 hooks 单独成 module

- hooks 是**跨 module 共享的副作用封装**——terminal 用 useSessionDragDrop，sidebar 也用
- 放在 hooks/ 而非 model/ service/ app/ 是因为 hooks 是 React-aware（用 useState / useEffect），不能进 service 层
- 放在 ui/ 顶层某个文件里会污染 ui 的"组件树"结构——单独 hooks/ 目录明确边界

## 3. 这个 module **不**负责什么

- **不渲染 UI**——只提供 hook，不提供 .tsx 组件（除非是高度抽象的"headless component"）
- **不调 backend IPC**——hook 内部调 useCase，useCase 调 service，service 调 infra
- **不持有跨 module 全局状态**——hook 状态只在调用它的 component 内有效

## 4. 公开 hook 清单（目标态）

| Hook | 用途 | 调用方 |
|---|---|---|
| `useCommandExecutor` | 命令面板的执行逻辑 | layout |
| `useCommandTargets` | 注册命令面板可调用的 target | layout |
| `useSessionDragDrop` | session 拖拽排序 | sidebar / terminal |
| `useTerminalResize`（**新增**） | pane 边界拖拽 resize | terminal |
| `useSidebarResize`（**新增**） | 侧栏宽度拖拽 | sidebar |

## 5. 子目录组织（目标态）

```
ui/hooks/
├── useCommandExecutor.ts
├── useCommandTargets.ts
├── useSessionDragDrop.ts
├── useTerminalResize.ts        ← 新增（从 terminal/ 抽出）
├── useSidebarResize.ts         ← 新增（从 sidebar/ 抽出）
└── *.test.ts
```
