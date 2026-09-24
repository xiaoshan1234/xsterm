# Frontend · App 层（重新设计 v2）

> **职责**：暴露给外部的入口——React 组件树、用例编排、领域规则。
> app 层 = UI + 用例 + 视图模型。app 层是用户**唯一看得到**的层。
>
> **v2 变更**：把视图层（React 组件）从 `src/app/views/` 提到**顶层 `src/ui/`**，与 `src/app/` 平级，成为 frontend 的**第 5 层**。
> v1（72 useCase + 5 module + views/ 子目录）的设计见 git history，本版替换。
>
> **本 README 是设计文档**——描述目标态结构，不描述现状改造步骤。改造时按 §9 的 PR 切片执行。

## 1. 一句话架构（v2）

frontend = **4 model layer + 1 app layer + 1 ui layer**

```
src/
├── model/                数据（types / repository / events / accessor / model）
├── service/              业务编排（按 domain 拆）
├── infra/                IPC / store / clipboard / buffer / logger 适配
├── app/                  用例编排 + 领域规则（无 UI）
└── ui/                   React 视图层（与 app 平级，app 不再持有任何 .tsx）
```

> **关键决定**：v1 把 views/ 放在 `app/views/` 子目录。v2 把整个 UI 提到顶层 `src/ui/`，原因是——
>
> 1. **依赖方向更清晰**：`ui/` 只依赖 `app/`、`service/`、`model/`，不依赖 `infra/`（业务编排走 app）；
> 2. **app 层零 JSX**：搜索 `.tsx` 在 `app/` 里**应当返回 0 个结果**——这是结构性保证，"app 不写 UI"变成可机械校验的规则；
> 3. **CSS / icon / asset 跟组件绑定**：v2 的 `ui/` 自带 `styles/`、`icons/`、`assets/`，跟组件就近，避免跨目录找 CSS。
>
> 此外，"app 是 4+1 module"的设计本身也调整了——见 §2。

## 2. app 层：5 个 module（4 主 + 1 辅助）+ 1 个 rules 共享内核 + 1 个 composition

> v2 把 group 从独立 module 降级为 workspace 的子 module（理由见 §3.5），其他 4 主 module 不变。

```
src/app/
├── modules/                            4 主 module + 1 辅助
│   ├── session/                        会话生命周期
│   ├── workspace/                      工作区生命周期（内含 group 子 module）
│   ├── window/                         窗口操作
│   └── pane/                           分屏操作
│
├── composition/                        跨 module 编排（v2 新增的"跨边界胶水"层）
│   ├── tmuxWindow.ts
│   └── savedWindow.ts
│
├── rules/                              5 个纯函数文件（无 React、无 IPC、无副作用）
│   ├── paneTree.ts                     分屏树算法
│   ├── sessionRules.ts                 会话排序 / 过滤 / 唯一命名
│   ├── workspaceRules.ts               工作区排序与 default 规则
│   ├── textTransform.ts                ANSI / 文本转换 helper
│   └── constants.ts                    app 层常量
│
└── index.ts                            顶层 barrel
```

**核心约束**：

- **`app/` 里没有任何 `.tsx`**。搜索 `find src/app -name '*.tsx'` 必须返回 0。违反 = 架构违规。
- **`app/` 不知道 React 存在**（除了规则层的"返回 React-friendly shape"——但 rules/ 是纯函数，仍不 import React）。
- **module 之间单向依赖**：`session → window → pane`，反之不行；workspace 平行。
- **module 不直接 import 兄弟 module 内部文件**——只能 import 兄弟 module 的 barrel (`./`)。

## 3. 5 个 module 的边界

### 3.1 `modules/session/`

**主语**：一个会话的一生。

**职责**：create（6 个：local/ssh/tmux 各 2 个变体）、open（saved config → 重建）、lifecycle（close/reconnect/rename）、displayConfig 应用。

