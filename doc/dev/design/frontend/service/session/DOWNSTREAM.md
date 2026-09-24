# Service · Session — 对下依赖接口

> **位置**：`src/service/session/`

## 1. 依赖图

```
service/session/
├── api.ts        ────►  @/model/session/types           (类型)
├── api.ts        ────►  @/model/session/events         (事件契约)
├── api.ts        ────►  @/infra/tauri/commands/session (IPC 封装)
├── api.ts        ────►  @/infra/tauri/events/sessionOutput (listen)
├── store.ts      ────►  @/model/session/types           (持有 Session 实例)
├── store.ts      ────►  @/model/session/accessor        (派生计算)
├── bridge.ts     ────►  @/infra/tauri/events/...        (listen → mutation)
├── bridge.ts     ────►  ./store.ts                      (写 store)
└── bridge.ts     ────►  @/service/output/api            (output push)
```

## 2. model/session

| 调用 | 来源 | 何时调 |
|---|---|---|
| `Session` / `SessionKind` / `SessionStatus` 类型 | `model/session/types` | store schema + api.ts 类型 |
| `SessionOutputEvent` / `SessionClosedEvent` 类型 | `model/session/events` | api.ts onOutput / onClosed |
| `applyStatus(session, status)` 等派生 | `model/session/rules` | store mutation 时生成新 Session |
| `getActiveSession(sessions)` 等 query | `model/session/accessor` | api.ts list() / get() 内部 |

## 3. infra/tauri

| 调用 | 来源 | 何时调 |
|---|---|---|
| `invoke('create_local_session', config)` | `infra/tauri/commands/session` | api.ts createLocal |
| `invoke('create_ssh_session', config)` | `infra/tauri/commands/session` | api.ts createSsh |
| `invoke('create_tmux_session', config)` | `infra/tauri/commands/session` | api.ts createTmux |
| `invoke('close_session', { sessionId })` | `infra/tauri/commands/session` | api.ts close |
| `invoke('write_session', { sessionId, data })` | `infra/tauri/commands/session` | ui/terminal 调（不是 service）|
| `listen('session-output', ...)` | `infra/tauri/events/sessionOutput` | bridge 订阅 |
| `listen('session-closed', ...)` | `infra/tauri/events/sessionClosed` | bridge 订阅 |

## 4. service/output（**唯一允许的 service 内部调用**）

| 调用 | 来源 | 何时调 |
|---|---|---|
| `outputSvc.push(sessionId, data)` | `service/output/api` | bridge 收到 session-output 时 |

**这是 service 之间**唯一**允许的调用**——其他 service 之间不互相调。理由：session-output 必须路由到 output buffer，不通过 app 编排（避免时延）。

## 5. 不允许的依赖

- ❌ `service/session/` → `app/` 或 `ui/` 或 `@tauri-apps/api` 直接
- ❌ `service/session/api.ts` → `service/workspace/api.ts`（跨 service 不互相调，跨域协调由 app 编排）

## 6. 强制约束（可机械校验）

```bash
# service 不能直跳 @tauri-apps/api
grep -rn 'from\s*"@tauri-apps' src/service/session/ --include='*.ts'
# 必须为空

# service/session 不能依赖 app / ui
grep -rn 'from\s*"\.\./\(app\|ui\)' src/service/session/ --include='*.ts'
# 必须为空

# session service 不能调其他 service api.ts（除 output）
grep -rn 'from\s*"\.\./\(workspace\|theme\|logger\|persistence\|settings\|terminal\)/api' src/service/session/ --include='*.ts'
# 必须为空（只允许 ./output/api）
```
