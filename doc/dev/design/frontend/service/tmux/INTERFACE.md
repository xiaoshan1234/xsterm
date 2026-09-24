# Service · Tmux — 对外接口

> **位置**：`src/service/tmux/api.ts`
> **唯一进口**：`import { useTmuxService, type TmuxService } from "@/service/tmux/api"`

## 1. 接口

```typescript
import type { TmuxController, AttachedServer, TmuxPane, TmuxWindow } from "@/model/tmux/types";
import type { SessionId } from "@/model/session/types";

export interface TmuxService {
  // ============ Controller 状态（命令式） ============
  listControllers(): ReadonlyArray<TmuxController>;
  getController(serverName: string): TmuxController | undefined;

  // ============ Controller 订阅（响应式） ============
  useControllers(): ReadonlyArray<TmuxController>;
  useController(serverName: string): TmuxController | undefined;

  // ============ Attached servers ============
  listAttachedServers(): ReadonlyArray<AttachedServer>;
  useAttachedServers(): ReadonlyArray<AttachedServer>;

  // ============ Controller 操作（IPC 触发） ============
  attach(serverName: string): Promise<void>;
  detach(serverName: string): Promise<void>;
  killServer(serverName: string): Promise<void>;
  unmarkAttached(serverName: string): Promise<void>;

  // ============ Tmux pane 操作 ============
  createPane(controllerSessionId: SessionId, direction: "horizontal" | "vertical"): Promise<TmuxPane>;
  killPane(paneId: string): Promise<void>;
  resizePane(paneId: string, cols: number, rows: number): Promise<void>;
  capturePaneContent(paneId: string, lines: number): Promise<string>;

  // ============ Tmux window 操作 ============
  createWindow(serverName: string, windowName: string): Promise<TmuxWindow>;
  killWindow(windowId: string): Promise<void>;
  renameWindow(windowId: string, name: string): Promise<void>;

  // ============ Auto-attach（启动时） ============
  autoAttachOnStartup(): Promise<void>;
}

export function useTmuxService(): TmuxService;
```

## 2. 关键设计

**Controller 是 backend 的镜像**：

- `listControllers()` — 镜像 backend 当前所有 controller
- controller 状态变化由 bridge 监听 `tmux-events` 自动更新
- **前端不直接创建 controller**——controller 由 backend 在 tmux session 创建时启动

**Attached servers vs Controllers**：

- `attachedServers` — **持久化列表**（"我之前 attach 过这些 server"）
- `controllers` — **运行时列表**（"backend 当前有哪些 controller 在跑"）
- 两者通过 `serverName` 关联，但生命周期不同

**`autoAttachOnStartup` 是幂等的**——app/shell 启动时调，service 内部处理每个 server 的 attach（成功 / 失败都 log）。

## 3. 不对外暴露

- `bridge.ts` 的 listen 句柄
- controller 状态的内部表示（通过 controller 暴露只读）

## 4. 接缝契约

```
// app/shell/usecases/initialize.ts（启动时）
import { useTmuxService } from "@/service/tmux/api";

const tmux = useTmuxService();
await tmux.autoAttachOnStartup();
```

```
// ui/tmux/view/TmuxControlWindowView.tsx
import { useTmuxService } from "@/service/tmux/api";

function TmuxControlWindowView({ sessionId }) {
  const controllers = useTmuxService().useControllers();
  // 渲染 control window 列表
}
```

```
// app/terminal/usecases/attach.ts
import { useTmuxService } from "@/service/tmux/api";

const tmux = useTmuxService();
await tmux.attach(serverName);
```

## 5. api.ts 变更流程

1. **新增 tmux IPC 命令** → 加 bridge / store / api.ts 方法
2. **修改方法签名** → 同步更新 §1
3. **删除 tmux IPC 命令** → 三处一起删除

## 6. 跟 service/session 的边界

```typescript
// ❌ 错误：tmux service 不应该读 session service
const sessionSvc = useSessionService();  // 反向依赖
const tmuxSvc = useTmuxService();

// ✅ 正确：通过参数传递
function openTmuxControlWindow(sessionId: number, serverName: string) {
  // app 层编排
  const session = useSessionService().get(sessionId);
  const tmuxController = useTmuxService().getController(serverName);
  // ...
}
```

**关键**：tmux service **不读** session service。两个 service 通过 backend 事件**隐式同步**。
