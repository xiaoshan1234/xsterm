# Create Session 配置参考

本文档梳理 `CreateSessionDialog` 中所有可配置项及其来源。开发者可借此理解每个字段的语义、默认值、UI 控件、底层代码与持久化行为。

## 概述

`CreateSessionDialog` 顶部两个 Tab（**Shell** / **SSH**），每个 Tab 内部用侧边栏 section 切换配置面板。

| Tab | 侧边栏 Section | 渲染组件 | 适用配置 |
|----|---------------|---------|---------|
| Shell | General | `LocalSessionForm` | `LocalSessionConfig` |
| Shell | Common | `CommonSettingsForm` | `SessionDisplayConfig`（部分字段） |
| Shell | Display | `DisplayConfigForm` | `SessionDisplayConfig`（核心字段） |
| SSH | Link | `SshSessionForm` (section="link") | `SSHSessionConfig`（连接参数） |
| SSH | System | `SshSessionForm` (section="system") | `SSHSessionConfig`（连接选项） |
| SSH | Common | `CommonSettingsForm` | `SessionDisplayConfig`（部分字段） |
| SSH | Display | `DisplayConfigForm` | `SessionDisplayConfig`（核心字段） |

Common 与 Display 都绑定到同一份 `displayConfig` 状态，两者是字段集合的分工（Common 偏 19 个新增七类字段，Display 偏字体/光标/滚动历史等 8 个老字段）。

`EditSessionDialog` 的 section 顺序与 Create 相同，但去掉了顶层 Tab，类型在打开时已锁定。

---

## 1. Common Settings

`CommonSettingsForm` 含 22 个字段，分 4 个 `<details>` 分组（Display / Keyboard / Security / Logging）。所有字段都写到 `SessionDisplayConfig` 上。

### 1.1 Display 分组（Common 内的 8 个字段）

来自 `src/types/session.ts` 的 `SessionDisplayConfig`，以下 8 个字段在 Common 的 Display 分组中：

| 字段 | 类型 | 默认值 | UI 控件 | 说明 | spec / 代码 |
|------|------|-------|--------|------|-------------|
| `lineTimestamp` | `boolean` | `false` | `<input type="checkbox">` | 每行输出前加时间戳 | `session-config-common.md` 时间戳 |
| `timeFormat` | `string` | `[HH:mm:ss]` | `<input type="text">` | xterm datetime 格式（仅启用时间戳时生效） | `session-config-common.md` 时间格式 |
| `dateTimeFormat` | `string` | `yyyy-MM-dd HH:mm:ss` | `<input type="text">` | 完整日期时间格式 | `session-config-common.md` 日期时间格式 |
| `autoWrap` | `boolean` | `true` | `<input type="checkbox">` | 自动换行（DECAWM）；xterm 映射为 `convertEol` | `session-config-common.md` 自动换行 |
| `reverseVideo` | `boolean` | `false` | `<input type="checkbox">` | 反转前景/背景色（DECSCNM） | `session-config-common.md` 屏幕反色 |
| `mouseWheelScrollLines` | `number` | `1` | `<input type="number">` | 滚轮每 tick 滚动行数 | `session-config-common.md` 鼠标滚轮滚动步长 |
| `sizingMode` | `"auto" \| "fixed"` | `"auto"` | `FormRadioGroup` | 窗口缩放时终端如何调整大小；Auto = 自动跟随，Fixed = 锁定行列 | `session-config-common.md` 终端尺寸模式 |
| `cols` | `number` | （固定模式必填；自动模式仅作启动提示） | `<input type="number" min={1} max={500}>` | Fixed 模式下锁定的列数；Auto 模式下显示且不可编辑 | `session-config-common.md` 列 |
| `rows` | `number` | （固定模式必填；自动模式仅作启动提示） | `<input type="number" min={1} max={200}>` | Fixed 模式下锁定的行数；Auto 模式下显示且不可编辑 | `session-config-common.md` 行 |
| `syncRemoteTitle` | `boolean` | `true` | `<input type="checkbox">` | 同步远程终端标题到窗口（DCS title） | `session-config-common.md` 远程标题更改标签标题 |

### 1.2 Keyboard 分组（7 个字段）

