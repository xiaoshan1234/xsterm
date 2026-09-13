# xsterm → ai-terminal：缺口分析（Gap Analysis）

> **目的**：把 ai-terminal 规格（PRD + mcp.md + acceptance.md + compliance.md + mvp-checklist.md）逐条映射到 xsterm 当前仓库，明确"已有 / 部分有 / 没有"的状态，作为迁移路线（02）和架构目标（03）的输入。
>
> **版本**：xsterm 0.1.3（截至 2026-09 调研）
>
> **范围**：本次调研基于源码 + 已读文档（AGENTS.md / architecture-map.md / design-system.md / req-006-tmux.md / bug.md / perf.md / models/session.rs / services/session_manager.rs / services/tmux/* / commands/* / tauri.conf.json / capabilities/default.json）。未深入读的代码在每项末尾以"⚠️ 待核"标注。

---

## 0. 一句话结论

**xsterm 在"终端内核 + UI 壳"层面已经覆盖 ai-terminal 70% 的能力，但在"产品差异化（AI agent 接入）+ 商业化（Store 上架）+ 工程化（配置 / 文档 / 安全 / 自动化）"三个维度几乎是空白**。这是一次"补差异化 + 加商业化层"的演进，不是重写。

---

## 1. 资产盘点（xsterm 现状）

| 维度 | 现状 | 评估 |
|---|---|---|
| **桌面壳** | Tauri 2 + WebView2 + 自定义标题栏（`decorations: false`） | ✅ 完全可用 |
| **终端渲染** | xterm.js 6 + `@xterm/addon-fit` | ✅ 满足 MVP 渲染（缺 webgl / search / serialize / image / unicode11 addon） |
| **本地 PTY** | `portable-pty 0.8` + ConPTY/winpty 适配 | ✅ 满足 M2（PowerShell/CMD/WSL） |
| **SSH** | `russh 0.50-beta.7` + 私有字段丰富（keepalive / TCP_NODELAY / 压缩 / proxy_jump） | ✅ 满足 M2（SSH） |
| **tmux -CC** | 自研控制器（3622 行 controller.rs + parser + dispatch + commands + events + escape），N panes per controller，SSH 上的 tmux 走 exec channel | ✅ **超出规格**（规格只要求 `tmux new -s name` 简单模式；xsterm 已实现完整 control mode） |
| **Session 管理** | `SessionManager`（2717 行）+ DashMap + AtomicU32 + `SessionBackend` trait + mockall 测试 | ✅ 性能基础好（Perf 004 已解决全局锁） |
| **前端状态** | React Context（11 文件按职责拆分，最大 370 行）+ `useSessionState` / `useSessionLifecycle` / `usePaneActions` 等 | ✅ 架构清晰，可扩展 |
| **UI 设计系统** | Cursor 暗色 IDE 适配版（design-system.md + global.css token + 5 个 ANSI 主题） | ✅ 与规格无冲突（规格未规定 UI 风格） |
| **性能** | Perf 001-011 已识别并修复多个瓶颈（binary Channel、flush 取消、rAF 批处理、DashMap 化） | ✅ I/O 主路径已优化 |
| **历史 Bug 治理** | bug.md 持续维护（最近修复 Bug 005 输入延迟） | ✅ 工程纪律好 |

---

## 2. 缺口矩阵（ai-terminal MUST × xsterm 现状）

### M1. 标签页 + 多窗口

| 规格项 | xsterm 现状 | 状态 | 备注 |
|---|---|---|---|
| 多标签页（Ctrl+T / W / 1-9） | ✅ 有 TabBar + WindowTabBar；快捷键 ⚠️ 待核 | 🟢 部分有 | 快捷键需确认是否真绑定；规格还要"拖拽排序"——xsterm 已支持（`reorderWindows`） |
| 单标签页分屏（最多 4 pane） | ✅ `splitPane` + Ctrl+Shift+D/E ⚠️ 待核 | 🟢 部分有 | 4 pane 上限未硬编码（`paneUtils.ts` 不限），建议加 |
| 标签页拖拽排序 | ✅ 已实现 | 🟢 已完成 | |
| 标签页右键菜单（重命名/复制/拆分/关闭） | ✅ `paneContextMenu.ts` 提供 split/close | 🟢 部分有 | "复制"动作未实现，需补 |

### M2. 执行环境（5 种）

| 规格项 | xsterm 现状 | 状态 | 备注 |
|---|---|---|---|
| PowerShell 7（默认） | ✅ `shellTemplate: "powershell"`，PATH 探测 `pwsh.exe` → `powershell.exe` | 🟢 已完成 | |
| CMD | ✅ `shellTemplate: "cmd"` | 🟢 已完成 | |
| WSL（自动列出） | ⚠️ `shellTemplate: "wsl"` 存在但未自动列出发行版 | 🟡 部分有 | 规格要求"profile 选择器列出 `wsl -l -q`"，xsterm 是手填路径 |
| SSH（密码 + 私钥） | ✅ 完整实现（含 keepalive / 压缩 / agent） | 🟢 已完成 | |
| tmux session 映射（detach 保留） | ✅ **超出规格**：xsterm 完整实现 `tmux -CC`，attach 已有 server 后 pane 状态完整保留 | 🟢 已完成 | |
| Docker 容器 attach | ❌ **没有** | 🔴 缺失 | 规格 M2 列了；xsterm 没有 docker exec 模块 |

### M3. TUI 兼容性（完整档）

| 规格项 | xsterm 现状 | 状态 | 备注 |
|---|---|---|---|
| 24-bit true color | ✅ xterm.js 6 默认支持 | 🟢 已完成 | |
| 256 color fallback | ✅ xterm.js 6 默认 | 🟢 已完成 | |
| 鼠标协议（X10/SGR/SGR-Pixels/urxvt） | ✅ xterm.js 6 | 🟢 已完成 | |
| Bracketed paste | ⚠️ xterm.js 6 默认启用；但 xsterm 用了 `pasteConfirm.ts` 拦截——需确认不会被拦截吃掉 | 🟡 待核 | 见 ⚠️ 1 |
| Kitty graphics protocol | ❌ 没装 `@xterm/addon-image` | 🔴 缺失 | 需加 addon |
| 完整 Unicode（宽字符 / emoji / CJK / 零宽） | ⚠️ 没装 `@xterm/addon-unicode11` | 🔴 缺失 | vttest 会挂 |
| 备用屏幕切换 | ✅ xterm.js 6 默认 | 🟢 已完成 | |
| OSC 0/1/2/4/7/8/10/11/12/52 | ✅ xterm.js 6 默认；52 已有 `extractAndCopyOsc52` | 🟢 已完成 | |
| **vttest ≥ 90%** | ⚠️ 没看到测试套件 | 🔴 缺失 | 需引入 `vttest` + Rust 集成测试（acceptance.md §A） |

### M4. 复制粘贴

| 规格项 | xsterm 现状 | 状态 | 备注 |
|---|---|---|---|
| 选中即复制 | ✅ xterm.js + clipboard plugin | 🟢 已完成 | |
| Ctrl+Shift+C/V | ⚠️ xterm.js 内置；xsterm 通过 clipboard plugin 暴露 | 🟡 部分有 | 需确认快捷键不与 OS 冲突 |
| 右键菜单（复制/粘贴/全选） | ⚠️ `paneContextMenu` 存在但功能不同 | 🟡 部分有 | 需加 clipboard 集成 |
| 多行粘贴检测（弹提示） | ✅ `pasteConfirm.ts` + `PasteConfirmDialog.tsx`（独立模块） | 🟢 已完成 | |
| 自动 trim | ⚠️ 见 `pasteConfirm.ts` 行为 ⚠️ 待核 | 🟡 待核 | |
| ANSI 剥离（粘贴到 nano 不触发按键） | ⚠️ xterm.js bracketed paste 默认包 ESC | 🟡 待核 | 需确认 `pasteConfirm` 不破坏 |
| 路径 / URL 检测（悬浮按钮） | ❌ 没实现 | 🔴 缺失 | 需加 detector hook |

### M5. 快捷键

| 规格项 | xsterm 现状 | 状态 | 备注 |
|---|---|---|---|
| 标签页 Ctrl+T/W/Tab/1-9 | ⚠️ 不在已有快捷键列表里；`useCommandTargets` / `SettingsView` 显示快捷键列表但未确认全绑定 | 🟡 待核 | 需 audit |
| 分屏 Ctrl+Shift+D/E/W | ⚠️ 同上 | 🟡 待核 | |
| 跳转 Ctrl+Shift+方向键 | ⚠️ | 🟡 待核 | |
| 全局无冲突设计 | ✅ Bug 005 已优化输入路径 | 🟢 已完成 | |
| 用户可覆盖（settings.json） | ❌ 快捷键硬编码；仅主题 + 字体可配 | 🔴 缺失 | 需加 keymap 配置层 |

### M6. MCP server ⭐（核心差异化）

| 规格项 | xsterm 现状 | 状态 | 备注 |
|---|---|---|---|
| stdio MCP server | ❌ 完全没有 | 🔴 缺失 | 核心差异化 |
| Streamable HTTP 端点 | ❌ | 🔴 缺失 | |
| list_sessions | ⚠️ 后端有 `list_sessions` 命令 + 前端 wrapper | 🟢 部分有 | 但参数不匹配规格（filter 字段缺失） |
| create_session | ⚠️ 后端有 `create_session`，前端 wrapper 不带 type 字段 | 🟡 部分有 | 规格要求 `type: "tab" \| "pane" \| "ssh" \| ...`；xsterm 是 `SessionType` 判别式 |
| close_session | ✅ `close_session` | 🟢 已完成 | |
| send_keys（text + KeySpec） | ⚠️ 后端 `write_session(session_id, data)` 只能传 bytes | 🟡 部分有 | 缺 KeySpec 解析（char / key / combo / raw）、press_enter、bracketed、delay_ms |
| capture_screen（text / ansi / screenshot） | ⚠️ 后端有 `capture_tmux_pane`（仅 tmux）；本地 / SSH 无 | 🟡 部分有 | screenshot 模式完全缺失 |
| subscribe_output | ⚠️ 后端有 `session-output` 事件；无序号管理 / 缓冲 / from_sequence | 🟡 部分有 | 需环形缓冲 + 序号 |
| attach_session（独占） | ❌ 完全没有（前端 user 输入直接到 PTY） | 🔴 缺失 | 核心差异化 |
| detach_session | ❌ | 🔴 缺失 | |
| wait_for（pattern） | ❌ | 🔴 缺失 | |
| unsubscribe_output / list_profiles / get_config / set_config | ❌ | 🔴 缺失 | |
| 破坏性快捷键白名单 | ❌ | 🔴 缺失 | |
| 速率限制 | ❌ | 🔴 缺失 | |
| 审计日志（默认关闭） | ⚠️ tracing 日志存在但参数明文 | 🟡 部分有 | |

### M7. 本地 AI 一键接管

| 规格项 | xsterm 现状 | 状态 | 备注 |
|---|---|---|---|
| UI "🤖 AI 接管" 按钮 | ❌ | 🔴 缺失 | |
| session 标记为 AI 独占 | ❌ | 🔴 缺失 | |
| 顶部 banner | ❌ | 🔴 缺失 | |
| 释放方式（UI 按钮 + 终端口令） | ❌ | 🔴 缺失 | |
| 释放口令可配置 | ❌ | 🔴 缺失 | |

### M8. 远程 SSH agent 接入

| 规格项 | xsterm 现状 | 状态 | 备注 |
|---|---|---|---|
| 反向 SSH tunnel（`ssh -R`） | ❌ | 🔴 缺失 | |
| 自动生成隧道脚本（PS + bash） | ❌ | 🔴 缺失 | |
| 断线自动重连（指数退避 5 次） | ❌ | 🔴 缺失 | |

### M9. 配置

| 规格项 | xsterm 现状 | 状态 | 备注 |
|---|---|---|---|
| `%APPDATA%\ai-terminal\config.toml` | ❌ 当前是 `tauri-plugin-store` JSON | 🟡 偏差 | 规格要 toml；xsterm 要么迁移 toml，要么双轨 |
| schema（VS Code JSON schema） | ❌ | 🔴 缺失 | |
| 文件改动自动 reload（<1s） | ⚠️ 每次 React state 变更立即写 store；不监听外部修改 | 🟡 部分有 | notify 监听缺失 |

### M10. Microsoft Store

| 规格项 | xsterm 现状 | 状态 | 备注 |
|---|---|---|---|
| MSIX 打包 | ⚠️ Tauri bundle 配置 `targets: "all"` 含 nsis；MSIX 未确认 | 🟡 待核 | |
| 应用签名（EV 证书） | ❌ | 🔴 缺失 | |
| 隐私政策 URL（中英双语） | ❌ | 🔴 缺失 | 文档站未建立 |
| Partner Center 审核 | ❌ | 🔴 缺失 | |
| 不修改注册表 | ✅ Tauri 默认 | 🟢 已完成 | |
| 不写 Program Files | ✅ Tauri 默认 | 🟢 已完成 | |

### M11. 自动更新

| 规格项 | xsterm 现状 | 状态 | 备注 |
|---|---|---|---|
| 应用内更新（Store + 直连 GitHub Releases） | ❌ 没装 `tauri-plugin-updater` | 🔴 缺失 | |
| 提示重启 | ❌ | 🔴 缺失 | |

---

## 3. 横切缺口（合规 / 工程 / 文档）

### 3.1 合规（compliance.md）

| 项 | xsterm 状态 |
|---|---|
| 隐私政策（中英双语） | ❌ 无 |
| 默认无遥测 | 🟢 tracing 日志本地；无远程上报 ✅ |
| cargo-audit / NOTICE 文件 | ❌ 无 |
| LICENSE（MIT） | ❌ 无（仓库内） |
| CONTRIBUTING.md / SECURITY.md | ❌ 无 |
| i18n 字符串外提 | ❌ UI 大量硬编码英文 |
| 屏幕阅读器 / 高对比度 | ⚠️ 设计系统有 `--ink` / `--canvas` token；未审计 |
| GDPR / CCPA | ⚠️ 默认无遥测满足 |
| 已知坑 #5（SSH host key verification 禁用）| ⚠️ AGENTS.md 标记为"已知安全 gap" |
| CSP 关闭 | ⚠️ tauri.conf.json 中 `csp: null`（AGENTS.md 标注） |

### 3.2 工程化

| 项 | xsterm 状态 |
|---|---|
| CI（GitHub Actions）| ❌ 无 `.github/workflows/` |
| cargo-about / cargo-audit | ❌ 未跑 |
| tauri-specta 生成 TS 绑定 | ❌（AGENTS.md 标注"无类型安全"）|
| MSIX 打包配置 | ⚠️ Tauri 默认 nsis；需补 msix target |
| 截图 + 文档站 | ❌ 无 `docs/` 站 |
| 性能基线脚本 | ⚠️ perf.md 有但无自动化脚本 |
| 单元测试覆盖 | 🟡 前端 `paneUtils` / `pasteConfirm` / `formParsers` / `paneContextMenu` 有 Vitest；后端 mockall 覆盖 SessionManager |
| E2E（playwright / WebDriver）| 🟡 `test/smoke.spec.ts` 已有 Selenium 路径，但不在 npm scripts |
| VSCode launch.json | ✅ AGENTS.md 提到 |

### 3.3 文档（xsterm vs 规格）

| 已有（xsterm） | 缺（规格要求） |
|---|---|
| design-system.md ✅ | docs/privacy-policy.md ❌ |
| architecture-map.md ✅ | docs/quickstart.md ❌ |
| requirements/prd-0.1/ ✅ | docs/mcp.md（人类可读版） ❌ |
| maintenance/bug.md ✅ | docs/CHANGELOG.md ❌ |
| maintenance/perf.md ✅ | docs/SECURITY.md ❌ |
| tmux-cc-protocol.md ✅ | docs/NOTICE ❌ |
| live-data.md / ui.md / conifg.md ✅ | docs/CONTRIBUTING.md ❌ |

---

## 4. 关键概念对齐

xsterm 现有术语与 ai-terminal 规格有 80% 重叠，但有 3 个关键偏差需要在迁移中解决：

| ai-terminal 规格术语 | xsterm 现有术语 | 差异 | 处理建议 |
|---|---|---|---|
| **session**（backend 连接） | **xsterm session**（`Session`） | ✅ 一致 | 保留命名 |
| **workspace**（UI 顶层） | **workspace**（`WorkspaceContainer`） | ✅ 一致 | 保留命名 |
| **window**（UI 二级，承载 PaneTree） | **xsterm Window**（对应 tmux window） | ✅ 一致 | 保留命名 |
| **pane**（UI 三级，渲染一个 session） | **pane**（PaneTree leaf） | ✅ 一致 | 保留命名 |
| **profile**（配置模板） | **SavedSessionConfig**（savedConfigs） | 🟡 命名不同 | 暴露给 MCP 时统一叫 `profile` |
| **MCP `session_id`** | `Session.id` (u32) | ⚠️ 格式：`"tab-7f3a9b"` vs `42` | MCP 暴露时生成 `"type-uuid_short"` 字符串，u32 内部用 |
| **tmux session** | tmux controller / tmux pane | ⚠️ 概念层级不同 | 详见 AGENTS.md §"命名禁忌"；规格用 tmux 简单模式，xsterm 已是 -CC 模式，详见 §5 |
| **PTY** | PTY | ✅ 一致 | |
| **attach** | 无 | 🔴 新概念 | 新增 `Session.attachState: AttachedBy \| null` |
| **detach** | 无 | 🔴 新概念 | |
| **subscribe_output** | `session-output` 事件 | 🟡 已有事件但无序号/缓冲 | 升级为有序号环形缓冲 |

---

## 5. 战略决策点（需要 tm / pdm 拍板）

**D-α：tmux 实现路线冲突**

ai-terminal 规格 M2 写的是 `tmux new -s name` + detach 保留的简单模式（用户在终端内手动 `tmux` 操作）。xsterm 已经实现了完整的 `tmux -CC` control mode（iTerm2 / WezTerm 路线），体验远超规格。**两个选择**：

1. **保留 xsterm 实现**：把 tmux -CC 作为 ai-terminal 的"高级特性"；规格 M2 简化为"通过 `create_session(type=\"tmux\")` 自动 attach 现有或新建 server"。优点：保留资产；缺点：用户心智模型不同（规格用户预期简单模式）。
2. **加一个简单模式**：在 xsterm 现有 -CC 之外，加 `tmux new -s <name>` + 普通 PTY（detach 时 tmux 进程继续跑），作为"MVP 兼容模式"。优点：完全符合规格；缺点：双栈维护。

**我的推荐**：选 1。理由：(a) 规格产品名占位"AI Terminal"，最终命名待定；(b) -CC 是 xsterm 最有差异化的资产之一；(c) 简单模式可以一句话概括为"create_session(type=\"tmux\") 自动选 server"；(d) 双栈维护是真正的成本。

**D-β：MCP server crate 拆分**

ai-terminal 规格 dev-handoff.md 建议拆为 `crates/mcp-server/`。xsterm 当前是单 crate（`src-tauri/`）。**三个选择**：

1. **单 crate 内 `src-tauri/src/mcp_server/`**——保留单 crate 编译速度，不改 Cargo workspace 结构；MCP 模块作为 `pub mod mcp_server` 暴露。
2. **新建 `crates/mcp-server/` workspace member**——按规格；编译变慢但边界清晰。
3. **main + mcp-server 双二进制**——`xsterm.exe`（主 UI）+ `xsterm-mcp.exe`（stdio 子进程）。

**我的推荐**：选 3。理由：(a) MCP 子进程与主进程通过 tokio mpsc 通信（规格 §1.1）是天然边界；(b) stdio 端点天然适合独立二进制（Claude Desktop 直接 `command: "xsterm-mcp"`）；(c) 复用了 xsterm 当前的子进程模式（tmux -CC 已是独立子进程）；(d) 不影响单 crate 编译速度（可选 feature）。

**D-γ：配置文件格式（toml vs store JSON）**

规格要 `config.toml`；xsterm 当前用 `tauri-plugin-store` JSON。**两个选择**：

1. **迁移到 toml**（`config + serde + toml`）——完全符合规格；需要数据迁移（一次性把现有 JSON 迁到 toml）。
2. **保留 JSON**——不符合规格；schema 校验仍可加。

**我的推荐**：选 1（toml）+ 数据迁移工具（启动时检测到旧 JSON 自动迁）。理由：(a) 规格明确；(b) toml 注释 + 类型更友好；(c) `serde + toml` 已经是规格栈（dev-handoff §技术栈锁定）。

**D-δ：命名问题**

PRD 全文写 "AI Terminal"，但 xsterm 0.1.3 是已发布产品名。**三个选择**：

1. **保留 xsterm 品牌**——mvp-checklist.md / README 都用 xsterm；规格文档作为内部目标态。
2. **迁移到 AI Terminal**——按规格；版本号 bump 到 v1.0。
3. **双品牌**——产品名 AI Terminal，命令行 `xsterm.exe` 保留兼容。

**我的推荐**：本次设计不替你拍，**问你**。这是 owner 决定。

---

## 6. 缺口优先级（按 ROI 排序）

按"商业价值 × 实现成本"排序，给迁移路线（02）直接对应：

| 优先级 | 缺口 | 商业价值 | 实现成本 | 影响 |
|---|---|---|---|---|
| **P0-1** | MCP server（M6 全套） | ⭐⭐⭐（核心差异化） | 高 | AI agent 接入 |
| **P0-2** | TUI 完整档（vttest + unicode11 + image addon） | ⭐⭐⭐ | 中 | 通过 acceptance §A |
| **P0-3** | 本地 AI 一键接管（M7） | ⭐⭐⭐ | 中 | 用户体感最直接 |
| **P0-4** | Store 打包 / 签名 / 隐私政策（M10） | ⭐⭐⭐ | 中 | 发布阻塞 |
| **P0-5** | 配置 toml + 热更新（M9） | ⭐⭐ | 中 | 工程基础 |
| **P0-6** | 自动更新（M11） | ⭐⭐ | 中 | 发布后用户能升级 |
| **P1-1** | 远程 SSH agent / 反向隧道（M8） | ⭐⭐ | 中 | MCP agent 跨机器 |
| **P1-2** | WSL 发行版自动列出 + Docker exec | ⭐⭐ | 低 | 多环境补齐 |
| **P1-3** | 路径/URL 检测（M4）+ 快捷键可配（M5） | ⭐ | 低 | 体验 |
| **P1-4** | 工程化（CI、cargo-audit、ts-specta） | ⭐ | 中 | 长期维护 |
| **P1-5** | 文档站 + i18n + LICENSE/NOTICE | ⭐ | 低 | 上架/合规 |
| **P2-1** | session 录像回放 / 主题商店 | ⭐ | 高 | SHOULD，留到 v1.1 |
| **P2-2** | macOS / Linux 移植 | ⭐ | 高 | COULD，留到 v2 |

---

## 7. 风险与备注

⚠️ **待核项汇总**（本次调研未深入，需要后续单独看）：
1. `pasteConfirm.ts` 是否会破坏 bracketed paste（acceptance §C 要求）
2. `useCommandTargets` / `SettingsView` 的快捷键真绑定情况
3. SSH host key verification 是否真未启用（AGENTS.md 标记）
4. CSP 关闭状态下能否加远程脚本（当前 `csp: null`，要开 CSP 才能加 mcp 文档站 iframe 之类）
5. `tunnel` 在 WSL 下的反向 SSH 路径（规格要求 AI Terminal 生成脚本）

⚠️ **跨 PR 关注**：
- 加 MCP 必须先加 capability 权限（AGENTS.md 强调 Tauri v2 gotcha）
- 加 `tauri-plugin-updater` 必须同时改 bundle config + 加自签名密钥
- MSIX 打包必须在 Windows host 上跑（AGENTS.md 强调 WSL 用 Windows toolchain）

---

## 8. 给 pdm / tm 的建议

1. **不要重写 xsterm**——这是核心约束。缺口都是"加"而不是"改"。
2. **D-α / D-β / D-γ / D-δ 四个战略决策点先拍板**——直接决定 02 / 03 的边界。
3. **MCP 是第一阶段唯一阻塞项**——所有 AI agent 价值（M6/M7/M8）都基于 MCP。
4. **Store 上架是商业化分水岭**——但技术上是"配置 + 流程"问题，不是代码问题。
5. **建立 RFC 流程**——dev-handoff.md 要求 72h 讨论窗口；建议每个 P0 PR 配一个 `doc/adr/legacy-rfcs/NNNN-*.md`。

---

文档结束。**下一步**：阅读 [02-target-architecture.md](02-target-architecture.md)（目标架构）+ [03-migration-roadmap.md](03-migration-roadmap.md)（分阶段 PR 切片）。