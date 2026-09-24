# Service · Persistence — 对外接口

> **位置**：`src/service/persistence/api.ts`
> **唯一进口**：`import { usePersistenceService, type PersistenceService } from "@/service/persistence/api"`

## 1. 接口

```typescript
export interface PersistenceService {
  // ============ 单 key 读写 ============
  get<T>(key: string): Promise<T | null>;
  set<T>(key: string, value: T): Promise<void>;
  delete(key: string): Promise<void>;
  has(key: string): Promise<boolean>;

  // ============ 批量 ============
  getMany<T>(keys: ReadonlyArray<string>): Promise<Record<string, T | null>>;
  setMany(entries: Record<string, unknown>): Promise<void>;

  // ============ 同步（不常用） ============
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
```

## 2. 关键设计

**schema versioning 是隐式的**：

- store 文件结构自带 version 字段
- migration 知道"从 v1 到 v2 怎么转"
- 启动时按顺序执行所有 migration

**`getMany` / `setMany` 用于批量**：

- 启动加载时一次拿多个 key
- save 时一次写多个 key（减少 IO）

**不强类型 store key**：

- key 是 string（tauri-plugin-store 的限制）
- 调用方通过 `<T>` 标注值的类型

## 3. 不对外暴露

- Store 句柄缓存（内部 lazy load + cache）
- 错误 fallback 策略细节

## 4. 接缝契约

```
// app/settings/usecases/load.ts
import { usePersistenceService } from "@/service/persistence/api";

const persistence = usePersistenceService();
const settingsJson = await persistence.get<Settings>("settings");
```

```
// app/shell/usecases/initialize.ts（启动时）
const persistence = usePersistenceService();

persistence.registerMigration({
  fromVersion: 1,
  toVersion: 2,
  storeKey: "settings",
  migrate: (v1) => ({ ...v1, terminalFontSize: 14 }),  // 加默认字段
});

await persistence.runMigrations();
```

## 5. api.ts 变更流程

1. **新增 migration** → 加 Migration 对象 + 调 registerMigration
2. **修改方法签名** → 同步更新 §1
