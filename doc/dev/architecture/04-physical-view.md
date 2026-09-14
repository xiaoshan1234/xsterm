# 04 物理视图 (Physical View)

> **关心什么**：代码部署到哪、进程跑在哪台机器、安全边界在哪、跨主机路径的差异。
> 不关心：UI 树、运行时 task 拓扑、模块组织。

## 1. Tauri 部署拓扑

### 1.1 进程模型

```
┌──────────────── Windows / macOS / Linux 用户机 ────────────────┐
│                                                                │
│  ┌──────────────────────────────────┐                          │
│  │ Tauri 主进程 (ai-terminal.exe)   │  ← Rust + tokio runtime │
│  │                                  │                          │
│  │  - lib.rs::run() 启动            │                          │
│  │  - 注册所有 Tauri command        │                          │
│  │  - SessionManager (State)        │                          │
│  │  - logging_setup (leak guard)    │                          │
│  │  - tokio::spawn 各类 task        │                          │
│  └───────────────┬──────────────────┘                          │
│                  │ IPC (Tauri runtime 内部)                    │
│  ┌───────────────▼──────────────────┐                          │
│  │ WebView2 (Windows) /             │                          │
│  │ WKWebView (macOS) /              │                          │
│  │ WebKitGTK (Linux)                │                          │
│  │                                  │                          │
│  │  - React 19 + Vite 7             │                          │
│  │  - xterm.js 6 渲染终端内容       │                          │
│  │  - invoke() / listen() 与主进程通讯│                         │
│  └──────────────────────────────────┘                          │
│                                                                │
│  本地文件系统：                                                │
│  - Tauri app data 目录（session configs / groups / 日志）      │
│  - $APPDATA (Windows) / $HOME/Library/Application Support (mac) │
│                                                                │
└────────────────────────────────────────────────────────────────┘
```

**主进程 + WebView 进程** 是 Tauri 标准模型。两个进程通过 Tauri runtime 内部 IPC 通讯：
- 前端 `invoke("cmd", args)` → 主进程 command handler → return value
- 后端 `app.emit("event", payload)` → 前端 `listen("event", handler)`

### 1.2 平台差异

| 平台 | WebView | 已知限制 |
|---|---|---|
| **Windows** | WebView2（Edge 内核） | 项目**主目标平台**；CSP 暂 null |
| **macOS** | WKWebView（系统） | 调试能力较弱 |
| **Linux** | WebKitGTK | 本地 PTY session 需 system `tmux` ≥ 2.2 |

## 2. Tauri capabilities（安全边界）

> 配置：`src-tauri/capabilities/default.json`。这是 Tauri 2 的权限声明，**等价于 v1 的 allowlist**。

### 2.1 当前 capabilities

| Permission | 用途 |
|---|---|
| `core:default` | 基础（窗口控制、事件等） |
| `opener:default` | 打开外部链接 |
| `store:default` | tauri-plugin-store（持久化） |
| `clipboard-manager:default` | 剪贴板 |
| `clipboard-manager:allow-read-image` | 读图片（截图粘贴等） |
| `clipboard-manager:allow-read-text` | 读文本 |
| `clipboard-manager:allow-write-text` | 写文本 |
| `core:window:allow-minimize` | 窗口最小化 |
| `core:window:allow-maximize` / `allow-unmaximize` | 最大化/还原 |
| `core:window:allow-close` | 关闭窗口 |
| `core:window:allow-is-maximized` | 查状态 |
| `core:window:allow-start-dragging` | 自定义 title bar 拖拽 |

### 2.2 加新命令的三步流程

> ⚠️ **Tauri v2 gotcha**（AGENTS.md 强约束）

1. 在 `src-tauri/src/commands/` 加 handler（`#[tauri::command]`）
2. 在 `src-tauri/src/commands/mod.rs::all_handlers()` 注册
3. 在 `src-tauri/capabilities/default.json` 加对应 permission

**跳过第 3 步会编译过、运行时 throw** —— 这是 Tauri v2 的默认拒绝行为。

### 2.3 已知安全 gap（owner 拍板才动）

| Gap | 状态 | 文档 |
|---|---|---|
| **SSH host key 验证默认 disabled** | 已知 gap，**不动**除非 owner 拍板 | `src-tauri/src/infrastructure/ssh.rs` + AGENTS.md |
| **CSP `csp: null`** | 已知 gap（`tauri.conf.json`） | AGENTS.md "Important Gotchas" |
| **`opencode.json` 允许所有 bash** | 工具配置，非项目规则 | AGENTS.md |