| 字段 | 类型 | 默认值 | UI 控件 | 说明 | spec / 代码 |
|------|------|-------|--------|------|-------------|
| `backspaceSends` | `"auto" \| "backspace" \| "delete"` | `"auto"` | `<select>` | 退格键发送 `^H` 或 `^?` | `session-config-common.md` 退格键发送 |
| `deleteSends` | `"auto" \| "backspace" \| "delete"` | `"auto"` | `<select>` | 删除键发送 `^H` 或 `^?` | `session-config-common.md` 删除键发送 |
| `lineFeedMode` | `boolean` | `false` | `<input type="checkbox">` | Enter 发送 CR / CR+LF（LNM） | `session-config-common.md` 新命令行模式 |
| `cursorKeyMode` | `"normal" \| "application"` | `"normal"` | `<select>` | 方向键序列格式（DECCKM） | `session-config-common.md` 光标键模式 |
| `keypadMode` | `"normal" \| "application"` | `"normal"` | `<select>` | 数字小键盘模式（DECNKM） | `session-config-common.md` 数字键盘模式 |
| `modifyOtherKeysFormat` | `"xterm" \| "fixterm"` | `"xterm"` | `<select>` | Ctrl/Shift/Alt 组合编码格式 | `session-config-common.md` 其他修饰键格式 |
| `altSendsEscape` | `boolean` | `true` | `<input type="checkbox">` | Alt 键发送 ESC 前缀 | `session-config-common.md` Alt 修饰键行为 |

Word separator 字段（`wordSeparatorChars` / `altScreenWordSeparatorChars`）在 `SessionDisplayConfig` 中保留，目前未在 `CommonSettingsForm` 暴露 UI（参见 `src/types/session.ts`）。

### 1.3 Security 分组（2 个字段）

| 字段 | 类型 | 默认值 | UI 控件 | 说明 | spec / 代码 |
|------|------|-------|--------|------|-------------|
| `clipboardRead` | `"ask" \| "allow" \| "deny"` | `"ask"` | `<select>` | 远程读取本地剪贴板权限 | `session-config-common.md` 远程读取剪贴板权限 |
| `clipboardWrite` | `"ask" \| "allow" \| "deny"` | `"ask"` | `<select>` | 远程写入本地剪贴板权限 | `session-config-common.md` 远程写入剪贴板权限 |

### 1.4 Logging 分组（5 个字段，对应 `SessionLoggingConfig`）

| 字段 | 类型 | 默认值 | UI 控件 | 说明 | spec / 代码 |
|------|------|-------|--------|------|-------------|
| `logging.enabled` | `boolean` | `false` | `<input type="checkbox">` | 是否记录会话输出 | `session-config-common.md` 日志类型 |
| `logging.append` | `boolean` | `true` | `<input type="checkbox">` | 追加而非覆盖 | `session-config-common.md` 日志选项 |
| `logging.fileNameTemplate` | `string` | `%n_%Y-%m-%d_%H-%M-%S.log` | `<input type="text">` | 文件名模板，支持 `%n` `%Y` `%m` `%d` `%H` `%M` `%S` | `session-config-common.md` 日志文件名模板 |
| `logging.maxSizeMb` | `number` | `10` | `<input type="number">` | 单文件最大 MB，0 表示无限制 | `session-config-common.md` 日志最大大小 |
| `logging.lineFormat` | `string` | `[%Y-%m-%d %H:%M:%S] %v` | `<input type="text">` | 行格式，`%v` 为实际输出 | `session-config-common.md` 日志内容格式 |

`logging` 字段在 `SessionDisplayConfig` 上是 `SessionLoggingConfig`（`src/types/session.ts:182`）。后端 `start_session_logging` 在 `src-tauri/src/services/session_log.rs` 接收该配置，目前只发出 `tracing::info!` 事件，磁盘写入是后续任务。

---

## 2. Shell Settings（Local）

`LocalSessionForm` 渲染，绑定到 `LocalSessionConfig`（`src/types/session.ts:61`）。Shell Tab 独有。

