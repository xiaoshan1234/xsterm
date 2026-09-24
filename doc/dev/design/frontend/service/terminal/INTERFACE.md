# Service · Terminal — 对外接口

> **位置**：`src/service/terminal/api.ts`
> **唯一进口**：`import { useTerminalService, type TerminalService } from "@/service/terminal/api"`

## 1. 接口

```typescript
import type { Terminal } from "@xterm/xterm";
import type { TerminalPreferences, TerminalTheme } from "@/model/terminal/types";

export interface TerminalService {
  /**
   * 注册 xterm 实例到指定 session
   * 注册后可以用 find / fit / apply 等方法操作
   * 返回 unregister 函数
   */
  register(sessionId: number, instance: Terminal): () => void;

  /**
   * 查找 session 的 xterm 实例（命令式）
   */
  find(sessionId: number): Terminal | undefined;

  /**
   * 应用 fit（cols/rows 自适应）
   */
  fit(sessionId: number): void;
  fitAll(): void;

  /**
   * 应用偏好到所有已注册的实例
   */
  applyPreferences(prefs: Partial<TerminalPreferences>): void;

  /**
   * 应用 theme 到所有已注册的实例
   */
  applyTheme(theme: TerminalTheme): void;

  /**
   * 写数据到指定 session 的 xterm（命令式）
   */
  write(sessionId: number, data: Uint8Array): void;
}

export function useTerminalService(): TerminalService;
```

## 2. 关键设计

**xterm 实例不存 zustand**：

- zustand 不能存非序列化对象（xterm 有循环引用）
- 用普通 `Map<sessionId, Terminal>` 做注册表
- hook 暴露查找 + 操作方法

**`fit` / `applyPreferences` 跨实例**：

- `fit(sessionId)` — 单个实例
- `fitAll()` — 所有实例（settings 变更时）
- `applyPreferences(prefs)` — 全局应用

**关键**：terminal service **不创建** xterm 实例——只**注册** UI 创建的实例。

## 3. 不对外暴露

- `registry.ts` 的 Map 内部
- xterm options 的具体应用逻辑

## 4. 接缝契约

```
// ui/terminal/view/Terminal.tsx
import { useTerminalService } from "@/service/terminal/api";

function Terminal({ sessionId }) {
  const termRef = useRef<Terminal>(null);
  const terminalSvc = useTerminalService();

  useEffect(() => {
    if (!termRef.current) return;
    return terminalSvc.register(sessionId, termRef.current);
  }, [sessionId]);
}
```

```
// app/settings/usecases/apply/terminalPrefs.ts
import { useTerminalService } from "@/service/terminal/api";

const terminal = useTerminalService();
terminal.applyPreferences({ fontSize: 14 });
terminal.fitAll();
```

## 5. api.ts 变更流程

1. **新增 method** → 加 registry + api.ts
2. **修改 method 签名** → 同步更新 §1
