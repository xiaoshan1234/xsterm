# TS App ↔ Service 层接口契约（App / Service Interface Contract）

> **目的**：固化 `src/app/`（用例层）与 `src/service/`（状态层）之间的依赖方向、调用边界、类型契约，防止架构在双栈过渡期继续漂移。
>
> **状态**：⚠️ 草稿（v0 — 基于 2026-09 调研）
>
> **范围**：四个 TS 层 — `src/app/`、`src/service/`、`src/infra/`、`src/model/` 的接口边界。**不覆盖** Rust backend（Tauri IPC 命令清单见 [`doc/dev/architecture/03-development-view.md`](../architecture/03-development-view.md) §5）。
>
> **阅读路径**：新人 5 分钟读 §0 + §2；dev 实施前读 §3（接口契约主表）；改动现有文件前读 §4（增删查改清单）；拍板决策前读 §6（未决问题）。

---

## 0. 一句话结论

`src/app/useCases/*` 是「业务编排器」—— 拿到用户意图、调用 `service` 暴露的能力、按 `app/rules/` 的纯规则计算、调用 `infra/tauri/commands/*` 完成 IPC、最后把结果写回 `service/*/store.ts` 的 Zustand store。
**当前实现与这条规则的偏差集中在「service → infra」这一步没有 service 层包装**（use case 直接 import `infra/tauri/commands/`）；「service → service/legacy」这一步有 7 个 use case 仍依赖 `legacy/contexts/session/paneUtils.ts` 的 `withRecomputedSessionIds`。
本文 §4 给出修复清单。

---

## 1. 背景与目的

### 1.1 为什么需要这份文档

xsterm 的前端正处于**双栈过渡期**（legacy `useSessionContext` + new `app/useCases/` + new `service/*/store.ts`），AGENTS.md 与 `doc/dev/architecture/03-development-view.md` 描述的是「目标态」分层（components → contexts+hooks → services → types），与实际代码已经不一致：

- 目标态有 `services/`（旧名），实际是 `service/`（新名 + 多个子目录）。
- 目标态 components 只依赖 contexts+hooks，实际 ui 组件已经大量直接 import `app/useCases/`。
- 目标态 services 只 import types，实际 service 还要 import infra 与 model。

没有一份文档锁定「app 可以 import 什么 / 不可以 import 什么」，每次 PR 都会重新讨论一次。

### 1.2 参考文档

| 主题                   | 路径                                                                                                   |
| ---------------------- | ------------------------------------------------------------------------------------------------------ |
| 前端目标态分层         | [`doc/dev/architecture/03-development-view.md`](../architecture/03-development-view.md) §2             |
| UI 概念层级 / 数据契约 | [`doc/dev/architecture/01-logical-view.md`](../architecture/01-logical-view.md) §2-§4                  |
| 调用链样例             | [`doc/dev/flows/02-create-tmux-session.md`](../flows/02-create-tmux-session.md) §3                     |
| 层命名原则             | [`doc/dev/adr/0005-tmux-redesign-v0.md`](../adr/0005-tmux-redesign-v0.md) §P1                          |
| 后端分层（Rust）       | [`doc/dev/architecture/03-development-view.md`](../architecture/03-development-view.md) §1             |
| Bug 上下文             | [`doc/dev/changelog/bugs.md`](../changelog/bugs.md)（Bug 005 输入延迟、014/016/018/019/021 bootstrap） |

### 1.3 术语对齐

| 术语           | 含义                                                                                     | 对应目录               |
| -------------- | ---------------------------------------------------------------------------------------- | ---------------------- |
| **app 层**     | 用例编排 + 纯业务规则                                                                    | `src/app/`             |
| **service 层** | 状态（Zustand）+ IPC 包装 + 事件订阅 + 组件级桥接                                        | `src/service/`         |
| **infra 层**   | 平台 I/O 原语（Tauri invoke/listen、tauri-plugin-store、clipboard、logger、buffer）      | `src/infra/`           |
| **model 层**   | 纯 TypeScript 类型（无任何 import）                                                      | `src/model/`           |
| **rule**       | app 层内的纯函数（paneTree、sessionRules、workspaceRules、textTransform、paneTreeRules） | `src/app/rules/`       |
| **use case**   | app 层的可调用入口（用户意图 → backend IPC → store 写入）                                | `src/app/useCases/`    |
| **bridge**     | service 层的 React 组件，订阅 Tauri 事件 → 写入 store                                    | `src/service/bridges/` |
| **legacy**     | 过渡层，待 `Commit 6` 整体删除                                                           | `src/service/legacy/`  |

---

## 2. 现状分析（Current State）

### 2.1 四层依赖图（实际代码）

```
                        ┌─────────────────────────────┐
                        │      src/ui/（UI 组件）      │
                        │  Terminal / Pane / TabBar    │
                        │  WorkspaceContainer / NavBar │
                        └──────────┬──────────────────┘
                                   │
              ┌────────────────────┼─────────────────────┐
              │                    │                     │
              ▼                    ▼                     ▼
   ┌────────────────────┐  ┌─────────────────┐  ┌────────────────────┐
   │  src/app/useCases/ │  │ src/service/    │  │ src/service/legacy/│
   │   (37 个 use case)  │  │  legacy/contexts│  │  hooks/ (9 个)     │
   │                    │  │  SessionContext │  │  useXterm / ...    │
   └──────────┬─────────┘  └────────┬────────┘  └────────────────────┘
              │                     │
              ▼                     ▼
   ┌────────────────────────────────────┐
   │       src/app/rules/ (纯函数)       │  ← use case + bridge 共用
   │   paneTree / sessionRules / ...    │
   └────────────────┬───────────────────┘
                    │
   ┌────────────────┼────────────────────────────┐
   │                │                            │
   ▼                ▼                            ▼
┌──────────────┐ ┌────────────────┐  ┌──────────────────────┐
│ src/service/ │ │ src/infra/     │  │ src/infra/tauri/     │
│  * /store.ts │ │ tauri/commands │  │ eventBus.ts          │
│  (Zustand)   │ │  sessions.ts   │  │ (subscribe-only)     │
│              │ │  tmux.ts       │  │                      │
└──────────────┘ └───────┬────────┘  └──────────┬───────────┘
                         │                       │
                         ▼                       ▼
                  ┌─────────────────────────────────────┐
                  │      @tauri-apps/api（仅 infra）     │
                  │   invoke + listen + clipboard + ... │
                  └─────────────────────────────────────┘

         src/model/（纯类型，被任意层 import，无副作用）
```

