# Infra · Store — 对外接口

> **位置**：`src/infra/store/api.ts`
> **唯一进口**：`import { useStore, type StoreKey, type StoreValue, type Migration } from "@/infra/store/api"`

## 1. 接口

```typescript
// infra/store/api.ts
export interface PersistenceStore {
  // ============ 单 key 读写 ============
  get<T>(key: string): Promise<T | null>;
  set<T>(key: string, value: T): Promise<void>;
  delete(key: string): Promise<void>;
  has(key: string): Promise<boolean>;

  // ============ 批量 ============
  getMany<T>(keys: ReadonlyArray<string>): Promise<Record<string, T | null>>;
  setMany(entries: Record<string, unknown>): Promise<void>;

  // ============ 同步 ============
  /** 阻塞等待当前所有写完成 */
  flush(): Promise<void>;

  // ============ Migration ============
  /** 注册 schema migration（启动时调） */
  registerMigration(migration: Migration): void;
  /** 执行所有 migration（启动时调一次） */
  runMigrations(): Promise<void>;
}

export interface Migration {
  fromVersion: number;
  toVersion: number;
  storeKey: string;
  migrate: (oldValue: unknown) => unknown;
}

export function useStore(filename?: string): PersistenceStore;
```

## 2. 关键设计

**`useStore(filename?)` 返回 PersistenceStore**：

- 同一个文件名返回同一个 store 实例（lazy load + cache）
- 不同文件名返回不同实例

```typescript
const settings = useStore("settings.json");
const workspace = useStore("workspaces.json");
```

**schema versioning 是隐式的**：

- store 文件结构自带 version 字段
- migration 知道"从 v1 到 v2 怎么转"
- 启动时按顺序执行所有 migration

**`getMany` / `setMany` 用于批量**：

- 启动加载时一次拿多个 key
- save 时一次写多个 key（减少 IO）

## 3. 不对外暴露

- Store 句柄缓存（内部 lazy load + cache）
- 错误 fallback 策略细节

## 4. 接缝契约

```
// service/persistence/api.ts
import { useStore } from "@/infra/store/api";

const persistence = useStore("settings.json");
const settings = await persistence.get<Settings>("settings");
```

```
// app/shell/usecases/initialize.ts（启动时）
const persistence = useStore();

persistence.registerMigration({
  fromVersion: 1,
  toVersion: 2,
  storeKey: "settings",
  migrate: (v1) => ({ ...v1, terminalFontSize: 14 }),
});

await persistence.runMigrations();
```

## 5. tauri-plugin-store 的封装

```typescript
// infra/store/store.ts
import { Store } from "@tauri-apps/plugin-store";

const stores = new Map<string, Store>();

async function loadStore(filename: string): Promise<Store> {
  if (!stores.has(filename)) {
    stores.set(filename, await Store.load(filename));
  }
  return stores.get(filename)!;
}

export function useStore(filename = "default.json"): PersistenceStore {
  // 构造 PersistenceStore 对象，惰性加载 store
  return {
    async get<T>(key: string): Promise<T | null> {
      const store = await loadStore(filename);
      return await store.get<T>(key);
    },
    async set<T>(key: string, value: T): Promise<void> {
      const store = await loadStore(filename);
      await store.set(key, value);
      await store.save();
    },
    // ...
  };
}
```

## 6. api.ts 变更流程

1. **新增 migration** → 加 Migration 对象 + 调 registerMigration
2. **修改方法签名** → 同步更新 §1
