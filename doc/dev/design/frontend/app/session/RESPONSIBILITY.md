# Module · App Session — 职责

> **位置**：`src/app/modules/session/`
> **用户认知里的位置**：「session 的业务编排」——session 生命周期的所有业务规则
> **核心地位**：app 层最核心的 module；其他 4 个 module 都依赖它
> **UI 对应**：[`ui/modules/session/`](../../ui/session/RESPONSIBILITY.md)

## 1. 这个 module 负责什么

session module 是 xsterm 的**核心业务模块**。它编排 session 生命周期的所有业务：

1. **创建 session**——3 种类型（local / ssh / tmux）的创建编排，包括 backend PTY 启动 + frontend store 写入 + persisted config 保存
2. **打开 saved session**——从 persisted config 重建 session
3. **session lifecycle**——close / reconnect / rename / edit
4. **display config**——运行时调整 session 的字体、字号、theme 等
5. **saved config CRUD**——列出 / 保存 / 删除 / 重命名已保存的 session config
6. **跨 module 协调**——session 创建后装到 workspace（调 `app/workspace/api.ts`）

## 2. 这个 module **不**负责什么

- **不渲染任何 UI**——UI 由 `ui/session/` 负责
- **不管理 workspace 业务**——session 创建后**通过 api.ts 调用** `app/workspace/`，不直接写 workspace store
- **不实现 tmux 协议**——tmux 协议在 backend；app/session 只调 backend IPC
- **不管理 pane 业务**——pane 归 `app/workspace/`
- **不管理 settings**——default shell / default ssh 用户从 `app/settings/` 读

## 3. 子结构

```
modules/session/
├── api.ts                            ⭐ 唯一对外入口
├── usecases/
│   ├── createLocal.ts                createLocalSession / createLocalSessionOnly
│   ├── createSsh.ts                  createSshSession / createSshSessionOnly
│   ├── createTmux.ts                 createTmuxSession / createTmuxSessionOnly
│   ├── openSavedConfig.ts            openSavedSession
│   ├── close.ts                      closeSession
│   ├── reconnect.ts                  reconnectSession
│   ├── rename.ts                     renameSession
│   ├── edit.ts                       editSession (config patch)
│   ├── applyDisplayConfig.ts         applyDisplayConfigToLiveSession
│   ├── saveConfig.ts                 saveConfigOnly
│   ├── removeConfig.ts               removeConfig
│   ├── list.ts                       listSessions
│   └── openInWorkspace.ts            跨 module：session 创建后装到 workspace
├── ipc.ts                            invoke('create_local_session', ...) 等封装
├── model.ts                          module 专属类型（如果有）
├── index.ts                          barrel：只 re-export api.ts
└── *.test.ts
```

## 4. 用户故事（业务视角）

- **作为用户**，我希望点"新建"选 local，配置 shell 命令，立即打开 → `createLocal.ts` 编排 backend 启动 + frontend store 写入 + workspace 装载
- **作为用户**，我希望关闭一个 session 后能从侧栏再打开（保存的 config） → `openSavedConfig.ts` 从 persisted config 重建
- **作为用户**，我希望 SSH 断线后能点"重连"恢复 → `reconnect.ts` 重新建立 backend 连接
- **作为用户**，我希望改 session 字号立即生效（不重启 session） → `applyDisplayConfig.ts` 直接 patch session store，UI 自动 re-render

## 5. 跟其他 module 的关系

| module | 关系 |
|---|---|
| `app/shell` | shell.initialize() 调 session.loadAll()（如果有） |
| `app/workspace` | session.openInWorkspace() 调 workspace 的 addSessionToPane() |
| `app/terminal` | session 不直接调 terminal；tmux session 由 terminal module 编排 IPC |
| `app/settings` | session 创建时从 settings 读 defaultShell / defaultSshUser |
| `infra/tauri/commands/session` | session 调 `invoke('create_local_session', ...)` |
| `service/session` | session 读写 `service/session/store` |

**关键**：session module **不**直接 import `app/workspace/usecases/*`——只调 `app/workspace/api.ts`。

## 6. 这个 module 的"产品语言"术语

- **session** — 一个后台进程 + 它的连接配置 + 显示配置 + 状态
- **local / ssh / tmux session** — 三种 session 类型
- **persisted config** — 持久化的 session 配置（可跨工作区引用）
- **display config** — 运行时可调的字体 / 字号 / theme
- **session status** — connecting / running / closed / error
