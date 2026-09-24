# Module · App Terminal — 职责

> **位置**：`src/app/modules/terminal/`
> **用户认知里的位置**：「终端特有业务」——tmux control mode + terminal 偏好应用
> **依赖**：`app/session`（tmux session 元数据）
> **UI 对应**：[`ui/modules/terminal/`](../../ui/terminal/RESPONSIBILITY.md)

## 1. 这个 module 负责什么

terminal module 编排"终端特有的业务"——主要是 tmux -CC 协议的 frontend 编排：

1. **tmux session attach/detach**——attach 到现有 tmux server / detach 当前 controller
2. **tmux pane 操作**——创建 / 关闭 / resize tmux pane
3. **tmux window 操作**——创建 / 关闭 / 重命名 tmux window
4. **tmux 状态查询**——probe session 是否存在 / 列出已 attach 的 server / capture pane 内容
5. **terminal preferences 应用**——把 settings 的 font / fontSize 应用到 terminal store

## 2. 这个 module **不**负责什么

- **不渲染 xterm**——UI 渲染归 `ui/terminal/`
- **不管理 pane 树结构**——pane 树归 `app/workspace/`；tmux pane 操作只是"调 backend 创建 pane"
- **不实现 tmux 协议**——tmux -CC 协议在 backend（`src-tauri/`）；app/terminal 只调 backend IPC
- **不管理普通 PTY/SSH session**——那是 `app/session/` 的事

## 3. 子结构

```
modules/terminal/
├── api.ts                            ⭐ 唯一对外入口
├── usecases/
│   ├── tmux/
│   │   ├── attach.ts                 attach_tmux_session
│   │   ├── detach.ts                 detach_tmux_controller
│   │   ├── pane.ts                   create_tmux_pane / kill_tmux_pane / resize_tmux_pane / capture_tmux_pane
│   │   ├── window.ts                 create_tmux_window / kill_tmux_window / rename_tmux_window
│   │   ├── server.ts                 get_attached_tmux_servers / auto_attach_tmux_servers / kill_server_via_controller / unmark_attached_tmux
│   │   └── probe.ts                  probe_tmux_session_exists
│   └── preferences/
│       └── apply.ts                  applyTerminalPreferences (font / fontSize / theme)
├── ipc.ts                            invoke('create_tmux_pane', ...) 等
├── model.ts                          module 专属类型（如果有）
├── index.ts                          barrel：只 re-export api.ts
└── *.test.ts
```

## 4. 用户故事

- **作为用户**，我希望打开 tmux session 时自动 attach 到已存在的 controller → `tmux/attach.ts` + `tmux/server.ts`
- **作为用户**，我希望 tmux pane split 时调 `createTmuxPane` 而不是创建新 PTY → `tmux/pane.ts`
- **作为用户**，我希望改 terminal font 后立即生效（不刷新） → `preferences/apply.ts` 写入 terminal store
- **作为用户**，我希望关闭 app 前保存所有 attach 的 tmux server 列表 → `tmux/server.ts`

## 5. 跟其他 module 的关系

| module | 关系 |
|---|---|
| `app/workspace` | workspace.splitPane() 检测是 tmux 时调 terminal.createTmuxPane() |
| `app/session` | terminal 不直接调 session；通过 session store 订阅读取 session 元数据 |
| `app/settings` | settings.applyTerminalPreferences() 调 terminal 的 apply |
| `app/shell` | shell.initialize() 调 terminal.autoAttachTmuxServers() |
| `shared/infra` | terminal 调 shared/infra 的 invoke('create_tmux_pane', ...) |

## 6. 这个 module 的"产品语言"术语

- **tmux controller** — backend 维护的 tmux -CC 连接
- **attach / detach** — attach 到 / detach 自 tmux controller
- **tmux pane / window** — tmux 自己的 pane / window 概念（跟 xsterm pane / window 不完全对应）
- **terminal preferences** — terminal 偏好（font / fontSize / theme / cursor blink）