| 字段 | 类型 | 默认值 | UI 控件 | 说明 | spec / 代码 |
|------|------|-------|--------|------|-------------|
| `name` | `string` | 自动生成 | （在 dialog 顶部，不在此 form） | 用户友好名称；空时回退到 shell basename | `session-config-shell.md` name |
| `shellTemplate` | `"powershell" \| "powershell7" \| "cmd" \| "wsl" \| "bash" \| "zsh" \| "sh" \| "custom"` | （OS 默认） | `<select>` | 预设 shell 模板；空选项 = `Default (per OS)` | `session-config-shell.md` shell |
| `shell` | `string` |  | `<input type="text">` | 显式 shell 路径（仅 `shellTemplate === "custom"` 时显示） | `session-config-shell.md` shell |
| `termType` | `string` | `xterm-256color` | `<select>` | 通告给 PTY 的终端类型；写入 `TERM` 环境变量 | `session-config-shell.md` 终端类型 |
| `charset` | `string` | `utf-8` | `<select>` | 字符编码；写入 `LC_ALL` 环境变量 | `session-config-shell.md` 字符集 |
| `startupCommand` | `string` |  | `<input type="text">` | shell 启动后自动执行的命令 | `session-config-shell.md` 启动后执行命令 |
| `startupDelayMs` | `number` | `0` | `<input type="number" min={0}>` | 发送 startupCommand 前延迟毫秒数 | `session-config-shell.md` 启动后执行命令 |
| `cwd` | `string` | 用户主目录 | `<input type="text">` | 起始工作目录 | `session-config-shell.md` 工作目录 |
| `args` | `string[]` |  | `<input type="text">` | 传递给 shell 的额外参数（空格分隔） | `session-config-shell.md` 参数 |
| `envConfig.env` | `Record<string, string>` |  | 多行 KEY/VALUE + Add/Remove | 附加环境变量 | `session-config-shell.md` 环境变量 |

后端应用：`src-tauri/src/services/local_session.rs` 中 `create_local_session` 把 `term_type` / `charset` 写到 `CommandBuilder.env()`，`startup_command` / `startup_delay_ms` 走单独 `backend.spawn` 任务在延迟后写 PTY，`initial_rows` / `initial_cols` 决定 `PtySize`（24×80 fallback）。

---

## 3. SSH Settings

`SshSessionForm` 渲染，绑定到 `SSHSessionConfig`（`src/types/session.ts:81`）。SSH Tab 独有。Link tab 只显示连接认证字段，System tab 只显示连接选项字段。

### 3.1 Link section（连接参数）

| 字段 | 类型 | 默认值 | UI 控件 | 说明 | spec / 代码 |
|------|------|-------|--------|------|-------------|
| `name` | `string` | 自动生成 | （在 dialog 顶部） | 用户友好名称；空时回退到 `user@host` | `session-config-ssh.md` name |
| `host` | `string` |  | `<input type="text">` | 远端主机名 / IP | `session-config-ssh.md` host |
| `port` | `number` | `22` | `<input type="number">` | 端口；范围 1 to 65535（`validateSshConfig` 校验） | `session-config-ssh.md` port |
| `username` | `string` |  | `<input type="text">` | 登录用户 | `session-config-ssh.md` username |
| `auth_type` | `"password" \| "key"` | `"password"` | `<select>` | 认证方式 | `session-config-ssh.md` auth_type |
| `password` | `string` |  | `<input type="password">` | 密码（仅 `auth_type === "password"`） | `session-config-ssh.md` password |
| `key_file` | `string` |  | `<input type="text">` | 私钥路径（仅 `auth_type === "key"`） | `session-config-ssh.md` key_file |
| `passphrase` | `string` |  | `<input type="password">` | 私钥口令（仅 `auth_type === "key"`，可选） | `session-config-ssh.md` passphrase |
| `knownHostsPath` | `string` |  | `<input type="text">` | known_hosts 路径；当前未做 host key 校验（AGENTS.md 已记录） | `session-config-ssh.md` known_hosts |
| `proxyJump` | `string` |  | `<input type="text">` | ProxyJump 主机（`user@bastion:port`），后端仅解析并日志，未做实际跳转 | `session-config-ssh.md` proxy_jump |
| `charset` | `string` | `utf-8` | `<select>` | 流编码，写入 `LC_ALL` 环境变量 | `session-config-shell.md` charset（共用） |

### 3.2 System section（连接选项，可折叠）

