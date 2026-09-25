# Module · App Settings — 职责

> **位置**：`src/app/modules/settings/`
> **用户认知里的位置**：「设置业务」——持久化 + 跨 module 应用
> **依赖**：所有 module（settings 是横切关注点）
> **UI 对应**：[`ui/modules/settings/`](../../ui/settings/RESPONSIBILITY.md)

## 1. 这个 module 负责什么

settings module 编排"应用配置"的业务：

1. **持久化**——load / save / reset settings 到 `service/persistence`
2. **跨 module 应用**——settings 字段变更后应用到具体的服务（theme / logger / terminal 等）
3. **跨 module 广播**——settings 变更通知所有订阅者
4. **schema 迁移**——settings store 版本升级时迁移老数据

## 2. 这个 module **不**负责什么

- **不渲染 UI**——UI 由 `ui/settings/` 负责
- **不管理 session/workspace 状态**——settings 只影响默认值
- **不实现 IPC 序列化**——settings 通过 `service/persistence` 间接调 IPC

## 3. 子结构

```
modules/settings/
├── api.ts                            ⭐ 唯一对外入口
├── usecases/
│   ├── load.ts                       loadSettings
│   ├── save.ts                       saveSettings
│   ├── reset.ts                      resetSettings
│   ├── apply/
│   │   ├── theme.ts                  applyTheme (写入 service/settings 的 theme 字段 + 触发 ui 重渲染)
│   │   ├── logLevel.ts               applyLogLevel → infra/logger
│   │   ├── terminalPrefs.ts          applyTerminalPreferences → app/terminal
│   │   └── sidebar.ts                applySidebarConfig → app/workspace
│   └── migration.ts                  settings schema migration
├── ipc.ts                            invoke('get_log_config', ...) 等
├── model.ts                          module 专属类型（如果有）
├── index.ts                          barrel：只 re-export api.ts
└── *.test.ts
```

## 4. 用户故事

- **作为用户**，我希望设置立即生效（不重启 app） → `apply/*` 编排
- **作为用户**，我希望设置被持久化，下次打开恢复 → `load.ts` + `save.ts`
- **作为用户**，我希望 settings 升级（schema 变化）时不丢数据 → `migration.ts`
- **作为用户**，我希望重置设置到默认值 → `reset.ts`

## 5. 跟其他 module 的关系

| module | 关系 |
|---|---|
| `app/shell` | shell.initialize() 调 settings.load() |
| `app/terminal` | settings.applyTerminalPreferences() 调 terminal 的 apply |
| `app/session` | session 创建时从 settings 读 defaultShell / defaultSshUser |
| `app/workspace` | settings.applySidebarConfig() 调 workspace 的 setSidebarConfig |
| `service/settings` | settings 读 `service/settings/api` 监听变化 |

**关键**：settings module **不**直接调其他 module 的内部 store。它通过**每个 module 的 apply 函数**间接应用——这样 module 可以决定如何响应 settings 变更。

## 6. 这个 module 的"产品语言"术语

- **settings** — 应用配置（5 个分类）
- **apply** — 把 settings 字段应用到具体服务的过程
- **broadcast** — settings 变更后所有订阅者收到通知
- **schema migration** — 持久化数据格式升级
