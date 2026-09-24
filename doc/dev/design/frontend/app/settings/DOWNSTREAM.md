# Module · App Settings — 对下依赖接口

> **位置**：`src/app/modules/settings/`

## 1. 依赖图

```
modules/settings/
├── api.ts    ────►  app/terminal/api.ts       (applyTerminalPreferences)
├── api.ts    ────►  app/workspace/api.ts      (applySidebarConfig)
├── api.ts    ────►  app/session/api.ts        (applySessionDefaults — 间接)
├── usecases/ ────►  shared/service/persistence  (load/save)
├── usecases/ ────►  shared/service/theme        (applyTheme)
├── usecases/ ────►  shared/service/logger       (applyLogLevel)
└── usecases/ ────►  shared/model/types
```

## 2. app/terminal

| 调用 | 来源 | 何时调 |
|---|---|---|
| `useTerminalApi().applyTerminalPreferences(prefs)` | `app/terminal/api.ts` | settings 改变 font / fontSize / theme |

## 3. app/workspace

| 调用 | 来源 | 何时调 |
|---|---|---|
| `useWorkspaceApi().setSidebarConfig(config)` | `app/workspace/api.ts` | settings 改 sidebar 宽度/可见性 |

## 4. app/session

settings 模块**不直接**调 app/session——session 创建时通过 `shared/service/settings/store` 订阅 settings 变更。

## 5. shared/service/

| 调用 | 来源 | 何时调 |
|---|---|---|
| `shared/service/persistence/store` | `shared/service/persistence` | load / save settings |
| `shared/service/theme/store` | `shared/service/theme` | applyTheme |
| `shared/service/logger` | `shared/service/logger` | applyLogLevel |
| `shared/service/settings/store` | `shared/service/settings` | 订阅 settings 变更（其他 module 读） |

## 6. shared/model/

| 调用 | 来源 |
|---|---|
| `Settings` / `SettingsCategory` / `LogLevel` | `shared/model/settings` |
| `TerminalPreferences` | `shared/model/terminal` |

## 7. 设计意图：settings 不直接 import 其他 module 的 store

v3 设计里 settings 直接 import `useTerminalStore.getState().setX(...)`。新设计 settings 通过**每个 module 的 apply 函数**间接应用：

```
settings 改 fontSize
    ↓
settings.applyTerminalPreferences({ fontSize: 14 })
    ↓
内部 useTerminalApi().applyTerminalPreferences(...)
    ↓
terminal 模块内部 useTerminalStore.getState().apply(...)
```

**好处**：

- settings 不知道 terminal store 的存在
- terminal 模块决定如何应用（可能加 debounce / batch / 验证）
- 测试时可以 mock terminal.apply 而不是 mock 整个 store

## 8. 当前架构债 → 设计意图说明

| 旧 v3 现状 | 新设计意图 |
|---|---|
| settings 散落在 5 个 tab，每个 tab 直跳 store | settings 是独立 module，5 个 tab 在 ui/settings/view/ |
| settings 改 fontSize 通过 store 全局广播 | settings 改 → apply → 目标 module 的 store |
| terminal 直跳 useSettingsStore 读 fontSize | terminal 通过 props 接收 fontSize，不订阅 settings |
| applyXxx 函数散落在 useCases | 每个 apply 是 settings 模块的 usecases/apply/ 子目录 |

## 9. 不允许的依赖

- ❌ `modules/settings/` → `app/terminal/usecases/*` 或 `app/workspace/usecases/*`（必须走 api.ts）
- ❌ `modules/settings/` → `shared/service/*/store` 的 setter（只能通过 api 函数）
- ❌ `modules/settings/` → `infra/` 任何路径

## 10. 依赖变更流程

1. **新增 Settings 字段** → 加 model 类型 + usecases/apply + api.ts 方法
2. **新增 apply 目标** → 加 shared/service/xxx + app/xxx 的 apply 函数
3. **schema 变化** → migration.ts + model.ts
