# 05 场景视图 (Scenarios / +1 View)

> **目的**：用一组关键场景把 4 个视图串起来 —— 验证它们描述的是**同一个东西**，并暴露视图之间的耦合点。
> 4+1 中 "1" 的作用：**视图一致性检查**（Kruchten 原文）。

## 场景选取标准

- 每个场景至少触发 3 个视图的关注点
- 至少 1 个场景涉及**跨主机路径**（local vs SSH）
- 至少 1 个场景涉及**写路径**（用户操作下行）
- 至少 1 个场景涉及**读路径**（backend 数据上行）
- 不重复：场景之间不覆盖相同的事件链

## 场景 1：创建 local PTY session（最简路径）

> **角色**：dev 第一天跑通的项目。

**操作**：用户点 "New Local Session" → 选 shell → 回车。

| 视图 | 关注点 |
|---|---|
| 逻辑 | `Session` 注册表新增 1 项；`workspace.windows[]` 增 1 个 Window；Window 内的 PaneTree 是 1 个 Leaf，绑该 Session.id |
| 进程 | SessionManager 在 DashMap 插入；本地 PTY 在 tokio runtime spawn；stdout → session-output Channel → 前端 |
| 开发 | 前端 `CreateSessionDialog` → `invoke("create_session", config)` → `commands/session.rs::create_session` → `services::local_session::spawn` → 返回 `Session.id` |
| 物理 | Tauri WebView2 ↔ 主进程 IPC；local PTY 在用户机 fork；无网络 |

**数据流**（端到端）：

```
CreateSessionDialog
  → invoke("create_session", { type: "local", shell: "/bin/bash" })
  → commands/session.rs::create_session
  → services::session_manager::create_local
      → portable-pty::native_pty_system → spawn shell
      → DashMap.insert(session_id, ActiveSession { reader, writer })
      → spawn output task (reader → app.emit("session-output", [id, bytes]))
  → return { sessionId }
  → 前端 useSessionLifecycle::createAndActivateSession
      → createWindowFromSession(sessionId)
          → workspaces[].windows.push(new Window with Leaf { sessionId })
  → React render
```

**视图一致性检查**：
- 逻辑视图的 Session 注册表 = 进程视图的 DashMap 内容
- 开发视图的 command 列表包含 `create_session`（✓）
- 物理视图的 capabilities 包含 command invoke 所需权限（默认 `core:default` 够）

## 场景 2：通过 SSH 启动 tmux -CC 并 attach 已存在的 tmux server

> **角色**：dev 第二周在 SSH server 上 tmux 复用 —— 最有价值的 tmux 路径。

**操作**：用户配置 SSH 凭据 → 选 "Attach to existing tmux session" → 输入 session name → 回车。

**前置**（物理视图）：SSH server 上已有 `tmux -CC` server 在跑（或先 create）。

| 视图 | 关注点 |
|---|---|
| 逻辑 | `TmuxController` 注册表新增 1 项；Session 注册表新增 N 项（N = server 上 pane 数）；workspace.windows 增 N 个（每 pane 一个 Window） |
| 进程 | SshTmuxBackend 包 russh exec channel；reader task 收到 DCS 包壳的 wire 协议 → strip → parse → dispatch；handshake plan_for 决定 bootstrap 步骤；first_pane_tx 一次性信号触发 attach 完成 |
| 开发 | `infrastructure/ssh.rs` + `infrastructure/tmux/backend.rs::SshTmuxBackend` + `controller/handshake.rs::plan_for` + `bridge/mod.rs::emit_window_list` |
| 物理 | **跨主机**：用户在 Windows / macOS / Linux，tmux server 在 SSH host；russh data loop 在 bridge 线程把字节搬进 tokio mpsc |

**数据流**（端到端）：

```
attach UI
  → invoke("attach_tmux_session", { ssh: {host, port, user, auth}, tmux: {session_name} })
  → commands::attach_tmux_session
  → SessionManager::attach_tmux
      → SshTmuxBackend::spawn(russh session, "tmux -CC attach-session -t <name>")
      → controller::spawn_with_backend(backend, SpawnMode::Attach)
          → 起 4 task (reader / writer / stderr_drain / monitor)
          → handshake::plan_for(server_version) → 步骤序列
              → writer: refresh-client -C [+ 1 for OpenBSD]
              → writer: attach-session -c ""
              → writer: list-windows -a -F ...
              → writer: list-panes -a -F ...
          → reader: parse stdout → CommandBegin/CommandEnd → router_state resolve
      → attach 路径等 first_pane_tx（oneshot）
      → bootstrap 路径通过 %window-pane-changed / %window-add → bridge.emit_pane_list / emit_window_list
          → emit tmux-window-list / tmux-pane-list batch
  → 前端 listen("tmux-window-list")
      → useTauriListeners: 批量建 Window + Leaf（dedupe by xstermWindowId）
  → first_pane_tx 收到 → caller resolve（attach promise 完成）
```

