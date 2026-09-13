# xsterm → ai-terminal：迁移路线图（Migration Roadmap）

> **目的**：把 02-target-architecture.md 的目标落到可执行的 PR 切片，按 ROI 排序，每个 PR 一个 conventional commit，每个 PR 有自测标准。
>
> **遵循**：`prd.md §TODO 拆分原则`（每个 PR 一件事、跨模块改动先 RFC、破坏性 API 改 CHANGELOG、MCP 改 mcp-compat 测试）+ `dev-handoff.md §TODO 拆分顺序`
>
> **约束**：每 PR 完成后 dev 自测通过 + tm 验收；RFC 72h 讨论窗口；任何破坏性 IPC/命令改名 → CHANGELOG 同步 + 旧命令保留一个 minor 版本

---

## 0. 总览

| 阶段 | 周数 | 主题 | 阻塞发布 |
|---|---|---|---|
| **M0** (W1–W2) | 2 | 工程化 + 决策拍板 | 否（基础设施） |
| **M1** (W3–W5) | 3 | TUI 完整档 + WSL/Docker 补齐 | 否（acceptance §A）|
| **M2** (W6–W9) | 4 | **MCP server 核心**（M6/M7） | **是** |
| **M3** (W10–W12) | 3 | 配置 toml + 热更新 + 自动更新 | 是 |
| **M4** (W13–W15) | 3 | 反向 SSH tunnel + 远程 agent (M8) | 是 |
| **M5** (W16–W17) | 2 | Store 打包 + 签名 + 隐私政策 | 是 |
| **M6** (W18–W19) | 2 | 体验补齐（路径检测 / 快捷键可配 / i18n）| 否 |
| **M7** (W20+) | 持续 | 公测 + bug 修复 + 准备 v1.1 | — |

**累计**：17 周 ≈ 4 个月到 MVP。

---

## M0 — 工程化（W1–W2）

> **目标**：把 xsterm 推到"可被外部贡献者无障碍参与 + 可被 AI agent 安全接入"的工程底线。

### PR-001：`chore(ci): bootstrap GitHub Actions`

**标题**：`ci: add GitHub Actions workflow (build + test + clippy + audit)`

**范围**：
- `.github/workflows/ci.yml`：触发 `push`/`pull_request` 到 `main` + `dev`
  - 矩阵 `windows-latest` + `macos-latest`（macOS 暂作 smoke build，不发包）
  - job: `npm ci` → `npm run build` → `cargo check --manifest-path src-tauri/Cargo.toml` → `cargo test --manifest-path src-tauri/Cargo.toml` → `cargo clippy --manifest-path src-tauri/Cargo.toml -- -D warnings` → `cargo audit`
- 缓存：`~/.cargo` + `node_modules` + `src-tauri/target`
- 必须 `npm run build` 通过（tsc + vite build）；前端 lint / format check 暂不强制（per dev-handoff）

**自测**：
- 推一个测试 PR，CI 全绿
- PR 中故意加 `cargo audit` 报错的旧版本 crate，确认 CI 失败

**RFC**：无

**owner**：dev

---

### PR-002：`docs: add LICENSE (MIT), NOTICE, CONTRIBUTING, SECURITY`

**标题**：`docs: add LICENSE, NOTICE, CONTRIBUTING, SECURITY (compliance §5)`

**范围**：
- `LICENSE`：MIT（合规清单 §5.1）
- `NOTICE`：先手动列核心依赖（tauri / portable-pty / russh / xterm.js / rmcp 等）的 SPDX；后续 `cargo-about` 自动生成
- `CONTRIBUTING.md`：开发流程 + conventional commits + PR 流程 + CLA（暂不要求）
- `SECURITY.md`：漏洞披露邮箱（security@xsterm.dev 站位）+ 90 天披露窗口 + 致谢墙
- `.well-known/security.txt` 暂不需要（站未上线）

**自测**：
- 阅读一遍，无占位符

**owner**：dev / pdm 联合（邮箱地址要 pdm 拍）

---

### PR-003：`chore(audit): integrate cargo-about + cargo-audit`

**标题**：`chore: integrate cargo-about NOTICE generation + cargo-audit gating`

**范围**：
- `cargo install --locked cargo-about cargo-audit`
- `.cargo/config.toml` 加 `[target.x86_64-pc-windows-msvc]` 暂不需要
- `xtask/about.toml`：cargo-about 配置；CI 跑 `cargo about generate --output NOTICE` 校验一致
- `cargo audit` 加入 CI（已在 PR-001）；`high/critical` 漏洞 fail

**自测**：
- `cargo about generate` 生成 NOTICE，与手写版本对比无差异
- 故意在 `Cargo.toml` 加一个有 known vuln 的旧版本 → CI fail

**owner**：dev

---

### PR-004：`refactor: extract tauri-specta bindings (optional)`

**标题**：`refactor(ipc): generate TS bindings for Tauri commands via tauri-specta`

