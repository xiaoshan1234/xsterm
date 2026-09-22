# 02 创建 tmux session 的端到端流程

> **范围**：用户从 UI 选 "Tmux" 标签 → 提交 → 后端起 `tmux -CC` → bootstrap window/pane 全部回灌 → 前端装配 xsterm Window + PaneTree leaf → xterm.js 渲染。
>
> **不包含**：`attach`（已存在的 session）和 `auto_attach_on_startup`（App 启动批量恢复）—— 见 [`01-open-tmux-session.md`](01-open-tmux-session.md) §3.2 / §3.3。
>
> **覆盖代码版本**：双栈过渡期（Commit 4 末期）。`useSessionLifecycle` / `SessionContext` 还在 `src/service/legacy/`，但**真正的编排函数**已迁到 `src/app/useCases/`（新栈）；本文档以**新栈调用链**为主线，legacy 包装层单独标注。
>
> **相关 ADR**：[`dev/adr/0005-tmux-redesign-v0.md`](../adr/0005-tmux-redesign-v0.md)（P1-P5 拆分设计，含 use case + bridge 的目标态）。
>
> **相关历史**：Bug 014 / 016 / 018 / 019 / 021（bootstrap 多 pane 顺序）、Bug 0009（`window_bindings` 双写）。

## 1. 一句话

用户给一个 `TmuxCcConfig` → 前端 use case 探测同名 session 是否已存在 → `invoke("create_tmux_session")` → 后端 `TmuxController` spawn `tmux -CC new-session` 子进程 → controller 等 bootstrap pane + 全量 `list-windows` / `list-panes` → `SessionManager::create_tmux` 组装 `TmuxSessionInit` 同步返回 → 前端把 N 个 Session 一次性 `setSessions`、M 个 xsterm Window 一次性 `setWorkspaces` → xterm.js 渲染所有 pane。

## 2. 入口点

| 入口             | 触发位置                                                                                   | 链路                                                                                                |
| ---------------- | ------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------- |
| **UI 提交**      | `CreateSessionDialog` 选 `tmux-cc` tab + 填 `tmuxSessionName` + `baseConfigId` → 点 Create | `handleCreate` → `onCreateTmux(config, save, displayConfig)`                                        |
| **注入回调**     | `AppLayout`                                                                                | `<CreateSessionDialog onCreateTmux={createTmuxSession}>`（`createTmuxSession` 来自 `useSession()`） |
| **context 取出** | `SessionContext` value                                                                     | `useSessionActions()` spread → `useSessionLifecycle().createTmuxSession`（thin wrapper）            |
| **实际编排**     | `src/app/useCases/createTmuxSession.ts`                                                    | `createTmuxSession(config, save, displayConfig)`                                                    |

> **过渡注释**：前 3 步仍在 legacy 目录，是 `useCallback` 套壳；最后一步是新栈函数体（**真正干活的代码**）。两者通过参数透传相连，没有逻辑分支。

## 3. ASCII 流程图