| 字段 | 类型 | 默认值 | UI 控件 | 说明 | spec / 代码 |
|------|------|-------|--------|------|-------------|
| `termType` | `string` | `xterm-256color` | `<select>` | 远端 PTY 终端类型 | `session-config-ssh.md` 终端类型 |
| `initialRows` | `number` | `24` | `<input type="number">` | 初始 PTY rows | `session-config-ssh.md` initialRows |
| `initialCols` | `number` | `80` | `<input type="number">` | 初始 PTY cols | `session-config-ssh.md` initialCols |
| `keepaliveInterval` | `number` | `0`（禁用） | `<input type="number">` | 心跳间隔秒数 | `session-config-ssh.md` keepaliveInterval |
| `connectionTimeout` | `number` | `20` | `<input type="number">` | 连接超时秒数 | `session-config-ssh.md` connectionTimeout |
| `tcpNoDelay` | `boolean` | `true` | `<input type="checkbox">` | 关闭 Nagle 算法（`TcpSocket::set_nodelay`） | `session-config-ssh.md` tcpNoDelay |
| `soKeepalive` | `boolean` | `false` | `<input type="checkbox">` | 启用 `SO_KEEPALIVE` | `session-config-ssh.md` soKeepalive |
| `nullPacketKeepalive` | `boolean` | `false` | `<input type="checkbox">` | 60s 间隔发空包心跳（应用层） | `session-config-ssh.md` nullPacketKeepalive |
| `enableCompression` | `boolean` | `false` | `<input type="checkbox">` | 启用 zlib 压缩 | `session-config-ssh.md` enableCompression |

后端应用：`src-tauri/src/infrastructure/ssh.rs::RusshBackend::connect` 处理 `tcp_nodelay` / `so_keepalive` / `null_packet_keepalive` / `charset` / `term_type`；`known_hosts_path` 与 `proxy_jump` 当前只记录日志，不做实际跳转或校验。

---

## 4. Display Settings（独立 section）

`DisplayConfigForm` 渲染，绑定到 `SessionDisplayConfig` 的核心 8 个字段（字体/光标/滚动历史）。Common 内的 Display 分组（见 1.1）覆盖其他 8 个字段，两者合在一起构成完整的 `SessionDisplayConfig`。

| 字段 | 类型 | 默认值 | UI 控件 | 说明 | spec / 代码 |
|------|------|-------|--------|------|-------------|
| `fontSize` | `number` | 14 | `<input type="number">` | xterm 字号 | `session-config-common.md` 显示与布局 |
| `fontFamily` | `string` | `Menlo, Monaco, 'Courier New', monospace` | `<select>` | 字体栈；空选项 = 全局默认 | `session-config-common.md` 显示与布局 |
| `cursorStyle` | `"block" \| "underline" \| "bar"` | `block` | `<select>` | 光标形状；空选项 = 全局默认 | `session-config-common.md` 光标样式 |
| `cursorBlink` | `boolean` | `true` | `<input type="checkbox">` | 光标闪烁 | `session-config-common.md` 显示与布局 |
| `scrollback` | `number` | `20000` | `<input type="number">` | 回滚行数 | `session-config-common.md` 回滚行数 |
| `lineHeight` | `number` | 全局默认 | `<input type="number" step="0.1">` | 行高 | `session-config-common.md` 显示与布局 |
| `letterSpacing` | `number` | 全局默认 | `<input type="number" step="0.1">` | 字符间距 | `session-config-common.md` 显示与布局 |
| `cursorWidth` | `number` | 全局默认 | `<input type="number">` | 光标宽度（block 以外） | `session-config-common.md` 光标样式 |

xterm 实际生效的字段在 `src/hooks/useXterm.ts` 的 `SETTABLE_KEYS` 列表中管控（9 个：原 8 个 + `autoWrap`）。`autoWrap` 在 xterm 端映射为 `convertEol`，二者通过 `XTERM_OPTION_MAP` 转换。17 个 xterm 不支持的新字段保留在 `SessionDisplayConfig` 中但不写入 `xterm.options`，避免运行时错误。

---

## 5. 附录 A：实现细节

### 前端类型
- `src/types/session.ts`: 211 行，定义 `LocalSessionConfig` (`L61-79`)、`SSHSessionConfig` (`L81-115`)、`SessionDisplayConfig` (`L117-183`)、`SessionLoggingConfig` (`L185-196`)、`SessionEnvConfig` (`L198-200`)、`SavedSessionConfig` (`L202-205`)。
- `src/types/capabilities.ts`: `CapabilityFlags`（每会话能力元数据）。

### 前端组件
- `src/components/dialogs/CreateSessionDialog.tsx`: 顶层 Dialog，编排 Tab + section 切换。
- `src/components/dialogs/EditSessionDialog.tsx`: 编辑对话框，复用同一组 section。
- `src/components/dialogs/SessionFormLayout.tsx`: 顶 Tab + 侧边栏 + 面板布局。
- `src/components/dialogs/LocalSessionForm.tsx`: Shell 配置 10 个字段。
- `src/components/dialogs/SshSessionForm.tsx`: SSH 配置 Link/System 双 section，含 `validateSshConfig`。
- `src/components/dialogs/CommonSettingsForm.tsx`: Common 22 个字段（4 个 `<details>` 分组）。
- `src/components/dialogs/DisplayConfigForm.tsx`: Display 8 个核心字段。

