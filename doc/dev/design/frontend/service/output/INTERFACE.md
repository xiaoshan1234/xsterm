# Service · Output — 对外接口

> **位置**：`src/service/output/api.ts`
> **唯一进口**：`import { useOutputService, type OutputService } from "@/service/output/api"`

## 1. 接口

```typescript
export interface OutputService {
  /**
   * 注册 xterm write callback 到指定 session
   * 返回 unregister 函数
   */
  registerCallback(sessionId: number, write: (data: Uint8Array) => void): () => void;

  /**
   * 手动 push 一帧（bridge 用，session-output 事件回调里调用）
   */
  push(sessionId: number, data: Uint8Array): void;

  /**
   * 清理 session 的所有 buffer（session close 时调用）
   */
  clear(sessionId: number): void;

  /**
   * 全局清理（app 退出时调用）
   */
  clearAll(): void;

  /**
   * 订阅"flush 事件"（每次合并后触发）
   * callback 收到的是合并后的 Uint8Array
   */
  onFlush(callback: (event: { sessionId: number; data: Uint8Array }) => void): () => void;
}

export function useOutputService(): OutputService;
```

## 2. 关键设计

**push 是命令式，flush 事件是订阅式**：

- `push` — bridge 调用（不发 re-render）
- `onFlush` — xterm 订阅（每 16ms 触发一次）

**registerCallback vs onFlush**：

- `registerCallback` — 把单个 xterm.write 绑定到特定 sessionId（最常用）
- `onFlush` — 通用订阅，多消费者可用（debug UI 也可订阅）

**buffer 生命周期跟 session**：

- `clear(sessionId)` 在 session close 时调
- 不持久化（buffer 是临时的）

## 3. 不对外暴露

- `buffer.ts` 的 RingBuffer 内部
- `flusher.ts` 的 requestAnimationFrame 逻辑

## 4. 接缝契约

```
// ui/terminal/view/Terminal.tsx
import { useOutputService } from "@/service/output/api";

function Terminal({ sessionId }) {
  const xtermRef = useRef<Terminal>();

  useEffect(() => {
    if (!xtermRef.current) return;
    const unregister = outputSvc.registerCallback(sessionId, (data) => {
      xtermRef.current!.write(data);
    });
    return unregister;
  }, [sessionId]);
}
```

```
// service/session/bridge.ts（内部）
outputSvc.push(event.sessionId, new Uint8Array(event.data));
```

## 5. api.ts 变更流程

1. **新增 method** → 加 buffer / flusher + api.ts
2. **修改 method 签名** → 同步更新 §1
