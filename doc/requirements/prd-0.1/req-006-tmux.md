# Tmux 控制模式集成（tmux -CC）

> **状态**：规划阶段 v1（2026-09-03）
> **取代**：`req-006-tmux.md` 旧 34 行占位级需求（已被本文档取代）
> **配套**：`doc/arch/architecture-map.md`（架构）、`doc/design-system.md`（UI 规范）
> **环境依赖**：tmux ≥ 3.0（已在 3.5a 上验证）

---

## 1. 背景与目标

### 1.1 一句话

xsterm 通过 tmux 的 `-CC`（control mode）协议，把**一个 tmux server**的所有 sessions / windows / panes 映射到 xsterm 的 window / pane tree 上，由 xsterm 的 React 渲染层替代 tmux 自带的 TUI。

### 1.2 价值

| 场景 | 当前 | 集成后 |
|---|---|---|
| 多 pane | 每 xsterm session = 一个 PTY；`splitPane()` 函数存在但无 UI 触发点 | 真实多 pane：每个 tmux pane = 一个 xsterm leaf，可真实承载独立 shell |
| 会话保持 | 关 app → shell 退出 | 关 app → tmux 仍在 server 跑；重开 attach 完整恢复 |
| 远程开发 | SSH session 独立 | SSH + tmux -CC：远端 tmux 由本地 native 渲染 |
| 跨设备连续 | 切设备 → 历史丢 | 切设备 attach → 状态完整恢复 |

### 1.3 范围

- **In scope**：本地 tmux -CC、SSH 上的 tmux -CC、split / kill / new-window / 滚动回溯、reconnect
- **Out of scope**：tmux popups（tmux 3.4+）、tmux plugin 控制、tmux 配置文件编辑

---

## 2. 关键设计决策（已采纳推荐）

| ID | 决策 | 推荐 | 备选 |
|---|---|---|---|
| D1 | 一个 xsterm session 对应一个 tmux pane 还是 tmux server | **tmux controller 拥有 N 个 xsterm session**（与 WezTerm/iTerm2 一致）| 1:1 映射（浪费 tmux server） |
| D2 | tmux window ↔ xsterm 元素 | **tmux window → xsterm Window**（`Window { rootPane: PaneNode }` 的 root 之下展开）| tmux window → xsterm Tab（与现有 TabBar 冲突）|
| D3 | bootstrap pane（`tmux -CC new` 的原始 pane）处理 | **埋掉**（`Session.isHidden=true`，前端不渲染）| 显示 banner + 提示 |
| D4 | scrollback 策略 | **lazy capture**（focus 时 `capture-pane -p -S -<N>` 回灌 xterm.js）| 连续 pipe-pane + replay（性能差、易冲突）|
| D5 | SSH + tmux 走法 | **复用 SSH exec channel**，远端跑 `tmux -CC`，把 byte stream 当作 tmux 控制 socket | 加 SSH tunneling 层（过度工程）|

### 2.3 命名约定

- **Tmux controller**：一个 `tmux -CC` 子进程 = 一个 controller，对应 N 个 xsterm session
- **underlay-session**：原 `req-006-tmux.md` 用语，与 controller 等价；本文档统一用 **controller**
- **bootstrap pane**：`tmux -CC new` 时 tmux 占用原来原 pty，那个 shell 的 pane 叫 bootstrap pane（埋掉）
- **tmux pane id**：tmux 内部 id，格式 `%<N>`（如 `%5`）
- **xsterm session id**：xsterm 内部 session id（u32，对应 frontend `Session.id`）

---

## 3. tmux -CC 协议摘要

### 3.1 传输

- **stdout**：line-oriented（`\n` 分隔），所有 `%` 前缀的 line 是事件
- **stdin**：newline-terminated 文本命令
- **字节流**：tmux 在 `%output` 数据中把 `< 0x20` 和 `\` (0x5C) 编码为 `\nnn` 三位八进制

### 3.2 输出事件

```
# 实时输出
%output %<pane_id> <octal-escaped-data>
%extended-output %<pane_id> <age_ms> ... : <escaped-data>
%pause %<pane_id>
%continue %<pane_id>

