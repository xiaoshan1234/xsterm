# Service · Session — 职责

> **位置**：`src/service/session/`
> **类型**：核心数据 domain（跨多个 module 共享状态）
> **被订阅方**：app/session、app/workspace、app/terminal、ui/terminal、ui/workspace、ui/session

## 1. 这个 domain 负责什么

session service 持有**所有 session 的元数据**——xsterm 是"session 容器"，session 元数据是 frontend 最高频订阅的状态。

承担 3 类职责：

1. **session 元数据 store**——`Map<sessionId, Session>`，跨 6 个 module 共享
2. **IPC 桥**——监听 backend 的 `session-output` / `session-closed` 事件 → 更新 store + 派发到 output bridge
3. **会话生命周期编排**——`createLocal / createSsh / createTmux / close / reconnect` 通过 invoke backend IPC

## 2. 这个 domain **不**负责什么

- **不渲染 UI**——UI 订阅 useSessions() 渲染列表
- **不编排跨 module 业务**——业务编排在 app/session（如"创建后装到 workspace"）
- **不直接调 workspace / output / persistence service**——跨 service 协调由 app 编排
- **不存 session 的输出数据**——输出数据归 `service/output`

## 3. 子结构

```
service/session/
├── api.ts            ⭐ 唯一对外入口（useSessionService hook）
├── store.ts          Map<sessionId, Session> + 派生 indexes（按 workspaceId / groupId）
├── bridge.ts         listen('session-output' / 'session-closed') → store mutation + emit 到 output
├── types.ts          SessionEvent / SessionOutputPayload / SessionClosedPayload
└── *.test.ts
```

## 4. 用户故事（基础设施视角）

- **作为用户**，我希望打开 session 后立即在侧栏看见 → useSessions() 触发 re-render
- **作为用户**，我希望 session 关掉后立即从列表消失 → bridge 收到 session-closed → store.remove(id) → re-render
- **作为用户**，我希望 terminal 输出实时显示 → bridge 收到 session-output → 转发到 output service
- **作为用户**，我希望新 session 立即可点击 → createLocal 完成后 store.upsert(newSession)

## 5. 跟其他 domain 的关系

| domain | 关系 |
|---|---|
| `service/output` | bridge 收到 session-output 后**emit** 到 output（不直接调 output api.ts——通过事件总线）|
| `service/persistence` | saved configs CRUD 不归 session service，归 persistence service |
| `service/workspace` | session service **不调** workspace service——业务协调在 app |

## 6. 跟 app/ui 的关系

| module | 怎么用 service/session |
|---|---|
| app/session | `useSessionService()` 编排 create/close/reconnect |
| app/workspace | `useSessionService().get(id)` 读 session 元数据 |
| app/terminal | `useSessionService().get(id)` 读 session.kind 判断是否 tmux |
| ui/terminal | `useSessionService().useSession(id)` 订阅单个 session |
| ui/workspace | `useSessionService().useSessions()` 渲染侧栏列表 |
| ui/session | `useSessionService().useSessions()` 渲染 saved config 列表 |

## 7. 这个 domain 的"产品语言"术语

- **session** — 一个后台进程 + 它的连接配置 + 显示配置 + 状态
- **sessionId** — backend 分配的数字 ID（与 configId 区分）
- **session status** — connecting / running / closed / error
- **session metadata** — id / kind / name / configId / workspaceId / windowId / paneId / status / startedAt