### 2.2 实际违规清单（调研基线 2026-09）

| #   | 违规位置                                                                                     | 跨越的边界                   | 严重度                                     | 状态                 |
| --- | -------------------------------------------------------------------------------------------- | ---------------------------- | ------------------------------------------ | -------------------- |
| V-1 | `Terminal.tsx` → `infra/clipboard/read.ts` `infra/clipboard/write.ts`                        | UI → infra                   | 🟡 中（已用 `depcruise-disable` 标注）     | ⚠️ 临时豁免          |
| V-2 | `NavBar.tsx` → `infra/tauri/commands/window.ts` `getCurrentWindow`                           | UI → infra                   | 🟡 中（已用 `depcruise-disable` 标注）     | ⚠️ 临时豁免          |
| V-3 | `Pane.tsx` → `service/legacy/services/sessionService.ts`（tmux window IPC）                  | UI → legacy                  | 🟠 高（绕过 use case）                     | ⚠️ 待迁              |
| V-4 | `Terminal.tsx` → `service/legacy/services/sessionService.ts`（SSH image upload）             | UI → legacy                  | 🟠 高（绕过 use case）                     | ⚠️ 待迁              |
| V-5 | 37 个 use case → `infra/tauri/commands/sessions.ts` `infra/tauri/commands/tmux.ts`           | app → infra                  | 🟠 高（无 service 包装层）                 | ⚠️ 设计中（本文 §3） |
| V-6 | 7 个 use case → `service/legacy/contexts/session/paneUtils.ts` 的 `withRecomputedSessionIds` | app → legacy                 | 🟡 中（pure helper 但路径在 legacy）       | ⚠️ 待迁              |
| V-7 | `service/legacy/services/sessionService.ts` → `@tauri-apps/api/core::invoke`                 | legacy → Tauri（绕开 infra） | 🔴 严重（违反「infra 是唯一 Tauri 边界」） | ⚠️ Commit 6 删除     |
| V-8 | `service/legacy/contexts/session/useTauriListeners.ts` → `@tauri-apps/api/event::listen`     | legacy → Tauri（绕开 infra） | 🔴 严重                                    | ⚠️ Commit 6 删除     |

### 2.3 service 层内部接口利用现状

| 接口                                                                         | 位置                                           | 被 use case 调用次数                             | 备注                               |
| ---------------------------------------------------------------------------- | ---------------------------------------------- | ------------------------------------------------ | ---------------------------------- |
| `useSessionStore` (Zustand 直接 `.getState()`)                               | `service/session/store.ts`                     | 28                                               | **绕过 actions 层**                |
| `useWorkspaceStore` (Zustand 直接 `.getState()`)                             | `service/workspace/store.ts`                   | 26                                               | **绕过 actions 层**                |
| `usePersistenceStore` (Zustand 直接 `.getState()`)                           | `service/persistence/store.ts`                 | 18                                               | **绕过 actions 层**                |
| `service/*/actions.ts` 包装层                                                | `service/*/actions.ts`                         | **0**                                            | **死代码** — 没有任何 caller       |
| `service/legacy/contexts/session/paneUtils.ts` 的 `withRecomputedSessionIds` | `service/legacy/contexts/session/paneUtils.ts` | 7                                                | 仅这一个 legacy 导出被 use case 用 |
| `service/bridges/*` (6 个桥接组件)                                           | `service/bridges/`                             | 0（**正确** — 由 `App.tsx` 挂载一次）            | ✅ 设计正确                        |
| `service/hooks/useTauriTerminalOutput`                                       | `service/hooks/`                               | 0（由 `Pane.tsx`/`Terminal.tsx` 通过 hook 调用） | ✅ 设计正确                        |

> **结论**：service 层声明了 actions 包装层却完全没人用；use case 直写 store 直调 infra。这是一个「双层都没用上」的状态——本文 §3 给出设计目标。

---

## 3. 接口契约（设计目标）

### 3.1 依赖方向（不可违反）

```
model ←─ infra ←─ service ←─ app ←─ ui
       (向下依赖；不可反向)
```

**四条禁止规则（lint 强制目标）**：

| ID  | 规则                                                                                              | 当前位置                | 强制工具    |
| --- | ------------------------------------------------------------------------------------------------- | ----------------------- | ----------- |
| R-1 | `src/infra/` 不得 import 任何 `@tauri-apps/api` 之外的 `src/app/`、`src/service/`、`src/ui/` 模块 | ✅ 已遵守               | `depcruise` |
| R-2 | `src/service/legacy/` 在 `Commit 6` 后不得存在                                                    | ⚠️ 临时存在             | 物理删除    |
| R-3 | `src/ui/` 不得 import `src/infra/`（除通过 use case 间接调用）                                    | 🟡 2 个豁免（V-1, V-2） | `depcruise` |
| R-4 | `src/app/useCases/` 不得 import `src/service/legacy/`                                             | 🟡 7 个豁免（V-6）      | `depcruise` |

### 3.2 `app → service` 接口表

use case 可以从 service 层调用以下导出。每个条目说明：**目的 / 入参 / 出参 / 调用入口 / 实现状态 / 人工 check 状态**。

> **约定**：✅ 完全实现 / ⚠️ 部分实现或不一致 / 🚧 规划中 / ❌ 缺失 / ⏳ 待人工 check / 👀 已 check。

#### 3.2.1 Session 注册表（service/session/store.ts）

