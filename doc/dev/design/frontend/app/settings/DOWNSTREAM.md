# Module · App Settings — 对下依赖接口

> **位置**：`src/app/modules/settings/`

## 1. 依赖图

```
modules/settings/
├── api.ts    ────►  app/terminal/api.ts       (applyTerminalPreferences)
├── api.ts    ────►  app/workspace/api.ts      (applySidebarConfig)
├── api.ts    ────►  app/session/api.ts        (applySessionDefaults — 间接)
├── usecases/ ────►  service/persistence         (load/save)
├── usecases/ ────►  service/settings            (订阅 settings 变更)
├── usecases/ ────►  infra/logger                (applyLogLevel — log 路由到 infra)
└── model.ts  ────►  model/settings/types
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

settings 模块**不直接**调 app/session——session 创建时通过 `service/settings/api` 订阅 settings 变更。

## 5. service/

| 调用 | 来源 | 何时调 |
|---|---|---|
| `usePersistenceService()` | `service/persistence/api` | load / save settings |
| `useSettingsService()` | `service/settings/api` | 订阅 settings 变更（其他 module 读） |
| `infra/logger.setLevel(level)` | `infra/logger/api` | applyLogLevel（logger 是 infra 原语，不归 service） |

**关键**：theme 是 settings 的子集——`applyTheme` 通过 `service/settings` 内部字段生效（写 store + 触发 ui 重渲染），**不**单独调外部 `service/theme`（该 domain 在 v4 已删除并入 settings）。

## 6. model/settings

| 调用 | 来源 |
|---|---|
| `Settings` / `SettingsCategory` / `LogLevel` | `model/settings/types` |
| `TerminalPreferences` | `model/settings/terminal/types` |

## 7. 设计意图：settings 不直接 import 其他 module 的 store

settings 通过**每个 module 的 apply 函数**间接应用，避免 settings 直接写其他 module 的 store：

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

## 8. 不允许的依赖

- ❌ `modules/settings/` → `app/terminal/usecases/*` 或 `app/workspace/usecases/*`（必须走 api.ts）
- ❌ `modules/settings/` → `service/<domain>/store` 的 setter（只能通过 api 函数）
- ❌ `modules/settings/` → `infra/` 任何路径除 `infra/logger`（logger 是横切原语）

## 9. 依赖变更流程

1. **新增 Settings 字段** → 加 `model/settings/types` + `usecases/apply` + `api.ts` 方法
2. **新增 apply 目标** → 加 `app/<target>/api.ts` 的 apply 函数 + 在 settings usecases/apply/ 注册
3. **schema 变化** → `migration.ts` + `model.ts`