```
用户点 "Create"（Tmux tab）
   │
   ▼
[FE] CreateSessionDialog.handleCreate
   │ src/ui/dialogs/CreateSessionDialog.tsx:96-169
   │ 1. 校验表单（tmuxSessionName, baseConfigId 必填）
   │ 2. 合并 TmuxCcConfig + displayConfig
   │ 3. await onCreateTmux(tmuxConfigWithName, saveConfig, form.displayConfig)
   │                                                            ↑
   │    [legacy 包装层]                              │
   │    src/service/legacy/contexts/session/         │
   │    useSessionActions.ts:150                      │
   │    → useSessionLifecycle.createTmuxSession       │
   │       (src/service/legacy/contexts/session/      │
   │        useSessionLifecycle.ts:83-89, useCallback) │
   └────────────────────────────────────────────────┘
                              │
                              ▼
[FE] createTmuxSessionUseCase（主编排）
   │ src/app/useCases/createTmuxSession.ts:30
   │ ┌─── Phase A：探测 + 调后端 ────────────────────┐
   │ │ line 39: probeTmuxSessionExists(config)       │
   │ │     ↳ invoke("probe_tmux_session_exists")    │
   │ │     ↳ Rust: probe 是否已有同 name 的 server   │
   │ │ line 41:                                       │
   │ │   if exists → attachTmux(config)              │
   │ │   else      → createTmux(config)              │
   │ │     ↳ invoke("create_tmux_session", {config}) │
   │ │       src/infra/tauri/commands/tmux.ts:90     │
   │ └────────────────────────────────────────────────┘
                              │
                              ▼  TmuxCcConfig → IPC
[BE Tauri IPC] commands::create_tmux_session
   │ src-tauri/src/commands/session.rs:212
   │ 1. tracing entry
   │ 2. state.create_tmux(&config, dyn_backend).await
   │
   ▼
[BE] SessionManager::create_tmux
   │ src-tauri/src/services/session_manager.rs:311
   │ 1. allocate_controller_id (u32) + bootstrap_session_id (u32)
   │ 2. TmuxController::spawn_local(config, …)
   │      src-tauri/src/services/tmux/controller/mod.rs:388
   │      a. 校验 tmux_session_name.is_some()
   │      b. SSH path: ssh_backend.connect_exec → SshTmuxBackend
   │         Local path: tokio::process::Command::new("tmux")
   │           .args(["-CC", "new-session", "-d", "-s", name, "-x", cols, "-y", rows])
   │      c. spawn_with_backend (line 506)
   │         - spawn reader_task    (stdout → strip DCS → parse → dispatch_tx)
   │         - spawn writer_task    (stdin_rx → tmux stdin)
   │         - spawn stderr_drain   (warn per line)
   │         - spawn monitor_task   (backend.wait() → !killed ⇒ dispatch Exit)
   │         - spawn dispatch_task  (ProtocolEvent match arm)
   │         - schedule_initial_state_sync (OS thread sleep 500ms → list-windows/list-panes)
   │ 3. await_first_pane()                           ← [5s timeout]
   │      ↓ oneshot 解锁（dispatch 收到 %window-pane-changed）
   │ 4. take_initial_state()                         ← [5s timeout]
   │      ↓ 等 list-windows + list-panes 两条响应都解析完
   │ 5. tmux_pane_info(…) 组装 bootstrap SessionInfo
   │ 6. self.tmux_controllers.insert(controller_id, …)
   │ 7. self.insert_session(bootstrap_id, ActiveSession::Tmux(TmuxPaneHandle{…}))
   │ 8. 组装 TmuxSessionInit { session, windows, panes, control_window }
   │ 9. return Ok(TmuxSessionInit)                          ──┐
   │                                                          │
   ▼                                                          │
[BE Tauri IPC] commands::create_tmux_session                  │
   │ 10. return Ok(TmuxSessionInit) ←─────────────────────────┘
   │
   ▼  TmuxSessionInit → IPC
[FE] createTmuxSessionUseCase（拿到 init）
   │ src/app/useCases/createTmuxSession.ts:30
   │ ┌─── Phase B：构造 Session 行 ──────────────────┐
   │ │ line 47: bootstrap = buildFrontendSession(    │
   │ │   init.session, configId, "tmux-cc", displayConfig) │
   │ │   (src/app/rules/sessionRules.ts:71)          │
   │ │ line 72-92: 遍历 init.panes                   │
   │ │   按 sessionId 去重                            │
   │ │   对每个 pane → buildFrontendSession(…)       │
   │ │ line 93: useSessionStore.getState()            │
   │ │   .setSessions(prev => [...prev, ...rows])     │
   │ │   ↳ src/service/session/store.ts:87           │
   │ │     同时写 sessionsRef.current（同步镜像）     │
   │ └────────────────────────────────────────────────┘
   │ ┌─── Phase C：装 Window + PaneTree ────────────┐
   │ │ line 97, 153: installInitialWindows(init, …) │
   │ │ line 170:  按 tmuxWindowId 把 panes 分组      │
   │ │ line 182:  buildRootPane(panes[0].sessionId) │
   │ │           → { kind:"leaf",                   │
   │ │              binding:{ sessionId, configId }}│
   │ │ line 183:  push Window{kind:"terminal",       │
   │ │           tmuxControllerId, tmuxServerWindowId,
   │ │           rootPane} 到当前 workspace          │
   │ │ line 206:  创建 TmuxControlWindow{kind:       │
   │ │           "tmux-control"}（无 rootPane）      │
   │ │ line 215:  useWorkspaceStore.getState()       │
   │ │           .setWorkspaces(...)                 │
   │ │ line 197-204: 设 activeWindowId = bootstrap pane │
   │ │            所在 Window                       │
   │ └────────────────────────────────────────────────┘
   │ line 63（可选）: save=true 时 → usePersistenceStore
   │                  .upsertSavedConfig(config)
   │
   ▼
[FE] React 渲染
   │ 1. useSessionActions() selector 通知订阅组件重渲染
   │ 2. <WorkspaceContainer> 遍历 workspace.windows → 渲染 xsterm Window
   │ 3. <TerminalPane sessionId={binding.sessionId}> mount
   │ 4. useTauriTerminalOutput(sessionId) → listen("session-output")
   │    Channel<Uint8Array> → xterm.write
   │
   ▼
[并行 / 异步] Rust dispatch task 在 create_tmux_session 返回后**继续** emit
   │ src-tauri/src/services/tmux/bridge/mod.rs
   ├─ tmux-pane-added      (每个 pane，含 bootstrap)
   │   src/service/legacy/contexts/session/useTauriListeners.ts:245
   │   ↳ 幂等：bootstrap 已在 Phase B 入 store → listener 短路退出
   ├─ tmux-window-list     (controller batch)
   │   src/service/legacy/contexts/session/useTauriListeners.ts:622
   │   ↳ 写 tmuxWindowListsRef（给 retry banner / control window 用）
   └─ tmux-window-added    (用户后续 new-window，非 bootstrap)
       src/service/legacy/contexts/session/useTauriListeners.ts:327
       ↳ 新栈 TmuxBridge (src/service/bridges/tmuxBridge.tsx:33) 也订阅，
         但目前只是 log（Commit 3 骨架），写入仍在 legacy listener
```