| 接口 ID | 目的                                             | 入参                                                | 出参        | 调用入口                                         | 实现状态                                        | 人工 check |
| ------- | ------------------------------------------------ | --------------------------------------------------- | ----------- | ------------------------------------------------ | ----------------------------------------------- | ---------- |
| S-001   | 新增一个 session 行                              | `session: Session`                                  | `void`      | use case + `useSessionActions().addSession`      | ⚠️ use case 走 `.getState().addSession`（直写） | ⏳ 待审    |
| S-002   | 删除 session 行                                  | `id: number`                                        | `void`      | use case + bridge `sessionBridge.session-closed` | ⚠️ 直写                                         | ⏳ 待审    |
| S-003   | 替换整个 session 数组（批量，tmux bootstrap 用） | `next: Session[] \| (prev) => Session[]`            | `void`      | use case `createTmuxSession`                     | ⚠️ 直写                                         | ⏳ 待审    |
| S-004   | 标记 session 是否已连接                          | `id: number, isConnected: boolean`                  | `void`      | bridge `sessionBridge.session-disconnected`      | ⚠️ 直写                                         | ⏳ 待审    |
| S-005   | 设置 session 名                                  | `id: number, name: string`                          | `void`      | use case `renameSession`                         | ⚠️ 直写                                         | ⏳ 待审    |
| S-006   | 应用 display config 补丁                         | `id: number, patch: Partial<SessionDisplayConfig>`  | `void`      | use case `applyDisplayConfigToLiveSession`       | ⚠️ 直写                                         | ⏳ 待审    |
| S-007   | 设置全局 local echo 开关                         | `enabled: boolean`                                  | `void`      | settings UI                                      | ✅ 通过 hook `useSessionActions`                | ⏳ 待审    |
| S-008   | 同步读取 session 列表                            | —                                                   | `Session[]` | tmux controller + use case                       | ⚠️ 直读                                         | ⏳ 待审    |
| S-009   | tmux controller error 状态机                     | `controllerId: number, error?: TmuxControllerError` | `void`      | bridge `tmuxBridge.tmux-controller-exit`         | ⚠️ 直写                                         | ⏳ 待审    |
| S-010   | 持久化 controller config（重启用）               | `controllerId, TmuxCcConfig`                        | `void`      | bridge + auto-attach                             | ⚠️ 直写                                         | ⏳ 待审    |

#### 3.2.2 Workspace 树（service/workspace/store.ts）

| 接口 ID | 目的                                              | 入参                                             | 出参   | 调用入口                                           | 实现状态                                | 人工 check |
| ------- | ------------------------------------------------- | ------------------------------------------------ | ------ | -------------------------------------------------- | --------------------------------------- | ---------- |
| W-001   | 替换整个 workspaces 数组                          | `next: Workspace[] \| updater`                   | `void` | 多个 use case（`setWorkspaces(prev => ...)` 模式） | ⚠️ 直写                                 | ⏳ 待审    |
| W-002   | 新增 workspace                                    | `workspace: Workspace`                           | `void` | use case `createWorkspace`、`loadWorkspace`        | ⚠️ 直写                                 | ⏳ 待审    |
| W-003   | 删除 workspace                                    | `id: string`                                     | `void` | use case `closeWorkspace`                          | ⚠️ 直写                                 | ⏳ 待审    |
| W-004   | 重命名 workspace                                  | `id, name`                                       | `void` | use case `renameSavedWorkspace`                    | ⚠️ 直写                                 | ⏳ 待审    |
| W-005   | 切换 active workspace                             | `id: string \| null`                             | `void` | use case + UI                                      | ⚠️ 直写                                 | ⏳ 待审    |
| W-006   | 窗口重排                                          | `workspaceId, fromIndex, toIndex`                | `void` | use case `reorderWindows`                          | ⚠️ 直写                                 | ⏳ 待审    |
| W-007   | 新增 window                                       | `workspaceId, window: Window`                    | `void` | use case `createWindow`、`openSavedSession`        | ⚠️ 直写                                 | ⏳ 待审    |
| W-008   | 删除 window                                       | `workspaceId, windowId`                          | `void` | use case `closeWindow`、bridge `sessionBridge`     | ⚠️ 直写                                 | ⏳ 待审    |
| W-009   | 重命名 window                                     | `workspaceId, windowId, name`                    | `void` | use case `renameWindow`                            | ⚠️ 直写                                 | ⏳ 待审    |
| W-010   | 切换 active window                                | `workspaceId, windowId`                          | `void` | use case `setActiveWindow` + TabBar                | ⚠️ 直写                                 | ⏳ 待审    |
| W-011   | 更新 window 的 pane 树（split/close/collapse 用） | `workspaceId, windowId, updater: (root) => root` | `void` | use case `splitPane`、`closePane`、bridge          | ⚠️ 直写（部分场景绕到 `setWorkspaces`） | ⏳ 待审    |

#### 3.2.3 Persistence 持久化（service/persistence/store.ts）

| 接口 ID | 目的                                                          | 入参                         | 出参     | 调用入口                                                   | 实现状态 | 人工 check |
| ------- | ------------------------------------------------------------- | ---------------------------- | -------- | ---------------------------------------------------------- | -------- | ---------- |
| P-001   | upsert saved session config                                   | `config: SavedSessionConfig` | `void`   | use case `createLocalSession`、`saveConfigOnly`            | ⚠️ 直写  | ⏳ 待审    |
| P-002   | 删除 saved config                                             | `configId: string`           | `void`   | use case `removeConfig`、`deleteSavedWindow`（误调用）     | ⚠️ 直写  | ⏳ 待审    |
| P-003   | upsert saved workspace                                        | `workspace: SavedWorkspace`  | `void`   | use case `saveWorkspace`                                   | ⚠️ 直写  | ⏳ 待审    |
| P-004   | 删除 saved workspace                                          | `id: string`                 | `void`   | use case `deleteSavedWorkspace`                            | ⚠️ 直写  | ⏳ 待审    |
| P-005   | upsert saved window config                                    | `config: SavedWindowConfig`  | `void`   | use case `saveWindow`                                      | ⚠️ 直写  | ⏳ 待审    |
| P-006   | 删除 saved window config                                      | `id: string`                 | `void`   | use case `deleteSavedWindow`                               | ⚠️ 直写  | ⏳ 待审    |
| P-007   | 新增 / 修改 / 删除 session group                              | `SessionGroup` / `id`        | `void`   | use case `createGroup`、`deleteGroup`、`moveConfigToGroup` | ⚠️ 直写  | ⏳ 待审    |
| P-008   | 同步读取 saved configs / workspaces / window configs / groups | —                            | 对应数组 | sidebar + workspace 加载                                   | ⚠️ 直读  | ⏳ 待审    |

> **持久化磁盘 I/O 边界**：本节都是 in-memory Zustand 操作。**磁盘读写**由 `infra/store/savedConfigs.ts` 等 adapter 在 `service/persistence/` 内部初始化时一次性调用，**不在 app 层接口范围**。

#### 3.2.4 Pane 焦点状态（service/pane/store.ts）

