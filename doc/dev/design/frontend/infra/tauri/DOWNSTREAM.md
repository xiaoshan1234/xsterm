# Infra · Tauri — 对下依赖接口

> **位置**：`src/infra/tauri/`

## 1. 依赖图

```
infra/tauri/
├── commands/session.ts
│   ├──► @tauri-apps/api/core              (invoke)
│   └──► @/model/session/types            (SessionConfig 等类型)
│
├── events/sessionOutput.ts
│   ├──► @tauri-apps/api/event              (listen)
│   ├──► @/model/session/events            (SessionOutputEvent 类型)
│   └──► ./eventBuses/session               (emit to bus)
│
├── repositories/sessions.ts
│   ├──► @/model/session/repository         (SessionRepository 接口)
│   ├──► @/model/session/types              (类型)
│   └──► ./commands/session                 (invoke)
│
├── eventBuses/eventBus.ts                  (浏览器 EventTarget，无依赖)
├── eventBuses/session.ts                   ──► ./eventBus + ./events
│
└── api.ts                                   聚合所有 export
```

## 2. @tauri-apps/api（**infra 唯一允许**）

| 子模块 | API | 文件 |
|---|---|---|
| invoke | `@tauri-apps/api/core` | `commands/*` |
| listen | `@tauri-apps/api/event` | `events/*` |

**这条规则严格**：除了 `infra/tauri/` 内部，**任何其他文件都不允许**直接 import `@tauri-apps/api`。

## 3. model

| 调用 | 来源 | 何时调 |
|---|---|---|
| `SessionConfig` / `SshSessionConfig` 等 | `model/session/types` | commands 参数类型 |
| `Session` interface | `model/session/types` | repositories 返回值 |
| `SessionRepository` interface | `model/session/repository` | repositories 实现此接口 |
| `SessionOutputEvent` / `SessionClosedEvent` | `model/session/events` | events payload 类型 |

**关键**：infra 只读 model 类型，**不读 model runtime 值**。

## 4. service 间接调用

```
service/session/store.ts
    ├──► @/infra/tauri/repositories/sessions.ts   (创建 session 调 backend)
    └──► @/infra/tauri/eventBuses/session         (订阅 session-output)

service/session/bridge.ts
    ├──► @/infra/tauri/events/sessionOutput        (启动 listen)
    └──► @/infra/tauri/eventBuses/session         (转发到 bus)
```

**service 不直接 import `commands/*` 或 `events/*`——通过 repositories 和 eventBuses 间接使用**。

## 5. 不允许的依赖

- ❌ `infra/tauri/` → `app/` `ui/` `service/`
- ❌ `infra/tauri/` → 其他 model domain（除 types/events/repository）
- ❌ `infra/tauri/commands/*` → `infra/tauri/repositories/*`（反之亦然）——commands 和 repositories 平级
- ❌ `infra/tauri/events/*` → `infra/tauri/commands/*`（events 独立）

## 6. 强制约束（可机械校验）

```bash
# infra/tauri 是唯一允许直跳 @tauri-apps/api 的目录（除 logger）
grep -rn 'from\s*"@tauri-apps' src/infra/tauri/ --include='*.ts'
# 应当出现（commands 和 events）

# 其他目录不能直跳 @tauri-apps/api
grep -rn 'from\s*"@tauri-apps' src/ --include='*.ts' | grep -v 'src/infra/'
# 必须为空

# infra/tauri 不能依赖 app / ui / service
grep -rn 'from\s*"\.\./\(app\|ui\|service\)' src/infra/tauri/ --include='*.ts'
# 必须为空

# commands 和 repositories 不能互相调
grep -rn 'from\s*"\.\./\(commands\|repositories\)' src/infra/tauri/commands/ --include='*.ts'
# 必须为空
grep -rn 'from\s*"\.\./\(commands\|repositories\)' src/infra/tauri/repositories/ --include='*.ts'
# 必须为空（除 repositories → commands 允许）

# service 不能直接调 commands（只能通过 repositories）
grep -rn 'from\s*"\.\./infra/tauri/commands' src/service/ --include='*.ts'
# 必须为空
```

## 7. 跟 backend 的契约同步

`@tauri-apps/api` 跟 backend Rust 的 IPC 契约必须严格同步：

- backend 新增 `#[tauri::command]` → frontend 加 `commands/<domain>.ts` 封装
- backend emit 新事件 → frontend 加 `events/<event>.ts` 封装
- backend 修改 payload 类型 → frontend 更新 model/<domain>/events.ts

**这条契约是 frontend ↔ backend 的接口**——任何一边变化都要同步另一边。
