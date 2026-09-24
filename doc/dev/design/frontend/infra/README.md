# Frontend · Infra 层

> **位置**：`src/infra/`
> **关注点**：物理适配（IPC / 存储 / 剪贴板 / 缓冲）
> **平级于**：app / ui / model / service（5 个顶层目录之一）

## 1. 职责

infra 是 frontend 的**物理适配层**。它承担 4 类职责：

1. **Tauri IPC 适配**——`invoke()` 封装（commands）、`listen()` 封装（events）、Repository 接口实现
2. **本地持久化**——`tauri-plugin-store` 包装
3. **剪贴板**——剪贴板读写（`navigator.clipboard` + `tauri-plugin-clipboard-manager`）
4. **输出缓冲**——ring buffer、节流、帧解析

**最关键的约束**：

> **infra 是 frontend 唯一允许直接 `import` `@tauri-apps/api` 的地方**。
> 其他层（model / service / app / ui）必须经过 infra 才能用 IPC。

这条约束把 "IPC 污染" 限制在一个目录——审查 IPC 改动只需要看 infra。

## 2. 目录结构

```
src/infra/
├── tauri/              Tauri IPC 适配
│   ├── commands/       invoke 封装（按 backend domain 拆）
│   │   ├── session.ts
│   │   ├── workspace.ts
│   │   ├── tmux.ts
│   │   └── persistence.ts
│   ├── events/         listen 封装
│   │   ├── sessionOutput.ts
│   │   ├── sessionClosed.ts
│   │   └── tmuxEvents.ts
│   ├── repositories/   Repository 接口实现（对应 model/repository.ts）
│   ├── eventBuses/     按 domain 的事件总线
│   │   ├── session.ts
│   │   └── tmux.ts
│   ├── eventBus.ts     通用事件总线底座
│   └── index.ts
│
├── store/              本地持久化（tauri-plugin-store）
│   ├── savedConfigs.ts
│   ├── savedWorkspaces.ts
│   ├── savedWindows.ts
│   ├── groups.ts
│   └── migrations.ts
│
├── clipboard/          剪贴板读写
│   ├── read.ts
│   └── write.ts
│
├── buffers/            输出帧缓冲
│   ├── sessionOutputBuffer.ts
│   ├── sessionOutputChannel.ts
│   └── sessionOutputFrame.ts
│
├── logger/             前端 logger
│   ├── logger.ts
│   └── types.ts
│
├── icons/              Icon 组件
│
└── styles/             设计系统 CSS
    ├── global.css
    ├── layout.css
    └── pane.css
```

## 3. 关键约束

- **infra 是唯一允许 `import { invoke } from "@tauri-apps/api"` 的层**
- service / app / ui 出现 `invoke` / `listen` 字面量 = 架构违规
- invoke 调用必须经过 `repositories/`——不允许 service 直接 import `commands/` 内部
- 错误统一抛 typed error，不抛裸 `Error` 或 string
- 事件总线 (`eventBus.ts`) 是 infra 的核心

## 4. invoke / listen 封装模板

### 4.1 `commands/<domain>.ts`

```typescript
// src/infra/tauri/commands/session.ts
import { invoke } from "@tauri-apps/api/core";
import type { LocalSessionConfig, SshSessionConfig } from "@/model/session/types";

export const sessionCommands = {
  createLocal: (config: LocalSessionConfig) =>
    invoke<number>("create_local_session", { config }),

  createSsh: (config: SshSessionConfig) =>
    invoke<number>("create_ssh_session", { config }),

  close: (sessionId: number) =>
    invoke<void>("close_session", { sessionId }),

  write: (sessionId: number, data: Uint8Array) =>
    invoke<void>("write_session", { sessionId, data }),
};
```

### 4.2 `events/<event>.ts`

```typescript
// src/infra/tauri/events/sessionOutput.ts
import { listen, UnlistenFn } from "@tauri-apps/api/event";

export interface SessionOutputPayload {
  sessionId: number;
  data: number[];   // backend 发 UTF-8 byte array
}

export function listenSessionOutput(
  callback: (event: SessionOutputPayload) => void
): Promise<UnlistenFn> {
  return listen<SessionOutputPayload>("session-output", (event) => {
    callback(event.payload);
  });
}
```

### 4.3 `repositories/<domain>.ts`

```typescript
// src/infra/tauri/repositories/sessions.ts
import type { SessionRepository } from "@/model/session/repository";
import { sessionCommands } from "../commands/session";
import { listenSessionOutput } from "../events/sessionOutput";

export const sessionRepository: SessionRepository = {
  async createLocal(config) {
    const id = await sessionCommands.createLocal(config);
    return { id, /* ... */ };
  },
  async close(id) {
    await sessionCommands.close(id);
  },
  // ...
};
```

## 5. event bus 设计

infra 提供 2 层事件总线：