**视图一致性检查**：
- 逻辑视图说"attach 用 `SpawnMode::Attach`" → 进程视图 channel topology 完全一致（除了 spawn mode 字段）
- 开发视图的 `attach_tmux_session` command 在 capabilities 里（✓）
- 物理视图的 SSH 字节桥接路径与这里的 reader task 接续**完全契合**

**已知风险**：
- Bug 014：OpenBSD tmux 解析 `refresh-client -C` 要 `-C 1`（PR-T4 handshake 已用 capability 矩阵兼容）
- Bug 009：SSH 必现的 DCS 包壳，reader 已统一 strip
- Bug 0009：`record_pane_window` 必须同时写 `pane_window_bindings` + `window_bindings`（Bug 已知 + 单测覆盖）
- Bug 023：SSH create_tmux_session 5s timeout（**已修**，RouterState::in_flight for fire-and-forget）

## 场景 3：用户在 tmux pane 里输入 + tmux 回包显示（写+读热路径）

> **角色**：tmux 日常使用的心跳路径，**性能关键**。

**操作**：用户在 tmux pane focus → 输入 `echo hello\r` → 看到 `hello` 输出。

| 视图 | 关注点 |
|---|---|
| 逻辑 | Session（pane leaf）写 → backend stdin → tmux 处理 → tmux stdout → Session output → xterm.js 写 |
| 进程 | writer task 排空 stdin_rx；reader task 独占 parser + stdout reader；dispatch task → TmuxBridge → app.emit("session-output") → 前端 Channel<Uint8Array> → xterm.write |
| 开发 | `protocol/wire.rs::send_keys`（`escape_output` + `"-l"` + 引号包裹）→ `controller/mod.rs::send_keys` → `UnboundedSender` |
| 物理 | local：同机无网络；SSH：russh channel 双向字节 |

**数据流**（按字节）：

```
1. 用户键盘
   xterm.js onData → frontend: bytes = [0x65, 0x63, 0x68, 0x6f, 0x20, 0x68, 0x65, 0x6c, 0x6c, 0x6f, 0x0d]
                    ↓
2. 前端（sessionOutputChannel / writeSession）
   invoke("write_session", { sessionId, data: bytes })
                    ↓
3. Tauri IPC
   commands/session.rs::write_session
                    ↓
4. SessionManager 查 DashMap → 找到 ActiveSession
   writer.write_all(bytes)  ← 同步写（不 fire-and-forget，与 send_keys 不同）
                    ↓
5. LocalTmuxBackend.stdin → tmux 子进程 stdin
   SSH: SshTmuxBackend.stdin → russh channel → SSH server tmux stdin
                    ↓
6. tmux 处理（解析 send-keys -l "echo hello\r"）
   内部执行 shell echo → 输出 "hello\n"
                    ↓
7. tmux stdout → %output {pane_id, "hello\n"}
   (SSH 路径：包在 ESC P 1000 p ... ESC \)
                    ↓
8. reader task
   strip DCS (SSH only) → BufReader::lines → ProtocolParser::feed
   → ProtocolEvent::Output { pane_id, data: b"hello\n" }
   → dispatch_tx.send(event)
                    ↓
9. dispatch task
   dispatch_event → TmuxBridge::emit_session_output([xsterm_session_id, bytes])
   → app.emit("session-output", payload)
                    ↓
10. WebView 进程
    listen("session-output") → Channel<Uint8Array> → xterm.write(bytes)
                    ↓
11. 用户看到 "hello"
```

**视图一致性检查**：
- 逻辑视图的"Session 是 backend 连接" → 进程视图的 writer/reader 都挂在 Session 上（✓）
- 开发视图的 `protocol/wire.rs::send_keys` 处理 escape（Bug 024）→ 逻辑视图的"写数据到 pane"语义完整（✓）
- 物理视图的 SSH 路径必现 DCS strip → 进程视图 step 8 显式处理（✓）

**性能断言**（关联 `dev/changelog/perf.md`）：
- 整链路 ≤ 5ms（local）、≤ 50ms（SSH 含 round-trip）
- %pause / %continue（Perf 003）是 tmux 主动背压信号，前端可暂停 rAF 批写