### 前端服务
- `src/services/sessionService.ts`: `createSession` / `createLocal` / `createSsh` / `writeSession` / `resizeSession` / `closeSession` / `uploadImageToSshSession`。
- `src/services/sessionStorage.ts`: `SAVED_SESSION_CONFIG_VERSION = 1`，`migrateSavedConfig` 处理 v0 → v1 迁移。

### Rust 数据模型
- `src-tauri/src/models/session.rs`: `LocalSessionConfig` (`L31-62`)、`SSHSessionConfig` (`L65-127`)、`DisplayConfig` (`L177-228`)、`SessionLoggingConfig` (`L161-174`)、`EnvConfig` (`L231-235`)、`SavedSessionConfigV1` (`L270-281`)、`SavedSessionConfigKind` (`L289-296`)。
- 所有新结构体 `#[serde(rename_all = "camelCase")]` 与 `#[serde(default)]` 配合，前端 JSON 缺失字段时降级为 `None`。

### Rust 服务
- `src-tauri/src/services/local_session.rs`: `create_local_session` 应用 `term_type` / `charset` / `startup_command` / `startup_delay_ms` / `initial_rows` / `initial_cols` / `env_config` / `args` 到 PTY。
- `src-tauri/src/services/ssh_session.rs`: 调用 `SshBackend::connect` 启动 SSH 会话。
- `src-tauri/src/infrastructure/ssh.rs`: `RusshBackend::connect` 应用 `tcp_nodelay` / `so_keepalive` / `null_packet_keepalive` / `charset` / `term_type` / `known_hosts_path` / `proxy_jump`。
- `src-tauri/src/services/session_log.rs`: `start_session_logging` 接收 `SessionLoggingConfig`，当前仅 `tracing::info!`，磁盘写入后续任务。
- `src-tauri/src/services/session_manager.rs`: `create_local` / `create_ssh` 是 session 创建入口，已调用 `start_session_logging`。

---

## 6. 附录 B：spec 文档对照

| spec | 范围 | 关键字段 |
|------|------|---------|
| `doc/session-config-common.md` | Common 7 类 19 个字段 + Logging 5 个字段 | 时间戳、显示、鼠标、窗口、键盘、安全、日志 |
| `doc/session-config-shell.md` | Shell 10 个字段 | name / shell / termType / charset / args / cwd / startupCommand / env |
| `doc/session-config-ssh.md` | SSH 11 个字段 + 13 个 common 字段 | host / port / auth / 连接选项 / common 字段 |

spec 文件与代码实现存在轻微偏差：
- `session-config-ssh.md` 包含 13 个 common 字段，目前只通过 `CommonSettingsForm` 统一暴露，不在 `SshSessionForm` 内部重复。
- `session-config-shell.md` 提到"shellTemplate"用 `enum`，具体值在 `LocalSessionForm` 中编码为 `powershell` / `powershell7` / `cmd` / `wsl` / `bash` / `zsh` / `sh` / `custom` 八个字符串。

---

## 7. 附录 C：持久化

- `SAVED_SESSION_CONFIG_VERSION = 1`（`src/services/sessionStorage.ts:15`）。
- `migrateSavedConfig` 自动兼容 v0 → v1：旧形如 `{ id, name, type, localConfig?, sshConfig? }` 被改写为新的 v1 形状（`type` + `config` 扁平 discriminator）。
- 所有 `SessionDisplayConfig` / `LocalSessionConfig` / `SSHSessionConfig` 字段都是 `Optional`，v1 持久化可以缺字段且向后兼容。
- 新字段（`shellTemplate` / `termType` / `charset` / `startupCommand` / `startupDelayMs` / `tcpNoDelay` / `soKeepalive` / `nullPacketKeepalive` / `display.*` / `logging`）经由 `migrateSavedConfig` 的 v1 pass-through 验证测试（`src/services/sessionStorage.test.ts`）覆盖，旧 v1 payload 携带新字段时不会丢失。
- Rust 端 `serde(rename_all = "camelCase")` 让 `shell_template` → `shellTemplate` 之类映射透明进行，但只接受 camelCase 传入；snake_case 字段在反序列化时会被静默忽略（`models/session.rs` 第 614、663、757、794 行的测试证实）。
