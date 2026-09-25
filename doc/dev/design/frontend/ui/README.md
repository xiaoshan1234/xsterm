# Frontend · UI 层（产品功能切分）

|> **设计日期**：2026-09。5 个 feature module + 1 个内部约定。
|> **位置**：`src/ui/`（与 `src/app/` `src/model/` `src/service/` `src/infra/` 平级——5 个顶层目录之一）。
|> **切分原则**：按"产品功能"切（shell / workspace / terminal / session / settings）。

> 本文档是设计文档，描述目标态架构。代码改造按本文档执行。

## 1. 一句话架构

**UI = 5 个 feature module + 1 个"内部约定"（api.ts 是 module 唯一对外入口）**

```
src/ui/modules/
├── shell/         app 的物理壳（标题栏 / 布局 / 初始化 / 跨 module UI 原子）
├── workspace/     app 主视图（工作区 + tab + 侧栏三栏）
├── terminal/      终端渲染（xterm + pane + tmux control）
├── session/       session 全生命周期（创建 / 编辑 / 选择 / 持久化）
└── settings/      应用设置（5 个 tab 的横切配置）
```

> **跟平级层的关系**：ui 跟 app/model/service/infra 是 frontend 的 5 个并列顶层目录。ui 通过 `useXxxApi()` 调 app 的业务能力，详见 [`../README.md`](../README.md) §3。

## 2. 5 个 module 索引

每个 module 有 3 份文档：**职责 / 对外接口 / 对下依赖**

| module | 职责 | 对外接口 | 对下依赖 | 产品功能 |
|---|---|---|---|---|
| **shell** | [RESPONSIBILITY](./shell/RESPONSIBILITY.md) | [INTERFACE](./shell/INTERFACE.md) | [DOWNSTREAM](./shell/DOWNSTREAM.md) | 标题栏 + 窗口控制 + 整体布局 + UI 原子 |
| **workspace** | [RESPONSIBILITY](./workspace/RESPONSIBILITY.md) | [INTERFACE](./workspace/INTERFACE.md) | [DOWNSTREAM](./workspace/DOWNSTREAM.md) | 工作区 + tab 切换 + 侧栏 |
| **terminal** | [RESPONSIBILITY](./terminal/RESPONSIBILITY.md) | [INTERFACE](./terminal/INTERFACE.md) | [DOWNSTREAM](./terminal/DOWNSTREAM.md) | 终端渲染 + 分屏 + tmux control |
| **session** | [RESPONSIBILITY](./session/RESPONSIBILITY.md) | [INTERFACE](./session/INTERFACE.md) | [DOWNSTREAM](./session/DOWNSTREAM.md) | session CRUD + display config |
| **settings** | [RESPONSIBILITY](./settings/RESPONSIBILITY.md) | [INTERFACE](./settings/INTERFACE.md) | [DOWNSTREAM](./settings/DOWNSTREAM.md) | 应用设置 5 个 tab |

## 3. 5 个 module 的依赖图

```
                  ┌──────────────────────────────────────┐
                  │  shell  (app 物理壳)                  │
                  │  → 任何 feature module                │
                  └────────┬─────────────────────────────┘
                           │
       ┌───────────────────┼────────────────────┐
       ▼                   ▼                    ▼
  workspace ───────►  terminal                 settings
  (主视图 + sidebar)   │                        │
       │               ▼                        │
       │            session ◄──────────────────┘
       │            (session 是核心，settings 改 session 默认值)
       │
       └──► session (侧栏展示 + 嵌入 session 的 dialog)
```

**依赖规则**：

- `shell` → 任何 feature module（顶层装配）
- `workspace` → `terminal` + `session`（侧栏展示 session，嵌入 terminal）
- `terminal` → `session`（渲染需要 session 数据）
- `session` → 任何（核心 module，但**不**强依赖任何 feature）
- `settings` → 任何（横切配置，通过 service/settings 广播）

**严禁**：

- ❌ `terminal` → `workspace`（terminal 不知道 workspace 的存在）
- ❌ `workspace` → `settings`（settings 通过 service 间接影响）
- ❌ `session` → `workspace` 或 `terminal`（session 是核心数据，不感知它的展示方式）
- ❌ 任何 module → `infra/` 除 shell 的窗口控制

## 4. 每个 module 的内部约定

每个 module 内部组织是**自由的**，但对外只有 1 个入口：

```
modules/<name>/
├── api.ts            ⭐ 唯一对外入口（其他 module 只能 import 这个）
├── view/             React 组件（仅本 module 内部用）
├── store.ts          本 module 状态（跨 module 状态进 service 层）
├── model.ts          类型 + 派生（如果需要）
├── index.ts          barrel：只 re-export from api.ts
└── *.test.ts
```

**强制规则**：

