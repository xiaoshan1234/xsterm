# AI Terminal — MVP PRD

产品名（暂定）：AI Terminal
定位：Windows 下第一个 AI-first 终端模拟器，原生兼容现代 TUI，向 AI agent 暴露完整控制面。
目标平台：Windows 10/11（64-bit），后续规划 macOS / Linux。
渲染：Tauri 2 + WebView2；终端引擎自研（基于 portable-pty + xterm.js）。
商业模式：MVP 全部免费，区分个人 / 企业授权。上架 Microsoft Store，先开源（MVP 阶段 MIT），后续可能改源码许可证但保留免费使用。

================================================================
1. 目标用户与场景
================================================================

主要用户：
1) 程序员：在 Windows 上日常开发，依赖 vim、lazygit、htop、fzf、btop、k9s 等 TUI；希望 Windows 终端体验对标 macOS iTerm2 + tmux -CC。
2) AI agent（Claude Code / Codex / 自研 agent）：需要一个稳定可编程的终端通道，能创建会话、发送按键、捕获屏幕、订阅输出。

核心场景：
A. 开发者手动使用：打开 PowerShell / WSL / SSH / Docker / tmux session，流畅运行 TUI 应用，按预期方式复制粘贴，配置自动 reload。
B. AI agent 使用：本地 MCP server 暴露 `create_session / send_keys / capture_screen / subscribe_output / list_sessions / attach_session`，agent 像操作文件一样操作终端；远程 SSH agent 通过反向 SSH tunnel 接入，终端作为客户端。

================================================================
2. MVP 功能边界（must / should / could）
================================================================

MUST（MVP 阻塞项）：
M1. 标签页 + 多窗口
    - 多标签页（创建 / 关闭 / 重命名 / 切换快捷键）
    - 单标签页内水平 / 垂直分屏（最多 4 个 pane）
    - 标签页拖拽排序
M2. 执行环境（5 种全部支持）
    - PowerShell 7（默认）
    - CMD
    - WSL（自动列出已安装发行版）
    - SSH（基础，密码 + 私钥认证）
    - tmux session 映射（启动时 attach 或新建，detach 后保持后台 session）
    - Docker 容器 attach（exec 进入运行中容器）
M3. TUI 兼容性（"完整档"）
    - 24-bit true color
    - 256 color fallback
    - 鼠标协议（X10 / SGR / SGR-Pixels / urxvt）
    - Bracketed paste mode（粘贴多行内容不触发意外命令）
    - Kitty graphics protocol（图像内嵌显示）
    - 完整 Unicode（宽字符、emoji、CJK、零宽字符）
    - 备用屏幕（alternate screen）正确切换
    - OSC 0/1/2/4/7/8/10/11/12/52 等常见序列
M4. 复制粘贴
    - 选中即复制（鼠标左键拖选 → 剪贴板）
    - Ctrl+Shift+C / Ctrl+Shift+V
    - 右键菜单（复制 / 粘贴 / 全选）
    - 多行粘贴检测：自动识别粘贴内容是否含换行符，弹提示确认
    - 自动 trim：粘贴前移除首尾空行 / 不可见空白
    - 路径 / URL 检测：选中后出现悬浮按钮，一键打开
M5. 快捷键
    - 标签页：Ctrl+T 新建、Ctrl+W 关闭、Ctrl+Tab 切换、Ctrl+1-9 直跳
    - 分屏：Ctrl+Shift+D / Ctrl+Shift+E（横/竖）
    - 跳转：Ctrl+Shift+Pane 方向键（vim 风格）
    - 全局：无冲突设计（PowerShell / TUI 不抢键）
    - 用户可在 settings.json 覆盖所有快捷键
M6. MCP server（核心差异化）
    - 内置 stdio MCP server，与终端主进程同生命周期
    - 工具集 v1：
        * list_sessions() → 所有标签页 / pane 列表
        * create_session(profile: str) → 新建标签页
        * close_session(session_id: str)
        * send_keys(session_id, keys: list[str] | text: str) → 注入按键或文本
        * capture_screen(session_id, mode: "text" | "ansi" | "screenshot") → 捕获当前屏幕
        * subscribe_output(session_id) → 订阅输出流（增量文本）
        * attach_session(session_id) → 当前 MCP 连接独占该 session，其它输入被屏蔽
        * wait_for(session_id, pattern: str, timeout: int) → 等待输出匹配正则
    - 安全：MCP server 默认只监听 stdio（Claude Desktop / Codex / Cursor 配置即可用）；如启用 TCP 监听必须走 127.0.0.1 且要 token 鉴权
