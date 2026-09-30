# 历史归档：RFC 0007 backend module 重新划分前的设计

> **归档时间**：2026-09-29
> **理由**：RFC 0007——backend module 按职责切分，每 module 配 3 份契约 docs。原 `services/session_manager_extension.md` 设计合并到 `backend/README.md §5.8`。

## 归档内容

- `session_manager_extension.md`（447 行）—— SessionManager 扩展设计（合并到 `backend/README.md §5.8`）

## 相关决策

- **新决策**：[`doc/dev/adr/0007-backend-module-restructure.md`](../../adr/0007-backend-module-restructure.md) —— backend module 重新划分
- **superseded**：原 `services/{config,capture}/` 已分别在 [RFC 0003-revised](../../adr/0003-revised-config-json.md) + [RFC 0006](../../adr/0006-services-simplification.md) 中下沉

## 为什么归档不删

按 user profile memory "占位保留，不允许 rm -rf"——历史决策文档保留可追溯。tm 验证、RFC 复盘、决策审计可能引用原始设计。

## 引用方式

新设计中需要引用 "原 SessionManager 扩展设计" 时，统一指向本目录：

```markdown
详见 [archived session_manager_extension.md](../../history/backend-module-restructure-rfc-0007/session_manager_extension.md)。
```
