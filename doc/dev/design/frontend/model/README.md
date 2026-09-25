# Frontend · Model 层（v4 从零设计）

> **位置**：`src/model/`
> **关注点**：纯数据 + 算法（types / repository / events / accessor / rules）
> **平级于**：app / ui / service / infra（5 个顶层目录之一）

## 1. 5 + 1 = 6 个目录（5 个业务 domain + 1 个 cross-cutting）

从零设计后 model 应当有 **5 个业务 domain + 1 个 cross-cutting**：

```
src/model/
├── session/        Session / SessionConfig / SessionDisplayConfig
├── workspace/      Workspace / Window / Group / PaneNode（含 paneTree 算法）
├── tmux/           TmuxController / AttachedServer / TmuxPane / TmuxWindow
├── settings/       Settings / SettingsCategory / LogLevel（含 TerminalTheme / 5 个 ANSI 调色板）
└── cross-cutting/  textTransform / constants / generateId（跨域纯函数 + 常量）
```

**5 + 1 = 6 个目录**——5 个业务 domain + 1 个横切关注点。

## 2. 为什么是 5 + 1（不是 8 也不是 3）

v3 现状有 8 个 domain：`session / workspace / pane / window / tmux / output / persistence / theme`。

从零设计重审后：

| v3 现状 | v4 调整 | 理由 |
|---|---|---|
| `model/session/` | **保留** | 独立 |
| `model/workspace/` | **保留**（pane / window 并入） | pane 算法跟 window 紧耦合，拆开是过度工程 |
| `model/tmux/` | **保留** | 独立 |
| `model/pane/` | **并入 workspace** | pane 算法跟 window 紧耦合 |
| `model/window/` | **并入 workspace** | Window 类型跟 Workspace 紧耦合 |
| `model/output/` | **删除** | Uint8Array 是 TS 内置类型，不需要 model 抽象 |
| `model/persistence/` | **删除** | persistence 是 generic IO wrapper，Repository 接口分散到各 domain |
| `model/theme/` | **并入 settings** | theme 是 settings 的子集，不是独立概念 |
| `model/terminal/` | **并入 settings**（**新增** v4） | TerminalTheme + 5 个 ANSI 调色板是 settings 的视觉子集 |

**5 + 1 是最合适的**：
- 不追求最少（不是 3 个）——3 个会让 settings / workspace 等核心 domain 变臃肿
- 不追求最全（不是 9 个）——9 个会重复切分紧密耦合的 concept
- 追求"职责清晰"——每个 domain 都有清晰的归属，cross-cutting 单独标出

## 3. 5 文件模板（每个业务 domain）

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

| domain | 例外 |
|---|---|
| `cross-cutting/` | 无 types/repository/events/accessor/rules——只有 `textTransform.ts / constants.ts / id.ts` 三个 helper 文件 |
| `settings/terminal/` | settings 的子目录——terminal 是 settings 的视觉子集，不独立成 domain |
| `workspace/rules/` | 按子域分子目录（workspace/window/group/paneTree），paneTree 是最大子目录 |

### 3.1 settings/terminal 子目录

```
model/settings/
├── types.ts                    # Settings / Theme / LogLevel
├── repository.ts               # SettingsRepository 接口
├── events.ts                   # SettingsChangedEvent
├── accessor.ts                 # getEffectiveTheme / getThemeById
├── rules.ts                    # applyPatch / mergeDefaults
│
├── terminal/                   # 视觉子集（不是独立 domain）
│   ├── types.ts                # TerminalTheme / TerminalPreferences
│   ├── themes.ts               # 5 个 ANSI preset 元数据
│   ├── palettes/               # 5 个调色板文件（dark/light/solarized-dark/solarized-light/monokai）
│   └── index.ts                # barrel
│
└── *.test.ts
```

### 3.2 workspace/rules/ 子目录

```
model/workspace/
├── types.ts                    # Workspace / Window / Group / PaneNode
├── repository.ts               # WorkspaceRepository 接口
├── events.ts                   # PaneSplitEvent 等
├── accessor.ts                 # findPaneNode / getLeafPanes
│
├── rules/
│   ├── workspace.ts            # addWindow / removeWindow / reorderWindows
│   ├── window.ts               # createWindow / createInitWindow
│   ├── group.ts                # addGroup / moveSessionToGroup
│   ├── paneTree.ts             # createLeafPane / createSplitNode / splitPane / closePane / resizePane
│   └── index.ts                # barrel
│
└── *.test.ts
```

