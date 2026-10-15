# M2 — Sessions (多会话)

> 状态：**实施中**。
>
> 父文档：[`../arch/ARCHITECTURE.md`](../arch/ARCHITECTURE.md)、[`../arch/LAYERS.md`](../arch/LAYERS.md)
>
> 上游约束：[`../../AGENTS.md`](../../AGENTS.md)、[`../../DESIGN.md`](../../DESIGN.md)（chrome 视觉）、[`../rules/ts-name-rules.md`](../rules/ts-name-rules.md)、[`../rules/rust-name-rules.md`](../rules/rust-name-rules.md)

---

## 1. 目标

实现 D2 决策：**Tab + Split(h/v) 都做**。架构上落地 D1：**PaneTree 全部在 L3**，L0/L1 不感知 split / tab。验收至少 4 个 pane 同时存活。

**Start tab 模式**（参考 [`../../ref/xsterm/src/ui/InitWindowView.tsx`](../../ref/xsterm/src/ui/InitWindowView.tsx) + `PaneInitCard.tsx`）：app 启动或关闭最后 tab 时，自动创建一个 "start tab"，里面是 `PaneInitCard` 而非空 pane —— 用户点 "New local shell" 才创建真实 session。

**Reconnect 模式**（M2 新增,Q3）：PTY 进程退出时 pane 保留,xterm 不动,显示 "Process exited" banner + Close / Reconnect 两个按钮。Reconnect 用 tab 的 shell 重新 spawn PTY,新输出接到原 xterm(scrollback 保留)。

## 2. 验收（V1–V10）

| #   | 检查         | 通过条件                                                                                                  |
| --- | ------------ | --------------------------------------------------------------------------------------------------------- |
| V1  | Start tab    | app 启动时一个 tab,显示 `PaneInitCard`(无 session);点 "New local shell" 后变 PowerShell pane              |
| V2  | 新建 tab     | 点 `+` 出现新 tab + PaneInitCard                                                                          |
| V3  | 横向 split   | 选中 pane 后按"水平分裂"按钮 → 当前 pane 变两个并排 pane,各自一个 session                                 |
| V4  | 纵向 split   | 选中 pane 后按"垂直分裂"按钮 → 当前 pane 变两个上下 pane                                                  |
| V5  | 4 pane 存活  | 同一 tab 内切出 4 pane(1 切 2 切 4),4 个 PowerShell 都响应键盘                                            |
| V6  | 关闭 pane    | 选中 pane 后按关闭 → 该 session 终止(无僵尸 powershell.exe),剩余 pane 重排;若闭合到根,根变成 PaneInitCard |
| V7  | 关闭 tab     | 关闭非最后 tab → 该 tab 所有 session 终止,焦点跳到相邻 tab;关闭最后 tab → 自动创建新 start tab            |
| V8  | tab 切换     | 点 tab 头切换 → 旧 tab 的 xterm 全部 dispose,新 tab 的 xterm 重新 mount                                   |
| V9  | 输入路由     | 只焦点 pane 的键盘输入到达对应 session;非焦点 pane 不抢输入                                               |
| V10 | PTY 进程退出 | 杀一个 pane 的 PowerShell(`exit` 命令)→ 该 pane 显示 banner "Process exited",其他 pane 不受影响           |
| V11 | Reconnect    | 点 banner 上的 "Reconnect" → spawn 新 PTY,新输出接到原 xterm(scrollback 保留),banner 消失                 |
| V12 | 依赖方向     | ARCHITECTURE 附录 A 矩阵无新违规;wire format 升级不破坏类型                                               |
| V13 | `lib.rs`     | ≤ 100 行                                                                                                  |
| V14 | TS 构建      | `npm run build` 通过                                                                                      |
| V15 | Rust 构建    | `cargo build` 通过                                                                                        |

## 3. 范围 (in / out)

**In**:

- Tab + Split(h/v) UI
- Start tab + `PaneInitCard`
- 跨 pane 的 session 路由 (wire format 加 `id`)
- 进程退出事件 + banner + Reconnect(用 tab 的 shell 重新 spawn)
- 关闭 pane / 关闭 tab / 新建 tab / tab 切换

**Out** (M3+ 再说):

- Split 比例拖拽 (M2 默认 50/50,固定)
- Tab 重新排序
- Tab / pane 拖拽 (chrome 以外的 mouse drag)
- 持久化 / 重启恢复 (M4)
- 主题切换 / 字体 / shell 选择 UI (M5)
- 设置面板 (M5)
- 多 shell 类型 (SSH / tmux / etc.) — M2 只有 local shell
- PaneInitCard 暂只"New local shell"一个按钮;SSH / saved sessions 留 M5