| 接口 ID | 目的                | 入参                 | 出参             | 调用入口             | 实现状态 | 人工 check |
| ------- | ------------------- | -------------------- | ---------------- | -------------------- | -------- | ---------- |
| PN-001  | 设置最后聚焦 pane   | `id: string \| null` | `void`           | UI 焦点 hook         | ⚠️ 直写  | ⏳ 待审    |
| PN-002  | 同步读最后聚焦 pane | —                    | `string \| null` | sidebar / 重渲染优化 | ⚠️ 直读  | ⏳ 待审    |

> pane tree 自身**不属于 service 层**——它在 `app/rules/paneTree.ts` 是纯函数（参见 §3.4.1）。

#### 3.2.5 Tmux 派生状态（service/tmux/store.ts）

| 接口 ID | 目的                                   | 入参                                  | 出参     | 调用入口                                         | 实现状态                             | 人工 check |
| ------- | -------------------------------------- | ------------------------------------- | -------- | ------------------------------------------------ | ------------------------------------ | ---------- |
| TM-001  | 记忆 controller config                 | `controllerId, TmuxCcConfig`          | `void`   | bridge `autoAttachBridge` + tmuxBridge（待实现） | ⚠️ 直写（与 session 层重复，需统一） | ⏳ 待审    |
| TM-002  | 记忆 window list cache                 | `controllerId, TmuxWindowListEntry[]` | `void`   | bridge tmuxBridge（待实现）                      | ⚠️ 直写                              | ⏳ 待审    |
| TM-003  | upsert 单条 window list entry          | `controllerId, entry`                 | `void`   | bridge tmuxBridge（待实现）                      | ⚠️ 直写                              | ⏳ 待审    |
| TM-004  | 同步读 controller config / window list | `controllerId`                        | 对应类型 | tmux control window（待实现）                    | ⚠️ 直读                              | ⏳ 待审    |

> **TM-001 与 S-010 重复**：两边都有 `rememberTmuxControllerConfig`。本文 §4 标记为待合并项。

#### 3.2.6 Output 元数据（service/output/store.ts）

| 接口 ID | 目的                         | 入参                 | 出参      | 调用入口                             | 实现状态 | 人工 check |
| ------- | ---------------------------- | -------------------- | --------- | ------------------------------------ | -------- | ---------- |
| O-001   | 设置 active session id       | `id: number \| null` | `void`    | Terminal focus hook                  | ⚠️ 直写  | ⏳ 待审    |
| O-002   | 标记 session output 为 dirty | `id: number`         | `void`    | bridge `outputBridge.session-output` | ⚠️ 直写  | ⏳ 待审    |
| O-003   | 清除 dirty 标记              | `id: number`         | `void`    | Terminal flush 完成回调              | ⚠️ 直写  | ⏳ 待审    |
| O-004   | 查询 session 是否 dirty      | `id: number`         | `boolean` | Terminal flush 调度                  | ⚠️ 直读  | ⏳ 待审    |

#### 3.2.7 Theme（service/theme/store.ts）

| 接口 ID | 目的             | 入参                                                | 出参     | 调用入口             | 实现状态                     | 人工 check |
| ------- | ---------------- | --------------------------------------------------- | -------- | -------------------- | ---------------------------- | ---------- |
| TH-001  | 切换 ANSI 主题   | `key: string`（dark/light/monokai/oneDark/dracula） | `void`   | settings UI          | ✅ 通过 `useThemeStore` 直调 | ⏳ 待审    |
| TH-002  | 读取当前主题 key | —                                                   | `string` | bridge `themeBridge` | ✅ 直读                      | ⏳ 待审    |

#### 3.2.8 Logger（service/logger/store.ts + useLogger.ts）

| 接口 ID | 目的                              | 入参                    | 出参   | 调用入口                  | 实现状态                   | 人工 check |
| ------- | --------------------------------- | ----------------------- | ------ | ------------------------- | -------------------------- | ---------- |
| LG-001  | 设置 logger config                | `Partial<LoggerConfig>` | `void` | settings UI               | ⚠️ 直写                    | ⏳ 待审    |
| LG-002  | 写一条 debug/info/warn/error 日志 | `tag, msg, payload?`    | `void` | 全栈（use case + bridge） | ✅ 通过 `useLogger()` hook | ⏳ 待审    |

### 3.3 `app → infra` 接口表（IPC 调用）

use case 直接 import `infra/tauri/commands/*` 调用 IPC —— **这是当前最大违规**（V-5）。设计目标是通过 `service/hooks/` 包装，让 use case 看不到 `@tauri-apps/api`。

| 接口 ID | 目的                                       | 入参                                        | 出参                           | 调用入口                                   | 实现状态                                                     | 人工 check |
| ------- | ------------------------------------------ | ------------------------------------------- | ------------------------------ | ------------------------------------------ | ------------------------------------------------------------ | ---------- |
| I-001   | 创建 local PTY session                     | `LocalSessionConfig`                        | `Promise<SessionInfo>`         | use case `createLocalSession`              | ⚠️ use case 直调 `infra/tauri/commands/sessions.createLocal` | ⏳ 待审    |
| I-002   | 创建 SSH session                           | `SSHSessionConfig`                          | `Promise<SessionInfo>`         | use case `createSshSession`                | ⚠️ 直调                                                      | ⏳ 待审    |
| I-003   | 创建 tmux session（带 bootstrap 全量返回） | `TmuxCcConfig`                              | `Promise<TmuxSessionInit>`     | use case `createTmuxSession`               | ⚠️ 直调                                                      | ⏳ 待审    |
| I-004   | attach 已存在的 tmux server                | `TmuxCcConfig`                              | `Promise<TmuxSessionInit>`     | use case `createTmuxSession`（探测后分支） | ⚠️ 直调                                                      | ⏳ 待审    |
| I-005   | 探测 tmux server 是否存在                  | `TmuxCcConfig`                              | `Promise<boolean>`             | use case `createTmuxSession`               | ⚠️ 直调                                                      | ⏳ 待审    |
| I-006   | 关闭 backend session                       | `id: number`                                | `Promise<void>`                | use case `closeSession`、`removeConfig`    | ⚠️ 直调                                                      | ⏳ 待审    |
| I-007   | tmux pane 拆分                             | `controllerId, parentTmuxPaneId, direction` | `Promise<SessionInfo>`         | use case `splitPane`（tmux 分支）          | ⚠️ 直调                                                      | ⏳ 待审    |
| I-008   | tmux 新建 window                           | `controllerId, name?`                       | `Promise<SessionInfo>`         | use case `createTmuxWindow`                | ⚠️ 直调（同时被 Pane.tsx 直接调用 V-3）                      | ⏳ 待审    |
| I-009   | tmux 重命名 window                         | `controllerId, tmuxWindowId, name`          | `Promise<void>`                | use case `renameWindow`（tmux 分支）       | ⚠️ 直调                                                      | ⏳ 待审    |
| I-010   | tmux detach controller                     | `controllerId`                              | `Promise<void>`                | use case `closeWindow`（tmux 分支）        | ⚠️ 直调                                                      | ⏳ 待审    |
| I-011   | 批量 attach 持久化的 tmux servers          | —                                           | `Promise<AutoAttachOutcome[]>` | bridge `autoAttachBridge` 启动时           | ⚠️ 直调                                                      | ⏳ 待审    |
| I-012   | 写 stdin（fire-and-forget）                | `id, data: Uint8Array \| string`            | `Promise<void>`                | Terminal 键入 + paste batcher              | ✅ 通过专用 hook `useTauriTerminalOutput`                    | ⏳ 待审    |
| I-013   | resize PTY / SSH / tmux pane               | 三种入参变体                                | `Promise<void>`                | Terminal resize hook                       | ⚠️ 直调（且有 `resizeSession` 旧 fallback 混用）             | ⏳ 待审    |
| I-014   | SSH image upload（OSC 536）                | `id, filename, data: number[]`              | `Promise<string>`              | Terminal.tsx → legacy `sessionService`     | 🔴 违反 V-4                                                  | ⏳ 待审    |

