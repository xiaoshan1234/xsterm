# doc/dev/design/ 子树设计评审整改计划

> **来源**:对 `doc/dev/design/` 121 份子文档的正式设计评审(2026-09-29)
> **范围**:**只动 `doc/dev/design/`** 内的文档,不动其他目录(architecture / adr / changelog / flows / roadmap / rules / design-system.md 等)
> **目标**:把 3 个 P0 + 5 个 P1 + 6 个 P2 整改为可进入开发的目标态
> **总工作量**:11 个文档整改项 + 1 个新 IPC 契约节

---

## 0. TL;DR

按 **2 个 sprint × 1 周** 排期,全部在 `doc/dev/design/` 范围内:

| Sprint | 周期 | 工作 | 阻塞项 |
|---|---|---|---|
| **S1 P0 阻塞** | Day 1-3 | P0-1 / P0-2 / P0-3 三处 doc-vs-doc 矛盾修复 | dev 不再按矛盾文档写出不可编译/绕开 bug 防御的代码 |
| **S2 P1 重要** | Day 4-7 | P1-1 ~ P1-5 内部一致性整改 | 子文档之间数字/接口/归属对齐,tm 验收有客观依据 |

P2-1 ~ P2-6 合并到对应 module 的 INTERFACE.md revision 时顺手修,不占独立 sprint。

---

## 1. sprint 1:P0 doc-vs-doc 矛盾修复(Day 1-3)

### T1.1 修 MCP DOWNSTREAM.md 的 Node API 矛盾(P0-1)

**Files**:
- Modify: `doc/dev/design/frontend/app/mcp/DOWNSTREAM.md`

**改动要点**:
- §1 第 9-10 行:删 `node:child_process` / `net (TCP listener)`,改为 "MCP server 跑在 Tauri WebView 内(单二进制,D-β = ADR 0002);stdio transport 通过 `MessageChannel` / postMessage 与 MCP client 通信;TCP transport 必须用浏览器原生 `WebSocket`,**没有** Node API"
- §2 第 36-37 行:删 `node:child_process` / `node:net` 两行;补 `WebSocket (浏览器原生)` 一行
- §7 第 96 行 grep 检查命令:`grep -rn 'from "@tauri-apps/api'` 保留,删所有 `node:*` 引用
- §10 第 141 行 `panic isolation by Node EventEmitter` → 改 `panic isolation by window.addEventListener('error') + try/catch`

**验收**:`grep -n 'node:' doc/dev/design/frontend/app/mcp/DOWNSTREAM.md` 返回空;`grep -n 'WebSocket' doc/dev/design/frontend/app/mcp/DOWNSTREAM.md` 至少 1 处

### T1.2 修 backend domain 字段访问性违反 bug 0009 防御(P0-2)

**Files**:
- Modify: `doc/dev/design/backend/domain/session/RESPONSIBILITY.md`
- Modify: `doc/dev/design/backend/domain/terminal/RESPONSIBILITY.md`

**改动要点**:
- `domain/session/RESPONSIBILITY.md` §8.1:`pub struct SessionManager { ... }` 字段全部改为 `pub(crate)`,并新增 `impl SessionManager { pub fn get_session(&self, id: u32) -> Option<Arc<ActiveSession>>; pub fn controller_for_pane(&self, pane_id: &str) -> Option<u32>; pub fn ssh_backend(&self) -> &Arc<dyn SshBackend>; pub fn pty_system(&self) -> &dyn PtySystem; pub fn tmux_controller(&self, controller_id: u32) -> Option<Arc<TmuxController>>; pub fn allocate_session_id(&self) -> u32; }` 公开方法块;§8.4 第 168 行 `Arc<dyn Fn() -> u32>` 描述改为 "通过 `SessionManager::allocate_session_id()` 闭包注入 controller"
- `domain/terminal/RESPONSIBILITY.md` §8.1:`pub(crate)` 字段改为私有,公开方法补 `pub fn pane_binding_for(&self, tmux_pane_id: &str) -> Option<u32>; pub fn window_binding_for(&self, tmux_window_id: &str) -> Option<u32>; pub fn initial_state(&self) -> Option<&TmuxInitialState>`(均返回引用,不允许外部 mutation)
- 两份文档 §8 末尾各加一行:"严格遵守 `doc/dev/design/backend/README.md §10.1 + §10.2` 字段直读防御,本 §8 字段表为内部可见性,跨 module 访问必须走公开方法"

