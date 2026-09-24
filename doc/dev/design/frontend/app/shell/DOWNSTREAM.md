# Module · App Shell — 对下依赖接口

> **位置**：`src/app/modules/shell/`
> shell 是顶层 app module，依赖所有其他 module。

## 1. 依赖图

```
modules/shell/
├── usecases/initialize.ts ──►  app/settings/api.ts   (load + apply*)
├── usecases/initialize.ts ──►  app/workspace/api.ts  (loadLastWorkspace)
├── usecases/initialize.ts ──►  app/terminal/api.ts   (autoAttachTmuxServers)
├── usecases/shutdown.ts   ──►  app/terminal/api.ts   (saveAttachedTmuxServers)
├── usecases/shutdown.ts   ──►  app/workspace/api.ts  (saveCurrentWorkspace)
├── usecases/shutdown.ts   ──►  app/settings/api.ts   (save)
├── usecases/shutdown.ts   ──►  app/session/api.ts    (closeAll)
└── usecases/initialize.ts ──►  shared/service/persistence/api.ts
```

## 2. app/settings

| 调用 | 来源 | 何时调 |
|---|---|---|
| `useSettingsApi().load()` | `app/settings/api.ts` | 启动步骤 1 |
| `useSettingsApi().applyTheme(theme)` | `app/settings/api.ts` | 启动步骤 1 |
| `useSettingsApi().applyLogLevel(level)` | `app/settings/api.ts` | 启动步骤 1 |
| `useSettingsApi().applyTerminalPreferences(prefs)` | `app/settings/api.ts` | 启动步骤 1 |
| `useSettingsApi().applySidebarConfig(config)` | `app/settings/api.ts` | 启动步骤 1 |
| `useSettingsApi().save()` | `app/settings/api.ts` | 关闭步骤 3 |
| `useSettingsApi().reset()` | `app/settings/api.ts` | fallback 初始化 |

## 3. app/workspace

| 调用 | 来源 | 何时调 |
|---|---|---|
| `useWorkspaceApi().loadLastWorkspace()` | `app/workspace/api.ts` | 启动步骤 2 |
| `useWorkspaceApi().saveCurrentWorkspace()` | `app/workspace/api.ts` | 关闭步骤 2 |
| `useWorkspaceApi().createWorkspace("default")` | `app/workspace/api.ts` | fallback 初始化 |

## 4. app/terminal

| 调用 | 来源 | 何时调 |
|---|---|---|
| `useTerminalApi().autoAttachTmuxServers()` | `app/terminal/api.ts` | 启动步骤 3 |
| `useTerminalApi().saveAttachedTmuxServers()` | `app/terminal/api.ts` | 关闭步骤 1 |

## 5. app/session

| 调用 | 来源 | 何时调 |
|---|---|---|
| `useSessionApi().closeAll()` | `app/session/api.ts` | 关闭步骤 4 |

## 6. shared/service/

| 调用 | 来源 | 何时调 |
|---|---|---|
| `usePersistenceApi().checkBackendReady()` | `shared/service/persistence/api.ts` | 启动序列最开始 |
| `usePersistenceApi().notifyBackendShutdown()` | `shared/service/persistence/api.ts` | 关闭序列最后 |

## 7. 设计意图：shell 是唯一能直接调多个 module 的地方

v3 设计里任何 useCase 都可以调任意 service。v4 限制：

- **只有 shell module 在启动/关闭时直接调多个 module**
- **其他 module 不主动初始化**——等待 shell 编排

这条规则让"启动顺序"成为**显式契约**——shell.initialize() 是唯一入口。

## 8. 不允许的依赖

- ❌ `modules/shell/` → `infra/` 直接（通过 shared/service/persistence 间接）
- ❌ 其他 module 在启动时主动初始化（只能等 shell 编排）
- ❌ shell 持有 settings / workspace 状态（只触发 load）

## 9. 依赖变更流程

1. **新增启动步骤** → 加 usecases + 加 initialize() 实现 + 更新 §2-§5
2. **关闭步骤顺序变化** → 同步更新 §2-§5
3. **fallback 逻辑变化** → 同步更新 INTERFACE.md §3 fallbackInitialize
