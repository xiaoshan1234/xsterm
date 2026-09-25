# Module · App Terminal — 对外接口

> **位置**：`src/app/modules/terminal/api.ts`
> **唯一进口**：`import { ... } from "@/app/modules/terminal/api"`

## 1. 对外暴露什么

1. **`TerminalApi` 接口** — tmux + terminal preferences 业务编排

## 2. 核心接口

```typescript
import type { SplitDirection, TerminalPreferences } from "@/model";

export interface TerminalApi {
  // ============ tmux attach/detach ============
  attachTmuxSession(sessionId: number): Promise<void>;
  detachTmuxController(sessionId: number): Promise<void>;

  // ============ tmux pane 操作 ============
  createTmuxPane(windowId: string, paneId: string, direction: SplitDirection): Promise<void>;
  killTmuxPane(windowId: string, paneId: string): Promise<void>;
  resizeTmuxPane(windowId: string, paneId: string, cols: number, rows: number): Promise<void>;
  capturePaneContent(sessionId: number, lines: number): Promise<string>;

  // ============ tmux window 操作 ============
  createTmuxWindow(workspaceId: string, sessionName: string): Promise<{ windowId: string; paneId: string }>;
  killTmuxWindow(workspaceId: string, windowId: string): Promise<void>;
  renameTmuxWindow(workspaceId: string, windowId: string, name: string): Promise<void>;

  // ============ tmux server 管理 ============
  getAttachedTmuxServers(): Promise<ReadonlyArray<{ name: string; pid: number }>>;
  autoAttachTmuxServers(): Promise<void>;
  killServerViaController(serverName: string): Promise<void>;
  unmarkAttachedTmux(serverName: string): Promise<void>;

  // ============ probe ============
  probeTmuxSessionExists(sessionName: string): Promise<boolean>;

  // ============ terminal preferences ============
  applyTerminalPreferences(prefs: TerminalPreferences): void;
}

export function useTerminalApi(): TerminalApi;
```

## 3. 跨 module 调用的具体实现

terminal module **几乎不**调其他 module——它编排的是"调用 backend tmux IPC"。

唯一一个跨 module 应用场景：applyTerminalPreferences 触发 UI 重新渲染——通过 `service/settings` 的 `terminalPreferences` 字段广播，UI 订阅响应（settings 单向 broadcast 模式）。

```typescript
// modules/terminal/usecases/preferences/apply.ts
import { useSettingsService } from "@/service/settings/api";  // ✅ 写 settings 字段（terminalPreferences）
// 注意：app/terminal 不直接调 useTerminalStore——v4 已删除 service/terminal domain
// 终端偏好通过 service/settings.terminalPreferences 统一存储，ui 通过 useSettingsService().useSetting("terminalPreferences") 订阅

export function applyTerminalPreferences(prefs: TerminalPreferences): void {
  useSettingsService().set({ terminalPreferences: prefs });
}
```

## 4. 接缝契约

```
// app/settings/usecases/apply/terminalPrefs.ts
import { useTerminalApi } from "@/app/modules/terminal/api";

export function applyTerminalPreferences(prefs: TerminalPreferences): void {
  const terminal = useTerminalApi();
  terminal.applyTerminalPreferences(prefs);
}
```

**关键**：settings 通过 `useTerminalApi()` 间接调 terminal 的 apply——terminal 决定如何应用偏好。

## 5. 不对外暴露

- `usecases/*` 内部文件
- tmux controller 状态——只能在 terminal module 内部访问

## 6. api.ts 变更流程

1. **新增 tmux IPC 命令** → 加 usecases/tmux/ + 加 ipc.ts + 加 api.ts 方法
2. **修改 useCase 签名** → 同步更新 api.ts
3. **删除 tmux IPC 命令** → 三处一起删除
