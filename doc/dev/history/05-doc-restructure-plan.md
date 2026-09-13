# 文档重组计划（方案 A：单一权威层）

## 目标

37 个 markdown → 11 个，分 5 层。新人读 `doc/README.md` 即可导航。

## 最终结构

```
doc/
├── README.md                                 ← 索引（5 层各 1 句）
│
├── design-system.md                          ← 现状保留（AGENTS.md 强引用）
│
├── architecture/                             ← "代码现在长什么样"
│   ├── overview.md                           ← 顶替 arch/architecture-map.md
│   ├── tmux-controller.md                    ← controller/mod.rs + 子目录拆分后的现状
│   ├── tmux-protocol.md                      ← wire + codec + parser + events（合并 protocol/ 目录的对外接口）
│   ├── ssh.md                                ← infrastructure/ssh.rs + russh + known_hosts gap
│   ├── pty.md                                ← portable-pty + LocalSession 路径
│   ├── frontend-state.md                     ← SessionContext 11 文件拆分 + PaneTree
│   ├── ui-shell.md                           ← Cursor 暗色 IDE 适配版（合并 arch/ui.md + design-system 引用）
│   └── ipc.md                                ← Tauri command + event 列表（来自 live-data.md）
│
├── adr/                                      ← "为什么这样选"
│   ├── README.md                             ← ADR 怎么写、index
│   ├── 0001-keep-tmux-cc.md                  ← 现状保留（仅改名）
│   ├── 0002-mcp-single-binary.md
│   ├── 0003-config-toml-migration.md
│   ├── 0004-product-naming.md
│   └── 0005-tmux-redesign-v0.md             ← 新加（来自 ai-terminal-migration/04）
│
├── roadmap/                                  ← "接下来做什么"
│   ├── current.md                            ← 当前季度（M3 W10-12：MCP + 配置 toml）
│   ├── target-architecture.md                ← 终态（来自 ai-terminal-migration/02）
│   ├── gap-analysis.md                       ← 缺口（来自 01）
│   ├── migration-prs.md                      ← PR 切片（来自 03）
│   └── status.md                             ← 实时：P1-P9 哪些完成
│
├── changelog/                                ← "已经发生什么"
│   ├── bugs.md                               ← 现状保留（仅改名，从 maintenance/bug.md）
│   └── perf.md                               ← 现状保留（仅改名）
│
└── history/                                  ← "已废弃但保留可追溯"
    ├── README.md                             ← 顶部 banner："本目录是迁移前历史快照"
    ├── prd-0.1/                              ← 原 requirements/prd-0.1/* 整目录
    │   ├── req-001..008.md
    │   ├── tmux-cc-implementation.md         ← Wave 1-6 实施细节（保历史价值）
    │   ├── create-session-config.md
    │   ├── session-config-{common,shell,ssh}.md
    │   └── req-manage.md
    └── tmux-wave-history.md                  ← 从 ai-terminal-migration/04 提取 Wave 1-6 历史
```

## 搬迁规则

| 规则 | 说明 |
|---|---|
| **现状文档** | 移到 `architecture/` — 描述当前代码实际状态 |
| **决策记录** | 移到 `adr/` — 解释"为什么这样选"，不复述代码 |
| **路线图** | 移到 `roadmap/` — 未来要做什么 |
| **历史快照** | 移到 `history/` — 加 DEPRECATED banner |
| **外部规格** | ai-terminal 规格文档**不进 xsterm 仓库**（删除 doc/prd/ 目录，或保留在 `history/external/`） |
| **bug/perf** | 移到 `changelog/` — 时序记录，无须重写 |

## 不进仓库的内容

- `doc/prd/*`（prd.md / mcp.md / mvp-checklist.md / acceptance.md / compliance.md / dev-handoff.md）
  - 这些是 ai-terminal 外部产品的规格，不是 xsterm 的当前 / 未来 / 历史
  - 决策：**移到 `history/external/ai-terminal-spec/` 加 banner「这是 2026-09 制定的外部目标产品规格；xsterm 演进路线见 `roadmap/target-architecture.md`」**
  - 或者**完全删除**——xsterm 仓库当前 main branch 与这些规格没直接关系

## AGENTS.md 链接更新

`doc/` 引用从 11 处变成 ~6 处（指向新结构）。我会同步改。

## 工作量

- 30+ 个 `git mv`（保 history）
- 5 个 doc 改写（现状文档必须基于 P3-P5 后的实际代码）
- 1 个 README.md 新建
- AGENTS.md 链接替换

预计 1 个完整 dev 半天工作量。

## 风险

| 风险 | 缓解 |
|---|---|
| 链接断裂 | grep 全文 + cargo doc / vite build 验证无 broken link |
| 信息丢失 | git mv 保 history；任何删前 diff 给 dev 看 |
| AGENTS.md 改坏 | 不删老路径在 AGENTS.md，只新增——给 1 周过渡期再删老目录 |

## 不做

- 不重写内容（保持原 markdown body）
- 不删任何文件**第一步**（只 mv）——下一轮评审再决定删
- 不动 `doc/design-system.md`（强引用，零改动）

## 拍板点

请确认：
1. `doc/prd/*`（ai-terminal 外部规格）走**完全删除**还是**移到 history/external/**？
2. PR 一次提交还是拆 5 个小 PR（按层拆）？
3. 这次直接改 AGENTS.md 还是先放 deprecation banner 过渡 1 周？
