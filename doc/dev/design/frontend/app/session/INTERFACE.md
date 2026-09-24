# Module · App Session — 对外接口

> **位置**：`src/app/modules/session/api.ts`
> **唯一进口**：`import { ... } from "@/app/modules/session/api"`

## 1. 对外暴露什么

1. **`SessionApi` 接口** — 完整 session 业务编排能力
2. **跨 module 协调函数** — `openInWorkspace()` 把 session 装到 workspace

## 2. 核心接口

```typescript
import type {
  Session,
  LocalSessionConfig,
  SshSessionConfig,
  TmuxCcConfig,
  SessionConfig,
  PersistedSessionConfig,
  SessionDisplayConfig,
} from "@/app/shared/model";

export interface SessionApi {
  // ============ 创建 session ============
  /** 创建 local PTY session，绑定到指定 workspace */
  createLocal(config: LocalSessionConfig, workspaceId: string): Promise<{ sessionId: number; configId: string }>;
  /** 同上但不立即装到 pane（用于 split / init window 流程） */
  createLocalOnly(config: LocalSessionConfig): Promise<{ sessionId: number; configId: string }>;

  createSsh(config: SshSessionConfig, workspaceId: string): Promise<{ sessionId: number; configId: string }>;
  createSshOnly(config: SshSessionConfig): Promise<{ sessionId: number; configId: string }>;

  createTmux(config: TmuxCcConfig, workspaceId: string): Promise<{ sessionId: number; configId: string }>;
  createTmuxOnly(config: TmuxCcConfig): Promise<{ sessionId: number; configId: string }>;

  // ============ 打开 saved config ============
  openSavedConfig(configId: string, workspaceId: string, paneId?: string): Promise<number>;

  // ============ Lifecycle ============
  close(sessionId: number): Promise<void>;
  reconnect(sessionId: number): Promise<void>;
  rename(sessionId: number, name: string): Promise<void>;
  edit(sessionId: number, patch: Partial<SessionConfig>): Promise<void>;

  // ============ Display config ============
  applyDisplayConfig(sessionId: number, patch: Partial<SessionDisplayConfig>): void;

  // ============ Saved config CRUD ============
  saveConfig(config: PersistedSessionConfig): Promise<string>;
  removeConfig(configId: string): Promise<void>;
  listSavedConfigs(): ReadonlyArray<PersistedSessionConfig>;

  // ============ 跨 module 协调 ============
  /** 把已存在的 session 装到 workspace 的 pane */
  openInWorkspace(sessionId: number, configId: string, workspaceId: string, paneId?: string): Promise<void>;
  // ↑ 内部调 app/workspace/api.ts 的 openSession()
}

export function useSessionApi(): SessionApi;
```

## 3. 跨 module 调用的具体实现

```typescript
// modules/session/usecases/openInWorkspace.ts
import { useWorkspaceApi } from "@/app/modules/workspace/api";   // ✅ 跨 module 调 api.ts
import { useSessionStore } from "@/app/shared/service/session/store";

export async function openInWorkspace(
  sessionId: number,
  configId: string,
  workspaceId: string,
  paneId?: string
): Promise<void> {
  const session = useSessionStore.getState().sessions.find(s => s.id === sessionId);
  if (!session) throw new Error(`Session ${sessionId} not found`);

  // 跨 module 协调：调 workspace 的 openSession
  const workspace = useWorkspaceApi();
  await workspace.openSession(sessionId, configId, workspaceId, paneId);
}
```

**关键**：

- session 不直接 import `app/workspace/usecases/*`
- session 通过 `useWorkspaceApi()` 拿工作能力

## 4. 接缝契约

```
// ui/session/view/CreateSessionDialog.tsx
import { useSessionApi } from "@/app/modules/session/api";

function CreateSessionDialog({ workspaceId, onCreated, onCancel }) {
  const session = useSessionApi();

  const handleSubmit = async (config: LocalSessionConfig) => {
    const { sessionId, configId } = await session.createLocal(config, workspaceId);
    onCreated(sessionId, configId);
  };

  return <DialogForm onSubmit={handleSubmit} onCancel={onCancel} />;
}
```

**接缝约束**：

- UI 只通过 `useSessionApi()` 拿业务能力
- UI **不** import `@/app/shared/infra` 或 `@tauri-apps/api`
- 业务逻辑完全在 session module 内部

## 5. 不对外暴露

- `usecases/*` 内部文件——只能通过 api.ts
- `ipc.ts` 的 invoke 封装——只能通过 usecases
- `shared/service/session/store` 的 setter——只能通过 hook

## 6. api.ts 变更流程

1. **新增 useCase** → 加 usecases/ + 加 api.ts 方法
2. **修改 useCase 签名** → 同步更新 api.ts + INTERFACE.md §2
3. **删除 useCase** → 从 usecases/ 和 api.ts 一起删除
4. **跨 module 协调变更** → 同步更新 §3 跨 module 调用的实现
