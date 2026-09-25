# Module · App Shell — 职责

> **位置**：`src/app/modules/shell/`
> **用户认知里的位置**：「app 启动序列」——打开 app 时的初始化编排
> **依赖**：所有 module（shell 是顶层）
> **UI 对应**：[`ui/modules/shell/`](../../ui/shell/RESPONSIBILITY.md)

## 1. 这个 module 负责什么

shell module 编排"app 启动 + 关闭"的业务：

1. **启动序列**——按依赖顺序加载：load settings → 应用 theme → load persisted workspace → auto attach tmux
2. **关闭序列**——按相反顺序保存：save workspace → save settings → save attached tmux servers
3. **app ready 状态**——启动序列完成后通知 UI（避免 UI 在初始化未完成时调用业务）

## 2. 这个 module **不**负责什么

- **不渲染任何 UI**——UI shell 已处理窗口控制和布局
- **不直接调 IPC**——通过 `infra/tauri/commands/shell` 间接调
- **不持有 settings / workspace 状态**——只触发 load 动作

## 3. 子结构

```
modules/shell/
├── api.ts                            ⭐ 唯一对外入口
├── usecases/
│   ├── initialize.ts                 启动序列编排
│   ├── shutdown.ts                   关闭序列编排
│   └── readiness.ts                  app ready 状态管理
├── model.ts
├── index.ts                          barrel：只 re-export api.ts
└── *.test.ts
```

## 4. 启动序列（关键流程）

```
shell.initialize()
    ↓
1. infra/tauri/commands/shell.invoke('app_ready_check', ...)  // 检查后端可用
    ↓
2. app/settings.load()                              // 加载 settings
    ↓
3. app/settings.apply.theme(settings.theme)         // 应用 theme
    ↓
4. app/settings.apply.logLevel(settings.logLevel)   // 应用 log level
    ↓
5. app/workspace.loadLastWorkspace()                // 加载上次 workspace
    ↓
6. app/terminal.autoAttachTmuxServers()             // 自动 attach tmux
    ↓
7. readiness.setReady(true)                          // 通知 UI
```

**关键观察**：

- 启动序列是**有顺序的**——settings 必须在 workspace 之前加载
- 每步都可能失败（IPC 失败 / 持久化损坏）——shell 必须处理回退（用默认 settings / 默认 workspace）
- 启动未完成时，UI 调用业务 API 应该**等待**或**显示加载状态**——`readiness.isReady` 标志

## 5. 关闭序列

```
shell.shutdown()
    ↓
1. app/terminal.saveAttachedTmuxServers()           // 保存 attach 列表
    ↓
2. app/workspace.saveCurrentWorkspace()             // 保存 workspace
    ↓
3. app/settings.save()                              // 保存 settings
    ↓
4. app/session.closeAll()                           // 关闭所有 session
    ↓
5. infra/tauri/commands/shell.invoke('app_shutdown', ...)          // 通知后端
```

## 6. 跟其他 module 的关系

| module | 关系 |
|---|---|
| `app/settings` | shell.initialize() 调 settings.load() |
| `app/workspace` | shell.initialize() 调 workspace.loadLastWorkspace() |
| `app/terminal` | shell.initialize() 调 terminal.autoAttachTmuxServers() |
| `app/session` | shell.shutdown() 调 session.closeAll() |
| `infra/tauri/commands/shell` | shell 调 infra 通知后端 |

**关键**：shell 是**唯一允许在 startup/shutdown 直接调多个 module 的 module**——这是它的职责。其他 module 启动时**不**主动初始化（等待 shell 编排）。

## 7. 这个 module 的"产品语言"术语

- **startup sequence** — 启动序列
- **shutdown sequence** — 关闭序列
- **app ready** — 启动序列完成，可以接受 UI 调用的状态
- **fallback** — 启动失败时用默认值
