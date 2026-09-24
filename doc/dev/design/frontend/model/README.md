# Frontend · Model 层

> **位置**：`src/model/`
> **关注点**：纯数据 + 算法（含 rules）。无 React、无 IPC、无 I/O。
> **平级于**：app / ui / service / infra（5 个顶层目录之一）

## 1. 职责

model 是 frontend 的"最底层数据 + 算法"层。它承担 4 类职责：

1. **数据形状**——每个 domain 的 TypeScript type / interface / enum
2. **接口契约**——Repository 接口（service 层实现）、event 契约
3. **派生计算**——accessor：query 类纯函数（`getActiveSession(sessions)`）
4. **算法**——rules：mutation 类纯函数（`createSplitNode(tree, ratio)`）

**约束**：

- 禁止 `import { invoke } from "@tauri-apps/api"` 或 `listen(...)` 或 `import { ... } from "../infra/*"`
- 禁止 `import React` 或 `useState` / `useEffect`
- 不持有任何状态——纯函数 + 纯类型
- 派生计算放 `accessor.ts`，算法放 `rules.ts`，两者都是纯函数

## 2. 目录结构

```
src/model/
├── session/          Session / SessionConfig / SessionDisplayConfig
├── workspace/        Workspace / Window / Group / PaneNode
├── terminal/         TerminalTheme / SplitDirection / TerminalPreferences
├── persistence/      PersistedSessionConfig / PersistedWorkspace
├── settings/         Settings / SettingsCategory / LogLevel
├── tmux/             TmuxController / TmuxServer / TmuxPane
├── output/           OutputFrame / OutputBuffer / OutputChannel
├── theme/            Theme / ThemeMode
│
├── common/           跨 domain 纯函数
│   ├── textTransform.ts    ANSI 解析等
│   └── constants.ts        app 层常量
│
└── index.ts          barrel
```

每个 `<domain>/` 子目录采用 **5 文件模板**：

```
<domain>/
├── types.ts          # 纯数据 shape / enum / union
├── repository.ts     # Repository 接口签名（service 层实现）
├── events.ts         # 事件总线契约（event name + payload 类型）
├── accessor.ts       # 本 domain 派生计算（query 纯函数）
└── rules.ts          # 本 domain 算法（mutation 纯函数）
```

## 3. 5 文件模板详解

### 3.1 `types.ts`

```typescript
// 纯数据 shape，无任何方法
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

export type SessionKind = "local" | "ssh" | "tmux";
export type SessionStatus = "connecting" | "running" | "closed" | "error";
```

### 3.2 `repository.ts`

```typescript
// Repository 接口（service 层实现）
export interface SessionRepository {
  createLocal(config: LocalSessionConfig): Promise<Session>;
  createSsh(config: SshSessionConfig): Promise<Session>;
  close(sessionId: number): Promise<void>;
  list(): ReadonlyArray<Session>;
  get(id: number): Session | undefined;
}
```

### 3.3 `events.ts`

```typescript
// 事件总线契约
export interface SessionOutputEvent {
  sessionId: number;
  data: Uint8Array;
}

export interface SessionClosedEvent {
  sessionId: number;
  reason: "user" | "error" | "disconnect";
}

// 事件名常量（service 层订阅/分发时使用）
export const SessionEvents = {
  Output: "session-output",
  Closed: "session-closed",
} as const;
```

### 3.4 `accessor.ts`

```typescript
// 派生计算（query 纯函数）
export function getActiveSession(sessions: ReadonlyArray<Session>): Session | undefined {
  return sessions.find(s => s.status === "running");
}

export function getSessionsByKind(
  sessions: ReadonlyArray<Session>,
  kind: SessionKind
): ReadonlyArray<Session> {
  return sessions.filter(s => s.kind === kind);
}

export function getUniqueSessionName(
  baseName: string,
  existing: ReadonlyArray<Session>
): string {
  // ... 唯一命名算法
}
```

### 3.5 `rules.ts`

```typescript
// 算法（mutation 纯函数）
export function applyDisplayConfig(
  session: Session,
  patch: Partial<SessionDisplayConfig>
): Session {
  return {
    ...session,
    displayConfig: { ...session.displayConfig, ...patch },
  };
}

export function sessionStartedAt(
  session: Session,
  timestamp: number
): Session {
  return { ...session, startedAt: timestamp, status: "running" };
}
```

## 4. rules vs accessor 的区别

| 维度 | accessor | rules |
|---|---|---|
| 操作类型 | query（不修改数据） | mutation（产生新数据） |
| 返回 | 原数据 + 派生值 | 新数据（immutable） |
| 例子 | `getActiveSession(sessions)` | `applyDisplayConfig(session, patch)` |
| 命名习惯 | `get*` `find*` `is*` | `create*` `apply*` `merge*` `rename*` |

## 5. 跨 domain 纯函数（`common/`）

不属于任何单个 domain 的纯函数放 `model/common/`：