## 场景 4：关闭 tmux pane（kill-pane + UI 清理）

> **角色**：覆盖所有 4 视图的"反向操作"，验证状态一致性。

**操作**：用户在 pane 标题栏点 × 按钮（或调用快捷键）→ pane 消失，window 还在；tmux server 上 pane 真被 kill。

| 视图 | 关注点 |
|---|---|
| 逻辑 | `closeSession` → backend 关闭 → Session 注册表删除 → 所有 workspace 调 `removeSessionAndCollapse` 移除绑它的 leaf |
| 进程 | TmuxController.send `kill-pane -t %<pane>` → tmux 回 `%pane-exited` → bridge emit `tmux-pane-removed` → 前端清理 |
| 开发 | `protocol/wire.rs::kill_pane` + `bridge::emit_tmux_pane_removed` + `useTauriListeners:tmux-pane-removed` |
| 物理 | local / SSH 都走 TmuxBackend 抽象，行为一致 |

**数据流**：

```
1. UI × 按钮
   onClick → sessionService.killTmuxPane(xstermSessionId)
                    ↓
2. invoke("kill_tmux_pane", { xsterm_session_id })
   commands::kill_tmux_pane
                    ↓
3. TmuxController::send_keys("kill-pane -t %<pane>")
   writer task 排空
                    ↓
4. tmux 收到 kill-pane
   pane 子进程 exit → tmux emit %pane-exited { pane_id }
                    ↓
5. reader task → ProtocolEvent::PaneExited { pane_id }
   dispatch → TmuxBridge::emit_tmux_pane_removed({controller_id, tmux_pane_id, xsterm_session_id})
                    ↓
6. WebView listen("tmux-pane-removed")
   useTauriListeners:
     - 从 sessions[] 删 Session
     - 从 PaneTree 移除绑它的 leaf 并 collapse parent
     - 触发 React re-render
                    ↓
7. TmuxController 内部状态
   pane_bindings.delete(tmux_pane_id)
   pane_window_bindings.delete(tmux_pane_id)
   （**注意**：window_bindings **不删**，因为同 window 还可能有 pane）
```

**视图一致性检查**：
- 逻辑视图的"关闭 Session 不关闭 Window" → 进程视图 step 7 不动 window_bindings（✓）
- 开发视图的 `kill_tmux_pane` command 在 capabilities（✓）
- 物理视图：本场景 local / SSH 行为完全一致（验证 TmuxBackend 抽象成功）

## 场景 5（设计意图，未实现）：tmux control window 编排

> **角色**：P8 设计阶段（**未落地**，仅作场景示意）

**操作**：用户在 control window 点 "+ New Window" → 创建一个新 tmux window。

| 视图 | 关注点 |
|---|---|
| 逻辑 | control window 是 xsterm Window 中**一个特殊类型**，承载 session 控制 UI + window 列表；新建 window 走 `create_tmux_window` |
| 进程 | 与场景 4 同（invoke command → wire → tmux → %window-pane-changed → emit） |
| 开发 | control window UI 在 `components/tmux-control/`（**待 P8 落地**） |
| 物理 | 与场景 2 一样取决于 local / SSH |

**当前状态**：brainstorm 在 `dev/adr/0009-tmux-control-window.md`，未实现。本场景仅作"如果要做，会怎么走"的占位。

## 视图交叉表（一致性检查矩阵）

| | 场景 1 | 场景 2 | 场景 3 | 场景 4 |
|---|---|---|---|---|
| 01-logical | ✓ | ✓ | ✓ | ✓ |
| 02-process | ✓ | ✓ | ✓ | ✓ |
| 03-development | ✓ | ✓ | ✓ | ✓ |
| 04-physical | ✓ | ✓ | ✓ | ✓ |
| 跨主机 (SSH) | — | ✓ | ✓ | (与 local 一致) |
| 写路径 | — | — | ✓ | ✓ |
| 读路径 | ✓ | ✓ | ✓ | — |

每行每列交叉至少 1 个 ✓ —— 4 个视图都被触达；4 个场景互补覆盖（不重复）。

## 跨视图引用

- 这 4 个视图本身 → `01-logical-view.md` / `02-process-view.md` / `03-development-view.md` / `04-physical-view.md`
- 关键 bug 历史 → `dev/changelog/bugs.md`（本视图每个场景末尾的"已知风险"对应一条记录）
- 设计决策 → `dev/adr/0005-tmux-redesign-v0.md`（为什么用 4 task + CommandRegistry 替代旧 7 pending 字段）
