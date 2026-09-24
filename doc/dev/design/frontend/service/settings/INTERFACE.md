# Service · Settings — 对外接口

> **位置**：`src/service/settings/api.ts`
> **唯一进口**：`import { useSettingsService, type SettingsService } from "@/service/settings/api"`

## 1. 接口

```typescript
import type { Settings } from "@/model/settings/types";

export interface SettingsService {
  // ============ 读（命令式） ============
  get<K extends keyof Settings>(key: K): Settings[K];
  getAll(): Settings;

  // ============ 响应式订阅（粒度） ============
  /** 订阅单个 key——只在 key 变化时 re-render */
  useSetting<K extends keyof Settings>(key: K): Settings[K];
  /** 订阅整个 settings——任何字段变化都 re-render */
  useSettings(): Settings;

  // ============ 写 ============
  /** 改单个字段——自动 debounced 写盘 */
  set<K extends keyof Settings>(key: K, value: Settings[K]): void;
  /** 批量改字段 */
  setMany(patch: Partial<Settings>): void;
  /** 重置到默认 */
  reset(): Promise<void>;

  // ============ 生命周期 ============
  /** 启动时加载——从 persistence 读 + 触发订阅 */
  load(): Promise<void>;
  /** 手动 flush（关 app 前） */
  flush(): Promise<void>;
}

export function useSettingsService(): SettingsService;
```

## 2. 关键设计

**粒度订阅 vs 全量订阅**：

- `useSetting("terminalFontSize")` — 只有 fontSize 变化才 re-render
- `useSettings()` — 任何字段变化都 re-render（settings UI 用）

**debounced 写盘**：

- `set(key, value)` 立即改 store（UI 立即响应）
- 写盘是 debounced（500ms 后才实际调 persistence.set）
- 避免每次 keystroke 写盘

**`reset` 是异步**——需要重置 store + 清持久化：

```typescript
async reset(): Promise<void> {
  store.setState(defaults);
  await persistence.delete("settings");
}
```

## 3. 不对外暴露

- `sync.ts` 的 debounce 实现细节
- `defaults.ts` 的默认值

## 4. 接缝契约

```
// app/settings/usecases/load.ts
import { useSettingsService } from "@/service/settings/api";

const settings = useSettingsService();
await settings.load();
```

```
// ui/terminal/view/Terminal.tsx
const fontSize = useSettingsService().useSetting("terminalFontSize");
// 只在 fontSize 变化时 re-render
```

```
// app/terminal/usecases/preferences/apply.ts（settings 改 fontSize 时）
import { useSettingsService } from "@/service/settings/api";

const settings = useSettingsService();
const fontSize = settings.useSetting("terminalFontSize");  // 响应式
useTerminalService().applyPreferences({ fontSize });
```

## 5. api.ts 变更流程

1. **新增 field** → 加 model/settings + api.ts
2. **修改 field 类型** → 同步更新 §1
3. **新增响应式方法** → 加 zustand selector + api.ts