**范围**（可选但强烈推荐）：
- `Cargo.toml` 加 `tauri-specta = { version = "2", features = ["derive", "typescript"] }`
- 给所有 `#[tauri::command]` 加 `#[tauri_specta::specta]` derive（不改函数体）
- 导出 `ts-bindings/` 到前端 `src/generated/tauri.ts`
- 渐进式：先把 session 相关 14 个命令做完，其他下一 PR

**自测**：
- 前端 `import { createSession } from "../generated/tauri"` 能用
- 故意改 Rust 侧参数名 → TS 编译失败（编译期类型安全兑现）

**owner**：dev

**决策点**：可推迟到 M2 起点（MCP 大量新命令需要类型安全）

---

### PR-005：`docs(rfcs): establish RFC process`

**标题**：`docs: add RFC template + 0001-0004 strategic decisions`

**状态**：✅ 已完成（pdm 2026-09-11 拍板 4 个决策，详见 `doc/adr/legacy-rfcs/`）

**范围**：
- `doc/adr/legacy-rfcs/README.md`：RFC 流程（提出 → 讨论 72h → 决议） — 待 PR 后续补
- `doc/adr/legacy-rfcs/0001-keep-tmux-cc.md`：拍 D-α（保留 -CC，对标 iTerm2）✅
- `doc/adr/legacy-rfcs/0002-mcp-single-binary.md`：拍 D-β（MVP 单二进制 + 内部模块）✅
- `doc/adr/legacy-rfcs/0003-config-toml-migration.md`：拍 D-γ（toml + 30 天回退）✅
- `doc/adr/legacy-rfcs/0004-product-naming.md`：拍 D-δ（保留 xsterm 品牌）✅

**自测**：
- README 里有可点击的目录
- 4 个 RFC 文件结构统一

**owner**：dev / tm / pdm 联合

---

### PR-006：`docs(privacy): add privacy policy (zh + en)`

**标题**：`docs: add privacy policy (zh + en) for Store submission`

**范围**：
- `docs/privacy-policy.md`（中英双语）
- 明确："此应用不收集任何用户数据"，例外只列自动更新（GitHub Releases URL）
- 占位邮箱 + 占位 URL；上线前 pdm 替换为真实值

**自测**：
- 中英文内容一致
- 阅读一遍，无占位符

**owner**：pdm / 法务（dev 协助格式）

---

## M0 自测整体标准

- ✅ CI 全绿
- ✅ README / CONTRIBUTING / SECURITY / LICENSE / NOTICE / privacy-policy 都齐全
- ✅ RFC 流程就位 + 4 个核心决策已拍板（这才能动 M1 之后的代码）

---

## M1 — TUI 完整档 + 多环境（W3–W5）

> **目标**：把 acceptance §A 的 P0（vttest ≥ 90%、TUI 兼容性）补齐；WSL 自动列出 + Docker exec 让 M2 完整。

### PR-101：`feat(terminal): add @xterm/addon-unicode11 + addon-image`

**标题**：`feat(terminal): enable unicode11 + image addons for full TUI compat`

**范围**：
- `package.json` 加 `@xterm/addon-unicode11`、`@xterm/addon-image`（后者对应 Kitty graphics）
- `src/components/Terminal.tsx` 加载两个 addon
- xterm.js Terminal options 启用 `allowProposedApi: true`（image addon 需要）
- 跑一遍 vttest，肉眼 / 解析日志验收

**自测**：
- vttest 通过率 ≥ 70%（基线）
- CJK / emoji / ZWJ 显示宽度正确
- 跑 https://github.com/kovidgoyal/kitty/tree/master/tools 下的图像测试程序，截图保留

**owner**：dev

---

### PR-102：`test(tui-compat): integrate vttest runner`

**标题**：`test: integrate vttest automated runner + 90% gate`

**范围**：
- 下载 vttest（开源 VT100/ANSI/VT420 测试套件）
- `test/tui-compat/run.ts`：启 Tauri app → 创建 local session → 跑 vttest → 解析 pass/fail → 报告
- CI 加 `tui-compat` job，阈值 < 90% fail
- doc：`doc/testing/tui-compat.md` 怎么本地跑

**自测**：
- 本地 `npm run test:tui-compat` 跑通
- CI job 出现在 workflow 中

**owner**：dev

---

### PR-103：`feat(wsl): auto-list WSL distros in profile selector`

**标题**：`feat(wsl): auto-list installed WSL distros via wsl -l -q`

**范围**：
- 新 Tauri 命令 `list_wsl_distros() -> Vec<WslDistro>`
- 后端跑 `wsl.exe -l -q` 解析输出（处理 Unicode 编码）
- `src/components/dialogs/WslSessionForm.tsx` 新建（下拉选择 distro，spec §create-session-config）
- `shellTemplate: "wsl"` + `wslDistro` 字段加入 `LocalSessionConfig`

**自测**：
- 在 Windows 测试机上：装 Ubuntu + Debian，确认下拉列出
- 选择后启动 session，prompt 是 Linux 提示符

**owner**：dev

---

### PR-104：`feat(docker): attach to running containers`

**标题**：`feat(docker): list running containers + exec bash into them (PRD M2)`