## 4. 数据模型（L3）

```typescript
// domain/pane.ts (新增)

export type PaneNode =
  | { kind: "leaf"; sessionId: SessionId; shell: ShellKind; status: "alive" | "dead" }
  | { kind: "init"; shell: ShellKind } // 渲染 PaneInitCard
  | { kind: "hsplit"; left: PaneNode; right: PaneNode; ratio: number }
  | { kind: "vsplit"; top: PaneNode; bottom: PaneNode; ratio: number };

// path from root to focused leaf, e.g. [0, 1] = root.hsplit.left.vsplit.bottom
export type PanePath = ReadonlyArray<0 | 1>;

export interface PaneTree {
  root: PaneNode;
  focusedPath: PanePath;
}

export interface Tab {
  id: TabId;
  title: string;
  shell: ShellKind; // tab 内所有 session 的默认 shell; reconnect 也用它
}

export type TabId = number;
```

**不可变操作**（返回新 tree，调用方替换 state）：

- `findPath(node, sessionId) → PanePath | null` — 定位 leaf
- `findFocusedLeaf(tree) → PaneNode` — 拿焦点节点(init / leaf / split)
- `splitLeaf(tree, sessionId, axis: "h" | "v", newSessionId, newShell) → PaneTree`
- `closeLeaf(tree, sessionId) → PaneTree` — 删 leaf,父 split 坍缩为兄弟;根删完返回 init node
- `focusLeaf(tree, sessionId) → PaneTree` — 更新 focusedPath
- `markLeafDead(tree, sessionId) → PaneTree` — 设 status="dead"
- `replaceLeafSession(tree, oldSessionId, newSessionId) → PaneTree` — reconnect 用
- `initToLeaf(tree, sessionId) → PaneTree` — PaneInitCard 触发后,把 init 节点换成 leaf
- `collectSessions(node) → SessionId[]` — 遍历所有 leaf
- `createStartTree(shell) → PaneTree` — 工厂:单 init 节点

**Tab 状态**（L5 hook 持有，不在 L3）：

- `tabs: Tab[]`
- `activeTabId: TabId`
- `treesByTabId: Map<TabId, PaneTree>`

L3 不知道有"tab"的概念——它只管一棵树。Tab 是 L5 在 PaneTree 之上加的命名空间。

## 5. 跨层契约变化

### 5.1 IPC 命令（M1 → M2 增量）

| 命令              | M1                                  | M2                            |
| ----------------- | ----------------------------------- | ----------------------------- |
| `spawn_terminal`  | `{rows, cols, shell}` → `SessionId` | 不变                          |
| `write_terminal`  | `{id, data}`                        | 不变                          |
| `resize_terminal` | `{id, rows, cols}`                  | 不变                          |
| `close_session`   | —                                   | _新增_ `{id}` → `()`          |
| `list_sessions`   | —                                   | _新增_ `()` → `SessionInfo[]` |
| `shell_list`      | —                                   | M5                            |

### 5.2 事件载荷（M1 → M2 wire format 升级）

| 事件            | M1                     | M2                                   |
| --------------- | ---------------------- | ------------------------------------ |
| `terminal-data` | `Vec<u8>` (`number[]`) | **`{ id: number, data: number[] }`** |
| `terminal-exit` | —                      | _新增_ `{ id: number }`              |

> **破坏性变更**：M1 的 `onTerminalData(handler: (data: number[]) => void)` 升级为 `onTerminalData(handler: (e: { id, data }) => void)`。M2 一次性切换,无向后兼容(单 app,无外部 consumer)。

### 5.3 镜像类型

L1 `events::TerminalDataPayload` 由 `Vec<u8>` 升级到结构体:

```rust
#[derive(Serialize, Clone)]
pub struct TerminalDataPayload {
    pub id: SessionId,
    pub data: Vec<u8>,
}
```

L2 `services/types.ts` 镜像:

```typescript
export interface TerminalDataPayload {
  id: SessionId;
  data: number[];
  [key: string]: unknown;
}
```

## 6. 文件级变更

### 6.1 Rust（src-tauri/src/）

**新增**:

- `commands/session.rs` — `close_session({id})`、`list_sessions() → Vec<SessionInfo>`
- (M1 已存在的) `events.rs` 加 `TERMINAL_EXIT` 常量 + `TerminalExitPayload`

**修改**:

