# 01 打开 tmux session 的端到端流程

> **范围**：用户从 UI 点 "Create Tmux Session" / "Attach Tmux Session" → 后端起 `tmux -CC` 进程 → tmux 回 bootstrap pane → 前端显示一个 xsterm Window + pane。
>
> **覆盖模式**：Create（新建 session）、Attach（已有 session）、Auto-attach（启动时从 `attached_tmux.json` 批量恢复）。
>
> **相关 ADR**：[`dev/adr/0001-keep-tmux-cc.md`](../adr/0001-keep-tmux-cc.md)（为什么用 `-CC`）、[`dev/adr/0005-tmux-redesign-v0.md`](../adr/0005-tmux-redesign-v0.md)（P1-P5 拆分设计）。
>
> **相关历史**：Bug 014（OpenBSD `refresh-client -C`）、Bug 016（list-panes 兜底）、Bug 018/019（bootstrap 多 window）、Bug 021（pre-existing panes）、Bug 0009（`window_bindings` 双写）、PR-0009-fix（`-t <session>` 精确）。

## 1. 一句话

用户给一个 `TmuxCcConfig` → 前端 invoke → 后端 `TmuxController` spawn 一个 `tmux -CC` 子进程（local 或 SSH exec channel） → tmux 回 `%window-pane-changed` → dispatch task 注册 pane → `await_first_pane` oneshot 解锁 → `SessionManager::create_tmux` 把 pane 塞进注册表 + 返 `SessionInfo` → 前端 React state 增 1 Session / 1 Window / 1 pane leaf → xterm.js 渲染。

## 2. 入口点

| 入口 | 触发位置 |
|---|---|
| **Create** | `CreateSessionDialog` 选 tmux-cc + 填 name → `useSessionLifecycle::createAndActivateSession` → `sessionService.createTmux(config)` |
| **Attach** | 同 dialog 选 "Attach" → 先 `probeTmuxSessionExists(config)` → 若 `true` 调 `attachTmux(config)` |
| **Auto-attach** | App 启动时 `useTmuxAutoAttach` 读 `attached_tmux.json` → 逐条 `attachTmux(config)` |

3 条路径共用后端同一组函数（`create_tmux_session` / `attach_tmux_session`），只是 spawn mode 不同。

## 3. ASCII 流程图

### 3.1 Create 模式（新 session）

