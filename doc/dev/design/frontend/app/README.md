# Frontend · App 层（v4 从零设计）

> **位置**：`src/app/`
> **关注点**：业务编排（5 module 按产品功能切分）
> **平级于**：ui / model / service / infra（5 个顶层目录之一）

## 1. 一句话架构

**app = 5 个 feature module**

```
src/app/
├── modules/
│   ├── shell/         app 启动序列编排（initialize / shutdown）
│   ├── workspace/     主视图业务（workspace + window + pane + group）
│   ├── terminal/      终端特有业务（tmux + terminal preferences）
│   ├── session/       session 全生命周期业务
│   └── settings/      设置持久化 + 跨 module 应用
│
└── index.ts           barrel
```

## 2. 5 个 module 索引

每个 module 有 3 份文档：**职责 / 对外接口 / 对下依赖**

| module | 职责 | 对外接口 | 对下依赖 | 业务范围 |
|---|---|---|---|---|
| **shell** | [RESPONSIBILITY](./shell/RESPONSIBILITY.md) | [INTERFACE](./shell/INTERFACE.md) | [DOWNSTREAM](./shell/DOWNSTREAM.md) | 启动序列 + 关闭序列 |
| **workspace** | [RESPONSIBILITY](./workspace/RESPONSIBILITY.md) | [INTERFACE](./workspace/INTERFACE.md) | [DOWNSTREAM](./workspace/DOWNSTREAM.md) | workspace + window + pane + group CRUD |
| **terminal** | [RESPONSIBILITY](./terminal/RESPONSIBILITY.md) | [INTERFACE](./terminal/INTERFACE.md) | [DOWNSTREAM](./terminal/DOWNSTREAM.md) | tmux + terminal preferences |
| **session** | [RESPONSIBILITY](./session/RESPONSIBILITY.md) | [INTERFACE](./session/INTERFACE.md) | [DOWNSTREAM](./session/DOWNSTREAM.md) | session CRUD + display config |
| **settings** | [RESPONSIBILITY](./settings/RESPONSIBILITY.md) | [INTERFACE](./settings/INTERFACE.md) | [DOWNSTREAM](./settings/DOWNSTREAM.md) | 设置持久化 + 跨 module 应用 |

## 3. 5 个 module 的依赖图

```
              ┌──────────────────────────────────────────┐
              │  shell  (启动序列)                         │
              │  启动时按顺序调 settings → workspace →     │
              │  terminal → session                      │
              └──────┬─────────────┬──────────────┬──────┘
                     │             │              │
       ┌─────────────┘             │              └──────────────┐
       ▼                           ▼                             ▼
   workspace ───────► terminal ───────► session ◄────────── settings
   (主视图业务)        (tmux 业务)         (核心 module)         (横切配置)
                              │              │
                              └──────────────┘
                              session 跨 module 协调
```

**依赖规则**：

- `shell` → 任何 module（启动编排）
- `workspace` → `terminal`（tmux split）+ `session`（session 装到 pane）
- `terminal` → `session`（读 session 元数据）
- `session` → 任何（核心）
- `settings` → 任何（横切）

## 4. 5 个 module ↔ 5 个 UI module 对应表

| app module | UI module | 对应关系 |
|---|---|---|
| `app/shell` | `ui/shell` | shell.initialize() 完成后 UI 渲染 `<App>` |
| `app/workspace` | `ui/workspace` | workspace 编排业务，UI 渲染 sidebar + tab |
| `app/terminal` | `ui/terminal` | terminal 编排 tmux，UI 渲染 xterm + tmux control |
| `app/session` | `ui/session` | session 编排 CRUD，UI 渲染 dialog + list item |
| `app/settings` | `ui/settings` | settings 编排持久化 + 应用，UI 渲染 drawer |

**改一个产品功能 = 改 1 个 app module + 1 个 ui module**。

## 5. 每个 module 的内部约定

```
modules/<name>/
├── api.ts            ⭐ 唯一对外入口（其他 module 只能 import 这个）
├── usecases/         业务编排（每个 useCase 一个文件 + .test.ts）
│   ├── <domain>/     按子域分子目录（workspace/window/pane/group/...）
│   └── composition/  跨 module 协调的 useCase 集合
├── ipc.ts            module 专用的 IPC 命令封装（如有）
├── model.ts          module 专属类型（如果需要）
├── index.ts          barrel：只 re-export api.ts
└── *.test.ts
```

**强制规则**：

- `index.ts` 只 export `api.ts`
- 其他 module `import { X } from "@/app/modules/<name>/api"`
- **禁止** import `usecases/*` / `ipc.ts` / `model.ts` 内部文件
- 这条规则让 module 内部重构不影响其他 module

## 6. app 依赖的 4 个外部层

app module 依赖 4 个**平级**的基础设施层（不是下层）：

