# Module · Terminal — 对下依赖接口

> **位置**：`src/ui/modules/terminal/`
> 本文档列出 terminal module 调用了**哪些下层接口**。所有依赖必须经过下层的 `api.ts`，不能直接进下层内部。

## 1. 依赖图

```
modules/terminal/
├── api.ts ─────►  session/api.ts           (核心：terminal 强依赖 session 数据)
├── view/   ─────►  session/api.ts           (组件内读 session)
├── view/   ─────►  shell/api.ts             (拿 <Icon> <Button> 等 UI 原子)
├── view/   ─────►  shared/ui                (跨 module 共用的小工具：纯函数)
├── store.ts ─────►  session/api.ts          (订阅 session store 变化)
├── model.ts ─────►  shared/types            (PaneNode 等基础类型)
└── *.test.ts
```

**禁止**：

- ❌ `modules/terminal/` → `modules/workspace/`（terminal 不感知 workspace）
- ❌ `modules/terminal/` → `modules/settings/`（settings 通过 props 注入，不直接 import）
- ❌ `modules/terminal/` → `infra/`（除 xterm.js 本身）
- ❌ `modules/terminal/` → `app/`（terminal 是 UI 层，不调 useCase——useCase 在 workspace/session 模块调用）

## 2. session module

| 调用 | 来源 | 何时调 |
|---|---|---|
| `useSession(id)` hook | `session/api.ts` | 组件渲染时订阅 session 元数据 |
| `Session` 类型 | `session/api.ts` | model.ts 引用 |
| `SessionKind` 枚举（判断是否 tmux） | `session/api.ts` | `<App>` 决定挂 tmux 还是普通 view |
| session store 订阅 | `session/api.ts` 的 hook | `store.ts` 持有 xterm 实例时关联 sessionId |

**关键**：terminal **不**自己创建 session，只读。session 创建由 session module 的 `<CreateSessionDialog>` 完成。

## 3. shell module

| 调用 | 来源 | 何时调 |
|---|---|---|
| `<Icon>` | `shell/api.ts` | `<ResizeHandle>` 等内部组件的图标 |
| `<Button>` | `shell/api.ts` | tmux control 的命令按钮 |
| `<Tooltip>` | `shell/api.ts` | tmux control 提示 |

**为什么从 shell 来**：shell 是"app shell"，承担跨 module 共用 UI 原子的职责。**前提**是这些原子是**纯展示、无业务**的（Icon/Button/Tooltip）。

## 4. shared/ 层（service / model / infra）

| 调用 | 来源 | 何时调 |
|---|---|---|
| `PaneNode` 类型 | `shared/types` | model.ts |
| `SplitDirection` | `shared/types` | model.ts |
| `TerminalTheme` | `shared/types` | INTERFACE.md §4 已列 |
| session-output 事件订阅 | `service/output/channel` | `store.ts` 把 xterm 写入事件流 |
| `write(data)` to PTY | `service/output/write` | `store.ts` 把用户键盘输入写入 backend |

**约束**：service 层的读写都走 `service/output/*` 适配器，terminal 不直跳 `@tauri-apps/api`。

## 5. 第三方

- **xterm.js** — 唯一允许在 terminal module 出现的 UI 第三方库（terminal 是它的家）
- **xterm-addon-fit** — 自动调整 cols/rows
- **xterm-addon-web-links** — 链接识别

xterm 实例的生命周期归 terminal module 管理（不在 shared、不在 shell）。

## 6. 当前架构债 → 设计意图说明

旧 v3 设计里这些是"债"；**新设计直接消除它们**：

| 旧 v3 现状 | 新设计意图 |
|---|---|
| terminal 直跳 `service/output`（绕 useCase） | terminal 通过 `session/api.ts` 拿到事件订阅，session module 负责 useCase 编排 |
| terminal 直跳 infra（`@tauri-apps/api`） | 全部走 `service/output`，terminal 模块**不**知道 Tauri 的存在 |
| terminal 自己 useSettingsStore 读 font | settings 通过 props 注入；terminal 是被 settings 影响，不是 settings 的消费者 |
| tmux 独立成簇 | tmux 是 terminal 内部的 view/ 子模块 |
| `useTerminalResize` / `useSidebarResize` 抽到 hooks module | 每个 module 自己声明需要的 hook，不抽公共 hooks module |

## 7. 不允许的依赖

- ❌ `modules/terminal/` → `modules/workspace/` 或 `modules/settings/`
- ❌ `modules/terminal/` → `infra/`（除 xterm.js 本身）
- ❌ `modules/terminal/` → `app/`
- ❌ `modules/terminal/view/*` 被其他 module 直接 import（必须走 `api.ts`）

## 8. 依赖变更流程

1. **session module api.ts 变化**——同步更新 `INTERFACE.md` §2-§4 + `DOWNSTREAM.md` §2
2. **shell module 新增 UI 原子**——同步更新 `DOWNSTREAM.md` §3
3. **service/output 接口变化**——影响 `store.ts`，更新 §4
4. **第三方 xterm addon 升级**——更新 §5
