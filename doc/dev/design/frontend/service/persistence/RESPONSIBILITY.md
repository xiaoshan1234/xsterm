# Service · Persistence — 职责

> **位置**：`src/service/persistence/`
> **类型**：横切 domain
> **被订阅方**：app/settings、app/workspace、app/session

## 1. 这个 domain 负责什么

persistence service 是**tauri-plugin-store 的 wrapper**——把 backend 的持久化能力封装成前端友好的 CRUD API。

承担 4 类职责：

1. **Store 句柄管理**——lazy 加载、缓存、句柄复用
2. **CRUD 包装**——`get(key) / set(key, value) / delete(key) / list(prefix)`
3. **schema migration**——store 文件版本升级时迁移老数据
4. **错误处理**——IO 错误、损坏文件、版本不匹配

## 2. 这个 domain **不**负责什么

- **不存具体业务数据**——不存 session config / workspace / settings——这些归各自的 service（session / workspace / settings）做高层抽象
- **不解析数据格式**——只搬运 JSON
- **不渲染 UI**——持久化设置归 settings module

## 3. 子结构

```
service/persistence/
├── api.ts                ⭐ usePersistenceService hook
├── store.ts              Store 句柄缓存（key → Store 实例）
├── migrations.ts         schema migration 函数注册表
├── types.ts              MigrationContext / StoreKey
└── *.test.ts
```

## 4. 用户故事

- **作为开发者**，我希望写一个 saved config 不关心 IO → persistence.set("savedConfigs", [...])
- **作为开发者**，我希望 store 升级时自动迁移 → migration 注册表启动时执行
- **作为开发者**，我希望 store 损坏时 fallback 默认值 → 错误捕获 + 返回 default

## 5. 跟其他 domain 的关系

| domain | 关系 |
|---|---|
| 任何 service | 不直接调——业务 service（session / workspace / settings）通过自己的 store + persistence 编排 |

**关键**：persistence 是**底层原语**，不是"应用层数据"。

| 调用方 | 怎么用 |
|---|---|
| app/settings | `usePersistenceService().get("settings")` / `.set("settings", value)` |
| app/workspace | `usePersistenceService().get("workspaces")` / `.set("workspaces", value)` |
| app/session | `usePersistenceService().get("savedConfigs")` / `.set("savedConfigs", value)` |

## 6. 跟 app/ui 的关系

- app 调 persistence 不经过 useCase 编排——直接调 service（因为 persistence 是底层原语，没有业务规则）
- ui **不**直接调 persistence——所有持久化操作由 app 编排

## 7. 这个 domain 的"产品语言"术语

- **store** — tauri-plugin-store 的一个文件（如 `settings.json` `workspaces.json`）
- **store key** — 文件内的字段名
- **migration** — schema 升级时的数据转换函数
