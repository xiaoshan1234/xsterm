# Module · Terminal — 对下依赖接口

> **位置（目标态）**：`src/ui/terminal/`
>
> 本文档描述 Terminal module **调用的下层接口**——按"调用了哪个层 / 哪个文件 / 调什么"列清楚。
> 任何下层接口变更（重命名、签名变化）需要先评估对 Terminal 的影响。

## 1. 依赖图（Terminal module 调用的所有下层）

```
ui/terminal/  ──►  app/modules/{pane, window}          (useCase 编排)
              ──►  app/rules/{paneTree, sessionRules}  (纯函数)
              ──►  service/{output, workspace, theme}  (store + IPC 桥)
              ──►  model/{pane, window, session}       (types + accessor)
              ──►  ui/primitives/                      (Dialog / ContextMenu，例外)
              ──►  ui/icons/                           (Icon，例外)
```

**调用统计（基于现状 grep）**：
- `service` × 8 次（最重——Terminal 直接读多个 store）
- `infra` × 3 次（**违规**：UI 不应直跳 infra，详见 §6 改造项）
- `model` × 1 次
- `app` × 1 次

## 2. app/modules/ — useCase 编排

| 调用 | 来源 | 何时调 |
|---|---|---|
| `app/modules/pane/lifecycle.resizePane` | pane size 拖拽结束时 | ResizeHandle onResizeEnd |
| `app/modules/pane/split.splitPane` | 用户右键 → split 菜单 | pane 上下文菜单 |
| `app/modules/window/create.replaceInitWindowWithSession` | init pane 用户选了 session | PaneInitCard onPickSaved |
| `app/modules/window/lifecycle.setActiveWindow` | WindowTabBar tab 点击 | WindowTabBar onSelectWindow |
| `app/modules/window/lifecycle.closeWindow` | WindowTabBar close 按钮 | onCloseWindow 回调 |

**当前架构债**：上述 useCase 应当通过 props 回调从 layout 注入，Terminal **不**直接 import `app/modules/*`。当前 `Terminal.tsx` 直接 import 了 service——是 §6 改造项之一。

## 3. app/rules/ — 纯函数

| 调用 | 来源 | 何时调 |
|---|---|---|
| `app/rules/paneTree.ts` 的 `createLeafPane` / `createSplitNode` / `findPaneNode` / `replacePaneNode` / `stripSessionIdFromPaneTree` | pane 树操作 | split / init replace / save snapshot |
| `app/rules/sessionRules.ts` 的 `buildFrontendSession` / `dispatchByType` | session 适配 | init pane → 真实 session 转换 |

**约束**：rules 是无副作用纯函数，调用安全无顺序要求。

## 4. service/ — 状态与 IPC 桥

| 调用 | 来源 | 何时调 |
|---|---|---|
| `service/output/sessionOutputChannel` | xterm 写数据流 | 每个 pane 渲染时订阅 |
| `service/output/sessionOutputBuffer` | 输出帧缓冲 | render 节流 |
| `service/workspace/store` 的 `useWorkspaceStore` | 读当前 workspace / window / pane 树 | 每次 render |
| `service/session/store` 的 `useSessionStore` | 读 session 元数据 | 每次 render |
| `service/theme/store` 的 `useThemeStore` | 读 xterm 配色 | theme 切换时 |
| `service/legacy/contexts/SessionContext` 的 `useSession` | 读当前 sessionId（legacy） | **已废弃**，迁移到 `useSessionStore` |

**约束**：service 是**只读消费**——Terminal 调 `useXxxStore.getState()` 读状态，但**不**调 setter。setter 走 useCase（§2）。

## 5. model/ — 类型

| 调用 | 来源 | 何时调 |
|---|---|---|
| `PaneNode`、`TerminalWindow`、`Session` types | props 类型 + store schema | type-only import |
| `model/session/accessor.ts` 的 `findActiveSession` | 派生计算 | render 时 |
| `model/pane/types.ts` 的 `SplitDirection` | split pane UI | 右键菜单 |

**约束**：model 层 type-only import，不调运行时方法（除了纯函数 accessor）。

## 6. 当前架构债（应在下个改造 PR 清理）

| 现状 | 问题 | 改造方向 |
|---|---|---|
| `Terminal.tsx → service: 8 imports` | UI 直跳 service 绕过 useCase | 走 `app/modules/*` useCase |
| `Terminal.tsx → infra: 3 imports` | UI 直接调 Tauri IPC | 全删，改走 `service/*` |
| `Terminal.tsx → app: 1 import` | UI 调 useCase 是对的，但应当通过 props 回调 | layout 注入 |
| `Pane.tsx → app: 1 import` | 同上 | layout 注入 |

**可机械校验**：

```bash
# UI 不允许直接 import infra
grep -rn 'from\s*"[./]*infra' src/ui/terminal/ --include='*.tsx' --include='*.ts'
# 必须为空

# UI 不允许直接 import app modules（应当走 layout props）
grep -rn 'from\s*"[./]*app/modules' src/ui/terminal/ --include='*.tsx' --include='*.ts'
# 必须为空（除 hooks/ 编排层）
```

## 7. 不允许的依赖

- ❌ `ui/terminal/` → `ui/sidebar/` 或 `ui/settings/`（L2 之间互不依赖）
- ❌ `ui/terminal/` → `ui/dialogs/`（除通过 props 注入的 render 函数）
- ❌ `ui/terminal/` → `ui/tmux/`（通过 props 注入的 renderTmuxControl 间接访问）
- ❌ `ui/terminal/` → `infra/`（任何路径）
- ❌ `ui/terminal/` → `service/*/store` 的 setter（只读 getState）

## 8. 依赖变更流程

当下层接口变更时：

1. **model 类型变更**——同步更新 `INTERFACE.md` §5
2. **service store schema 变更**——同步更新 `INTERFACE.md` §4
3. **app/rules 纯函数签名变更**——影响最小，无需 review，但需要在 commit message 标注
4. **app/modules useCase 签名变更**——影响 `INTERFACE.md` §2 调用列表
5. **infra 接口变更**——Terminal 不应直引 infra；如果确实需要，**必须**先经 service 包装再 review