| 层 | 位置 | 用途 | 例子 |
|---|---|---|---|
| **model** | `@/model/<domain>/` | 读 types + 调 accessor + 调 rules | `import { Session } from "@/model/session/types"` |
| **service** | `@/service/<domain>/api` | 读写 store + 调 IPC 桥 | `import { useSessionService } from "@/service/session/api"` |
| **infra** | `@/infra/...` | （**禁止直跳**，必须经过 service） | — |
| **ui** | `@/ui/<module>/api` | （**禁止反向依赖**） | — |

**关键**：

- app 调 model / service 是**正常依赖**
- app 调 infra **禁止**——必须经过 service
- app 调 ui **禁止**——app 不感知 UI 存在
- ui 调 app 是通过 `useXxxApi()` hook（UI 通过 hook 调 app 的业务能力）

## 7. 跨 module 协调

5 个 module 之间有 4 类跨 module 协调：

| 协调类型 | 谁编排 | 通过哪个 api.ts |
|---|---|---|
| session 创建 → 装到 workspace | `app/session` | `app/session/api.ts` 的 `openInWorkspace` |
| workspace pane split → 需要新 session | `app/workspace` | `app/workspace/api.ts` 的 `splitPane` |
| settings 变更 → 应用到 terminal | `app/settings` | `app/settings/api.ts` 的 `applyTerminalPreferences` |
| 启动 → 加载 settings → 加载 workspace | `app/shell` | `app/shell/api.ts` 的 `initialize` |

**关键**：

- 跨 module 调用**只通过 api.ts**——不绕过 import 内部文件
- 跨 module 协调的 useCase 放在 module 内部的 `usecases/composition/` 子目录
- 任何 module 想"组合多个其他 module 的能力"，**自己**写 composition，不依赖第三方编排

## 8. 关键流程

### 8.1 用户新建 session → 装到 workspace

```
ui/session: 用户点"新建"，调 useSessionApi()
    ↓
app/session/usecases/createLocal.ts
    ↓
1. service/session/api.ts 的 createLocal()  → 触发 backend IPC
2. service/session/store 写入新 session
3. 如果 shouldSave: service/persistence 写入 saved config
    ↓
4. app/session/usecases/openInWorkspace.ts
   → useWorkspaceApi().openSession(sessionId, configId, workspaceId)
    ↓
5. app/workspace/usecases/openSession.ts
   → 如果 tmux: app/terminal/api.ts 的 attachTmuxSession()
   → service/workspace/store 更新 pane 树
    ↓
ui/workspace: workspace store 变化 → React re-render → pane 显示 terminal
```

### 8.2 启动 app

```
ui/shell/App.tsx → main.tsx 调 useShellApi().initialize()
    ↓
app/shell/usecases/initialize.ts 按顺序：
    ↓
1. service/infra.checkBackendReady()
2. app/settings.load() → applyTheme / applyLogLevel / applyTerminalPreferences / applySidebarConfig
3. app/workspace.loadLastWorkspace()
4. app/terminal.autoAttachTmuxServers()
5. readiness.setReady(true)
    ↓
ui/shell: isReady() = true → 渲染主界面
```

## 9. 关键设计决策

### 9.1 为什么 rules 归 model

rules 在 `model/<domain>/rules.ts`，**不**在 `app/rules/`：

- **paneTree 操作 PaneNode**——跟 PaneNode 类型同目录更内聚
- **sessionRules 操作 Session**——跟 Session 类型同目录更内聚
- **跨 domain 的纯函数**（textTransform、constants）放 `model/cross-cutting/`
- **app 只负责编排业务**，算法归 model

### 9.2 为什么 model / service / infra 是顶层目录

- model / service / infra 是**顶层目录**（跟 app / ui 平级）
- app 直接 `import { X } from "@/model/..."` 或 `"@/service/..."` 或 `"@/infra/..."`
- **没有** app 之下的基础设施子目录——基础设施层完全独立

### 9.3 为什么 app 跟 ui 平级

- app / ui 是**两个并列的产品功能层**
- 改一个产品功能 = 改 1 个 app module + 1 个 ui module
- ui 通过 `useXxxApi()` 调 app 的业务能力——这种"反向依赖"由 hook 边界控制
- app **不** import ui 内部组件；ui **不** import app 的 usecases/ipc/model 内部

## 10. 设计系统约束

所有 UI 改动必读 [`../../../design-system.md`](../../../design-system.md)。

三层校验 grep（pre-commit 必跑）：

```bash
grep -rn -E "(--bg-primary|--bg-secondary|--bg-tertiary|--text-primary|--text-secondary|--text-muted|--border-color|#0e639c|#1177bb|linear-gradient)" src/ --include="*.ts" --include="*.tsx" --include="*.css"
grep -rn "font-weight: ?(600|700|bold)" src/ --include="*.ts" --include="*.tsx" --include="*.css"
grep -rn "box-shadow:" src/components/ --include="*.css"
```

违反任何一条不允许 merge。
