# xsterm → ai-terminal：给 tm 的交接（Handoff to TM）

> **目的**：tm 接手验收的入口。先读这份再读三件套。

---

## 1. 交付物

三份文档 + 一组待拍板的决策点。位置：

```
doc/ai-terminal-migration/
├── 01-gap-analysis.md          # 缺口分析（xsterm 现状 vs ai-terminal 规格）
├── 02-target-architecture.md   # 目标架构（终态）
├── 03-migration-roadmap.md      # 迁移路线图（PR 切片 + 验收标准）
└── README.md                    # 本文件
```

---

## 2. 三件套读法

- **5 分钟**：读本文（README.md）→ 4 个决策点 + 7 个阶段总览
- **30 分钟**：读 01-gap-analysis.md §0（结论）+ §6（缺口优先级）+ §5（决策点）
- **60 分钟**：通读 02-target-architecture.md §1-§5
- **验收时**：对照 03-migration-roadmap.md 每个 PR 的"自测标准"

---

## 3. 4 个战略决策（已拍板）

dev 已经给推荐方案，pdm 已在 4 个 RFC 里签字：

| ID | 主题 | 决议 | RFC |
|---|---|---|---|
| **D-α** | tmux 实现路线 | **保留 xsterm -CC 全量实现**，对标 iTerm2 | [RFC 0001](../rfcs/0001-keep-tmux-cc.md) |
| **D-β** | MCP server 拆分 | **按需实现**：MVP 阶段单二进制 + 内部模块，未来再拆 | [RFC 0002](../rfcs/0002-mcp-single-binary.md) |
| **D-γ** | 配置格式 | **TOML 迁移**，30 天回退窗口保留 | [RFC 0003](../rfcs/0003-config-toml-migration.md) |
| **D-δ** | 产品命名 | **保留 xsterm 品牌**，对外宣传用 "AI Terminal" | [RFC 0004](../rfcs/0004-product-naming.md) |

**4 个 RFC 全部 Accepted**（pdm 签字 2026-09-11，dev / tm 待签）。M0 可以启动。

---

## 4. 7 个阶段总览

| 阶段 | 周 | 主题 | MVP 阻塞？ | dev 自测标准 |
|---|---|---|---|---|
| **M0** | W1–W2 | 工程化（CI / 文档 / RFC） | 否 | CI 全绿 + 4 个 RFC 拍板 |
| **M1** | W3–W5 | TUI 完整档 + WSL/Docker | 否 | vttest ≥ 90% + acceptance §A |
| **M2** | W6–W9 | **MCP server 核心**（M6/M7） | **是** | MCP 12 工具 + Claude Desktop 端到端 |
| **M3** | W10–W12 | 配置 toml + 自动更新 | 是 | 配置迁移无丢失 + 文档站上线 |
| **M4** | W13–W15 | 反向 SSH tunnel | 是 | 远端 agent 端到端 |
| **M5** | W16–W17 | Store 打包 + 签名 | 是 | Partner Center 审核通过 |
| **M6** | W18–W19 | 体验补齐（i18n / a11y / 性能）| 否 | 全部 acceptance P0 全绿 |
| **M7** | W20+ | 公测 + 修 bug | — | 0 P0 bug 跑 4 周 |

**累计**：4 个月到 MVP 上架。

---

## 5. tm 验收节奏

按 03-migration-roadmap.md 每个 PR 的 "自测标准" 验收；按 M0–M7 阶段拍板。

### 关键里程碑（每阶段结束必做）

| 里程碑 | 验收动作 | 通过标准 |
|---|---|---|
| M0 末 | 跑 CI；读 4 个 RFC | 4 个决策有 owner 签字；CI 跑 ≥3 次绿 |
| M1 末 | vttest 报告；WSL/Docker demo 视频 | vttest ≥ 90% |
| **M2 末** | **MCP 端到端 demo（Claude Desktop / Cursor / Codex 各 1 次）**| **12 工具全覆盖 + acceptance §B 全绿** |
| M3 末 | 配置迁移脚本测试 + 文档站 demo | 现有用户 0 数据丢失 |
| M4 末 | 跨机器反向隧道 demo | acceptance §B 反向隧道项绿 |
| **M5 末** | **Partner Center 审核结果** | **上架可下载** |
| M6 末 | i18n + a11y + 性能审计 | acceptance §H/I 全绿 |
| M7 末 | 公测报告 | 0 P0 bug 4 周 |

