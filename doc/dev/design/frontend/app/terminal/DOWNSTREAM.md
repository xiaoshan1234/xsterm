# Module · App Terminal — 对下依赖接口

> **位置**：`src/app/modules/terminal/`

## 1. 依赖图

```
modules/terminal/
├── usecases/ ────►  shared/infra/api.ts            (invoke create_tmux_pane / kill_tmux_window 等)
├── usecases/ ────►  shared/service/terminal/store  (terminal preferences)
├── usecases/ ────►  shared/service/session/store   (读 session 元数据判断是否 tmux)
└── model.ts  ────►  shared/model/terminal
```

**terminal module 几乎不调其他 app module**——它编排 backend tmux IPC。

## 2. shared/infra

| 调用 | 来源 | 何时调 |
|---|---|---|
| `infra.invoke('attach_tmux_session', ...)` | `shared/infra/api.ts` | tmux/attach.ts |
| `infra.invoke('detach_tmux_controller', ...)` | `shared/infra/api.ts` | tmux/detach.ts |
| `infra.invoke('create_tmux_pane', ...)` | `shared/infra/api.ts` | tmux/pane.ts |
| `infra.invoke('kill_tmux_pane', ...)` | `shared/infra/api.ts` | tmux/pane.ts |
| `infra.invoke('resize_tmux_pane', ...)` | `shared/infra/api.ts` | tmux/pane.ts |
| `infra.invoke('capture_tmux_pane', ...)` | `shared/infra/api.ts` | tmux/pane.ts |
| `infra.invoke('create_tmux_window', ...)` | `shared/infra/api.ts` | tmux/window.ts |
| `infra.invoke('kill_tmux_window', ...)` | `shared/infra/api.ts` | tmux/window.ts |
| `infra.invoke('rename_tmux_window', ...)` | `shared/infra/api.ts` | tmux/window.ts |
| `infra.invoke('probe_tmux_session_exists', ...)` | `shared/infra/api.ts` | tmux/probe.ts |
| `infra.invoke('get_attached_tmux_servers', ...)` | `shared/infra/api.ts` | tmux/server.ts |
| `infra.invoke('auto_attach_tmux_servers', ...)` | `shared/infra/api.ts` | tmux/server.ts |
| `infra.invoke('kill_server_via_controller', ...)` | `shared/infra/api.ts` | tmux/server.ts |
| `infra.invoke('unmark_attached_tmux', ...)` | `shared/infra/api.ts` | tmux/server.ts |

## 3. shared/service/

| 调用 | 来源 | 何时调 |
|---|---|---|
| terminal preferences store | `shared/service/terminal/store` | preferences/apply.ts |
| session store（读 session.kind 判断是否 tmux） | `shared/service/session/store` | tmux/* |

## 4. shared/model/

| 调用 | 来源 |
|---|---|
| `TerminalPreferences` | `shared/model/terminal` |
| `SplitDirection` | `shared/model/terminal` |

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

## 6. 当前架构债 → 设计意图说明

| 旧 v3 现状 | 新设计意图 |
|---|---|
| `tmux_session/` 在 `src-tauri/` 是 1500+ 行 monolith | backend 已经按 P1-P9 拆好（详见 ADR-0005） |
| `createTmuxWindow` 跨 session + window，归 useCases/ | 归 `app/workspace/window/create.ts`（跨 module 通过 api.ts 编排） |
| `applyDisplayConfigToLiveSession` 在 useCases/ | 归 `app/session/displayConfig.ts` |
| terminal preferences 应用散落在 settings tab | 归 `app/terminal/preferences/apply.ts` + `app/settings/apply/terminalPrefs.ts` |

## 7. 不允许的依赖

- ❌ `modules/terminal/` → `app/session/*` 或 `app/workspace/*` 或 `app/settings/*`
- ❌ `modules/terminal/` → `infra/` 直接（必须经过 shared/infra）

## 8. 依赖变更流程

1. **新增 tmux IPC 命令** → 加 shared/infra/commands/tmux + 加 usecases/tmux/
2. **backend 修改 tmux IPC 签名** → 同步更新 §2
3. **新增 terminal preferences 字段** → 加 shared/model/terminal + 加 preferences/apply