**范围**：
- 新依赖：`bollard`（bollard = Rust docker client；或 `shiplift`，bollard 更现代）
- `services/docker_session/mod.rs`：列出 containers / exec / PTY 转发
- `infrastructure/docker_backend.rs`：`DockerBackend` trait（与 PtySystem / SshBackend 对齐）
- `models/session.rs`：加 `SessionType::Docker { container_id, shell }`
- Tauri command：`list_docker_containers()` + `create_session(type="docker", container_id)`
- 复用 PTY 写入路径（bollard 的 `exec` 把 stdin/stdout 暴露为 stream）

**自测**：
- 本地 docker 起一个 ubuntu 容器，list 出来 → exec bash → 命令可执行
- 退出容器 → session close
- spec §acceptance E 通过

**owner**：dev

---

### PR-105：`feat(terminal): add path/URL detector on selection`

**标题**：`feat(terminal): detect path/URL on selection + show floating action button`

**范围**：
- `src/hooks/usePathUrlDetector.ts`：xterm.onSelectionChange → 正则匹配
  - URL：`^https?://[\w.-]+(/[\w./?=&%-]*)?$`
  - Windows 路径：`^[A-Z]:\\(?:[^\\/:*?"<>|\r\n]+\\)*[^\\/:*?"<>|\r\n]*$`
  - WSL 路径：`/mnt/[\w/]+`、`\\wsl$\Ubuntu\home\loner\...`
- `src/components/PathUrlPopover.tsx`：xterm DOM overlay，绝对定位
- 点击 URL → `invoke("plugin:opener|open_url", { url })`
- 点击路径 → 资源管理器（`explorer.exe <path>` 或 WSL 路径转换）

**自测**：
- 选中 `https://github.com` → 浮按钮出现 → 点击 → 浏览器打开
- 选中 `C:\Users\loner\file.txt` → 点击 → 资源管理器打开
- WSL 路径同上

**owner**：dev

---

### PR-106：`feat(shortcuts): make keymap configurable`

**标题**：`feat(shortcuts): extract keymap to config.toml + allow user override`

**范围**：
- `src/config/keymap.ts`：把硬编码的 `Ctrl+T/W/Shift+D/E/...` 提取出来
- `config.toml [keymap]` 段：用户可覆盖
- `src/components/settings/ShortcutsTab.tsx`：UI 改键（点 key → 按新键 → 保存）
- 设计系统约束：键名用 `KeyboardEvent.code`（位置无关）or `.key`（字符相关）—— 选 `.code`

**自测**：
- 默认 keymap 与 xsterm 现有行为一致（无回归）
- 改 `Ctrl+T` → `Ctrl+Shift+N`，重启后保留
- vim 中按 Ctrl+T 不新建标签页（spec §M5）

**owner**：dev

---

## M1 自测整体标准

- ✅ vttest 通过率 ≥ 90%（CI gate）
- ✅ CJK / emoji / Kitty graphics 在 PowerShell + WSL 都正常
- ✅ WSL 自动列出 + Docker exec 都可用
- ✅ 路径/URL 悬浮按钮工作
- ✅ 快捷键可配，UI 改键不破坏 xsterm 现有行为
- ✅ acceptance §A、§C、§D、§E 全部 🔍 项通过

---

## M2 — MCP server 核心（W6–W9）⭐

> **目标**：把规格 mcp.md 的 12 个工具全部实现；本地 AI 接管 UI；端到端 Claude Desktop 验证。
>
> 这是 **MVP 阻塞项**。

### PR-201：`feat(mcp): scaffold xsterm-mcp binary + stdio transport`

**标题**：`feat(mcp): scaffold xsterm-mcp.exe sub-process + stdio JSON-RPC transport`

**范围**：
- `Cargo.toml`：`bin = ["xsterm-mcp"]` + 加 `bin/xsterm-mcp.rs`
- `src-tauri/src/bin/xsterm-mcp.rs`：parse `--stdio` / `--http`
- `src-tauri/src/mcp_server/transport/stdio.rs`：newline-delimited JSON-RPC 解析
- `src-tauri/src/mcp_server/mod.rs`：暴露 `run_stdio()` 给 bin
- 暂时只实现 `tools/list` 返回空（验证管道通）

**自测**：
- `xsterm-mcp --stdio` 启起来
- 用 `printf '{"jsonrpc":"2.0","id":1,"method":"tools/list"}\n' | xsterm-mcp --stdio` 收到空数组响应
- CI 跑 lint + 编译

**owner**：dev

---

### PR-202：`feat(mcp): implement main process ↔ sub-process RPC protocol`

**标题**：`feat(mcp): implement bidirectional IPC between xsterm.exe and xsterm-mcp.exe`

**范围**：
- `src-tauri/src/mcp_server/ipc/mod.rs`：协议定义（call / response / notify）
- `src-tauri/src/mcp_server/ipc/server.rs`：主进程侧 handler；嵌入到 SessionManager 生命周期
- `src-tauri/src/mcp_server/ipc/client.rs`：子进程侧 caller
- `lib.rs::run()` 在 SessionManager 初始化后启 `xsterm-mcp.exe` 子进程
- 验证子进程能调 `list_sessions` 拿到主进程的 sessions