**验收**:`grep -nE 'pub.*DashMap<|pub.*AtomicU32|pub.*HashMap<|pub.*Box<dyn' doc/dev/design/backend/domain/{session,terminal}/RESPONSIBILITY.md` 必须返回空(pub 字段不允许出现);两文档 §8 末尾均含 "严格遵守 backend/README §10" 字样

### T1.3 修 frontend persistence INTERFACE 与 RESPONSIBILITY 互斥(P0-3)

**Files**:
- Modify: `doc/dev/design/frontend/service/persistence/INTERFACE.md`
- Modify: `doc/dev/design/frontend/service/persistence/RESPONSIBILITY.md`

**改动要点**:
- `INTERFACE.md` §1 重写 `PersistenceService` 接口,新增 `config` 字段:
  ```typescript
  export interface PersistenceService {
    // ============ 单 key 读写(用于 sessions/groups/theme) ============
    get<T>(key: string): Promise<T | null>;
    set<T>(key: string, value: T): Promise<void>;
    delete(key: string): Promise<void>;
    has(key: string): Promise<boolean>;
    getMany<T>(keys: ReadonlyArray<string>): Promise<Record<string, T | null>>;
    setMany(entries: Record<string, unknown>): Promise<void>;
    flush(): Promise<void>;
    registerMigration(migration: Migration): void;
    runMigrations(): Promise<void>;

    // ============ v5.1 新增:config 子模块(settings 走 backend config.toml) ============
    config: {
      read(): Promise<AppConfig>;
      write(partial: PartialAppConfig): Promise<AppConfig>;
      onReloaded(cb: (config: AppConfig) => void): () => void;  // 返回 unsubscribe
    };
  }
  ```
- §4 重写示例:删 `await persistence.get<Settings>("settings")` 与 `registerMigration({ storeKey: "settings", ... })`;改为 `await persistence.config.write({ keybindings: {...} }); const off = persistence.config.onReloaded((c) => { ... })`
- `RESPONSIBILITY.md` §3 末尾加一行反向引用:"本 module INTERFACE 接口契约见 `INTERFACE.md §1`;v5.1 后 `config` 子模块为 settings 改写唯一通道"

**验收**:`grep -n 'config:' doc/dev/design/frontend/service/persistence/INTERFACE.md` 至少 1 处;`grep -n 'storeKey: "settings"' doc/dev/design/frontend/service/persistence/INTERFACE.md` 返回空

---

## 2. sprint 2:P1 内部一致性整改(Day 4-7)

### T2.1 统一 backend IPC 数量与子结构(P1-1)

**Files**:
- Modify: `doc/dev/design/backend/commands/terminal/RESPONSIBILITY.md` §3
- Modify: `doc/dev/design/backend/README.md`(虽然在 doc/dev/design 之外但需同步;若不允许改则改 `doc/dev/design/backend/README.md` 同名文件)

**改动要点**:
- `commands/terminal/RESPONSIBILITY.md` §3 子结构补:
  ```
  commands/tmux/auto_attach.rs        auto_attach_tmux_servers
  ```
  并在 §1.0 IPC 表里 §1.1 第 4 项 `auto_attach_tmux_servers` 旁加注释:"独立成 `commands/tmux/auto_attach.rs`"
- §2 第 22 行 `15 个 #[tauri::command]` 不变;在 §3 子结构表头加 `合计:15 个 IPC,4 个子文件(session / pane / window / server) + 1 个独立 auto_attach`
- backend README §1.0 IPC 表:`terminal: 13` 改为 `terminal: 15`,小计从 `31` 改为 `33`

**验收**:`grep -n 'auto_attach.rs' doc/dev/design/backend/commands/terminal/RESPONSIBILITY.md` 至少 1 处;`grep -n '15 个' doc/dev/design/backend/commands/terminal/RESPONSIBILITY.md` 至少 1 处

### T2.2 合并 domain/terminal 的 `state.rs` 与 `controller/mod.rs` 二选一(P1-2)

**Files**:
- Modify: `doc/dev/design/backend/domain/terminal/RESPONSIBILITY.md` §3 / §4