M7. 本地 AI 一键接管
    - UI 按钮"🤖 AI 接管"：暂停用户输入，把当前 session 标记为 AI 独占，UI 顶部出现 banner
    - 解锁方式：用户在终端输入特定口令（默认 `ctrl-cmd-ai-release`）或 UI 上点"释放"
M8. 远程 SSH agent 接入
    - 支持反向 SSH tunnel（`ssh -R`），远端 agent 通过隧道连接本地 MCP server
    - 自动生成隧道脚本（PowerShell + bash 双版本）
M9. 配置
    - 配置文件：`%APPDATA%\ai-terminal\config.toml`
    - 默认提供 schema，编辑器有智能提示（生成 JSON schema 给 VS Code）
    - 配置文件改动自动 reload（watch notify）
M10. 上架 Microsoft Store
    - 通过 MSIX 打包，遵循 Microsoft Store 政策
    - 应用签名（EV 证书，后续切合作伙伴中心签名）
    - 启动器遵循 Store 规范（不写 ProgramFiles / 不修改注册表 / 沙箱友好）
M11. 自动更新
    - 支持应用内更新（Store 通道 + 直连 GitHub Releases 通道，用户可切换）

SHOULD（v1.1 考虑，做 MVP 期间预留接口）：
- 标签页分组（工作区）
- 会话录像与回放（asciinema 格式）
- 主题商店
- 跨设备同步配置（云端可选）
- 插件系统（WebAssembly 插件）

COULD（v2+）：
- 团队协作（多人 cursor 共享 session）
- AI 自动生成快捷键 / 主题
- 云端 AI session 持久化

================================================================
3. 技术架构
================================================================

进程模型：
  ┌─────────────────────────────────────────────────┐
  │ ai-terminal.exe (Tauri 主进程)                   │
  │   ├─ WebView2 (UI: TS + React)                    │
  │   │   └─ xterm.js (终端渲染 + ANSI/序列解析)      │
  │   ├─ portable-pty (PTY 抽象层, 跨平台)            │
  │   ├─ russh (SSH 客户端 + 反向隧道)                │
  │   └─ mcp-server 子进程 (stdio, tokio)             │
  └─────────────────────────────────────────────────┘

模块：
- ui/                      Tauri 前端（React + TypeScript + Vite）
  - terminal/              xterm.js 封装 + TUI 协议处理
- pty-bridge/              portable-pty 封装，事件总线，PTY ↔ xterm.js 双向桥接
- mcp-server/              MCP server 实现（rmcp crate），与主进程通过 tokio::mpsc 通信
- ssh-client/              russh 封装，连接管理 + known_hosts
- ssh-tunnel/              russh 反向隧道
- config/                  配置加载 + 热更新
- updater/                 应用内更新

数据流：
  PTY 输出（portable-pty）→ tokio mpsc → Tauri IPC → xterm.js 解析渲染
                       ↓
                  事件总线
                       ↓
                 MCP server 订阅 → AI agent 收到

依赖（核心）：
- tauri 2.x
- portable-pty 0.8+（PTY 抽象）
- xterm.js + xterm-addon-*（前端渲染：fit / webgl / search / serialize / image / unicode11）
- rmcp（Rust MCP SDK）
- tokio 1.x
- russh 0.40+（纯 Rust 异步 SSH 客户端 + 隧道）
- notify（文件监听）
- serde / toml

================================================================
4. 数据与权限
================================================================

本地数据：
- 配置：%APPDATA%\ai-terminal\config.toml
- 会话状态：内存 only，不持久化（关掉就丢）
- SSH known_hosts：%APPDATA%\ai-terminal\ssh\known_hosts
- 主题 / 字体缓存：%LOCALAPPDATA%\ai-terminal\cache

权限（最小原则）：
- 启动子进程（PowerShell / WSL / ssh / docker）— 必需
- 读写用户配置目录 — 必需
- 读写剪贴板 — 必需
- 网络（出站 TCP）— SSH / 自动更新用，UI 必须明示
- 监听 127.0.0.1（仅当用户启用 TCP MCP 时）— 默认关闭
- 文件系统全权限 — 不要（沙箱友好）

AI agent 权限边界：
- MCP 工具只能操作 AI attach 的 session，不能关闭其它标签页或修改全局配置
- send_keys 注入时禁止 Ctrl+C / Ctrl+D / Ctrl+Z 之外的"破坏性快捷键"白名单（用户可在配置开启全部）
- capture_screen 截屏内容不离开本机