```
modules/session/
├── index.ts                            barrel
├── create.ts                           createLocalSession{,Only} / createSshSession{,Only} / createTmuxSession{,Only}
├── open.ts                             openSavedSession（按 savedConfig.type dispatch）
├── lifecycle.ts                        close / reconnect / rename
├── displayConfig.ts                    applyDisplayConfigToLiveSession
└── *.test.ts
```

**允许调**：`infra.createXxxSession`、`service/session/*`、`model/session/*`、`rules/sessionRules`。
**禁止调**：兄弟 module 内部；model/window；model/pane（共享数据走 model/index）。

### 3.2 `modules/window/`

**主语**：一个 window（tab）的一生。

```
modules/window/
├── index.ts
├── create.ts                           createWindow / createInitWindow / replaceInitWindowWithSession
└── lifecycle.ts                        close / rename / reorder / setActive
```

**允许调**：`service/workspace/*`、`model/window/*`、`rules/paneTree`、`modules/session/*`（用 `createLocalSessionOnly` 之类）。
**禁止调**：`modules/pane/*` 内部（除 barrel）；tmux 内部细节。

### 3.3 `modules/pane/`

**主语**：一个分屏节点的一生。

```
modules/pane/
├── index.ts
├── split.ts                            splitPane（唯一会跳进 tmux infra 的地方）
└── lifecycle.ts                        close / setActive
```

**允许调**：`service/workspace/*`、`model/pane/*`、`rules/paneTree`、`infra/tauri/commands/tmux`（仅 splitPane 用）。
**禁止调**：window/session module 内部。

### 3.4 `modules/workspace/`

**主语**：工作区 + 其内含的 group。

> v2 跟 v1 不同：v1 把 group 单独成 module；v2 把 group 作为 workspace 的子 module，因为 group 只操纵 `service/persistence/*` 的 `groups` 字段，跟 workspace 持久化紧邻，单独抽 module 是过度拆分。

```
modules/workspace/
├── index.ts                            barrel — re-export workspace + group
├── workspace/
│   ├── create.ts                       createWorkspace
│   ├── lifecycle.ts                    closeWorkspace
│   └── persistence.ts                  saveWorkspace / loadWorkspace / deleteSavedWorkspace / renameSavedWorkspace
│                                       / saveConfigOnly / removeConfig
├── group/                              ← v2 内嵌
│   ├── create.ts                       createGroup
│   └── lifecycle.ts                    deleteGroup / moveConfigToGroup
└── *.test.ts
```

**允许调**：`service/workspace/*`、`service/persistence/*`、`model/workspace/*`。
**禁止调**：session/window/pane 内部。

### 3.5 为什么 group 不是独立 module（v2 决策记录）

v1 把 group 提成 5 个独立 module 之一，理由是"它跟 session 同级展示"。v2 重新评估后否决，理由：

1. group 不操纵任何 session/window/pane 状态，只动 persistence store 的 `groups` 字段；
2. group UI 永远跟 workspace UI 在同一侧栏（`Sidebar.WorkspaceManager` 包含 group 编辑），没有独立场景；
3. 独立 module 反而模糊 workspace 的"主语"——workspace 的主语究竟是"工作区"还是"工作区+组"？

如果将来出现「group 跨 workspace 共享」或「group 独立成产品功能」的需求，再把 group 提回独立 module。

## 4. composition 跨 module 编排层

> v2 新增，v1 放在 views/。

```
app/composition/
├── tmuxWindow.ts                       createTmuxWindow — 同时碰 session + window + workspace
└── savedWindow.ts                      saveWindow / loadWindow / deleteSavedWindow — 跨 window + workspace 持久化
```

**核心规则**：跨 module 的 use case 不能进 module 内部（违反单向依赖），也**不**进 ui/（ui 只能 render，不能装业务）。所以需要一个**第三层**——`composition/`。

**composition vs module 区别**：

