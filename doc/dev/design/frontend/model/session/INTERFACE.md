# Model · Session — 对外接口

> **位置**：`src/model/session/`
> **使用方式**：直接 `import { ... } from "@/model/session/types"` 等
> **不需要 api.ts**——model 是无状态纯类型 + 纯函数，没有"入口边界"

## 1. 对外暴露什么

1. **数据形状**——types.ts
2. **Repository 接口**——repository.ts
3. **事件契约**——events.ts
4. **纯函数**——accessor.ts（query）+ rules.ts（mutation）

## 2. types.ts

```typescript
// Session 类型
export interface Session {
  id: number;
  kind: SessionKind;
  name: string;
  configId: string;
  workspaceId: string;
  windowId?: string;
  paneId?: string;
  status: SessionStatus;
  startedAt: number;
  displayConfig?: SessionDisplayConfig;
}

// Session 类型枚举
export type SessionKind = "local" | "ssh" | "tmux";
export type SessionStatus = "connecting" | "running" | "closed" | "error";

// Session 配置（discriminated union）
export type SessionConfig =
  | LocalSessionConfig
  | SshSessionConfig
  | TmuxCcConfig;

export interface LocalSessionConfig {
  kind: "local";
  name: string;
  shell: string;
  cwd: string;
  env: Record<string, string>;
}

export interface SshSessionConfig {
  kind: "ssh";
  name: string;
  host: string;
  port: number;
  username: string;
  authMethod: "password" | "privateKey";
  privateKeyPath?: string;
}

export interface TmuxCcConfig {
  kind: "tmux";
  name: string;
  sessionName: string;
  socketPath?: string;
}

// 显示配置
export interface SessionDisplayConfig {
  fontSize: number;
  fontFamily: string;
  cols: number;
  rows: number;
  theme?: string;   // xterm theme id
}

// 持久化配置（独立类型——不是 SessionConfig 因为不带运行时字段）
export interface PersistedSessionConfig {
  id: string;
  name: string;
  version: number;
  type: SessionKind;
  config: SessionConfig;
  displayConfig?: SessionDisplayConfig;
}
```

## 3. repository.ts

```typescript
// Repository 接口——service 实现
export interface SessionRepository {
  createLocal(config: LocalSessionConfig): Promise<Session>;
  createSsh(config: SshSessionConfig): Promise<Session>;
  createTmux(config: TmuxCcConfig): Promise<Session>;
  close(id: number): Promise<void>;
  reconnect(id: number): Promise<void>;
  rename(id: number, name: string): Promise<void>;
  list(): ReadonlyArray<Session>;
  get(id: number): Session | undefined;
}
```

## 4. events.ts

```typescript
// 事件契约
export interface SessionOutputEvent {
  sessionId: number;
  data: number[];   // UTF-8 byte array
}

export interface SessionClosedEvent {
  sessionId: number;
  reason: "user" | "error" | "disconnect";
}

// 事件名常量
export const SessionEvents = {
  Output: "session-output",
  Closed: "session-closed",
} as const;

export type SessionEventName = typeof SessionEvents[keyof typeof SessionEvents];
```

## 5. accessor.ts

```typescript
// Query 纯函数

export function getActiveSession(sessions: ReadonlyArray<Session>): Session | undefined {
  return sessions.find(s => s.status === "running");
}

export function getSessionsByKind(
  sessions: ReadonlyArray<Session>,
  kind: SessionKind
): ReadonlyArray<Session> {
  return sessions.filter(s => s.kind === kind);
}

export function getSessionsByWorkspace(
  sessions: ReadonlyArray<Session>,
  workspaceId: string
): ReadonlyArray<Session> {
  return sessions.filter(s => s.workspaceId === workspaceId);
}

export function getUniqueSessionName(
  baseName: string,
  existing: ReadonlyArray<Session>
): string {
  // 唯一命名算法——避免重名
  const names = new Set(existing.map(s => s.name));
  if (!names.has(baseName)) return baseName;
  let i = 2;
  while (names.has(`${baseName} ${i}`)) i++;
  return `${baseName} ${i}`;
}
```

## 6. rules.ts

```typescript
// Mutation 纯函数——返回新 Session 对象（immutable）

export function applyDisplayConfig(
  session: Session,
  patch: Partial<SessionDisplayConfig>
): Session {
  return {
    ...session,
    displayConfig: { ...session.displayConfig, ...patch },
  };
}

export function withStatus(session: Session, status: SessionStatus): Session {
  return { ...session, status };
}

export function withStartedAt(session: Session, timestamp: number): Session {
  return { ...session, startedAt: timestamp };
}

export function withWorkspaceBinding(
  session: Session,
  workspaceId: string,
  windowId?: string,
  paneId?: string
): Session {
  return { ...session, workspaceId, windowId, paneId };
}
```

## 7. 不对外暴露

无——model 全部 export。

## 8. api.ts 变更流程

model 没有 api.ts，变更流程直接：
1. **新增 type / function** → 加 types.ts / accessor.ts / rules.ts
2. **修改 type signature** → 同步更新本文档 §2-§6
3. **删除** → 直接删除