**自测**：
- `xsterm.exe` 启起来 → child 启起来
- 主进程 create 一个 local session → 子进程收 `list_sessions` 返回 1 个 session
- 杀掉主进程 → 子进程退出码 0

**owner**：dev

---

### PR-203：`feat(mcp): implement list_sessions + create_session + close_session`

**标题**：`feat(mcp): implement list/create/close session tools`

**范围**：
- `mcp_server/tools/list_sessions.rs`：按规格 §3.1（含 filter）
- `mcp_server/tools/create_session.rs`：按规格 §3.2（含 type / profile / cwd / env / ssh / docker / tmux）
- `mcp_server/tools/close_session.rs`：按规格 §3.3（含 force / attached 检查）
- `models/session.rs` 加 `SessionInfo.mcp_session_id` + 双向索引
- `models/profile.rs`：`Profile` struct

**自测**（**MCP 协议兼容性**）：
- `cargo test -p mcp_compat`：跑 12 个工具的 schema / 入参校验 / 错误码路径
- Python `mcp` SDK 连入，list / create / close 各跑 1 次成功
- 错误码：`SESSION_NOT_FOUND`、`PROFILE_NOT_FOUND`、`SSH_AUTH_FAILED`、`QUOTA_EXCEEDED` 全部覆盖

**owner**：dev

---

### PR-204：`feat(mcp): implement send_keys + capture_screen`

**标题**：`feat(mcp): implement send_keys (text + KeySpec) + capture_screen (text/ansi/screenshot)`

**范围**：
- `mcp_server/tools/send_keys.rs`：
  - `text` 路径：UTF-8 编码 + `bracketed=true` 包 `\x1b[200~...\x1b[201~`
  - `keys: KeySpec[]`：解析 `char / key / combo / raw`，delay_ms 用 `tokio::time::sleep`
  - 破坏性快捷键白名单（`mcp.destructive_keys.policy`）：默认 deny
- `services/capture/mod.rs`：capture_text 走前端（off-screen grid），capture_screenshot 走 xterm.js
- `mcp_server/tools/capture_screen.rs`：后端 stub（仅 tmux 走 capture-pane）；其他返回让前端处理

**自测**：
- `send_keys(text="echo hello\n")` → `capture_screen` 看到 hello
- `send_keys(keys=[{type:"key", value:"Enter"}])` → 触发 Enter
- `send_keys(keys=[{type:"combo", modifiers:["Ctrl"], value:"C"}])` 未 attach 时 → PERMISSION_DENIED
- screenshot mode < 500ms（性能预算）

**owner**：dev

---

### PR-205：`feat(mcp): implement subscribe_output + unsubscribe_output + ring buffer`

**标题**：`feat(mcp): add OutputRing with sequence numbers + subscribe/unsubscribe`

**范围**：
- `services/subscribe/output_ring.rs`：100000 行环形缓冲 + AtomicU64 序号
- `services/subscribe/manager.rs`：订阅者注册 / 派发
- `mcp_server/tools/subscribe_output.rs`：按规格 §3.6（含 `from_sequence`、`include_ansi`、`buffer_size`）
- `mcp_server/tools/unsubscribe_output.rs`
- 主进程 → 子进程 `notify` 通道：推送 `notifications/output` 消息

**自测**：
- 长输出命令（`find /`）→ 订阅端按 seq 顺序收到增量，不丢不重
- 客户端断 → 重连 with `from_sequence=12345` → 从断点续传
- 缓冲满 → 收到 `output-overflow` + `full` 字段

**owner**：dev

---

### PR-206：`feat(mcp): implement attach_session + detach_session + state machine`

**标题**：`feat(mcp): implement attach/detach state machine + 60min idle release`

**范围**：
- `services/attach/mod.rs`：`attach_state: DashMap<u32, AttachState>` + CAS 操作
- `mcp_server/tools/attach_session.rs`：规格 §3.8（含 force）
- `mcp_server/tools/detach_session.rs`
- 后台 task：每分钟扫描超时的 attach + auto-release
- `SessionManager::write()` 路径加 attach 检查
- agent 失联（stdio EOF / HTTP stream 关闭）→ auto-detach

**自测**：
- attach session_A → send_keys 成功
- attach session_A → agent_B 尝试 attach → SESSION_ALREADY_ATTACHED
- attach → force=true → ALREADY_ATTACHED_FORCED
- 模拟 60min 空闲 → 自动 detach + 触发事件

**owner**：dev

---

### PR-207：`feat(mcp): implement wait_for + list_profiles + get/set_config`

**标题**：`feat(mcp): implement wait_for pattern matching + profile/config tools`

**范围**：
- `mcp_server/tools/wait_for.rs`：基于 subscribe_output + 内部 regex（`regex` crate）；timeout_ms < 60000
- `mcp_server/tools/list_profiles.rs`
- `mcp_server/tools/get_config.rs` + `set_config.rs`：白名单字段（`mcp.destructive_keys.policy`、`mcp.http.enabled`、`mcp.http.port`、`mcp.idle_timeout_seconds`、`terminal.copy_on_select`、`terminal.bracketed_paste_default`）