```
用户点 "New Tmux Session"
   │
   ▼
[FE] CreateSessionDialog
   │ onSubmit → useSessionLifecycle.createAndActivateSession
   │           → sessionService.createTmux(config)
   │           → invoke<SessionInfo>("create_tmux_session", { config })
   │              src/services/sessionService.ts:70
   ▼
[BE Tauri IPC] commands::create_tmux_session
   │ src-tauri/src/commands/session.rs:161
   │ 1. tracing::info!("[DEBUG-0009-RUST] create_tmux_session command ENTRY")
   │ 2. state.create_tmux(&config, backend).await
   ▼
[BE] SessionManager::create_tmux
   │ src-tauri/src/services/session_manager.rs:310
   │ 1. allocate_controller_id()             → u32 (e.g. 1)
   │ 2. TmuxController::spawn_local(config, backend, ssh_backend, controller_id)
   │                                                  ↓
   │    [TmuxController::spawn_local]                ↓
   │    src-tauri/src/services/tmux/controller/mod.rs:355
   │    ─────────────────────────────────────────────↓
   │    1. ✅ 校验 config.tmux_session_name.is_some() (PR-0009-fix)
   │    2. SSH path: ssh_backend.connect_exec → SshTmuxBackend
   │       Local path: tokio Command::new("tmux").args(build_tmux_argv(config))
   │         argv = ["-CC","-L",socket,"new-session","-A","-s",name,"-x",cols,"-y",rows]
   │    3. arc.session_name.lock() = Some(name)   ← PR-0009-fix: stash name
   │    4. spawn_with_backend(backend, ..., SpawnMode::Create)
   │                                                  ↓
   │    [spawn_with_backend]                        ↓
   │    src-tauri/src/services/tmux/controller/mod.rs:409
   │    ─────────────────────────────────────────────↓
   │    1. 起 4 tokio task:
   │       - reader_task    (stdout → BufReader::lines → strip DCS → parse → dispatch_tx)
   │       - writer_task    (stdin_rx.recv() → stdin.write_all)
   │       - stderr_drain   (stderr line → tracing::warn)
   │       - monitor_task   (backend.wait() → if !killed then dispatch_tx.send(Exit))
   │    2. 起 dispatch task: dispatch_rx.recv() → dispatch_event(controller, bridge, event)
   │    3. mode == Create → schedule_initial_state_sync(controller, stdin_tx)
   │       [PR-0009-fix: 读 controller.session_name() → list_windows(&name) → -t <session>]
   │       500ms 后发 "list-windows -t <name> -F '#{...}...'\n"
   │       → tmux 收到后回 %begin T I F ... 每行一个 window ... %end
   │       → dispatch: parse_window_list_body → emit_window_list
   │         → PR-0009-fix 打印 [PR-0009-fix] emit_window_list: session=... windows=[...]
   │         → 对每行: allocate_xsterm_window_id + 写 window_bindings (Bug 0009 双写)
   │         → emit tmux-window-list batch
   │       → 响应里 list-panes auto-follow-up? 不，新版：dispatch 的 WindowList handler
   │         自己决定是否 follow-up（req-006 §3 line 117 TODO 当前不做 per-window）
   │                                                  ↓
   │ 3. controller.await_first_pane().await     ← [5s timeout]
   │                                                  ↓
   │    [await_first_pane]                        ↓
   │    src-tauri/src/services/tmux/controller/mod.rs:914
   │    ─────────────────────────────────────────────↓
   │    take first_pane_rx.oneshot → tokio timeout 5s
   │                                                  ↓
   │    [dispatch task 异步触发]                  ↓
   │    src-tauri/src/services/tmux/dispatch.rs  ↓
   │    ─────────────────────────────────────────────↓
   │    tmux 主动 push "%window-pane-changed @<win> %<pane>"
   │    → ProtocolEvent::WindowPaneChanged
   │    → dispatch_event match arm "five-level fallthrough"
   │      case (a) already-bound → ignore
   │      case (b) split-result  → resolve pending_splits oneshot
   │      case (c) bootstrap (no pending) → record_pane_window (Bug 0009 双写)
   │                                     → first_pane_tx.send((xsterm_id, pane_id))
   │                                                  ↓
   │    oneshot 解锁 → await_first_pane return   ↓
   │                                                  ↓
   │ 4. tmux_window_id = controller.tmux_window_id_for_pane(&pane)
   │    xsterm_window_id = xsterm_window_id_for(&controller, &window_id)
   │      ← 反查 window_bindings HashMap
   │ 5. tmux_pane_info(xsterm_id, controller_id, pane, session, name,
   │                   is_hidden=false,         ← create 不隐藏
   │                   tmux_window_id, xsterm_window_id)
   │ 6. self.tmux_controllers.insert(controller_id, controller)
   │    self.insert_session(xsterm_id, ActiveSession::TmuxPane(handle))
   │ 7. tracing::info!("tmux controller {} spawned; bootstrap pane xsterm_id={}")
   │ 8. return SessionInfo                                    ──┐
   ▼                                                          │
[BE Tauri IPC] commands::create_tmux_session                   │
   │ 9. save_attached_tmux_servers (best-effort)              │
   │ 10. return Ok(SessionInfo)  ←────────────────────────────┘
   ▼
[FE] sessionService.createTmux: SessionInfo
   │
   ▼
[FE] useSessionLifecycle.createAndActivateSession
   │
   ▼
[FE] React state: workspaces[0].windows[0] = new Window with PaneTree::Leaf{ sessionId: info.id }
   │
   ▼
[FE] <TerminalPane sessionId=info.id /> mount
   │
   ▼
[FE] useTauriTerminalOutput(sessionId)
   listen("session-output") → Channel<Uint8Array> → xterm.write
```