## 4. 调用栈表（按时间序）

| #   | 步骤                               | 文件 : 行                                                                | 关键行为                                                                                                                        | 异步边界                    |
| --- | ---------------------------------- | ------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------- | --------------------------- |
| 1   | 用户点 submit                      | `src/ui/dialogs/CreateSessionDialog.tsx:336`                             | form validate；合并 TmuxCcConfig + displayConfig                                                                                | —                           |
| 2   | `handleCreate` 调 `onCreateTmux`   | `CreateSessionDialog.tsx:155`                                            | `await onCreateTmux(tmuxConfigWithName, saveConfig, form.displayConfig)`                                                        | —                           |
| 3   | `AppLayout` 注入                   | `src/ui/AppLayout.tsx:139`                                               | `<CreateSessionDialog onCreateTmux={createTmuxSession}>`                                                                        | —                           |
| 4   | `useSession()` 取出                | `src/service/legacy/contexts/session/useSessionActions.ts:150`           | spread `createTmuxSession` 到 context value                                                                                     | —                           |
| 5   | `useSessionLifecycle` 包一层       | `src/service/legacy/contexts/session/useSessionLifecycle.ts:83-89`       | `useCallback` 透传 use case                                                                                                     | —                           |
| 6   | `createTmuxSessionUseCase` Phase A | `src/app/useCases/createTmuxSession.ts:38-44`                            | probe + invoke                                                                                                                  | Tauri IPC × 1~2             |
| 7   | `probeTmuxSessionExists`           | `src/infra/tauri/commands/tmux.ts`                                       | `invoke("probe_tmux_session_exists", {config})`                                                                                 | Tauri IPC                   |
| 8   | `createTmux`                       | `src/infra/tauri/commands/tmux.ts:90-98`                                 | `invoke<TmuxSessionInit>("create_tmux_session", {config})`                                                                      | Tauri IPC                   |
| 9   | Tauri 命令入口                     | `src-tauri/src/commands/session.rs:212`                                  | tracing entry                                                                                                                   | command runner              |
| 10  | `SessionManager::create_tmux`      | `src-tauri/src/services/session_manager.rs:311`                          | 分配 id；调 `spawn_local`；`await_first_pane`；`take_initial_state`；写注册表                                                   | async fn                    |
| 11  | `TmuxController::spawn_local`      | `src-tauri/src/services/tmux/controller/mod.rs:388`                      | 校验 `tmux_session_name`；起 Local/Ssh TmuxBackend；调 `spawn_with_backend`                                                     | sync fn → 起 5 tokio task   |
| 12  | `spawn_with_backend`               | `src-tauri/src/services/tmux/controller/mod.rs:506`                      | 起 reader/writer/stderr_drain/monitor/dispatch task；`schedule_initial_state_sync`                                              | sync fn，起后台 task        |
| 13  | reader_task parse stdout           | `controller/mod.rs::spawn_reader_task`                                   | strip DCS → `ProtocolParser::feed` → `dispatch_tx`                                                                              | tokio task                  |
| 14  | dispatch 处理 `WindowList`         | `tmux/dispatch.rs::emit_window_list`                                     | 分配 xsterm_window_id；写 `window_bindings`（Bug 0009 双写）；emit `tmux-window-list`                                           | tokio task                  |
| 15  | dispatch 处理 `WindowPaneChanged`  | `tmux/dispatch.rs::dispatch_event` case (c)                              | `record_pane_window`（双写）；`first_pane_tx.send((xsterm_id, pane_id))`                                                        | tokio task                  |
| 16  | monitor_task                       | `controller/mod.rs::spawn_monitor_task`                                  | `backend.wait()` → !killed → `dispatch_tx.send(Exit)`                                                                           | tokio task                  |
| 17  | `first_pane_rx` oneshot 解锁       | `controller/mod.rs::await_first_pane`                                    | `await_first_pane()` return                                                                                                     | async oneshot               |
| 18  | `take_initial_state` 解锁          | `controller/mod.rs::take_initial_state`                                  | 等 list-windows + list-panes 两条响应都解析完                                                                                   | async oneshot               |
| 19  | `tmux_pane_info(…)` 组装           | `session_manager.rs` helper                                              | 组装 `SessionInfo`                                                                                                              | sync                        |
| 20  | 写注册表                           | `session_manager.rs:create_tmux`                                         | `tmux_controllers.insert` + `sessions.insert(ActiveSession::Tmux(TmuxPaneHandle))`                                              | sync（DashMap shard lock）  |
| 21  | 组装 `TmuxSessionInit`             | `session_manager.rs:create_tmux`                                         | `{ session, windows, panes, control_window }`                                                                                   | sync                        |
| 22  | Tauri 命令 return                  | `commands/session.rs:create_tmux_session`                                | `Ok(TmuxSessionInit)`                                                                                                           | —                           |
| 23  | JSON 跨 IPC                        | (runtime)                                                                | serialize/deserialize                                                                                                           | —                           |
| 24  | use case Phase B                   | `app/useCases/createTmuxSession.ts:46-93`                                | `buildFrontendSession` × m；`useSessionStore.setSessions([…])`                                                                  | sync（store action）        |
| 25  | use case Phase C                   | `app/useCases/createTmuxSession.ts:97, 153-231`                          | `installInitialWindows`：分组 panes → `buildRootPane` × w → push Window × w + controlWindow → `useWorkspaceStore.setWorkspaces` | sync（store action）        |
| 26  | use case 持久化（可选）            | `app/useCases/createTmuxSession.ts:63`                                   | `usePersistenceStore.upsertSavedConfig(config)`                                                                                 | tauri-plugin-store 异步 IPC |
| 27  | React 渲染                         | (UI)                                                                     | `<WorkspaceContainer>` 遍历 windows → `<TerminalPane sessionId>` mount                                                          | React render                |
| 28  | `useTauriTerminalOutput` 订阅      | `src/hooks/useTauriTerminalOutput.ts`                                    | `listen("session-output")` → Channel → xterm.write                                                                              | Tauri event bus             |
| 29  | 用户看到终端                       | (UI)                                                                     | —                                                                                                                               | —                           |
| —   | **并发**：dispatch task 继续 emit  | `src-tauri/src/services/tmux/bridge/mod.rs`                              | `tmux-pane-added` / `tmux-window-list` / `tmux-window-added`                                                                    | tokio task                  |
| —   | listener 兜底                      | `src/service/legacy/contexts/session/useTauriListeners.ts:245, 327, 622` | 幂等检查 → 写 store（bootstrap 已存在，短路）                                                                                   | Tauri event bus             |

