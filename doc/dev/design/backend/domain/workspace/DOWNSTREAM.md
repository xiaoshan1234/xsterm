# Domain · Workspace — 对下依赖

> **位置**：`src-tauri/src/domain/workspace/`

## 1. 依赖图

```
domain/workspace/
├── types.rs          ────►  domain/session::SessionInfo (纯字段引用)
├── types.rs          ────►  domain/session::{SizingMode, DisplayConfig, EnvConfig, SshAuthMethod}
├── types.rs          ────►  domain/cross_cutting::{CapabilityFlags, SplitDirection}
├── rules.rs          ────►  (self-only: PaneNode 算法)
├── state.rs          ────►  (目标态预留: WorkspaceManager)
└── errors.rs         ────►  thiserror::Error
```

## 2. domain/session（types 字段引用）

| 类型 | 用途 |
|—|—|
| `SessionInfo` | `PaneNode::Leaf::session_id: Option<u32>` 字段 |

**约束**：引用 `domain/session::*` 的**纯类型字段**（不含逻辑）——workspace 不调 `SessionManager`。

## 3. domain/session（已迁移 types 字段到 session）

| 类型 | 用途 |
|—|—|
| `SizingMode` | `Window` sizing 字段 |
| `DisplayConfig` | `Window` display 字段 |
| `EnvConfig` | workspace-level env override |
| `SshAuthMethod` | workspace 保存 ssh session config |

**约束**：同 §2——只引用纯类型字段。

## 4. domain/cross_cutting（types 字段引用）

| 类型 | 用途 |
|—|—|
| `CapabilityFlags` | `PaneNode::Leaf::capabilities` 字段（未来） |
| `SplitDirection` | `PaneNode::Split::direction` 字段 |

**调整**：cross-cutting 类型字段已直接归属 session（SizingMode 等）和 workspace（SplitDirection）。

## 5. 内部依赖关系

```
domain/workspace/
├── types.rs           ← 纯数据（被 rules 引用）
├── rules.rs           ← types（paneTree 算法）
├── state.rs           ← types + rules + errors（目标态预留）
└── errors.rs          ← types（WorkspaceError enum）
```

**关键约束**：

- types / rules 是**最底层**——其他文件依赖它们
- state.rs 是**依赖最广的文件**（目标态才有）
- rules.rs **不**依赖 state.rs（纯函数）
- rules.rs **不**依赖 infra（纯算法）

## 6. 跨域依赖

| domain | workspace 对其依赖 |
|—|—|
| `domain/session` | ✅ 弱依赖（仅 SessionInfo 类型字段） |
| （已删除——见各归属 domain）| ✅ 弱依赖（settings 类型字段） |
| `domain/cross_cutting`（在 settings 下） | ✅ 弱依赖（CapabilityFlags / SplitDirection） |
| `domain/terminal` | ❌ 不依赖（tmux pane 信息归 terminal，workspace pane 仅持 tmux_pane_id 字段） |
| `domain/persistence` | ❌ 不依赖（MVP frontend 直存；目标态由 commands 触发） |
| `infra/*` | ❌ 不依赖（paneTree 是纯算法） |

## 7. 设计意图：workspace 是"目标态预留位"

**MVP 阶段**：workspace 状态完全在 frontend store（Zustand），backend 只有 types + paneTree 算法供未来多窗口同步使用。

**目标态激活时机**：
- 多窗口同步（同一 workspace 在多设备共享）
- workspace 状态跨进程持久化（多窗口崩溃恢复）
- backend 编排 workspace 业务（如 split 时自动打开 pane）

**设计决策**：

- 把 workspace types + 算法**保留在 backend**（即使 MVP 不实现）——frontend paneTree 算法可以同步升级，避免后期重构
- backend `WorkspaceManager` 状态机**不**预留——等激活时再实现

## 9. 不允许的依赖

- ❌ `domain/workspace/` → `domain/persistence/*`（MVP frontend 直存；目标态由 commands 触发）
- ❌ `domain/workspace/` → `domain/session/*`（除 types 字段）
- ❌ `domain/workspace/` → `tauri`（workspace MVP 不感知 IPC 边界）
- ❌ `domain/workspace/rules.rs` → `state.rs`（rules 是纯函数，state 才有可变状态）

## 10. 依赖变更流程

1. **新增 paneTree 算法** → 加 `domain/workspace/rules.rs` 函数 + 100% 测试覆盖 + INTERFACE §2 + frontend `model/workspace/rules/paneTree.ts` 同步
2. **新增 types 字段** → 加 `domain/workspace/types.rs` 字段 + serde derive + 检查 frontend 类型同步
3. **激活 state.rs**（目标态） → 加 `WorkspaceManager` struct + methods + INTERFACE §2 新章节
4. **修改 WorkspaceManager method 签名** → ⚠️ 目标态才会发生——MVP 无实现