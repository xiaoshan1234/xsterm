# Service · Tmux — 职责

> **位置**：`src/service/tmux/`
> **类型**：派生数据 domain（backend tmux control mode 的镜像状态）
> **被订阅方**：ui/tmux（control mode UI）、app/terminal（tmux 业务编排）、app/shell（auto attach）

## 1. 这个 domain 负责什么

tmux service 持有 **backend tmux control mode 的前端镜像**——backend Rust 的 `tmux_session/` 子系统维护一组 tmux controller，frontend 在 `service/tmux/` 镜像这套状态。

承担 4 类职责：

1. **tmux controller 状态 store**——`Map<serverName, TmuxController>`，每个 controller 是 backend 的镜像
2. **attached server 列表 store**——`List<{ serverName, attachedAt }>`，持久化用
3. **IPC 桥**——监听 backend 的 `tmux-events` 事件 → 更新 store
4. **auto-attach 触发**——启动时自动 attach 上次的 tmux server

## 2. 这个 domain **不**负责什么

- **不存 session 元数据**——tmux session 在 `service/session`
- **不渲染 tmux control window**——UI 在 `ui/tmux/`
- **不直接调 backend 创建 controller**——controller 创建是 backend 的事，由 `app/session/usecases/createTmux.ts` 触发；tmux service 只镜像 backend 推过来的状态
- **不存 pane tree**——pane tree 归 `service/workspace`

## 3. 子结构

```
service/tmux/
├── api.ts            ⭐ useTmuxService hook
├── store.ts          controllers Map + attachedServers List（zustand）
├── bridge.ts         listen('tmux-events', ...) → store mutation
├── autoAttach.ts     启动时自动 attach 上次的 server
├── types.ts          TmuxController / AttachedServer / TmuxEvent
└── *.test.ts
```

## 4. 用户故事

- **作为用户**，我希望打开 tmux session 后立即看见 control window → controller 状态变化 → UI 渲染
- **作为用户**，我希望 tmux attach server 列表被持久化，下次启动自动 attach → attachedServers store + persistence
- **作为用户**，我希望 tmux pane 创建时 UI 立即更新 → bridge 收到 tmux-pane-added 事件 → 同步 session 元数据
- **作为用户**，我希望 tmux 状态变化时 terminal kind 自动从 local 变 tmux → session store 通过 tmux bridge 同步

## 5. 跟其他 domain 的关系

| domain | 关系 |
|---|---|
| `service/session` | 不直接调——通过 backend 事件隐式同步（session 创建时 backend 启动 tmux controller，controller 推事件到 frontend，frontend 同时更新 session store 和 tmux store）|
| `service/persistence` | app/shell 调 persistence 加载 attachedServers，启动时调 tmux autoAttach |
| `infra/tauri` | bridge 监听 `tmux-events` + invoke tmux IPC 命令 |

## 6. 跟 app/ui 的关系

| module | 怎么用 service/tmux |
|---|---|
| app/terminal | `useTmuxService().attach(serverName)` 触发 attach |
| app/shell | `useTmuxService().autoAttachOnStartup()` |
| app/session | 创建 tmux session 后**不调** tmux service——backend 推事件自然同步 |
| ui/tmux | `useTmuxService().useControllers()` 渲染 control window 列表 |

## 7. 这个 domain 的"产品语言"术语

- **tmux controller** — backend 维护的 tmux -CC 控制连接（每个 controller 对应一个 tmux server）
- **attached server** — 已 attach 的 tmux server（持久化到 attached tmux servers 列表）
- **tmux pane / window** — tmux 自己的概念（跟 xsterm pane / window **不完全对应**——见 §8）
- **auto-attach** — 启动时自动重新 attach 上次的 server

## 8. 关键设计：tmux 跟 session 的边界

**tmux pane 跟 xsterm pane 不完全对应**：

- **xsterm pane** = 一个终端显示区域（`service/workspace` 管的 pane tree）
- **tmux pane** = tmux 自己的 pane（backend 镜像在 `service/tmux`）

一个 xsterm pane 可能**包含**一个 tmux pane（tmux session 装在 xsterm pane 里）。反向不一定（local session 不含 tmux pane）。

**所以**：

- `service/workspace` 管 xsterm pane tree
- `service/tmux` 管 tmux pane 镜像
- 两者通过 `Session.tmuxPaneId?` 字段关联

## 9. tmux auto-attach 设计

```typescript
// service/tmux/autoAttach.ts
export async function autoAttachOnStartup(): Promise<void> {
  const tmux = useTmuxService();

  // 不再从 frontend persistence 读 attachedServers —— backend 是 source of truth
  // 调 backend `auto_attach_tmux_servers` IPC 触发 backend `domain::session::SessionManager::auto_attach_on_startup`
  // backend 内部读 `attached_tmux.json`（由 `domain::terminal::attached_tmux::load_attached_tmux_typed` 加载）
  const outcomes = await invoke<AutoAttachOutcome[]>("auto_attach_tmux_servers");
  for (const outcome of outcomes) {
    if (outcome.success) {
      tmux.attach(outcome.server_name);  // 镜像 backend 推过来的 controller 状态
    } else {
      logger.warn(`Failed to auto-attach tmux server ${outcome.server_name}: ${outcome.error}`);
    }
  }
}
```

**关键**：

- **attached_tmux 是 backend 进程级状态**——只有 backend 持有 `Arc<TmuxController>`，所以 source of truth 必须 backend
- frontend **不直写** attachedTmuxServers store key——frontend persistence 只存 frontend-only 配置（sessions/groups/settings）
- auto-attach 触发由 frontend 调 backend IPC 发起，backend 加载 attached_tmux.json 并 attach 所有 server
- 启动顺序: shell.initialize() → 注册 backend state → 启动 MCP server；frontend app/shell.initialize() 调 `auto_attach_tmux_servers` IPC

**为什么不是 frontend 主导**：v3 时期 frontend 直接读写 attachedTmuxServers，但 frontend 不持有 TmuxController（backend 才有），写 store 只是"标记"，没有实际触发 attach。v4 改为 backend 主导。

**冲突解决**：frontend 不能直写 attachedTmuxServers store key——frontend 直写会被 backend 启动时 attach 覆盖。文档明确禁止。
