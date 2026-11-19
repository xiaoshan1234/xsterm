# AGENTS.md — xsterm 项目守护规则

> 本文件是所有 AI 编码代理与贡献者的**强制**工作规则。任何代码改动、UI 改动、新功能、重构，都必须先读本文件。
>
> **事实优先级：当前源码与可执行结果 > 本文件 > 其他文档。** `DESIGN.md`、`UI_COMPONENTS.md` 和其他说明文档可能过期，只能作为线索；如果它们与源码、类型检查或测试冲突，以当前代码和命令结果为准，并在本次改动中修正相关描述。

## 1. 项目定位

xsterm 是一个 **Tauri 2 桌面终端模拟器**：前端 React 19 + TypeScript 5.8 + Vite 7，后端 Rust（`portable-pty` + `russh` + tmux `-CC` 控制模式）。

- 会话类型：本地 PTY、SSH、tmux（-CC control mode）。
- 当前阶段聚焦**现有三种会话的稳定性与代码健康**。
- **暂停 MCP server 及 AI 接管相关功能**：在用户明确要求前，不要实现 MCP / attach / subscribe / reverse-tunnel / profile 等。

## 2. 守护规则（Standing Rules）

1. **UI 样式以当前源码为准**。优先复用 `src/styles/global.css` 中已经存在的 token/class，以及组件同目录 CSS 的既有模式；不要凭文档臆造 token。需要新 token 或新模式时，先确认现有样式确实无法表达，再同时修改样式和相应说明文档，禁止 ad-hoc 内联样式。
2. **代码命名遵循当前代码库和 `rules/` 的命名约定**：TS/TSX 看 `rules/ts-name-rules.md`，Rust 看 `rules/rust-name-rules.md`。如果规则文件与现有大量稳定命名冲突，记录差异并以现有代码为准，不要为了满足文档制造大面积无意义重命名。
3. **分层边界**（见 §4）。禁止新增跨层违规 import：组件不得直接调用 Tauri `invoke()` / `listen()` 或其他窗口 API，也不得导入其他 feature 的 `infrastructure/`；必须通过 application action 或明确的端口。IPC 统一收敛在 feature-local infrastructure adapter，不存在全局 `sessionService.ts`。app 和跨 feature 调用只能走对应 feature 的根 `index.ts`，`ports` / `composition` 只供 feature 自身组合使用。
4. **完成前必须验证**：`npm run format`、`npm run lint`、`npx tsc --noEmit`，并跑通相关测试（`npm test` / `cargo test`）；涉及 Rust 改动还要 `cargo fmt --manifest-path src-tauri/Cargo.toml`。`lint` 和 `format` 通过不能代替类型检查和测试。

## 3. 构建命令

| 命令                                               | 作用                                               |
| -------------------------------------------------- | -------------------------------------------------- |
| `npm run dev`                                      | 只启动 Vite dev server（1420 端口）                |
| `npm run tauri dev`                                | 完整 Tauri 开发模式（Vite + Rust 编译 + 启动应用） |
| `npm run build`                                    | `tsc` 类型检查 + `vite build` → `dist/`            |
| `npm run tauri build`                              | 生产构建 + 打包                                    |
| `npm test` / `npm run test:watch`                  | 前端单元测试（Vitest）                             |
| `cargo test --manifest-path src-tauri/Cargo.toml`  | Rust 单元测试                                      |
| `cargo check --manifest-path src-tauri/Cargo.toml` | Rust 快速类型检查                                  |
| `npm run lint` / `npm run lint:fix`                | ESLint（`src/`）                                   |
| `npm run format` / `npm run format:check`          | Prettier                                           |
| `cargo fmt --manifest-path src-tauri/Cargo.toml`   | rustfmt                                            |

> 平台说明：本项目面向 Windows（WebView2 + MSVC）。若在 WSL 中构建，必须用 Windows 工具链（`powershell.exe -Command "Set-Location '...'; npm run ..."` 或 `cargo.exe`），不要用 WSL 原生 cargo/node 产出 Linux 二进制。

## 4. 架构

### 4.1 前端（`src/`）

