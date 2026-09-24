# Infra · Logger — 对外接口

> **位置**：`src/infra/logger/api.ts`
> **唯一进口**：`import { logger, type Logger, type LogLevel, type LogEntry } from "@/infra/logger/api"`

## 1. 接口（**单例**，不是 hook）

```typescript
export type LogLevel = "trace" | "debug" | "info" | "warn" | "error";

export interface LogEntry {
  level: LogLevel;
  message: string;
  meta?: Record<string, unknown>;
  error?: { name: string; message: string; stack?: string };   // 序列化后的 Error
  timestamp: number;
}

export interface Logger {
  // ============ 命令式调用 ============
  trace(message: string, meta?: Record<string, unknown>): void;
  debug(message: string, meta?: Record<string, unknown>): void;
  info(message: string, meta?: Record<string, unknown>): void;
  warn(message: string, meta?: Record<string, unknown>): void;
  error(message: string, error?: Error | unknown, meta?: Record<string, unknown>): void;

  // ============ 配置 ============
  setLevel(level: LogLevel): void;
  getLevel(): LogLevel;

  // ============ 调试用 ============
  /** 获取最近 N 条日志（前端 ring buffer） */
  getRecent(count: number): ReadonlyArray<LogEntry>;
  /** 订阅新日志（debug UI 用） */
  onAppend(callback: (entry: LogEntry) => void): () => void;
}

/** 全局 logger 单例——不需要 hook */
export const logger: Logger;
```

## 2. 关键设计

**为什么 logger 是单例而不是 hook**：

- logger 是**命令式 API**——`logger.info(...)` 直接调
- 不需要响应式订阅（除 debug UI）
- 单例避免每次 import 都创建实例
- 类比：`console.log` 也是单例

**`getRecent` + `onAppend` 给 debug UI 用**：

- 不是 logger 的"主路径"——是开发辅助
- 可以独立做"前端 debug UI"

**`error` 方法的特殊签名**：

```typescript
error(message: string, error?: Error | unknown, meta?: Record<string, unknown>): void
```

- `error` 接收 Error 对象（不是 meta）—— 单独处理序列化
- Error 序列化成 `{ name, message, stack }` 跨 IPC 边界

## 3. 不对外暴露

- `buffer.ts` 的 RingBuffer 容量（默认 1000）
- `forwarder.ts` 的 invoke 错误处理细节

## 4. 接缝契约

```
// 任何 module
import { logger } from "@/infra/logger/api";

try {
  await sessionSvc.createLocal(config);
} catch (e) {
  logger.error("Failed to create local session", e, { configName: config.name });
}
```

```
// debug UI（如果有）
import { logger } from "@/infra/logger/api";

function DebugLogView() {
  const [entries, setEntries] = useState<LogEntry[]>([]);
  useEffect(() => {
    return logger.onAppend((entry) => setEntries(prev => [...prev, entry]));
  }, []);
  return <List items={entries} />;
}
```

## 5. api.ts 变更流程

1. **新增 log level** → 加 type + setLevel 支持
2. **新增方法** → 加 buffer / forwarder + api.ts
