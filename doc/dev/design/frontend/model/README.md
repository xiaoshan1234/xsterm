# Frontend · Model 层（v4 从零设计）

> **位置**：`src/model/`
> **关注点**：纯数据 + 算法（types / repository / events / accessor / rules）
> **平级于**：app / ui / service / infra（5 个顶层目录之一）

## 1. 5 + common = 5 个 model domain

从零设计后 model 应当有 **5 个 domain + 1 个 common**：

```
src/model/
├── session/        Session / SessionConfig / SessionDisplayConfig
├── workspace/      Workspace / Window / Group / PaneNode（含 paneTree 算法）
├── tmux/           TmuxController / AttachedServer / TmuxPane / TmuxWindow
├── settings/       Settings / SettingsCategory / LogLevel（含 TerminalTheme / 5 个 ANSI 调色板）
└── common/         textTransform / constants / generateId（跨域纯函数）
```

## 2. 为什么 5 而不是 8

v3 现状有 8 个 domain：`session / workspace / pane / window / tmux / output / persistence / theme`。

从零设计重审后：

| v3 现状 | v4 调整 | 理由 |
|---|---|---|
| `model/session/` | **保留** | 独立 |
| `model/workspace/` | **保留**（pane / window 并入） | pane 算法跟 window 紧耦合 |
| `model/tmux/` | **保留** | 独立 |
| `model/pane/` | **并入 workspace** | pane 算法跟 window 紧耦合，拆开是过度工程 |
| `model/window/` | **并入 workspace** | Window 类型跟 Workspace 紧耦合 |
| `model/output/` | **删除** | Uint8Array 是 TS 内置类型，不需要 model 抽象 |
| `model/persistence/` | **删除** | persistence 是 generic IO wrapper，Repository 接口分散到各 domain |
| `model/theme/` | **并入 settings** | theme 是 settings 的子集，不是独立概念 |
| `model/terminal/` | **并入 settings**（**新增** v4） | TerminalTheme + 5 个 ANSI 调色板是 settings 的视觉子集 |

**5 + common 是最合适的**：
- 不追求最少（不是 3 个）
- 不追求最全（不是 9 个）
- 追求"职责清晰"——每个 domain 都有清晰的归属

## 3. 5 文件模板（每个 domain）

```
model/<domain>/
├── types.ts          # 数据 shape / enum / union
├── repository.ts     # Repository 接口（service 实现）
├── events.ts         # event 契约（event name + payload 类型）
├── accessor.ts       # query 纯函数（getActiveXxx(items)）
├── rules.ts          # mutation 纯函数（applyXxx(item, patch)）
└── *.test.ts
```

**例外**（不是每个 domain 都有全 5 文件）：
- `common/` 只有 `textTransform.ts / constants.ts / id.ts`——无 types / repository / events / accessor / rules
- `model/settings/` 的 TerminalTheme 相关可能在 `palettes/` 子目录

## 4. accessor vs rules 的区别

| 维度 | accessor | rules |
|---|---|---|
| 操作类型 | query（不修改数据） | mutation（产生新数据） |
| 返回 | 原数据 + 派生值 | 新数据（immutable） |
| 例子 | `getActiveSession(sessions)` | `applyDisplayConfig(session, patch)` |
| 命名习惯 | `get*` / `find*` / `is*` | `apply*` / `with*` / `create*` / `merge*` |

## 5. 跟 service 的对应关系

| model domain | 对应 service domain |
|---|---|
| `model/session` | `service/session` |
| `model/workspace`（含 pane） | `service/workspace` |
| `model/tmux` | `service/tmux` |
| `model/settings`（含 terminal） | `service/settings` |
| `model/common` | （无对应 service——被所有 domain 用） |

**关键观察**：
- `service/persistence` **没有对应 model**——persistence 是 generic IO wrapper，不需要 model 类型
- `service/logger`（在 infra）**没有对应 model**——单例无状态
- `model/workspace` 内部**同时**有 workspace + pane——pane 状态在 `service/workspace` 的 store 里

## 6. 5 domain 索引

每个 domain 有 3 份文档：**职责 / 对外接口 / 对下依赖**

| domain | 职责 | 对外接口 | 对下依赖 |
|---|---|---|---|
| **session** | [RESPONSIBILITY](./session/RESPONSIBILITY.md) | [INTERFACE](./session/INTERFACE.md) | [DOWNSTREAM](./session/DOWNSTREAM.md) |
| **workspace** | [RESPONSIBILITY](./workspace/RESPONSIBILITY.md) | [INTERFACE](./workspace/INTERFACE.md) | [DOWNSTREAM](./workspace/DOWNSTREAM.md) |
| **tmux** | [RESPONSIBILITY](./tmux/RESPONSIBILITY.md) | [INTERFACE](./tmux/INTERFACE.md) | [DOWNSTREAM](./tmux/DOWNSTREAM.md) |
| **settings** | [RESPONSIBILITY](./settings/RESPONSIBILITY.md) | [INTERFACE](./settings/INTERFACE.md) | [DOWNSTREAM](./settings/DOWNSTREAM.md) |
| **common** | [RESPONSIBILITY](./common/RESPONSIBILITY.md) | [INTERFACE](./common/INTERFACE.md) | [DOWNSTREAM](./common/DOWNSTREAM.md) |

## 7. 跟 v3 的核心差异

| 维度 | v3 | v4 |
|---|---|---|
| 顶层目录结构 | `src/model/` 平铺 8 个 domain | 5 + common |
| pane / window | 独立 | 并入 workspace |
| theme | 独立 | 并入 settings |
| terminal | （不存在） | 并入 settings |
| output | 独立（types） | 删除（TS 内置 Uint8Array） |
| persistence | 独立（repository） | 删除（分散到各 domain） |
| 暴露接口 | `import { X } from "@/model"` | 同上（不强制按 api.ts，因为 model 是无状态） |

## 8. 强制约束（可机械校验）

```bash
# model 不能依赖 app / ui / service / infra
grep -rn 'from\s*"\.\./\(app\|ui\|service\|infra\)' src/model/ --include='*.ts'
# 必须为空

# model 不能 import React
grep -rn 'from\s*"react"' src/model/ --include='*.ts'
# 必须为空

# model 不能 import @tauri-apps/api
grep -rn 'from\s*"@tauri-apps' src/model/ --include='*.ts'
# 必须为空

# common 是最底层——不能 import 其他 domain
grep -rn 'from\s*"\.\./\(session\|workspace\|tmux\|settings\)' src/model/common/ --include='*.ts'
# 必须为空
```

## 9. 设计系统约束

model 不涉及 UI 设计系统。但 TerminalTheme 类型影响 xterm 配色——palette 定义在 `model/settings/palettes/` 子目录。

## 10. 测试

每个 domain 都有 `*.test.ts`：

```
model/session/accessor.test.ts
model/session/rules.test.ts
model/workspace/rules.test.ts        # paneTree 算法必须 100% 覆盖
model/common/textTransform.test.ts
```

**为什么 model 测试最重要**：

- model 是最底层——上层（service / app / ui）都依赖它
- model 出 bug = 全 app 出 bug
- model 是纯函数——测试简单，无需 mock
