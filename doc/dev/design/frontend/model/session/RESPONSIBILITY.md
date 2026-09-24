# Model · Session — 职责

> **位置**：`src/model/session/`
> **数据**：session 全生命周期的纯类型 + 算法
> **被使用方**：`service/session`、`app/session`、`ui/session`

## 1. 这个 domain 负责什么

session model 定义 frontend 看到的"一个 session"的所有数据形态和算法。它是 xsterm 的核心数据实体——session 是产品本身，terminal / workspace / settings 都围绕 session 存在。

承担 5 类职责：

1. **数据形状**——Session / SessionConfig / SessionDisplayConfig / SessionKind / SessionStatus
2. **Repository 接口**——SessionRepository（service 实现）
3. **事件契约**——SessionOutputEvent / SessionClosedEvent
4. **派生计算**（accessor）——getActiveSession、getSessionsByKind、getUniqueSessionName
5. **算法**（rules）——applyDisplayConfig、withStatus、withStartedAt、withWorkspaceBinding

## 2. 这个 domain **不**负责什么

- **不持有运行时状态**——纯类型 + 纯函数
- **不调 IPC**——所有 IPC 走 service 或 infra
- **不存 workspace / pane 树**——归 `model/workspace`
- **不存 tmux controller 状态**——归 `model/tmux`

## 3. 子结构

```
model/session/
├── types.ts          # Session / SessionConfig / SessionDisplayConfig / SessionKind / SessionStatus
├── repository.ts     # SessionRepository 接口（service/session 实现）
├── events.ts         # SessionOutputEvent / SessionClosedEvent / SessionEvents 常量
├── accessor.ts       # getActiveSession / getSessionsByKind / getUniqueSessionName
├── rules.ts          # applyDisplayConfig / withStatus / withStartedAt / withWorkspaceBinding
└── *.test.ts
```

## 4. 用户故事（基础设施视角）

- **作为开发者**，我希望快速判断 session 是否活跃 → `getActiveSession(sessions)` 一行代码
- **作为开发者**，我希望不可变更新 session → `applyDisplayConfig(s, patch)` 返回新对象
- **作为开发者**，我希望事件 payload 类型安全 → `SessionOutputEvent { sessionId, data: number[] }`

## 5. 跟其他 model domain 的关系

| domain | 关系 |
|---|---|
| `model/workspace` | Session 持有 `workspaceId / windowId / paneId` 反向引用——纯类型引用 |
| `model/tmux` | tmux session 在 frontend 看是 `Session { kind: "tmux" }`——session kind 归 session model |
| `model/settings` | Session 默认值（defaultShell / defaultSshUser）从 settings 读——纯类型引用 |
| `model/common` | `getUniqueSessionName` 用 `generateId` 作为 fallback |

## 6. 跟 service / app / ui 的关系

| 层 | 怎么用 model/session |
|---|---|
| `service/session` | store schema 用 Session 类型；bridge 触发 `withStatus(s, "closed")` 更新 |
| `app/session` | useCase 签名用 SessionConfig / SessionDisplayConfig |
| `ui/session` | 渲染时用 Session 类型 + `getActiveSession(sessions)` 派生 |

## 7. 这个 domain 的"产品语言"术语

- **session** — 一个后台进程 + 它的连接配置 + 显示配置 + 状态
- **sessionId** — backend 分配的数字 ID
- **session kind** — local / ssh / tmux
- **session status** — connecting / running / closed / error
- **display config** — 字体、字号、主题等显示参数
- **persisted config** — 可跨工作区引用的保存配置

## 8. 关键设计：SessionConfig 是 discriminated union

```typescript
type SessionConfig =
  | LocalSessionConfig
  | SshSessionConfig
  | TmuxCcConfig;
```

每种 kind 有自己的字段（shell / host / sessionName 等）。TypeScript 的 discriminated union 让类型系统**自动**帮我们 narrow：

```typescript
function getShell(c: SessionConfig): string {
  switch (c.kind) {
    case "local": return c.shell;
    case "ssh": return c.shell;
    case "tmux": return "";  // tmux 没有 shell
  }
}
```

## 9. rules 跟 accessor 的边界

- **accessor 是 query**——`getActiveSession(sessions)` 不修改输入
- **rules 是 mutation**——`applyDisplayConfig(s, patch)` 返回**新** Session 对象（immutable）

调用方拿到的永远是新对象，旧对象可以安全丢弃。这让 service 的 zustand store 触发 re-render 时引用比较正常工作。