- 入口链：`index.html` → `src/main.tsx` → `src/app/App.tsx` → `src/app/shell/AppShellRuntime.tsx`。新 Shell 是唯一运行时入口。
- `#ui-preview` 启动纯静态组件稿；旧 `AppLayout` / Sidebar / BottomBar 入口已移除。
- 当前顶层：`src/app/`（应用装配与 shell）、`src/features/`（纵向功能切片）、`src/models/`（纯领域模型）、`src/infra/`（公共日志与通用配置持久化）、`src/shared/`（尽量无业务依赖的 UI、hooks、utils）、`src/styles/`（全局样式）。
- `src/models/` 不得依赖 React、Tauri、DOM、Store 或任何上层目录；`src/infra/` 不得依赖 `app/`、`features/`、`models/`。
- Feature 子目录按实际需要创建，不预建空目录。当前常见目录是 `ui/`、`application/`、`state/`、`viewModels/`、`infrastructure/`、`persistence/`；只有存在纯选择器时才创建 `selectors/`。终端命令/事件属于对应 feature 的 `infrastructure/`，不得放入全局 `infra/`。
- 全局状态由 feature 内的 Context / hooks 提供，配置、终端运行时、工作区布局和偏好分别落在 `launch-config`、`terminal`、`workspace`、`settings`。跨聚合动作与 Provider 组合位于 `src/app/application/session/`；不要再引入聚合 `SessionActions` 或 `useSession()` 式公共大 API。terminal-surface 的运行时副作用通过 `TerminalSurfacePortsProvider` 注入。
- session 启动必须先完成持久化 hydration，再启动 Tauri 事件桥并渲染运行时 Shell；不要绕过 `SessionProvider` 的 `isLoaded` 门控。
- Feature 根 `index.ts` 必须显式命名导出公共契约，不得恢复 `export *`。backend handle/DTO 只能通过 adapterContracts 进入 infrastructure。
- Tauri IPC 必须收敛在 feature-local infrastructure adapter；组件不得直接 `invoke()` 或 `listen()` 原始后端事件。
- 样式只用纯 CSS：全局 token 在 `src/styles/global.css` 的 `:root`，组件样式优先与组件同目录（`<Component>.css`），跨页面布局可放在 `src/styles/`。禁止新增 Tailwind / CSS-in-JS / CSS Modules。
- 无路由，视图和全局面板切换由 AppShell 内部状态驱动。

### 4.2 后端（`src-tauri/`）

- 入口链：`src/main.rs` → `src/lib.rs::run()`
- 当前实际目录：`command/`（Tauri 命令）、`connect/`（PTY/SSH/tmux 连接、输出路由与会话注册表）、`feature/`（产品功能，目前主要是日志）、`shared/`（跨模块数据类型、错误和 capability）。
- 会话状态：`Arc<TerminalRegistry>`，定义在 `connect/registry.rs`；内部用多个 `DashMap` 管理普通终端和 tmux controller，用 `AtomicU32` 分配 ID。
- 输出和事件：前端通过 `subscribe_terminal_output` / `unsubscribe_terminal_output` 命令绑定 `Channel` 拉取原始输出；断连和关闭事件实际是 `terminal-disconnected` / `terminal-closed`，tmux 事件为 `tmux-*`。这些名称被前端 adapter 依赖，勿随意改名。

### 4.3 Capabilities / 权限

- Tauri 2 用 `src-tauri/capabilities/default.json` 声明权限（v1 的 allowlist 已废弃）。
- 新增插件三步：① `Cargo.toml` 加 crate ② `lib.rs` 注册 `.plugin(...)` ③ `default.json` 加权限标识。漏第三步会编译通过但运行时抛错。

### 4.4 当前前端边界债务（不要扩散）

以下为 2026-11-19 当前工作区状态；修复后应同步删除对应条目，不要把它当成长期架构目标。

- `AppShellRuntime` 已把 View Model、ToolPanel 和 NavBar 控制移出，但仍负责 Overlay、TextSender selection 和部分 shell 状态，后续可继续抽 controller。
- `useTerminalActions` 和 `useTmuxEventBridge` 仍是较大的组合/事件协调模块，新增功能前优先拆成独立 use case。
- `Workspace` 的 `PaneIntentActions` 仍包含 terminal/tmux 跨聚合创建动作；当前由 app 层实现，但后续可迁移到专门的 session coordination 契约。
- `models/ids.ts` 的 branded ID 尚未全面用于 terminal、workspace、window、pane 公共契约，跨聚合身份仍可能混用。
- persistence repository 已形成稳定端口，加载失败会进入 bootstrap error；保存失败目前只记录日志，尚未进入统一用户错误通道。

