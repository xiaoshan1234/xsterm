# 历史归档：RFC 0002 MCP server 嵌入 backend 设计

> **归档时间**：2026-09-29
> **理由**：RFC 0002-revised（override）—— MCP server 移到 frontend TS 层。RFC 0002 设计保留可追溯。

## 归档内容

- `backend-design/README.md`（原 `mcp_server/README.md`，756 行）—— MCP server 嵌入 backend 主进程设计
- `backend-design/tools/`（2 份：RESPONSIBILITY 359 行 + INTERFACE 603 行）—— 12 个工具的 JSON Schema

## 相关决策

- **新决策**：[`doc/dev/adr/0002-revised-mcp-frontend.md`](../../adr/0002-revised-mcp-frontend.md)
- **superseded**：[`doc/dev/adr/0002-mcp-single-binary.md`](../../adr/0002-mcp-single-binary.md)（RFC 0002 原版）
- **新设计**：[`doc/dev/design/frontend/app/mcp/`](../../design/frontend/app/mcp/)（frontend MCP 协议层）
- **新支撑**：[`doc/dev/design/backend/services/`](../../design/backend/services/)（backend attach / subscribe / capture / tunnel 4 个 service 保留）

## 为什么归档不删

按 user profile memory "占位保留, 不允许 rm -rf"——历史决策文档保留可追溯。tm 验证、RFC 复盘、决策审计可能引用 RFC 0002 原始设计。

## 引用方式

新设计中需要引用 "原 RFC 0002 设计" 时，统一指向本目录：

```markdown
详见 [archived RFC 0002 backend MCP design](../../history/mcp-server-backend-rfc-0002/backend-design/README.md)。
```