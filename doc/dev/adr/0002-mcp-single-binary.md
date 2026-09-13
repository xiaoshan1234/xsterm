# RFC 0002: MCP server 单二进制 + 内部模块（MVP 按需实现）

| 字段 | 值 |
|---|---|
| 状态 | Accepted |
| 日期 | 2026-09-11 |
| 作者 | pdm |
| 影响阶段 | M2 |
| 决策 D-β | 是 |

---

## 1. 背景

`doc/ai-terminal-migration/02-target-architecture.md` §3 推荐 MCP server 拆成两个二进制：
- `xsterm.exe`（Tauri 主 UI）
- `xsterm-mcp.exe`（stdio 子进程，独立进程生命周期）

理由是边界清晰 + 编译速度快 + Claude Desktop 等 agent 可直接配 `command: xsterm-mcp`。

## 2. 决策

**MVP 阶段不拆双二进制。** MCP server 作为 `xsterm.exe` 内部模块嵌入（`src-tauri/src/mcp/`），通过 tokio task 在主进程内跑 stdio / HTTP 端点。

未来真有需求（独立分发 MCP、容器化部署、跨进程隔离安全）时再拆 `xsterm-mcp.exe`。

## 3. 为什么不拆

| 维度 | 拆分 | 不拆 |
|---|---|---|
| 编译速度 | 单 crate 拆 workspace，编译快 ~20% | 略慢，但 MVP 阶段可接受 |
| 部署简单度 | 2 个 exe + Claude Desktop 配置要写路径 | 1 个 exe，stdio 自动 pipe |
| 跨进程隔离 | MCP 崩溃不会拖垮 UI | UI 与 MCP 同进程，bug 会连带 |
| 进程生命周期 | 可独立重启 MCP | 主进程重启 = MCP 重启 |
| 未来扩展 | 已就位 | 需要时再拆（单 crate → workspace 重构成本低） |

pdm 的判断："按需实现" = MVP 不为未知需求付代价。xsterm 当前 SessionManager 已经在主进程内，强行拆出去反而要重写一半 IPC。

## 4. 折中：模块边界

即使同进程，模块边界要严格：

```
src-tauri/src/
├── main.rs
├── session/                  # 现有 SessionManager
├── ssh/                      # 现有 russh 封装
├── pty/                      # 现有 portable-pty 封装
├── mcp/                      # NEW: MCP server 内部模块
│   ├── mod.rs                # 模块入口 + 启动
│   ├── server.rs             # MCP 协议实现（rmcp）
│   ├── tools/                # 12 个工具
│   ├── transport/            # stdio / HTTP
│   ├── auth.rs               # Bearer token
│   ├── audit.rs              # 审计日志
│   └── core_bridge.rs        # MCP → SessionManager 桥接
└── config/
```

模块对外只暴露：
- `mcp::start(core: Arc<SessionManager>) -> McpHandle`
- `mcp::handle::stop()` / `mcp::handle::status()`
- Tauri command `mcp_status()` / `mcp_regenerate_token()`

模块内部不许反向依赖 `session` 以外的业务模块。

## 5. 未来拆分路径

如果将来要拆：

1. 创建 `crates/mcp-server/` 独立 crate
2. `core_bridge.rs` 改为 IPC（tokio::ipc 或 HTTP）
3. 新增 `src-tauri/src/bin/xsterm-mcp.rs` 入口
4. Claude Desktop 配置改 `command: xsterm-mcp`

不影响协议层（mcp.md 不变），只影响进程边界。

## 6. 影响

- `doc/ai-terminal-migration/02-target-architecture.md` §3 改写：D-β 标"按需，MVP 单二进制"
- `doc/prd/prd.md` §M6 加一句：MVP 阶段 MCP 嵌入主进程
- `doc/prd/mcp.md` 不变（协议层与进程拆分无关）

## 7. 验收

- 主进程 + MCP 同一进程，内存基线 < 200MB
- MCP stdio / HTTP 启动 < 500ms
- SessionManager crash → MCP 自动断开但不拖垮 UI（rust panic = 进程退出，至少不卡死）

---

签字：

- [x] pdm — 2026-09-11
- [ ] dev
- [ ] tm
