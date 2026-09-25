# Service · Workspace — 职责

> **位置**：`src-tauri/src/services/workspace/`
> **类型**：预留位（核心 domain 但 MVP 无 backend 实现）
> **被调用方**：`app/workspace`（未来）、`app/shell`（未来）
> **Frontend 对应**：[`../../../../frontend/service/workspace/RESPONSIBILITY.md`](../../../../frontend/service/workspace/RESPONSIBILITY.md)

## 1. 这个 domain 负责什么（目标态）

workspace domain 持有**主视图的所有数据**——workspace 树、window 列表、pane tree、group。

承担 4 类职责（目标态）：

1. **workspace 树 store**——workspace 列表 + 每个 workspace 的 window 列表
2. **pane tree store**——每个 window 的 pane tree（split / leaf）
3. **group store**——workspace 内的 group 折叠状态
4. **IPC 桥**——监听 backend 的 workspace 变更事件（如果有）

## 2. MVP 状态

**MVP 当前无 backend workspace 状态**：

- workspace / window / pane tree / group **完全在 frontend store**（Zustand）
- backend `app/workspace/` 也是预留位（见 `doc/dev/design/backend/app/workspace/RESPONSIBILITY.md`）
- 因此 `services/workspace/` 同样是预留位——空目录 + 3 份 README 占位

## 3. 子结构（目标态）

```
services/workspace/
├── api.rs            ⭐ 唯一对外入口（预留）
├── store.rs          workspace tree / pane tree / group（预留）
├── events.rs         workspace 变更事件类型（预留）
├── mod.rs            re-export api.rs（预留）
└── *.test.rs         （预留）
```

## 4. 触发激活的场景

满足**任一**条件时，把本 domain 从占位升级为实装：

| 条件 | 说明 |
|---|---|
| 多窗口同步 | 两个 Tauri window 共享 pane 树——backend 必须持有 source of truth |
| Server-side persistence | workspace 状态写到 `workspace.json` 而非 frontend store |
| Workspace 导入导出 | 整组 workspace 打包成 tarball，backend 协调 |
| Workspace 模板 | 用户保存 workspace 模板供后续复用 |

## 5. 跟其他 domain 的关系（未来激活时）

| domain | 关系 |
|---|---|
| `services/session` | workspace **不直接**调 session——通过 store 字段反向引用（session 持有 workspaceId）|
| `services/tmux` | workspace pane split 检测 tmux 时**不直接**调 tmux——由 `app/workspace/api.rs` 调 `app/terminal/api.rs::create_tmux_pane` |
| `services/persistence` | workspace 通过 `services/persistence/api.rs` 读写 `workspace.json`（未来） |
| `services/settings` | workspace **不直接**调 settings——layout 由 frontend store 维护 |

## 6. 跟 app 的关系（未来激活时）

| app module | 怎么用 services/workspace |
|---|---|
| `app/workspace` | 通过 `State<Arc<WorkspaceStore>>` 调 workspace CRUD + pane 操作 |
| `app/shell` | `WorkspaceStore::load_last_workspace()` 启动加载 |

## 7. 这个 domain 的"产品语言"术语

- **workspace** —— 一组 windows + 侧栏配置
- **window** —— workspace 内的标签页
- **pane** —— window 内的分屏节点（leaf 或 split）
- **pane tree** —— pane 的嵌套结构
- **group** —— workspace 内的 session 分组
- **active workspace / window / pane** —— 当前聚焦

## 8. v0 → v1 迁移说明

v0 无 workspace domain。v1 引入空 domain 作为预留位——**不需要**任何代码改动，只在 `services/mod.rs` 加 `pub mod workspace;` 即可。

## 9. 跟 v0 的差异

| 维度 | v0 | v1 |
|---|---|---|
| domain 存在 | ❌ 无 | ✅ 空 domain 占位 |
| 触发激活 | n/a | 多窗口同步 / server-side persistence 出现时 |
| 文档 | 无 | 本 README 描述目标态 + 激活条件 |