- `index.ts` 只 export `api.ts`，**不**直接 export view / store / model
- 其他 module `import { X } from "@/ui/modules/<name>/api"`，**禁止**直接 import `view/*` 或 `store.ts` 或 `model.ts`
- 这条规则让 module 内部重构（文件挪动 / 拆分）不影响其他 module

## 5. 为什么是 5 个 module（按"产品功能"切）

5 个 module 按产品功能切分：

| module | 范围 | 备注 |
|---|---|---|
| `shell` | app 物理壳 | 包含 UI 原子（原 ui-kit/ 的 primitives 部分） |
| `workspace` | 主视图（工作区 + tab + 侧栏） | sidebar 归入（不再独立） |
| `terminal` | 终端渲染（xterm + pane + tmux control） | tmux 并入（不再独立） |
| `session` | session 全生命周期 | **独立 module**——session 是核心数据实体 |
| `settings` | 应用设置 | 5 tab 抽屉（不再嵌套在 dialogs/ 下） |

**v4 设计的 4 个核心决策**：

1. **session 是独立 module**（不是 useCases）——xsterm 是"session 容器"，session 比 workspace 更基础
2. **dialog 归各自 feature module**（不是独立 ui-kit）——dialog 跟它的主人在一起，删一个功能就把它的 dialog 一起删掉
3. **primitives 归 shell**（不是独立 ui-kit）——primitives 是 shell 的实现细节，不是跨 module 产品功能
4. **没有公共 hooks module**——每个 module 自己声明需要的 hook（hooks 是实现细节，不是产品功能）

## 6. module 间的关键流程

### 6.1 用户点"+"新建 session

```
sidebar 的 + 按钮
    ↓
const shell = useAppShell();
shell.openDialog({ kind: "createSession", payload: { workspaceId } })
    ↓
shell 内部渲染 <CreateSessionDialog>（由 session module 提供）
    ↓
用户填写表单 + 提交
    ↓
session module 内部 useSessionApi().createLocal / createSsh / createTmux
    ↓
创建完成后调 onCreated(sessionId, configId)
    ↓
shell.closeDialog()
    ↓
const workspace = useWorkspaceApi();
workspace.openSession(sessionId, configId)  ← session 装到当前 window
```

**关键观察**：

- session 创建 UI 在 `session` module（不是 dialogs）
- 触发通过 `useAppShell()` 的 dialog 编排
- 创建后由 `workspace` 编排"装到哪个 window"
- 全程不直接调 store，全部通过 hook

### 6.2 用户改 font size

```
settings 的 TerminalTab onChange({ terminalFontSize: 14 })
    ↓
settings 模块内部 useSettingsApi().updateMany({ terminalFontSize: 14 })
    ↓
service/settings 更新 store
    ↓
service/settings 通知所有订阅者（通过 store change）
    ↓
workspace 的 <App> 重新渲染，传新 props 给 <TerminalApp>
    ↓
<TerminalApp> 接收到新 fontSize，<Terminal> 重新渲染
```

**关键观察**：

- terminal **不**自己订阅 settings（保持 props 单向数据流）
- settings **不**直接调 terminal（横切关注点通过 service 广播）
- workspace 是中间层，负责把 settings 传到 terminal

### 6.3 用户右键 session 重命名

```
侧栏 <SessionListItem> 右键
    ↓
session module 内的 ContextMenu 弹出"重命名"
    ↓
const shell = useAppShell();
shell.openDialog({ kind: "editSession", payload: { sessionId } })
    ↓
shell 渲染 <EditSessionDialog>（session module 提供）
    ↓
提交 → useSessionApi().editSession(...) → service 更新
    ↓
shell.closeDialog()
```

## 7. UI 5 module 决策

| 维度 | 决策 |
|---|---|
| 划分依据 | 产品功能（shell / workspace / terminal / session / settings） |
| dialog 归属 | 归各自 feature module |
| primitives 归属 | 归 `shell` module |
| hooks 归属 | 每个 module 自己声明 |
| tmux 归属 | 归 `terminal` module |
| sidebar 归属 | 归 `workspace` module |
| session 归属 | 独立 `session` module |
| settings 归属 | 独立 `settings` module |
| 每个 module 内部 | 强制 api.ts 唯一入口 |

## 8. 设计系统约束

所有 UI 改动必读 [`../../../../design-system.md`](../../../../design-system.md)。

三层校验 grep（pre-commit 必跑）：

```bash
grep -rn -E "(--bg-primary|--bg-secondary|--bg-tertiary|--text-primary|--text-secondary|--text-muted|--border-color|#0e639c|#1177bb|linear-gradient)" src/ --include="*.ts" --include="*.tsx" --include="*.css"
grep -rn "font-weight: ?(600|700|bold)" src/ --include="*.ts" --include="*.tsx" --include="*.css"
grep -rn "box-shadow:" src/components/ --include="*.css"
```

违反任何一条不允许 merge。
