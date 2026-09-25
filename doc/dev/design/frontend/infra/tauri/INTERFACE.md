# Infra · Tauri — 对外接口

> **位置**：`src/infra/tauri/api.ts`
> **唯一进口**：`import { ... } from "@/infra/tauri/api"`

## 1. 对外暴露

1. **`sessionRepository` / `workspaceRepository` / `tmuxRepository` / `settingsRepository`** — Repository 接口实现
2. **`sessionEventBus` / `tmuxEventBus`** — typed 事件总线
3. **`infra/tauri/commands/*`** — invoke 封装（service 不直接用，repository 内部用）
4. **`infra/tauri/events/*`** — listen 封装（同上）

## 2. Repository 实现

```typescript
// api.ts
import { sessionRepository } from "./repositories/sessions";
import { workspaceRepository } from "./repositories/workspace";
import { tmuxRepository } from "./repositories/tmux";
import { settingsRepository } from "./repositories/settings";

export {
  sessionRepository,
  workspaceRepository,
  tmuxRepository,
  settingsRepository,
};

// 也提供 listen helper（service bridge 用）
import { sessionEventBus } from "./eventBuses/session";
import { tmuxEventBus } from "./eventBuses/tmux";
export { sessionEventBus, tmuxEventBus };
```

**关键**：service 用 `sessionRepository` 而不是 `commands/session`——Repository 抽象让 service 不感知 IPC 细节。

## 3. Repository 接口（对应 model/repository.ts）

```typescript
// infra/tauri/repositories/sessions.ts
import type { SessionRepository } from "@/model/session/repository";
import { sessionCommands } from "../commands/session";

export const sessionRepository: SessionRepository = {
  async createLocal(config) {
    const id = await sessionCommands.createLocal(config);
    return getSession(id);   // 用 id 取完整 Session
  },
  async createSsh(config) { ... },
  async createTmux(config) { ... },
  async close(id) {
    await sessionCommands.close(id);
  },
  async reconnect(id) { ... },
  async rename(id, name) { ... },
  async resize(id, cols, rows) { ... },
  // list / get 是本地操作（不调 IPC，从 store 读）
  list() { return []; },   // 实际由 service store 提供
  get(id) { return undefined; },
};
```

**关键设计**：`list()` 和 `get()` 返回空——service 用 zustand store 维护本地缓存，repository 只负责"写入"操作（create / close 等）。

## 4. EventBus 接口

```typescript
// infra/tauri/eventBuses/session.ts
import { eventBus } from "./eventBus";
import type { SessionOutputEvent, SessionClosedEvent } from "@/model/session/events";

export const sessionEventBus = {
  onOutput(callback: (event: SessionOutputEvent) => void): () => void {
    const handler = (e: Event) => callback((e as CustomEvent).detail);
    eventBus.addEventListener("session-output", handler);
    return () => eventBus.removeEventListener("session-output", handler);
  },

  onClosed(callback: (event: SessionClosedEvent) => void): () => void {
    const handler = (e: Event) => callback((e as CustomEvent).detail);
    eventBus.addEventListener("session-closed", handler);
    return () => eventBus.removeEventListener("session-closed", handler);
  },
};
```

**关键**：bridge 在 service 启动时订阅 eventBus 事件，转发给 service store。

## 5. invoke 封装（commands/）

```typescript
// infra/tauri/commands/session.ts
import { invoke } from "@tauri-apps/api/core";
import type { LocalSessionConfig, SshSessionConfig, TmuxCcConfig } from "@/model/session/types";

export const sessionCommands = {
  createLocal: (config: LocalSessionConfig): Promise<number> =>
    invoke<number>("create_local_session", { config }),

  createSsh: (config: SshSessionConfig): Promise<number> =>
    invoke<number>("create_ssh_session", { config }),

  createTmux: (config: TmuxCcConfig): Promise<number> =>
    invoke<number>("create_tmux_session", { config }),

  close: (sessionId: number): Promise<void> =>
    invoke<void>("close_session", { sessionId }),

  reconnect: (sessionId: number): Promise<void> =>
    invoke<void>("reconnect_session", { sessionId }),

  rename: (sessionId: number, name: string): Promise<void> =>
    invoke<void>("rename_session", { sessionId, name }),

  resize: (sessionId: number, cols: number, rows: number): Promise<void> =>
    invoke<void>("resize_pty_session", { sessionId, cols, rows }),

  write: (sessionId: number, data: Uint8Array): Promise<void> =>
    invoke<void>("write_session", { sessionId, data: Array.from(data) }),
};
```

## 6. listen 封装（events/）

```typescript
// infra/tauri/events/sessionOutput.ts
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import type { SessionOutputPayload } from "@/model/session/events";
import { sessionEventBus } from "../eventBuses/session";

export function listenSessionOutput(): Promise<UnlistenFn> {
  return listen<SessionOutputPayload>("session-output", (event) => {
    sessionEventBus.emit(event.payload);
  });
}
```

**关键**：listen 把 backend 事件转发到 eventBus——bridge 用 eventBus.onOutput 订阅。

## 7. 不对外暴露

- `commands/*` 内部实现细节（除通过 repository 暴露）
- `events/*` 内部 listen 函数（service 不直接调）
- `eventBus` 底层（除通过 eventBuses 暴露）

## 8. 接缝契约

```
// service/session/api.ts
import { sessionRepository } from "@/infra/tauri/api";

export function useSessionService(): SessionService {
  return {
    createLocal: (config) => sessionRepository.createLocal(config),
    close: (id) => sessionRepository.close(id),
    // ...
  };
}
```

```
// service/session/bridge.ts
import { listenSessionOutput, listenSessionClosed } from "@/infra/tauri/events";

export function setupSessionBridge(): () => void {
  const unlisteners: UnlistenFn[] = [];
  listenSessionOutput().then(unlisten => unlisteners.push(unlisten));
  // ...
  return () => unlisteners.forEach(u => u());
}
```

## 9. api.ts 变更流程

1. **新增 IPC 命令** → 加 commands/<domain>.ts + repository.ts + api.ts export
2. **修改 IPC 签名** → 同步更新 §3-§5
3. **删除 IPC 命令** → 三处一起删除（backend 命令 → commands → repository）
