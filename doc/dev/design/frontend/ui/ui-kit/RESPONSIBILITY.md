# Module · ui-kit — 职责

> **位置（目标态）**：`src/ui/ui-kit/`
> **位置（现状）**：`src/ui/dialogs/` + `src/ui/primitives/` + `src/ui/settings/` 三处散落——改造 PR-1 统一收编到 `ui-kit/`。
> **L 层**：L3 风格层 + L4 原子层（详见 [`../README.md` §5](../../README.md)）
> **主语**：所有"长得一模一样的 UI 复用形态"——dialog、form 原子、原子 UI 组件、设置 tab
> **唯一进口**：任意 L2 业务视图（terminal / sidebar）

## 1. 这个 module 负责什么

把"用户反复看见的 UI 形态"集中维护，让业务方只关心内容，**不**关心：

- modal 遮罩 / ESC 关闭 / 焦点陷阱 / 动画（primitives/Dialog）
- 表单 label / error / required 标记（primitives/FormField）
- 右键菜单定位 / 关闭逻辑（primitives/ContextMenu）
- 主题适配（dark mode）
- 整个设置页的导航 + 5 个 tab 的容器（settings/SettingsView）
- 31 个业务 dialog 的视觉一致性

这些全部在 ui-kit 内部统一，业务方只调组件、不实现壳。

## 2. 为什么 dialogs / primitives / settings 合并成 1 个 module

3 个子目录有强耦合：

- **dialogs 重度依赖 primitives**（17 处 import，Dialog / FormField / ContextMenu）
- **settings 重度复用 dialogs**（5 个 tab 实际是 dialogs 模块的"特例视图"——非 modal panel）
- **primitives 是 dialogs/settings 的公共基础**

如果拆成 3 个 module，会出现：

1. 3 个 module 的对外接口高度重合（都是"props 形式"）
2. 对下依赖接口几乎完全相同（都依赖 model / service）
3. 跨 module 协调成本（"dialogs 想加个新 form field 必须先 review primitives 是不是已实现"）

合成 1 个 ui-kit 后：

1. 单一 barrel 暴露所有可复用形态
2. 对外接口分 4 段（§3 详情）
3. 内部依赖单向 primitives ← dialogs / settings

## 3. 这个 module **不**负责什么

- **不持有全局 dialog 状态**——dialog 是否打开由调用方（layout / sidebar）控制，dialog 自己只接受 `open: boolean` prop
- **不直接调 backend IPC**——所有"提交"动作通过 props 传入的回调实现，回调内部走 useCase
- **不渲染业务视图**——terminal / sidebar 不归 ui-kit 管
- **不持有跨组件全局状态**——设置值的持久化由调用方（SettingsView）走 service/persistence

## 4. 子目录组织（目标态）

```
ui/ui-kit/
├── dialogs/                          31 个业务 dialog（按业务域分组见下）
│   ├── session/                      session 域（13 文件）
│   │   ├── CreateSessionDialog.tsx
│   │   ├── EditSessionDialog.tsx
│   │   ├── SelectSessionDialog.tsx
│   │   ├── sessionDialogItems.tsx
│   │   ├── SessionFormLayout.tsx
│   │   ├── SessionFormPanels.tsx
│   │   ├── ShellSettingsPanel.tsx
│   │   ├── SSHSettingsPanel.tsx
│   │   ├── SshConnectionSection.tsx
│   │   ├── SshSessionForm.tsx
│   │   ├── TmuxForm.tsx
│   │   ├── useSessionForm.ts
│   │   └── (1 file shared)
│   ├── group/                        group 域（2 文件）
│   │   ├── NewGroupDialog.tsx
│   │   └── EditGroupDialog.tsx
│   ├── workspace/                    workspace 持久化域（2 文件）
│   │   ├── SaveWorkspaceDialog.tsx
│   │   └── SaveDialog.tsx
│   ├── paste/                        paste 确认域（2 文件）
│   │   ├── PasteConfirmDialog.tsx
│   │   └── pasteConfirm.ts
│   ├── context-menu/                 右键菜单（1 文件）
│   │   └── paneContextMenu.ts
│   ├── form-atoms/                   表单原子（6 文件）
│   │   ├── FormCheckboxField.tsx
│   │   ├── FormNumberField.tsx
│   │   ├── FormRadioGroup.tsx
│   │   ├── FormSelectField.tsx
│   │   ├── FormTextField.tsx
│   │   └── formParsers.ts
│   └── CollapsibleSection.tsx         可折叠区块
│
├── primitives/                       L4 原子（3 文件）
│   ├── Dialog.tsx
│   ├── FormField.tsx
│   └── ContextMenu.tsx
│
└── settings/                         设置视图（6 文件）
    ├── SettingsView.tsx
    ├── AppearanceTab.tsx
    ├── InputTab.tsx
    ├── LoggingTab.tsx
    ├── SessionTab.tsx
    └── TerminalTab.tsx
```