**注意**：当前 `SSH host key 验证 disabled` 是 `russh` 实现里写死的 —— 要启用需要重新评估 trust on first use 策略，**改这个必须先开 ADR**。

## 3. 跨主机路径（local vs SSH）

### 3.1 Local 模式（PTY）

```
用户机：
  ai-terminal.exe (Tauri)
    └── tokio::process::Child "tmux -CC"
            stdin/stdout/stderr/wait  → LocalTmuxBackend
```

- 全部在用户机，**不需要网络**
- 依赖系统已装 `tmux` ≥ 2.2（PR-T4 能力矩阵决定 bootstrap 步骤序列）

### 3.2 SSH 模式

```
用户机：
  ai-terminal.exe (Tauri)
    └── russh session
            ↓ (encrypted TCP)
SSH server：
  └── sh -c "tmux -CC ..."
            exec channel → SshTmuxBackend
```

**关键差异**（来自 `02-process-view.md` §7，物理视角重新表述）：

| 维度 | Local | SSH |
|---|---|---|
| 后端进程归属 | 用户机 | SSH server |
| tmux 二进制位置 | 用户机 `$PATH` | server `$PATH` |
| 网络要求 | 无 | SSH server 可达 |
| 鉴权 | 无 | SSH（**当前禁用 host key 验证**） |
| DCS passthrough | 偶现 | **必现**（reader 已统一剥） |
| stderr | 实际空 | **永远空**（russh exec 不暴露 stderr） |
| 字节桥接 | `Child::stdout` 直读 | russh data loop → `sync_mpsc` → bridge thread → `tokio::mpsc` → reader task 当 AsyncRead |

**设计目的**：`TmuxBackend` trait 让两条路径**共享** reader / writer / monitor 任务。所有业务逻辑（CommandRegistry、RouterState、handshake、wire）完全 backend-agnostic。

### 3.3 SSH 字节桥接（详细）

> `src-tauri/src/infrastructure/tmux/backend.rs::SshTmuxBackend`

```
SSH server
    ↓ (TCP bytes)
russh data loop (另一线程)
    ↓ (sync_mpsc)
bridge 线程
    ↓ (tokio::mpsc)
reader task (treat as AsyncRead)
```

**为什么需要 bridge 线程**：russh 是 callback-driven，不是 AsyncRead；要喂进 tokio AsyncRead trait 必须先把字节搬到 tokio mpsc，再 expose 出来。

## 4. 持久化位置

> Tauri 2 标准路径，`tauri-plugin-store` 自动管理。

| 数据 | 路径（Windows） | 路径（macOS/Linux） |
|---|---|---|
| Session config / Groups / 日志设置 | `%APPDATA%/xsterm.dev/` | `~/Library/Application Support/xsterm.dev/` / `~/.config/xsterm.dev/` |
| `attached_tmux.json` | 同上 | 同上 |
| 日志（rolling） | `%LOCALAPPDATA%/xsterm.dev/logs/` | 同上对应目录 |
| SSH known_hosts | 系统默认（`%USERPROFILE%/.ssh/known_hosts`） | `~/.ssh/known_hosts` |

**目标**（M3 W10-12）：JSON store → **toml** 配置迁移（见 `dev/roadmap/migration-prs.md`）。

## 5. 网络与端口

| 端口 | 用途 | 何时 |
|---|---|---|
| **1420** | Vite dev server（**strictPort: true**） | `npm run dev` / `npm run tauri dev` |
| **随机** | Tauri 内部 IPC | 主进程 ↔ WebView（不暴露） |

**注意**（AGENTS.md gotcha）：
- 端口 1420 被占用 → `npm run tauri dev` 直接失败（不自动换端口）
- **不要**在 standalone 浏览器打开 `http://localhost:1420`，`__TAURI_INTERNALS__` 未定义 → 每个 `invoke()` 都 throw

## 6. 部署产物（M5 W16-17 目标态）

| 平台 | 格式 | 状态 |
|---|---|---|
| Windows | MSI + NSIS | 当前可打包（`npm run tauri build`） |
| macOS | DMG + .app | 可打包，未签名 |
| Linux | AppImage + deb | 可打包 |
| **Microsoft Store** | MSIX | **M5 目标**，需签名 |

**当前未启用**：
- 数字签名
- 自动更新
- Code signing certificate

## 7. 跨视图引用

- 想看进程 / task 怎么**跑** → `02-process-view.md`
- 想看代码**怎么组织** → `03-development-view.md`
- 想看 capabilities 的**安全边界** → 本视图 §2
- 想看 SSH vs local 的**实际差异** → 本视图 §3
