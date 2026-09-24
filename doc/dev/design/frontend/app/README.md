# Frontend · App 层 (= `src/app/` + `src/ui/`)

> **职责**：暴露给外部的入口——React 组件树、用例编排（useCases）、领域规则（rules）。app 层 = UI + 用例。
>
> app 层是用户**唯一看得到**的层。所有 service 编排、所有 model 状态读写、所有 infra 调用都从这一层发起。

## 1. 模块清单（现状）

```
src/app/
├── index.ts                   barrel — 所有 useCases 的统一入口
├── useCases/                  40+ 用例文件（每个含 .test.ts）
│   ├── createLocalSession*.ts       创建本地 PTY 会话
│   ├── createSshSession*.ts         创建 SSH 会话
│   ├── createTmuxSession*.ts        创建 tmux -CC 会话
│   ├── openSavedSession.ts          打开已保存配置
│   ├── closeSession.ts              关闭会话
│   ├── reconnectSession.ts          断线重连
│   ├── renameSession.ts             重命名
│   ├── applyDisplayConfigToLiveSession.ts
│   ├── createWindow.ts              新建窗口
│   ├── replaceInitWindowWithSession.ts
│   ├── closeWindow.ts               关闭窗口
│   ├── reorderWindows.ts            排序窗口
│   ├── renameWindow.ts              重命名窗口
│   ├── setActiveWindow.ts
│   ├── setActivePane.ts
│   ├── splitPane.ts
│   ├── createWorkspace.ts           工作区
│   ├── closeWorkspace.ts
│   ├── saveWorkspace.ts             持久化
│   ├── loadWorkspace.ts
│   ├── deleteSavedWorkspace.ts
│   ├── renameSavedWorkspace.ts
│   ├── saveWindow.ts / loadWindow.ts / deleteSavedWindow.ts
│   ├── saveConfigOnly.ts / removeConfig.ts
│   ├── createGroup.ts / deleteGroup.ts / moveConfigToGroup.ts
│   └── ... 共 40+ 文件
└── rules/                     纯函数业务规则（无 React 依赖）
    ├── paneTree.ts                工作区分屏树操作
    ├── paneTreeRules.ts           分屏规则（最大/最小尺寸、删除规则）
    ├── sessionRules.ts            会话排序、过滤
    ├── workspaceRules.ts          工作区排序
    ├── textTransform.ts           文本转换（ANSI 解析 helper）
    └── constants.ts               app 层常量
```

```
src/ui/                        React 组件树（被 app/useCases 调用）
├── AppLayout.tsx               主布局
├── NavBar.tsx                  自定义标题栏
├── dialogs/                    模态对话框
├── sidebar/                    侧边栏（组/会话/工作区列表）
├── settings/                   设置面板
├── primitives/                 基础 UI 原子（Button、Input、Dialog）
├── icons/                      图标
└── styles/                     CSS（设计系统落实）
```

## 2. 关键约束

- **app 是唯一允许 import `@tauri-apps/api` 的层**——但**禁止**直接调用。app 只能调 service（service 已经封装 invoke/listen）。
- **`useCases/` 是纯函数**，默认不持有 React state。use case 接收 `(deps, args) => Promise<Result>` 形式，由调用方（React component / context）提供 deps。
- **`rules/` 是纯函数**（见 `paneTree.ts` 注释）。无 React、无 IPC、无副作用——可独立单测。
- **每个 useCase 必须配套 `.test.ts`**。vitest 覆盖率是约束，不是可选项。
- **`ui/` 不允许直接调 `sessionService.X()`**。组件只接受 props / 调 hook；编排交给 useCase 或 service 层 hook。

## 3. 依赖方向

```
ui/ ──► useCases/ ──► service/ ──► model/ ──► (无)
              │           │
              └─► rules ──┘         ──► infra/ ──► (@tauri-apps/api)
```

- `useCases/` 可以调 `service/`、`rules/`、`model/`、`infra/`（但**实际**应该走 service，不直跳 infra）。
- `ui/` 只能调 `useCases/` 和 `service/` 的 hooks（不能调 `service/` 的纯函数版本——业务编排属于 useCase）。
- `rules/` 是叶子，不依赖任何其他层。

## 4. 设计系统约束

**所有 UI 改动必读** [`../../../design-system.md`](../../../design-system.md)。

三层校验 grep（pre-commit 必跑）：

```bash
grep -rn -E "(--bg-primary|--bg-secondary|--bg-tertiary|--text-primary|--text-secondary|--text-muted|--border-color|#0e639c|#1177bb|linear-gradient)" src/ --include="*.ts" --include="*.tsx" --include="*.css"
grep -rn "font-weight: ?(600|700|bold)" src/ --include="*.ts" --include="*.tsx" --include="*.css"
grep -rn "box-shadow:" src/components/ --include="*.css"
```

违反任何一条不允许 merge。

## 5. 改进方向

- **`ui/components/` vs `ui/`**：现状 `ui/` 既有原语（`primitives/`）又有页面（`AppLayout`/`NavBar`）。建议拆 `ui/components/{primitives,layout,panels}`，但不强求。
- **`useCases/` 进一步按 sub-domain 拆分**：现在 40+ 个 useCase 全在 `useCases/` 一层目录。下一步拆 `useCases/{session,window,workspace,persistence,group}/`。对应 model 层已经按 domain 拆完的格局。
- **rules 单独成包**：目前 `rules/` 跟 `useCases/` 同级，但 rules 是纯函数、useCases 是 React-aware。给 rules 单独建包 `src/rules/`（顶层），从 app/ 移出。
- **`useCases/*.test.ts` 用 vitest mock service**：现状测试覆盖率不均，新 useCase 必须 mock service 层而非 mock infra，避免跟 service 测试重复。
- **`AppLayout.tsx` 体积**：目前主布局 + NavBar + 多 tab 切换逻辑都在一个文件。下一步抽出 `viewRegistry` 配置，让"加一个 view = 写一行配置"。
