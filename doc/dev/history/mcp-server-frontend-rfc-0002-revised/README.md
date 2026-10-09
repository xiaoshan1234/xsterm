# 历史归档: RFC 0002-revised MCP server 嵌入 frontend TS 设计

> **归档时间**: 2026-10-09
> **理由**: RFC 0002-revised-2 (override) —— MCP server 回到 backend `services/mcp/` (HTTP + stdio 双 transport)。RFC 0002-revised 设计保留可追溯。
> **新决策**: [`doc/dev/adr/0002-revised-2-mcp-services-module.md`](../../adr/0002-revised-2-mcp-services-module.md)
> **superseded**: [`doc/dev/adr/0002-revised-mcp-frontend.md`](../../adr/0002-revised-mcp-frontend.md) (RFC 0002-revised 原版) — 已归档到本目录

## 归档内容

- `0002-revised-mcp-frontend-ADR.md` —— RFC 0002-revised 决策 (357 行)
- `RESPONSIBILITY.md` —— frontend `app/mcp/` 旧职责 (302 行, MCP server 嵌入 frontend)
- `INTERFACE.md` —— frontend `app/mcp/` 旧接口 (332 行, 12 工具 TS 实现)
- `DOWNSTREAM.md` —— frontend `app/mcp/` 旧依赖 (153 行)

## 新设计位置

- **backend MCP server**: [`doc/dev/design/backend/services/mcp/`](../../design/backend/services/mcp/) (R/I/D 3 docs)
- **frontend listener**: [`doc/dev/design/frontend/app/mcp/`](../../design/frontend/app/mcp/) (退化到 listener only)
- **ADR**: [`doc/dev/adr/0002-revised-2-mcp-services-module.md`](../../adr/0002-revised-2-mcp-services-module.md)

## 为什么归档不删

按 user profile memory "占位保留, 不允许 rm -rf" —— 历史决策文档保留可追溯。tm 验证、RFC 复盘、决策审计可能引用 RFC 0002-revised 原始设计。

## 引用方式

新设计中需要引用 "原 RFC 0002-revised frontend MCP 设计" 时,统一指向本目录:

```markdown
详见 [archived RFC 0002-revised frontend MCP design](../../history/mcp-server-frontend-rfc-0002-revised/0002-revised-mcp-frontend-ADR.md)。
```