- `events.rs` — `TerminalDataPayload` 从 `Vec<u8>` 改结构体
- `lib.rs` — 注册两个新 command;`start_dispatch` 的 `Data` 分支 emit `{id, data}`;`Exit` 分支 emit `terminal-exit`
- `state.rs` — 不变
- `commands/{spawn,write,resize}.rs` — 不变

**未动**:

- `core/`, `error.rs`, `commands/{spawn,write,resize}.rs`

### 6.2 TS（src/）

**新增**:

- `domain/pane.ts` — `PaneNode` / `PaneTree` / `PanePath` / `Tab` / 操作函数
- `services/session.ts` — `closeSession`、`listSessions`、`onSessionExit`
- `hooks/usePaneTree.ts` — tab + tree 状态、reducer、与 L2 协调
- `components/TabBar.tsx` — tab 条 + 新建 / 关闭按钮
- `components/SplitContainer.tsx` — 递归渲染 `PaneNode`
- `components/PaneChrome.tsx` — 单 leaf 容器:标题条 + split 按钮 + 关闭按钮 + TerminalView

**修改**:

- `services/types.ts` — `TerminalDataPayload` 升级;新增 `TerminalExitPayload`、`CloseSessionRequest`、`ListSessionsResponse`
- `services/pty.ts` — `onTerminalData` 回调签名变 `({id, data})`
- `hooks/useTerminalSession.ts` — 接 `{id, data}` 形状(本 hook 只关心自己 session 的 data,id 应等于 hook 拿到的 sessionId,可断言);加 `onExit` 选项
- `lib/xterm/useFit.ts` — 加 `ResizeObserver`(per-pane 自适应,M1 只看 window)
- `components/Terminal.tsx` — 弃用,改名为 PaneChrome 或者保持文件名(本任务不动文件名,直接瘦身为 PaneChrome 内容)
- `App.tsx` — 改为 `<TabBar /> + <SplitContainer tree={activeTree} />`

**未动**:

- `domain/shell.ts`, `domain/session.ts`
- `lib/xterm/{theme,xterm,useXterm,useXtermTheme}.tsx`

### 6.3 文件树（M2 末态）

```
src-tauri/src/
  commands/
    mod.rs              (+session)
    spawn.rs            (未动)
    write.rs            (未动)
    resize.rs           (未动)
    session.rs          (新)
  core/                 (未动)
  events.rs             (TERMINAL_DATA payload 升级 + TERMINAL_EXIT)
  state.rs              (未动)
  error.rs              (未动)
  lib.rs                (≤ 100 行;register 2 new commands;dispatch 升级)

src/
  components/
    Terminal.tsx        (瘦身;PaneChrome 内容;或者新建 PaneChrome.tsx 替换)
    TabBar.tsx          (新)
    SplitContainer.tsx  (新)
    PaneChrome.tsx      (新,可选;见 §4 决策 Q1)
  domain/
    shell.ts            (未动)
    session.ts          (未动)
    pane.ts             (新)
  services/
    pty.ts              (onTerminalData 签名升级)
    session.ts          (新)
    types.ts            (TerminalDataPayload 升级 + 3 新类型)
  hooks/
    useTerminalSession.ts (适配新 payload + onExit)
    usePaneTree.ts      (新)
  lib/xterm/            (未动;useFit.ts 内部加 ResizeObserver)
```

## 7. 关键设计问题（待拍板）

我先抛 4 个影响实现的问题。我倾向项已标 **(R)**，按 (R) 走就开干。

### Q1. 关闭 pane 时如果父 split 只有一个 leaf 兄弟,父 split 怎么办?

- **(R) 坍缩到兄弟** — 父 split 被替换为那个 leaf,树深减小一层。符合用户直觉(关掉一边另一边变大)。
- 不坍缩 — 父 split 仍然在,留一个"empty pane"占位。需要在 L3 加 `Empty` 节点或 `null`,增加复杂度。

### Q2. 关闭最后一个 tab 时怎么办?

- **(R) 自动新建一个空 tab**(带一个新 session) — 用户可以继续工作,关 app 时再退。
- 退出 app — 把"关 tab"和"关 app"混在一起,语义不清。
- 留空(0 个 tab,空白屏) — 视觉上有问题,且用户没法新建除非有快捷键。

### Q3. 进程退出(PTY die)时 pane 怎么办?

- **(R) 保留 pane,显示 "Process exited" banner**,用户必须手动关闭。安全:用户能看错误输出再决定。
- 自动关闭 pane — 简单,但用户看不到错误就 pane 没了。
- 标记 + 灰显 +30s 后自动关 — 增加状态机复杂度,M2 不上。