**关键日志关键字**（grep 用）：
- `[DEBUG-0009-RUST] create_tmux_session command ENTRY/EXIT`
- `[DEBUG-0009-RUST] SessionManager::create_tmux ENTRY`
- `[DEBUG-0009-RUST] await_first_pane returned xsterm_id=... tmux_pane_id=...`
- `[PR-0009-fix] emit_window_list: session=... windows=[...]`

### 3.2 Attach 模式（已有 session）

```
用户点 "Attach to existing tmux session" (或 Auto-attach 启动)
   │
   ▼
[FE] CreateSessionDialog / useTmuxAutoAttach
   │ 1. await probeTmuxSessionExists(config) → true
   │ 2. sessionService.attachTmux(config)
   │ 3. invoke<SessionInfo>("attach_tmux_session", { config })
   ▼
[BE Tauri IPC] commands::attach_tmux_session
   │ src-tauri/src/commands/session.rs:304
   ▼
[BE] SessionManager::attach_tmux
   │ src-tauri/src/services/session_manager.rs:502
   │ 1. allocate_controller_id()
   │ 2. TmuxController::spawn_attach(config, backend, ssh_backend, controller_id)
   │                                                  ↓
   │    [spawn_attach]                              ↓
   │    src-tauri/src/services/tmux/controller/mod.rs:641
   │    ─────────────────────────────────────────────↓
   │    1. ✅ 校验 config.tmux_session_name.is_some() (PR-0009-fix; 之前已有)
   │    2. argv = ["-CC","-L",socket,"attach-session","-t",name]
   │    3. spawn_with_backend(..., SpawnMode::Attach)
   │    4. arc.session_name.lock() = Some(name)     ← 之前就有
   │    5. Attach mode → inline thread spawn:
   │         - tmux_cmd::list_windows(&session_name)   ← PR-0009-fix
   │         - tmux_cmd::list_panes_with_format("", DEFAULT_PANE_LIST_FORMAT)
   │                                                  ↓
   │ 3. await_first_pane().await                    ↓
   │    ┌─────────────────────────────────────────────┘
   │    ▼
   │    [与 Create 相同的 dispatch 链]
   │    list-windows -t <name> 响应 → emit_window_list
   │      → 写 window_bindings (Bug 0009 双写) + emit tmux-window-list batch
   │    tmux 主动 push %window-pane-changed (server 上原本就有的 window)
   │      → record_pane_window (双写) → first_pane_tx.send
   │                                                  ↓
   │ 4. tmux_pane_info(..., is_hidden=true)         ← attach 隐藏 bootstrap (D3)
   │    "the bootstrap pane tmux -CC attach occupies is the tmux
   │     control connection itself" — iTerm2 D3 pattern
   │ 5. self.tmux_controllers.insert(controller_id, controller)
   │    self.insert_session(xsterm_id, ActiveSession::TmuxPane(handle))
   │ 6. return SessionInfo                                    ──┐
   ▼                                                          │
[BE] commands::attach_tmux_session                           │
   │ save_attached_tmux_servers (best-effort)                 │
   │ return Ok(SessionInfo) ←─────────────────────────────────┘
   ▼
[FE] 与 Create 相同：buildTmuxPaneSession + createAndActivateSession
```

**Attach 模式独有**：
- `is_hidden = true`（前端 listener 收到后 suppress 渲染这个 bootstrap pane；用户后续用 `new-window` / `split-window` 创建的 pane 才是 visible）
- 因为 server 上已有 N 个 windows + panes，dispatch 一次 `list-windows -t <name>` 会枚举全部 → 前端一次性拿到 N 个 Window（通过 `tmux-window-list` batch 事件）

### 3.3 Auto-attach 模式（App 启动批量恢复）

