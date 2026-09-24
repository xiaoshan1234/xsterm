# Frontend · UI 层

> **职责**：React 视图层。把 app 层编排好的 useCase、service 返回的数据、model 类型，渲染成用户看得见、操作得了的 UI。
>
> UI 层只 render + 交互，**不**装业务、**不**直跳 infra、**不**持有跨组件的全局状态。
>
> **位置**：`src/ui/`（与 `src/app/` 平级，是 frontend 的第 5 层，详见 [`../README.md`](../../README.md) 与 [`../app/README.md`](../app/README.md)）。

## 1. 一句话架构

`ui/` = **5 个 module（每个 3 份文档）+ 3 个支撑目录**

```
src/ui/
├── layout/         L1 shell — app 壳（AppLayout / NavBar / WorkspaceContainer）
├── terminal/       L2 业务 — pane 渲染 + tab bar（含 tmux 扩展视图簇）
├── sidebar/        L2 业务 — 左侧三栏（session / window / workspace manager）
├── ui-kit/         L3+L4 复用层 — dialogs + primitives + settings（统一复用形态）
├── hooks/          UI 编排 hook — useCommandExecutor / useSessionDragDrop 等
│
├── styles/         设计系统落实（global.css / layout.css / pane.css）
├── icons/          Icon.tsx
└── assets/         logo / favicon 等静态资源
```

> **关键变化**（v3）：dialogs / settings / primitives 三个散落目录合并为 1 个 **ui-kit module**。tmux 并入 terminal module。详见每个 module 的 RESPONSIBILITY.md。

## 2. 5 个 module 索引

每个 module 有 3 份文档：**职责（RESPONSIBILITY）/ 对外接口（INTERFACE）/ 对下依赖（DOWNSTREAM）**。

| module | 职责 | 对外接口 | 对下依赖 | 包含文件数 |
|---|---|---|---|---|
| **layout** | [RESPONSIBILITY](./layout/RESPONSIBILITY.md) | [INTERFACE](./layout/INTERFACE.md) | [DOWNSTREAM](./layout/DOWNSTREAM.md) | 5 |
| **terminal** | [RESPONSIBILITY](./terminal/RESPONSIBILITY.md) | [INTERFACE](./terminal/INTERFACE.md) | [DOWNSTREAM](./terminal/DOWNSTREAM.md) | 11（含 tmux 4） |
| **sidebar** | [RESPONSIBILITY](./sidebar/RESPONSIBILITY.md) | [INTERFACE](./sidebar/INTERFACE.md) | [DOWNSTREAM](./sidebar/DOWNSTREAM.md) | 5 |
| **ui-kit** | [RESPONSIBILITY](./ui-kit/RESPONSIBILITY.md) | [INTERFACE](./ui-kit/INTERFACE.md) | [DOWNSTREAM](./ui-kit/DOWNSTREAM.md) | 34（dialogs 31 + primitives 3） |
| **hooks** | [RESPONSIBILITY](./hooks/RESPONSIBILITY.md) | [INTERFACE](./hooks/INTERFACE.md) | [DOWNSTREAM](./hooks/DOWNSTREAM.md) | 3（待新增 2 个） |

### 2.1 5 个 module 的依赖图

```
main.tsx → App.tsx
            │
            ▼
        ┌─────────────────────────────────┐
        │  L1: layout (唯一允许直跳 infra) │
        └────────────┬────────────────────┘
                     │
       ┌─────────────┼────────────────┐
       ▼             ▼                ▼
   L2 terminal   L2 sidebar        L2 ui-kit(settings)
       │             │                ▲
       │             │                │
       └─────────────┴────────────────┘
                     │
                     ▼
                L2 ui-kit(dialogs)
                     │
                     ▼
                L4 ui-kit(primitives)

                ─── 平行 ───
                L2 hooks（被 layout / terminal / sidebar 消费）
```

### 2.2 每个 module 的"一句话主语"

| module | 主语 | 唯一进口 |
|---|---|---|
| layout | app 的壳 | `main.tsx → App.tsx → <AppLayout>` |
| terminal | 一个 pane 的渲染 | `layout/WorkspaceContainer` |
| sidebar | 左侧三栏 + toolbar | `layout/AppLayout` |
| ui-kit | 所有 UI 复用形态 | 任意 L2（按需） |
| hooks | React 副作用封装 | 任意 L2（按需） |

