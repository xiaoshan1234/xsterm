# Service · Output — 职责

> **位置**：`src/service/output/`
> **类型**：派生数据 domain（不存原数据，存"原数据的视图"）
> **被订阅方**：ui/terminal

## 1. 这个 domain 负责什么

output service 持有**输出帧的 ring buffer**——把 backend 高频推过来的 `session-output` 事件节流到 ~60fps，供 xterm 消费。

承担 3 类职责：

1. **ring buffer**——按 sessionId 索引的 Uint8Array buffer
2. **节流**——把高频事件合并成 60fps 的批量 flush
3. **xterm 写入适配**——buffer flush 时调用注册的 callback（xterm.write）

## 2. 这个 domain **不**负责什么

- **不存 session 元数据**——归 `service/session`
- **不持久化输出**——buffer 是临时的（session 关掉就清空）
- **不解析 ANSI**——ANSI 解析是 xterm 的事，buffer 只搬运原始 bytes
- **不直接调 xterm**——xterm 实例归 `ui/terminal` 持有；output service 通过 callback 推送

## 3. 子结构

```
service/output/
├── api.ts                ⭐ useOutputService hook（注册 xterm callback）
├── buffer.ts             RingBuffer<Uint8Array> 类（按 sessionId 索引）
├── flusher.ts            requestAnimationFrame 节流 + merge bytes
├── types.ts              OutputFrame / FlushEvent
└── *.test.ts
```

## 4. 用户故事

- **作为用户**，我希望 cat 大文件不卡 → buffer 节流到 60fps，xterm 不被高频 write 打爆
- **作为用户**，我希望关闭 session 后不再收到输出 → buffer.remove(sessionId)
- **作为用户**，我希望多 session 同时输出不互相干扰 → 按 sessionId 隔离 buffer

## 5. 跟其他 domain 的关系

| domain | 关系 |
|---|---|
| `service/session` | bridge 在 session-output 事件里**附带 sessionId**——output service 按 sessionId 路由 |
| `infra/tauri/events` | bridge.listen('session-output') → output buffer.append |

## 6. 跟 app/ui 的关系

| module | 怎么用 service/output |
|---|---|
| app | **不直接用**——app 不参与输出流 |
| ui/terminal | `useOutputService().registerCallback(sessionId, xterm.write)` |

**关键**：app 完全不接触 output buffer——buffer 是 UI 渲染层的"渲染队列"。

## 7. 这个 domain 的"产品语言"术语

- **output frame** — 一帧输出（Uint8Array）
- **ring buffer** — 固定容量的循环 buffer（满了覆盖旧数据）
- **flush** — 把 buffer 合并后一次性推给消费者
- **throttle** — 限制 flush 频率到 60fps（避免 xterm 写穿）
