# AGENTS.md — xsterm 项目守护规则

> 本文件是所有 AI 编码代理与贡献者的**强制**工作规则。任何代码改动、UI 改动、新功能、重构，都必须先读本文件，并遵守其中引用的规范文档。

## 1. 项目定位

xsterm 是一个 **Tauri 2 桌面终端模拟器**：前端 React 19 + TypeScript 5.8 + Vite 7，后端 Rust（`portable-pty` + `russh` + tmux `-CC` 控制模式）。

- 会话类型：本地 PTY、SSH、tmux（-CC control mode）。
- 当前阶段聚焦**现有三种会话的稳定性与代码健康**。
- **暂停 MCP server 及 AI 接管相关功能**：在用户明确要求前，不要实现 MCP / attach / subscribe / reverse-tunnel / profile 等。

## 2. 守护规则（Standing Rules）

1. **UI 必须遵循 `DESIGN.md`**（根目录）。任何组件 / 对话框 / 面板 / 按钮 / 表面的改动，先读 DESIGN.md 并逐字套用 token 与模式，禁止 ad-hoc 样式。
2. **代码命名必须遵循 `rules/`**：TS/TSX 看 `rules/ts-name-rules.md`，Rust 看 `rules/rust-name-rules.md`。
3. **分层边界**（见 §4）。禁止跨层违规 import：组件不得直接 `import { invoke } from "@tauri-apps/api"`，必须走 `src/services/sessionService.ts`。
4. **提交前必须**：`npm run format` + `cargo fmt`，并跑通相关测试（`npm test` / `cargo test`）。

## 3. 构建命令

| 命令 | 作用 |
|---|---|
| `npm run dev` | 只启动 Vite dev server（1420 端口） |
| `npm run tauri dev` | 完整 Tauri 开发模式（Vite + Rust 编译 + 启动应用） |
| `npm run build` | `tsc` 类型检查 + `vite build` → `dist/` |
| `npm run tauri build` | 生产构建 + 打包 |
| `npm test` / `npm run test:watch` | 前端单元测试（Vitest） |
| `cargo test --manifest-path src-tauri/Cargo.toml` | Rust 单元测试 |
| `cargo check --manifest-path src-tauri/Cargo.toml` | Rust 快速类型检查 |
| `npm run lint` / `npm run lint:fix` | ESLint（`src/`） |
| `npm run format` / `npm run format:check` | Prettier |
| `cargo fmt --manifest-path src-tauri/Cargo.toml` | rustfmt |

> 平台说明：本项目面向 Windows（WebView2 + MSVC）。若在 WSL 中构建，必须用 Windows 工具链（`powershell.exe -Command "Set-Location '...'; npm run ..."` 或 `cargo.exe`），不要用 WSL 原生 cargo/node 产出 Linux 二进制。

## 4. 架构

### 4.1 前端（`src/`）

- 入口链：`index.html` → `src/main.tsx` → `src/App.tsx` → `src/components/AppLayout.tsx`
- 全局状态走 React Context：`SessionContext`（会话 / workspace / pane / group）、`ThemeContext`、`LoggerContext`
- 所有 Tauri IPC 收敛在：`src/services/sessionService.ts`（invoke）与 `src/contexts/session/useTauriListeners.ts`（listen）
- 样式只用纯 CSS：全局 token 在 `src/styles/global.css` 的 `:root`，组件样式与组件同目录（`<Component>.css`）。禁止 Tailwind / CSS-in-JS / CSS Modules
- 无路由，视图切换由 `AppLayout` 内部状态驱动

### 4.2 后端（`src-tauri/`）

- 入口链：`src/main.rs` → `src/lib.rs::run()`
- 分层：`commands/`（Tauri 命令薄壳）→ `services/`（业务逻辑与生命周期）→ `infrastructure/`（PTY/SSH/tmux 适配）→ `models/`（纯数据结构）
- 会话状态：`Arc<SessionManager>`（内部 `DashMap` + `AtomicU32`，无外层 Mutex）
- 事件名（前端依赖，勿改名）：`session-output`（二进制帧，经 `binary_frame.rs` 编码，通过 `get_session_output_channel` 拉取）、`session-closed`（payload `sessionId`）、`tmux-*`（tmux window/pane 事件）

### 4.3 Capabilities / 权限

- Tauri 2 用 `src-tauri/capabilities/default.json` 声明权限（v1 的 allowlist 已废弃）。
- 新增插件三步：① `Cargo.toml` 加 crate ② `lib.rs` 注册 `.plugin(...)` ③ `default.json` 加权限标识。漏第三步会编译通过但运行时抛错。

## 5. 关键坑（Gotchas）

- `invoke()` 非类型安全（无 tauri-specta / 生成绑定），命令名与参数形状错误只在运行时暴露。
- 窗口 `decorations: false`，自定义标题栏在 `src/components/NavBar.tsx`（用 `getCurrentWindow()`）。
- Vite dev server 固定 1420 端口 + `strictPort: true`；被占用则启动失败。
- 不要用普通浏览器打开 `http://localhost:1420`（`__TAURI_INTERNALS__` 未定义，invoke 全抛错）。
- 生成文件勿手改：`src/vite-env.d.ts`、`src-tauri/gen/schemas/`。
- SSH host-key 校验当前**关闭**（`src-tauri/src/infrastructure/ssh.rs`），已知安全缺口，未经用户明确要求不要改动。
- 版本号三处同步：`package.json` / `src-tauri/Cargo.toml` / `src-tauri/tauri.conf.json`。
- 日志初始化故意泄漏一个 guard（`logging_setup.rs` 的 `std::mem::forget`）以保持滚动 writer 存活，勿删。
- Rust mock 测试在 `services/session_manager.rs` 内联 `#[cfg(test)]`（mockall）。
- `list_sessions` 已注册但前端 `sessionService.ts` 未暴露 wrapper；要用先加前端包装。

## 6. 持久化与日志

- 用 `tauri-plugin-store` 把配置存为 JSON（app data 目录）：sessions / groups / attached_tmux / log_config。
- 前端日志经 `log_message` 转后端，由 tracing 写滚动日志。

## 7. Husky（提交钩子）

- 提交钩子已启用：`git config core.hooksPath = .husky/_`，`.husky/pre-commit` 依次运行 `npx lint-staged` → `cargo fmt --manifest-path src-tauri/Cargo.toml` → `git add src-tauri`。
- `package.json` 已含 `"prepare": "husky"` 脚本、`husky` / `lint-staged` 依赖，以及 `lint-staged` 配置（暂存的 `*.ts/tsx` 跑 `prettier --write` + `eslint --fix`，`*.css/json` 跑 `prettier --write`）。
- Rust 在提交时自动 `cargo fmt` 全量格式化，并把 `src-tauri` 的改动自动重新暂存（`git add src-tauri`），不再只是 `--check` 拦截。

## 8. 文档地图

| 文档 | 作用 |
|---|---|
| `DESIGN.md` | 前端设计系统（权威），所有 UI 改动前必读 |
| `rules/ts-name-rules.md` | TS/TSX 命名规范 |
| `rules/rust-name-rules.md` | Rust 命名规范 |