## 3. 关键约束

- **不直接 import `infra/`**——所有 IPC 走 service / app / composition。
- **不写业务规则**——业务规则在 `app/rules/`。UI 里只能有"展示用的纯函数 helper"（例如 ANSI 高亮、tab 顺序计算），且应放在该 helper 服务的那个 view 子目录里，不抽公共。
- **不直接 import 兄弟 module 的内部 useCase**——只能走 `app/<module>` 的 barrel (`index.ts`)。
- **不持有跨组件全局状态**——跨组件共享状态在 `service/*/store.ts`（store 是 service 层的职责）。
- **组件只接受 props / 调编排 hook**——业务编排交给 hook，hook 调 useCase，useCase 调 service。

## 4. 依赖方向

```
ui/  ──►  app/  (modules + composition + rules)
   │
   └─►  model/   (读 types)
       service/ (可选 — 仅当纯查询、不需要 useCase 编排时)
```

**禁止**：

- `ui/` → `infra/`（任何路径都禁止）
- `ui/` → `app/modules/<x>/<y>.ts` 的内部文件（必须走 barrel）
- `ui/` 写 `useSessionStore.getState().setX(...)` 这种直跳 store——store 写操作必须经 useCase

## 5. module 划分的内部依赖图

5 个 module 的内部依赖图（按 L1/L2/L3/L4 角色分层）：

```
            ┌─────────────────────────────────┐
            │  L1: layout (唯一允许直跳 infra) │
            └────────────┬────────────────────┘
                         │
       ┌─────────────────┼──────────────────────┐
       ▼                 ▼                      ▼
   L2 terminal      L2 sidebar          L2 ui-kit/settings
       │                 │                      ▲
       │  (含 tmux/ 4 文件)                    │
       └─────────────────┴──────────────────────┘
                         │
                         ▼
                  L3 ui-kit/dialogs
                         │
                         ▼
                  L4 ui-kit/primitives

   ─── 平行 ───
   L2 hooks（被 layout / terminal / sidebar 消费，不消费 ui 其他 module）
```

**依赖方向**（强制单向）：

- `layout` → `terminal`、`sidebar`、`ui-kit`、`hooks`、`app`、`service`、`model`、`infra`(window control)
- `terminal` → `ui-kit`(dialogs + primitives)、`hooks`、`app`、`service`、`model`
- `sidebar` → `ui-kit`(dialogs + primitives)、`hooks`、`app`、`service`、`model`
- `ui-kit/dialogs` → `ui-kit/primitives`、`ui-kit`(form-atoms)、`model`、`app/rules`
- `ui-kit/primitives` → （无下层依赖）
- `ui-kit/settings` → `ui-kit`(form-atoms + primitives)、`service/persistence`、`model`
- `hooks` → `app`、`service`、`model`、`react`

**严禁**：

- `ui-kit/primitives` → 任何上层（primitives 无业务概念）
- `ui-kit/dialogs` → `ui-kit/settings`（dialogs 不感知 settings）
- `terminal` ↔ `sidebar`（L2 之间互不依赖，只通过 layout 协调）
- `layout` → 任何业务视图的内部组件（layout 只组装 4 个槽位）
- 任何 ui module 直跳 `infra/`（**唯一例外**：layout 的 `NavBar` 用 `getCurrentWindow()` 做窗口控制）

### 5.1 为什么 ui-kit 是一个 module 而不是三个

`dialogs/` / `primitives/` / `settings/` 三个目录合为一个 **ui-kit module**，理由：

- **dialogs 重度依赖 primitives**（17 处 import）
- **settings 重度复用 dialogs**（5 个 tab 是 dialogs 的"特例视图"）
- **primitives 是 dialogs / settings 的公共基础**

如果拆成 3 个 module：

1. 3 个 module 的对外接口高度重合（都是"props 形式"）
2. 对下依赖几乎相同（都依赖 model / service）
3. 跨 module 协调成本高（"加 form field 必须先 review primitives"）

合成 1 个 ui-kit 后：单一 barrel 暴露所有可复用形态，对外接口分 4 段（dialogs / primitives / form-atoms / settings），内部依赖单向 `primitives ← dialogs / settings`。

