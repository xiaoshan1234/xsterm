# Infra · Tauri — 职责

> **位置**：`src/infra/tauri/`
> **类型**：IPC 适配（最大、最核心的 infra 子模块）
> **被使用方**：`service/*`（所有 service 通过 repositories 间接调 commands/events）

## 1. 这个子模块负责什么

infra/tauri 是 frontend 跟 backend Rust 之间的 **IPC 适配层**——所有 `invoke()` 和 `listen()` 调用都集中在这里。

承担 5 类职责：

1. **invoke 封装**——把 backend `#[tauri::command]` 包成强类型函数
2. **listen 封装**——把 backend 事件包成强类型 listener
3. **Repository 实现**——实现 `model/<domain>/repository.ts` 接口，service 用统一 API
4. **事件总线**——双层（底层通用 + 上层 typed）
5. **类型契约**——所有 IPC payload 类型从这里 re-export

## 2. 这个子模块 **不**负责什么

- **不渲染 UI**——纯 IPC 适配层
- **不持有运行时状态**——store 归 service
- **不调业务逻辑**——业务在 app
- **不直接被 ui 调用**（除少数特例）——ui 通过 service 间接调

## 3. 子结构

```
infra/tauri/
├── commands/                    invoke 封装（按 backend domain 拆）
│   ├── session.ts               createLocal / createSsh / close / write 等
│   ├── workspace.ts             createWindow / closeWindow / saveWorkspace 等
│   ├── tmux.ts                  createTmuxPane / killTmuxPane / attachTmuxSession 等
│   ├── persistence.ts           saveSessions / loadSessions 等
│   ├── logging.ts               logMessage
│   └── system.ts                getSystemTheme 等
│
├── events/                      listen 封装（按 backend event name 拆）
│   ├── sessionOutput.ts         listen('session-output', ...)
│   ├── sessionClosed.ts         listen('session-closed', ...)
│   ├── tmuxEvents.ts            listen('tmux-events', ...)
│   ├── workspaceEvents.ts       listen('workspace-events', ...)
│   └── systemTheme.ts           listen('system-theme-changed', ...)
│
├── repositories/                Repository 接口实现（对应 model/repository.ts）
│   ├── sessions.ts              implements SessionRepository
│   ├── workspace.ts             implements WorkspaceRepository
│   ├── tmux.ts                  implements TmuxRepository
│   └── settings.ts              implements SettingsRepository
│
├── eventBuses/                  事件总线
│   ├── eventBus.ts              底层通用 bus（key-value）
│   ├── session.ts               上层 typed wrapper（SessionOutputEvent 等）
│   └── tmux.ts                  上层 typed wrapper
│
├── api.ts                       对外入口（聚合 commands + events + repositories）
└── *.test.ts
```

## 4. 用户故事（基础设施视角）

- **作为开发者**，我希望 service 用统一 API 调 backend → `useSessionService().createLocal(config)` 背后是 `infra/tauri/repositories/sessions.ts`
- **作为开发者**，我希望 backend 新增 IPC 命令只改一个文件 → 加 `infra/tauri/commands/session.ts` 的 invoke 函数
- **作为开发者**，我希望事件 payload 类型安全 → `infra/tauri/events/sessionOutput.ts` 返回 `SessionOutputEvent` 类型
- **作为开发者**，我希望测试 service 时 mock 整个 infra 层 → service 只 import infra/tauri 的 api.ts

## 5. 跟其他 infra 子模块的关系

| 子模块 | 关系 |
|---|---|
| `infra/store` | 各自独立——store 是 tauri-plugin-store 包装，tauri 是 IPC 适配 |
| `infra/clipboard` | 各自独立 |
| `infra/logger` | logger 通过 `infra/tauri/commands/logging.ts` 调 backend，但 logger 是单例不依赖 tauri 的 repository 抽象 |

## 6. 跟 service / app / ui 的关系

| 层 | 怎么用 infra/tauri |
|---|---|
| `service/session` | import `infra/tauri/repositories/sessions.ts` 实现 SessionRepository |
| `service/workspace` | import `infra/tauri/repositories/workspace.ts` |
| `app/*` | **禁止**——app 通过 service 间接调 |
| `ui/*` | **禁止**——ui 通过 service 间接调 |

## 7. 双层事件总线

```typescript
// 底层：通用 key-value 事件总线（infra/tauri/eventBuses/eventBus.ts）
export const eventBus = new EventTarget();

// 上层：domain-specific typed wrapper
export const sessionEventBus = {
  onOutput(callback: (event: SessionOutputEvent) => void): () => void {
    const handler = (e: Event) => callback((e as CustomEvent).detail);
    eventBus.addEventListener("session-output", handler);
    return () => eventBus.removeEventListener("session-output", handler);
  },
  // ...
};
```

**为什么双层**：

- 底层（EventTarget）——通用，无类型
- 上层（typed wrapper）——domain-specific，类型安全
- bridge 监听用底层 + listen 转上层，service 订阅用上层

## 8. Repository 实现的契约

每个 repository.ts 严格实现 model/<domain>/repository.ts 的接口：

```typescript
// model/session/repository.ts
export interface SessionRepository {
  createLocal(config: LocalSessionConfig): Promise<Session>;
  close(id: number): Promise<void>;
}

// infra/tauri/repositories/sessions.ts
import type { SessionRepository } from "@/model/session/repository";
import { sessionCommands } from "../commands/session";

export const sessionRepository: SessionRepository = {
  async createLocal(config) {
    return await sessionCommands.createLocal(config);
  },
  async close(id) {
    await sessionCommands.close(id);
  },
};
```

**这条契约保证 service 拿到的是 model 类型**——不会暴露 backend IPC 细节。

## 9. 关键设计：commands vs events 分离

- `commands/` — **出站**（frontend → backend）—— `invoke()`
- `events/` — **入站**（backend → frontend）—— `listen()`

这条分离让 frontend 代码读起来"出口走 commands、入口走 events"——清楚区分请求方向。

## 10. 子模块的"产品语言"术语

- **invoke** — frontend 主动调 backend 命令
- **listen** — frontend 订阅 backend 事件
- **Repository** — 后端 IPC 调用的统一抽象
- **payload** — IPC 数据结构（JSON 序列化）
- **event bus** — frontend 内部事件分发机制