**总耗时目标**：local < 200ms（含 500ms `schedule_initial_state_sync` 延迟）；SSH < 1s（含 round-trip）。

## 5. 关键时序（async 同步点）

```
T=0       [FE] handleCreate → onCreateTmux
T=0       [FE→BE] invoke("probe_tmux_session_exists")
T=0+      [BE] probe 返 false（首次创建）
T=0+      [FE→BE] invoke("create_tmux_session", {config})
T=0+      [BE] commands::create_tmux_session ENTRY
T=0+      [BE] SessionManager::create_tmux
T=0+      [BE] TmuxController::spawn_local
          ├─ 校验 session_name (sync)
          ├─ spawn tokio Command "tmux" (sync, blocking IO)
          ├─ spawn_with_backend
          │   ├─ spawn reader_task    ──────────┐
          │   ├─ spawn writer_task    ──────────┤
          │   ├─ spawn stderr_drain   ──────────┤
          │   ├─ spawn monitor_task   ──────────┤
          │   ├─ spawn dispatch_task  ──────────┤  tokio tasks
          │   └─ schedule_initial_state_sync    │ (OS thread sleep 500ms)
          │                                    │
T≈500ms   [BE] OS thread wakes                │
          ├─ controller.session_name()        │
          ├─ tmux_cmd::list_windows(&name)    │
          ├─ stdin_tx.send(cmd)               │
T≈500ms   [BE] writer_task 排空 → tmux stdin  │
T≈500ms   [BE] tmux 收到 list-windows 命令   │
T≈500ms   [BE] tmux 回 %begin ... %end        │
T≈500ms   [BE] reader_task parse → emit_window_list
          ├─ 写 window_bindings (Bug 0009 双写)
          └─ emit tmux-window-list batch
          [CONCURRENT]
T≈50-100ms [BE] tmux 创建后自动 emit:
          - %window-add
          - %window-pane-changed @<win> %<pane>  ← first pane signal
T≈50-100ms [BE] reader parse → WindowPaneChanged
T≈50-100ms [BE] dispatch_event case (c) → first_pane_tx.send
T≈50-100ms [BE] first_pane_rx oneshot 解锁
T≈50-100ms [BE] tmux_window_id_for_pane + xsterm_window_id_for
T≈50-100ms [BE] SessionInfo 组装
T≈50-100ms [BE] sessions.insert + tmux_controllers.insert
T≈50-100ms [BE] take_initial_state 解锁（list-windows 已解析）
T≈50-100ms [BE] 组装 TmuxSessionInit
T≈50-100ms [BE] commands::create_tmux_session EXIT
T≈50-100ms [FE] use case 拿到 TmuxSessionInit
T≈50-100ms [FE] Phase B：buildFrontendSession × m → setSessions
T≈50-100ms [FE] Phase C：installInitialWindows → setWorkspaces
T≈50-100ms [FE] <TerminalPane sessionId=…/> mount × m
T≈50-100ms [FE] xterm.js first paint × m
```