**改动要点**:
- §3 子结构表:`state.rs` 一行删除;`controller/mod.rs` 注释改为 "TmuxController struct 定义 + impl + 共享 helper(单一文件,无 state.rs)"
- §3 `api.rs` 描述改为 "facade re-export controller 公开方法,供 tests 用 + 跨 module 通过 SessionManager 代理(不直接被 commands 调)"
- §4 文件迁移表:删 `services/tmux/state.rs` 不存在的引用;第 81 行 "controller/mod.rs(TmuxController struct) → domain/terminal/controller/mod.rs" 不再拆分

**验收**:`grep -n 'state.rs' doc/dev/design/backend/domain/terminal/RESPONSIBILITY.md` 返回空(目标:不引入 state.rs)

### T2.3 补 MCP AI attach backend IPC 落地(P1-3)

**Files**:
- Modify: `doc/dev/design/backend/commands/session/RESPONSIBILITY.md` §1 / §3 / §5
- Modify: `doc/dev/design/backend/domain/session/RESPONSIBILITY.md` §1.1 / §8.1 / §8.6

**改动要点**:
- `commands/session/RESPONSIBILITY.md` §1 IPC 清单第 10 项后补 3 个:
  ```
  - `set_mcp_attach` —— MCP attach 状态登记(session_id + client_id)
  - `clear_mcp_attach` —— MCP attach 释放
  - `list_mcp_attached` —— 列当前被 MCP attach 的 session(给 list_sessions 拼字段)
  ```
  并更新合计:"10 + 3 = 13 个 #[tauri::command]"
- §3 子结构补 `attach.rs` 文件;§5 关系表加 `domain::session::mcp_attachments`(新增字段)
- `domain/session/RESPONSIBILITY.md` §1.1 状态机层第 6 项后补第 7 项:"MCP attach 注册表——`mcp_attachments: DashMap<u32, String>`(session_id → client_id)";§8.1 SessionManager 字段表加这一行;§8.6 在 `start_session_logging` 同层新增一段:`write_session` 前置 `if state.is_attached_by_mcp(session_id) { tracing::warn!("blocked user keystroke for mcp-attached session"); return Err(SessionError::McpAttachBlocked); }`(对应 §P1-3 风险)

**验收**:`grep -n 'set_mcp_attach\|clear_mcp_attach\|is_attached_by_mcp' doc/dev/design/backend/commands/session/RESPONSIBILITY.md doc/dev/design/backend/domain/session/RESPONSIBILITY.md` 至少各 2 处

### T2.4 model/workspace paneTree 重复声明 + ui/terminal model.ts 死代码(P1-4)

**Files**:
- Modify: `doc/dev/design/frontend/model/workspace/RESPONSIBILITY.md` §1
- Modify: `doc/dev/design/frontend/ui/terminal/RESPONSIBILITY.md` §3 / §5

**改动要点**:
- `model/workspace/RESPONSIBILITY.md` §1 删第 6 项 "paneTree 算法——跨域使用的核心算法"(与第 5 项重复);§1 重新编号为 5 项
- `ui/terminal/RESPONSIBILITY.md` §3 子结构删 `model.ts` 一行;§5 关系表增一行:
  ```
  | `model/workspace` | terminal 通过 `import { PaneNode, SplitDirection } from '@/model/workspace/types'` 拿 pane 类型;不重复定义 |
  ```

**验收**:`grep -n 'paneTree' doc/dev/design/frontend/model/workspace/RESPONSIBILITY.md` 只出现 1 次(§1 第 5 项);`grep -n 'model.ts' doc/dev/design/frontend/ui/terminal/RESPONSIBILITY.md` 返回空

### T2.5 session_log 归属二选一(P1-5)

**Files**:
- Modify: `doc/dev/design/backend/commands/session/RESPONSIBILITY.md` §3
- Modify: `doc/dev/design/backend/commands/shell/RESPONSIBILITY.md` §5
- Modify: `doc/dev/design/backend/domain/session/RESPONSIBILITY.md` §3

**改动要点**(采纳"session_log 归 commands/session"):
- `commands/session/RESPONSIBILITY.md` §3 子结构补 `log.rs` 文件(`start_session_logging_session` IPC 入口)
- `commands/shell/RESPONSIBILITY.md` §5 关系表第 4 行 `domain::session::log` 改为 `commands/session/api.rs::start_session_logging_session`(通过 session module api 调)
- `domain/session/RESPONSIBILITY.md` §3 子结构 `log.rs` 一行删除;§1.1 状态机层第 5 项 `session 日志——session 创建时 start_session_logging` 删 "日志" 二字(日志编排归 commands/session)