### 3.4 `app/rules/` 纯规则（无 service 依赖）

这部分**不需要**「app → service」接口，因为它不调 service；但 use case 一定会调它，所以列出来作为 use case 的工具集。

#### 3.4.1 `app/rules/paneTree.ts`（22 个纯函数）

| 接口 ID | 目的                                       | 入参                          | 出参               | 实现状态 | 人工 check |
| ------- | ------------------------------------------ | ----------------------------- | ------------------ | -------- | ---------- |
| R-PT-01 | 生成 pane id                               | —                             | `string`           | ✅       | ⏳ 待审    |
| R-PT-02 | 创建叶子 pane                              | `size, sessionId?, configId?` | `PaneLeafNode`     | ✅       | ⏳ 待审    |
| R-PT-03 | 创建 split node                            | `direction, left, right`      | `PaneSplitNode`    | ✅       | ⏳ 待审    |
| R-PT-04 | 在树中查找 pane                            | `root, paneId`                | `PaneNode \| null` | ✅       | ⏳ 待审    |
| R-PT-05 | 替换树中 pane                              | `root, paneId, replacement`   | `PaneNode`         | ✅       | ⏳ 待审    |
| R-PT-06 | 从树中删除 session（并折叠空 split）       | `root, sessionId`             | `PaneNode`         | ✅       | ⏳ 待审    |
| R-PT-07 | 替换树中 session id（reconnect 用）        | `root, oldId, newId`          | `PaneNode`         | ✅       | ⏳ 待审    |
| R-PT-08 | 删除单个 pane                              | `root, paneId`                | `PaneNode`         | ✅       | ⏳ 待审    |
| R-PT-09 | 收集所有 leaf pane id                      | `root`                        | `string[]`         | ✅       | ⏳ 待审    |
| R-PT-10 | 从 SavedPaneNode 剥离 sessionId            | `root`                        | `PaneNode`         | ✅       | ⏳ 待审    |
| R-PT-11 | 默认 window 名（"Window 1"/"Window 2"...） | —                             | `string`           | ✅       | ⏳ 待审    |
| R-PT-12 | 收集树中所有 session id                    | `root`                        | `number[]`         | ✅       | ⏳ 待审    |

> **重复实现警告**：`service/legacy/contexts/session/paneUtils.ts` 的 22 个函数与上面一一对应。**目标**：把 `paneUtils.ts` 的非 `withRecomputedSessionIds` 函数全部删除，统一到 `app/rules/paneTree.ts`。`withRecomputedSessionIds` 拆分为单独的 `app/rules/workspaceRules.ts` 函数（依赖 store 读写，需要用 use case 调用而非纯函数——见 §4）。

#### 3.4.2 `app/rules/sessionRules.ts`

| 接口 ID | 目的                                    | 入参                                   | 出参                  | 实现状态                                                | 人工 check |
| ------- | --------------------------------------- | -------------------------------------- | --------------------- | ------------------------------------------------------- | ---------- |
| R-SR-01 | 从 backend SessionInfo 构建前端 Session | `info, configId, type, displayConfig?` | `Session`             | ✅                                                      | ⏳ 待审    |
| R-SR-02 | 按 type 派发到对应 builder              | `type, builder, input`                 | builder 返回值        | ✅                                                      | ⏳ 待审    |
| R-SR-03 | 校验 session 未被另一 window 占用       | `sessionId, workspaceStore`            | `void`（throw Error） | ⚠️ throw 用 plain `Error`，无 typed discriminant（V-7） | ⏳ 待审    |
| R-SR-04 | 生成不重复的 window 名                  | `name, workspaces`                     | `string`              | ❌ 当前实现为 no-op stub（V-9）                         | ⏳ 待审    |

#### 3.4.3 其他 rules

| 接口 ID | 目的                                   | 入参                    | 出参                              | 实现状态 | 人工 check |
| ------- | -------------------------------------- | ----------------------- | --------------------------------- | -------- | ---------- |
| R-TR-01 | paste 文本 tab → spaces                | `text, tabSize`         | `string`                          | ✅       | ⏳ 待审    |
| R-TR-02 | paste 文本 CRLF 标准化                 | `text`                  | `string`                          | ✅       | ⏳ 待审    |
| R-TR-03 | 统计行数 / 字符数                      | `text`                  | `number`                          | ✅       | ⏳ 待审    |
| R-WR-01 | 收集 workspace 中所有 session id       | `workspace`             | `number[]`                        | ✅       | ⏳ 待审    |
| R-PR-01 | 跨 workspace 定位 session 所在 window  | `sessionId, workspaces` | `{workspaceId, windowId} \| null` | ✅       | ⏳ 待审    |
| R-PR-02 | 检查 session 是否被本 workspace 外使用 | `sessionId, workspaces` | `boolean`                         | ✅       | ⏳ 待审    |
| R-CN-01 | `DEFAULT_GROUP_ID = 0` 常量            | —                       | `0`                               | ✅       | ⏳ 待审    |