**关键观察**：

- `spawn_with_backend` 立即 return；`create_tmux_session` 走 async 等 `await_first_pane` + `take_initial_state`
- `schedule_initial_state_sync` 用 **OS thread sleep 500ms** 而不是 tokio delay —— 不占 runtime slot
- `TmuxSessionInit` 是**单一同步 IPC 返回的全量快照**：windows / panes / control_window 都在这一份里。listener 端只对**后续**用户操作（split / new-window）生效
- new 栈 use case 同步注册了 N 个 Session + W 个 Window，listener 端只需幂等兜底
- **listener 端 bootstrap 短路**：line 248-251 检查 sessionId 是否已在 store，是则 return —— 保证不重复 add

## 6. 错误路径

| #   | 失败模式                      | 触发                                             | 处理                                                                                                                                                                                 |
| --- | ----------------------------- | ------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 1   | `tmuxSessionName` 为空        | `TmuxForm` 未填                                  | `handleCreate` 表单校验失败 → 不调 `onCreateTmux`                                                                                                                                    |
| 2   | `tmux` 二进制 not found       | Create                                           | `spawn_local` 入口 → `tmux_spawn_err()` 给详细 Windows 安装提示 → Tauri 返 `Err(String)` → use case throw → dialog 报错                                                              |
| 3   | SSH 连接失败                  | SSH 模式                                         | `ssh_backend.connect_exec` 返 Err → `spawn_with_backend` 返 Err → Tauri 透传                                                                                                         |
| 4   | tmux 5s 不回 first pane       | server 死锁 / 网络断                             | `await_first_pane` `tokio timeout(5s)` → `TmuxError::Timeout` → 返 Err                                                                                                               |
| 5   | `take_initial_state` 5s 超时  | list-windows/list-panes 没回                     | 同上；Tauri 返 Err                                                                                                                                                                   |
| 6   | `probeTmuxSessionExists` 抛错 | server 探测失败                                  | use case Phase A 降级：catch 后无条件走 `createTmux`（line 41）                                                                                                                      |
| 7   | `window_bindings` 没填        | Bug 0009 回归                                    | `xsterm_window_id_for` 返 None → `SessionInfo.xsterm_window_id = None`；Phase C `installInitialWindows` 里 `buildRootPane` 不依赖这个字段，所以**当前路径不受影响**（attach 才依赖） |
| 8   | persistence 失败              | tauri-plugin-store 错                            | best-effort warn 不抛错（不能 mask 成功的 create）                                                                                                                                   |
| 9   | reader EOF                    | tmux 主动关 stdin                                | reader 退出；monitor `wait()` 返回 → dispatch Exit 分支 → 触发 `tmux-controller-exit` 事件 → frontend retry banner（独立于创建流程）                                                 |
| 10  | bootstrap pane 重复 add       | listener 收到 `tmux-pane-added` 但 use case 已加 | listener 端 line 248-251 幂等检查，return                                                                                                                                            |