**验收**:`grep -n 'domain::session::log\|domain/session/log' doc/dev/design/backend/` 返回空;`grep -n 'start_session_logging_session' doc/dev/design/backend/commands/session/RESPONSIBILITY.md` 至少 1 处

---

## 3. P2 优化项(随对应 module INTERFACE 修订一并修)

| ID | 改动文件 | 改动要点 |
|---|---|---|
| P2-1 | `doc/dev/design/frontend/infra/tauri/RESPONSIBILITY.md` | §9 章节序号重排;§9 "Repository 契约" + §9 "commands vs events 分离" 合并为同一节的子标题 |
| P2-2 | `doc/dev/design/frontend/app/mcp/RESPONSIBILITY.md` | §1.3 整段删(已在 §4 数据流图);§1.4 简化为 1 段 |
| P2-3 | `doc/dev/design/backend/domain/session/RESPONSIBILITY.md` | §8.5 补 `SessionStatus::LoggingDegraded` enum 变体 + UI 警告语义 |
| P2-4 | `doc/dev/design/frontend/app/terminal/INTERFACE.md` | §2 增 `applyPreferences(patch: Partial<TerminalPreferences>)` 方法(若已存在则跳过) |
| P2-5 | `doc/dev/design/frontend/infra/tauri/RESPONSIBILITY.md` | §6 加例外条款:`service/persistence.config` 子模块直接调 `invoke('read_config' / 'write_config')`——backend 直连 IPC,不走 Repository 抽象 |
| P2-6 | `doc/dev/design/backend/domain/terminal/RESPONSIBILITY.md` | §3 `state.rs` 行(P1-2 已删);§4 同步删 `services/tmux/state.rs` 引用 |

---

## 4. 验证计划

每个 task 完成后跑 grep 验收(命令已写在每个 task 末尾)。

Sprint 收尾跑 cross-doc 一致性 grep:
```bash
# P0-1 验收:无 Node API
grep -rn 'node:\|node\b.*API' doc/dev/design/frontend/app/mcp/ --include='*.md'

# P0-2 验收:domain 字段无 pub
grep -rnE 'pub.*DashMap<|pub.*AtomicU32|pub.*HashMap<' doc/dev/design/backend/domain/

# P0-3 验收:persistence INTERFACE 含 config 子模块
grep -n 'config:' doc/dev/design/frontend/service/persistence/INTERFACE.md

# P1-3 验收:set_mcp_attach 出现
grep -rn 'set_mcp_attach\|is_attached_by_mcp' doc/dev/design/backend/

# P1-5 验收:session_log 归 commands/session 而非 domain/session
grep -rn 'domain::session::log\|domain/session/log' doc/dev/design/backend/
```

---

## 5. 不做什么(明确范围边界)

- **不动** `doc/dev/design/` 之外的任何文件(包括整库评审已落地的 `doc/dev/roadmap/design-review-remediation-plan.md`、`doc/dev/adr/`、`doc/dev/architecture/`、`doc/dev/changelog/` 等)
- **不改任何代码**(`src/` / `src-tauri/src/` 全部不动)
- **不改 ADR**(若 P0-2 整改需要 ADR 引用,直接在文档里 inline 引用 `backend/README §10.1+§10.2`,不开新 ADR)
- **不改测试**(Vitest / cargo test 都不动)
- **不实施代码落地**——本 plan 只改文档,代码走后续 PR 切片
- **不复述/重写整库评审已落地的 plan**——本次评审增量独立

---

## 6. 完成判据

**Sprint 1 完成**:3 个 P0 doc-vs-doc 矛盾 grep 验收命令全部返回空;改动文件路径与 T1.1 / T1.2 / T1.3 一致

**Sprint 2 完成**:5 个 P1 整改全部 grep 验收通过;`doc/dev/design/backend/` 与 `doc/dev/design/frontend/` 内部一致(IPC 数量统一、字段访问性统一、归属声明统一)

**P2 完成**:6 条 P2 优化项合并到对应 module revision 时落地,不占独立 sprint

**整体完成 = 本次评审问题清单全部关闭 = `doc/dev/design/` 进入"开发就绪"**。
