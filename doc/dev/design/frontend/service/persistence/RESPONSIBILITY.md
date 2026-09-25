# Service · Persistence — 职责

> **位置**：`src/service/persistence/`
> **类型**：⭐ 横切 domain（**frontend-only 持久化主入口**——v4 起承担 saved sessions/groups/settings 直存）
> **被订阅方**：app/settings、app/workspace、app/session、ui/settings

## 1. 这个 domain 负责什么

persistence service 是 **frontend 直存 `tauri-plugin-store` 的 wrapper**——v4 起承担所有 frontend-only 配置持久化。

承担 4 类职责：

1. **frontend-only store 直存**——`sessions.json` / `groups.json` / `settings.json` / 其他自定义 store
2. **Store 句柄管理**——lazy 加载、缓存、句柄复用
3. **CRUD 包装**——`get(key) / set(key, value) / delete(key) / list(prefix)`
4. **schema migration**——store 文件版本升级时迁移老数据

**v4 关键变化**：v3 时期 frontend persistence 调 backend IPC（`save_sessions` / `load_sessions` / `save_groups` / `load_groups`）——v4 砍掉，**frontend 直接调 `infra/store`（`@tauri-apps/plugin-store`）**。backend 只持久化 backend-only 状态（attached_tmux + log_config）。

## 2. 这个 domain **不**负责什么

- **不调 backend IPC**——frontend 直存不走 IPC
- **不存 backend-only 状态**（attached_tmux / log_config）——backend 自己持久化
- **不解析具体业务数据格式**——只搬运 JSON value；业务 schema 由各自的 service（session / workspace / settings）管理
- **不渲染 UI**——持久化设置归 settings module

## 3. 子结构

```typescript
service/persistence/
├── api.ts                ⭐ usePersistenceService hook（frontend-only 入口）
├── store.ts              Store 句柄缓存（key → Store 实例）
├── migrations.ts         schema migration 函数注册表
├── types.ts              MigrationContext / StoreKey
├── sessions.ts           ⭐ v4: saved session configs 直存入口（sessions.json）
├── groups.ts             ⭐ v4: saved group store 直存入口（groups.json）
└── *.test.ts
```

**v4 新增子文件**：

- `sessions.ts` —— saved session configs 直存入口（之前归 backend）
- `groups.ts` —— saved group store 直存入口（之前归 backend）

## 4. 用户故事

- **作为开发者**，我希望写一个 saved config 不关心 IO → `persistence.sessions.save(config)` 或 `persistence.set("savedConfigs", [...])`
- **作为开发者**，我希望 store 升级时自动迁移 → migration 注册表启动时执行
- **作为开发者**，我希望 store 损坏时 fallback 默认值 → 错误捕获 + 返回 default
- **作为开发者**，我希望 sessions/groups 持久化不走 IPC → 直接调 `infra/store`

## 5. 跟其他 domain 的关系

| domain | 关系 |
|---|---|
| `infra/store` | persistence **直接**调 `infra/store`（`@tauri-apps/plugin-store`）——frontend 直存通道 |
| 任何业务 service | 不直接调——业务 service（session / workspace / settings）通过自己的 store + persistence 编排 |

**关键**：persistence 是**frontend-only 底层原语**，不调 backend IPC。

| 调用方 | 怎么用 |
|---|---|
| `app/settings` | `usePersistenceService().get("settings")` / `.set("settings", value)` |
| `app/session` | `usePersistenceService().sessions.save(config)` / `.sessions.load()` |
| `app/workspace` | `usePersistenceService().groups.save(store)` / `.groups.load()` |
| `ui/settings` | 通过 `app/settings/api.ts` 间接调 persistence |

## 6. 跟 app/ui 的关系

- app 调 persistence 不经过 useCase 编排——直接调 service（因为 persistence 是底层原语，没有业务规则）
- ui **不**直接调 persistence——所有持久化操作由 app 编排

## 7. v4 直存的 store 文件清单

| store 文件 | 内容 | 直存代码 |
|---|---|---|
| `sessions.json` | saved session configs | `service/persistence/sessions.ts::save` |
| `groups.json` | saved group store | `service/persistence/groups.ts::save` |
| `settings.json` | settings 全字段 | `service/persistence/api.ts::set("settings", value)` |
| 其他自定义 store | 业务自定义 | `service/persistence/api.ts::set(file, value)` |

## 8. 这个 domain 的"产品语言"术语

- **store** — tauri-plugin-store 的一个文件（如 `sessions.json` `groups.json` `settings.json`）
- **store key** — 文件内的字段名
- **migration** — schema 升级时的数据转换函数
- **frontend 直存** — 不经 backend IPC，直接 TS 写文件
