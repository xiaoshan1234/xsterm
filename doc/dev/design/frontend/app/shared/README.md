# Shared · 概览

> **位置**：`src/app/shared/`
> **职责**：跨 module 共享的基础设施——不是产品功能，是"5 个 module 的公共依赖"
> **不在产品认知里**——shared 没有"用户故事"，没有"产品语言"——它纯粹是代码组织

## 1. 4 个子目录

```
src/app/shared/
├── infra/         IPC 适配（唯一允许直跳 @tauri-apps/api 的地方）
├── service/       跨 module 状态容器 + IPC 桥（store / channel / buffer）
├── model/         纯数据类型 + 派生计算
└── rules/         纯函数（跨 module 共享的算法）
```

## 2. 4 个子目录的依赖方向

```
       rules/  ◄────  任何 module 都可以 import
           ▲
           │
       model/  ◄────  任何 module 都可以 import
           ▲
           │
       service/  ◄────  任何 module 都可以 import
           ▲
           │
       infra/  ◄────  service/ + module 都可以 import
           ▲
           │
       @tauri-apps/api  ◄──── 只有 infra/ 可以 import
```

**约束**：

- shared/ 内部单向：`infra → service → model → rules`
- shared/ **不**反向依赖任何 module
- shared/ **不**依赖其他 shared 的上层（infra 可以用 service 的类型，但 service 不直接用 infra）

## 3. shared 跟 module 的边界

判断一个东西该放 shared 还是 module：

| 判断标准 | 放 shared | 放 module |
|---|---|---|
| 跨 module 使用？ | ✅ | ❌（只在单 module 用） |
| 参与业务编排？ | ❌（纯基础设施） | ✅ |
| 有 IPC / I/O？ | ✅（infra / service） | ❌（module 不直接 IPC） |
| 有 React 概念？ | ❌ | ❌（UI 在 ui/） |
| 有产品术语？ | ❌ | ✅ |

**反例**：

- "session store" 放 `shared/service/session/store`（多个 module 都订阅）
- "workspace tree store" 放 `shared/service/workspace/store`（workspace + shell 都订阅）
- "pane tree 临时状态" 放 `app/workspace/store.ts`（只有 workspace 用）
- "tmux controller 状态" 放 `app/terminal/store.ts`（只有 terminal 用）

## 4. shared/infra — IPC 适配

**唯一允许直跳 `@tauri-apps/api` 的地方**。其他 module 都通过 shared/infra 间接调 IPC。

```
shared/infra/
├── api.ts                    ⭐ 对外暴露 invoke / listen 封装
├── commands/                 invoke 封装（按 backend domain 拆）
│   ├── session.ts
│   ├── workspace.ts
│   ├── tmux.ts
│   └── persistence.ts
├── events/                   listen 封装
│   ├── sessionOutput.ts
│   ├── sessionClosed.ts
│   └── tmuxEvents.ts
├── repositories/             Repository 接口实现（model/repository.ts 的默认实现）
└── index.ts
```

**关键约束**：

- 业务 module 调 IPC **必须**经过 `shared/infra/api.ts`
- shared/infra 内部按 backend domain 分文件（不是按 frontend module 分）
- `commands/*` 内部只 export 薄函数（不持有状态、不做业务编排）

## 5. shared/service — 跨 module 状态容器

不是产品功能，是"跨 module 共享的状态 + IPC 桥"。

```
shared/service/
├── session/          session store (跨 module 状态)
│   ├── store.ts
│   └── api.ts        ⭐ SessionStore hook
├── workspace/        workspace / window / pane 树 store
├── output/           输出缓冲 + channel
│   ├── buffer.ts     ring buffer
│   ├── channel.ts    session-output 事件桥
│   └── frame.ts      输出帧类型
├── theme/            主题切换
├── persistence/      持久化 store
├── logger/           前端日志 → backend rolling file
├── settings/         settings store
├── terminal/         terminal preferences store
└── index.ts
```

**每个子目录都有 `api.ts`**：暴露 hook 给 module 用，store 内部细节隐藏。

## 6. shared/model — 纯数据类型

```
shared/model/
├── session/          Session / SessionConfig / SessionDisplayConfig / SessionKind / SessionStatus
├── workspace/        Workspace / Window / Group / PaneNode
├── terminal/         TerminalTheme / SplitDirection / TerminalPreferences
├── settings/         Settings / SettingsCategory / LogLevel
├── persistence/      PersistedSessionConfig / PersistedWorkspace / PersistedWindow
└── index.ts
```

每个 domain 一个子目录，4-piece 模板：

- `types.ts` — 纯数据 shape
- `repository.ts` — 接口签名
- `events.ts` — 事件契约
- `accessor.ts` — 派生计算

## 7. shared/rules — 跨 module 纯函数

```
shared/rules/
├── paneTree.ts        pane 树算法（split / close / resize）
├── sessionRules.ts    session 唯一命名 / 排序
├── workspaceRules.ts  workspace 排序 / 规则
├── textTransform.ts   ANSI 解析
├── constants.ts       app 层常量
└── api.ts             ⭐ 唯一对外入口
```

**关键**：rules 是纯函数，无副作用，可独立单测。多个 module 共享同一份实现——避免每个 module 自己实现一遍。

## 8. 强制约束（可机械校验）

```bash
# shared/ 任何文件不能 import app module
grep -rn 'from\s*"@/app/modules' src/app/shared/ --include='*.ts'
# 必须为空

# shared/infra 之外不能 import @tauri-apps/api
grep -rn 'from\s*"@tauri-apps/api' src/app/shared/ --include='*.ts' | grep -v shared/infra/
# 必须为空

# shared/ 不能反向依赖（model 不能 import service）
grep -rn 'from\s*"\./service' src/app/shared/model/ --include='*.ts'
# 必须为空

# rules/ 必须纯函数（不能 import service / infra）
grep -rn 'from\s*"\.\./\(service\|infra\)' src/app/shared/rules/ --include='*.ts'
# 必须为空
```

## 9. 当前架构债 → 设计意图说明

| 旧 v3 现状 | 新设计意图 |
|---|---|
| `service/` 顶层平铺所有 store | `shared/service/<domain>/` 按 domain 拆 |
| `model/` 顶层平铺所有类型 | `shared/model/<domain>/` 按 domain 拆 |
| `infra/` 散落在多处 + 直跳 Tauri | `shared/infra/` 唯一允许 + 按 backend domain 拆 |
| `rules/` 7 个文件混在 app/ 顶层 | `shared/rules/` + 强制 api.ts 入口 |
| shared 没有明确的"对外契约" | 每个子目录都有 api.ts |
