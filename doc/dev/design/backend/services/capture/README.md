# services/capture/ · 目录指引

> **位置**: `src-tauri/src/services/capture/`
> **职责**: screen capture 业务编排层 — 把不同 backend 源 (tmux capture-pane / OutputRing tail / 未来 offscreen) 路由到对应实现;与 `models/capture.rs` (pure function 算法层, RFC 0006 下沉) 并存

## 子 module

| module | 文档 | 职责 |
|---|---|---|
| `mod.rs` (源码) | — | 路由层 — 根据 session type / 模式选择 tmux capture / OutputRing tail |
| `tmux/` | RESPONSIBILITY + INTERFACE + DOWNSTREAM | tmux capture-pane backend 命令封装 (经 IPC 触发) |
| `ansi/` | RESPONSIBILITY + INTERFACE + DOWNSTREAM | ANSI 处理 thin wrapper — 调 `models/capture` pure function 剥离 ANSI 控制序列 |

## 与上下游关系

- **上游触发**: `commands/{session,terminal}` 通过 IPC 调 capture_text / capture_ansi / capture_screenshot
- **下游依赖**: `services/lifecycle/{local,ssh,tmux}` 提供 OutputRing;`models/capture.rs` 提供 pure function
- **历史**: 早期 `services/capture.rs` (1167 行混杂) 由 RFC 0006 拆分;pure 函数下沉到 `models/capture`,业务编排保留 `services/capture/{ansi,tmux}`

详见 [顶层 README §2.2 + §5.2](../../README.md#22-services--业务编排7-子-module-按-lifecycle--状态类型--资源切)。