# Module · App Settings — 职责

> **位置**：`src/app/modules/settings/`
> **用户认知里的位置**：「设置业务」——UI 编排 + 跨 module 应用
> **依赖**：所有 module（settings 是横切关注点）
> **UI 对应**：[`ui/modules/settings/`](../../ui/settings/RESPONSIBILITY.md)
> **v5.1 改写**：所有 settings 持久化从 `service/persistence/settings.json` 直存改为 `invoke('write_config')` → backend `infra/config_watcher` 持 `config.toml`。详见 [`../../../backend/infra/config_watcher/RESPONSIBILITY.md`](../../../backend/infra/config_watcher/RESPONSIBILITY.md) + [`../service/persistence/RESPONSIBILITY.md §3`](../service/persistence/RESPONSIBILITY.md)。

## 1. 这个 module 负责什么

settings module 编排"应用配置"的业务：

1. **持久化（v5.1 改写）** —— UI 改 settings → 调 `usePersistenceService().config.write(partial)` → `invoke('write_config', ...)` → backend 写 `config.toml`；不再 frontend 直存 settings.json
2. **跨 module 应用** —— settings 字段变更后应用到具体的服务（theme / logger / terminal 等）
3. **跨 module 广播** —— 监听 backend `config-reloaded` 事件 → 通知所有订阅者
4. **schema 迁移（v5.1 改写）** —— backend `infra/config_watcher/migration.rs` 处理 RFC 0003；frontend 不参与

## 2. 这个 module **不**负责什么

- **不渲染 UI**——UI 由 `ui/settings/` 负责
- **不管理 session/workspace 状态**——settings 只影响默认值
- **不直存 settings.json** —— v4 设计已砍；所有 settings 走 backend IPC
- **不实现 schema migration** —— backend `infra/config_watcher/migration.rs` 处理；frontend 只读 backend 推送的 config

## 3. 子结构

```
modules/settings/
├── api.ts                            ⭐ 唯一对外入口
├── usecases/
│   ├── load.ts                       loadSettings（调 usePersistenceService().config.read）
│   ├── save.ts                       saveSettings（调 usePersistenceService().config.write）
│   ├── reset.ts                      resetSettings（write 一个空 partial 触发 backend 写默认 AppConfig）
│   ├── apply/
│   │   ├── theme.ts                  applyTheme (监听 config-reloaded → 触发 ui 重渲染)
│   │   ├── logLevel.ts               applyLogLevel → infra/logger
│   │   ├── terminalPrefs.ts          applyTerminalPreferences → app/terminal
│   │   └── sidebar.ts                applySidebarConfig → app/workspace
│   └── broadcast.ts                  config-reloaded 事件 → 通知订阅者
├── ipc.ts                            invoke('read_config' / 'write_config') + listen('config-reloaded')
├── model.ts                          module 专属类型（PartialAppConfig 等，如果有）
├── index.ts                          barrel：只 re-export api.ts
└── *.test.ts
```

**v5.1 改写对比**：
- ❌ ~~`migration.ts`（settings schema migration）~~ → 移到 backend `infra/config_watcher/migration.rs`
- ❌ ~~`ipc.ts` 调 `invoke('get_log_config', ...)`~~ → log_config 仍然归 backend `commands/shell/log_config` IPC；settings 不直调，settings.apply/logLevel.ts 调 `infra/logger`
- ➕ `broadcast.ts` 监听 backend `config-reloaded` 事件 → 通知订阅者

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