- `textTransform.ts`——ANSI 解析、tab 转换、字符编码
- `constants.ts`——app 层常量（DEFAULT_PORT、MAX_PASTE_LENGTH 等）

**判断标准**：函数参数**不依赖**任何具体 domain 类型 → 放 common；参数依赖某个 domain 类型 → 放该 domain 的 `rules.ts`。

## 6. domain 子目录清单

按 v4 设计，model 应该有 **8 个 domain**（现状已经有部分）：

| domain | 主要 types | 主要 rules |
|---|---|---|
| `session` | Session / SessionConfig / SessionDisplayConfig | applyDisplayConfig / 重命名 / 排序 |
| `workspace` | Workspace / Window / Group / PaneNode | **paneTree 算法**（createLeafPane / createSplitNode / findPaneNode / replacePaneNode）|
| `terminal` | TerminalTheme / SplitDirection | terminal preferences 应用 |
| `persistence` | PersistedSessionConfig / PersistedWorkspace / PersistedWindow | schema migration |
| `settings` | Settings / SettingsCategory | settings 派生（getEffectiveSettings）|
| `tmux` | TmuxController / TmuxServer / TmuxPane | tmux state machine 派生 |
| `output` | OutputFrame / OutputBuffer / OutputChannel | 输出帧合并算法 |
| `theme` | Theme / ThemeMode | 主题派生 |

**关键**：paneTree 之前在 v3 的 `app/rules/paneTree.ts`，v4 归 `model/workspace/rules.ts`——因为它操作 PaneNode 类型。

## 7. 依赖方向

```
model/<domain>/  ──►  (无依赖)
        │
        └─►  model/common/    (跨 domain 纯函数)
```

**严禁**：

- ❌ `model/<domain>/` → `app/` 或 `ui/` 或 `service/` 或 `infra/`
- ❌ `model/common/` → `model/<domain>/`（common 是最底层）
- ❌ `model/` → `@tauri-apps/api` 或 `@/*`（不再有 shared 这层概念）

## 8. 强制约束（可机械校验）

```bash
# model 不能依赖 app / ui / service / infra
grep -rn 'from\s*"\.\./\(app\|ui\|service\|infra\)' src/model/ --include='*.ts' --include='*.tsx'
# 必须为空

# model 不能 import React
grep -rn 'from\s*"react"' src/model/ --include='*.ts' --include='*.tsx'
# 必须为空

# model 不能 import @tauri-apps/api
grep -rn 'from\s*"@tauri-apps' src/model/ --include='*.ts' --include='*.tsx'
# 必须为空

# model/<domain>/ 不能 import 兄弟 domain（用 common/ 间接）
grep -rn 'from\s*"\.\./\.\./\(session\|workspace\|terminal\|persistence\|settings\|tmux\|output\|theme\)' src/model/ --include='*.ts' | grep -v 'common\|index'
# 应当极少或为空
```

## 9. 跟 v3 的核心差异

| 维度 | v3 | v4 |
|---|---|---|
| 目录结构 | `src/model/<domain>/`（已有） | 不变 |
| accessor 跟 rules 关系 | 同目录但不同文件 | 同样，但**rules 从 `app/rules/` 收编到 model/<domain>/rules.ts** |
| rules 位置 | `app/rules/` 7 个独立文件 | `model/<domain>/rules.ts` 每个 domain 一份 |
| 跨域纯函数 | `app/rules/textTransform.ts` 等 | `model/common/textTransform.ts` 等 |
| accessor 模板 | 现状已有 | 不变 |

## 10. api.ts 入口（如果需要）

model 是最底层，**通常不需要 api.ts**——其他层直接 import `model/<domain>/types` 等。

但**跨 domain 共享的规则**（如 paneTree 既被 workspace 用又被 session 用）通过 barrel：

```typescript
// src/model/workspace/index.ts
export * from "./types";
export * from "./repository";
export * from "./events";
export * from "./accessor";
export * from "./rules";    // ← paneTree 在这里
```

调用方：

```typescript
import { createLeafPane, findPaneNode } from "@/model/workspace";
// 不需要知道是 types 还是 rules 还是 accessor
```

## 11. 测试

每个 domain 都有 `*.test.ts`：

```
model/session/accessor.test.ts
model/session/rules.test.ts
model/workspace/rules.test.ts    ← paneTree 算法必须 100% 覆盖
```

**为什么 model 测试最重要**：

- model 是最底层——上层（service / app / ui）都依赖它
- model 出 bug = 全 app 出 bug
- model 是纯函数——测试简单，无需 mock

## 12. 跟 service / app / ui 的关系

```
service/   读 model 类型 + 实现 model/repository.ts 接口 + 持有 model 实例
app/       读 model 类型 + 调 model/accessor + 调 model/rules
ui/        读 model 类型 + 调 model/accessor（render 时）
```

model **永远不反向**依赖 service / app / ui。