## 7. 关键数据结构

### `TmuxSessionInit`（`src-tauri/src/models/session.rs:413`）

```rust
pub struct TmuxSessionInit {
    pub session: SessionInfo,                  // bootstrap pane 的 info
    pub windows: Vec<TmuxWindowInit>,          // 所有 n 个 tmux window
    pub panes: Vec<TmuxPaneInit>,              // 所有 m 个 tmux pane（含 bootstrap）
    pub control_window: TmuxControlWindowInit,
}
```

| 字段                         | 类型     | 含义                                       |
| ---------------------------- | -------- | ------------------------------------------ |
| `session.id`                 | `u32`    | **xsterm session id**（前端 `Session.id`） |
| `session.tmux_pane_id`       | `String` | tmux 服务端 id（如 `"%5"`）                |
| `session.tmux_controller_id` | `u32`    | controller 句柄                            |
| `session.tmux_window_id`     | `String` | tmux 服务端 window id（如 `"@5"`）         |
| `windows[].tmux_window_id`   | `String` | 决定 Phase C 的分组 key                    |
| `panes[].session_id`         | `u32`    | 决定 PaneTree leaf 的 `binding.sessionId`  |

> **关键 id 区分**：前端只持有 xsterm session id（u32）+ 通过事件 / `TmuxSessionInit` payload 拿到的 `(controllerId, tmux_pane_id, tmux_window_id)`。invoke 后端命令时**直接传 server id**，不查 sessions 表，也不做 controller 全表扫描。

