# Module · App Workspace — 职责

> **位置**：`src/app/modules/workspace/`
> **用户认知里的位置**：「app 主视图业务」——workspace + window + pane + group 的业务编排
> **依赖**：`app/session`（侧栏 + 嵌入 session）+ `app/terminal`（pane split 涉及 tmux）
> **UI 对应**：[`ui/modules/workspace/`](../../ui/workspace/RESPONSIBILITY.md)

## 1. 这个 module 负责什么

workspace module 编排 app 主视图的所有业务：

1. **workspace CRUD**——创建 / 切换 / 重命名 / 删除 / 保存 / 加载
2. **window CRUD**——新建 / 关闭 / 重命名 / 重排 / 激活
3. **pane 业务**——split / close / resize / setActive
4. **init window 生命周期**——createInitWindow → replaceInitWindowWithSession
5. **group CRUD**——创建 / 删除 / moveConfigToGroup
6. **跨 module 协调**——把 session 装到 pane（调 `app/session/api.ts`）

## 2. 这个 module **不**负责什么

- **不渲染 UI**——UI 由 `ui/workspace/` 负责
- **不实现 tmux 协议**——tmux 后端协议在 backend；app/workspace 只通过 `app/terminal/api.ts` 间接调
- **不直接管 tmux pane**——tmux pane 的 split / attach / detach 归 `app/terminal/`
- **不管理 session 创建**——session 创建归 `app/session/`；workspace 只编排"session 装到 pane"

## 3. 子结构

```
modules/workspace/
├── api.ts                            ⭐ 唯一对外入口
├── usecases/
│   ├── workspace/
│   │   ├── create.ts                 createWorkspace
│   │   ├── close.ts                  closeWorkspace
│   │   ├── persistence.ts            saveWorkspace / loadWorkspace / deleteSavedWorkspace / renameSavedWorkspace
│   ├── window/
│   │   ├── create.ts                 createWindow / createInitWindow / createTmuxWindow / replaceInitWindowWithSession
│   │   ├── lifecycle.ts              closeWindow / renameWindow / reorderWindows / setActiveWindow
│   ├── pane/
│   │   ├── split.ts                  splitPane
│   │   ├── lifecycle.ts              closePane / setActivePane / resizePane
│   ├── group/
│   │   ├── create.ts                 createGroup
│   │   └── lifecycle.ts              deleteGroup / moveConfigToGroup
│   ├── persistence/
│   │   └── savedWindow.ts            saveWindow / loadWindow / deleteSavedWindow
│   └── openSession.ts                跨 module：把 session 装到 pane
├── ipc.ts                            invoke('create_window', ...) 等
├── model.ts                          module 专属类型（如果有）
├── index.ts                          barrel：只 re-export api.ts
└── *.test.ts
```

## 4. 用户故事

- **作为用户**，我希望点"新建 workspace"立即多一个工作区 → `workspace/create.ts`
- **作为用户**，我希望点 tab 切换 window → `window/lifecycle.ts` 的 `setActiveWindow`
- **作为用户**，我希望把 pane 拖到右半边自动 split → `pane/split.ts`
- **作为用户**，我希望右键 session 移到 group → `group/lifecycle.ts` 的 `moveConfigToGroup`
- **作为用户**，我希望保存当前 workspace，下次打开恢复 → `workspace/persistence.ts`

## 5. 跟其他 module 的关系

| module | 关系 |
|---|---|
| `app/shell` | shell.initialize() 调 workspace.loadLastWorkspace() |
| `app/session` | workspace.openSession() 调 session.openInWorkspace() 把 session 装到 pane |
| `app/terminal` | workspace.splitPane() 在 tmux session 时调 terminal 的 createTmuxPane |
| `app/settings` | workspace 读 settings.sidebarWidth / showSidebar |
| `shared/infra` | workspace 调 shared/infra 的 invoke('create_window', ...) |

## 6. 这个 module 的"产品语言"术语

- **workspace** — 一组 windows + 侧栏配置 + 持久化元数据
- **window** — workspace 内的标签页
- **pane tree** — window 内的分屏树
- **init window** — 占位 window（kind: "init"），未绑定 session
- **group** — workspace 内的 session 分组
- **tab** — window 的视觉表示