> **当前现状**：dialogs/ 平铺 31 文件，靠命名区分（`<Business><Action>Dialog.tsx`）。改造 PR 才拆分子目录——目标态按业务域分子目录，但**对外**仍走 `ui/ui-kit` 单一 barrel。

## 5. 跟其他 module 的关系

| 邻居 | 关系 |
|---|---|
| `terminal/` | 调 SelectSessionDialog / PasteConfirmDialog / paneContextMenu |
| `sidebar/` | 调 NewGroupDialog / EditGroupDialog / EditSessionDialog |
| `layout/` | 调 SettingsView（设置入口触发） |

ui-kit **不**依赖任何 L2 业务视图。

## 6. ui-kit 内部依赖

```
ui-kit/dialogs/  ──►  ui-kit/primitives/  (合规的 L3→L4)
ui-kit/settings/ ──►  ui-kit/dialogs/form-atoms/  (复用 FormXxxField)
ui-kit/settings/ ──►  ui-kit/primitives/
```

反之**严禁**：primitives → dialogs / settings；dialogs → settings。

## 7. 详细分类（保留旧 dialogs/RESPONSIBILITY.md 的完整清单）

### 7.1 session 域 dialog

| 文件 | 用途 | 调用方 |
|---|---|---|
| `CreateSessionDialog` | 新建 local/ssh/tmux 会话 | layout / sidebar toolbar |
| `EditSessionDialog` | 编辑已有 session config | sidebar SessionManager |
| `SelectSessionDialog` | 从已保存配置列表里选 | terminal PaneInitCard |
| `SessionFormLayout` / `SessionFormPanels` | 表单骨架 | 上述 dialog |
| `ShellSettingsPanel` | local shell 设置 | SessionFormPanels |
| `SSHSettingsPanel` / `SshConnectionSection` / `SshSessionForm` | ssh 配置 | SessionFormPanels |
| `TmuxForm` | tmux-cc 配置 | SessionFormPanels |
| `sessionDialogItems` | session 列表项 | SelectSessionDialog |
| `useSessionForm` | 表单状态 hook | 上述 form |

### 7.2 group / workspace / paste / 其他 dialog

| 文件 | 用途 | 调用方 |
|---|---|---|
| `NewGroupDialog` / `EditGroupDialog` | group CRUD | sidebar WorkspaceManager |
| `SaveWorkspaceDialog` / `SaveDialog` | workspace 持久化 | layout |
| `PasteConfirmDialog` / `pasteConfirm` | 大段粘贴确认 | terminal Pane |
| `paneContextMenu` | pane 右键菜单 helper | terminal Pane |
| `CollapsibleSection` | 可折叠区块 | 各 Tab / Dialog |
| `FormCheckboxField` / `FormNumberField` / `FormRadioGroup` / `FormSelectField` / `FormTextField` / `formParsers` | 表单原子 | 所有 form |

### 7.3 settings 视图

| 文件 | 用途 | 调用方 |
|---|---|---|
| `SettingsView` | 设置页总入口 + 5 tab 切换 | layout |
| `AppearanceTab` / `InputTab` / `LoggingTab` / `SessionTab` / `TerminalTab` | 各设置分类 | SettingsView |

约束：tab 自己**不**调持久化——`onChange` 冒泡到 SettingsView，SettingsView 决定何时调 `service/persistence`。
