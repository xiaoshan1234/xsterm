# RFC 0004: 保留 xsterm 品牌，对外宣传使用 AI Terminal

| 字段 | 值 |
|---|---|
| 状态 | Accepted |
| 日期 | 2026-09-11 |
| 作者 | pdm |
| 影响阶段 | M0–M5 |
| 决策 D-δ | 是 |

---

## 1. 背景

xsterm 仓库已有 3 个月开发积累：
- ~50 个 Rust 源文件 + SessionManager 2717 行 + tmux controller 3622 行
- ~80 个前端组件 + 14 个 dialog
- 7000+ 行文档（prd / arch / req / bug / perf / tmux 协议）
- Microsoft Store / GitHub Releases 已用 `xsterm` 名字分发

产品想从"无设计的小工具"演进成"商业产品 + AI-first 差异化"。

## 2. 决策

**保留 `xsterm` 作为工程 / 仓库 / 二进制 / 内部命名。**

**对外产品宣传使用 "AI Terminal"（副品牌 xsterm）。**

理由：
- 工程资产不能改名重做（CRATES / 包名 / 路径 / 文档 / GitHub）
- 商业品牌需要描述产品定位（"AI-first 终端"），xsterm 这个名字承载不了这层叙事
- GitHub 开源仓库叫 `xsterm`，README 第一行写 "AI Terminal by xsterm"
- Microsoft Store listing 名："xsterm — AI Terminal for Windows"
- 二进制名：保留 `xsterm.exe`（不破坏现有用户升级）

## 3. 品牌分层

| 场景 | 名称 |
|---|---|
| 仓库 / 包 / Cargo crate / npm package | `xsterm` |
| 二进制文件 | `xsterm.exe` / `xsterm-mcp.exe`（未来） |
| GitHub 仓库名 | `xsterm` |
| 用户界面窗口标题 | `xsterm — AI Terminal` |
| UI 关于页 | "xsterm (AI Terminal)" |
| Microsoft Store 名 | `xsterm — AI Terminal for Windows` |
| 官网 / 文档站域名 | `xsterm.dev` |
| 文档站首页标题 | "xsterm — AI-first terminal for Windows" |
| 隐私政策 / 法务文件名 | `xsterm-privacy.md` |
| 安全联系邮箱 | `security@xsterm.dev` |
| Reddit / HN / Twitter 标签 | `#xsterm` + `#AITerminal` |
| LICENSE 文件 | `Copyright (c) 2026 xsterm contributors` |

## 4. 与 PRD / mcp.md 的对齐

之前 PRD 第一行"产品名（暂定）：AI Terminal"改为：

```markdown
产品名：xsterm
副品牌：AI Terminal
定位：Windows 下第一个 AI-first 终端模拟器
```

`doc/prd/mcp.md` §16 集成示例的 Claude Desktop 配置：

```diff
- command: "ai-terminal-mcp"
+ command: "xsterm-mcp"
- args: ["--stdio"]
+ args: ["--stdio"]
```

## 5. MCP server 自报家门

MCP initialize 响应中：

```json
{
  "protocolVersion": "2025-06-18",
  "serverInfo": {
    "name": "xsterm",
    "version": "0.2.0",
    "description": "xsterm — AI Terminal MCP server"
  },
  "capabilities": { ... }
}
```

agent 工具列表显示 "xsterm — list_sessions" 等。

## 6. 风险与缓解

| 风险 | 缓解 |
|---|---|
| 用户搜不到"AI Terminal"产品 | SEO 同步建站（xsterm.dev 首页放 "AI Terminal" 关键字） |
| 内部命名不一致 | RFC 0004 + 上面品牌分层表 = 单一事实源 |
| 改名诉求（pdm 未来想彻底改名）| RFC 0004 状态 = Accepted，但可在 RFC 0005 重新评估 |
| 法务商标冲突 | xsterm 名字需提前查商标（美国 / EU / 中国），M0 末完成 |

## 7. 验收

- Microsoft Store listing 名符合品牌分层表
- UI 所有可见字符串遵循品牌分层
- GitHub README 第一行包含 "AI Terminal"
- mcp.md 集成示例全部用 `xsterm-mcp`
- 文档站 footer 显示 `© 2026 xsterm contributors`

---

签字：

- [x] pdm — 2026-09-11
- [ ] dev
- [ ] tm