### Q4. SplitContainer 接收 `PaneNode` 还是 `PaneTree`?

- **(R) `PaneTree`** — 容器知道 focused leaf,渲染时给焦点 leaf 加视觉边框。其他 leaf 不知道焦点,跟 L3 概念对齐。
- `PaneNode` — 更纯粹,但要 prop drill `focusedPath` 进来。

> 还有一个我**默认决定**的(没列出来问),需要你 push back 否则我按这个走:
>
> - **Tab 标题硬编码 `"Tab N"`**。M5 Settings 加 shell 后再说。理由:tab 标题需要 cwd 而非 shell 命令,cwd 需要读 process 状态,M2 不做。
> - **Split 比例固定 0.5**。拖拽是 M3 chrome 增强。
> - **新建 tab 自动 spawn 一个 session**。空 tab 没意义,反正 spawn 很轻。

## 8. 风险

| 风险                                               | 影响                                              | 对策                                                                          |
| -------------------------------------------------- | ------------------------------------------------- | ----------------------------------------------------------------------------- |
| 跨 pane 的 `{id, data}` dispatch 错位              | 输入错乱 / 错 pane 收到                           | L5 严格按 `event.id === sessionId` 过滤,只把数据喂给对应 xterm                |
| tab 切换时旧 xterm 没 dispose                      | 内存泄漏                                          | PaneChrome 在 unmount 时调 `xterm.dispose()`(已有)+ `closeSession(id)`(M2 加) |
| 父 split 坍缩逻辑写错                              | close 后 tree 形状不对                            | `collectSessions` 单测覆盖(本里程碑不写测试,靠人肉 review + grep)             |
| L1 dispatch emit 漏 `id`                           | 所有 pane 收到同一个数据                          | emit payload 用 `TerminalDataPayload { id, data }` 结构体,不是 tuple          |
| 关闭 tab 时 session 漏 close                       | 僵尸进程                                          | closeTab 遍历所有 leaf,逐个 `closeSession`                                    |
| `SessionId` 进程内 u64 唯一性问题                  | u64 够用几百年,但 race condition 下 id 复用要小心 | spawn 时自增,drop 时不复用。Rust 端已经有这个保证                             |
| `ResizeObserver` 早期触发(尺寸为 0)导致 `fit()` 抛 | 启动时 xterm 不显示                               | `try { fitAddon.fit() } catch {}`(M1 已有)                                    |

## 9. 实施顺序

1. **Rust L0/L1 先**:`events.rs` 升级 → `commands/session.rs` 新增 → `lib.rs` 注册 + dispatch 升级 → `cargo check`
2. **TS L3 纯数据**:`domain/pane.ts` — 不依赖任何外部,先写,先看类型干净
3. **TS L2**:`services/types.ts` 升级 → `services/pty.ts` 升级 → `services/session.ts` 新增 → `tsc --noEmit`
4. **TS L5**:`useTerminalSession` 升级 → `usePaneTree` 新增 → `tsc --noEmit`
5. **TS L7**:`TabBar` + `SplitContainer` + `PaneChrome` → `App.tsx` 重写 → `npm run build`
6. **格式化**:`cargo fmt` + `prettier --write`
7. **手动 smoke**:Windows 侧 `npm run tauri dev`,验 V1–V9

## 10. 不在 M2 范围 (Out of Scope)

- Split 拖拽 / Tab 拖拽 / Tab 重新排序 (M3 chrome 增强)
- 持久化 / 重启恢复 (M4)
- 设置 / 主题 / 字体 (M5)
- `tauri-plugin-store` 接入 (M5,本里程碑 Cargo.toml 不动)
- 测试 (M2+ 再说,per D5)
- 焦点视觉指示 (默认加,但不强 polish;M3+ 一起做)

## 11. Definition of Done

- V1–V10 全过(V1–V9 在 Windows 侧 tauri dev 跑;V10 grep 验证)
- V11–V13 文件大小 + 构建验证
- L0/L1/L2 wire format 一致:grep `Vec<u8>` 在 events.rs 不再出现(改 `TerminalDataPayload` 结构体)
- L3 `domain/pane.ts` 单文件 ≤ 200 行(纯数据结构,不该膨胀)
- 关闭 tab / 关闭 app 时无僵尸 PowerShell 进程(Windows 任务管理器 / `Get-Process powershell` 验)
- 格式化 clean:`cargo fmt --check` + `prettier --check`

---

## 修订记录

| 日期 | 变更                                     |
| ---- | ---------------------------------------- |
| 初版 | M2 多会话蓝图:Tab + Split,PaneTree 在 L3 |