================================================================
5. 合规清单
================================================================

C1. Microsoft Store 政策合规
    - 隐私政策 URL（独立页面）
    - 数据收集声明：MCP server 不收集任何遥测；自动更新会请求 GitHub Releases
    - 不修改注册表（除 MSIX 安装自身需要的）
    - 不写 Program Files
    - 启动器遵循 Store UX 指南（无隐藏窗口）
    - 应用必须能在受控账户下运行
C2. 第三方协议合规
    - portable-pty: MIT ✓
    - xterm.js: MIT ✓
    - rmcp: MIT/Apache-2.0 ✓
    - russh: Apache-2.0 / MIT ✓
    - 所有依赖 SPDX 标识，NOTICE 文件生成
    - 字体：默认用 Cascadia Code（Microsoft 出品，可商用）
C3. 隐私
    - 默认无遥测 / 无崩溃上报
    - 用户可选择加入 Sentry（开源计划）
C4. 安全
    - MCP server 默认 stdio，不监听网络
    - SSH 私钥不落盘，只在内存缓存单次会话
    - 配置文件 schema 校验，拒绝危险字段（如指向系统目录的 profile）
C5. 开源合规
    - LICENSE（MIT）
    - NOTICE（依赖声明）
    - CONTRIBUTING.md
    - SECURITY.md（漏洞披露流程）
C6. 无障碍
    - 屏幕阅读器：标签页标题、菜单可达
    - 高对比度主题
    - 字体大小可调
C7. 国际化
    - 字符串全部走 i18n（i18next）
    - MVP 至少 zh-CN + en-US

================================================================
6. 验收标准（dev → tm → qa 通用）
================================================================

每个 MUST 项必须可验证。验收 = 自动测试 + 手动 checklist。

A. TUI 兼容性（最重要）
    - vim、htop、lazygit、fzf、btop、k9s 在 PowerShell 标签页中：
        * 颜色正确（24-bit）
        * 鼠标选中 / 滚动正常
        * 快捷键无冲突
        * 退出后正确还原主屏幕（无残留）
    - 在 Kitty graphics protocol 测试程序下显示图片
    - 中文 / emoji 显示宽度正确（一个 CJK = 2 列，一个 emoji = 2 列）
    - 粘贴 1000 行文本到 vim 不卡顿，不触发命令执行
    - 通过 vttest 套件（完整档 ≥ 90% 通过）

B. MCP server
    - 启动后 `mcp-client` 能列出所有工具
    - create_session → 标签页出现
    - send_keys("ls\n") → 输出被捕获
    - subscribe_output 收到增量文本（不丢不重）
    - attach_session 后用户键盘输入被忽略，detach 后恢复
    - wait_for(pattern) 在合理时间内返回匹配行
    - 异常 session 关闭时 MCP 工具返回明确错误

C. 复制粘贴
    - 拖选自动复制
    - 多行粘贴弹确认提示
    - 粘贴到 nano 不触发意外按键
    - 剪贴板内容含 ANSI 时只粘贴纯文本

D. Microsoft Store 提交
    - 通过 WACK / Partner Center 静态 + 动态测试
    - MSIX 签名通过
    - 隐私政策 URL 可访问
    - 安装 / 卸载 / 更新走 Store 通道无残留

E. 性能
    - 启动到首屏 < 1.5s（冷启动，SSD）
    - 连续 cat 1GB 文件不 OOM（流式渲染）
    - 100 个标签页只开 5 个时内存 < 200MB

F. 安全
    - 默认开启的 MCP server 仅 stdio，端口扫描确认无监听
    - 反向 SSH 隧道断开后自动重连（指数退避，最多 5 次）

================================================================
7. 关键流程
================================================================

7.1 启动流程
  用户双击图标 → Store 启动器 → 主进程加载配置
    → 创建默认标签页（PowerShell）
    → 启动 MCP server 子进程
    → 注册文件监听（config.toml）
    → 渲染首屏

7.2 MCP attach 流程（差异化核心）
  AI 客户端 (Claude Desktop) 通过 stdio 连入 MCP server
    → AI 调用 attach_session(session_id="tab-3")
    → 终端把该标签页标记为 AI 独占
    → UI 顶部 banner: "AI Agent 接管中"
    → 用户键盘输入被丢弃，鼠标可选（配置）
    → AI 通过 send_keys / capture_screen 操作
    → AI 调用 detach_session 或用户输入释放口令 → 恢复