### 3.5 `service` 内部暴露给 UI 的接口

UI 组件只能通过以下两种方式读 service 状态：

| 接口     | 目的                                    | 入参                 | 出参                             | 实现状态                         | 人工 check |
| -------- | --------------------------------------- | -------------------- | -------------------------------- | -------------------------------- | ---------- |
| UI-HK-01 | React hook 读 session actions + state   | —                    | `useSessionActions()` 返回值     | ✅                               | ⏳ 待审    |
| UI-HK-02 | React hook 读 workspace actions + state | —                    | `useWorkspaceActions()` 返回值   | ✅                               | ⏳ 待审    |
| UI-HK-03 | React hook 读 persistence               | —                    | `usePersistenceActions()` 返回值 | ✅                               | ⏳ 待审    |
| UI-HK-04 | React hook 读 output dirty 集合         | —                    | `useOutputActions()` 返回值      | ✅                               | ⏳ 待审    |
| UI-HK-05 | React hook 读 theme                     | —                    | `useThemeStore()` 返回值         | ✅                               | ⏳ 待审    |
| UI-HK-06 | React hook 读 logger + 调用             | —                    | `useLogger()` 返回值             | ✅                               | ⏳ 待审    |
| UI-BR-01 | 一次性挂载 6 个 bridge 组件             | —                    | `null`                           | ✅ 通过 `App.tsx`                | ⏳ 待审    |
| UI-HK-07 | Terminal output 订阅（special case）    | `termRef, sessionId` | `void`                           | ✅ 通过 `useTauriTerminalOutput` | ⏳ 待审    |

**UI 层允许 import 的 service 子目录**：

```
✅ 允许:
  src/service/index.ts                  (barrel — 走命名空间)
  src/service/session/store             (Zustand 直接读)
  src/service/workspace/store
  src/service/persistence/store
  src/service/output/store
  src/service/theme/store
  src/service/logger/store
  src/service/logger/useLogger
  src/service/bridges/{Session,Output,Tmux,Theme,Logger,AutoAttach}Bridge
  src/service/hooks/useTauriTerminalOutput

❌ 禁止:
  src/service/legacy/*                  (全部 — Commit 6 删除)
  src/service/*/actions                 (use case 才能用；UI 用 hook 即可)
  src/service/tmux/store                (目前只有 use case 用，UI 暂不需要)
  src/service/pane/store                (目前只有 use case 用)
```

---

## 4. 现有实现的增删查改清单

> 本节回答「需要改什么」。每条给出：位置 → 当前 → 目标 → 优先级。

### 4.1 删除（Commit 6 时一次性）

| ID  | 路径                                                                                                          | 当前                                                                  | 目标                                                            |
| --- | ------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------- | --------------------------------------------------------------- |
| D-1 | `src/service/legacy/` 整个目录                                                                                | 39 个文件（contexts + hooks + services + utils）                      | 全部删除                                                        |
| D-2 | `src/service/legacy/services/sessionService.ts` 中的 tmux window IPC 部分（被 Pane.tsx 用，违反 V-3）         | 仍在 Pane.tsx 使用                                                    | 改用 `infra/tauri/commands/tmux.ts` 直调或经 use case           |
| D-3 | `src/service/legacy/services/sessionService.ts` 中的 SSH image upload 部分（被 Terminal.tsx 用，违反 V-4）    | 仍在 Terminal.tsx 使用                                                | 改用 `infra/tauri/commands/sessions.ts.uploadImageToSshSession` |
| D-4 | `src/service/legacy/contexts/session/paneUtils.ts` 的 23 个 pane tree 函数（`withRecomputedSessionIds` 除外） | 与 `app/rules/paneTree.ts` 20 个函数重复（多出的 3 个是 legacy 独有） | 全部删除（保留 `withRecomputedSessionIds` 移到下）              |
| D-5 | `src/service/legacy/contexts/session/useTauriListeners.ts`                                                    | 直接 import `@tauri-apps/api/event::listen`，（违反 R-1）             | 删除 —— `sessionBridge.tsx` 已接管                              |

### 4.2 新增

| ID  | 路径                                                                                                         | 目的                                                                               | 入参                           | 出参                                                                   | 备注                                                                     |
| --- | ------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------- | ------------------------------ | ---------------------------------------------------------------------- | ------------------------------------------------------------------------ |
| A-1 | `src/service/hooks/useClipboard.ts`                                                                          | 包装 `infra/clipboard/*` 给 UI（修复 V-1）                                         | —                              | `{ readText: () => Promise<string>, writeText: (s) => Promise<void> }` | 让 `Terminal.tsx` 移除 V-1 豁免                                          |
| A-2 | `src/service/hooks/useWindowControls.ts`                                                                     | 包装 `infra/tauri/commands/window.ts` 给 UI（修复 V-2）                            | —                              | `{ getCurrentWindow: () => Window \| null, ... }`                      | 让 `NavBar.tsx` 移除 V-2 豁免                                            |
| A-3 | `src/app/useCases/uploadImageToSshSession.ts`                                                                | 替代 `Terminal.tsx → legacy sessionService.uploadImageToSshSession`（修复 V-4）    | `id, filename, data`           | `Promise<string>`                                                      | 用 `useSessionActions().updateSession` 同步元数据                        |
| A-4 | `src/app/useCases/tmuxWindowOperations.ts`（或拆 3 个）                                                      | 替代 `Pane.tsx → legacy sessionService.{create,kill,rename}TmuxWindow`（修复 V-3） | 三个 use case 各自对应一个 IPC | `Promise<...>`                                                         | 现有 `createTmuxWindow` 已存在，需补 `killTmuxWindow`/`renameTmuxWindow` |
| A-5 | `src/service/legacy/utils/withRecomputedSessionIds.ts`（移出 legacy）                                        | 拆分 `paneUtils.ts` 中**非纯**的 `withRecomputedSessionIds`（依赖 store 写入）     | `workspace, ...args`           | `workspace`（已修改）                                                  | 决定：是纯函数还是 use case？见 §6 OQ-1                                  |
| A-6 | `src/app/rules/typedErrors.ts`                                                                               | 替换 plain `Error`（V-7 修复）                                                     | —                              | `class SessionAlreadyInUseError extends Error` 等                      | 给 `assertSessionNotUsedElsewhere` 等用                                  |
| A-7 | `src/service/session/store.ts` 去重 `rememberTmuxControllerConfig`（已在 `service/tmux/store.ts` 存在，V-8） | 合并到 `tmux` 层                                                                   | —                              | —                                                                      | 见 §6 OQ-2                                                               |

