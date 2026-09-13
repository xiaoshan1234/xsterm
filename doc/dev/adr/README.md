# ADR（Architecture Decision Records）

## 怎么读

每份 ADR 是一篇"为什么这样选"的决策记录，**不复述当前代码**——代码长什么样看 `architecture/`。

ADR 编号一旦发出**不重用**——即使决策被推翻，新 ADR 也只引用旧 ADR 编号。

## 怎么写新 ADR

1. 复制 `0001-keep-tmux-cc.md` 作为模板（legacy RFC 直接放 `adr/` 根目录，2026-09 重组后不再用 `legacy-rfcs/` 子目录）
2. 命名：`NNNN-kebab-case-topic.md`
3. 必填 section：Context / Decision / Consequences / References
4. 提交 PR 后 git add + commit，但**不**合到 main——dev 拍板后合并
5. **本 README.md 自身** —— 拍新 ADR 后追加到下面的 Index 表

## Index

| 编号 | 标题 | 状态 |
|---|---|---|
| [0001](0001-keep-tmux-cc.md) | 保留 tmux -CC 控制模式（反对 ai-terminal 规格 §M2 的简单映射）| Accepted |
| [0002](0002-mcp-single-binary.md) | MCP server 内嵌主进程（vs 独立二进制）| Accepted |
| [0003](0003-config-toml-migration.md) | 配置文件从 JSON store 迁到 TOML | Accepted |
| [0004](0004-product-naming.md) | 产品命名决策 | Accepted |
| [0005](0005-tmux-redesign-v0.md) | tmux 子系统分层重设计（P1-P5）| Accepted (部分落地：P1-P5；P6-P9 待 dev 测试）|

## 没归档的决策

- 设计系统（Cursor 暗色 IDE 适配版）—— 在 `doc/design-system.md`，AGENTS.md 强引用
- tmux controller 内部架构（P1-P5 拆分）—— 在 `adr/0005-tmux-redesign-v0.md`
- 配置热更新方案（M3 目标）—— 待 ADR
- 反向 SSH tunnel（M4 目标）—— 待 ADR