```typescript
// 底层：通用 eventBus（key-value 事件）
import { eventBus } from "@/infra/tauri/eventBus";

eventBus.on("session-output", (payload) => { /* ... */ });
eventBus.emit("session-output", payload);

// 上层：domain-specific eventBuses（带类型化 payload）
import { sessionEventBus } from "@/infra/tauri/eventBuses/session";

sessionEventBus.onOutput((event) => { /* event 类型安全 */ });
sessionEventBus.emitOutput(event);
```

**service 层订阅时只用上层**（带类型）——infra 内部用底层 + listen 桥接到上层。

## 6. store 持久化

`src/infra/store/` 用 `tauri-plugin-store` 持久化本地数据：

```typescript
// src/infra/store/savedConfigs.ts
import { Store } from "@tauri-apps/plugin-store";

const store = await Store.load("savedConfigs.json");

export const savedConfigsStore = {
  async getAll(): Promise<PersistedSessionConfig[]> {
    return await store.get("configs") ?? [];
  },
  async upsert(config: PersistedSessionConfig): Promise<void> {
    const configs = await this.getAll();
    const updated = configs.filter(c => c.id !== config.id).concat(config);
    await store.set("configs", updated);
    await store.save();
  },
};
```

**schema migration**：当 store 文件从老版本升级时，`migrations.ts` 处理数据转换。

## 7. clipboard 适配

```typescript
// src/infra/clipboard/read.ts
import { readText } from "@tauri-apps/plugin-clipboard-manager";

export async function readClipboardText(): Promise<string> {
  return await readText();
}

// src/infra/clipboard/write.ts
import { writeText } from "@tauri-apps/plugin-clipboard-manager";

export async function writeClipboardText(text: string): Promise<void> {
  return await writeText(text);
}
```

## 8. buffers（输出缓冲）

```typescript
// src/infra/buffers/sessionOutputBuffer.ts
export class SessionOutputBuffer {
  // ring buffer 实现（参考现状代码）
}
```

**关键**：

- buffer 在 infra 层（不是 model 层，因为涉及 requestAnimationFrame 副作用）
- model 层只定义 OutputBuffer **类型**
- infra 层提供具体实现

## 9. logger

```typescript
// src/infra/logger/logger.ts
import { invoke } from "@tauri-apps/api/core";

export const logger = {
  info(message: string, meta?: object): void {
    console.info(message, meta);
    invoke("log_message", { level: "info", message, meta }).catch(() => {});
  },
  error(message: string, error?: Error): void {
    console.error(message, error);
    invoke("log_message", { level: "error", message, error: error?.message }).catch(() => {});
  },
};
```

## 10. 跟 service / app / ui / model 的依赖关系

```
infra  ──►  (无——只依赖 @tauri-apps/api)

service  ──►  infra   (service 通过 infra 的 commands/events 间接调 IPC)
app     ──►  service  (app 通过 service 调 IPC，**不直接调 infra**)
ui      ──►  service  (ui 同上)
model   ──►  (无)
```

**禁止**：

- ❌ `infra/` → `service/` 或 `app/` 或 `ui/` 或 `model/`
- ❌ `app/` 或 `ui/` → `infra/` 直接（必须经过 service）
- ❌ `model/` → `infra/`（model 是最底层）

## 11. 现状 infra/ 的问题 → v4 设计意图

| 现状 v3 | v4 设计 |
|---|---|
| `infra/tauri/commands/` 直接被 service / app import | 必须经过 `infra/tauri/repositories/` |
| `infra/eventBus.ts` 单例 | 拆分为底层 `eventBus` + 上层 `eventBuses/<domain>.ts` |
| `infra/store/` 没有 migration 机制 | 加 `migrations.ts` |
| `infra/clipboard/` 薄包装 | 保持不变（未来扩 image/html 时再分文件） |

## 12. 强制约束（可机械校验）

```bash
# infra 是唯一允许直跳 @tauri-apps/api 的层
grep -rn 'from\s*"@tauri-apps' src/ --include='*.ts' --include='*.tsx' | grep -v 'src/infra/'
# 必须为空

# app / ui 不能 import infra 内部（只能通过 service）
grep -rn 'from\s*"\.\./infra/' src/app/ src/ui/ --include='*.ts' --include='*.tsx'
# 必须为空

# infra 不能 import service / app / ui / model（除 model 类型）
grep -rn 'from\s*"\.\./\(service\|app\|ui\)' src/infra/ --include='*.ts' --include='*.tsx'
# 必须为空
```

## 13. 测试

```
infra/tauri/commands/session.test.ts       # mock @tauri-apps/api
infra/store/savedConfigs.test.ts           # mock Store
infra/buffers/sessionOutputBuffer.test.ts  # ring buffer 单元测试
```

infra 测试用 vitest mock `@tauri-apps/api` 的 `invoke` 和 `listen`。

## 14. 跟其他层的关系

```
@tauri-apps/api  ◄────  infra/  (唯一)
                        │
                        └────  service/  (通过 commands / events / repositories)
                                │
                                └────  app/ + ui/  (通过 service api.ts)
```