### 4.3 修改

| ID  | 路径                                                                                                            | 当前                                                                                         | 目标                                                                                                                                              |
| --- | --------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| M-1 | `src/app/useCases/createLocalSession.ts`、`createSshSession.ts`、`createTmuxSession.ts` 等 8 个 create use case | 直调 `infra/tauri/commands/*`（V-5）                                                         | 可保留直调（infra 已是合理 IPC 边界）；但需在文件顶部加注释说明「service 层故意不包装 infra/tauri/commands，因为它们是纯 IPC 转发，不含业务规则」 |
| M-2 | 37 个 use case 中的 store 直写（`.getState().setX`）                                                            | ⚠️ 绕过 actions 层                                                                           | 保持现状（actions 层已声明是死代码），**或**删除 actions 层（见 §6 OQ-3）                                                                         |
| M-3 | `src/service/legacy/contexts/session/paneUtils.ts` 的 `withRecomputedSessionIds`                                | 7 个 use case 依赖                                                                           | 移到 `app/rules/workspaceRules.ts` 或 use case 内部 helper                                                                                        |
| M-4 | `src/app/rules/sessionRules.ts::assertSessionNotUsedElsewhere`                                                  | throw plain `Error`（V-7）                                                                   | 改用 `typedErrors.ts` 中的 typed discriminant                                                                                                     |
| M-5 | `src/app/rules/sessionRules.ts::getUniqueWindowName`                                                            | no-op stub（V-9）                                                                            | 实现真正的去重逻辑，或删除该函数并改名为 `getWindowName`                                                                                          |
| M-6 | `src/service/index.ts`                                                                                          | re-export `legacyHooks`                                                                      | Commit 6 时移除此行                                                                                                                               |
| M-7 | `src/infra/tauri/commands/sessions.ts::resizeSession`                                                           | 注释说「legacy / unknown transport fallback」                                                | 删除该函数；统一走 `resizePtySession`/`resizeSshSession`/`resizeTmuxPane` 三选一                                                                  |
| M-8 | `src/service/bridges/sessionBridge.tsx`                                                                         | 用 `withRecomputedSessionIds`（来自 legacy）                                                 | 改用新位置的 helper（A-5）                                                                                                                        |
| M-9 | 9 个 use case + 1 个 test + 1 个 bridge 中对 `withRecomputedSessionIds` 的 import                               | `import { withRecomputedSessionIds } from "../../service/legacy/contexts/session/paneUtils"` | 改 import 到 A-5 的新位置                                                                                                                         |

### 4.4 查询/审计（grep 验证）

执行以下 grep 确认 §2.2 违规清单的当前状态：

```bash
# V-1: UI → infra/clipboard
grep -rn 'from.*infra/clipboard' src/ui/ --include='*.ts' --include='*.tsx'

# V-2: UI → infra/tauri/commands/window
grep -rn 'from.*infra/tauri/commands/window' src/ui/ --include='*.ts' --include='*.tsx'

# V-3: Pane.tsx → legacy sessionService (tmux)
grep -n 'createTmuxWindow\|killTmuxWindow\|renameTmuxWindow' src/ui/Pane.tsx

# V-4: Terminal.tsx → legacy sessionService (image upload)
grep -n 'uploadImageToSshSession' src/ui/Terminal.tsx

# V-5: use case → infra/tauri/commands
grep -rn 'from.*infra/tauri/commands' src/app/useCases/ --include='*.ts'

# V-6: use case → service/legacy
grep -rn 'from.*service/legacy' src/app/ --include='*.ts'

# V-7: use case → @tauri-apps/api 直接
grep -rn '@tauri-apps/api' src/app/ --include='*.ts'

# V-8: legacy → @tauri-apps/api
grep -rn '@tauri-apps/api' src/service/legacy/ --include='*.ts'

# 死代码检查: actions 层零 caller
grep -rn 'from.*service/.*/actions' src/ --include='*.ts' --include='*.tsx' \
  | grep -v 'legacy/' | grep -v 'test'
```

**实际结果（2026-09-24 跑过）**：

| 查询           | 预期命中数                                                  | 实际命中数                                                     | 命中文件                                                                                                                                                                                   | 人工 check  |
| -------------- | ----------------------------------------------------------- | -------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------- |
| V-1            | 0                                                           | **2**                                                          | `src/ui/Terminal.tsx:7,9`                                                                                                                                                                  | 👀 已 check |
| V-2            | 0                                                           | **1**                                                          | `src/ui/NavBar.tsx:3`                                                                                                                                                                      | 👀 已 check |
| V-3            | 0                                                           | **3 调用点**（同文件 6 行匹配，3 个调用 + 3 个 callback 引用） | `src/ui/Pane.tsx:237, 249, 263`                                                                                                                                                            | 👀 已 check |
| V-4            | 0                                                           | **2**                                                          | `src/ui/Terminal.tsx:5, 181`                                                                                                                                                               | 👀 已 check |
| V-5            | **允许**（设计目标允许 use case 直调 infra/tauri/commands） | **~30+**（每个 use case 平均 1-3 个 invoke）                   | 所有 `src/app/useCases/*.ts`                                                                                                                                                               | 👀 已 check |
| V-6            | 0                                                           | **10**（9 use case + 1 test）                                  | `src/app/useCases/{closePane,closeSession,closeWindow,createWindow,loadWindow,reconnectSession,removeConfig,replaceInitWindowWithSession,splitPane}.ts` + `src/app/rules/paneTree.test.ts` | 👀 已 check |
| V-7            | 0                                                           | **0**（仅 `sessionRules.ts:10` 注释提及）                      | —                                                                                                                                                                                          | 👀 已 check |
| V-8            | 0（Commit 6 前为非零）                                      | **2**                                                          | `src/service/legacy/contexts/LoggerContext.tsx:17` + `src/service/legacy/services/sessionService.ts:2`                                                                                     | 👀 已 check |
| actions 死代码 | 0（确认 actions 层未被非 legacy/非 test 代码 import）       | **0**                                                          | —                                                                                                                                                                                          | 👀 已 check |

