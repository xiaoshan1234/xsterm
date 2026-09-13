# AI Terminal — dev 交接说明

================================================================
仓库布局（建议）
================================================================

  xsterm/
  ├── apps/
  │   └── desktop/                  Tauri 主项目
  │       ├── src/                  前端 (TS + React)
  │       │   └── terminal/         xterm.js 封装 + addon
  │       ├── src-tauri/            Tauri Rust 主进程
  │       └── tauri.conf.json
  ├── crates/
  │   ├── pty-bridge/               portable-pty 封装 + 事件总线
  │   ├── mcp-server/               MCP server (rmcp)
  │   ├── ssh-client/               russh 封装 + known_hosts
  │   ├── ssh-tunnel/               russh 反向隧道
  │   ├── config/                   配置加载 + 热更新
  │   └── updater/                  应用内更新
  ├── ui/                           前端组件库（独立 npm package）
  ├── docs/                         文档站（VitePress）
  │   ├── index.md
  │   ├── quickstart.md
  │   ├── mcp.md
  │   └── privacy-policy.md
  ├── prd.md                        本文档集
  ├── mvp-checklist.md
  ├── acceptance.md
  ├── compliance.md
  └── README.md

================================================================
技术栈锁定
================================================================

- Rust 2021 edition, MSRV 1.75
- Tauri 2.x
- portable-pty 0.8+（PTY 抽象层）
- xterm.js 5.x + xterm-addon-fit / webgl / search / serialize / image / unicode11
- rmcp（MCP SDK，Rust 实现）
- tokio 1.x
- russh 0.40+（纯 Rust 异步 SSH 客户端 + 隧道）
- notify 6.x
- serde + toml
- 前端：TypeScript strict + React 18 + Vite + Zustand
- 样式：CSS Modules 或 vanilla-extract（不引入 Tailwind，避免膨胀）
- 测试：cargo test + vitest + playwright

================================================================
开发环境搭建
================================================================

前置：
- Rust 1.75+
- Node 20+
- pnpm 9+
- Windows: WebView2 Runtime（Win11 自带）
- Visual Studio Build Tools（含 C++ 桌面开发）

  git clone https://github.com/<org>/xsterm
  cd xsterm
  pnpm install
  cargo install cargo-about cargo-audit
  cd apps/desktop && pnpm tauri dev

================================================================
TODO 拆分原则
================================================================

每个 TODO 必须满足：
1. 一个 PR 只做一件事
2. 标题格式：`feat(mcp): add subscribe_output tool`（conventional commits）
3. 跨模块改动先写 RFC：doc/dev/adr/0001-xxx.md，72 小时讨论窗口
4. 任何破坏性 API 改动必须更新 CHANGELOG.md
5. 任何 MCP 协议改动必须更新 mcp-compat 测试

建议拆分顺序（与 PRD 里程碑对齐）：
  1. T0: 仓库初始化 + CI（GitHub Actions）
  2. T1: Tauri + WebView2 + xterm.js hello world
  3. T2: portable-pty 连接 PowerShell + xterm.js 双向桥接
  4. T3: 标签页 + 分屏
  5. T4: TUI 完整档（24-bit color + 鼠标 + bracketed paste）
  6. T5: 复制粘贴（多行检测 + trim）
  7. T6: 配置系统 + 热更新
  8. T7: MCP server（基础工具）
  9. T8: MCP attach / detach + UI 接管
  10. T9: russh SSH 集成
  11. T10: WSL / Docker / tmux session 映射
  12. T11: russh 反向 SSH tunnel
  13. T12: MSIX 打包 + 签名
  14. T13: Microsoft Store 提交

================================================================
编码约定
================================================================

Rust：
- clippy 必过（CI 严格模式）
- 公共 API 必须有 rustdoc
- 错误处理：thiserror + anyhow，库用 thiserror，二进制用 anyhow
- 异步：tokio，async fn 不用 Send 边界除非必要
- 字符串：内部一律 UTF-8，PTY 接口用 lossy
- 测试：单元测试放同文件 integration test 放 tests/

TypeScript：
- strict mode
- ESLint + Prettier
- 不使用 any（unknown 替代）
- 状态管理：Zustand
- 异步：原生 async/await

Git：
- main 受保护，PR 必须 review
- squash merge
- 提交前跑 `cargo test` 和 `pnpm test`

================================================================
测试策略
================================================================

层级：
1. 单元测试（Rust + TS）：逻辑覆盖 ≥ 80%
2. 集成测试：MCP 协议、PTY 通信、配置加载
3. E2E 测试（playwright）：UI 交互、快捷键
4. 兼容性测试（手动 + 自动）：
    - vttest 套件
    - vim / lazygit / htop / btop / k9s / fzf
    - 24-bit color 测试脚本
    - Kitty graphics 测试程序
5. 性能测试：
    - 冷启动 < 1.5s
    - 内存 baseline
    - 渲染帧率

================================================================
关键依赖跟踪
================================================================

每周检查：
- xterm.js 上游版本（锁 minor）
- rmcp 协议规范更新（MCP 还在 0.x）
- russh 与 OpenSSH 兼容性公告
- Tauri 2.x 稳定版进度

锁定策略：
- 主依赖锁定 minor version
- 开发依赖（test, lint）允许 ^

================================================================
调试工具
================================================================

- 终端调试：`RUST_LOG=debug cargo run`
- MCP 调试：`RUST_LOG=mcp_server=trace,rmcp=trace`
- UI 调试：DevTools（Tauri 自带，Ctrl+Shift+I）
- 协议分析：Wireshark + loopback（本机 127.0.0.1）

================================================================
已知坑（提前规避）
================================================================

1. xterm.js 在 WebView2 上的字体 fallback、IME 输入有偶发 bug
   → 启用 xterm-addon-image + xterm-addon-unicode11 缓解，必要时打补丁
2. WebView2 在某些 Win10 版本未预装
   → 安装包检测 + 提示用户下载
3. portable-pty 在 Windows 下 ConPTY / winpty 选择
   → MVP 用 ConPTY（Win10 1809+），winpty 兼容回退
4. russh 与 OpenSSH 边缘案例（Compression、ProxyJump）
   → MVP 支持基础认证 + 直连，其他 v1.1
5. tmux 在 Windows 原生不可用
   → 必须走 WSL，UI 明示
6. MSIX 沙箱限制（文件系统 / 注册表）
   → 配置存 %APPDATA%，符合 MSIX 规范
7. MCP stdio 在 Windows 下要谨慎处理换行
   → 测试用 Python `json.dumps` 确保 \n 处理正确

================================================================
tm / qa 关注点
================================================================

tm 重点：
- 每个 MUST 项有对应测试（不要靠"我试过"）
- MCP 兼容性测试覆盖所有工具
- TUI 兼容性测试覆盖所有承诺档位

qa 重点：
- 手动跑验收文档中所有 🔍 项
- 真实使用场景跑通：vim + lazygit + SSH 到服务器 + 让 Claude Code 操作
- 性能跑分（任务管理器 / WPA）

================================================================
联系方式
================================================================

- 项目 owner: <owner>
- 主开发: <dev-lead>
- 安全问题: security@xsterm.dev
- Discord: <invite>
- 周会: <schedule>

================================================================
下一步
================================================================

1. dev 评审 PRD（72 小时）
2. 拆分 TODO 到 issues
3. 拉分支搭脚手架（T0-T1）
4. 每两周一次进度同步
5. 关键节点（每个里程碑结束）做演示 + 评审

开干。
