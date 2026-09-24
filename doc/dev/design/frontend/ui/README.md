# Frontend · UI 层

> **职责**：React 视图层。把 app 层编排好的 useCase、service 返回的数据、model 类型，渲染成用户看得见、操作得了的 UI。
>
> UI 层只 render + 交互，**不**装业务、**不**直跳 infra、**不**持有跨组件的全局状态。
>
> **位置**：`src/ui/`（与 `src/app/` 平级，是 frontend 的第 5 层，详见 [`../README.md`](../../README.md) 与 [`../app/README.md`](../app/README.md)）。

## 1. 一句话架构

`ui/` = **7 个业务域视图目录 + 3 个支撑目录 + 顶层壳组件**

```
src/ui/
├── layout/         app shell（永远在场：标题栏、主容器、底部栏）
├── terminal/       终端渲染核心（Terminal / Pane / TabBar）
├── sidebar/        左侧三栏（Session / Window / Workspace manager）
├── dialogs/        所有对话框（按 UI 风格集中）
├── settings/       设置页 + 5 个 tab
├── tmux/           tmux -CC 跨域视图集中簇
├── primitives/     UI 原子（Dialog / FormField / ContextMenu）
│
├── hooks/          view-level 编排 hook（useCommandExecutor 等）
├── styles/         设计系统落实（global.css / layout.css / pane.css）
├── icons/          Icon.tsx
├── assets/         logo / favicon 等静态资源
│
├── AppLayout.tsx   顶层壳（在 layout/ 下亦可）
├── NavBar.tsx
└── InitWindowView.tsx
```

## 2. 子目录职责

| 目录 | 包含 | 谁触发 | 调谁 |
|---|---|---|---|
| `layout/` | AppLayout / NavBar / WorkspaceContainer / WorkspaceBottomBar | 顶层 | terminal + sidebar + dialogs |
| `terminal/` | Terminal / Pane / PaneTree / PaneInitCard / TabBar / WindowTabBar / CommandSendPanel | layout | `app/modules/pane`、`app/modules/window` |
| `sidebar/` | Sidebar + 3 个 manager | layout | `app/modules/{session,window,workspace}` |
| `dialogs/` | 12 dialog + 8 form 原子 + form parsers + context menu helpers | 各业务组件 | `app/modules/*` + `app/composition/*` |
| `settings/` | SettingsView + 5 tab | layout | `app/service/{theme,logger}` 等只读配置 |
| `tmux/` | TmuxControlWindowView + TmuxSessionControl + TmuxWindowsControl + ErrorBanner | terminal | `app/modules/session` + `service/tmux` |
| `primitives/` | Dialog / FormField / ContextMenu | dialogs + settings | （无业务依赖） |

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

## 5. module 划分（UI 内部依赖图）

UI 内部按"角色分层"切，**不是按业务域平铺**。这是跟 app 层的 5 个平铺 module 的根本区别——

| 层               | 子目录                                        | 角色                                   | 谁依赖它                                      |
| --------------- | ------------------------------------------ | ------------------------------------ | ----------------------------------------- |
| **L1 — shell**  | `layout/`                                  | 顶层壳，决定整个 app 的"长什么样"                 | 入口（main.tsx → App → AppLayout）            |
| **L2 — 业务视图**   | `terminal/`、`sidebar/`、`settings/`、`tmux/` | 各自承载一类业务视图                           | layout                                    |
| **L3 — UI 风格层** | `dialogs/`                                 | 复用形态（dialog 长得都一样，集中维护视觉）            | L2 视图 + L2 业务组件（sidebar 调 NewGroupDialog） |
| **L4 — UI 原子**  | `primitives/`                              | Dialog / FormField / ContextMenu，无业务 | L3 dialogs + L2 settings（直接用 FormField）   |

**依赖方向**（强制单向）：

```
main.tsx → L1 layout → L2 业务视图 → L3 dialogs → L4 primitives
                                      ↘
                                  L4 primitives（settings 也直接用）
```

反之**严禁**：

- `primitives/` → 任何上层（primitives 无业务概念）
- `dialogs/` → `terminal/` 或 `settings/`（dialogs 不感知具体业务视图）
- `terminal/` → `sidebar/` 或 `settings/`（业务视图之间互不依赖）
- `layout/` → 任何业务视图的内部组件（layout 只组装 4 个槽位）

### 5.1 为什么 tmux 单独成簇

tmux -CC 视图（control window / window 列表 / session 控制条 / 错误 banner）跟 session/window/pane 三 module 都强耦合，但走独立事件总线（`eventBuses/tmux`）。在 app module 层**不**单独切 tmux（避免 5 个 module 变成 6 个），在 UI 层**单独成簇**集中：

```
ui/tmux/
├── TmuxControlWindowView.tsx
├── TmuxSessionControl.tsx
├── TmuxWindowsControl.tsx
└── TmuxControllerErrorBanner.tsx
```

`terminal/Terminal.tsx` 跟 `ui/tmux/TmuxControlWindowView.tsx` 通过 props / context 协作，**不**互相 import。

### 5.2 为什么 dialogs 不是 L2 平铺而是 L3 风格层

代码统计显示当前 `dialogs/` 里 31 个文件横跨 4 个业务域（session / group / save / paste）。如果按业务域平铺成 `dialogs/{session,group,save,paste}/`，会出现"group dialog 被 sidebar 调、save dialog 被 layout 调、session dialog 被 settings 调"的**多点散落**，增加跨模块协调成本。

把 dialogs 提为 L3 风格层后：

- 所有 dialog 视觉一致（同一个 `primitives/Dialog` 套壳）
- 业务方按需 import：`sidebar/NewGroupDialog`、`layout/SaveWorkspaceDialog`、`settings/SelectSessionDialog`
- 新加 dialog 只需决定"放哪个业务文件里"，不用关心模块归属

代价：dialogs 目录文件多（31 个），靠命名约定（`<Business><Action>Dialog.tsx`）保持可读性。

### 5.3 为什么 sidebar 引用 dialogs 但反过来不行

实际代码里 `ui/sidebar/` 引用 `ui/dialogs/NewGroupDialog`、`EditGroupDialog` ——这是**正确**的跨层调用（sidebar 是 L2 业务视图，dialogs 是 L3 风格层）。反过来如果 dialogs 引用 sidebar，会出现"dialog 知道 sidebar 存在"的乱伦依赖。

判断规则：

> **被依赖次数多的在下层**。primitives 被引 17 次、dialogs 被引 3 次 —— 越底层被引越多，向上单依赖。

### 5.4 业务视图 4 个子目录的边界

| 子目录 | 主语 | 唯一进口 | 不允许调 |
|---|---|---|---|
| `terminal/` | 一个 pane 的渲染 | `layout/WorkspaceContainer.tsx` | sidebar/settings/tmux/dialogs（除 layout 通过 props 注入） |
| `sidebar/` | 三栏（session/window/workspace）+ toolbar | `layout/AppLayout.tsx` | terminal/settings/tmux（侧栏不放终端） |
| `settings/` | 设置页 + 5 tab | `layout/AppLayout.tsx`（设置按钮触发） | terminal/sidebar/dialogs |
| `tmux/` | tmux -CC 跨域视图 | `terminal/Terminal.tsx`（判断 session 是 tmux 后挂载） | sidebar/settings/dialogs |

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
