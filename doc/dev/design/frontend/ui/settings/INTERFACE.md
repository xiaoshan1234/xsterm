# Module · Settings — 对外接口

> **位置**：`src/ui/modules/settings/api.ts`
> **唯一进口**：`import { ... } from "@/ui/modules/settings/api"`

## 1. 对外暴露什么

1. **`<SettingsDrawer>` 容器** — shell 嵌入
2. **业务 Hook** — `useSettingsApi()` 读 + 写
3. **类型** — `Settings` `SettingsCategory`

## 2. 顶层组件

### `<SettingsDrawer>`

```typescript
interface SettingsDrawerProps {
  open: boolean;
  onClose: () => void;
  /** 初始展开的分类 */
  initialCategory?: SettingsCategory;
}

function SettingsDrawer(props: SettingsDrawerProps): JSX.Element;
```

`<SettingsDrawer>` 内部：

- 左侧 `<SettingsCategoryNav>` 分类切换
- 右侧根据 `initialCategory` 或当前选中分类渲染对应 Tab
- 5 个 Tab 各自管自己的字段，**不**直接调 `useSettingsApi().update()`，通过 props 回调冒泡

```typescript
// 5 个 Tab 的统一 props
interface SettingsTabProps {
  values: Settings;                       // 当前所有设置（受控）
  onChange: (patch: Partial<Settings>) => void;  // 改值后冒泡到 drawer
}
```

## 3. 公开 Hook

### `useSettingsApi()`

跨 module 访问 settings 能力。

```typescript
interface SettingsApi {
  // 读
  get<K extends keyof Settings>(key: K): Settings[K];
  getAll(): Settings;

  // 写
  update<K extends keyof Settings>(key: K, value: Settings[K]): void;
  updateMany(patch: Partial<Settings>): void;
  reset(): void;                            // 恢复默认

  // 订阅（响应式）
  useSetting<K extends keyof Settings>(key: K): Settings[K];
  useSettings(): Settings;

  // 持久化
  save(): Promise<void>;
  load(): Promise<void>;
}

function useSettingsApi(): SettingsApi;
```

### `useSetting<K>(key)`

更细粒度的订阅——只在该 key 变化时 re-render。

```typescript
function useSetting<K extends keyof Settings>(key: K): Settings[K];
```

### `useSettingsCategory(category)`

```typescript
function useSettingsCategory(category: SettingsCategory): Partial<Settings>;
```

## 4. 类型

```typescript
type SettingsCategory = "appearance" | "input" | "session" | "terminal" | "logging";

interface Settings {
  // Appearance
  theme: "dark" | "light" | "auto";
  uiScale: number;                          // 0.8 - 1.5
  showSidebar: boolean;

  // Input
  keymap: "default" | "vim" | "emacs";
  scrollbackLines: number;                  // 1000 - 100000
  pasteWarnThreshold: number;               // 字符数

  // Session defaults
  defaultShell: string;
  defaultSshUser: string;
  defaultTmuxSessionName: string;

  // Terminal
  terminalFontFamily: string;
  terminalFontSize: number;                 // 8 - 32
  terminalThemeId: string;                  // 引用 model/theme 的 theme id
  cursorBlink: boolean;

  // Logging
  logLevel: "trace" | "debug" | "info" | "warn" | "error";
  logMaxFileSizeMB: number;
  logRetentionDays: number;
}
```

## 5. 不对外暴露

- `view/` 内部 5 个 Tab 组件——只能通过 `<SettingsDrawer>` 暴露
- `store.ts` 的 setter——只能通过 `useSettingsApi()` 暴露
- 设置的 schema 迁移逻辑——在 service/settings 内部

## 6. 接缝契约

```
// shell/view/Layout.tsx
import { SettingsDrawer } from "@/ui/modules/settings/api";
import { useAppShell } from "@/ui/modules/shell/api";

function Layout() {
  const shell = useAppShell();
  return (
    <main>
      <Sidebar />
      <WorkspaceApp />
      <SettingsDrawer
        open={shell.currentView === "settings"}
        onClose={() => shell.closeSettings()}
      />
    </main>
  );
}
```

**接缝约束**：

- settings **不**直接调 `useAppShell().openDialog`——shell 自己决定何时显示 settings drawer
- settings **不**直接调 workspace/terminal 的 API——通过 service/settings 广播变化
- 其他 module 通过 `useSettingsApi()` / `useSetting(key)` 订阅自己关心的字段

## 7. 设计意图：settings 通过 service/settings 广播

v3 设计里 terminal 直跳 `useSettingsStore.getState()` 读 fontSize。新设计：

- settings module 写 `service/settings` store
- terminal **不**订阅 settings store——它通过 props 接收 fontSize
- workspace / sidebar 订阅 settings 的特定字段（如 sidebar 宽度）

**为什么 terminal 不订阅**：terminal 是被 workspace 嵌入的子组件，props 单向数据流更清晰。settings 改 → workspace 重新渲染并传新 props 给 terminal → terminal 重新渲染。这避免了 terminal 跟 settings 直接耦合。

**例外**：sidebar 宽度、UI scale 这类"全局 UI 偏好"由 sidebar 自己订阅（因为 sidebar 不在 props 流上）。
