# tm 接手验收指南（Handoff to TM）

> **本文档给 tm**：对照本文逐项验收，无需再翻其他入口。
>
> **生成时间**：2026-09-11 文档重组后。
>
> **代码状态**：xsterm 0.1.3 → 0.1.4-rc（tmux -CC P1-P5 重构已落地，Bug 1 修复已上线，SSH probe 已上线）。

---

## 0. tm 10 分钟入门

回答这 4 个问题：

1. **xsterm 是什么**？Tauri 2 桌面终端模拟器，Rust 后端 + React 前端 + xterm.js 渲染。
2. **最近在干什么**？把 tmux -CC 子系统从 3622 行 monolith 拆到分层模块（controller/{mod,id_map,handshake,subscriber}.rs），并修了 tmux 启动 handshake 的 18 个连续 bug。
3. **目前在哪**？P1-P5 已落地；P6（错误模型）+ P7（bridge 层）+ P8（删旧路径）待做；P9（本文档同步）已完成。
4. **6 个月内做什么**？MCP server + toml 配置 + 反向 SSH tunnel + Microsoft Store 打包。详见 `roadmap/target-architecture.md` + `roadmap/migration-prs.md`。

完整项目结构 → `doc/README.md`（一个文件，5 层职责）。

---

## 1. tm 该看哪些文件（按优先级）

| 必读 | 可选 |
|---|---|
| `doc/README.md` | — |
| `roadmap/target-architecture.md`（演进终态） | `roadmap/gap-analysis.md`（缺口）|
| `roadmap/migration-prs.md`（PR 切片 + 自测标准）| `architecture/overview.md`（当前代码）|
| `adr/0005-tmux-redesign-v0.md`（tmux 重设计）| `changelog/perf.md`（性能 ROI）|
| `changelog/bugs.md`（最近踩过的坑）| `adr/legacy-rfcs/0001-0004.md`（旧 RFC）|
| `doc/design-system.md`（仅在验收 UI PR 时）| — |

**已废弃**——只在 dev 主动给 tm 链接时看：`history/prd-0.1-requirements/`、`history/prd-0.1-arch-snapshot/`、`history/external/ai-terminal-spec/`。

---

## 2. tm 该验证什么（按状态）

### 2.1 已完成（YES = ✅，不需重复验）

| 验证项 | 验证方法 | 期望 |
|---|---|---|
| 307 个 Rust 单元测试 | `cargo test --manifest-path src-tauri/Cargo.toml --lib` | `307 passed; 0 failed` |
| TS 类型检查 | `npx tsc --noEmit` | 无输出（无 error）|
| 22 个 bug 全部修过 | `changelog/bugs.md` grep `是否解决: YES` | 22/22 YES |
| tmux P1-P5 重构 | `git log --grep="tmux-redesign\|P[1-5]"` | 看到 P1-P5 相关 commit |
| Bug 1 修复（每回新增 window） | `grep -n "SpawnMode\|new-window\|list-panes" src-tauri/src/services/tmux/controller/mod.rs` | 看到 `if mode == SpawnMode::Create` 分支 |
| SSH probe 已支持 | `grep -n "probe_tmux_session_exists" src-tauri/src/commands/session.rs` | 看到 Tauri command + session_manager 实现 |

### 2.2 待 dev 测试（tm 不验，只读代码确认逻辑存在）

| 项 | 验证方法 |
|---|---|
| PR-T4 handshake v2 路径 | `git show` PR-T4 提交（如果已存在）+ 单元测试 `cargo test handshake` |
| PR-T5 RouterState 接入 | `controller/subscriber.rs` 文件存在 + 9 个测试通过 |
| SSH probe 真实路径 | dev 手动 SSH 跑 `probe_tmux_session_exists` 一次 |

### 2.3 待做（tm 不该有预期）

- **P6**：`errors.rs` + `From<TmuxError> for String`（尚未提交）
- **P7**：`bridge/` 层独立（尚未提交）
- **P8**：删 v1 路径（**等 2 周观察期**——tm 此时不验）
- **MCP server**（M3）：tm 等 PR-T9+ 才看

---

## 3. tm 验收 PR 的标准 checklist

每个 PR 合并前 tm 验：