# 会话 / 窗口 / pane 生命周期
%sessions-changed
%session-changed $<id> <name>
%session-renamed $<id> <name>
%session-closed $<id>
%session-window-changed $<id> @<id>

%window-add @<id>
%window-close @<id>
%window-renamed @<id> <name>
%window-pane-changed @<id> %<id>
%unlinked-window-add @<id>
%unlinked-window-close @<id>

%layout-change @<id> <layout> <visible-layout> <flags>
%pane-mode-changed %<id>
%pane-died %<id>
%pane-exited %<id>

%paste-buffer-changed <name>
%client-detached <client>
%client-session-changed ...
%exit [reason]
%config-error <msg>
%popup-open /%popup-output /%popup-close  (tmux 3.4+)
```

### 3.3 命令响应（按 id 关联）

```
%begin <ts> <cmd_id> <flags>
<响应正文，可多行>
%end <ts> <cmd_id> <flags>
# 或失败：
%error <ts> <cmd_id> <flags> <msg>
```

### 3.4 输入命令（写到 stdin）

```
send-keys -t %<pane> <keys...>
resize-pane -t %<pane> -x <cols> -y <rows>
capture-pane -p -e -J -S -<lines> -t %<pane>
split-window -h|-v -t %<pane> [-c <dir>]
new-window -t $<session> [-n <name>] [-c <dir>]
kill-pane -t %<pane>
kill-window -t @<window>
rename-window -t @<id> <new_name>
list-panes -t @<window>
list-windows -t $<session>
list-sessions
refresh-client -A
attach-session -t <name>
display-message -p -t %<pane> '#{pane_width} #{pane_height}'
# 空行 =客户端 detach
```

---

## 4. 架构方案

### 4.1 后端新增模块

```
src-tauri/src/infrastructure/tmux/
├── mod.rs                  # 公开 TmuxController + 工厂
├── controller.rs           # 主状态机：socket I/O + command queue
├── parser.rs               # line → ControlEvent 纯函数
├── escape.rs               # unescape_output (octal → bytes)
├── commands.rs             # 高层 API: send_keys / split_window / ...
├── events.rs               # ControlEvent enum
└── tests/
    ├── parser_test.rs
    └── escape_test.rs

src-tauri/src/services/tmux_session.rs  # controller ↔ SessionManager bridge
```

`src-tauri/src/infrastructure/mod.rs` 添加 `pub(crate) mod tmux;`。

### 4.2 SessionManager 扩展

```rust
pub(crate) enum ActiveSession {
    Pty(Box<dyn SessionBackend + Send>),
    Ssh(Box<SshSessionWrapper>),
    TmuxPane(TmuxPaneHandle),  // 薄壳，write/resize/close 全部转发给 controller
}

pub struct TmuxPaneHandle {
    controller_id: u32,
    tmux_pane_id: String,        // 例如 "%5"
    info: SessionInfo,
    capabilities: CapabilityFlags, // multiplex=true
}

pub struct SessionManager {
    sessions: DashMap<u32, Arc<ActiveSession>>,
    next_id: AtomicU32,
    pty_system: Box<dyn PtySystem>,
    ssh_backend: Box<dyn SshBackend>,
    // 新增：tmux controllers 独立 map（不混入 sessions）
    tmux_controllers: DashMap<u32, Arc<TmuxController>>,
    next_controller_id: AtomicU32,
}
```

`TmuxPaneHandle` 自身不实现 `SessionBackend`，而是把 write/resize/close 转发到 controller（持有的 `Arc<TmuxController>`）。

### 4.3 CapabilityFlags 扩展

```rust
impl CapabilityFlags {
    pub fn for_tmux() -> Self {
        Self {
            supports_resize: true,
            supports_reconnect: true,
            supports_local_echo: false,
            supports_multiplex: true,  // 关键：解锁 splitPane UI
        }
    }
}
```

### 4.4 数据流

**tmux pane 显示**：

```
tmux server
  │ line-stream (stdout)
  ▼
TmuxController.reader_task (Rust)
  │ read() → split lines → parser.feed(line)
  ▼ ControlEvent enum
