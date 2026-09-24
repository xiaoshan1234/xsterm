# Infra · Logger — 职责

> **位置**：`src/infra/logger/`
> **类型**：底层原语（infra 子模块，跟 clipboard / buffers / store 同级）
> **被使用方**：所有 module（logger 是全局可用的工具）

## 1. 这个子模块负责什么

infra logger 是 frontend 的**统一日志入口**——所有 module 的日志都通过这里，最终转发到 backend rolling file。

承担 4 类职责：

1. **命令式日志 API**——`logger.trace/debug/info/warn/error(...)` 全 app 共用
2. **前端 ring buffer**——最近 N 条日志的内存缓冲，供 debug UI 显示
3. **转发到 backend**——通过 invoke('log_message') 写到 backend rolling file
4. **level 控制**——根据 settings 的 logLevel 过滤

## 2. 这个子模块 **不**负责什么

- **不渲染 debug UI**——debug UI 是 view 的事（不是单独的 module）
- **不持久化日志**——持久化在 backend（tracing + rolling file writer）
- **不分析日志**——只搬运不分析
- **不持有业务状态**——logger 没有"持久状态"，只是 API 入口

## 3. 子结构

```
infra/logger/
├── api.ts            ⭐ logger 单例（命令式 API，不需要 hook）
├── buffer.ts         RingBuffer<LogEntry>（最近 1000 条）
├── forwarder.ts      invoke('log_message') 转发
├── level.ts          logLevel 过滤
├── types.ts          LogEntry / LogLevel
└── *.test.ts
```

**关键**：logger 是**单例**——不需要 hook，整个 app 共享一个 logger 实例。

## 4. 跟 service 的边界

**为什么 logger 是 infra 不是 service**：

| 维度 | service | infra logger |
|---|---|---|
| 持有状态 | ✅ zustand store | ❌ 没有持久状态 |
| 跨 module | 跨 5+ module | 跨所有 module |
| 调用方式 | `useXxxService()` hook | `logger.info(...)` 直接调 |
| 持久化 | 自己的 store | 转发到 backend |

service 持有**跨 module 共享的运行时状态**。logger 没有这种状态——它只是**调用入口 + 转发**。

## 5. 用户故事

- **作为开发者**，我希望前端错误被记录到 backend 文件 → `logger.error(e)` → invoke('log_message') → backend rolling file
- **作为开发者**，我希望 console.log 也走 logger → 替换 console.* 为 logger.*
- **作为开发者**，我希望 log level 改变立即生效 → settings 改 logLevel → logger.setLevel(level)
- **作为开发者**，我希望 debug 时能看最近 1000 条日志 → `logger.getRecent(100)` 返回

## 6. 跟其他 domain 的关系

| domain | 关系 |
|---|---|
| `infra/store` | 不调——logger 自己 invoke('log_message') |
| `service/settings` | settings.logLevel → logger.setLevel（**settings 反向通知 logger**，不是 logger 监听 settings） |
| 任何 module | 直接调 `logger.info(...)` —— 不需要 hook |

## 7. 跟 app/ui 的关系

所有 module 都直接调 `logger.info(...)` —— 不通过 hook。

**调用示例**：

```typescript
import { logger } from "@/infra/logger/api";

try {
  await sessionSvc.createLocal(config);
} catch (e) {
  logger.error("Failed to create local session", e, { configName: config.name });
}
```

## 8. 这个子模块的"产品语言"术语

- **log entry** — 一条日志（level / message / meta / timestamp）
- **log level** — trace / debug / info / warn / error
- **rolling file** — backend 维护的日志文件（按大小切分）
