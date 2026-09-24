# Module · App Shell — 对外接口

> **位置**：`src/app/modules/shell/api.ts`
> **唯一进口**：`import { ... } from "@/app/modules/shell/api"`

## 1. 对外暴露什么

1. **`ShellApi` 接口** — 启动 + 关闭序列
2. **`isAppReady()`** — UI 检查 app 是否完成启动

## 2. 核心接口

```typescript
export interface ShellApi {
  /** 启动序列：按依赖顺序加载 settings / workspace / tmux */
  initialize(): Promise<void>;

  /** 关闭序列：保存 workspace / settings / attached tmux servers */
  shutdown(): Promise<void>;

  /** app 是否完成启动 */
  isReady(): boolean;

  /** 订阅 app ready 事件 */
  onReady(callback: () => void): () => void;     // 返回 unsubscribe
}

export function useShellApi(): ShellApi;
```

## 3. 启动序列实现

```typescript
// modules/shell/usecases/initialize.ts
import { useSettingsApi } from "@/app/modules/settings/api";        // ✅ 跨 module 调 api.ts
import { useWorkspaceApi } from "@/app/modules/workspace/api";
import { useTerminalApi } from "@/app/modules/terminal/api";
import { useSessionApi } from "@/app/modules/session/api";
import { usePersistenceApi } from "@/service/persistence/api";

export async function initialize(): Promise<void> {
  const settings = useSettingsApi();
  const workspace = useWorkspaceApi();
  const terminal = useTerminalApi();

  try {
    // 1. 加载 settings
    const loadedSettings = await settings.load();
    await settings.applyTheme(loadedSettings.theme);
    await settings.applyLogLevel(loadedSettings.logLevel);
    await settings.applyTerminalPreferences({
      fontSize: loadedSettings.terminalFontSize,
      fontFamily: loadedSettings.terminalFontFamily,
    });
    await settings.applySidebarConfig({
      width: loadedSettings.sidebarWidth,
      visible: loadedSettings.showSidebar,
    });

    // 2. 加载 workspace
    await workspace.loadLastWorkspace();

    // 3. 自动 attach tmux
    await terminal.autoAttachTmuxServers();

    setReady(true);
  } catch (err) {
    // 回退：用默认 settings + 默认 workspace
    console.error("Initialize failed, falling back to defaults:", err);
    await fallbackInitialize();
    setReady(true);
  }
}

async function fallbackInitialize(): Promise<void> {
  const settings = useSettingsApi();
  const workspace = useWorkspaceApi();

  await settings.reset();
  await workspace.createWorkspace("default");
}
```

## 4. 接缝契约

```
// ui/shell/api.ts (UI shell) — main.tsx 调 initialize
import { useShellApi } from "@/app/modules/shell/api";
import { App } from "@/ui/modules/shell/api";

const shell = useShellApi();
await shell.initialize();
root.render(<App />);
```

```
// UI 想"在 app ready 前显示加载状态"
import { useShellApi } from "@/app/modules/shell/api";

function LoadingGate({ children }) {
  const shell = useShellApi();
  if (!shell.isReady()) return <LoadingScreen />;
  return <>{children}</>;
}
```

## 5. 不对外暴露

- 启动序列的内部步骤——只能通过 `initialize()`
- 各 module 的 apply 调用——只能通过 api.ts

## 6. api.ts 变更流程

1. **新增启动步骤** → 加 usecases + 加 initialize() 实现
2. **关闭序列变更** → 加 usecases/shutdown.ts
3. **app ready 状态变化** → readiness.ts
