# tm 文档入口（TM Documents）

> **本目录是 tm 角色的专属文档**——产品验收、技术拍板、PR review。
> dev 角色的文档在 [`../dev/`](../dev/)（architecture / adr / roadmap / changelog / history），pdm 角色的 spec 在 [`../pdm/`](../pdm/)。

## 怎么用本目录

| 我是…… | 第一次该看 |
|---|---|
| **新 tm**（第一次接手验收） | 先读 [`handoff.md`](handoff.md)——90 分钟达到拍板水平 |
| **已有 tm**（续任） | 看每个 PR 自带的 `roadmap/migration-prs.md` PR 自测段，按 PR 验 |
| **想看历史决策** | 跳到 `dev/adr/legacy-rfcs/` 看4 份旧 RFC，理解"为什么这样选" |

## 本目录文件

| 文件 | 用途 |
|---|---|
| `handoff.md` | 90 分钟入门指南 + 验收 checklist + 拍板流程 + 反馈渠道 |

## tm 的核心职责

按 `handoff.md` §3–§7 的定义：

1. **验收 PR** —— 对照 `dev/roadmap/migration-prs.md` 每个 PR 的"自测标准"逐项跑
2. **拍板决策** —— 通过 `dev/adr/` 流程（`dev/adr/README.md` 模板）
3. **拒绝不合规 PR** —— 见 `handoff.md` §5 拒绝清单
4. **维护 changelog** —— bug/perf entry 由 dev 提，tm 复核格式

## tm 不该做的事

- ❌ 改 `dev/architecture/` 任何文件（dev 改）
- ❌ 改 `dev/adr/` 已拍板的 ADR（不可修改历史；只能写新 ADR 引用）
- ❌ 改 `dev/roadmap/`（dev 在 PR 里更新进度）
- ❌ 改 `dev/changelog/bugs.md` 已 `是否解决: YES` 的 entry
- ❌ 直接读 `dev/history/` 当作现状文档（带 banner，已废弃）

## 反馈渠道

- tm → dev：编辑 `handoff.md`（如"必读"清单变了）
- tm → pdm：开 ADR（在 `dev/adr/`，标 `[tm-input]`前缀）
- tm → 用户：转 dev（dev 不直接面对用户）

## 拍板流程

1. tm 写 ADR 草稿到 `dev/adr/NNNN-kebab.md`，标 `[tm-decision]`
2. dev 在 PR 里 review（48h 窗口）
3. pdm 拍板（"接受 / 拒绝 / 改方向"）
4. 拍板后 PR 合 main
5. dev 在 PR 里同步改 `dev/roadmap/migration-prs.md` 对应 PR 状态

---

**如果只剩 1 小时**：直接读 [`handoff.md`](handoff.md) §0 + §1 + §3——够拍板验收。