TmuxController.dispatch_event()
  │ Output → backend.emit("session-output", [xsterm_session_id, bytes])
  │ PaneAdd → backend.emit("tmux-pane-added", { controllerId, tmuxPaneId, xstermSessionId })
  │ WindowAdd → backend.emit("tmux-window-added", ...)
  │ Exit → backend.emit("tmux-controller-exit", ...)
  ▼
AppBackend::emit → Tauri event bus
  ▼
useTauriListeners.ts (新增订阅)
  │ tmux-pane-added → SessionContext state.push new Session
  ▼ React 渲染
```

**用户键入**：

```
xterm.onData(data) [Terminal.tsx]
  ▼
writeSessionRef.current(sessionId, data) [usePaneActions]
  ▼
sessionService.writeSession(id, data) → invoke("write_session")
  ▼
commands::write_session
  │ match ActiveSession::TmuxPane(handle) → controller.send_keys(handle.tmux_pane_id, data)
  ▼
TmuxController.cmd_queue.push(format!("send-keys -t %{id} {escaped}\n"))
  │  cmd_queue worker thread（单线程串行 dispatch）
  ▼
tmux child.stdin.write_all(cmd)
  ▼
tmux server → shell
```

### 4.5 新 Tauri 命令

| 命令 | 作用 | Wave |
|---|---|---|
| `create_tmux_session(config)` | 启动本地 / SSH 上的 tmux -CC controller | 1 |
| `attach_tmux_session(config)` | attach 到已有 tmux server（reconnect） | 4 |
| `create_tmux_pane(controllerId, parentPaneId, direction)` | split-window，返回 promise | 2 |
| `kill_tmux_pane(paneId)` | kill-pane | 2 |
| `resize_tmux_pane(paneId, rows, cols)` | resize-pane | 1 |
| `capture_tmux_pane(paneId, lines)` | scrollback 抓取 | 4 |
| `create_tmux_window(controllerId)` | new-window | 3 |
| `kill_tmux_window(windowId)` | kill-window | 3 |
| `rename_tmux_window(windowId, name)` | rename-window | 3 |
| `close_tmux_controller(controllerId)` | detach / 关 controller | 1 |

### 4.6 新事件

| 事件 | payload | 触发 | Wave |
|---|---|---|---|
| `tmux-pane-added` | `{ controllerId, tmuxPaneId, xstermSessionId, parentTmuxWindowId }` | `%window-pane-changed`（未注册 pane）| 2 |
| `tmux-pane-removed` | `{ controllerId, tmuxPaneId, xstermSessionId }` | `%pane-exited` / `%pane-died` / 主动 kill | 2 |
| `tmux-pane-resized` | `{ tmuxPaneId, rows, cols }` | （本地 resize 后，pane 尺寸变化）| 2 |
| `tmux-window-added` | `{ controllerId, tmuxWindowId, xstermWindowId }` | `%window-add` | 3 |
| `tmux-window-closed` | `{ controllerId, tmuxWindowId, xstermWindowId }` | `%window-close` | 3 |
| `tmux-window-renamed` | `{ controllerId, tmuxWindowId, name }` | `%window-renamed` | 3 |
| `tmux-controller-exit` | `{ controllerId, reason? }` | `%exit` | 4 |
| `tmux-paused` / `tmux-continued` | `{ tmuxPaneId }` | `%pause` / `%continue` | 1 |

### 4.7 前端 Context 扩展

`useSessionState.ts` 新增：

```ts
tmuxControllers: Map<number, TmuxControllerState>

interface TmuxControllerState {
  id: number;
  sessionName: string;
  socketName?: string;
  bootstrapPaneSessionId: number;  // 通常 hidden
  paneBindings: Map<string, number>; // tmux pane id → xsterm session id
  isAttached: boolean;
}
```

`Session` 类型扩展：

```ts
interface Session {
  // ... 现有字段 ...
  tmuxPaneId?: string;        // "%5"
  tmuxControllerId?: number;  // 关联到 controller
  isHidden?: boolean;         // bootstrap pane
}
```

`SessionType` 扩展（`src/types/session.ts:61`）：

```ts
type SessionType =
  | { type: "local"; config: LocalSessionConfig }
  | { type: "ssh"; config: SSHSessionConfig }
  | { type: "tmux-cc"; config: TmuxCcConfig };