7.3 tmux session 映射
  用户在标签页右键 → "新建 tmux session" → 终端 exec `tmux new -s name`
    → PTY 接管，session 在后台持续运行
    → 标签页关闭不杀 tmux session（用 `tmux kill-session` 才结束）
    → 重新打开终端 → "attach tmux session" 列出已有 session

7.4 自动更新
  启动时检查（用户可关闭）→ 有新版本 → 下载 MSIX → Store 通道或直连安装
    → 提示用户重启

================================================================
8. 风险与缓解
================================================================

R1. xterm.js 在 WebView2 上的字体 fallback、IME 输入有偶发 bug
    → 启用 xterm-addon-image + xterm-addon-unicode11 缓解，必要时打补丁
R2. portable-pty 在 Windows 下 ConPTY / winpty 选择
    → MVP 默认 ConPTY（Win10 1809+），winpty 作为兼容回退
R3. russh 与 OpenSSH 协议兼容性
    → 锁定 russh 0.40+ 稳定版，CI 跑 sshd 集成测试
R4. WebView2 在某些 Win10 版本未预装
    → 安装包检测 + 提示用户下载
R5. MCP 协议还在快速迭代，SDK 兼容性风险
    → 锁定 rmcp 1.x 版本，CI 跑兼容性测试
R6. Microsoft Store 审核对"开发者工具"较严
    → 提前读 App Certification Kit 文档，预留 2 周缓冲
R7. tmux 在 Windows 原生不可用，必须走 WSL
    → UI 明示"tmux 仅在 WSL session 中可用"
R8. 24-bit color + WebGL 渲染在低端机掉帧
    → 提供"兼容模式"开关（DOM 渲染 + 256 color）
R9. xterm.js bundle 较大（约 1MB gzip）
    → code-split 按需加载，初始包 < 500KB

================================================================
9. MVP 里程碑（建议节奏）
================================================================

M0 (W1-W2): 技术验证
    - Tauri + WebView2 跑通 hello world
    - portable-pty 连接 PowerShell + xterm.js 渲染
    - russh 连接本地 sshd 验证
M1 (W3-W5): 核心终端
    - 标签页 + 分屏
    - TUI 兼容性达到"基础档"
    - 配置系统
M2 (W6-W8): TUI 完整档 + 复制粘贴
    - 24-bit color / 鼠标 / bracketed paste
    - 多行粘贴检测
M3 (W9-W11): MCP server
    - 全部工具实现
    - 本地 AI 一键接管 UI
    - Claude Desktop 端到端验证
M4 (W12-W14): 多环境 + tmux
    - SSH / Docker / WSL
    - tmux session 映射
M5 (W15-W17): 上架准备
    - MSIX 打包 + 签名
    - 隐私政策 + 文档
    - Microsoft Store 提交
M6 (W18+): 公测 + 修 bug + 准备 v1.1

================================================================
10. 给 dev 的交接说明
================================================================

代码仓库布局建议：
  /apps/desktop           Tauri 主项目
  /crates/pty-bridge      portable-pty 封装 + 事件总线
  /crates/mcp-server      MCP 实现 (rmcp)
  /crates/ssh-client      russh 封装 + known_hosts
  /crates/ssh-tunnel      russh 反向隧道
  /crates/config          配置
  /ui                     前端（含 xterm.js 封装）
  /docs                   文档站（VitePress）

开发约定：
- Rust: edition 2021, clippy 必过
- TS: strict, prettier + eslint
- 测试: cargo test 覆盖核心模块，UI 用 vitest + playwright
- 提交: conventional commits，PR 必过 CI
- 所有破坏性 API 改动必须更新 docs/

TODO 拆分原则：
- 每个 TODO 一个 PR，标题写清楚
- 跨模块改动先 RFC（写 docs/rfcs/0001-xxx.md）
- MCP 相关改动必须更新 rmcp 兼容性测试

================================================================
11. 成功标准
================================================================

MVP 成功的定义：
1. Microsoft Store 上架，可被全球用户搜索下载
2. GitHub stars ≥ 500（开源版本）
3. MCP server 被至少 3 个主流 AI agent（Claude Desktop / Cursor / Codex）官方文档收录
4. vttest 通过率 ≥ 90%
5. 0 个 P0 bug 跑过 4 周公测

================================================================
文档版本：v0.1 (PRD 初稿)
下一步：dev 评审 → 拆 TODO → 开干
================================================================
