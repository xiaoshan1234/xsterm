# Service · Workspace — 职责

> **位置**：`src/service/workspace/`
> **类型**：核心数据 domain
> **被订阅方**：app/workspace、app/shell、ui/workspace、ui/terminal

## 1. 这个 domain 负责什么

workspace service 持有**主视图的所有数据**——workspace 树、window 列表、pane tree、group。

承担 4 类职责：

1. **workspace 树 store**——workspace 列表 + 每个 workspace 的 window 列表
2. **pane tree store**——每个 window 的 pane tree（split / leaf）
3. **group store**——workspace 内的 group 折叠状态
4. **IPC 桥**——监听 backend 的 workspace 变更事件（如果有）

## 2. 这个 domain **不**负责什么

- **不渲染 UI**——UI 订阅 useWorkspaces() 渲染侧栏
- **不持久化 workspace 数据**——持久化归 `service/persistence`
- **不编排 split / close / resize pane**——业务编排在 app/workspace
- **不持有 session 元数据**——session 归 `service/session`

## 3. 子结构

```
service/workspace/
├── api.ts            ⭐ useWorkspaceService hook
├── store.ts          workspaces / windows / paneTrees / groups（zustand）
├── index.ts          按 workspaceId / windowId / paneId 的派生索引
├── types.ts          WorkspaceEvent / PaneMutationEvent
└── *.test.ts
```

## 4. 用户故事

- **作为用户**，我希望切换 workspace 立即看到对应内容 → store.activeWorkspaceId 变化 → UI re-render
- **作为用户**，我希望右键 session 移到 group → store.moveSessionToGroup(sessionId, groupId) → 侧栏 re-render
- **作为用户**，我希望 pane split 后立即看到两个 pane → store.applySplitMutation(...) → pane tree store 更新

## 5. 跟其他 domain 的关系

| domain | 关系 |
|---|---|
| `service/session` | 不直接调——通过 store 反向引用（session 持有 workspaceId，workspace 持有 sessionId）|
| `service/persistence` | app/workspace 调 persistence 加载 workspace 数据 → 写入 workspace store |

## 6. 跟 app/ui 的关系

| module | 怎么用 service/workspace |
|---|---|
| app/workspace | `useWorkspaceService()` 编排 workspace CRUD + pane 操作 |
| app/shell | `useWorkspaceService().loadLastWorkspace()` |
| ui/workspace | `useWorkspaceService().useWorkspaces()` 渲染侧栏 |
| ui/terminal | `useWorkspaceService().usePaneTree(windowId)` 读 pane 树 |

## 7. 这个 domain 的"产品语言"术语

- **workspace** — 一组 windows + 侧栏配置
- **window** — workspace 内的标签页
- **pane** — window 内的分屏节点（leaf 或 split）
- **pane tree** — pane 的嵌套结构
- **group** — workspace 内的 session 分组
- **active workspace / window / pane** — 当前聚焦
