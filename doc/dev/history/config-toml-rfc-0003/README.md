# 历史归档：RFC 0003 toml 迁移设计

> **归档时间**：2026-09-29
> **理由**：RFC 0003-revised（override）—— 保留 `tauri-plugin-store` JSON 格式，不迁移 toml。RFC 0003 原始设计保留可追溯。

## 归档内容

- `0003-config-toml-migration.md` —— RFC 0003 原版（toml + 30 天 .bak 回退窗口）

## 相关决策

- **新决策**：[`doc/dev/adr/0003-revised-config-json.md`](../../adr/0003-revised-config-json.md) —— JSON 保留
- **superseded**：`doc/dev/adr/0003-config-toml-migration.md`（RFC 0003 原版）

## 为什么归档不删

按 user profile memory "占位保留，不允许 rm -rf"——历史决策文档保留可追溯。tm 验证、RFC 复盘、决策审计可能引用 RFC 0003 原始设计。

## 引用方式

新设计中需要引用 "原 RFC 0003 toml 设计" 时，统一指向本目录：

```markdown
详见 [archived RFC 0003 toml migration design](../../history/config-toml-rfc-0003/0003-config-toml-migration.md)。
```