- [ ] PR 自测标准全跑通（见 `roadmap/migration-prs.md` 每个 PR 的"自测标准"段）
- [ ] `cargo test --manifest-path src-tauri/Cargo.toml --lib` 全过
- [ ] `npx tsc --noEmit` 全过
- [ ] `git grep -n "TODO\|FIXME\|XXX"` 不增加
- [ ] 如果改 UI：`doc/design-system.md` §"Pre-commit verification" 三条 grep 全过
- [ ] 如果加新 Tauri command：capability JSON 同步加（AGENTS.md §"Important Gotchas"）
- [ ] 如果修 bug：`changelog/bugs.md` 加 entry，`是否解决: YES`
- [ ] 如果改协议层（protocol/ 子模块）：保持 `ProtocolEvent` 类型稳定（PR-T5 已加 alias `ControlEvent`）

---

## 4. tm 该拍板什么

按 `adr/` 流程：任何"代码长什么样 vs 该长什么样"的决定，先 RFC，再 PR 落地。当前待拍板：

| 主题 | 阻塞什么 | 决策要求 |
|---|---|---|
| M3 toml 配置迁移 | M3 W10-12 PR 阻塞 | 拍 schema 字段 + 30 天回退策略 |
| M4 反向 SSH tunnel | M4 W13-15 PR 阻塞 | 拍默认端口 + 远端白名单 |
| M5 Store 上架 | M5 W16-17 PR 阻塞 | 拍应用名 / 图标 / 隐私政策 URL |
| M6 i18n + a11y | M6 W18-19 PR 阻塞 | 拍 i18next 框架 + 哪些组件必须 a11y |

拍板流程见 `adr/README.md` §"怎么写新 ADR"。

---

## 5. tm 该拒绝什么

PR 提上来 tm 看：

- ❌ 改 P1-P5 拆分的 controller 子模块结构 → 拒绝（除非对应 ADR 已经拍）
- ❌ 直接用 `Box<dyn SshBackend>` 替代 `Arc<dyn SshBackend>`（SSH probe 改造教训）→ 拒绝
- ❌ `protocol/` 子模块新增公共 API 不带 deprecation 兼容旧路径 → 拒绝（破坏 PR-T1 的 shim 设计）
- ❌ 删 `changelog/bugs.md` 历史 entry（即使 bug 早已解决）→ 拒绝
- ❌ 改 `tmux` 子系统的 5 层 fallthrough dispatch（`dispatch.rs:79` 起）→ **要求走 PR-T5 RouterState 路径**，不允许直接打补丁

---

## 6. tm 出问题怎么办

| 问题 | 怎么办 |
|---|---|
| 不知道某概念是什么 | 看 `architecture/overview.md` §5.1（tmux 概念层级） |
| 不知道某决策为什么这样选 | 看 `adr/` 对应 ADR |
| 不知道历史上为什么这样 | 看 `history/`（带 banner，不要直接引用）|
| 不知道 PR 切片 | 看 `roadmap/migration-prs.md` |
| 跑不通 cargo test | 先 `cargo check` 隔离编译错误；再看 `changelog/bugs.md` 最近 5 个 bug 是不是回归 |

---

## 7. tm 不该做的事

- ❌ 改 doc/dev/architecture/overview.md（dev 改，tm 拍板）
- ❌ 改 doc/dev/adr/*（拍板后由 dev 加新 ADR）
- ❌ 改 doc/dev/roadmap/*（dev 在 PR 里更新进度）
- ❌ 改 doc/dev/changelog/*（dev 在 PR 里加 entry）
- ❌ 在 PR 里"顺手"删 `history/` 内容（保持历史快照，1 周评审期后再删）

---

## 8. 反馈渠道

- tm 给 dev：直接编辑本文件（`doc/dev/history/00-ai-terminal-migration-handoff.md` 不——那是已归档）→ 编辑 `doc/README.md` §"按场景找文档"
- tm 给 pdm：开 ADR（`doc/dev/adr/README.md` 模板）
- tm 给用户：转 dev（dev 不直接面对用户）

---

**如果只剩 1 小时给 tm 验收**——按顺序读：

1. `doc/README.md`（5 min）
2. `roadmap/target-architecture.md` §0 决策 + §6 风险（10 min）
3. `roadmap/migration-prs.md` §0 战略决策 + §1–§5 各 PR 状态（15 min）
4. `architecture/overview.md` §5（tmux 子系统，15 min）
5. 跑 `cargo test --manifest-path src-tauri/Cargo.toml --lib`（1 min）
6. 跑 `npx tsc --noEmit`（1 min）
7. `changelog/bugs.md` 扫最近 5 个 bug（10 min）
8. 任选 PR 跑一次端到端验收（30 min）

总计约 90 分钟达到"能拍板 PR 验收"的水平。