| 维度 | module | composition |
|---|---|---|
| 跨 module 调用 | ❌ 禁止 | ✅ 允许（按需 import 各 module 的 barrel） |
| 持有状态 | ❌ | ❌ |
| 可单测 | ✅ | ✅（更复杂的 setup） |
| 数量 | 多（每域一个） | 少（只有真正跨域的） |
| 谁触发 | UI 组件 / Context | UI 组件 / Context（**不直接进 ui 渲染路径**——通过 hook 间接调） |

## 5. ui 层：与 app 平级（v2 关键变更）

```
src/ui/                                 ← v2：从 src/app/views/ 提到顶层
├── main.tsx 已存在                     不动
├── AppLayout.tsx
├── NavBar.tsx
├── InitWindowView.tsx
│
├── layout/                             app shell — 永远在场
│   ├── AppLayout.tsx
│   ├── NavBar.tsx
│   ├── WorkspaceContainer.tsx
│   └── WorkspaceBottomBar.tsx
│
├── terminal/                           终端渲染核心
│   ├── Terminal.tsx
│   ├── Pane.tsx
│   ├── PaneTree.tsx
│   ├── PaneInitCard.tsx
│   ├── TabBar.tsx
│   ├── WindowTabBar.tsx
│   └── CommandSendPanel.tsx
│
├── sidebar/                            左侧三栏
│   ├── Sidebar.tsx
│   ├── SidebarToolbar.tsx
│   ├── SessionManager.tsx
│   ├── WindowManager.tsx
│   └── WorkspaceManager.tsx
│
├── dialogs/                            UI 风格目录（所有 dialog 都长一样）
│   ├── CreateSessionDialog.tsx
│   ├── EditSessionDialog.tsx
│   ├── EditGroupDialog.tsx
│   ├── NewGroupDialog.tsx
│   ├── SaveWorkspaceDialog.tsx
│   ├── SaveDialog.tsx
│   ├── SelectSessionDialog.tsx
│   ├── PasteConfirmDialog.tsx
│   ├── CollapsibleSection.tsx
│   ├── SessionFormLayout.tsx
│   ├── SessionFormPanels.tsx
│   ├── ShellSettingsPanel.tsx
│   ├── SSHSettingsPanel.tsx
│   ├── SshConnectionSection.tsx
│   ├── SshSessionForm.tsx
│   ├── TmuxForm.tsx
│   ├── FormCheckboxField.tsx
│   ├── FormNumberField.tsx
│   ├── FormRadioGroup.tsx
│   ├── FormSelectField.tsx
│   ├── FormTextField.tsx
│   ├── FormField.tsx                   （可能在 primitives/，见后）
│   ├── useSessionForm.ts
│   ├── formParsers.ts
│   ├── sessionDialogItems.tsx
│   ├── paneContextMenu.ts
│   └── pasteConfirm.ts
│
├── settings/                           设置页
│   ├── SettingsView.tsx
│   ├── AppearanceTab.tsx
│   ├── InputTab.tsx
│   ├── LoggingTab.tsx
│   ├── SessionTab.tsx
│   └── TerminalTab.tsx
│
├── tmux/                               tmux 跨域视图（独立簇）
│   ├── TmuxControlWindowView.tsx
│   ├── TmuxSessionControl.tsx
│   ├── TmuxWindowsControl.tsx
│   └── TmuxControllerErrorBanner.tsx
│
├── primitives/                         UI 原子
│   ├── Dialog.tsx
│   ├── FormField.tsx
│   └── ContextMenu.tsx
│
├── hooks/                              view-level hooks（编排 useCases）
│   ├── useCommandExecutor.ts
│   ├── useCommandTargets.ts
│   └── useSessionDragDrop.ts
│
├── styles/                             设计系统落实（CSS）
│   ├── global.css
│   ├── layout.css
│   └── pane.css
│
├── icons/
│   └── Icon.tsx
│
└── assets/
    ├── logo.svg
    ├── logo-icon.svg
    └── react.svg
```

### 5.1 ui 层的依赖规则