---

## 6. tm 重点关注（dev-handoff.md §tm 关注点）

dev-handoff.md 已经标注 tm 的重点。补充几条针对本次迁移：

1. **不要催 dev 跨阶段同时做两件事**——MCP 子进程调试本身很复杂，M2 阶段全给 MCP。
2. **每个 PR 必须有自测标准**——这是 dev-handoff.md 的硬要求；如果 PR 自测标准是空的，**拒绝合入**。
3. **RFC 72h 讨论窗口**——跨模块 PR（PR-202 IPC、PR-301 配置迁移、PR-401 tunnel）必须先 RFC。
4. **不要放过 "临时补丁"**——Bug 005 教训：临时窗口 → 真坑；要求 dev 给 root cause。
5. **bug.md 持续维护**——修任何 bug 必须更新 `doc/maintenance/bug.md`，沿用现有格式。

---

## 7. 跨 PR 风险

- **AGENTS.md 现有 gotcha 全部继承**（Tauri v2 capability / 版本同步 / CSP / SSH host key 已知 gap / mocked tests / 等等）。
- **设计系统约束**（`doc/design-system.md`）—— 任何 UI PR 跑 AGENTS.md §pre-commit verification 三条 grep。
- **perf.md baseline**——任何 IPC / session I/O PR 不能引入新瓶颈。
- **新风险**（03-migration-roadmap.md §风险登记表）：MCP 子进程调试 / 配置迁移 / 反向隧道网络 / Store 审核 / Tauri 2 plugin 版本漂移。

---

## 8. tm 决策需要找谁

| 决策类型 | 找谁 |
|---|---|
| 架构 / RFC | dev + 你 |
| 产品需求 / 命名 | pdm |
| 安全 / 隐私 / 法务 | pdm + 法务（待定）|
| Store 上架 / 签名密钥 | pdm + 法务 |
| 性能回归 | 你 + dev |
| MCP 兼容性（Claude Desktop / Cursor / Codex）| 你（手动端到端）|
| UI 设计 / 设计系统 | 你 + 设计（待定）|

---

## 9. 与现有文档的关系

| 现有 | 不变 / 更新 |
|---|---|
| `doc/design-system.md` | 不变 |
| `doc/arch/architecture-map.md` | **M0 末追加一段**："演进方向见 doc/ai-terminal-migration/02-target-architecture.md" |
| `doc/requirements/prd-0.1/` | 不变（内部 PRD；规格是 ai-terminal） |
| `doc/maintenance/bug.md` | 持续更新 |
| `doc/maintenance/perf.md` | M6 末追加新 perf 数字 |
| `prd.md / mvp-checklist.md / acceptance.md / compliance.md / dev-handoff.md` | 引用 ai-terminal-migration 即可 |

**关键**：ai-terminal 规格文档（`~/projects/ai-terminal/`）作为**外部参考**保留；xsterm 仓库内**不复制**这些内容（避免双源 drift）。03-migration-roadmap.md 已经把规格要求 inline 到了每个 PR 自测标准里。

---

## 10. tm 第一周行动清单

1. [ ] 读完本文（5 min）
2. [ ] 读完 01 §0 / §5 / §6（30 min）
3. [ ] 通读 02 §1-§5（60 min）
4. [ ] 召集 dev + pdm 拍 D-α / D-β / D-γ / D-δ 4 个决策
5. [ ] PR-005 RFC 流程就位 → PR-001 CI 上线（M0 启动）
6. [ ] 准备好 M2 阶段 MCP 端到端验收环境（本地装 Claude Desktop / Cursor / Codex 各一份）

---

文档结束。**反馈渠道**：dev 通过 `~/.hermes/profiles/dev/` 的 session 留 context；tm 直接编辑本文档或开 issue。