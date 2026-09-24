# Module · Session — 对下依赖接口

> **位置**：`src/ui/modules/session/`
> session 是核心 module，但作为 UI 层，它仍然依赖 service / model / infra 共享层。

## 1. 依赖图

```
modules/session/
├── api.ts    ────►  shared/types            (SessionConfig 等基础类型)
├── view/    ────►  shell/api.ts            (<Dialog> <FormField> <Button>)
├── view/    ────►  shell/api.ts            (useAppShell() 编排 dialog)
├── store.ts ────►  service/session/store   (跨 module 状态)
├── store.ts ────►  service/persistence     (saved configs CRUD)
├── store.ts ────►  service/settings        (默认 shell / 默认 ssh 用户)
└── model.ts ────►  shared/types
```

**禁止**：

- ❌ `modules/session/` → `modules/workspace/`（session 不感知 workspace 业务）
- ❌ `modules/session/` → `modules/terminal/`（session 不感知终端渲染）
- ❌ `modules/session/` → `modules/settings/`（settings 通过 service/settings 间接访问，不直接 import）
- ❌ `modules/session/` → `infra/`（任何路径）
- ❌ `modules/session/` → `app/`（UI 层不调 useCase）

## 2. shared/ 层

| 调用 | 来源 | 何时调 |
|---|---|---|
| `Session` / `SessionConfig` 类型 | `shared/types/session` | model.ts / store schema |
| `PersistedSessionConfig` 类型 | `shared/types/persistence` | model.ts |
| xterm 输出缓冲 | `service/output/buffer` | session 创建时分配 buffer |
| session-output 事件订阅 | `service/output/channel` | store.ts |

**关键**：session module **不**直接 import terminal module 的任何东西。session 是核心数据实体，terminal 是它的消费者。

## 3. service/ 层

| 调用 | 来源 | 何时调 |
|---|---|---|
| `useSessionStore()` 订阅 | `service/session/store` | 组件渲染 |
| session store mutation（间接通过 hook） | `service/session/store` | `useSessionApi().closeSession` 等 |
| 持久化 saved configs | `service/persistence` | `saveConfig` / `deleteSavedConfig` |
| 默认 shell / 默认 ssh 用户 | `service/settings` | dialog 打开时初始化表单 |
| IPC invoke 转发 | `service/infra` | 内部（service 层包装 `@tauri-apps/api`） |

**约束**：session module **不**直跳 `service/infra`——必须经过 `service/session/*` 适配器。这是 service 层的封装职责。

## 4. shell module（间接）

session 的 dialog 由 shell 编排，但 dialog 组件内部用 shell 提供的原子：

| 调用 | 来源 | 何时调 |
|---|---|---|
| `<Dialog>` | `shell/api.ts` | dialog 壳 |
| `<FormField>` `<Button>` `<Tooltip>` | `shell/api.ts` | 表单内部 |
| `useAppShell().closeDialog` | `shell/api.ts` | 表单提交完成后关 dialog |

## 5. 设计意图：session 为什么是独立 module

v3 设计把 session 操作散落在 useCases（createLocalSession / openSavedSession 等）。新设计把 session 提成独立 module，理由：

- **session 是核心数据实体**——xsterm 是"session 容器"，session 比 workspace 更基础
- **session 的所有 CRUD 在一起更内聚**——create/edit/close/open 都共享 store 和类型
- **session 模块可以独立演进**——比如未来加"session recording"、"session sharing"，都在 module 内
- **其他 module 都能调 session**——terminal / workspace / shell 都依赖 session，session 是最稳定的下游

## 6. 设计意图：dialog 归 session module

v3 设计 dialog 跨 4 个域散落（dialogs/ 31 文件）。新设计 dialog 归各自 feature module：

- `<CreateSessionDialog>` 归 `session` module（session 创建的 UI 表现）
- `<EditSessionDialog>` 归 `session`
- `<SelectSavedDialog>` 归 `session`
- `<SettingsDrawer>` 归 `settings`
- 未来 `<CreateGroupDialog>` 归 `workspace`（group 是 workspace 业务）

shell 提供 `<Dialog>` 壳组件和 dialog 编排状态（`useAppShell().openDialog`），但不持有任何业务 dialog 的实现。

## 7. 当前架构债 → 设计意图说明

| 旧 v3 现状 | 新设计意图 |
|---|---|
| dialogs/ 跨 4 域 31 文件 | 每个 dialog 归各自 feature module |
| CreateSessionDialog 在 useCases/ | CreateSessionDialog 归 session module 的 view/ |
| session 操作跨多个 hook（createLocal / createSsh / createTmux） | `useSessionApi()` 一个 hook 暴露所有 CRUD |
| session store 用 `useSessionStore.getState()` | 通过 `useSessionApi()` 暴露 |
| tmux session 是独立 module | tmux session 是 session kind 之一，归 session module |

## 8. 不允许的依赖

- ❌ `modules/session/` → `modules/workspace/` 或 `modules/terminal/`
- ❌ `modules/session/view/CreateSessionDialog` 被其他 module 直接 import 渲染（必须通过 shell dialog 编排）
- ❌ `modules/session/` → `infra/` 任何路径
- ❌ `modules/session/` → `app/`（UI 层）

## 9. 依赖变更流程

1. **service/session 接口变化**——同步更新 §3 + INTERFACE.md §3 useSessionApi
2. **service/persistence 接口变化**——影响 saved configs 持久化，更新 §3
3. **service/settings 新增默认配置**——影响 dialog 初始化表单，更新 §3
4. **shell 新增 UI 原子**——dialog 内部可能用到，更新 §4
5. **shared/types 新增 session 字段**——同步更新 INTERFACE.md §4
