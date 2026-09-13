# P8: 删 v1 路径 (dispatch.rs 5 层 fallthrough + controller 7 个 pending_* 字段)

> **状态：Accepted（已落地 2026-09-13）** —— 4 个原子 commit 在 `dev` 上：
> - `ac213c8` W1 (P5') — RouterState API 升级到 `(event, registry, bridge, controller)`
> - `81bc0cf` W2 — `capture_pane` 走 `CommandRegistry`，dispatch 命令响应路径走 registry
> - `f1b36cc` W3a — `RouterState::process` 接管 `dispatch_event` 命令响应路径，删除 3 个 dead 字段
> - `fd5d322` W3b — 新增 `event_waiters` 机制，`split_pane` / `new_window` / bootstrap 走 registry，删除最后 4 个 `pending_*` 字段 + `PendingWindow` 结构
>
> **实施 note**：本 ADR §6 写"❌ 不要在 dev 真实环境验证 P1-P7 之前做 P8"，但用户拍板选 B（一次完整 P8），风险由用户接受。
>
> 风险评估（原 v0）：P5 RouterState 当前**只返回 action 枚举**，不直接 emit bridge 事件——P7 bridge 改造时**绕过了** RouterState——这意味着 P5 在 P7 后**实际没用**（只剩 9 个测试）。P8 真正工作是**重做 P5 让它接 bridge + 删 v1 字段**——本质是 P5 的 v2 升级。

## 1. 现状盘点

### 1.1 v1 路径仍在工作（占 945 行 dispatch.rs + 7 个 controller 字段）

**`controller/mod.rs` 7 个 pending_* 字段**：
- `pending_splits: VecDeque<oneshot::Sender<SplitResult>>`
- `pending_windows: VecDeque<oneshot::Sender<NewWindowResult>>`
- `pending_window_pane: HashMap<String, PendingWindow>` (sender field)
- `pending_capture: Option<oneshot::Sender<CaptureResult>>`
- `pending_capture_body: Vec<String>`
- `current_command_id: Option<u32>`
- `current_command_lines: Vec<String>`

**`dispatch.rs` ~945 行** 5 层 fallthrough match:
- `Output` (pane output)
- `SessionChanged` / `SessionWindowChanged` / `WindowPaneChanged` / `WindowAdd` / `WindowClose` / `WindowRenamed` / `PaneExited` / `Pause` / `Continue` / `Exit`
- `WindowList` / `PaneList` (command responses)
- `CommandBegin` / `CommandOutput` / `CommandEnd` / `CommandError`

### 1.2 v2 路径已建好但**没接管**（P3-P7 留下的只是框架）

| 模块 | 文件 | 状态 |
|---|---|---|
| `protocol/command.rs` | `TaggedCommand` / `ResponseWaiter` / `ResponseOutcome` | **已实现**（P3）|
| `controller/id_map.rs` | `CommandRegistry` (oneshot 路由) | **已实现**（P3）|
| `controller/handshake.rs` | v2 握手 plan | **已实现**（P4）—— 实际**未接** |
| `controller/subscriber.rs` | `RouterState.process()` | **已实现**（P5）—— 实际**未接 dispatch_event** |
| `bridge/mod.rs` | `TmuxBridge` 11 个 emit | **已实现**（P7）—— **直接被 dispatch_event 调用**（绕过 RouterState）|

**核心矛盾**：P5 RouterState 设计返回 `RouterAction`（让 caller 执行），但 P7 bridge 让 `dispatch_event` 直接发 emit——**P5 路径实际被绕开**。

### 1.3 测试 32+ 个针对 v1 路径

- `dispatch_emits_pane_added_and_records_first_pane`
- `split_pane_resolves_when_dispatch_sees_window_pane_changed`
- `dispatch_resolves_new_window_via_window_add_then_pane_changed`
- `dispatch_handles_bootstrap_window_without_pending_sender`
- 等 32+ 个

## 2. P8 真正范围（修正版）

### 2.1 必须重做 P5 RouterState（"P5'")

**目标**：让 RouterState 接 bridge，process() 内部调 bridge.emit_xxx()，返回的 RouterAction 只表示"还应执行什么 side effect"（oneshot resolve / internal state update）。

```rust
// pseudo-code
impl RouterState {
    pub fn process(
        &mut self,
        event: &ProtocolEvent,
        registry: &CommandRegistry,
        bridge: &TmuxBridge,
        controller: &TmuxController,
    ) -> RouterAction {
        match event {
            CommandBegin { id, .. } => {
                self.in_flight = Some(InFlight { id: *id, lines: vec![] });
                RouterAction::Ignore
            }
            CommandOutput { id, line } => {
                if self.in_flight.map(|f| f.id) == Some(*id) {
                    self.in_flight.as_mut().unwrap().lines.push(line.clone());
                }
                RouterAction::BodyLine
            }
            CommandEnd { id, .. } => {
                let body = self.take_in_flight();
                let waiter = registry.take(*id);
                // Resolve waiter (push body to oneshot)
                // ...
                RouterAction::Resolve
            }
            // 通知事件（Output / WindowAdd / ...）：RouterState 跳过，由 dispatch_event 直接处理
            _ => RouterAction::DelegateToV1,  // ← P5' 新增：fallthrough 到 v1 路径
        }
    }
}
```

### 2.2 删 7 个 pending_* 字段（按 v0 spec 严格执行）

**替换路径**：

| 字段 | 替换为 | 影响面 |
|---|---|---|
| `pending_splits` | `Controller::send_split_command()` 调 `registry.register(SplitWindow, wire, Some(BeginEnd(tx)))` 返回 oneshot | 改 `split_pane` 方法 + 测试 |
| `pending_windows` | 同上 | 改 `new_window` 方法 + 测试 |
| `pending_window_pane` (sender) | 同上 | 改 dispatch 处理 new_window |
| `pending_capture` | 同上 | 改 `capture_pane` 方法（已部分尝试） |
| `pending_capture_body` | `RouterState.in_flight.lines`（已有 P5） | 改 dispatch |
| `current_command_id` | `RouterState.in_flight.id`（已有 P5） | 改 dispatch |
| `current_command_lines` | `RouterState.in_flight.lines`（已有 P5） | 改 dispatch |

### 2.3 改 4 个公开方法

`capture_pane` / `split_pane` / `new_window` / `await_first_pane`——内部从"读写字段"改"通过 registry 路由"。

### 2.4 改 dispatch_event 5 层 fallthrough

- **通知事件（20+）** —— 仍直接处理（用 bridge.emit_xxx）
- **命令响应（4 个）** —— 调 `RouterState.process(event, registry, bridge, controller)` + 处理 `RouterAction`

## 3. 工作量估算

| 阶段 | 改动行数 | 风险 |
|---|---|---|
| 2.1 P5' (RouterState 升级) | ~200 行 | 高——API breaking |
| 2.2 删 7 字段 | ~50 行删除 + ~30 行替换 | 中——所有 fixture |
| 2.3 改 4 公开方法 | ~150 行 | 中——逻辑等价性测试 |
| 2.4 改 dispatch_event | ~300 行（945 → 200） | 高——5 层逻辑保留/重写 |
| 测试更新 | ~30 处 | 中——字段断言需重写 |
| **总计** | **~750 行 跨 6-8 文件** | **~2-3 倍 单 PR 工作量** |

## 4. 风险与约束

| 风险 | 缓解 |
|---|---|
| P5' 与现有 9 个 RouterState 单测不兼容 | 写新 RouterState 测试 + 旧测试重写为 dispatch 集成测试 |
| 32+ dispatch_event 测试有字段断言（`controller_id` / `parent_tmux_window_id`）需改 | 改 fixture 字段名匹配 P7 bridge 契约 |
| P5 RouterState 升级是 PR-T5 范围的 2 倍——不应混入 P8 | 单独 P5' PR（pre-P8） |
| 删 7 字段破坏 P5/P7 现有调用链 | 先把 P5'/dispatch 改造完成，**字段最后删** |
| 之前会话已到 iteration limit——P8 在单会话内难完成 | 拆 3 个 sub-PR（P5' / 改方法 / 删字段）|

## 5. 建议执行顺序（3 个独立 PR）

### PR-P5' (1-2 天)
- 重做 RouterState 接受 `registry` + `bridge` + `controller` 参数
- `process()` 返回 `RouterAction` 但**直接调** `bridge.emit_xxx()`（不返回 closure）
- 保留 v1 字段——只**新增** P5' 入口
- 跑通所有 313 测试 + 9 个 RouterState 单测

### PR-改公开方法 (半天)
- 4 个方法用 `CommandRegistry.register()` 路由
- `pending_splits` / `pending_windows` / `pending_capture` 字段**不再用**但仍存在
- 测试更新

### PR-删字段 + dispatch_event 重写 (1-2 天)
- 删 7 个字段
- dispatch_event 5 层 fallthrough 改 RouterState 接管命令响应 + 通知事件直发
- fixture 更新
- 全部测试通过

**P5' 单独 1 个 PR——不混入 P8**。

## 6. 不要做

- ❌ **不要在 dev 真实环境验证 P1-P7 之前做 P8**——P1-P5 还没经过任何手工测试
- ❌ **不要保留 v1 路径作 fallback**——v0 spec 明说要删
- ❌ **不要扩 RouterState 加多 buffer**——v0 spec §3.8 已明确"单 in-flight"够用
- ❌ **不要把 capture_pane 改一半**（之前会话状态）——必须 commit 或 revert

## 7. 决策点

- **A. 按此 3-PR 计划**——先 P5'，再改方法，最后删字段
- **B. 一次完整 P8**——风险大（之前会话已显示 perl 误插链）
- **C. 暂停 P8**——等 dev 真实环境验证 P1-P7 后重做
- **D. 回退 capture_pane 改动**——恢复 P7 完结状态

**推荐 A**——3 个独立 PR 每个可测可回退。