## 4. accessor vs rules 的区别

| 维度 | accessor | rules |
|---|---|---|
| 操作类型 | query（不修改数据） | mutation（产生新数据） |
| 返回 | 原数据 + 派生值 | 新数据（immutable） |
| 例子 | `getActiveSession(sessions)` | `applyDisplayConfig(session, patch)` |
| 命名习惯 | `get*` / `find*` / `is*` | `apply*` / `with*` / `create*` / `merge*` |
| 性能开销 | 通常 O(n) 遍历 | 通常 O(1) 或 O(log n) |

**关键**：rules 函数**不可变**——返回新对象，旧对象可安全丢弃。这让 zustand store 触发 re-render 时引用比较正常工作。

## 5. 跟 service 的对应关系

| model domain | 对应 service domain |
|---|---|
| `model/session` | `service/session` |
| `model/workspace`（含 pane） | `service/workspace` |
| `model/tmux` | `service/tmux` |
| `model/settings`（含 terminal） | `service/settings` |
| `model/cross-cutting` | （无对应 service——被所有 domain 用）|
| （无对应 model） | `service/persistence`（generic IO wrapper） |

**关键观察**：

- **`service/persistence` 没有对应 model**——persistence 是 generic IO wrapper，不持有业务数据，Repository 接口不需要 model 类型
- **`infra/logger` 没有对应 model**——logger 单例无状态
- **`model/workspace` 内部同时有 workspace + pane**——pane 状态在 `service/workspace/store.ts`，pane 算法在 `model/workspace/rules/paneTree.ts`
- **`model/cross-cutting` 被所有 domain 用**——但不"属于"任何 service

### 5.1 算法 vs 状态的根本分离

**算法归 model，状态归 service**——这是最重要的原则。

```
paneTree 算法          → model/workspace/rules/paneTree.ts        (纯函数)
pane tree 状态         → service/workspace/store.ts              (zustand)

applyDisplayConfig     → model/session/rules.ts                   (纯函数)
session 元数据          → service/session/store.ts                (zustand)

getUniqueSessionName   → model/session/accessor.ts                (纯函数)
```

这条分离的好处：

1. **model 容易单测**——纯函数，无 mock
2. **service 容易 mock**——接口边界（api.ts）清晰
3. **业务编排由 app 跨层调用**——model 函数 + service mutation

## 6. 6 个目录索引

每个目录有 3 份文档：**RESPONSIBILITY（职责）/ INTERFACE（对外接口）/ DOWNSTREAM（对下依赖）**

### 6.1 5 个业务 domain

| domain | 职责 | 对外接口 | 对下依赖 |
|---|---|---|---|
| **session** | [RESPONSIBILITY](./session/RESPONSIBILITY.md) | [INTERFACE](./session/INTERFACE.md) | [DOWNSTREAM](./session/DOWNSTREAM.md) |
| **workspace** | [RESPONSIBILITY](./workspace/RESPONSIBILITY.md) | [INTERFACE](./workspace/INTERFACE.md) | [DOWNSTREAM](./workspace/DOWNSTREAM.md) |
| **tmux** | [RESPONSIBILITY](./tmux/RESPONSIBILITY.md) | [INTERFACE](./tmux/INTERFACE.md) | [DOWNSTREAM](./tmux/DOWNSTREAM.md) |
| **settings** | [RESPONSIBILITY](./settings/RESPONSIBILITY.md) | [INTERFACE](./settings/INTERFACE.md) | [DOWNSTREAM](./settings/DOWNSTREAM.md) |

### 6.2 1 个 cross-cutting

| domain | 职责 | 对外接口 | 对下依赖 |
|---|---|---|---|
| **cross-cutting** | [RESPONSIBILITY](./cross-cutting/RESPONSIBILITY.md) | [INTERFACE](./cross-cutting/INTERFACE.md) | [DOWNSTREAM](./cross-cutting/DOWNSTREAM.md) |

## 7. 跟 v3 的核心差异

