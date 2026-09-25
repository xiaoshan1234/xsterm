# Module · Session — 对下依赖接口

> **位置**：`src/ui/modules/session/`
> session 是核心 module，但作为 UI 层，它仍然依赖 service / model / infra 共享层。

## 1. 依赖图

```
modules/session/
├── api.ts    ────►  model/session/types       (SessionConfig 等基础类型)
├── view/    ────►  shell/api.ts              (<Dialog> <FormField> <Button>)
├── view/    ────►  shell/api.ts              (useAppShell() 编排 dialog)
├── store.ts ────►  service/session/store     (跨 module 状态)
├── store.ts ────►  service/persistence       (saved configs CRUD)
├── store.ts ────►  service/settings          (默认 shell / 默认 ssh 用户)
└── model.ts ────►  model/session/types
```

**禁止**：

- ❌ `modules/session/` → `modules/workspace/`（session 不感知 workspace 业务）
- ❌ `modules/session/` → `modules/terminal/`（session 不感知终端渲染）
- ❌ `modules/session/` → `modules/settings/`（settings 通过 service/settings 间接访问，不直接 import）
- ❌ `modules/session/` → `infra/`（任何路径）
- ❌ `modules/session/` → `app/`（UI 层不调 useCase）

## 2. 平级层（infra / service / model）

| 调用 | 来源 | 何时调 |
|---|---|---|
| `Session` / `SessionConfig` 类型 | `model/session/types` | model.ts / store schema |
| `PersistedSessionConfig` 类型 | `model/session/types`（持久化结构内嵌 session） | model.ts |
| xterm 输出缓冲 | `ui/terminal/view/OutputBuffer` | session 创建时分配 buffer |

**关键**：session module **不**直接 import terminal module 的任何东西。session 是核心数据实体，terminal 是它的消费者。

## 3. service/ 层

| 调用 | 来源 | 何时调 |
|---|---|---|
| `useSessionService()` 订阅 | `service/session/api` | 组件渲染 |
| session store mutation（间接通过 hook） | `service/session/api` | `useSessionApi().closeSession` 等 |
| 持久化 saved configs | `service/persistence/api` | `saveConfig` / `deleteSavedConfig` |
| 默认 shell / 默认 ssh 用户 | `service/settings/api` | dialog 打开时初始化表单 |

**约束**：session module **不**直跳 `infra/tauri`——必须经过 `service/session/*` 适配器。这是 service 层的封装职责。

## 4. shell module（间接）

session 的 dialog 由 shell 编排，但 dialog 组件内部用 shell 提供的原子：

| 调用 | 来源 | 何时调 |
|---|---|---|
| `<Dialog>` | `shell/api.ts` | dialog 壳 |
| `<FormField>` `<Button>` `<Tooltip>` | `shell/api.ts` | 表单内部 |
| `useAppShell().closeDialog` | `shell/api.ts` | 表单提交完成后关 dialog |

## 5. 设计意图：session 为什么是独立 module

session 模块独立成 module 的理由：

- **session 是核心数据实体**——xsterm 是"session 容器"，session 比 workspace 更基础
- **session 的所有 CRUD 在一起更内聚**——create/edit/close/open 都共享 store 和类型
- **session 模块可以独立演进**——比如未来加"session recording"、"session sharing"，都在 module 内
- **其他 module 都能调 session**——terminal / workspace / shell 都依赖 session，session 是最稳定的下游

## 6. 设计意图：dialog 归 session module

dialog 归各自 feature module：

- `<CreateSessionDialog>` 归 `session` module（session 创建的 UI 表现）
- `<EditSessionDialog>` 归 `session`
- `<SelectSavedDialog>` 归 `session`
- `<SettingsDrawer>` 归 `settings`
- 未来 `<CreateGroupDialog>` 归 `workspace`（group 是 workspace 业务）

shell 提供 `<Dialog>` 壳组件和 dialog 编排状态（`useAppShell().openDialog`），但不持有任何业务 dialog 的实现。

## 7. 不允许的依赖

- ❌ `modules/session/` → `modules/workspace/` 或 `modules/terminal/`
- ❌ `modules/session/view/CreateSessionDialog` 被其他 module 直接 import 渲染（必须通过 shell dialog 编排）
- ❌ `modules/session/` → `infra/` 任何路径
- ❌ `modules/session/` → `app/`（UI 层）

## 8. 依赖变更流程

1. **service/session 接口变化**——同步更新 §3 + INTERFACE.md §3 useSessionApi
2. **service/persistence 接口变化**——影响 saved configs 持久化，更新 §3
3. **service/settings 新增默认配置**——影响 dialog 初始化表单，更新 §3
4. **shell 新增 UI 原子**——dialog 内部可能用到，更新 §4
5. **model/session 新增字段**——同步更新 INTERFACE.md §4