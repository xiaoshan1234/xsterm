# Service · Output — 对下依赖接口

> **位置**：`src/service/output/`

## 1. 依赖图

```
service/output/
├── api.ts        ────►  @/infra/tauri/events/sessionOutput (触发 flush)
├── buffer.ts     ────►  (无——纯 JS 数据结构)
├── flusher.ts    ────►  (无——用 requestAnimationFrame)
└── types.ts      ────►  @/model/output/types (类型)
```

**output service 几乎不依赖任何东西**——它是"纯渲染队列"。

## 2. infra/tauri（**不直接调**）

output service **不直接 listen**——bridge 在 session service 内部完成，output service 只接收 `push(sessionId, data)` 调用。

**这条规则避免**：output service 监听 'session-output' 事件 → 引入与 session service 的耦合。

## 3. model/output

| 调用 | 来源 |
|---|---|
| `OutputFrame` 类型 | `model/output/types` |
| `mergeFrames(frames[])` 派生 | `model/output/accessor` |

## 4. 不允许的依赖

- ❌ `service/output/` → `app/` 或 `ui/` 或 `@tauri-apps/api`
- ❌ `service/output/` → `infra/tauri/events` 直接 listen
- ❌ `service/output/` → `service/session/api`（只通过 push() 调用，不知道来源）

## 5. 强制约束（可机械校验）

```bash
grep -rn 'from\s*"@tauri-apps' src/service/output/ --include='*.ts'
# 必须为空

grep -rn 'from\s*"\.\./\(app\|ui\|infra\)' src/service/output/ --include='*.ts'
# 必须为空（output service 是最纯净的）

grep -rn 'from\s*"\.\./\(session\|workspace\|theme\|logger\|persistence\|settings\|terminal\)/api' src/service/output/ --include='*.ts'
# 必须为空
```

## 6. 设计意图：output 是最纯净的 service

output service 是 8 个 domain 中**依赖最少**的——它只搬运 bytes，不关心数据来源、不关心 IPC、不关心业务。

这种纯净让它：

- 容易测试（无 mock 依赖）
- 容易替换（可以换成 Web Worker、SharedArrayBuffer 实现）
- 不参与跨 service 协调
