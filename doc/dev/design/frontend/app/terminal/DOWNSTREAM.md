# Module · App Terminal — 对下依赖接口

> **位置**：`src/app/modules/terminal/`

## 1. 依赖图

```
modules/terminal/
├── usecases/ ────►  infra/tauri/commands/tmux  (invoke create_tmux_pane / kill_tmux_window 等)
├── usecases/ ────►  service/settings           (读 terminal preferences)
├── usecases/ ────►  service/session/store      (读 session 元数据判断是否 tmux)
└── model.ts  ────►  model/settings/terminal
```

**terminal module 几乎不调其他 app module**——它编排 backend tmux IPC。

## 2. infra/tauri/commands/tmux

| 调用 | 来源 | 何时调 |
|---|---|---|
| `invoke('attach_tmux_session', ...)` | `infra/tauri/commands/tmux/attach` | tmux/attach.ts |
| `invoke('detach_tmux_controller', ...)` | `infra/tauri/commands/tmux/detach` | tmux/detach.ts |
| `invoke('create_tmux_pane', ...)` | `infra/tauri/commands/tmux/pane` | tmux/pane.ts |
| `invoke('kill_tmux_pane', ...)` | `infra/tauri/commands/tmux/pane` | tmux/pane.ts |
| `invoke('resize_tmux_pane', ...)` | `infra/tauri/commands/tmux/pane` | tmux/pane.ts |
| `invoke('capture_tmux_pane', ...)` | `infra/tauri/commands/tmux/pane` | tmux/pane.ts |
| `invoke('create_tmux_window', ...)` | `infra/tauri/commands/tmux/window` | tmux/window.ts |
| `invoke('kill_tmux_window', ...)` | `infra/tauri/commands/tmux/window` | tmux/window.ts |
| `invoke('rename_tmux_window', ...)` | `infra/tauri/commands/tmux/window` | tmux/window.ts |
| `invoke('probe_tmux_session_exists', ...)` | `infra/tauri/commands/tmux/probe` | tmux/probe.ts |
| `invoke('get_attached_tmux_servers', ...)` | `infra/tauri/commands/tmux/server` | tmux/server.ts |
| `invoke('auto_attach_tmux_servers', ...)` | `infra/tauri/commands/tmux/server` | tmux/server.ts |
| `invoke('kill_server_via_controller', ...)` | `infra/tauri/commands/tmux/server` | tmux/server.ts |
| `invoke('unmark_attached_tmux', ...)` | `infra/tauri/commands/tmux/server` | tmux/server.ts |

## 3. service/

| 调用 | 来源 | 何时调 |
|---|---|---|
| 读 terminal preferences | `service/settings/api`（terminalPreferences 字段）| preferences/apply.ts |
| session store（读 session.kind 判断是否 tmux） | `service/session/store` | tmux/* |

## 4. model/

| 调用 | 来源 |
|---|---|
| `TerminalPreferences` | `model/settings/terminal/types` |
| `SplitDirection` | `model/workspace/types`（pane 算法归属 workspace） |

## 5. 设计意图：terminal module 是"薄编排层"

terminal module 在 app 层几乎是**透传**——backend 已经实现了 tmux -CC 协议，app/terminal 只是把 backend IPC 命令包成 api：

```
backend Rust 已经实现的命令:
  - create_tmux_pane
  - kill_tmux_pane
  - attach_tmux_session
  - ...

app/terminal 的对应 usecase:
  - tmux/pane.ts: createTmuxPane() → invoke('create_tmux_pane', ...)
  - tmux/pane.ts: killTmuxPane() → invoke('kill_tmux_pane', ...)
  - tmux/attach.ts: attachTmuxSession() → invoke('attach_tmux_session', ...)
  - ...
```

**为什么还要单独 module**：

- **统一编排入口**——UI/workspace 调 `useTerminalApi().createTmuxPane()`，不直接 invoke IPC
- **测试 mock**——mock `useTerminalApi()` 比 mock IPC 简单
- **未来扩展**——如果加"tmux pane 持久化"、"tmux session 共享"等业务逻辑，有 module 承载

## 6. 不允许的依赖

- ❌ `modules/terminal/` → `app/session/*` 或 `app/workspace/*` 或 `app/settings/*`
- ❌ `modules/terminal/` → `infra/` 直接（必须经过 `infra/tauri/commands/tmux`）

## 7. 依赖变更流程

1. **新增 tmux IPC 命令** → 加 `infra/tauri/commands/tmux/<子域>` + 加 `usecases/tmux/`
2. **backend 修改 tmux IPC 签名** → 同步更新 §2
3. **新增 terminal preferences 字段** → 加 `model/settings/terminal` + 加 `preferences/apply`