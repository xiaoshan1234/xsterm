# Frontend · Service 层

> **位置**：`src/service/`
> **关注点**：跨 module 运行时状态 + IPC 桥
> **平级于**：app / ui / model / infra（5 个顶层目录之一）

## 1. 职责

service 是 frontend 的**运行时层**。它承担 3 类职责：

1. **跨 module 状态容器**——store（zustand / 自己实现的 reactive store），多个 module 共享
2. **IPC 桥**——把 backend 事件（session-output 等）转换成 store mutation，把 store 写操作转换成 IPC invoke
3. **缓冲 / 节流**——输出帧 ring buffer、xterm write 节流、anti-flicker debounce

service **不参与业务编排**——业务流程在 `app/`。service 只是"状态 + 桥"。

## 2. 目录结构

```
src/service/
├── session/          session store + IPC 桥
│   ├── store.ts
│   ├── api.ts        ⭐ SessionService hook
│   └── index.ts
├── workspace/        workspace / window / pane 树 store
├── output/           输出缓冲 + channel
│   ├── buffer.ts     ring buffer
│   ├── channel.ts    session-output 事件桥
│   └── frame.ts      输出帧类型
├── theme/            主题切换 store
├── persistence/      持久化 store（tauri-plugin-store 包装）
├── logger/           前端日志 → backend rolling file
├── settings/         settings store
├── terminal/         terminal preferences store
│
└── index.ts          barrel
```

**每个 `<domain>/` 子目录采用统一模板**：

```
<domain>/
├── store.ts          zustand store 或自实现 reactive store
├── api.ts            ⭐ 对外暴露的 hook（useXxxService）
├── migrations.ts     schema 迁移（如果有持久化）
└── index.ts          barrel：只 re-export api.ts
```

## 3. 关键约束

- service **不参与业务**——业务流程在 app module
- service **不渲染 UI**——UI 在 ui module
- service 暴露的**只有 api.ts**——其他 module 只能 `import { useXxxService } from "@/service/<domain>/api"`
- service **可以依赖 model**（类型 + 派生）
- service **可以依赖 infra**（调 IPC 封装）
- service **不能依赖 app / ui**

## 4. 核心接口模板

每个 `<domain>/api.ts` 暴露一个 hook：

```typescript
// src/service/session/api.ts
import type { Session, SessionConfig } from "@/model/session/types";

export interface SessionService {
  // 读
  list(): ReadonlyArray<Session>;
  get(id: number): Session | undefined;

  // 订阅（响应式）
  useSessions(): ReadonlyArray<Session>;
  useSession(id: number): Session | undefined;

  // 写（内部触发 IPC + 更新 store）
  createLocal(config: LocalSessionConfig): Promise<number>;
  createSsh(config: SshSessionConfig): Promise<number>;
  close(id: number): Promise<void>;

  // 事件订阅
  onOutput(callback: (event: SessionOutputEvent) => void): () => void;
  onClosed(callback: (event: SessionClosedEvent) => void): () => void;
}

export function useSessionService(): SessionService;
```

**关键**：service 不暴露 store 的 setter——必须通过 hook 方法，避免外部直接修改。

## 5. service vs app 的边界

| 维度 | service | app |
|---|---|---|
| 关注什么 | "数据怎么存" + "IPC 怎么调" | "业务怎么编排" |
| 状态 | 跨 module 共享 | 局部（不跨 module）|
| 业务规则 | 无 | 全部在这里 |
| 调用 IPC | 是 | 间接（通过 service） |

**例子**：

```
service/session/store.createLocal(config)
    ↓
1. infra.invoke('create_local_session', config)
2. 监听 'session-created' 事件
3. store.addSession(...)
    ↑
service 不知道业务上下文——只做"调 IPC + 存数据"

app/session/usecases/createLocal.ts
    ↓
1. service/session/api.ts 的 createLocal(...)
2. service/persistence/api.ts 的 saveConfig(...)（如果 shouldSave）
3. app/workspace/api.ts 的 openSession(...)

app 知道业务上下文——"create + save + openInWorkspace"
```

## 6. 跟 model / app / ui / infra 的依赖关系

```
service  ──►  model    (types + 派生)
        │
        └─►  infra    (IPC 封装、event 总线)

app  ──►  service    (通过 service api.ts 边界)
ui   ──►  service    (同上)
```

**禁止**：

