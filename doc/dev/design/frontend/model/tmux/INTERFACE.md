# Model · Tmux — 对外接口

> **位置**：`src/model/tmux/`
> **使用方式**：`import { ... } from "@/model/tmux/types"` 等

## 1. types.ts

```typescript
// Tmux Controller（backend 镜像）
export interface TmuxController {
  serverName: string;
  pid: number;
  attachedAt: number;
  status: "connecting" | "attached" | "detached";
  panes: ReadonlyArray<TmuxPane>;
  windows: ReadonlyArray<TmuxWindow>;
}

// 持久化的 attached server 列表
export interface AttachedServer {
  serverName: string;
  attachedAt: number;
}

// Tmux pane（跟 xsterm pane 不同）
export interface TmuxPane {
  id: string;
  windowId: string;
  index: number;
  active: boolean;
  width: number;
  height: number;
}

// Tmux window（跟 xsterm window 不同）
export interface TmuxWindow {
  id: string;
  name: string;
  index: number;
  active: boolean;
  paneIds: ReadonlyArray<string>;
}
```

## 2. repository.ts

```typescript
export interface TmuxRepository {
  attach(serverName: string): Promise<void>;
  detach(serverName: string): Promise<void>;
  killServer(serverName: string): Promise<void>;
  createPane(controllerSessionId: number, direction: SplitDirection): Promise<TmuxPane>;
  killPane(paneId: string): Promise<void>;
  resizePane(paneId: string, cols: number, rows: number): Promise<void>;
  capturePaneContent(paneId: string, lines: number): Promise<string>;
  createWindow(serverName: string, windowName: string): Promise<TmuxWindow>;
  killWindow(windowId: string): Promise<void>;
  renameWindow(windowId: string, name: string): Promise<void>;
  listControllers(): Promise<ReadonlyArray<TmuxController>>;
  listAttachedServers(): Promise<ReadonlyArray<AttachedServer>>;
}
```

## 3. events.ts

```typescript
export interface TmuxControllerAttachedEvent {
  serverName: string;
  pid: number;
}

export interface TmuxControllerDetachedEvent {
  serverName: string;
}

export interface TmuxPaneAddedEvent {
  controllerSessionId: number;
  pane: TmuxPane;
}

export interface TmuxPaneRemovedEvent {
  paneId: string;
}

export interface TmuxWindowAddedEvent {
  serverName: string;
  window: TmuxWindow;
}

export interface TmuxWindowRenamedEvent {
  windowId: string;
  name: string;
}

export const TmuxEvents = {
  ControllerAttached: "tmux-controller-attached",
  ControllerDetached: "tmux-controller-detached",
  PaneAdded: "tmux-pane-added",
  PaneRemoved: "tmux-pane-removed",
  WindowAdded: "tmux-window-added",
  WindowRenamed: "tmux-window-renamed",
} as const;
```

## 4. accessor.ts

```typescript
export function getControllerByServerName(
  controllers: ReadonlyArray<TmuxController>,
  serverName: string
): TmuxController | undefined {
  return controllers.find(c => c.serverName === serverName);
}

export function getAttachedServers(
  attachedServers: ReadonlyArray<AttachedServer>
): ReadonlyArray<AttachedServer> {
  // 按 attachedAt 倒序
  return [...attachedServers].sort((a, b) => b.attachedAt - a.attachedAt);
}

export function findPaneInController(
  controller: TmuxController,
  paneId: string
): TmuxPane | undefined {
  return controller.panes.find(p => p.id === paneId);
}

export function findWindowInController(
  controller: TmuxController,
  windowId: string
): TmuxWindow | undefined {
  return controller.windows.find(w => w.id === windowId);
}

export function isControllerAttached(controller: TmuxController): boolean {
  return controller.status === "attached";
}
```

## 5. rules.ts

```typescript
export function withControllerStatus(
  controller: TmuxController,
  status: TmuxController["status"]
): TmuxController {
  return { ...controller, status };
}

export function withAttachedServer(
  attachedServers: ReadonlyArray<AttachedServer>,
  server: AttachedServer
): ReadonlyArray<AttachedServer> {
  // 去重 + 添加
  const filtered = attachedServers.filter(s => s.serverName !== server.serverName);
  return [...filtered, server];
}

export function withoutAttachedServer(
  attachedServers: ReadonlyArray<AttachedServer>,
  serverName: string
): ReadonlyArray<AttachedServer> {
  return attachedServers.filter(s => s.serverName !== serverName);
}

export function applyTmuxPaneAdded(
  controller: TmuxController,
  pane: TmuxPane
): TmuxController {
  return { ...controller, panes: [...controller.panes, pane] };
}

export function applyTmuxPaneRemoved(
  controller: TmuxController,
  paneId: string
): TmuxController {
  return { ...controller, panes: controller.panes.filter(p => p.id !== paneId) };
}

export function applyTmuxWindowAdded(
  controller: TmuxController,
  window: TmuxWindow
): TmuxController {
  return { ...controller, windows: [...controller.windows, window] };
}

export function applyTmuxWindowRenamed(
  controller: TmuxController,
  windowId: string,
  name: string
): TmuxController {
  return {
    ...controller,
    windows: controller.windows.map(w => w.id === windowId ? { ...w, name } : w),
  };
}
```

## 6. 不对外暴露

无——model 全部 export。

## 7. 关键设计：tmux 状态是 backend 镜像

```typescript
// ✅ 正确：bridge 收到 backend 事件 → apply 镜像
function handleTmuxEvent(controllers: TmuxController[], event: TmuxEvent): TmuxController[] {
  return controllers.map(c => {
    if (c.serverName !== event.serverName) return c;
    return applyTmuxEvent(c, event);   // 用 rules 函数
  });
}

// ❌ 错误：前端主动构造 controller 状态
function attach(controllers: TmuxController[], serverName: string): TmuxController[] {
  return [...controllers, { serverName, status: "attached" }];
}
```
