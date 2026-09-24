# Service · Session — 对外接口

> **位置**：`src/service/session/api.ts`
> **唯一进口**：`import { useSessionService, type SessionService } from "@/service/session/api"`

## 1. 对外暴露

1. **`SessionService` 接口** — 完整能力（读 / 订阅 / 写 / IPC 触发 / 事件）
2. **`useSessionService()` hook** — 单例访问

## 2. 接口

```typescript
import type { Session, LocalSessionConfig, SshSessionConfig, TmuxCcConfig } from "@/model/session/types";
import type { SessionOutputEvent, SessionClosedEvent } from "@/model/session/events";

export interface SessionService {
  // ============ 读（命令式） ============
  list(): ReadonlyArray<Session>;
  get(id: number): Session | undefined;
  getByWorkspace(workspaceId: string): ReadonlyArray<Session>;
  getByGroup(groupId: string): ReadonlyArray<Session>;

  // ============ 响应式订阅（hooks 用） ============
  useSessions(): ReadonlyArray<Session>;
  useSession(id: number): Session | undefined;
  useSessionsByWorkspace(workspaceId: string): ReadonlyArray<Session>;

  // ============ 写（业务无关的 mutation） ============
  /** 直接 upsert session（用于 bridge 收到 backend 事件时） */
  upsert(session: Session): void;
  /** 批量 upsert（启动加载用） */
  upsertMany(sessions: ReadonlyArray<Session>): void;
  /** 移除 session */
  remove(id: number): void;
  /** 清空所有（登出 / 重置时用） */
  clear(): void;

  // ============ IPC 触发（编排 invoke） ============
  createLocal(config: LocalSessionConfig): Promise<number>;
  createSsh(config: SshSessionConfig): Promise<number>;
  createTmux(config: TmuxCcConfig): Promise<number>;
  close(id: number): Promise<void>;
  reconnect(id: number): Promise<void>;
  rename(id: number, name: string): Promise<void>;
  resize(id: number, cols: number, rows: number): Promise<void>;

  // ============ 事件订阅（语义化） ============
  /** 订阅 session-output，callback 在 React 渲染外触发 */
  onOutput(callback: (event: SessionOutputEvent) => void): () => void;
  /** 订阅 session-closed */
  onClosed(callback: (event: SessionClosedEvent) => void): () => void;
}

export function useSessionService(): SessionService;
```

## 3. 关键设计

**响应式 vs 命令式分离**：

- `list()` / `get()` — 静态快照，命令式，不订阅变化
- `useSessions()` — 响应式，订阅变化，触发 re-render
- **为什么分离**：bridge 需要命令式访问（不发 re-render），UI 需要响应式

**mutation vs IPC 分离**：

- `upsert / remove` — 直接改 store，**不调 IPC**（给 bridge 用）
- `createLocal / close` — 调 IPC + 自动 upsert

**事件订阅语义化**：

- `onOutput(cb)` — 业务语义，调用方不需要知道事件名
- 内部实现：bridge 监听 `infra/tauri/events/sessionOutput` 的事件 → 调用所有 callback

## 4. 不对外暴露

- `store.ts` 的 raw store（避免外部直接 mutation）
- `bridge.ts` 的 listen 句柄
- IPC 错误细节（吞掉 / 转为 Result，不抛给 service 消费方）

## 5. 接缝契约

```
// app/session/usecases/createLocal.ts
import { useSessionService } from "@/service/session/api";

const sessionSvc = useSessionService();
const sessionId = await sessionSvc.createLocal(config);  // IPC + auto upsert
```

```
// ui/workspace/view/Sidebar/SessionListItem.tsx
import { useSessionService } from "@/service/session/api";

function SessionListItem({ workspaceId }) {
  const sessions = useSessionService().useSessionsByWorkspace(workspaceId);  // 响应式
  return <List items={sessions} />;
}
```

```
// app/terminal/usecases/preferences/apply.ts（bridge 用法）
import { useSessionService } from "@/service/session/api";

const svc = useSessionService();
svc.onOutput((event) => {
  if (event.sessionId !== currentSessionId) return;
  // ... route to output service
});
```

## 6. api.ts 变更流程

1. **新增 useCase / 字段** → 加 store + bridge + api.ts 方法
2. **修改方法签名** → 同步更新本文档 §2
3. **删除 useCase** → 三处一起删除