```
App 启动 → useTmuxAutoAttach
   │ 1. load_attached_tmux_servers → Vec<AttachedTmuxServer>
   │ 2. for each server:
   │      a. TmuxCcConfig { name: None, tmux_session_name: Some(s.name), socket, ... }
   │      b. await SessionManager::attach_tmux(&cfg, backend)
   │      c. 收集 AutoAttachOutcome { session_key, info, error? }
   │ 3. 前端 partial-failure UI：死的 server 不影响活的
```

实现：`SessionManager::auto_attach_on_startup` (`session_manager.rs:638`)。与单次 Attach 共用 `attach_tmux`，区别只是批量 + 容错。

## 4. 调用栈表（按时间序）

| # | 步骤 | 文件 : 行 | 关键行为 | 异步边界 |
|---|---|---|---|---|
| 1 | 用户点 submit | (UI) | CreateSessionDialog form validate | — |
| 2 | `createTmux(config)` | `src/services/sessionService.ts:70` | `invoke("create_tmux_session", {config})` | 跨 IPC |
| 3 | `commands::create_tmux_session` | `commands/session.rs:161` | tracing ENTRY；保存 attached_tmux_servers（成功路径） | Tauri command runner |
| 4 | `SessionManager::create_tmux` | `session_manager.rs:310` | 分配 controller_id；调 spawn_local；await_first_pane；写注册表 | async fn |
| 5 | `TmuxController::spawn_local` | `controller/mod.rs:355` | 校验 tmux_session_name（PR-0009-fix）；起 SshTmuxBackend / LocalTmuxBackend；填 session_name 字段 | sync fn → 起 4 tokio task |
| 6 | `spawn_with_backend` | `controller/mod.rs:409` | 起 reader/writer/stderr_drain/monitor task；起 dispatch task；schedule_initial_state_sync | sync fn，但起后台 task |
| 7 | reader_task 持续 parse stdout | `controller/mod.rs:spawn_reader_task` | strip DCS → ProtocolParser::feed → dispatch_tx | tokio task |
| 8 | dispatch task 处理 `WindowList` | `dispatch.rs::emit_window_list` | 分配 xsterm_window_id；写 `window_bindings` (Bug 0009 双写)；emit `tmux-window-list` | tokio task |
| 9 | monitor_task 等待 backend | `controller/mod.rs:spawn_monitor_task` | `backend.wait()` → 若 !killed → dispatch_tx.send(Exit) | tokio task |
| 10 | tmux 主动 push `%window-pane-changed` | (网络) | reader 收 → ProtocolEvent::WindowPaneChanged | — |
| 11 | dispatch "five-level fallthrough" case (c) | `dispatch.rs::dispatch_event` match | record_pane_window (双写)；first_pane_tx.send((xsterm_id, pane_id)) | tokio task |
| 12 | `first_pane_rx` oneshot 解锁 | `controller/mod.rs:914` | `await_first_pane()` return `Ok((u32, String))` | async oneshot |
| 13 | `tmux_pane_info(...)` | `session_manager.rs` helper | 组装 SessionInfo | sync |
| 14 | `tmux_controllers.insert` + `sessions.insert` | `session_manager.rs:389-390` | 注册表写入（DashMap shard lock） | sync |
| 15 | return `Ok(SessionInfo)` | `session_manager.rs:398` | 跨 await return | — |
| 16 | `commands::create_tmux_session` 收到 Ok | `commands/session.rs:181` | save_attached_tmux_servers（best-effort）；return Ok | — |
| 17 | Tauri IPC 把 SessionInfo 序列化 | (runtime) | JSON 跨 IPC | — |
| 18 | `useSessionLifecycle.createAndActivateSession` | `contexts/session/...` | buildTmuxPaneSession(info)；setSessions + setWorkspaces（建 Window + Leaf） | React state update |
| 19 | `<TerminalPane sessionId={info.id}>` mount | (UI) | useTauriTerminalOutput 订阅 session-output | React render |
| 20 | listen("session-output") | `useTauriTerminalOutput.ts` | Channel<Uint8Array> → xterm.write | Tauri event bus |
| 21 | 用户看到 xterm 渲染终端 | (UI) | — | — |