### PaneTree leaf（`useCases/createTmuxSession.ts:245`）

```ts
function buildRootPane(sessionId: number, _active: boolean): PaneNode {
  return {
    id: generateId(),
    kind: "leaf" as const,
    size: 100,
    binding: { sessionId, configId: "" },
  };
}
```

### 概念层级对照

| xsterm 概念                  | tmux 概念   | 关系                                |
| ---------------------------- | ----------- | ----------------------------------- |
| Session（backend 连接）      | tmux pane   | **1:1 代理**（不是 1:1 对应）       |
| xsterm Window                | tmux window | **1:1 渲染**（PaneTree 树）         |
| xsterm pane（PaneTree leaf） | tmux pane   | **同一个对象的不同视图**            |
| TmuxControlWindow            | —           | 1 个 controller 1 个（无 rootPane） |

> ⚠️ **命名禁忌**：
>
> - ❌ "xsterm session = tmux pane" —— 错。xsterm session 是连接，pane 是 UI leaf。
> - ❌ "xsterm session 对应 tmux session" —— 错。前者代理的是 tmux pane。
> - ❌ "frontend `Session` 就是 xsterm pane" —— 错。pane 通过 `sessionId` 引用 Session。
>   详细：[`../architecture/01-logical-view.md`](../architecture/01-logical-view.md) §3 + AGENTS.md §"命名禁忌"。

## 8. 跨视图引用

- 概念层级 / 数据契约 → [`architecture/01-logical-view.md`](../architecture/01-logical-view.md) §3（xsterm Window / pane / Session / TmuxController）+ §4（事件契约）
- 5 tokio task + 7 channel 拓扑 → [`architecture/02-process-view.md`](../architecture/02-process-view.md) §3（tmux 子系统并发模型）
- 模块树 + bridge 事件表 → [`architecture/03-development-view.md`](../architecture/03-development-view.md) §3（`src/app/useCases/` + `src/infra/tauri/` + `src/service/` 三层）
- 部署 + capabilities + SSH 路径差异 → [`architecture/04-physical-view.md`](../architecture/04-physical-view.md) §1-§3
- 关键场景串联 → [`architecture/05-scenarios.md`](../architecture/05-scenarios.md) 场景 2

## 9. 已知改进点（不归本流程）

| TODO                                                                      | 出处                | 工作量                                        |
| ------------------------------------------------------------------------- | ------------------- | --------------------------------------------- |
| `TmuxBridge`（`src/service/bridges/tmuxBridge.tsx`）从 log 骨架迁到真写入 | ADR 0005 P5         | 中（与 legacy `useTauriListeners` 拆分边界）  |
| `useSessionLifecycle.createTmuxSession` legacy 包装层迁到新栈             | ADR 0005 P5         | 小（useCallback 套壳，删除即可）              |
| `list_panes -t @<window>` per-window 两步                                 | req-006 §3 line 117 | 1 PR（dispatcher 加 follow-up 队列）          |
| `TmuxCcConfig.tmux_session_name: Option<String>` → `String`               | 用户强制要求        | 小（破坏面主要是前端默认值 + 持久化反序列化） |
| `attached_tmux.json` 持久层迁 toml                                        | roadmap M3 W10-12   | 大                                            |