| 维度 | v3 | v4 |
|---|---|---|
| 顶层目录结构 | `src/model/` 平铺 8 个 domain | **5 业务 + 1 cross-cutting** |
| pane / window | 独立 | **并入 workspace** |
| theme | 独立 | **并入 settings** |
| terminal | （不存在） | **并入 settings**（作为子目录）|
| output | 独立（types） | **删除**（TS 内置 Uint8Array）|
| persistence | 独立（repository） | **删除**（分散到各 domain）|
| cross-cutting 命名 | （不存在） | **`model/cross-cutting/`**（替代 common 命名陷阱）|
| 暴露接口 | `import { X } from "@/model"` | 同上（不强制按 api.ts，因为 model 是无状态）|

### 7.1 为什么 cross-cutting 不叫 common

"common" 太宽泛——是"杂物桶"的代名词。`cross-cutting` 是 AOP 术语，精确描述"横切多个业务域"的角色。

跨域纯函数和值（textTransform / constants / id）不属于任何具体业务，但被多个 domain 共享——这是 cross-cutting 的语义。

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

# cross-cutting 是最底层——不能 import 其他 domain
grep -rn 'from\s*"\.\./\(session\|workspace\|tmux\|settings\)' src/model/cross-cutting/ --include='*.ts'
# 必须为空

# model/<domain>/ 之间不能互相调（除 settings → settings/terminal 子目录）
grep -rn 'from\s*"\.\./\(session\|workspace\|tmux\|settings\)/' src/model/session/ src/model/workspace/ src/model/tmux/ src/model/cross-cutting/ --include='*.ts'
# 必须为空
```

## 9. 跟其他层的关系

```
service  ──►  model  ✅ 允许（service 读 model 类型 + 调 model/accessor）
app     ──►  model  ✅ 允许（useCase 读 model 类型 + 调 model/rules）
ui      ──►  model  ✅ 允许（render 读 model 类型 + 调 model/accessor）
infra   ──►  model  ✅ 允许（仅类型，repository.ts 实现 interface）

model   ──►  任何    ❌ 禁止
```

**model 是最底层**——它**永远不**反向依赖任何层。

## 10. 设计系统约束

model 不涉及 UI 设计系统。但：

- **TerminalTheme 类型影响 xterm 配色**——5 个调色板在 `model/settings/terminal/palettes/`
- **颜色值用 CSS 兼容格式**（`#RRGGBB` 或 `rgb(...)`）—— xterm 能直接消费
- **不要在 model 里 hardcode UI 专用的 CSS 变量**——model 不知道 design-system

## 11. 测试

每个 domain 都有 `*.test.ts`：

```
model/session/accessor.test.ts
model/session/rules.test.ts
model/workspace/rules.test.ts        # paneTree 算法必须 100% 覆盖
model/settings/accessor.test.ts
model/cross-cutting/textTransform.test.ts
```

**为什么 model 测试最重要**：

- **model 是最底层**——上层（service / app / ui）都依赖它
- **model 出 bug = 全 app 出 bug**——下游影响范围最大
- **model 是纯函数**——测试简单，无需 mock
- **paneTree 算法必须 100% 覆盖**——是 xsterm 关键路径（split / close / resize / drag 都基于它）

## 12. 依赖变更流程

### 12.1 新增 model field

```
1. model/<domain>/types.ts           # 加 field + 更新 interface
2. model/<domain>/rules.ts           # 加 immutable update function
3. model/<domain>/accessor.ts        # 加 query helper（如果需要）
4. service/<domain>/store.ts         # 更新 zustand schema（添加字段）
5. service/<domain>/defaults.ts      # 更新默认值（如果有）
6. service/persistence/api.ts        # 更新 schema migration（如需要）
7. app/<domain>/usecases/*.ts        # 读 / 写新字段
8. ui/<domain>/view/*.tsx           # render 新字段
9. 更新本文档 §6 索引
```

### 12.2 新增 ANSI preset

```
1. model/settings/terminal/themes.ts        # 加 preset id + 元数据
2. model/settings/terminal/palettes/<name>.ts  # 加调色板
3. model/settings/terminal/index.ts         # 注册到 TERMINAL_THEMES
4. ui/settings/view/SettingsView.tsx        # 加 UI 选项
5. 更新本文档 §3.1
```

### 12.3 修改 paneTree 算法

```
1. model/workspace/rules/paneTree.ts        # 修改算法
2. model/workspace/rules/paneTree.test.ts   # 100% 覆盖测试
3. service/workspace/store.ts               # 确认 mutation 调用新算法
4. app/workspace/usecases/splitPane.ts      # 确认 useCase 调用正确
```

**paneTree 是关键路径**——任何修改必须 100% 测试覆盖。
