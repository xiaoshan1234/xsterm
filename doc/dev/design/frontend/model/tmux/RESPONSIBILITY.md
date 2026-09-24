# Model · Tmux — 职责

> **位置**：`src/model/tmux/`
> **数据**：tmux -CC control mode 的前端镜像类型 + 算法
> **被使用方**：`service/tmux`、`ui/tmux`、`app/terminal`

## 1. 这个 domain 负责什么

tmux model 定义 frontend 看到的"tmux controller 状态"——backend tmux_session/ 子系统的镜像。它是 frontend 跟 backend tmux 控制模式之间的契约。

承担 5 类职责：

1. **数据形状**——TmuxController / AttachedServer / TmuxPane / TmuxWindow
2. **Repository 接口**——TmuxRepository（service 实现）
3. **事件契约**——TmuxPaneAdded / TmuxPaneRemoved / TmuxWindowAdded / TmuxWindowRenamed
4. **派生计算**（accessor）——getControllerByServerName / getAttachedServers / findPaneInController
5. **算法**（rules）——withControllerState / withAttachedServer

## 2. 这个 domain **不**负责什么

- **不持有运行时状态**——纯类型 + 纯函数
- **不存 xsterm session 元数据**——tmux session 在 frontend 看是 `Session { kind: "tmux" }`，归 `model/session`
- **不存 xsterm pane tree**——归 `model/workspace`
- **不实现 tmux -CC 协议**——协议在 backend Rust，frontend 只镜像状态

## 3. 子结构

```
model/tmux/
├── types.ts          # TmuxController / AttachedServer / TmuxPane / TmuxWindow
├── repository.ts     # TmuxRepository 接口
├── events.ts         # TmuxPaneAdded / TmuxPaneRemoved / TmuxWindowAdded / TmuxWindowRenamed
├── accessor.ts       # getControllerByServerName / findPaneInController
├── rules.ts          # withControllerState / withAttachedServer
└── *.test.ts
```

## 4. 用户故事（基础设施视角）

- **作为开发者**，我希望快速查找 controller → `getControllerByServerName(controllers, name)`
- **作为开发者**，我希望不可变更新 controller → `withControllerState(controller, patch)`
- **作为开发者**，我希望事件 payload 类型安全 → `TmuxPaneAddedEvent { controllerSessionId, pane }`

## 5. 跟其他 model domain 的关系

| domain | 关系 |
|---|---|
| `model/session` | tmux session 在 frontend 是 `Session { kind: "tmux" }`——session 持有 tmuxControllerId 引用 |
| `model/workspace` | tmux pane 装在 xsterm pane 里——xsterm pane.binding 引用 session，不直接引用 tmux pane |

## 6. 跟 service / app / ui 的关系

| 层 | 怎么用 model/tmux |
|---|---|
| `service/tmux` | store schema 用 TmuxController 类型；bridge 触发 `withControllerState` 更新 |
| `app/terminal` | useCase 调用 `attach(serverName)` 通过 `service/tmux` |
| `ui/tmux` | 渲染时调 `getControllerByServerName` 派生 |

## 7. 这个 domain 的"产品语言"术语

- **tmux controller** — backend 维护的 tmux -CC 控制连接
- **attached server** — 已 attach 的 tmux server（持久化列表）
- **tmux pane / window** — tmux 自己的概念
- **controller session id** — backend 给 controller 分配的 session id（跟 xsterm sessionId 不同）

## 8. 关键设计：tmux 状态是 backend 镜像

tmux model 的核心原则：

> **frontend 永远只是 backend 的镜像**，不主动构造 controller 状态

- bridge 监听 `tmux-events` 自动同步
- IPC 调用（attach / detach）触发 backend 动作，**然后**等 backend 推事件
- 前端 store 永远只是 backend 状态的视图

这条原则在前端 rules 里体现：

```typescript
// ✅ 正确：等 backend 推事件更新
function handleTmuxEvent(controllers: TmuxController[], event: TmuxEvent): TmuxController[] {
  // 应用事件，更新镜像
  return applyTmuxEvent(controllers, event);
}

// ❌ 错误：前端主动构造 controller 状态
function attach(controllers: TmuxController[], serverName: string): TmuxController[] {
  // 不要这样——应该 invoke backend IPC 然后等事件
  return [...controllers, { serverName, status: "attached" }];
}
```
