# Module · Session — 职责

> **位置**：`src/ui/modules/session/`
> **用户认知里的位置**：「session 的全生命周期」——创建、配置、选择、保存、打开、display config
> **依赖**：无强依赖（核心 module）
> **被依赖**：`workspace`（侧栏展示）、`terminal`（读 session 元数据）、`settings`（影响 session 默认值）

## 1. 这个 module 负责什么

session 是 xsterm 的**核心数据实体**。xsterm 不是"终端 app"——是"session 容器"，session 才是产品本身。

session module 承担 5 个产品功能：

1. **创建 session**——local PTY / SSH / tmux 三种类型；支持"立即运行"和"保存为配置"
2. **编辑 session 配置**——display config（字体、字号、主题）、连接参数、shell 命令
3. **从已保存配置打开 session**——列出所有 saved configs 让用户选
4. **session 元数据展示**——侧栏列表、tab 标题、状态指示
5. **session 持久化**——saved configs 列表的 CRUD

## 2. 这个 module **不**负责什么

- **不渲染 xterm**——terminal module 渲染
- **不管理 workspace 业务**——workspace 决定 session 装在哪个 window
- **不渲染侧栏布局**——workspace 的侧栏渲染 session 列表
- **不应用终端偏好**——terminal 用 props 接收偏好

## 3. 子结构

```
modules/session/
├── api.ts                            # 对外暴露 <CreateSessionDialog> <SelectSavedDialog> <EditSessionDialog> + useSessionApi()
├── view/
│   ├── CreateSessionDialog.tsx       # 创建 dialog（3 类型：local / ssh / tmux）
│   ├── EditSessionDialog.tsx         # 编辑 dialog
│   ├── SelectSavedDialog.tsx         # 从 saved configs 选
│   ├── SessionFormLayout.tsx         # 表单骨架（被 3 个 dialog 复用）
│   ├── SessionFormPanels.tsx         # 表单 panel 容器
│   ├── ShellSettingsPanel.tsx        # local shell 设置
│   ├── SshSettingsPanel.tsx          # ssh 连接 + 认证
│   ├── SshConnectionSection.tsx
│   ├── SshSessionForm.tsx
│   ├── TmuxForm.tsx                  # tmux-cc 配置
│   ├── FormCheckboxField.tsx         # 表单原子
│   ├── FormNumberField.tsx
│   ├── FormRadioGroup.tsx
│   ├── FormSelectField.tsx
│   ├── FormTextField.tsx
│   ├── formParsers.ts                # 字符串 → 强类型 helper
│   ├── useSessionForm.ts             # 表单状态 hook
│   ├── SessionListItem.tsx           # 列表项（侧栏用，workspace 嵌入）
│   └── SessionStatusBadge.tsx        # 状态指示（running / connecting / closed）
├── store.ts                          # session store（跨 module 状态）
├── model.ts                          # Session / PersistedSessionConfig / SessionDisplayConfig 类型
├── index.ts
└── *.test.ts
```

## 4. 用户故事

- **作为用户**，我希望点"+"弹窗选 local / ssh / tmux 创建 session → `<CreateSessionDialog>`
- **作为用户**，我希望 session 关闭后能重新打开（保存了 config） → `<SelectSavedDialog>` + saved configs store
- **作为用户**，我希望改 session 的字体大小立即生效 → display config 实时同步到 terminal props
- **作为用户**，我希望侧栏显示 session 列表 → workspace 嵌入 `<SessionListItem>`（session module 提供）

## 5. 跟其他 module 的关系

| module | 关系 |
|---|---|
| `shell` | session 的 dialog 通过 shell 的 dialog 编排显示（`useAppShell().openDialog({ kind: "createSession" })`） |
| `workspace` | workspace 嵌入 session 的 `<SessionListItem>`；调 `useSessionApi().openSession()` 把 session 装到当前 window |
| `terminal` | terminal 订阅 session store 拿 session 元数据；terminal **不**感知 dialog |
| `settings` | session 默认值（如"默认 shell"）从 settings 读；session module 自己实现 |

session 是**核心 module**——其他 module 都依赖它，它不强依赖任何 feature module。

## 6. 这个 module 的"产品语言"术语

- **session** — 一个后台进程 + 它的连接配置 + 显示配置 + 状态
- **local session** — 本地 PTY session
- **SSH session** — 远程 SSH session
- **tmux -CC session** — tmux 控制模式 session
- **session config** — 创建 session 的参数（连接信息、shell 命令等）
- **saved config** — 持久化的 session config（可以跨工作区引用）
- **display config** — session 的显示参数（font、theme、cols/rows）
- **session status** — running / connecting / closed / error