**自测**：
- `wait_for(pattern="READY", timeout=10)` 立即匹配返回
- `wait_for` 超时返回 WAIT_TIMEOUT + elapsed_ms
- `set_config(patches=[{op:"set", path:"mcp.idle_timeout_seconds", value:1800}])` 成功
- `set_config(patches=[{op:"set", path:"ssh.host_key_verify", value:false}])` 失败（非白名单）

**owner**：dev

---

### PR-208：`feat(mcp): HTTP transport + Bearer token`

**标题**：`feat(mcp): add HTTP streamable transport (127.0.0.1 only) + token auth`

**范围**：
- `mcp_server/transport/http.rs`：axum + tower-http
- `POST/GET/DELETE /mcp`：Streamable HTTP 协议
- 启动时生成 256-bit 随机 → 写 `%APPDATA%\xsterm\mcp.token` (0600)
- Bearer token 在 `Authorization: Bearer <token>` 校验
- 默认关闭；`config.toml [mcp.http].enabled=true` 才启

**自测**：
- 启用 → `curl -H "Authorization: Bearer <token>" http://127.0.0.1:19847/mcp` 200
- 无 token / 错 token → 401
- 端口扫描：启用后 netstat 看到 127.0.0.1:19847；禁用后无

**owner**：dev

---

### PR-209：`feat(mcp): add capability + rate limiting + audit log`

**标题**：`feat(mcp): add capability permissions + rate limiting + audit log`

**范围**：
- `src-tauri/capabilities/mcp-stdio.json`：MCP stdio 端点的 capability 声明
- `mcp_server/rate_limit.rs`：100 req/s per MCP session（`governor` crate 或手写 token bucket）
- `mcp_server/audit.rs`：默认关闭；`config.toml [mcp].audit.enabled=true` 时写 `%LOCALAPPDATA%\xsterm\audit.log`，7 天清理；参数 hash 不写明文

**自测**：
- 100 req/s 内放行；超过返回 RATE_LIMITED
- 审计开 → 创建 session 后 `audit.log` 有记录；参数 hash 不可逆
- 审计关 → 无日志

**owner**：dev

---

### PR-210：`feat(mcp-compat): add mcp-compat integration test suite`

**标题**：`test: add mcp-compat test suite (Python SDK round-trip)`

**范围**：
- `test/mcp-compat/`：Python 脚本，用官方 `mcp` SDK 连 stdio
- 跑全部 12 个工具 + 错误码覆盖
- CI 加 `mcp-compat` job

**自测**：
- 本地跑通
- CI 通过

**owner**：dev

---

### PR-211：`feat(ui): AI takeover button + banner + release command`

**标题**：`feat(ui): AI takeover UI (button + banner + release key sequence)`

**范围**：
- `src/components/ai/AiTakeoverButton.tsx`：每个 pane 右键菜单 / 顶部按钮
- `src/components/ai/AiTakeoverBanner.tsx`：顶部 banner，显示 agent 名 + 释放口令
- `src/hooks/useAttachState.ts`：订阅 attach 状态 + 自动屏蔽键盘
- 释放口令：默认 `ctrl-cmd-ai-release`（xterm key 序列）；用户在配置可改
- `src/components/ai/AiTakeoverConfig.tsx`：UI 配置页

**自测**：
- 点按钮 → 后端调 `attach_session` → banner 出现 + 用户键盘被屏蔽
- 在终端输入 `ctrl-cmd-ai-release` → banner 消失 + 键盘恢复
- UI 点"释放" → 同上

**owner**：dev

---

### PR-212：`test(e2e): Claude Desktop end-to-end smoke`

**标题**：`test: Claude Desktop end-to-end smoke (create tab → run ls → read output)`

**范围**：
- 文档：`docs/mcp/claude-desktop.md`：详细配置步骤
- 手动 checklist（acceptance §B 🔍 Claude Desktop 端到端）
- 自动化（可选）：用 mock claude-desktop config + 跑 Python MCP client

**自测**：
- 配置 stdio → Claude Desktop 重启看到工具列表
- 让 Claude "在终端里运行 ls" → 真的运行并返回结果
- Cursor / Codex 同上（各跑 1 次）

**owner**：dev / tm 联合

---

## M2 自测整体标准（MVP 阻塞）

- ✅ MCP 12 个工具全部实现 + 协议兼容测试通过
- ✅ stdio + HTTP 端点都通
- ✅ Claude Desktop + Cursor + Codex 端到端各跑通 1 次
- ✅ 本地 AI 接管 UI 完整
- ✅ acceptance §B 全绿
- ✅ attach/detach 状态机覆盖所有路径

---

## M3 — 配置 toml + 自动更新（W10–W12）

> **目标**：把 `tauri-plugin-store` JSON 迁到 `config.toml`；加自动更新；建文档站。

### PR-301：`feat(config): migrate tauri-plugin-store → config.toml`

**标题**：`feat(config): migrate persistence from tauri-plugin-store JSON to config.toml`