```
ui/  ──►  app/  (useCases + composition)
   │
   └─►  model/  (读 types)
       service/  (可选 — 仅当不需要走 useCase 的纯查询)
       rules/    (可选 — 来自 app/rules/，但 ui 也可以独立再写纯函数 helper)
```

**禁止**：

- `ui/` 直接 import `infra/`（所有 IPC 走 service / app / composition）
- `ui/` 写业务规则——业务规则在 `app/rules/`；ui 里只能有"展示用的纯函数 helper"
- `ui/` import 兄弟 module 的内部 useCases——只能走 `app/<module>` 的 barrel

### 5.2 ui 内部的"业务域"切分逻辑

- **`layout/`** — app shell，永远在场
- **`terminal/`** — 终端渲染核心（跟 pane module 紧邻）
- **`sidebar/`** — 左侧三栏（对应 session/window/workspace module 的可视化）
- **`dialogs/`** — UI 风格目录（所有 dialog 长一样，集中维护视觉一致性）
- **`settings/`** — 设置页（5 个 tab）
- **`tmux/`** — 跨 session/window/pane 的特殊视图集中
- **`primitives/`** — UI 原子，被 dialogs/settings 都消费

为什么不按"view 类型"切（pages/panels/widgets）：v1 试过这种切法，结果 layout 跟 panel 互相嵌套时产生循环依赖。**业务域切法保证依赖单向**（layout → terminal/sidebar/settings/dialogs）。

## 6. 完整新目录结构（v2 全景）

```
src/
├── main.tsx
├── App.tsx
│
├── model/                              纯数据 + 派生
├── service/                            业务编排（按 domain 拆）
├── infra/                              Tauri / store / clipboard / buffer 适配
│
├── app/                                用例编排（v2 零 JSX）
│   ├── index.ts
│   ├── modules/
│   │   ├── session/
│   │   ├── window/
│   │   ├── pane/
│   │   └── workspace/
│   │       ├── workspace/
│   │       └── group/                  ← 内嵌
│   ├── composition/                    ← v2 新增
│   │   ├── tmuxWindow.ts
│   │   └── savedWindow.ts
│   └── rules/
│       ├── paneTree.ts
│       ├── sessionRules.ts
│       ├── workspaceRules.ts
│       ├── textTransform.ts
│       └── constants.ts
│
└── ui/                                 ← v2：从 app/views/ 提到顶层
    ├── layout/
    ├── terminal/
    ├── sidebar/
    ├── dialogs/
    ├── settings/
    ├── tmux/
    ├── primitives/
    ├── hooks/
    ├── styles/
    ├── icons/
    ├── assets/
    ├── AppLayout.tsx                   （在 layout/ 下也行，看个人偏好）
    ├── NavBar.tsx
    └── InitWindowView.tsx
```

## 7. 关键约束（汇总）

### 7.1 跨层约束

| 上层 ↓ \ 下层 → | model | service | infra | app | ui |
|---|---|---|---|---|---|
| model | — | ❌ | ❌ | ❌ | ❌ |
| service | ✅ | ❌ | ✅ | ❌ | ❌ |
| infra | ✅ | ❌ | ❌ | ❌ | ❌ |
| app | ✅ | ✅ | ✅（仅 module/session 与 module/pane） | ❌ | ❌ |
| ui | ✅ | ✅（可选） | ❌ | ✅ | ❌ |

**app 不依赖 ui**：方向单向。

### 7.2 app 内部约束

- `app/` 下 `find . -name '*.tsx'` 必须返回 0。
- module 之间单向：`session → window → pane`；workspace 平行。
- module 不直接 import 兄弟 module 内部文件。
- 跨 module 协作走 `composition/`。
- 共享规则走 `app/rules/`。

### 7.3 ui 内部约束

- ui 不直接 import infra。
- ui 不写业务规则；展示用的纯函数 helper 允许放在 ui 内就近位置。
- ui 内部依赖方向：`layout → {terminal,sidebar,settings,dialogs,tmux,primitives}`，子目录之间互不依赖。
- dialogs 与 primitives 解耦——primitives 不感知 dialogs，dialogs 消费 primitives。

