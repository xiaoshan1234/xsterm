# Service · Tmux — 对下依赖接口

> **位置**：`src/service/tmux/`

## 1. 依赖图

```
service/tmux/
├── api.ts        ────►  @/model/tmux/types          (TmuxController / AttachedServer / TmuxPane / TmuxWindow)
├── api.ts        ────►  @/model/session/types       (SessionId 引用)
├── api.ts        ────►  @/infra/tauri/commands/tmux (IPC 封装)
├── api.ts        ────►  @/infra/tauri/events/tmuxEvents (listen)
├── store.ts      ────►  @/model/tmux/types          (持有 controller 实例)
├── bridge.ts     ────►  @/infra/tauri/events/tmuxEvents (listen → mutation)
├── autoAttach.ts ────►  @/service/persistence/api   (加载 attached servers)
├── autoAttach.ts ────►  @/infra/logger              (失败 log)
└── *.test.ts
```

## 2. model/tmux

| 调用 | 来源 |
|---|---|
| `TmuxController` 类型 | `model/tmux/types` |
| `AttachedServer` 类型 | `model/tmux/types` |
| `TmuxPane` / `TmuxWindow` 类型 | `model/tmux/types` |
| `TmuxEvent` 类型（bridge 事件 payload）| `model/tmux/events` |

## 3. model/session（**仅类型引用**）

| 调用 | 来源 |
|---|---|
| `SessionId` 类型 | `model/session/types` |

**关键**：tmux service **不调** session service——只用 `SessionId` 类型做字段关联。

## 4. infra/tauri

| 调用 | 来源 | 何时调 |
|---|---|---|
| `invoke('attach_tmux_session', ...)` | `infra/tauri/commands/tmux` | api.ts attach |
| `invoke('detach_tmux_controller', ...)` | `infra/tauri/commands/tmux` | api.ts detach |
| `invoke('kill_server_via_controller', ...)` | `infra/tauri/commands/tmux` | api.ts killServer |
| `invoke('unmark_attached_tmux', ...)` | `infra/tauri/commands/tmux` | api.ts unmarkAttached |
| `invoke('create_tmux_pane', ...)` | `infra/tauri/commands/tmux` | api.ts createPane |
| `invoke('kill_tmux_pane', ...)` | `infra/tauri/commands/tmux` | api.ts killPane |
| `invoke('resize_tmux_pane', ...)` | `infra/tauri/commands/tmux` | api.ts resizePane |
| `invoke('capture_tmux_pane', ...)` | `infra/tauri/commands/tmux` | api.ts capturePaneContent |
| `invoke('create_tmux_window', ...)` | `infra/tauri/commands/tmux` | api.ts createWindow |
| `invoke('kill_tmux_window', ...)` | `infra/tauri/commands/tmux` | api.ts killWindow |
| `invoke('rename_tmux_window', ...)` | `infra/tauri/commands/tmux` | api.ts renameWindow |
| `listen('tmux-events', ...)` | `infra/tauri/events/tmuxEvents` | bridge 订阅 |

## 5. service/persistence（**仅 autoAttach 用**）

| 调用 | 来源 | 何时调 |
|---|---|---|
| `persistence.get<AttachedServer[]>("attachedTmuxServers")` | `service/persistence/api` | autoAttach 加载 |

**关键**：tmux service 只在 `autoAttach` 路径上调 persistence。其他路径不调持久化——attached server 列表由 app/shell 负责持久化（shutdown 时）。

## 6. infra/logger（**仅 autoAttach 失败 log**）

| 调用 | 来源 | 何时调 |
|---|---|---|
| `logger.warn(...)` | `infra/logger` | autoAttach 失败时 |

**v4 注意**：`service/logger` 已删除（v4 归 `infra/logger`），tmux service 通过 `infra/logger` 单例直接 log。

## 7. 不允许的依赖

- ❌ `service/tmux/` → `app/`、`ui/`、`@tauri-apps/api` 直接
- ❌ `service/tmux/api.ts` → `service/session/api.ts`（用类型不用 service）
- ❌ `service/tmux/` → `service/workspace/api.ts`（pane tree 在 workspace，tmux 不管）

## 8. 强制约束（可机械校验）

```bash
# tmux service 不能直跳 @tauri-apps/api
grep -rn 'from\s*"@tauri-apps' src/service/tmux/ --include='*.ts'
# 必须为空

# tmux service 不能依赖 app / ui
grep -rn 'from\s*"\.\./\(app\|ui\)' src/service/tmux/ --include='*.ts'
# 必须为空

# tmux service 不能调其他 service api.ts（除 persistence 和 logger）
grep -rn 'from\s*"\.\./\(session\|workspace\|output\|terminal\|theme\|settings\)/api' src/service/tmux/ --include='*.ts'
# 必须为空
```

## 9. 设计意图：tmux 是 backend 状态的镜像

tmux service 的核心职责是**镜像 backend tmux_session/ 子系统**——backend 是 source of truth，frontend 是镜像。

**这条原则**：

- bridge 监听 `tmux-events` 自动同步——前端不主动"创建" controller 状态
- IPC 调用（attach / detach）触发 backend 动作，**然后**等待 backend 推事件来更新 frontend store
- 前端 store 永远只是 backend 状态的视图

**反模式**（如果发现说明代码有 bug）：

```typescript
// ❌ 在 tmux service 里手动构造 controller
function attach(serverName: string) {
  invoke('attach_tmux_session', { serverName });
  store.upsertController({ serverName, status: "attached" });  // ❌ 不要这样做
  // 应该等 backend 推 'tmux-events' → bridge → store 自动更新
}
```

## 10. 跨域协调示例

**用户在 ui/tmux 创建一个新 pane**：

```
ui/tmux: 用户点"+"
    ↓
useTmuxService().createPane(controllerSessionId, "horizontal")
    ↓
infra/tauri/commands/tmux.invoke('create_tmux_pane', ...)
    ↓
backend: tmux_session 接收命令，调 tmux -CC 协议创建 pane
    ↓
backend: emit('tmux-events', { type: 'pane-added', paneId, ... })
    ↓
frontend: bridge 收到事件 → store.upsertPane(...)
    ↓
ui/tmux: store 变化 → React re-render → 看见新 pane
```

**关键观察**：

- tmux service **不主动**构造 pane 状态
- 完全依赖 backend push
- 这让 frontend 永远不会跟 backend 不一致