interface TmuxCcConfig {
  name?: string;
  /** tmux session 名（attach 时留空表示 new-session） */
  tmuxSessionName?: string;
  /** tmux socket 名（-L 参数），留空使用 default */
  socketName?: string;
  /** 启动命令，new-session 时使用 */
  startCommand?: string;
  /** SSH 配置：若设置则在远端 tmux，否则本地 */
  ssh?: SSHSessionConfig;
  termType?: string;
  initialRows?: number;
  initialCols?: number;
}
```

---

## 5. UI / UX 改动清单

### 5.1 Pane 右键菜单（关键缺口修复）

`src/components/Pane.tsx` 已有的 split 项目前**未挂 onClick**。Wave 2 必须挂上：

```tsx
{ session.capabilities?.supports_multiplex ? (
  <MenuItem onClick={() => splitPane(wsId, winId, paneId, 'horizontal')}>
    Split Right
  </MenuItem>
  <MenuItem onClick={() => splitPane(wsId, winId, paneId, 'vertical')}>
    Split Down
  </MenuItem>
  <MenuItem onClick={() => killTmuxPane(paneId)}>
    Kill Pane
  </MenuItem>
) : (
  <MenuItem disabled hint="当前 session 不支持分屏">
    Split
  </MenuItem>
)}
```

### 5.2 顶部工具栏新增

- Terminal 顶栏加 `<icon name="tmux" />` 标识 tmux session
- Pane hover 时显示 split / kill 按钮（参考 VSCode split editor 风格）

### 5.3 快捷键

`useAppShortcuts.ts` 新增：
- `Ctrl+\` → splitPane(activePane, "vertical")
- `Ctrl+Shift+\` → splitPane(activePane, "horizontal")

### 5.4 CreateSessionDialog 新增 tab

`Shell` / `SSH` / `Tmux (Local)` / `Tmux (SSH)` 四个 top tab。最简化表单：name / startCommand / initialCols / size。复用 `CommonSettingsForm` 显示配置。

### 5.5 bootstrap pane 渲染

`Pane.tsx` 在 `session.isHidden === true` 时**不渲染**该 pane leaf（修改 `PaneTree` 渲染逻辑或 `splitPane` 创建时隐藏）。

### 5.6 设计系统合规

所有新 UI 必须通过 `doc/design-system.md` §10 三条 grep 验证：

```bash
# 1. 无禁止 token
grep -rn -E "(--bg-primary|--bg-secondary|--bg-tertiary|--text-primary|--text-secondary|--text-muted|--border-color|#0e639c|#1177bb|linear-gradient)" src/ ...

# 2. 无 bold weight on chrome
grep -rn "font-weight: ?(600|700|bold)" src/ ...

