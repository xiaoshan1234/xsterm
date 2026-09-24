# Model · Workspace — 职责

> **位置**：`src/model/workspace/`
> **数据**：workspace / window / group / pane 树的所有纯类型 + 算法
> **被使用方**：`service/workspace`、`app/workspace`、`app/terminal`、`ui/workspace`、`ui/terminal`

## 1. 这个 domain 负责什么

workspace model 定义 frontend 看到的"主视图数据"——workspace 树、window 列表、pane 树、group。它跟 pane 紧耦合（pane 树是 window 的核心），所以 pane 类型 + 算法并入 workspace。

承担 6 类职责：

1. **数据形状**——Workspace / Window / Group / PaneNode
2. **Repository 接口**——WorkspaceRepository
3. **事件契约**——WorkspaceSwitchedEvent / WindowClosedEvent / PaneSplitEvent / PaneClosedEvent
4. **派生计算**（accessor）——getActiveWorkspace / getWindowsByWorkspace / getGroupsByWorkspace / getUniqueWindowName / findPaneNode
5. **算法**（rules）——workspace CRUD、window CRUD、group CRUD、**paneTree 算法**（createLeafPane / createSplitNode / splitPane / closePane / resizePane）
6. **paneTree 算法**——跨域使用的核心算法（虽然 pane 状态在 service/workspace，但算法归 model）

## 2. 这个 domain **不**负责什么

- **不持有运行时状态**——纯类型 + 纯函数
- **不存 session 元数据**——归 `model/session`
- **不存 tmux pane**——tmux 自己的 pane 归 `model/tmux`（xsterm pane ≠ tmux pane）
- **不存 settings**——归 `model/settings`

## 3. 子结构

```
model/workspace/
├── types.ts              # Workspace / Window / Group / PaneNode / SplitDirection / PaneBinding
├── repository.ts         # WorkspaceRepository 接口
├── events.ts             # WorkspaceSwitched / WindowClosed / PaneSplit / PaneClosed / PaneResized
├── accessor.ts           # getActiveWorkspace / getWindowsByWorkspace / findPaneNode / getLeafPanes
├── rules/
│   ├── workspace.ts      # addWindow / removeWindow / renameWindow / reorderWindows
│   ├── window.ts         # createWindow / createInitWindow
│   ├── group.ts          # addGroup / removeGroup / moveSessionToGroup
│   ├── paneTree.ts       # createLeafPane / createSplitNode / splitPane / closePane / resizePane
│   └── index.ts          # barrel
└── *.test.ts
```

**关键决策**：rules 按子域分子目录（workspace / window / group / paneTree）。paneTree 是最大子目录（10+ 算法）。

## 4. 用户故事（基础设施视角）

- **作为开发者**，我希望不可变更新 pane 树 → `splitPane(tree, paneId, "horizontal", newSessionId)` 返回新 tree
- **作为开发者**，我希望查找任意 pane 节点 → `findPaneNode(tree, paneId)` 递归遍历
- **作为开发者**，我希望避免重名 window → `getUniqueWindowName(baseName, existing)`
- **作为开发者**，我希望判断 pane 是 leaf 还是 split → 用 PaneNode discriminated union

## 5. 跟其他 model domain 的关系

| domain | 关系 |
|---|---|
| `model/session` | pane.binding 反向引用 session（sessionId + configId） |
| `model/tmux` | tmux session 装在 xsterm pane 里——但 pane 不感知 tmux |
| `model/settings` | workspace 的 sidebar 宽度等布局配置从 settings 读 |
| `model/common` | generateId 用于创建 pane / window id |

## 6. 跟 service / app / ui 的关系

| 层 | 怎么用 model/workspace |
|---|---|
| `service/workspace` | store schema 用 Workspace / Window / PaneNode；mutation 调用 rules |
| `app/workspace` | useCase 调用 `splitPane(tree, ...)` 等算法 |
| `ui/workspace` | 渲染时调 `findPaneNode` / `getActivePane` 派生 |

## 7. 这个 domain 的"产品语言"术语

- **workspace** — 一组 windows + 侧栏配置 + 持久化元数据
- **window** — workspace 内的标签页（tab）
- **pane** — window 内的分屏节点（leaf 或 split）
- **pane tree** — pane 的嵌套结构
- **group** — workspace 内的 session 分组
- **split direction** — horizontal（左右） / vertical（上下）

## 8. 关键设计：PaneNode 是 discriminated union

```typescript
type PaneNode =
  | { kind: "leaf"; id: string; size: number; binding?: PaneBinding }
  | {
      kind: "split";
      id: string;
      size: number;
      layout: { direction: SplitDirection; children: [PaneNode, PaneNode] };
    };

interface PaneBinding {
  sessionId: number;
  configId: string;
}
```

TypeScript 自动 narrow，递归算法安全：

```typescript
function getLeafSessions(node: PaneNode): number[] {
  if (node.kind === "leaf") return node.binding ? [node.binding.sessionId] : [];
  return [...getLeafSessions(node.layout.children[0]), ...getLeafSessions(node.layout.children[1])];
}
```

## 9. paneTree 算法的重要性

paneTree 是 **xsterm 最核心的算法之一**——所有 pane 操作（split / close / resize / drag）都基于它。

**关键性质**：

- **不可变**——所有算法返回**新** PaneNode，不修改输入
- **纯函数**——给定输入（tree + 操作）总返回相同输出
- **递归**——split 节点的 children 也是 PaneNode，递归处理

**测试覆盖必须 100%**——这是 xsterm 的关键路径。
