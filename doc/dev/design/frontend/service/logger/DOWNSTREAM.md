# Service · Logger — 对下依赖接口

> **位置**：`src/service/logger/`

## 1. 依赖图

```
service/logger/
├── api.ts        ────►  @/infra/tauri/commands/logging (invoke('log_message'))
├── buffer.ts     ────►  (无——纯 JS)
├── forwarder.ts  ────►  @/infra/tauri/commands/logging
├── level.ts      ────►  (无——纯 JS 过滤)
└── types.ts      ────►  (无——纯类型)
```

## 2. infra/tauri

| 调用 | 来源 | 何时调 |
|---|---|---|
| `invoke('log_message', { level, message, meta })` | `infra/tauri/commands/logging` | forwarder 转发 |

**关键**：logger 是**唯一**直接调 IPC 命令的"非 service 调用方"——其他 service 通常通过 api 间接调。

## 3. model

logger **不依赖 model**——LogEntry 类型在 service 内部定义（不跨 service 共享）。

## 4. 不允许的依赖

- ❌ `service/logger/` → `app/`、`ui/`、`@tauri-apps/api` 直接（必须经过 infra）
- ❌ `service/logger/` → 其他 service api.ts

## 5. 强制约束（可机械校验）

```bash
grep -rn 'from\s*"@tauri-apps' src/service/logger/ --include='*.ts'
# 必须为空

grep -rn 'from\s*"\.\./\(app\|ui\|infra\|model\)' src/service/logger/ --include='*.ts'
# 必须为空（logger 是最纯净的 service 之一）
```

## 6. 设计意图：logger 是单例 + 命令式

`logger` 导出的是**单例**（不是 hook）：

```typescript
export const logger: Logger = createLogger();   // 立即创建
```

**为什么单例**：

- logger 不需要响应式订阅（除 debug UI）
- 单例避免 `useLogger()` 的 hook 嵌套
- 类似 `console.log`——直接调

**为什么不存 store**：

- LogEntry 不需要持久化（除非 debug UI 在看）
- RingBuffer 是 **logger 自己的**内部状态
- 不需要 zustand
