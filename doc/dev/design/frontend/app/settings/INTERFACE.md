# Module · App Settings — 对外接口

> **位置**：`src/app/modules/settings/api.ts`
> **唯一进口**：`import { ... } from "@/app/modules/settings/api"`

## 1. 对外暴露什么

1. **`SettingsApi` 接口** — 持久化 + 跨 module 应用

## 2. 核心接口

```typescript
import type { Settings, LogLevel, TerminalPreferences } from "@/model";

export interface SettingsApi {
  // ============ 持久化 ============
  load(): Promise<Settings>;
  save(): Promise<void>;
  reset(): Promise<void>;

  // ============ 跨 module 应用 ============
  /** 把 theme 应用到 UI（通过 shared/service/theme） */
  applyTheme(theme: "dark" | "light" | "auto"): void;
  /** 把 log level 应用到 logger service */
  applyLogLevel(level: LogLevel): void;
  /** 把 terminal 偏好应用到 app/terminal */
  applyTerminalPreferences(prefs: TerminalPreferences): void;
  /** 把 sidebar 配置应用到 app/workspace */
  applySidebarConfig(config: { width: number; visible: boolean }): void;

  // ============ 订阅 ============
  onSettingsChanged(callback: (settings: Settings) => void): () => void;   // 返回 unsubscribe
  useSettings(): Settings;
}

export function useSettingsApi(): SettingsApi;
```

## 3. 跨 module 调用的具体实现

settings 的"apply"函数是它跟其他 module 的桥梁——每个 apply 函数调对应 module 的 api.ts。

```typescript
// modules/settings/usecases/apply/terminalPrefs.ts
import { useTerminalApi } from "@/app/modules/terminal/api";  // ✅ 跨 module 调 api.ts
import { useWorkspaceApi } from "@/app/modules/workspace/api";

export function applyTerminalPreferences(prefs: TerminalPreferences): void {
  const terminal = useTerminalApi();
  terminal.applyTerminalPreferences(prefs);
}

export function applySidebarConfig(config: { width: number; visible: boolean }): void {
  const workspace = useWorkspaceApi();
  workspace.setSidebarConfig(config);
}
```

**关键**：settings 不直接 import 其他 module 的 store——通过 module api.ts 间接应用。

## 4. 接缝契约

```
// ui/settings/view/SettingsDrawer.tsx
import { useSettingsApi } from "@/app/modules/settings/api";

function SettingsDrawer() {
  const settings = useSettingsApi();

  const handleThemeChange = (theme: "dark" | "light" | "auto") => {
    settings.applyTheme(theme);   // 立即应用 + 触发持久化
  };

  return <ThemeSelector onChange={handleThemeChange} />;
}
```

## 5. 不对外暴露

- `usecases/*` 内部文件
- migration 逻辑——只在内部触发

## 6. api.ts 变更流程

1. **新增 Settings 字段** → 加 usecases/apply/ + 加 api.ts 方法
2. **修改 apply 函数签名** → 同步更新 api.ts
3. **schema migration** → 同步更新 migration.ts