**范围**：
- `Cargo.toml` 加 `serde = { features = ["derive"] }`、`toml = "0.8"`、`notify = "6"`
- `services/config/mod.rs`：`Config` struct（`#[derive(Deserialize, Serialize)]`）+ `load() / save() / watch()`
- `services/config/migration.rs`：从 `sessions.json / settings.json / groups.json / attached_tmux.json` 迁过来
- `lib.rs::run()` 启动时：检测 config.toml 缺失 + 旧 store 存在 → 调 migration → 写 config.toml
- 旧 JSON 保留 30 天后清理（mark file `.xsterm-migrated`）
- 前端 `useSessionPersistence` 改成走 config 命令（新增 `get_config` / `set_config` Tauri command，区别于 MCP get_config）

**自测**：
- 现有用户的 sessions.json 自动迁移成功
- 迁移后所有 profile / group / attached_tmux 都还在
- 删除 config.toml → 回退到 JSON（验证迁移可逆）

**owner**：dev

---

### PR-302：`feat(config): hot reload via notify watch`

**标题**：`feat(config): watch config.toml for external edits + hot reload`

**范围**：
- `notify 6.x` 监听 config.toml
- 修改后重新 parse → schema 校验 → 通知前端 / SessionManager
- 校验失败 → 拒绝更新 + UI toast（不重启）
- 防抖：500ms 内多次修改只 reload 一次

**自测**：
- 外部修改 `config.toml [general]theme = "dark"` → <1s 内 UI 反映（acceptance §M9）
- 故意写非法 TOML → toast 显示错误，旧配置保留

**owner**：dev

---

### PR-303：`feat(updater): integrate tauri-plugin-updater`

**标题**：`feat(updater): integrate tauri-plugin-updater with Store + GitHub channel`

**范围**：
- `Cargo.toml` 加 `tauri-plugin-updater = "2"`
- `tauri.conf.json` 加 `bundle.updater` 段
- `src-tauri/capabilities/default.json` 加 `updater:default` 权限
- `src/components/updater/UpdaterPanel.tsx`：UI 显示新版本 + 下载进度 + 重启按钮
- `config.toml [updater]` 切换 channel（store / github / disabled）

**自测**：
- 模拟有新版本 → UI 提示 → 下载 → 重启
- 关闭 channel → 不检查

**owner**：dev

---

### PR-304：`chore(signing): generate minisign keypair + sign GitHub Releases`

**标题**：`chore(updater): sign releases with minisign`

**范围**：
- 生成 minisign 密钥对，私钥存 GitHub Secrets
- 发布流程：`cargo tauri build` → `minisign -s` 签名 → 上传 .msix + .sig
- 文档：`docs/release-process.md`

**自测**：
- 用 `tauri-plugin-updater` 校验签名通过

**owner**：dev / pdm 联合（密钥管理）

---

### PR-305：`feat(ssh): enable host key verification (configurable)`

**标题**：`feat(ssh): enable host key verification with known_hosts + interactive prompt`

**范围**：
- 复用 russh-keys `parse_known_hosts` + 写回
- 首次连接：UI prompt（trust / reject）
- 主机密钥变更：UI warning（防中间人）
- `config.toml [ssh].host_key_verify`：`off | ask | strict`
- 默认 `ask`（替换 AGENTS.md 标注的"已知 gap"）

**自测**：
- 首次连新主机 → prompt 出现 → 选 trust → 写入 known_hosts
- 主机 key 变化 → warning
- `off` 模式仍工作（旧行为兼容）

**owner**：dev

---

### PR-306：`docs: bootstrap docs/ VitePress site`

**标题**：`docs: bootstrap VitePress documentation site`

**范围**：
- `docs/` 初始化（VitePress）
- `docs/index.md` + `quickstart.md` + `install/windows.md`
- `docs/mcp/index.md` + `mcp/tools.md`
- `docs/security.md` + `privacy-policy.md` + `contributing.md` + `changelog.md`
- 部署：GitHub Pages（`docs/.github/workflows/deploy.yml`）
- README 顶部链接

**自测**：
- 本地 `npm run docs:dev` 可访问
- 所有页面无 broken link

**owner**：dev

---

## M3 自测整体标准

- ✅ 配置迁移无数据丢失
- ✅ 热更新 <1s 反映
- ✅ 自动更新通道切换正常 + 签名验证通过
- ✅ SSH host key 验证开启（覆盖已知 gap）
- ✅ 文档站上线 + 中英双语隐私政策可访问

---

## M4 — 反向 SSH tunnel + 远程 agent（W13–W15）

> **目标**：让远端 agent 通过反向 SSH 隧道操作本机 terminal。

### PR-401：`feat(tunnel): implement russh reverse tunnel`

**标题**：`feat(tunnel): russh-based reverse SSH tunnel (ssh -R equivalent)`

