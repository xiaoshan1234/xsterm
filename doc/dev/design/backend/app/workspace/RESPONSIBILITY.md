# Module · App Workspace — 职责

> **位置**：`src-tauri/src/app/modules/workspace/`（落地 `src-tauri/src/commands/workspace.rs`）
> **用户认知里的位置**：「workspace 主视图 IPC 编排」
> **MVP 状态**：⚠️ **本 module 当前无 IPC 命令** —— 仅作预留位
> **Frontend 对应**：[`../../../frontend/app/workspace/RESPONSIBILITY.md`](../../../frontend/app/workspace/RESPONSIBILITY.md)

## 1. 这个 module 负责什么（目标态）

workspace module 负责 workspace / window / pane / group 的**IPC 编排**——前提是这些状态从 frontend store 迁到 backend 时。当前 MVP：

- workspace 状态（pane 树 / window 列表 / active tab）**完全在 frontend store**（Zustand）
- group 持久化通过 `app/settings/api.rs::save_groups` / `load_groups` 处理
- 后端**不**持有 workspace 状态副本

所以本 module 当前**没有 `#[tauri::command]`**——只有 README 占位。如果未来产品要求"多窗口同步"或"workspace 持久化到 backend"，再激活本 module。

## 2. 为什么当前是空 module

- **frontend store 已经足够**：Zustand 持久化 + Tauri store 双写已经能 cover 当前产品形态
- **没有跨进程共享需求**：只有一个窗口，frontend state 没有"被另一进程读"的场景
- **避免过早优化**：v4 拆 5 module 是为了"接口对齐"，空 module 也是对齐的一部分（frontend app/workspace 的存在意味着 backend 也要预留）

## 3. 子结构

当前：

```rust
// commands/workspace.rs
// 空文件（或仅有 module-level doc comment）
// pub mod {} 或留空
```

未来激活时的目标结构：

```
modules/workspace/
├── api.rs            ⭐ 唯一对外入口
├── commands/
│   ├── tree.rs       pane tree CRUD（move / split / focus / close）
│   ├── window.rs     window CRUD（new / close / focus）
│   ├── group.rs      group CRUD（list / save / delete）
│   └── persistence.rs  (可选) workspace 状态整体持久化
├── model.rs          module 专属类型（如果有）
└── mod.rs            barrel：只 re-export api.rs
```

## 4. 触发激活的场景

满足**任一**条件时，把本 module 从占位升级为实装：

| 条件 | 说明 |
|---|---|
| 多窗口同步 | 两个 Tauri window 共享 pane 树——backend 必须持有 source of truth |
| Server-side persistence | workspace 状态写到 `workspace.json` 而非 frontend store |
| Workspace 导入导出 | 整组 workspace 打包成 tarball，backend 协调 |
| Workspace 模板 | 用户保存 workspace 模板供后续复用 |

## 5. 跟其他 module 的关系（未来激活时）

| module | 关系 |
|---|---|
| `app/session` | workspace.splitPane() 调 session.createLocalOnly() / session.createTmuxOnly() |
| `app/terminal` | workspace pane split 检测 tmux 时调 terminal.createTmuxPane() |
| `app/settings` | workspace.load() / workspace.save() 调 settings 的 persistence helper |
| `app/shell` | shell 不直接调 workspace；workspace 由 frontend 触发 |

## 6. 这个 module 的"产品语言"术语

- **workspace** —— 完整的 pane 树 + window 列表 + sidebar 状态
- **window** —— 顶层窗口容器，xsterm 概念（不是 tmux 的 window）
- **pane** —— pane 树节点，叶子是 terminal session
- **group** —— sidebar 的 session 分类

## 7. v3 → v4 迁移说明

v3 没有 workspace module。v4 引入空 module 作为预留位——**不需要**任何代码改动，只在 `app/mod.rs` 加一行 `pub mod workspace;` 即可。

## 8. 跟 v3 的差异

| 维度 | v3 | v4 |
|---|---|---|
| module 存在 | ❌ 无 | ✅ 空 module 占位 |
| 触发激活 | n/a | 多窗口同步 / server-side persistence 出现时 |
| 文档 | 无 | 本 README 描述目标态 + 激活条件 |