> **结论**：
>
> - V-1/V-2/V-3/V-4：4 个 UI 层跨界问题，**全部 Phase B 修复**。
> - V-6：9 个 use case + 1 个 test 依赖 legacy helper，**Phase A 修复**。
> - V-7：✅ 已遵守（仅注释提及）。
> - V-8：2 个 legacy 文件直 import `@tauri-apps/api`，**Commit 6 删除整个目录时一并消除**。
> - actions 层：**已确认是死代码**，可在 Phase C 一并清理（或保留无害）。

---

## 5. 迁移路径

### 5.1 三阶段时间线（依赖 §6 决策）

| 阶段                           | 范围                                                                                                                                                                         | 风险                                            | 出口判据                                                     |
| ------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------- | ------------------------------------------------------------ |
| **Phase A — 收口 legacy**      | 迁移 9 个 use case + 1 个 test + 1 个 bridge 中的 `withRecomputedSessionIds` import；替换 2 个 UI 组件的 `infra/clipboard` / `infra/window` 直调（加 `service/hooks/` 包装） | 🟡 中（依赖 store 写入的 helper 怎么拆见 OQ-1） | §4.4 的 V-1/V-2/V-6 全部 0 命中                              |
| **Phase B — 替换 legacy 直调** | Terminal.tsx 和 Pane.tsx 改用 use case（新增 4 个 use case：A-3, A-4）                                                                                                       | 🟠 高（影响热路径：键入 + tmux 操作）           | §4.4 的 V-3/V-4 全部 0 命中；`git grep legacy/ src/ui/` 为 0 |
| **Phase C — 删除 legacy**      | 删除 `src/service/legacy/` 整个目录；合并 tmux 状态去重（OQ-2）；删除 `actions` 死代码层或保留（OQ-3）                                                                       | 🟠 高（最后一次大重构）                         | `legacy/` 不存在；`tsc --noEmit` 0 error；`npm test` 全绿    |

### 5.2 每阶段依赖的决策

| Phase | 必须先决的 §6 项                              |
| ----- | --------------------------------------------- |
| A     | OQ-1（`withRecomputedSessionIds` 位置）       |
| B     | —                                             |
| C     | OQ-2（tmux 状态去重）；OQ-3（actions 层去留） |

---

## 6. 未决问题（Open Questions）

| ID   | 问题                                                                                                                        | 选项                                                                                                                                                                                           | 倾向                                                                                                                                            | 阻塞 Phase |
| ---- | --------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- | ---------- |
| OQ-1 | `withRecomputedSessionIds` 是纯函数还是 use case？它会改 workspace 树（store 写入），但目前被 use case 同步调用             | (a) 改成纯函数返回新 workspace，让 8 个 caller 自己写 store；(b) 改成 use case，8 个 caller 改为 await；(c) 保留为 store mutation helper（side-effect 函数）放在 `app/rules/workspaceRules.ts` | (b) — 与现有 use case 风格一致；但要保证原子性                                                                                                  | A          |
| OQ-2 | `service/session/store.ts` 的 `rememberTmuxControllerConfig` 等 tmux 函数 vs `service/tmux/store.ts` 的同名函数，如何去重？ | (a) 全删 `service/session` 里的 tmux 函数，迁 tmux 数据到 `service/tmux`；(b) 全删 `service/tmux`，统一到 `service/session`；(c) 保留两份，按调用者位置选                                      | (a) — tmux 数据天然属于 `service/tmux`；且 `service/session` 应只管「一个 backend 连接」                                                        | C          |
| OQ-3 | `service/*/actions.ts` 包装层去留                                                                                           | (a) 删（已知是死代码）；(b) 保留并强制 use case 通过它（包一层语义增强，例如自动 logger）；(c) 保留但不强制                                                                                    | (a) — 死代码不删会留坑；但(b) 可能引出 logger wrapper 价值（用 use case logger 代替每个内部 console.error）                                     | C          |
| OQ-4 | `use case → infra/tauri/commands` 是设计目标还是过渡态？                                                                    | (a) 设计目标（infra 是合理 IPC 边界）；(b) 过渡态，未来在 `service/` 加一层 wrapper                                                                                                            | (a) — infra/tauri/commands 已经够薄（每函数 ~5 行），再加 wrapper 是过度抽象                                                                    | —          |
| OQ-5 | `Terminal.tsx` 的 keypress 直写 `writeSession`（I-12 入口）是否绕过 use case？                                              | 当前：Terminal.tsx 通过 `usePasteBatcher` 等 hook 间接调 `infra/tauri/commands/sessions.writeSession`（不走 use case）                                                                         | 设计目标：**允许 UI hook 直调 infra IPC**（属于 I-12 的合法路径）；不走 use case 是因为 use case 会引入 store mutation 副作用，键入路径必须纯净 | ⏳ 待审    |
| OQ-6 | use case 错误模型：throw vs `Result<T, E>` vs console.error + continue                                                      | (a) 现状（mix）；(b) 统一 typed Result；(c) 错误分两类——「用户错误」throw typed、「系统错误」console.error + 降级                                                                              | (c) — 与现有错误注释（"best-effort backend close"）一致                                                                                         | —          |

---

## 7. 维护规则

| 变更类型                 | 同步本文的章节                                                   |
| ------------------------ | ---------------------------------------------------------------- |
| 新增 use case            | §3.2（接口表）+ §3.3（如果引入新 IPC）+ §4.3 决策                |
| 新增 IPC 命令（Rust 侧） | §3.3（接口表）+ `architecture/03-development-view.md` §5         |
| 引入新的 service store   | §2.1 + §3.2（新建小节）+ §4.1（如果删旧 store）                  |
| 删除 legacy 模块         | §4.1 D-* + §5.x 当前 phase                                       |
| 修改桥接组件职责         | §3.5 UI-BR-* + §3.2 对应 store 接口                              |
| 拍板 §6 未决问题         | §6 表格 → 在行的「倾向」列写最终决策，并把表格整行替换为决议记录 |

---

文档结束。**下一步**：[`target-architecture.md`](../target-architecture.md)（把本文接口契约落到目标仓库布局）+ [`architecture/03-development-view.md`](../architecture/03-development-view.md) §2（同步更新前端依赖方向图）。