**范围**：
- `Cargo.toml` 加 `russh = "0.50"`（已有，可能需要新版本）+ `russh-sftp = "0.50"`（可选）
- `services/tunnel/reverse.rs`：用 russh 发起 `-R` 等价通道
- `services/tunnel/reconnect.rs`：指数退避 1s/2s/4s/8s/16s，最多 5 次
- `services/tunnel/config.rs`：远端 host / user / port 白名单
- Tauri command：`start_tunnel(config)` / `stop_tunnel()` / `tunnel_status()`

**自测**：
- 启隧道 → 远端 `curl http://127.0.0.1:19847/mcp` 成功
- 断网 → 自动重连 5 次
- 第 6 次仍失败 → UI 提示 + 暂停

**owner**：dev

---

### PR-402：`feat(tunnel): generate tunnel scripts (PS + bash)`

**标题**：`feat(tunnel): generate one-click tunnel scripts (PowerShell + bash)`

**范围**：
- `src/components/mcp/McpTunnelScripts.tsx`：UI 生成脚本
- 脚本内容：`ssh -R 19847:127.0.0.1:19847 user@server`
- PowerShell + bash 两版本
- 可选：`ssh -o ProxyCommand=...` 走代理

**自测**：
- 生成的 .ps1 / .sh 双击能跑（手动测）
- 文档：`docs/mcp/reverse-tunnel.md`

**owner**：dev

---

### PR-403：`feat(tunnel): integrate HTTP MCP server over tunnel`

**标题**：`feat(mcp): enable HTTP MCP endpoint for remote agent via tunnel`

**范围**：
- 复用 PR-208 的 HTTP 端点
- 配置示例：`config.toml [mcp.http].enabled=true`，让 tunnel 把端口暴露到远端
- 文档：远端 agent 配置 `url: "http://127.0.0.1:19847/mcp" + Authorization: Bearer <token>`

**自测**：
- 跨机器操作：远端主机 A → 反向隧道 → 本机 xsterm MCP → 本地 terminal
- 真实 SSH server 跑过

**owner**：dev / tm

---

### PR-404：`test(e2e): remote agent end-to-end (acceptance §B 🔍)`

**标题**：`test: remote agent end-to-end via reverse tunnel`

**范围**：
- 跨机器：本地 + 1 台 VM
- tunnel 启起来 → 远端调 `list_sessions` 拿到本机 sessions
- 远端 `attach_session` → `send_keys` → `capture_screen` 看到结果

**自测**：acceptance §B "反向 SSH tunnel 远端 agent" 项通过

**owner**：dev / tm 联合

---

## M4 自测整体标准

- ✅ 反向隧道建立 + 自动重连
- ✅ 远端 agent 通过隧道操作成功
- ✅ acceptance §B / §G 反向隧道项通过

---

## M5 — Store 打包 + 签名（W16–W17）

> **目标**：通过 Microsoft Store 审核。

### PR-501：`chore(msix): configure MSIX bundle target`

**标题**：`chore(bundle): add MSIX build target + signing config`

**范围**：
- `tauri.conf.json` 加 `bundle.targets.msix` 配置
- CI 加 `cargo tauri build --target msix` job（windows-latest）
- 产物 < 50MB（acceptance §F）

**自测**：
- 本地 `cargo tauri build` → .msix 生成
- 双击 .msix → 安装成功

**owner**：dev

---

### PR-502：`chore(signing): apply partner center signing`

**标题**：`chore(signing): apply Microsoft Partner Center signing`

**范围**：
- 申请 Partner Center 账号（pdm / 法务）
- 上传 .msix → partner center 签名
- 文档：`docs/release-process.md`

**自测**：
- 签名后的 .msix 双击无 SmartScreen 警告

**owner**：dev / pdm / 法务

---

### PR-503：`docs(store): store listing assets + metadata`

**标题**：`docs(store): prepare Microsoft Store listing assets`

**范围**：
- 应用截图（800×480 / 1366×768 至少 1 张）
- 应用描述（中英）
- 应用图标（已存在）
- 隐私政策 URL（已就绪）
- 类别：Developer Tools
- 年龄分级：Everyone

**自测**：
- 提交 Partner Center 静态分析通过

**owner**：pdm / dev

---

### PR-504：`test(store): WACK / Partner Center static + dynamic analysis`

**标题**：`test: pass App Certification Kit (WACK) + Partner Center analysis`

**范围**：
- 跑 App Certification Kit
- 通过所有静态分析（性能 / 稳定性 / 安全性 / 资源使用）
- 通过动态分析（启动 / 关闭 / 更新）

**自测**：
- WACK 全绿
- acceptance §F 全绿

**owner**：dev / tm 联合

---

## M5 自测整体标准

- ✅ MSIX 打包 + 签名通过
- ✅ Partner Center 审核通过
- ✅ Store 上架可被搜索下载
- ✅ acceptance §F / §J 全绿

---

## M6 — 体验补齐（W18–W19）

> **目标**：非阻塞项，但用户体感重要。

### PR-601：`feat(i18n): extract UI strings to i18next (zh-CN + en-US)`

**标题**：`feat(i18n): i18next integration + zh-CN + en-US full coverage`

