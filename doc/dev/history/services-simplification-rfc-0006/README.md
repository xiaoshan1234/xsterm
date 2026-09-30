# 历史归档：RFC 0006 services 精简前的设计

> **归档时间**：2026-09-29
> **理由**：RFC 0006——services 精简，只保留"真有状态需要集中管理"的 module。`services/config/` 和 `services/capture/` 因无状态被下沉。

## 归档内容

- `services-config/`（3 份）—— 原 services/config 设计
  - `README.md`（12369 行）—— JSON 直存 + 联动更新
  - `INTERFACE.md`（5853 行）—— ConfigStore 公开 API
  - `DOWNSTREAM.md`（4976 行）—— 依赖图
- `services-capture/`（3 份）—— 原 services/capture 设计
  - `README.md`（224 行）—— 3 种 capture 模式
  - `INTERFACE.md`（102 行）—— 公开 API
  - `DOWNSTREAM.md`（76 行）—— 依赖图
- `session_manager_extension.md`（447 行）—— SessionManager 扩展设计（合并到 backend/README.md §4）

## 相关决策

- **新决策**：[`doc/dev/adr/0006-services-simplification.md`](../../adr/0006-services-simplification.md) —— services 精简到 6 个 module

## 下沉去向

| 归档 | 下沉到 | 理由 |
|---|---|---|
| `services/config/` | `commands/persistence.rs` 扩展 | 没自有状态——只是 tauri-plugin-store wrapper |
| `services/capture/` | `models/capture.rs` | 没自有状态——pure function（strip_ansi） |
| `session_manager_extension.md` | `backend/README.md §4` | 设计文档与 README 重叠 |

## 为什么归档不删

按 user profile memory "占位保留，不允许 rm -rf"——历史决策文档保留可追溯。tm 验证、RFC 复盘、决策审计可能引用原始设计。

## 引用方式

新设计中需要引用 "原 services/config 设计" 时，统一指向本目录：

```markdown
详见 [archived services/config design](../../history/services-simplification-rfc-0006/services-config/README.md)。
```