## 5. 关键坑（Gotchas）

- `invoke()` 非类型安全（无 tauri-specta / 生成绑定），命令名与参数形状错误只在运行时暴露。
- 窗口 `decorations: false`，自定义标题栏在 `src/app/NavBar.tsx`；窗口最小化/最大化/关闭统一经由 `src/app/infrastructure/windowControls.ts`。
- Vite dev server 固定 1420 端口 + `strictPort: true`；被占用则启动失败。
- 不要用普通浏览器打开 `http://localhost:1420`（`__TAURI_INTERNALS__` 未定义，invoke 全抛错）。
- 生成文件勿手改：`src/vite-env.d.ts`、`src-tauri/gen/schemas/`。
- SSH host-key 校验当前**未实现**：图片上传使用的 `src-tauri/src/connect/ssh_exec.rs` 中 `check_server_key` 直接返回 `true`；会话传输由 xscore 负责。未经用户明确要求不要改动这个安全缺口。
- 版本号三处同步：`package.json` / `src-tauri/Cargo.toml` / `src-tauri/tauri.conf.json`。
- 日志初始化故意泄漏一个 guard（`src-tauri/src/feature/logging/setup.rs` 的 `std::mem::forget`）以保持滚动 writer 存活，勿删。
- Rust 测试主要是模块内联 `#[cfg(test)]`，分布在 `connect/registry.rs`、`connect/output.rs`、`connect/tmux.rs`、`shared/session.rs` 和 `feature/logging/session_log.rs`；当前没有 `services/session_manager.rs` 或 mockall 测试。
- `list_terminals` 已注册，现有前端 wrapper 在 `features/terminal/infrastructure/terminalCommands.ts`；新增命令必须补对应的类型化 adapter。

## 6. 持久化与日志

- 当前实际存储文件是 `terminals.json`（`savedConfigs`、`groups`、`nextGroupId`、`savedWindowConfigs`、`savedWorkspaces`）、`settings.json`、`ui-shell.json` 和 `log_config.json`。
- `src/infra/storage/jsonStore.ts` 只提供通用 key/value 持久化；领域 schema、迁移、校验归属对应 feature 的 `persistence/`。
- app 层通过 `LaunchConfigRepository`、`WorkspaceRepository`、`SettingsRepository` 消费持久化能力；新代码不要直接依赖 feature 的具体 storage 文件。
- SSH 领域配置使用 `authType` / `keyFile`；只有 terminal-stream 的 wire DTO、wire mapper 和 persisted-data migration 允许出现 `auth_type` / `key_file`。
- 前端日志经 `src/infra/logging/` 的 `log_message` adapter 转后端，由 tracing 写滚动日志。

## 7. Husky（提交钩子）

- 提交钩子已启用：`git config core.hooksPath = .husky/_`，`.husky/pre-commit` 依次运行 `npx lint-staged` → `cargo fmt --manifest-path src-tauri/Cargo.toml` → `git add src-tauri`。
- `package.json` 已含 `"prepare": "husky"` 脚本、`husky` / `lint-staged` 依赖，以及 `lint-staged` 配置（暂存的 `*.ts/tsx` 跑 `prettier --write` + `eslint --fix`，`*.css/json` 跑 `prettier --write`）。
- Rust 在提交时自动 `cargo fmt` 全量格式化，并把 `src-tauri` 的改动自动重新暂存（`git add src-tauri`），不再只是 `--check` 拦截。

## 8. 文档地图

| 文档                       | 作用                                                 |
| -------------------------- | ---------------------------------------------------- |
| `DESIGN.md`                | UI 设计参考；可能与代码不一致，以实际样式和组件为准  |
| `UI_COMPONENTS.md`         | AppShell、Manager、Dialog 行为参考；可能与代码不一致 |
| `rules/ts-name-rules.md`   | TS/TSX 命名参考                                      |
| `rules/rust-name-rules.md` | Rust 命名参考                                        |
| `src/models/README.md`     | 模型层边界参考；以 `src/models` 实际 import 关系为准 |