**范围**：
- 加 `react-i18next` + `i18next`
- 抽出所有硬编码英文字符串到 `src/i18n/{zh-CN,en-US}.json`
- 启动时根据系统 locale 自动选；用户可手动覆盖
- 验收：切换语言立即生效（acceptance §I）

**自测**：
- en-US 全覆盖
- zh-CN 全覆盖
- 切换语言 < 100ms 生效

**owner**：dev

---

### PR-602：`feat(a11y): screen reader + high contrast theme`

**标题**：`feat(a11y): NVDA screen reader support + high contrast theme`

**范围**：
- 标签页 title / 菜单可达（aria-label / role）
- 高对比度主题（`config.toml [general].theme = "high-contrast"`）
- WCAG AA 颜色对比审计
- 字体缩放 100% / 125% / 150% / 200%

**自测**：
- NVDA 测试：标签页切换 / 菜单可达
- 字体 200% 时所有 UI 可读

**owner**：dev

---

### PR-603：`feat(recording): session recording as asciinema (SHOULD)`

**标题**：`feat(recording): session recording in asciinema format (SHOULD)`

**范围**：
- 复用 `services/session_log.rs` 现有功能
- 输出 `.cast` 文件（asciinema v2 格式）
- 录制 / 停止按钮

**自测**：
- 录制 → 输出 .cast 文件
- asciinema player 能播放

**owner**：dev

---

### PR-604：`chore(perf): final perf benchmark + regression gate`

**标题**：`chore(perf): benchmark script + CI regression gate`

**范围**：
- `test/perf/bench.ts`：冷启动 / cat 1GB / 100 sessions 内存
- 跑现有 perf.md 11 项
- CI 加 perf job（fail if regression > 20%）

**自测**：
- 冷启动 < 1.5s
- 内存 baseline < 150MB
- acceptance §H 全绿

**owner**：dev

---

### PR-605：`chore(readme): refresh README + add "AI Terminal" branding`

**标题**：`chore: README refresh + dual branding (xsterm + AI Terminal)`

**范围**：
- 顶部加"AI Terminal (xsterm) — Windows-first AI-native terminal emulator"
- 截图 + GIF
- 快速开始 → docs/quickstart.md
- MCP 集成示例链接

**自测**：阅读一遍

**owner**：dev / pdm

---

## M6 自测整体标准

- ✅ i18n zh-CN + en-US 全覆盖
- ✅ 屏幕阅读器 + 高对比度 + 字体缩放
- ✅ 性能预算全绿
- ✅ README 整洁

---

## M7 — 公测（W20+）

> 持续：bug 修复 + 准备 v1.1

### 流程

- 公测用户通过 Store 下载
- bug 报告 → `doc/changelog/bugs.md` 按现有格式记录
- 0 P0 bug 跑过 4 周 = 成功标准 §11
- 收集 v1.1 需求

---

## 风险登记表

| 风险 | 概率 | 影响 | 缓解 |
|---|---|---|---|
| M2 MCP 子进程调试复杂 | 中 | 高 | RFC-0002 提前讨论；早期端到端 demo |
| M3 配置迁移用户数据丢失 | 中 | 高 | 保留 JSON 30 天 + 一键回退 + 全量 E2E 测 |
| M4 反向隧道企业网络受限 | 高 | 中 | 文档明示；提供 `--http-port` 自定义 |
| M5 Store 审核被拒 | 中 | 高 | 预留 2 周缓冲（PRD §R6）；提前跑 WACK |
| 跨 PR 架构 drift | 中 | 中 | 每个 PR 配 RFC；每阶段末 arch-map 更新 |
| Tauri 2 plugin 版本 pin 漂移 | 低 | 中 | Cargo.lock 锁 minor；每季度 review |
| CSP 重启用破坏现有 UI | 中 | 中 | M0 加 nonce strategy 验证 |

---

## 跨 PR 关注点

- **AGENTS.md gotchas**：每个 PR 都涉及
  - Tauri v2 capability 必须三件套（crate + plugin 注册 + 权限）
  - `invoke()` 不是类型安全的（除非上了 PR-004 tauri-specta）
  - 版本同步（package.json / Cargo.toml / tauri.conf.json）
- **设计系统约束**：所有 UI PR 跑 pre-commit grep（AGENTS.md §Design System）
- **perf.md baseline**：所有 IPC / session I/O PR 不能引入新瓶颈
- **bug.md**：修 bug 必须更新 bug.md

---

## 给 tm 的验收 checklist（按阶段）

- [ ] M0：CI 全绿 + RFC 4 个拍板 + LICENSE/NOTICE/PRIVACY 就位
- [ ] M1：vttest ≥ 90% + WSL/Docker/路径检测/快捷键可配
- [ ] M2：MCP 12 工具 + Claude Desktop 端到端 + AI 接管 UI
- [ ] M3：配置迁移无丢失 + 自动更新可用 + 文档站上线
- [ ] M4：反向隧道端到端
- [ ] M5：Store 上架
- [ ] M6：i18n + a11y + 性能
- [ ] M7：0 P0 bug 跑 4 周

---

文档结束。**下一步**：dev 按 PR-001 → PR-605 顺序执行；tm 按 M0–M7 阶段验收。