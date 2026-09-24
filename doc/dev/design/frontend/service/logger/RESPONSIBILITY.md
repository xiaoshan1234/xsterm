# Service · Logger — 职责

> **位置**：`src/service/logger/`
> **类型**：横切 domain
> **被订阅方**：所有 module（logger 是基础设施）

## 1. 这个 domain 负责什么

logger service 是**前端日志的统一入口**——所有 module 的 console 调用都通过 logger，最终转发到 backend rolling file。

承担 4 类职责：

1. **日志调用入口**——`logger.info/debug/warn/error(msg, meta?)` 全 app 共用
2. **前端 ring buffer**——最近 1000 条日志的内存缓冲，供 debug UI 显示
3. **转发到 backend**——通过 invoke('log_message') 把日志写到 backend rolling file
4. **level 控制**——根据 settings 的 logLevel 过滤

## 2. 这个 domain **不**负责什么

- **不渲染日志 UI**——debug UI 是某个 view 的事（不是单独的 module）
- **不持久化日志**——持久化在 backend（tracing + rolling file writer）
- **不分析日志**——只搬运不分析

## 3. 子结构

```
service/logger/
├── api.ts                ⭐ logger singleton（不需要 hook——全局单例）
├── buffer.ts             RingBuffer<LogEntry>（最近 1000 条）
├── forwarder.ts          invoke('log_message') 转发
├── level.ts              logLevel 过滤
├── types.ts              LogEntry / LogLevel
└── *.test.ts
```

**关键**：logger 是**单例**——不需要 hook，整个 app 共享一个 logger 实例。其他 service 都用 hook 是因为 store 有响应式订阅；logger 是命令式的，直接 `logger.info(...)`。

## 4. 用户故事

- **作为开发者**，我希望前端错误被记录到 backend 文件 → logger.error(e) → invoke('log_message') → backend rolling file
- **作为开发者**，我希望 console.log 也走 logger → 现状替换 console.* 为 logger.*
- **作为开发者**，我希望 log level 改变立即生效 → settings 改 logLevel → logger.setLevel(level)

## 5. 跟其他 domain 的关系

| domain | 关系 |
|---|---|
| `service/settings` | settings.logLevel → logger.setLevel |
| `infra/tauri` | logger.forwarder 调 invoke('log_message') |

## 6. 跟 app/ui 的关系

所有 module 都直接调 `logger.info(...)` —— 不通过 hook。

## 7. 这个 domain 的"产品语言"术语

- **log entry** — 一条日志（level / message / meta / timestamp）
- **log level** — trace / debug / info / warn / error
- **rolling file** — backend 维护的日志文件（按大小切分）