## 8. 验收标准

### 8.1 结构性约束（可 grep 校验）

```bash
# app/ 不允许有 .tsx
find src/app -name '*.tsx'                                    # 必须为空

# ui/ 必须是顶层，不能在 app/ 下
test ! -d src/app/views                                       # 必须为 true

# module barrel 完整性
ls src/app/modules/{session,window,pane,workspace}/index.ts   # 必须全部存在

# composition 独立
ls src/app/composition/{tmuxWindow,savedWindow}.ts            # 必须存在

# ui 子目录完整
ls -d src/ui/{layout,terminal,sidebar,dialogs,settings,tmux,primitives,hooks,styles,icons,assets}  # 必须全部存在
```

### 8.2 运行时约束

- `npm run lint` + `npm test` 全绿
- AGENTS.md 的 grep 三连（设计系统校验）保持 0 命中
- TypeScript：`tsc --noEmit` 零错误
- 没有循环依赖：`madge src/` 或类似工具（如有）

### 8.3 业务覆盖

- 36 个旧 useCase 函数全部可被 `import { xxx } from "app/modules/<domain>"` 或 `import { xxx } from "app/composition/..."` 找到
- 59 个旧 UI 文件全部可被 `import { xxx } from "ui/<subdomain>/..."` 找到
- 7 个静态资源（CSS 3 + icons 1 + assets 3）全部位于 `src/ui/{styles,icons,assets}/`

## 9. 改造 PR 切片建议

每个 PR 改一层/一个 module，独立可合并：

1. **PR-1** `ui/` 目录顶层化（仅移动文件，不改 import 内容；tsc 零错误后再合）
2. **PR-2** `app/composition/` 新建（把 createTmuxWindow + savedWindow 抽出来）
3. **PR-3** `app/modules/pane/` 落地（3 个用例，最小 module）
4. **PR-4** `app/modules/window/` 落地（7 个用例）
5. **PR-5** `app/modules/workspace/` 落地（含 group 内嵌）
6. **PR-6** `app/modules/session/` 落地（11 个用例，最大 module）
7. **PR-7** `app/rules/` 保持原位（不动）
8. **PR-8** 删除 `src/app/useCases/` 旧目录（最后一个 PR，确保所有 import 已迁移）

每个 PR 完成后：

- `npm run format`
- `npm run format:check`
- `npm test`
- `npm run lint`
- AGENTS.md grep 三连

## 10. 设计系统约束

所有视图改动必读 [`../../../design-system.md`](../../../design-system.md)。

三层校验 grep（pre-commit 必跑）：

```bash
grep -rn -E "(--bg-primary|--bg-secondary|--bg-tertiary|--text-primary|--text-secondary|--text-muted|--border-color|#0e639c|#1177bb|linear-gradient)" src/ --include="*.ts" --include="*.tsx" --include="*.css"
grep -rn "font-weight: ?(600|700|bold)" src/ --include="*.ts" --include="*.tsx" --include="*.css"
grep -rn "box-shadow:" src/components/ --include="*.css"
```

违反任何一条不允许 merge。

## 11. 与 v1 的差异汇总

| 维度 | v1 | v2 |
|---|---|---|
| ui 位置 | `src/app/views/` | `src/ui/`（顶层） |
| group | 独立 module（5 主 + 1 辅） | workspace 内嵌子 module |
| 跨 module 编排 | 放在 `app/views/`（混在 UI 里） | 新增 `app/composition/` 层 |
| module 数量 | 5 | 4 + 1 内嵌 |
| `app/` 能否含 .tsx | 允许（views/） | **禁止** |
| CSS / icons / assets | 散落 src/ 多处 | 集中在 `ui/styles/ ui/icons/ ui/assets/` |
| frontend 层数 | 4（app/model/service/infra） | **5**（app/model/service/infra/ui） |
