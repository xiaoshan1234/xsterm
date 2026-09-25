# Infra · Store — 职责

> **位置**：`src/infra/store/`
> **类型**：持久化底层（tauri-plugin-store wrapper）
> **被使用方**：`service/persistence`（通过 `infra/store` 调 tauri-plugin-store）

## 1. 这个子模块负责什么

infra/store 把 tauri-plugin-store 的 IO 操作包成 frontend-friendly API——store 文件加载、CRUD、错误处理、schema migration 都在这里。

承担 4 类职责：

1. **Store 句柄管理**——lazy 加载、缓存、句柄复用
2. **CRUD 包装**——`get<T>(key) / set<T>(key, value) / delete(key) / has(key)`
3. **schema migration**——store 文件版本升级时迁移老数据
4. **错误处理**——IO 错误、损坏文件、版本不匹配

## 2. 这个子模块 **不**负责什么

- **不存具体业务数据**——service 决定什么数据存哪个 key
- **不解析数据格式**——只搬运 JSON
- **不渲染 UI**——纯 IO 层
- **不直接被 ui 调用**——必须经过 service/persistence

## 3. 子结构

```
infra/store/
├── store.ts              Store.load(filename) + get/set/delete/has 包装
├── migrations.ts         schema migration 注册表 + helper
├── types.ts              StoreKey / StoreValue / Migration 类型
└── *.test.ts
```

## 4. 用户故事（基础设施视角）

- **作为开发者**，我希望快速加载 store → `await loadStore("settings.json")`
- **作为开发者**，我希望安全读 key → `await get<Settings>("settings")` 返回强类型或 null
- **作为开发者**，我希望 store 升级时自动迁移 → 注册 migration 启动时自动执行
- **作为开发者**，我希望 store 损坏时 fallback 默认值 → 错误捕获 + 返回 default

## 5. 跟其他 infra 子模块的关系

| 子模块 | 关系 |
|---|---|
| `infra/tauri` | 各自独立——store 是 tauri-plugin-store，tauri 是 IPC 适配 |
| `infra/clipboard` | 各自独立 |
| `infra/logger` | 各自独立（但 logger 用 store 调 forwarder） |

## 6. 跟 service / app / ui 的关系

| 层 | 怎么用 infra/store |
|---|---|
| `service/persistence` | `usePersistenceService().get<T>(key)` 等 |
| `app/*` | **禁止**——通过 service 间接调 |
| `ui/*` | **禁止**——通过 service 间接调 |

## 7. schema migration 设计

```typescript
// infra/store/types.ts
export interface Migration {
  fromVersion: number;
  toVersion: number;
  storeKey: string;
  migrate: (oldValue: unknown) => unknown;
}

// infra/store/migrations.ts
const migrations: Migration[] = [
  {
    fromVersion: 1,
    toVersion: 2,
    storeKey: "settings",
    migrate: (v1) => ({ ...v1, terminalFontSize: 14 }),  // v1 加默认值
  },
];

export async function runMigrations(store: Store, key: string): Promise<void> {
  // 检测当前 version，按顺序执行所有 migration
}
```

**关键**：migration 是**前向兼容**——老数据迁移到新结构。

## 8. 错误处理策略

| 错误 | 处理 |
|---|---|
| 文件不存在 | lazy 创建空 store |
| JSON 损坏 | log error + 返回默认值 |
| version 不匹配 | 自动执行 migration |
| IO 错误 | log error + 抛给调用方（service 决定 fallback） |

## 9. 子模块的"产品语言"术语

- **store** — tauri-plugin-store 的一个文件（如 `settings.json`）
- **store key** — 文件内的字段名
- **migration** — schema 升级时的数据转换
- **CRUD** — create / read / update / delete