# 3. 仅允许的 box-shadow（5 个例外）
grep -rn "box-shadow:" src/components/
```

---

## 6. 持久化

- `savedConfigs` 自动包含新字段（`tmuxCcConfig`），通过现有 Wave 1-3 spec 持久化机制
- 不持久化运行时 pane 绑定（重启时通过 attach-session 重建）
- Wave 4 新增 `attachedTmuxServers: string[]` 全局列表

---

## 7. 实施 Waves

### Wave 0 — 基础设施（3-5 天）
**目标**：能在 Rust 单测里解析 tmux -CC 输出流 + spawn child + 读 line-stream。

- 新建 `src-tauri/src/infrastructure/tmux/{parser,escape,events,commands,controller}.rs`
- 实现 `parser.rs` 纯函数 + 单元测试覆盖 20+ 事件类型
- 实现 `escape.rs::unescape_output` + round-trip 测试
- `controller.rs` 仅含 spawn child + reader thread + write to stdin，**不接 SessionManager**
- `infrastructure/mod.rs` 加 `tmux` 模块

**不做**：不改 SessionManager，不发事件，不连 frontend。

**DoD**：
- `cargo test --manifest-path src-tauri/Cargo.toml` 通过
- parser 20+ 用例全绿
- escape round-trip 绿
- 手动 `cargo run --example tmux_echo`（如加 example）跑通

### Wave 1 — 单 pane MVP（5-7 天）
**目标**：能创建一个 tmux -CC session，看到第一个 pane，键入回显正常。

- `ActiveSession::TmuxPane` variant + `TmuxPaneHandle` 转发器
- `TmuxController` 注册到 SessionManager 独立 map
- `commands/session.rs` 加 `create_tmux_session`
- 实现 `write_session` / `resize_session` / `close_session` 的 tmux 分支
- bootstrap pane 标记 `isHidden=true`
- CapabilityFlags::for_tmux()
- 前端：`Session` 类型加 `tmuxPaneId` / `tmuxControllerId` / `isHidden` 字段
- 前端：`SessionType` 加 `tmux-cc` variant
- 前端：CreateSessionDialog 加 "Tmux (Local)" tab

**DoD**：开 app → 创建 local tmux session → 键入字符正常 → resize 正常 → 关 app。

### Wave 2 — split / multi-pane（5-7 天）
**目标**：UI 上分屏 / kill pane。

- 后端：`create_tmux_pane` / `kill_tmux_pane` 命令 + Promise/Future
- 后端：`%window-pane-changed` → `tmux-pane-added` 事件
- 后端：`%pane-exited` / 主动 kill → `tmux-pane-removed`
- 前端：useTauriListeners 订阅新事件
- 前端：`Pane.tsx` 启用 split 右键菜单项（capability 检查）
- 前端：新增 Pane 顶部 hover split 按钮
- 前端：`usePaneActions.splitPane` 在 `supports_multiplex` 时调新命令，否则 fallback 到现有逻辑
- 前端：`Ctrl+\` / `Ctrl+Shift+\` 快捷键

**DoD**：split、kill、自动 layout 调整。

### Wave 3 — tabs & windows（3-5 天）
**目标**：tmux window ↔ xsterm Window 映射完整。

- 后端：`create_tmux_window` / `kill_tmux_window` / `rename_tmux_window`
- 后端：`%window-add` / `%window-close` / `%window-renamed` 事件
- 前端：渲染策略落实
- 验证：new-window、kill-window、rename

**DoD**：新建 / 关闭 / 重命名 tmux window 都能正常联动 xsterm Window。

### Wave 4 — scrollback & reconnect（3-5 天）
**目标**：reconnect、scrollback、错误恢复。

- 后端：`capture_tmux_pane` 命令
- 前端：pane focus 时拉 scrollback → xterm.js 初始 buffer
- 后端：app 重启时读 `attachedTmuxServers` → 自动 `attach-session`
- 后端：`%exit` → 重试 banner + 手动重连 UI

**DoD**：attach 已有 session 显示完整 scrollback；tmux server 挂掉后 UI 显示可重连。

### Wave 5 — SSH + tmux（5-7 天）
**目标**：ssh config 勾选后远端 tmux -CC。

- `infrastructure/tmux/ssh_controller.rs` — 复用 russh exec channel
- 用户在 SSH session form 勾选 "Use tmux control mode" → 创建 `SshTmuxController`
- 验证：连远程 → 远端 tmux -CC → 本地 native 渲染

**DoD**：SSH config + tmux checkbox 创建的 session 远端跑 tmux、本地显示完整。

### Wave 6 — 抛光 & 安全（2-3 天）
- CSP 重新启用（AGENTS.md 已知债）
- capability permissions 加任何新 command
- 设计系统合规审计（新 UI 必须过 `doc/design-system.md` §10 三条 grep）
- `doc/maintenance/bug.md` 模板化每修一个加一条
- `doc/arch/architecture-map.md` 加 tmux 章节

---

## 8. 风险与边界

| 风险 | 等级 | 缓解 |
|---|---|---|
| tmux 命令 queue 锁竞争 | 中 | 单线程 dispatch task + parking_lot mutex |
| 输出 backpressure（slow consumer）| 中 | 复用现有 64 KiB drain budget；`%pause`/`%continue` 主动暂停 tmux 侧 |
| 中文 / wide char 在 `%output` 转义边界切断 | 低 | parser 不切 buffer；xterm.js 自己处理 UTF-8 |
| pane output 早于 pane 注册（race）| 中 | `backlog: HashMap<PaneId, Vec<u8>>` 模式（WezTerm 同款）|
| `WindowPaneChanged` 早于 `WindowAdd`（tmux 2.7 已知）| 中 | `check_window_attached` 跳过 |
| tmux 2.7 vs 3.4 协议差异 | 低 | 最低支持 3.0；feature detect `history_limit` |
| SSH + tmux 网络断线 | 中 | Wave 5 才做；复用 TCP keepalive（已有 `null_packet_keepalive`）|
| CSP 关闭是已知债 | 中 | Wave 6 一并处理 |
| xsterm 旧 frontend-arch.md 提到 tmux 文件不存在 | 低 | 全部从零写，不被旧 doc 误导 |
| `splitPane` 旧 UI 触发器未挂 | **高** | **Wave 2 必须挂**；否则后端做好了 UI 没入口 |

---

## 9. 测试策略

### 9.1 单元（Rust）
- `parser.rs` 单测覆盖每种 `%xxx` 事件 + 转义 round-trip
- `escape.rs` round-trip：bytes → escape → bytes
- `controller.rs` mock tmux child stdout/stdin（不依赖真 tmux）

### 9.2 集成（Rust 黑盒）
- 启动 `tmux -CC -L ci-test new -s ci` 作为 fixture
- 跑命令 → 断言响应
- 解析 fixture 输出 → 断言结构化事件

### 9.3 手动 smoke（每个 Wave 结束）
- Wave 0：cargo test 全绿
- Wave 1：本地 tmux 启 → 键入 → resize → 关
- Wave 2：split → kill → layout
- Wave 3：new-window → rename → kill
- Wave 4：attach 已有 session → scrollback 重启
- Wave 5：SSH + tmux 远程
- Wave 6：设计系统 grep 三条全过

### 9.4 Vitest
- `useTauriListeners` 处理新事件的 reducer 单测
- `Session` 类型扩展的序列化兼容

---

## 10. 验收标准

每个 Wave 完成：
1. ✅ 所有新增 / 修改文件通过 `lsp_diagnostics`
2. ✅ `cargo test --manifest-path src-tauri/Cargo.toml` 通过
3. ✅ `npm run build` 通过（tsc + vite build）
4. ✅ 设计系统 grep 三条全过（`doc/design-system.md` §10）
5. ✅ 手动 smoke 在真 tmux 3.0+ 上跑通
6. ✅ `doc/maintenance/bug.md` / `doc/arch/architecture-map.md` 同步更新（如涉及）

整体项目完成：
- 全部 Wave 0-6 完成
- `doc/arch/architecture-map.md` 更新 tmux 章节
- `doc/design-system.md` §10 例外清单更新（如新增）
- 本文档 Wave 状态全部从 `待开发` 改为 `已完成`

---

## 11. 状态追踪

| Wave | 范围 | 状态 | 备注 |
|---|---|---|---|
| 0 | parser / escape / controller skeleton | 待开发 | 基础设施先行 |
| 1 | 单 pane MVP（local tmux） | 待开发 | |
| 2 | split / kill pane + UI 启用 | 待开发 | |
| 3 | tabs / windows 映射 | 待开发 | |
| 4 | scrollback / reconnect | 待开发 | |
| 5 | SSH + tmux | 待开发 | |
| 6 | 抛光 / 设计合规 / 文档同步 | 待开发 | |

---

## 12. 相关文档

- `doc/arch/architecture-map.md` — 全栈架构地图（SessionManager、PaneNode 等）
- `doc/design-system.md` — Cursor 暗色 IDE 设计语言（UI 规范）
- `doc/maintenance/bug.md` — 已知 bug 历史（修复 tmux 相关 bug 后追加）
- `doc/requirements/prd-0.1/req-001-session-connection.md` — 通用 session 连接（上下文）
- `doc/requirements/prd-0.1/session-config-*.md` — session config 字段详表（Wave 1 需要扩 `tmux-cc` 字段）

---

## 13. 变更记录

| 日期 | 版本 | 变更 |
|---|---|---|
| 2026-09-03 | 1.0 | 初稿。整合旧 34 行 req-006 + tmux -CC 协议调研 + xsterm 架构映射 + Wave 拆分 |