**总耗时目标**：local < 200ms（含 500ms schedule_initial_state_sync 延迟）；SSH < 1s（含 round-trip）。

## 5. 关键时序（async 同步点）

```
T=0     [FE] invoke("create_tmux_session")
T=0     [BE] commands::create_tmux_session ENTRY
T=0+    [BE] SessionManager::create_tmux
T=0+    [BE] TmuxController::spawn_local
        ├─ 校验 session_name (sync)
        ├─ spawn tokio Command "tmux" (sync, blocking IO)
        ├─ spawn_with_backend
        │   ├─ spawn reader_task    ──────────┐
        │   ├─ spawn writer_task    ──────────┤
        │   ├─ spawn stderr_drain   ──────────┤
        │   ├─ spawn monitor_task   ──────────┤  tokio tasks
        │   ├─ spawn dispatch_task  ──────────┤
        │   └─ schedule_initial_state_sync    │ (spawns OS thread, sleep 500ms)
        │                                    │
T≈500ms [BE] OS thread wakes                │
        ├─ controller.session_name()        │
        ├─ tmux_cmd::list_windows(&name)    │
        ├─ stdin_tx.send(cmd)               │
T≈500ms [BE] writer_task 排空 → stdin.write_all → tmux stdin
T≈500ms [BE] tmux 收到 list-windows 命令
T≈500ms [BE] tmux 回 %begin T I F + 每行 window + %end
T≈500ms [BE] reader_task parse → emit_window_list
        ├─ 写 window_bindings (双写)
        └─ emit tmux-window-list batch
T≈500ms [FE] useTauriListeners 收到 batch
        └─ (这里 attach 模式才会处理 batch；create 模式只有 1 window)

        [CONCURRENT] tmux 创建后自动 emit:
        - %session-changed
        - %window-add (bootstrap window)
        - %window-pane-changed @<win> %<pane>  ← 关键 first pane signal

T≈50-100ms [BE] reader_task parse → WindowPaneChanged
T≈50-100ms [BE] dispatch_event → record_pane_window
        ├─ 写 pane_bindings
        ├─ 写 pane_window_bindings
        ├─ 写 window_bindings (双写, Bug 0009)
        └─ first_pane_tx.send((xsterm_id, pane_id))

T≈50-100ms [BE] await_first_pane oneshot 解锁
T≈50-100ms [BE] tmux_window_id_for_pane (反查 pane_window_bindings)
T≈50-100ms [BE] xsterm_window_id_for (反查 window_bindings)
T≈50-100ms [BE] SessionInfo 组装 + 注册表写入
T≈50-100ms [BE] commands::create_tmux_session EXIT
T≈50-100ms [FE] SessionInfo 收到
T≈50-100ms [FE] createAndActivateSession
T≈50-100ms [FE] React render
T≈50-100ms [FE] xterm.js first paint
```

**关键观察**：
- `spawn_with_backend` 立即 return（不 await）；`create_tmux_session` 走 async 等 `await_first_pane`
- schedule_initial_state_sync 用 **OS thread sleep 500ms**，不是 tokio delay —— 避免影响 tokio runtime；500ms 是 Bug 017 的 race fix
- attach 模式下 inline thread spawn 立即发 list-windows（不等 500ms），因为 server 上 window 已经稳定存在

## 6. 错误路径

