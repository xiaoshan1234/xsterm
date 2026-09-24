# Frontend · App 层（v4 从零设计）

> **v4 设计**（2026-09）：5 个 feature module + shared/ 4 子目录。
> **跟 UI v4 的关系**：5 个 app module 跟 5 个 UI module 一一对应。
> **跟 v3 的根本区别**：从"43 useCases 平铺"改成"5 module × usecases/ 子目录"。

## 1. 一句话架构

**app = 5 个 feature module + 4 个 shared 子目录**

```
src/app/
├── modules/
│   ├── shell/         app 启动序列编排（initialize / shutdown）
│   ├── workspace/     主视图业务（workspace + window + pane + group）
│   ├── terminal/      终端特有业务（tmux + terminal preferences）
│   ├── session/       session 全生命周期业务
│   └── settings/      设置持久化 + 跨 module 应用
│
└── shared/            跨 module 共享基础设施
    ├── infra/         IPC 适配（唯一允许直跳 @tauri-apps/api）
    ├── service/       跨 module 状态容器 + IPC 桥
    ├── model/         纯数据类型 + 派生
    └── rules/         纯函数（跨 module 算法）
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

**严禁**：

- ❌ 任何 module → `app/shell/usecases/*`（shell 只在启动/关闭被调）
- ❌ 任何 module → `infra/` 直接（必须经过 shared/infra）
- ❌ `settings` → `session`（避免循环：settings 改 session 默认值，session 读默认值——通过 shared/service 中介）

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

## 6. shared/ 4 个子目录

详见 [shared/README.md](./shared/README.md)。

速查：

| 子目录 | 职责 | 谁能 import |
|---|---|---|
| `shared/infra` | IPC 适配（唯一允许 `@tauri-apps/api`） | service / module |
| `shared/service` | 跨 module 状态容器 + IPC 桥 | module |
| `shared/model` | 纯数据类型 + 派生 | 任何 |
| `shared/rules` | 纯函数（跨 module 算法） | 任何 |

**shared 内部依赖方向**：`infra → service → model → rules`（单向）。

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
1. shared/infra.invoke('create_local_session', config)  → backend 启动 PTY
2. shared/service/session/store 写入新 session
3. 如果 shouldSave: shared/service/persistence 写入 saved config
    ↓
4. app/session/usecases/openInWorkspace.ts
   → useWorkspaceApi().openSession(sessionId, configId, workspaceId)
    ↓
5. app/workspace/usecases/openSession.ts
   → 如果 tmux: useTerminalApi().attachTmuxSession(sessionId)
   → shared/service/workspace/store 更新 pane 树
    ↓
ui/workspace: workspace store 变化 → React re-render → pane 显示 terminal
```

### 8.2 用户改 font size

```
ui/settings: TerminalTab onChange({ terminalFontSize: 14 })
    ↓
useSettingsApi().applyTerminalPreferences({ fontSize: 14 })
    ↓
app/settings/usecases/apply/terminalPrefs.ts
    ↓
useTerminalApi().applyTerminalPreferences({ fontSize: 14 })
    ↓
app/terminal/usecases/preferences/apply.ts
    ↓
shared/service/terminal/store.applyPreferences(...)   ← 单一数据源
    ↓
ui/terminal: 通过 props 接收新 fontSize（不直接订阅 store）
ui/workspace: 重新渲染，传新 props 给 <TerminalApp>
```

### 8.3 启动 app

```
ui/shell/App.tsx → main.tsx 调 useShellApi().initialize()
    ↓
app/shell/usecases/initialize.ts 按顺序：
    ↓
1. shared/service/persistence.checkBackendReady()
2. app/settings.load() → applyTheme / applyLogLevel / applyTerminalPreferences / applySidebarConfig
3. app/workspace.loadLastWorkspace()
4. app/terminal.autoAttachTmuxServers()
5. readiness.setReady(true)
    ↓
ui/shell: isReady() = true → 渲染主界面
```

## 9. 跟 v3 的核心差异

| 维度 | v3 | v4 |
|---|---|---|
| 划分依据 | 43 useCases 平铺 | 5 module 按产品功能 |
| module 内部组织 | 自由 | 强制 api.ts 唯一入口 |
| 跨 module 协调 | useCase 内部串 | 集中在 usecases/composition/ |
| 跨 module 调用入口 | 自由 import useCases | 只 import api.ts |
| shared 子目录 | service/ 平铺 | shared/{infra, service, model, rules} 4 个 |
| 启动序列 | 散落在 main.tsx | app/shell 的 initialize() 编排 |
| UI module 跟 app module 关系 | 隐式 | 一一对应 |

## 10. 设计系统约束

所有 UI 改动必读 [`../../../design-system.md`](../../../design-system.md)。

三层校验 grep（pre-commit 必跑）：

```bash
grep -rn -E "(--bg-primary|--bg-secondary|--bg-tertiary|--text-primary|--text-secondary|--text-muted|--border-color|#0e639c|#1177bb|linear-gradient)" src/ --include="*.ts" --include="*.tsx" --include="*.css"
grep -rn "font-weight: ?(600|700|bold)" src/ --include="*.ts" --include="*.tsx" --include="*.css"
grep -rn "box-shadow:" src/components/ --include="*.css"
```

违反任何一条不允许 merge。
