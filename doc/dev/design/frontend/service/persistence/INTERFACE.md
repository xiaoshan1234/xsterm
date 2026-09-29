# Service · Persistence — 对外接口

> **位置**：`src/service/persistence/api.ts`
> **唯一进口**：`import { usePersistenceService, type PersistenceService } from "@/service/persistence/api"`

## 1. 接口

```typescript
export interface PersistenceService {
  // ============ 单 key 读写（用于 sessions/groups/theme 直存） ============
  get<T>(key: string): Promise<T | null>;
  set<T>(key: string, value: T): Promise<void>;
  delete(key: string): Promise<void>;
  has(key: string): Promise<boolean>;
  getMany<T>(keys: ReadonlyArray<string>): Promise<Record<string, T | null>>;
  setMany(entries: Record<string, unknown>): Promise<void>;

  /** 阻塞等待当前所有写完成 */
  flush(): Promise<void>;

  /** 注册 schema migration（启动时调） */
  registerMigration(migration: Migration): void;
  /** 执行所有 migration（启动时调一次） */
  runMigrations(): Promise<void>;

  // ============ v5.1 新增:config 子模块（settings 走 backend config.toml）============
  /**
   * settings 改写的唯一通道 —— backend config.toml 直连 IPC，不走 Repository 抽象
   * 详见 doc/dev/design/backend/infra/config_watcher/RESPONSIBILITY.md
   */
  config: {
    /** 读当前 AppConfig（backend state 持有；启动期 + 任意时刻调用） */
    read(): Promise<AppConfig>;
    /** 部分改写 AppConfig —— backend merge + validate + atomic write + emit config-reloaded */
    write(partial: PartialAppConfig): Promise<AppConfig>;
    /** 监听 config-reloaded 事件；返回 unsubscribe */
    onReloaded(cb: (config: AppConfig) => void): () => void;
  };
}

export interface Migration {
  fromVersion: number;
  toVersion: number;
  storeKey: string;
  migrate: (oldValue: unknown) => unknown;
}

export interface AppConfig {
  keybindings: KeybindingsConfig;
  theme: ThemeConfig;
  log: LogConfig;
  terminal: TerminalPreferences;
  sidebar: SidebarConfig;
  // ... 详见 doc/pdm/prd.md §2 M9
}

export type PartialAppConfig = Partial<AppConfig>;
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
// app/settings/usecases/load.ts —— v5.1:settings 走 config 子模块
import { usePersistenceService } from "@/service/persistence/api";

const persistence = usePersistenceService();
const config = await persistence.config.read();
// ↑ 不再调 persistence.get<Settings>("settings"); 旧 settings.json 已砍
```

```
// app/settings/usecases/updateSetting.ts —— v5.1:唯一改 settings 通道
import { usePersistenceService } from "@/service/persistence/api";

const persistence = usePersistenceService();
const newConfig = await persistence.config.write({
  keybindings: { ...current.keybindings, newKey: "ctrl+x" },
});
// ↑ backend merge + validate + atomic write + emit config-reloaded
//   不再调 persistence.set("settings", {...});旧 settings.json 直存已删
```

```
// app/settings/usecases/watchConfig.ts —— v5.1:监听 reload
import { usePersistenceService } from "@/service/persistence/api";

const persistence = usePersistenceService();
const off = persistence.config.onReloaded((newConfig) => {
  // 本地 store 同步
  settingsStore.setState(newConfig);
});

// 卸载时 off()
```

```
// app/shell/usecases/initialize.ts —— migration 现在只针对 sessions/groups/theme 直存文件
// settings migration 已砍 —— 改由 backend config_watcher/migration 承担 (RFC 0003)
const persistence = usePersistenceService();

persistence.registerMigration({
  fromVersion: 1,
  toVersion: 2,
  storeKey: "sessions",
  migrate: (v1) => ({ ...v1, sshAuthMethod: "key" }),  // sessions schema 升级
});

await persistence.runMigrations();
```

## 5. api.ts 变更流程

1. **新增 migration** → 加 Migration 对象 + 调 registerMigration
2. **修改方法签名** → 同步更新 §1