| # | 失败模式 | 触发 | 处理 |
|---|---|---|---|
| 1 | config.tmux_session_name = None | Create / Attach | `spawn_local` / `spawn_attach` 入口校验 → `TmuxError::Ipc` → string error → Tauri 返回 Err → 前端 invoke throw |
| 2 | `tmux` 二进制 not found | Create / Attach | `tmux_spawn_err()` 给详细提示（Windows 安装路径）；返 Err |
| 3 | SSH 连接失败 | SSH 模式 | `ssh_backend.connect_exec` 返 Err → `spawn_err` → 返 Err |
| 4 | tmux 5s 不回 first pane | server 死锁 / 网络断 | `await_first_pane` `tokio timeout(5s)` → `TmuxError::Timeout` → 返 Err |
| 5 | `window_bindings` 没填 | Bug 0009 回归 | `xsterm_window_id_for` 返 None → SessionInfo.xsterm_window_id = None → 前端 listener dedupe 时漏；这就是为什么 PR-0009-fix 强调 "同时写两表" |
| 6 | monitor_task 检测 child 死 | 非 killed 退出 | dispatch_tx.send(Exit) → dispatch_event 处理 Exit 分支 → bridge.emit_tmux_controller_exit → 前端 retry banner |
| 7 | persistence 失败 | store plugin 错 | best-effort warn 不抛错（不能 mask 成功的 create） |
| 8 | reader EOF | tmux 主动关 stdin | reader 退出（不发 Exit）；monitor 收到 wait → 发 Exit → dispatch Exit 分支 |
| 9 | DCS 包壳未剥 | SSH 必现，local 偶现 | Bug 009 修复：reader 统一 strip；失败的话整行 parse 失败但不会 panic，tracing::warn |
| 10 | list-windows 返回空 | session 名错 / server 上 window 全删 | emit_window_list 收到 0 rows → tmux-window-list 空 batch → 前端拿到空数组不报错 |

## 7. PR-0009-fix 在这条流程里的具体收益

按本流程的步骤编号，影响位置：

| 步骤 | PR-0009-fix 之前 | PR-0009-fix 之后 |
|---|---|---|
| 5 | spawn_local 不校验 session_name（None 也接受） | 校验 `config.tmux_session_name.is_some()`，否则返 `TmuxError::Ipc` |
| 5 | controller.session_name = None（create 模式） | controller.session_name = Some(name) |
| 6 | schedule_initial_state_sync 发 `list-windows -a`（忽略参数） | 发 `list-windows -t <session_name>`（精准） |
| 6 (Attach) | inline thread 发 `list-windows -a` | 发 `list-windows -t <session_name>` |
| 8 | emit_window_list 打印 tmux_window_id + xsterm_window_id | 同左 + `name` 字段 + 一行汇总 `[PR-0009-fix] emit_window_list: session=... windows=[...]` |

**预期效果**：
- attach 到 `test` session 时只列 `test` 的 windows，不再误列 server 上 `dev` 等其他 session
- create 模式忘填 session_name 直接返清晰错误，而不是 tmux 自动起名后下游 list-windows 失败

## 8. 跨视图引用

- 概念层级 / 数据契约 → `architecture/01-logical-view.md` §3-§4
- 4 task + 5 channel 拓扑 → `architecture/02-process-view.md` §3-§4
- 模块树 + bridge 事件表 → `architecture/03-development-view.md` §3-§4
- 部署 + capabilities + SSH 路径差异 → `architecture/04-physical-view.md` §1-§3
- 高层场景（不同视角怎么协同）→ `architecture/05-scenarios.md` 场景 2

## 9. 已知改进点（不归本流程）

| TODO | 出处 | 工作量 |
|---|---|---|
| `list_panes -t @<window>` per-window 两步 | req-006 §3 line 117 + PR-0009-fix TODO 注释 | 1 PR（dispatcher 加 follow-up 队列） |
| `TmuxCcConfig.tmux_session_name: Option<String>` → `String` | 用户的"强制要求"延伸 | 小（破坏面已评估，主要是前端默认值 + 持久化反序列化） |
| tmux-CC Bug 023 SSH create 5s timeout | bugs.md | **已修**（RouterState::in_flight for fire-and-forget） |
| `attached_tmux.json` 持久层迁 toml | M3 W10-12 roadmap | 大 |