### 5.2 为什么 tmux 并入 terminal 而不是独立 module

tmux -CC 视图（control window / window 列表 / session 控制条 / 错误 banner）跟 session / window / pane 三 module 都强耦合，但走独立事件总线（`eventBuses/tmux`）。

- 在 app module 层**不**单独切 tmux（避免 5 个 module 变成 6 个）
- 在 UI 层**也**不单独成 module，并入 terminal — 因为 4 个文件过小（不值得 3 份文档开销）
- terminal 模块通过 `props.renderTmuxControl` 回调让 layout 注入 tmux 视图，避免 terminal 直引 `ui/tmux/`

### 5.3 为什么 hooks 单独成 module

hooks 是**跨 module 共享的副作用封装**——terminal 用 `useSessionDragDrop`，sidebar 也用：

- 放在 `service/` 不能（hooks 是 React-aware，用 useState / useEffect）
- 放在 ui/ 顶层某个文件会污染 ui 的"组件树"结构
- 单独 `ui/hooks/` 目录明确边界，3 个文件 + 2 个待新增 = 5 个 hook，全部走 INTERFACE.md 单一入口

### 5.4 业务视图 3 个 module 的边界

| module | 主语 | 唯一进口 | 不允许调 |
|---|---|---|---|
| `terminal` | 一个 pane 的渲染（含 tmux） | `layout/WorkspaceContainer` | sidebar / layout 内部组件 |
| `sidebar` | 三栏 + toolbar | `layout/AppLayout` | terminal / layout 内部组件 |
| `ui-kit/settings` | 设置页 + 5 tab | `layout/AppLayout`（设置按钮触发） | terminal / sidebar / dialogs |

## 6. 静态资源归位

CSS / icons / assets 跟 ui 层就近放，**不**放 src/assets/ 这种顶层目录：

```
ui/styles/    global.css + layout.css + pane.css    设计系统落实
ui/icons/     Icon.tsx                              图标组件
ui/assets/    logo.svg / logo-icon.svg / react.svg  静态资源
```

如果以后出现不属于任何 view 子目录的通用 CSS（比如设计系统 tokens），扩展到 `ui/styles/tokens.css`，**不**提到 src/ 顶层。

## 7. 与 app 层的关系

```
ui/  ──depends on──►  app/
                       ├── modules/{session,window,pane,workspace}/
                       ├── composition/{tmuxWindow,savedWindow}.ts
                       └── rules/{paneTree,sessionRules,...}.ts
```

app 层反过来**不**依赖 ui：

```
app/  ──╳──►  ui/   (禁止)
```

这条约束的可机械校验形式：

```bash
# app/ 不能 import ui/
grep -rn 'from\s*"../../ui' src/app/ --include="*.ts" --include="*.tsx"  # 必须为空
grep -rn 'from\s+"\.\./\.\./ui' src/app/ --include="*.ts" --include="*.tsx"  # 必须为空

# app/ 不能有 .tsx
find src/app -name '*.tsx'  # 必须为空
```

## 8. 设计系统约束

所有 UI 改动必读 [`../../../design-system.md`](../../../design-system.md)。

三层校验 grep（pre-commit 必跑）：

```bash
grep -rn -E "(--bg-primary|--bg-secondary|--bg-tertiary|--text-primary|--text-secondary|--text-muted|--border-color|#0e639c|#1177bb|linear-gradient)" src/ --include="*.ts" --include="*.tsx" --include="*.css"
grep -rn "font-weight: ?(600|700|bold)" src/ --include="*.ts" --include="*.tsx" --include="*.css"
grep -rn "box-shadow:" src/components/ --include="*.css"
```

违反任何一条不允许 merge。

## 9. 验收标准（详见 app/README.md §8）

- 59 个旧 UI 文件全部可被 `import { xxx } from "ui/<subdomain>/..."` 找到
- 7 个静态资源（CSS 3 + icons 1 + assets 3）全部位于 `ui/{styles,icons,assets}/`
- `find src/app -name '*.tsx'` 必须为空
- `grep -rn 'ui/' src/app/` 必须为空（app 不引 ui）
- `npm test` + `npm run lint` + `tsc --noEmit` 全绿