- ❌ `service/` → `app/` 或 `ui/`
- ❌ `service/<domain>/` → `service/<other-domain>/api.ts`（避免 service 内部互相依赖——通过 app 编排）
- ❌ `service/` → `@tauri-apps/api` 直接（必须经过 infra）

## 7. 现状 service/ 的问题 → v4 设计意图

| 现状 v3 | v4 设计 |
|---|---|
| `service/` 顶层平铺所有 store | 按 domain 拆 `service/<domain>/` |
| 暴露 `useXxxStore()` + `useXxxStore.getState()` | 只暴露 `useXxxService()`——不暴露 store |
| `service/legacy/hooks/` | 删除（迁到对应 domain 或删除） |
| `service/bridges/` 跟 hook 混在一起 | bridges 是"跨 layer 桥"，归 service 的 api.ts 内部 |
| `service/utils/` 散落 | 移到 model/common/（如果是纯函数）或 service/<domain>/ |

## 8. event bus / channel 设计

service 的"事件桥"是 frontend 接收 backend 事件的关键：

```typescript
// src/service/output/channel.ts
import { listen } from "@/infra/tauri/events/sessionOutput";

export function useSessionOutputChannel(sessionId: number) {
  useEffect(() => {
    const unsubscribe = listen("session-output", (event) => {
      if (event.payload[0] !== sessionId) return;
      const data = new Uint8Array(event.payload[1]);
      useOutputStore.getState().append(sessionId, data);
    });
    return unsubscribe;
  }, [sessionId]);
}
```

**关键**：

- listen 封装在 `infra/tauri/events/`——service 调用封装好的 listener
- service 不直接 import `@tauri-apps/api` 的 listen
- channel 是 service 的"事件 → store"桥

## 9. output buffer / throttle 设计

```typescript
// src/service/output/buffer.ts
export class OutputBuffer {
  private buffer: Uint8Array[] = [];
  private rafId: number | null = null;

  append(data: Uint8Array): void {
    this.buffer.push(data);
    if (this.rafId === null) {
      this.rafId = requestAnimationFrame(() => this.flush());
    }
  }

  private flush(): void {
    const merged = mergeFrames(this.buffer);
    this.buffer = [];
    this.rafId = null;
    this.onFlush(merged);
  }
}
```

**关键**：

- buffer 在 service 层（不是 model 层，因为有 requestAnimationFrame 副作用）
- model 层只定义 OutputFrame / OutputChannel **类型**
- service 层提供具体实现

## 10. 强制约束（可机械校验）

```bash
# service 不能依赖 app / ui
grep -rn 'from\s*"\.\./\(app\|ui\)' src/service/ --include='*.ts' --include='*.tsx'
# 必须为空

# service 不能直跳 @tauri-apps/api（必须经过 infra）
grep -rn 'from\s*"@tauri-apps' src/service/ --include='*.ts' --include='*.tsx'
# 必须为空

# service/<domain>/api.ts 必须存在
test -f src/service/session/api.ts && echo "OK" || echo "missing"
test -f src/service/workspace/api.ts && echo "OK" || echo "missing"
# 9 个 domain 都应当存在 api.ts
```

## 11. 跟 v3 的核心差异

| 维度 | v3 | v4 |
|---|---|---|
| 顶层目录结构 | `src/service/` 平铺 | 不变，但**按 domain 重新组织子目录** |
| 暴露接口 | `useXxxStore()` + `getState()` | 只 `useXxxService()` |
| legacy hooks | `src/service/legacy/hooks/` | 迁到对应 domain 或删除 |
| bridges | `src/service/bridges/` | 散落到各 domain 的 api.ts 内部 |
| output buffer | 在 `src/service/` 顶层 | `src/service/output/buffer.ts`（不变） |

## 12. 测试

每个 domain 都有 `*.test.ts`：

```
service/session/store.test.ts    # store mutation 测试
service/session/api.test.ts      # hook 测试（用 @testing-library/react-hooks）
service/output/buffer.test.ts    # ring buffer + throttle 测试
```

service 测试用 vitest mock infra，**不** mock @tauri-apps/api 本体。

## 13. 跟其他层的关系

```
model/  ←─  service/  (service 读 model 类型 + 调 model/accessor)
infra/  ←─  service/  (service 调 infra 的 invoke / listen 封装)
app/    ←─  service/  (app 通过 service api.ts 编排业务)
ui/     ←─  service/  (ui 通过 service api.ts 订阅状态)
```
