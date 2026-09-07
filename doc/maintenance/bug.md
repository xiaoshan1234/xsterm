# Bug 001
## 现象
对pane进行垂直/水平split会导致原pane的内容丢失
## 理想效果
split不会导致原来的 pane 内容丢失
## BUG 原因
pane split 时 React 会重新 mount 原 pane 的 Terminal 组件，xterm.js 实例被销毁并重新创建，导致之前的历史输出无法保留。
## 解决方案
1. 新增 `src/utils/sessionOutputBuffer.ts`，按 session 维护一个原始输出缓冲区。
2. 在 `useTauriTerminalOutput` 中把收到的后端输出同时追加到该缓冲区，并在 Terminal 重新挂载时先重放缓冲区内容，再开始接收新事件。
3. 在 `useSessionActions` 中关闭 session 时（`closeSession`、`closePane`、`closeWindow`、`closeWorkspace`、`reconnectSession`、`removeConfig` 等）清理对应缓冲区，避免内存泄漏。
## 是否解决
YES

# Bug 002 
## 现象
从select session 点击多次option 会创建多个session.
## 理想效果
请修改为一次最多创建一个，如果失败，显示提示.
## BUG原因
SelectSessionDialog 中的每个 option 按钮直接调用 onSelectSession/onSelectConfig，没有做并发/重复点击保护。快速点击时，同一个保存配置会多次调用 `createSessionFromSavedConfig`，导致后端重复创建多个 session；同时已存在的 session 也可能被重复绑定到 pane。
## 解决方案
1. 在 SelectSessionDialog 增加 `disabled` 属性，在创建/绑定过程中禁用所有 option 按钮。
2. 在使用 SelectSessionDialog 的两个父组件（PaneInitCard、Pane）中维护 `isSubmitting` 状态，并使用同步的 ref 锁（`isSubmittingRef`）作为第一道防线，确保第一次点击后立即拦截后续点击。
3. 对 onSelectSession/onSelectConfig 的异常进行统一捕获：已占用的 session 保留原有提示，其他失败通过 `window.alert` 提示用户。
## 是否解决
YES

# Bug 003
## 现象
在xterm终端中粘贴一次，输入内容出现双倍数据。
## 理想效果
粘贴一次应该只输入一次数据，不应重复。
## BUG原因
前期修复（本 Bug 原方案）通过 `lastKeyboardPasteRef` 阻止了键盘快捷键粘贴（`Cmd+V`/`Ctrl+Shift+V`/`Shift+Insert`）与浏览器原生 `paste` 事件的重复发送。但在实际运行中，即使非键盘触发的粘贴（如 `Ctrl+V`、右键粘贴），浏览器原生 `paste` 事件仍可能同时触发两条数据路径：
1. 文档级 `handlePaste` 处理函数读取剪贴板并调用 `writeSession` 发送数据；
2. xterm.js 的 `onData` 事件处理器也会收到同样的粘贴内容，并再次调用 `writeSession`。
`Terminal.tsx` 中 `onData` 原有的 30ms 去重窗口无法覆盖两条路径之间的实际时间差（日志中观察到约 31ms），导致后端收到两次 `writeSession` 调用，回显后终端出现双倍内容。
## 解决方案
1. 在 `src/components/Terminal.tsx` 的 `handlePaste` 中，处理文本粘贴时调用 `e.stopPropagation()`，阻止 `paste` 事件继续传播到 xterm.js 的 textarea，避免 xterm 内部路径触发 `onData`。
2. 在 `handlePaste` 发送文本后，以及键盘快捷键粘贴的 `readText().then()` 回调发送文本后，更新 `lastDataRef.current = { text, time: Date.now() }`，让后续可能到达的 `onData` 事件被去重逻辑拦截。
3. 将 `onData` 去重时间阈值从 30ms 提高到 100ms，覆盖粘贴两条路径之间的典型时间差。
## 是否解决
YES

# Bug 004
## 现象
打开 opencode 后，session 断开并重新连接，此时在重新连接的 session 上移动鼠标，终端出现乱码。
## 理想效果
重新连接后移动鼠标不应出现乱码，应正常处理或不产生额外字符输出。
## BUG原因
重新连接（`reconnectSession`）会在后端创建一个全新的 PTY/SSH session（新的 sessionId），但前端的 xterm.js 实例是同一个对象，仍然保留着旧 session 的终端模式状态（如鼠标追踪模式）。当用户移动鼠标时，xterm.js 继续按照旧模式生成鼠标事件转义序列并发送给新 PTY；而新 PTY 没有启用对应鼠标模式，这些转义序列被当作普通字符回显到终端，于是出现乱码。原先代码在 sessionId 变化时只调用了 `xterm.clear()`，它只清屏并不会重置 xterm 内部的模式状态。
## 解决方案
在 `src/components/Terminal.tsx` 的 sessionId 变化 effect 中，将 `xterm.clear()` 替换为 `xterm.reset()`。`reset()` 相当于 RIS（Reset to Initial State），会清除屏幕并重置 xterm 的所有内部模式状态，使前端 xterm 实例与全新的 PTY session 状态保持一致，避免旧 session 的鼠标模式继续生效。
## 是否解决
YES

# Bug 005
## 现象
在终端中输入字符时存在明显延迟，部分字符被静默丢弃（例如长按同一键时只有少量字符到达、快速连打相同字符时第二个被吃掉），整体感觉"输入太慢/漏字符"。
## 理想效果
键入字符应该几乎即时到达 PTY/SSH 后端，肉眼无明显延迟；OS 长按 autorepeat 和快速连打相同字符都不应被吞；与系统终端 iTerm2、Windows Terminal 同级别。
## BUG原因
两层叠加：

1. **`xterm.onData` 的字符级时间去重窗口（曾为 100ms）** (`src/components/Terminal.tsx`)：`last.text === data && now - last.time < N` 这一条件会把任何"N 毫秒内同字符"的二次触发静默丢弃。这个窗口从 Bug 003 的 30ms → 100ms（覆盖观察到的 31ms 粘贴双路径间隔），副作用是吞掉 OS 长按 autorepeat 的 ~67% 重复键和快速连打 `aa`/`nn` 等同字符输入。Bug 003 同时加上了 `handlePaste` 里的 `e.stopPropagation()` 作为主防线，但后续分析意识到 stopPropagation 已经足够，时间窗口作为冗余保险并不必要：
   - Bug 003 的 stopPropagation 在 document 级 capture 阶段调用，能阻止事件到达 target（xterm textarea）的 handlers；
   - 如果 stopPropagation 真的失效，时间窗口也救不了 — 失效可能发生在任何延迟（同步到几百毫秒）；
   - 所以这个"保险"既不必要，也不充分。
2. **`sessionService.writeSession` 在热路径上调用 `logger.debug`** (`src/services/sessionService.ts:27,31`)：dev 模式下 `LoggerContext.debug` 同步执行 `console.debug(...)` + 序列化数据，并额外发起一次 `invoke("log_message", ...)` IPC，把每次按键的输入内容写到 Rust 日志。dev 模式下每次按键 = 1 次 `write_session` IPC + 1 次 `log_message` IPC + 控制台序列化开销。

~~【已撤回】rAF 输入批处理 + 10ms dedup~~：曾考虑通过 `requestAnimationFrame` 合并每帧按键和缩小 dedup 窗口，被实施并回滚。原因：
- rAF 批处理在正常打字场景（≥80ms/字符）下字符本就跨多帧，调度只是把发送时机推迟 0-16ms 而不减少 IPC 次数，纯粹引入延迟；
- 缩小 dedup 窗口只是把 Bug 003 的"猜一个合理时间"换成"猜一个更紧的时间"，本质问题没解决；
- 两个机制的合理解都是"相信 stopPropagation"，既然如此就把它们一起去掉。
## 解决方案
1. `src/components/Terminal.tsx`：删除 `xterm.onData` 内的字符级时间去重逻辑，包括 `lastDataRef` ref 的 declaration、onData 里的 dedup 检查、3 处 paste 路径里 `lastDataRef.current = { text, time: ... }` 的赋值。完全信任 Bug 003 的 `e.stopPropagation()`。onData 现在直接：聚焦检查 → 连接检查 → localEcho (可选) → `writeSessionRef.current(sessionId, data)`，无任何过滤。
2. `src/services/sessionService.ts`：移除 `writeSession` 内两个 `logger.debug` 调用，把 `async/await invoke(...)` 改为 `return invoke(...).then(...)` 的 fire-and-forget 形式。返回类型仍为 `Promise<void>` 以兼容 `CommandSendPanel` 中已有的 `.catch(...)` 链式调用。

**未动 → flag-based → 已用 preventDefault 彻底简化**：原本的 `lastKeyboardPasteRef` 时间窗口 → flag → 全部移除。键盘粘贴 handler 现在**只**为 `Ctrl+Shift+V` 这种浏览器默认不合成 paste 事件的快捷键服务（`src/components/Terminal.tsx:155-165`）；`Cmd+V`/`Ctrl+V`/`Shift+Insert` 这些浏览器默认会合成 paste 事件的快捷键**完全不进键盘 handler**，让浏览器合成 paste 事件 → document handler 处理 —— 这样 document handler 才能拿到 clipboardData 里的 `text` 和 `files` 两类数据，**恢复 SSH 图片粘贴功能**。

`preventDefault()` 是个二元操作：要么全阻止要么全放行，没办法区分剪贴板里是文本还是图片。所以只能针对"浏览器本来就不合成 paste 事件"的快捷键用 preventDefault，对"浏览器默认会合成"的快捷键必须让事件触发，让 document handler 自己读完整的 clipboardData。

三条 paste 路径 → 两条互斥路径：
- **键盘 handler 路径**：`Ctrl+Shift+V` 唯一，因为浏览器不为它合成 paste 事件
- **document handler 路径**：`Cmd+V`/`Ctrl+V`/`Shift+Insert`/右键/浏览器菜单，全部统一走这里

不再需要任何 flag、queueMicrotask、时间窗口或"猜延迟"的去重机制。
## 是否解决
YES

# Bug 006
## 现象
在 UI 创建 SSH session 时，后端返回错误 `invalid args 'config' for command 'create_session': missing field 'authType'`，session 创建失败。
## 理想效果
前端通过 CreateSession的 SSH tab 提交配置后，`create_session` Tauri 命令应能成功反序列化配置并创建 SSH session，无 IPC 反序列化错误。
## BUG 原因
后端 `SSHSessionConfig` 的 `auth` 字段（`src-tauri/src/models/session.rs:67-103`）通过 `#[serde(flatten)]` 嵌入了一个 `SSHAuth` tagged enum（`session.rs:129-139`），该 enum 使用 `#[serde(tag = "authType", rename_all = "camelCase")]`。serde 反序列化时，`SSHAuth` 的 enum 判别 tag `authType` 成为 `SSHSessionConfig` 的必需字段。

前端 `SSHSessionConfig`（`src/types/session.ts:84-118`）和 spec 文档（`doc/requirements/prd-0.1/create-session-config.md:112-117`）都把认证字段定义为扁平结构：`auth_type: "password" | "key"` + 独立 `password` / `key_file` / `passphrase`。前端发送的 JSON 形如 `{ "auth_type": "password", "password": "..." }`，但后端期望 `{ "authType": "password", "password": "..." }` —— 缺少 `authType` tag，serde 直接抛错。

该不匹配在 commit `7dbfa27`（feat(rust): mirror spec fields to backend structs + Default derive + test fixture update）引入新 `SSHAuth` enum 时出现，TypeScript 侧、spec 文档、表单、持久化层均未同步更新。
## 解决方案
1. 删除 `src-tauri/src/models/session.rs` 中的 `SSHAuth` enum。
2. 将 `SSHSessionConfig.auth: SSHAuth` 字段替换为 4 个扁平字段：`auth_type: String`、`password: Option<String>`、`key_file: Option<String>`、`passphrase: Option<String>`。在 `auth_type` 和 `key_file` 字段上加 `#[serde(rename = "...")]` 覆盖 `rename_all = "camelCase"`，保留 snake_case JSON key。
3. 在 `SSHSessionConfig` 上加 `#[serde(deny_unknown_fields)]`，使旧 `authType` payload 被显式拒绝（不静默通过）。
4. 更新 `Default` impl 用 `auth_type: "password".to_string()`。
5. 更新 `models/session.rs::mod tests` 中所有 11 处 serde roundtrip 测试的 fixture 语法。
6. 新增 2 个回归测试：`ssh_session_config_deserializes_flat_auth_type_field` 和 `ssh_session_config_deserializes_key_file_auth`，覆盖前端实际发送的 JSON 形状。
7. 更新 `infrastructure/ssh.rs::authenticate` 函数（`ssh.rs:500-530`）：签名从 `(handle, username, &SSHAuth)` 改为 `(handle, &SSHSessionConfig)`，body 用 `match config.auth_type.as_str() { "password" => ..., "key" => ..., _ => Err(...) }`；密码/key-file/passphrase 直接从 `config.password` / `config.key_file` / `config.passphrase` 读取。
8. 更新 `services/session_manager.rs` 中 7 处 mockall fixture 的语法。
9. 保持前端、spec 文档、持久化层、表单代码均不动（它们本来就与 spec 一致）。

修复 commit: `e42cec4 fix(ssh-config): flatten SSHAuth enum to match spec/frontend payload`
## 是否解决
YES

# Bug 007
## 现象
`isSessionUsedInOtherWindow(workspaces, currentWorkspaceId, currentWindowId, sessionId)` 在"session 只存在于当前窗口"的情况下错误地返回 `true`。新增的单元测试套件（`src/contexts/session/paneUtils.test.ts`）中对应用例被标记为 `.todo` —— 其期望值为 `false` 而当前实现返回 `true`。
## 理想效果
仅当 `sessionId` 出现在一个**不是**当前 workspace/window 的窗口中时返回 `true`；当 session 仅存在于当前窗口时返回 `false`；当 `currentWorkspaceId` 或 `currentWindowId` 为 `null` 时维持现有语义（视为"无当前窗口"，找到即返回 `true`）。
## BUG原因
`src/contexts/session/paneUtils.ts` 第 174–188 行。函数遍历 `workspaces[].windows[]`，对**第一个**含目标 session 的窗口立即 `return true`，完全跳过了与 `currentWorkspaceId` / `currentWindowId` 的比对。文档注释明确说"any window other than the currently active one"，但实现里的早返回路径没有遵循该约束。
## 解决方案
在含目标 session 的窗口命中分支中，按以下顺序判断：
1. 若 `currentWorkspaceId === null || currentWindowId === null`，按现有语义返回 `true`；
2. 若 `workspace.id === currentWorkspaceId && window.id === currentWindowId`，`continue` 到下一个窗口；
3. 否则返回 `true`。
循环结束后返回 `false`。修复后把测试文件里的 `it.todo("isSessionUsedInOtherWindow returns false when session is only in the current window")` 改回 `it(...)`，断言期望值 `false`，验证全绿。
## 是否解决
NO

# Bug 008
## 现象
主工作区（workspace 容器）只占屏幕左侧约 40% 宽度，剩余约 60% 是空白背景。窗口越窄空白越明显，800×600 时主区只剩 ~350px。
## 理想效果
主工作区应占满 sidebar 之外的全部可用宽度。
## BUG原因
`src/components/AppLayout.tsx` 第 99-108 行 `workspaces.map` 外层 Box 缺 `flexDirection: column`。父级 `Box`（包含 sidebar + workspaces + WorkspaceBottomBar）正确设了 `flexDirection: column`，但 workspaces map 出来的 Box 没有指定方向，默认 `flexDirection: row`，导致 `<WorkspaceContainer>`（其内部是 `display:flex, flexDirection:column`）在 row 方向上只取自然宽度（≈TabBar + +/save 图标宽度 ≈ 350px），而不是 `flex: 1` 应有的拉伸宽度。
## 解决方案
给该 Box 加上 `flexDirection: "column"` 和 `minWidth: 0`，使 WorkspaceContainer 在 cross axis（width）上能正确填满父容器。
## 是否解决
YES

# Bug 009
## 现象
系统偏好为浅色时，AppBar / Drawer / SettingsView 走 MUI 浅色主题（白底），但 `PaneInitCard` / `InitWindowView` / `Pane` 等组件仍显示深色背景——出现"半白半黑"的撕裂 UI。把 Chrome theme 切到 Light 即可复现。
## 理想效果
任意 Chrome theme（system / dark / light）下，所有面板（AppBar、Drawer、Workspace、Pane 容器、Card）的背景、文字、边框都跟随同一个主题。
## BUG原因
`src/theme/globalStyles.tsx` 在 `MuiGlobalStyles` 里用 `:root { '--bg-primary': '#1e1e1e', ... }` 把这些 CSS 变量**硬编码为深色值**，不跟随 `effectiveMode`。组件里多处直接引用 `var(--bg-*)`（如 `PaneInitCard`、`InitWindowView`、`Pane`），所以即便 MUI 切到 light，这些组件仍然渲染深色。
## 解决方案
1. 删掉 `globalStyles.tsx` 里 `:root` 的 CSS 变量块。
2. 在 `src/main.tsx` 的 `ThemedApp` 中新增 `applyThemeCssVars(theme)`，通过 `useEffect` 在主题变化时把 MUI theme 派生的 CSS 变量写到 `document.documentElement.style`：
   - `--bg-primary / --bg-secondary / --bg-tertiary / --bg-hover / --bg-active` 从 `palette.background` 派生（light/dark 各自一套 hover/active 透明度）。
   - `--border-color` ← `palette.divider`
   - `--text-primary / --text-secondary / --text-muted` ← `palette.text`
   - `--accent / --accent-hover` ← `palette.primary`
   - `--accent-bg / --error-bg` ← 由 hex 转 `rgba(r,g,b, a)`（dark 0.15 / 0.1，light 0.08 / 0.08）保证浅色背景下也可见。
   - `--font-stack` ← `theme.typography.fontFamily`，`--font-mono` 保留 monospace fallback。
3. 修复后 dark/light 模式下 SettingsView 与 welcome 卡片背景、文字、边框全部跟随主题，CSS 变量通过 `getComputedStyle(document.documentElement).getPropertyValue('--bg-primary')` 实测分别为 `#1e1e1e` / `#fafafa`。
## 是否解决
YES

# Bug 010
## 现象
新建窗口首次启动时默认 800×600，对终端模拟器来说太小，sidebar（48px）+ 左半边 workspace 实际只剩 ~350px 宽，根本看不清内容。
## 理想效果
首次启动时默认尺寸足以容纳 sidebar + workspace + 多 pane，例如 1280×800，并设置合理的最小尺寸防止窗口被拖到无法使用的大小。
## BUG原因
`src-tauri/tauri.conf.json` 第 16-17 行 `width: 800, height: 600`，无最小尺寸约束。
## 解决方案
改为 `width: 1280, height: 800`，并新增 `minWidth: 800, minHeight: 500`。
> 注意：tauri.conf.json 改动只在 Rust 二进制被重新构建后生效。开发态 xsterm.exe（已构建于 8 月 3 日）仍使用旧 800×600；本地可通过 `npm run tauri dev` 重启或在 WebDriver REPL 用 `driver.manage().window().setRect({width:1280, height:800})` 临时模拟新尺寸验证。
## 是否解决
YES

# Bug 011
## 现象
点击侧边栏 "New Session" 打开新建会话对话框时，整个应用崩溃（React 根节点卸载，窗口变空白）。
## 理想效果
新建会话对话框应正常打开，用户能创建本地/SSH 会话。
## BUG原因
`src/components/dialogs/LocalSessionForm.tsx` 第 93 行使用了 `<Typography variant="subtitle2">` 渲染 "Environment Variables" 标题，但第 2 行的 MUI import 语句中 **没有导入 `Typography`**。`CreateSessionDialog` 默认停在 "Local Shell" 标签页并渲染 `LocalSessionForm`，渲染时遇到未定义的 `Typography` 标识符抛出 `ReferenceError: Typography is not defined`。React 19 在无错误边界时卸载整个根节点，导致 `#root` 变空、应用崩溃。该问题也导致 `npm run build`（tsc）报 TS2304 失败，是生产级阻塞。
## 解决方案
在 `src/components/dialogs/LocalSessionForm.tsx` 第 2 行的 MUI import 中补上 `Typography`：
```diff
-import { Box, Button, MenuItem, Select, TextField, IconButton, FormControl, InputLabel, Stack } from "@mui/material";
+import { Box, Button, MenuItem, Select, TextField, IconButton, FormControl, InputLabel, Stack, Typography } from "@mui/material";
```
修复后重新运行 spike/UI 测试可正常创建本地会话。
## 是否解决
YES


# Bug 012
## 现象
每次新建本地 shell（PowerShell、bash 等）后，pane 顶部立刻出现橙色横幅 `Connection lost. Press Enter to reconnect.`，但 shell 提示符（`PS C:\Users\LONER>` 等）仍正常渲染在横幅下方，看起来"提示符活着却显示连接丢失"。
## 理想效果
打开新 shell 后横幅不应出现；只有当 PTY/SSH 真正断开时才显示。
## BUG原因
`src-tauri/src/services/local_session.rs` 的 `spawn_output_forwarder`（原 205–232 行）在 `reader.read()` 返回 `Ok(0)` 时**无条件**判定为"shell 退出"，立刻 emit `session-disconnected` 并 break 循环：
```rust
Ok(0) => {
    let payload = serde_json::to_vec(&session_id).unwrap();
    let _ = backend_clone.emit("session-disconnected", &payload);
    break;
}
```
Windows ConPTY（portable-pty）在 `pair.master_reader()`（`try_clone_reader()`）返回的克隆句柄上，**第一次** `read()` 在子进程产生任何输出之前可能返回 `Ok(0)`（EOF）—— 这是 ConPTY 初始化竞态的已知表现。之后 shell 正常把 prompt 写到 PTY，但 forwarder 线程已经在第一次 Ok(0) 时自杀、emit 过 `session-disconnected`，前端 listener (`src/contexts/session/useTauriListeners.ts:27`) 立即把 `session.is_connected` 置 `false`，触发 `src/components/Pane.tsx:245` 的横幅。

附带次要问题：原代码 `Err(_) => break` 静默退出 forwarder，read 出错时前端永远看不到通知；SSH forwarder (`src-tauri/src/services/ssh_session.rs`) 有同样的 Ok(0)+silent-error 模式，虽然 SSH 用 `recv()` 阻塞而非 PTY 直读，但保留一致的 EOF 语义以便未来扩展。
## 解决方案
1. 在 `src-tauri/src/services/local_session.rs` 的 `spawn_output_forwarder` 引入 `seen_data: bool` 标志：
   - `Ok(0)` 且 `!seen_data` → `tracing::debug!` 记录 + `std::thread::sleep(100ms)` 继续循环（**不** emit `session-disconnected`）。这覆盖 ConPTY 首读 EOF 场景；shell 真正活着时下一轮 `read()` 就能拿到数据。
   - `Ok(0)` 且 `seen_data` → `tracing::info!` + emit `session-disconnected` + break。这是真正的 EOF（shell 已退出）。
   - `Err(e)` → `tracing::error!` + emit `session-disconnected` + break。修复原来静默死亡的次要 bug。
   - `Ok(n)` → `seen_data = true` + emit `session-output`（不变）。
2. 同样为函数补上 docstring，说明三种 EOF 分支的语义，避免后人误改。
3. `src-tauri/src/services/ssh_session.rs` 的 SSH forwarder 同步加 `seen_data`（写入 `tracing::info!` 时附带，便于定位"是首读就断还是运行中断"），`eprintln!` 升级为 `tracing::error!` 走统一日志通道。
4. `cargo check` 干净通过，`cargo test --lib` 68 个原有 mockall 测试全部 pass（`spawn_output_forwarder` 在测试里走 `TestAppBackend::spawn` no-op，forwarder 闭包根本不执行，故原有断言不受影响）。
## 是否解决
YES


# Bug 013
## 现象
每次新建本地 shell（PowerShell、bash 等）后，pane 顶部**始终**显示橙色横幅 `Connection lost. Press Enter to reconnect.`，无论 shell 是否在输出、用户是否操作。Bug 012 修过的 PTY forwarder EOF 路径走完后日志里所有 `createSession:result` 都是 `isConnected:true`，但横幅依然常驻；用户按 Enter 触发 reconnect → 创建新 session → 关闭旧 session → EOF → 横幅继续 → 死循环。日志证据：连续 4 次 `createSession` 紧跟 `closeSession` 前一个 id，`PTY EOF for session N after data — shell exited` 也按时打，但 `Transient PTY EOF before data` 一条都没有出现 —— 说明 forwarder 并没有"误判"提前断开。
## 理想效果
打开新 shell 后横幅不应出现；只有当 PTY/SSH 真正断开（且真的读出过数据之后 EOF）时才显示。
## BUG原因
Rust 后端的 `SessionInfo` 在 `src-tauri/src/models/session.rs:21-28` 标了 `#[serde(rename_all = "camelCase")]`：
```rust
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionInfo {
    pub id: u32,
    pub name: String,
    pub session_type: SessionType,
    pub is_connected: bool,
    pub capabilities: CapabilityFlags,
}
```
所以 IPC 返回的 JSON 是 `{"id":1,"name":"pws","sessionType":{...},"isConnected":true,"capabilities":{...}}`（日志中可见 `"isConnected":true`）。但 TypeScript 这一侧的接口仍然是蛇形：
- `src/services/sessionService.ts:11-17` 的 `SessionInfo.is_connected`、`SessionInfo.session_type`
- `src/types/session.ts:46-55` 的 `Session.is_connected`、`Session.session_type`

`invoke<SessionInfo>` 拿到的对象里 `info.is_connected === undefined`（字段名根本没匹配上），`info.session_type === undefined`。`buildFrontendSession`（`useSessionActions.ts:73-88`）把它原样拷到 React state：`{ is_connected: undefined, ... }`。`Pane.tsx:245` 渲染条件是 `!session.is_connected` —— `!undefined === true` —— 横幅从创建那一刻起就**永远**显示。同理 `Terminal.tsx` 的 `isConnectedRef.current` 也是 `undefined`，`onData` handler 在 `!isConnectedRef.current` 分支里吃掉所有非 `\r` 字符，用户输入根本进不到 PTY；只能按 Enter 触发 `reconnectSession`，导致日志里密集的 create+close 循环。

Bug 012 是同一个表象的另一种成因（ConPTY 首读 EOF → forwarder 自杀 → emit `session-disconnected` → React state 真把 `is_connected` 设成 `false`），但本次用户日志里没有触发 Bug 012 路径（没有 `Transient` 日志）。所以 Bug 012 仍然保留作为防御性修复；Bug 013 才是主因。
## 解决方案
1. 把所有从 IPC JSON 读出的 snake_case 字段改成 camelCase，与 Rust `rename_all = "camelCase"` 对齐：
   - `src/types/session.ts`：`Session.is_connected` → `isConnected`，`Session.session_type` → `sessionType`
   - `src/services/sessionService.ts`：`SessionInfo.is_connected` → `isConnected`，`SessionInfo.session_type` → `sessionType`
   - `src/contexts/session/useSessionActions.ts` `buildFrontendSession`：复制字段时同步改名
   - `src/contexts/session/useTauriListeners.ts:30`：`{...s, is_connected: false}` → `{...s, isConnected: false}`（保持 listener 仍能正确把已断开的 session 标 false）
   - `src/components/Pane.tsx`：3 处 `session.is_connected` / `isConnected={session.is_connected}` 同步改名
   - `src/contexts/session/paneUtils.test.ts:65`：测试 fixture 同步改名
2. 不要动 `Terminal.tsx` 里 `isConnected` 这个 prop 名字 —— 它本来就是 camelCase，命名跟 props 一致。
3. Rust 端不动 —— `SessionInfo`、`LocalSessionConfig`、`SSHSessionConfig` 仍用 `rename_all = "camelCase"`，这是和 Tauri IPC 默认约定一致的方向；改前端让前端对齐。
4. 验证：
   - `npx tsc --noEmit`：TSC OK（0 errors）
   - `npx vitest run src/contexts/session/paneUtils.test.ts`：47 passed, 1 todo
   - `cargo test --lib`：68 passed（Bug 012 的 forwarder 修复依然在位）
5. 手动验证：在 dev 环境打开新 shell，横幅应消失；按 Enter 走 reconnect 也应不再出现 `create+close+EOF` 死循环（除非用户真的关掉 shell）。
## 是否解决
YES

# Bug 014
## 现象
读 `services/session_manager.rs::create_tmux` 的代码会发现：新建的 tmux pane 始终带 `is_hidden = false`，即使 req-006 §D3 明确说 "bootstrap pane 应被埋掉（`is_hidden = true`）"。读者容易把它当成 bug 改掉。
## 理想效果
代码注释 / spec 文档应一致说明：`tmux -CC new` 路径下没有"无用"的 bootstrap pane 要藏（第一个 pane 就是用户 shell），`is_hidden = true` 只在 `tmux -CC attach` 路径下生效。
## BUG原因
设计决策，不是 bug。MVP (`tmux -CC new`) 的第一个 pane IS 用户的工作 shell，所以 `is_hidden = false`。`is_hidden = true` 的语义只对 attach (Wave 5) 有意义：attach 时 tmux 占用原 pty，那个 pane 才是真正的 bootstrap pane，要埋掉。该决策在 req-006 §D3 写明，代码注释也提了（`session_manager.rs:281-285`），但注释里混了 "Wave 1 MVP" / "Wave 5 attach" 的版本演进说明，读者容易断章取义。
## 解决方案
1. 不改 `is_hidden = false` 默认值 —— 当前行为符合 req-006。
2. 重写 `session_manager.rs:281-285` 的注释，去掉版本演进措辞，明确两个路径的语义区别。
3. 在 `models/session.rs::tmux_pane_info` 的 doc comment 也同步措辞（`is_hidden` 是 caller-driven flag，新 session 路径默认 false，attach 路径传 true）。
4. 此条作为 **设计决策记录** 保留，不算 bug —— 但明确写出来防止未来重复被 "修" 一次。
## 是否解决
YES（设计上无 bug，仅文档同步）

# Bug 015
## 现象
在 tmux pane 里手动跑 `tmux split-window -h`，或者在 tmux 内手动 `:new-window`，xsterm UI 不显示新 pane / window。tmux 控制台显示事件到达了后端（log 里能找到 `external %window-pane-changed ... not auto-binding`），但前端 pane tree 没变化。
## 理想效果
读者期望："xsterm 作为 tmux 控制客户端，应当实时反映 tmux server 的全部变化"。
## BUG原因
**不是 bug，是有意为之的范围限制。** Wave 6 决策：不在 backend 自动绑定外部 pane / window。理由：
- 前端 pane tree 不知道这些 pane 的存在；backend 自动绑定后再 emit `tmux-pane-added`，前端没有对应的 parent / slot 放它们，会 desync React state
- 真正合理的做法是 backend 只 log，等用户通过 in-app 的 "New Tmux Window" / 右键 split 等入口显式触发（这些入口 backend 有完整的状态信息）
- Wave 6 spec 没承诺 "100% 镜像 tmux server 状态"，只承诺 "xsterm 用户显式创建的资源保持同步"

代码侧三个证据：
1. `controller.rs:1606` log: `"external %window-pane-changed for pane {} in window {} — not auto-binding"`
2. `controller.rs:1690` log: `"external %window-add for window {} — not auto-binding"`
3. `controller.rs:1603-1606` + `1634-1636` 注释明确："Out of scope to auto-bind ... a future iteration may add a re-bind UI."
## 解决方案
1. 短期：用户用 in-app 命令（`New Tmux Window`、`Split Right` 等右键菜单项）显式创建 —— backend 完整跟踪。
2. 中期：如果用户报告 "我手动创建的 window 看不到"，可以加一个 "Refresh from tmux server" 按钮触发 backend 重新 `list-windows` + 重新同步。
3. 长期：实现 re-bind UI（Wave 6 spec 文档列为 out-of-scope）。需要先决定：
   - external pane 应插到哪个 parent split？
   - 新 window 应放到哪个 workspace？
   - 状态不一致时的合并策略？
## 是否解决
YES（设计上限，不是 bug）

# Bug 016
## 现象
读 Wave 0 时代写的示例代码 / 早期测试时会发现 `TmuxController` 上有 `events()` receiver / `take_events()` 之类的方法，Wave 1 之后这些方法消失了。
## 理想效果
理解为什么 Wave 0 → Wave 1 时 `TmuxController` 的公开 API 收缩了。
## BUG原因
**架构调整，不是 bug。** Wave 0 的 skeleton 让 `TmuxController` 自己持有一个 `mpsc::Receiver<ControlEvent>` 暴露给外部 —— 早期假设是 SessionManager 拿走 receiver 自己 dispatch。但实际编写 Wave 1 时发现：
- SessionManager 不应该知道 `ControlEvent` 的内部 enum 形状（耦合 + 难测）
- Dispatch 逻辑（Promise 路由、window-pane 桥接、外部事件处理）天然属于 controller
- 需要一个 `AppBackend` trait 来解耦 "emit Tauri 事件" 和 controller 本体（也让 mockall 测试不依赖 Tauri）

Wave 1 改成：
- `TmuxController` 内部消费 `ControlEvent`（reader task 直接发到 dispatch task）
- dispatch task 通过 `Arc<dyn AppBackend>` emit Tauri 事件
- 公开 API 只剩 `send_keys` / `resize_pane` / `split_pane` / `new_window` 等命令入口 + `close` / `await_first_pane` 生命周期方法

代码侧证据：
- `controller.rs:159-172` 头注释："Wave 1 changed the public surface: there is no longer an `events()` receiver to take — the controller consumes its own events and forwards them to the injected [`AppBackend`]."
- `infrastructure/app_backend.rs` 定义 `AppBackend` trait
- `services/session_manager.rs::create_tmux` 注入 `Arc<dyn AppBackend>` 而不是消费 receiver
## 解决方案
1. 不改代码 —— Wave 1 之后所有调用方都通过命令入口 + 事件监听工作。
2. 保留 `controller.rs:159-172` 的注释作为历史决策记录。
3. 本条作为 **架构演进记录** 保留，避免未来有人误以为 `events()` 是 "丢失的方法" 重新加回来（会破坏 dispatch 集中化 + AppBackend 解耦）。
## 是否解决
YES（架构变更已完成，文档同步）

# Bug 011
## 现象
创建 tmux -CC session 时，前端偶发 5 秒后弹错误：`tmux controller N: timed out waiting for first pane`。重启 xsterm 偶尔能成功，但大部分时间失败。
## 理想效果
首次创建 tmux -CC session 立即返回 SessionInfo，无超时。
## BUG 原因
`infrastructure/tmux/controller.rs::await_first_pane` 存在 `tokio::sync::Notify` 经典 race：
1. `await_first_pane` 先检查 `first_pane_result`（fast path），若 None 则 fallthrough；
2. （窗口期）dispatch task 已完成 `record_first_pane`：把 `first_pane_result` 置 `Some` 并调用 `notify_waiters()`；
3. `Notify::notify_waiters()` 只通知**当前已注册**的 waiter —— 此时没有 waiter；
4. `await_first_pane` 才创建 `notified()` future，notification 已丢失；
5. 5 秒后 timeout 触发，报错。

窗口期在纳秒级，单元测试难复现，但生产负载下频繁发生 —— tmux child 启动 + bootstrap `WindowPaneChanged` 事件抵达 + 调用 `record_first_pane` 的整条链路都在 await 之前能跑完。
## 解决方案
在 `await_first_pane` 中**先**创建 `notified()` future（注册 waiter），**再**做 fast-path 检查 result：

```rust
let notified = self.first_pane_notify.notified(); // 先注册
if let Some(result) = self.first_pane_result.lock()...cloned() {
    return Ok(result); // 已存：直接返回
}
tokio::time::timeout(AWAIT_FIRST_PANE_TIMEOUT, notified).await // 等待
```

两种时序都正确：record_first_pane 在 await 之前 → fast path 命中；record_first_pane 在 await 之中 → waiter 已注册 → `notify_waiters()` 唤醒。

加回归测试 `await_first_pane_resolves_when_record_first_pane_runs_before_caller`（dispatcher 抢赢场景，无 sleep）锁住正确顺序，防止未来"简化"回 bug 顺序。

## 是否解决
YES（修复 + 回归测试 + 244/244 单测通过）

# Bug 012
## 现象
创建 SSH tmux session（或任何 SSH session 失败时）报错 "SSH exec connection thread panicked before handshake" / "SSH connection thread panicked before handshake"，但实际上 SSH 失败原因是 DNS / TCP / auth / exec 等常见错误。错误消息误导为 panic，丢失真实原因。
## 理想效果
SSH 失败时显示具体原因（"SSH authentication failed for user@host" / "DNS resolution failed" / "SSH exec request failed: ..."）。
## BUG 原因
`infrastructure/ssh.rs::connect_ssh` 和 `connect_ssh_exec` 的 spawn 线程闭包里：

```rust
rt.block_on(async move {
    let result = run_ssh_session(...).await;
    let _ = result;   // ← Err 被静默丢弃！
});
```

`run_ssh_session` / `run_ssh_exec_session` 返回 `Result<(), String>`，函数体中所有错误通过 `?` 早返回。但 spawn 闭包的 `let _ = result` 不发送 `Err` 到 `result_tx`，所以：
- handshake 失败 → 函数返回 Err → spawn 闭包退出（不 panic）→ `result_tx` 被 drop → 父线程 `result_rx.recv()` 返回 `RecvError`（channel disconnected）→ 被解读为 "panicked before handshake"

实际从未 panic，错误消息完全是误导。
## 解决方案
1. spawn 闭包转发结果到 `result_tx`：
   ```rust
   let _ = result_tx.send(result);
   ```
2. 父线程 `RecvError` 消息改写为 "SSH ... thread died before handshake (panic or runtime build failure)"——区分真 panic vs 早返回 Err。
3. 当 `run_ssh_session` / `run_ssh_exec_session` 早返回 Err 时，错误消息会经过 `?` 正确链上来，父线程的最终错误就是真实原因（如 "SSH authentication failed for user@host: ..."）。
## 是否解决
YES（修复 + 244/244 单测通过）

# Bug 013
## 现象
创建 SSH tmux session（或任意 SSH exec 路径）时，SSH 通道成功建立后立即 `PANIC: panicked at src\infrastructure\ssh.rs:833:41: called Option::unwrap() on a None value`，前端报 "tmux reader: stdout EOF" + "tmux controller N: dispatch channel closed"。
## 理想效果
SSH exec channel 路径正常工作，不 panic。
## BUG 原因
`infrastructure/ssh.rs::run_data_loop` 的 `tokio::select!` 里：

```rust
resize = resize_rx.as_mut().unwrap().recv(), if resize_rx.is_some() => {
```

**tokio::select! 会急切求值未来表达式（忽视 guard）**。`resize_rx.as_mut().unwrap()` 在 select! 进入时立刻被求值。对 exec 路径（`resize_rx: None`），unwrap 在第一轮迭代就 panic。

`if resize_rx.is_some()` guard 只控制 branch 的 polling 启用/禁用，**不防止未来表达式求值**。这是 Tokio select! 的常见误解——以为 guard 像 match guard 那样同时控制求值。

Bug 一直在 SSH exec 路径上（Wave 5 引入），只是 `run_data_loop` 没有单元测试覆盖，cargo test 全绿掩盖了 panic。
## 解决方案
1. 用 `async {}` block 包裹 resize 未来，延迟 `as_mut().unwrap()` 求值到 poll-time：

   ```rust
   let resize_recv = async {
       match resize_rx.as_mut() {
           Some(rx) => rx.recv().await,
           None => std::future::pending().await,  // 永不 resolve
       }
   };
   ```

2. 去掉 `if resize_rx.is_some()` guard（guard 与 async block 的 mutable borrow 冲突，且 `pending()` 已经确保 None 时 arm 永远不 fire）。arm 现在总启用；对 `Some(rx)` 正常 resolve，对 `None` 永远 pending。

3. handler 里的 `resize_rx = None` 在 future resolve 后执行——此时 borrow 已释放，无冲突。

4. 加回归测试 `resize_future_construction_does_not_panic_when_resize_rx_is_none` 锁住修复。

## 是否解决
YES（修复 + 2 个回归测试 + 246/246 单测通过）

# Bug 014（Notify race — 重开）
## 现象
Bug 011 的"重排修复"上线后，生产 SSH `tmux -CC` 会话创建仍然每 5s 超时；任何 dispatch 任务与 `create_tmux` 的 await 抢跑的路径都会卡到 `AWAIT_FIRST_PANE_TIMEOUT`。
## 理想效果
`await_first_pane` 在任何 race 顺序下都能可靠 resolve，无论是 dispatcher 先到还是 caller 先到。
## BUG 原因
Bug 011 的 fix 把 `notified()` future 的创建移到 fast-path result check 之前，但这只关掉了 T1→T2 的窗口，**没有关掉 T2→T3 的窗口**：

```rust
let notified = self.first_pane_notify.notified();   // (T1) future created
if let Some(result) = self.first_pane_result.lock()...cloned() {  // (T2) fast path
    return Ok(result);
}
match tokio::time::timeout(AWAIT_FIRST_PANE_TIMEOUT, notified).await { ... }
// (T3) future polled for the first time — waiter registered NOW
```

`tokio::sync::Notify::notify_waiters()` **只唤醒已经注册过的 waiter**。`notified()` future 在被 poll 之前并不注册为 waiter。Race：
1. Caller 完成 T2（result 还是 None）。
2. Dispatcher 抢进 `record_first_pane`：写入 `first_pane_result = Some(...)`，调 `notify_waiters()` — 但当前没有 waiter，信号丢失。
3. Caller 进入 T3，第一次 poll `notified()` — 此时才注册 waiter，但 notify 已经 fire 完了。
4. 永远等，直到 5s timeout 触发。
## 解决方案
把 `tokio::sync::Notify + Mutex<Option<(u32, String)>>` 换成 buffered 的 `tokio::sync::oneshot`：

- 字段 `first_pane_tx: std::sync::Mutex<Option<oneshot::Sender<(u32, String)>>>` — dispatch 持有 sender；`record_first_pane` 用 `.lock().take()` 拿出 sender 并 `.send((xsterm_id, pane_id))`。oneshot 的 sender **buffer 住值**，等 receiver 来拿。
- 字段 `first_pane_rx: tokio::sync::Mutex<Option<oneshot::Receiver<(u32, String)>>>` — `await_first_pane` 用 `.lock().await.take()` 拿出 receiver，再 `tokio::time::timeout(...).await`。

oneshot buffer 关掉了 T2→T3 整个 race：dispatcher 在 caller poll 之前 send，值会被 buffer 住，receiver 一旦 await 立即拿到。`await_first_pane` 不再需要 fast-path result check——receiver.await 本身已经统一处理"已 send"和"未 send"两种情况。

改动集中在 `src-tauri/src/infrastructure/tmux/controller.rs`：

1. **字段定义**（`first_pane_notify: Notify` + `first_pane_result: Mutex<Option<...>>` → `first_pane_tx` + `first_pane_rx` oneshot 两半）。
2. **生产 spawn initializer**（`Notify::new()` + `Mutex::new(None)` → `oneshot::channel()`）。
3. **`await_first_pane` 整段重写**（Notify + Mutex fast-path → oneshot receiver.await with timeout）。
4. **`record_first_pane` 整段重写**（Mutex set + notify_waiters → Mutex take + sender.send）。
5. **Dispatch case 4 fallback check** 反转语义：`first_pane_result.lock().map(|m| m.is_none())` → `first_pane_tx.lock().map(|m| m.is_some())`（"sender 还在 = 还没 record"）。
6. **24 个测试 struct literal**（包括 `new_for_tests` + 23 个 `Arc::new(TmuxController { ... })` 直构体）改用 `let (first_pane_tx, first_pane_rx) = oneshot::channel();` 在 struct literal 之前预声明。
7. `register_pane_idempotent_and_lookup_round_trip` 的 assertion 改成：sender 是 `None`（first call won）+ `blocking_lock` + `try_recv` 验证 buffered 值匹配 first call 的 args（证明 second call 是 no-op）。

T2→T3 race 完全消除：oneshot::Sender 在 `tx.send(...)` 时把值存进 channel buffer，无论 receiver 是否已经被 poll，buffer 都保留值直到 receiver 取走。

## 是否解决
YES（246/246 单测通过，cargo check 0 warning，cargo test 0 failed；`await_first_pane_resolves_when_record_first_pane_runs_before_caller`（Bug 011 回归测试）仍 pass，`await_first_pane_resolves_after_record_first_pane` 也 pass）

# Bug 014
## 现象
rebuild xsterm 后创建 SSH tmux session（或任何 backend 路径），持续 5 秒后报 "tmux controller N: timed out waiting for first pane"。Bug 011 修复未生效。
## 理想效果
首次 await_first_pane 在 dispatch task 完成 record_first_pane 后立即返回，无超时。
## BUG 原因
Bug 011 的修复未真正关闭 race。`tokio::sync::Notify` **非 buffered**：

```rust
pub async fn await_first_pane(&self) -> Result<(u32, String), String> {
    let notified = self.first_pane_notify.notified();  // T1: future 创建，未注册 waiter
    if let Some(result) = self.first_pane_result.lock()...cloned() {  // T2: fast-path 检查
        return Ok(result);
    }
    match tokio::time::timeout(AWAIT_FIRST_PANE_TIMEOUT, notified).await { ... }  // T3: 首次 poll，注册 waiter
}
```

Race 窗口（record_first_pane 在 T2 和 T3 之间跑）：
1. T2 看到 result=None，await_first_pane 进入 timeout
2. record_first_pane：set first_pane_result=Some + `notify_waiters()` —— **此时没有已注册 waiter**（T3 还没发生），通知丢失
3. T3：future 首次 poll，注册 waiter —— 但通知已丢
4. 永远等 5 秒，timeout

Bug 011 的"fast-path 检查"只覆盖"record 在 T2 之前跑完"的场景。T2-T3 之间的窗口期是真实存在但被忽略的 race。
## 解决方案
替换为 `oneshot::channel`（**天然 buffered**）：

```rust
// struct 字段替换 first_pane_notify + first_pane_result 为：
first_pane_rx: tokio::sync::Mutex<Option<oneshot::Receiver<Result<(u32, String), String>>>>,
first_pane_tx: std::sync::Mutex<Option<oneshot::Sender<Result<(u32, String), String>>>>,

// await_first_pane: 直接 await receiver，无 fast-path（不需要）
let rx = self.first_pane_rx.lock().await.take()
    .ok_or_else(...)?;
match tokio::time::timeout(AWAIT_FIRST_PANE_TIMEOUT, rx).await {
    Ok(Ok(result)) => Ok(result),
    ...
}

// record_first_pane: take + send
if let Some(tx) = self.first_pane_tx.lock()...take() {
    let _ = tx.send(Ok((xsterm_id, pane_id)));
}
```

`oneshot::Sender::send()` 在 receiver 未 await 时**也缓冲**值（无 notifier 失去通知的窗口）。整个 T2-T3 窗口期不再有 race。

dispatch case 4 fallback 中 `first_pane_result.lock().is_none()` 改为 `first_pane_tx.lock().is_some()`（语义反转：sender 还在 = 还没 record）。

## 是否解决
YES（修复 + 246/246 单测通过；Bug 011 的回归测试也通过 —— 之前只是 Bug 011 没真正修，现在 oneshot 一次性关掉 race）

# Bug 015
## 现象
`SelectSessionDialog`（`dialog dialog--medium`）的 "Existing unused sessions" 段会出现一些 session，但 `session-history` 侧边栏里看不到这些 session 的对应配置 —— 用户视角下"凭空多出来一批孤立 session"。
## 理想效果
`session-history` 必须显示全部 `savedConfigs`（含未分组的归入 Default group）；任何运行中的 `Session` 必须挂在某个 pane 上，不允许出现"在 `sessions[]` state 里、但不在任何 pane 树引用"的孤儿；create / edit session 时 group 下拉不允许 "None" 选项，新建 session 必有归属组。
## BUG原因
三部分叠加：

1. **session-history 只渲染分组的 savedConfigs**：`src/components/sidebar/SessionManager.tsx` 的 `groups.map(...)` 内部用 `savedConfigs.filter((c) => group.configIds.includes(c.id))`，任何没进用户组的 config 在侧栏完全不可见。
2. **孤儿 running session 不被清理**：`src/contexts/session/useTauriListeners.ts` 的 `session-closed` 和 `tmux-pane-removed` 监听器在收到后端关闭事件后，先做 `if (!stillExists) return`，再做 `if (!stillAttached) return` 然后才从 `sessions[]` 移除。当 session 在 frontend state 但已不在任何 pane 树（即 orphan）时，提前 return 让它永远留在 `sessions[]` 里，`isConnected` 仍可能是 true，于是 SelectSessionDialog 的 `availableSessions = sessions.filter((s) => !usedSessionIds.has(s.id))` 把它列出来。
3. **create / edit session 的 group 下拉提供 "None" 选项**：默认组策略下还允许 `selectedGroupId = null`，与"默认组为所有未显式分组 config 的归属"矛盾 —— 用户可以创建一个既不在任何用户组、也不在默认组的 config（持久化时存为 null），编辑老数据时也只能表达"无分组"，没有"归入 Default"的入口。
## 解决方案
1. `src/contexts/session/useTauriListeners.ts`：删除 `session-closed` 和 `tmux-pane-removed` 两个监听器里的 `if (!stillAttached) return;` 早返回。后端的关闭事件是权威信号 —— 不论该 session 是否还挂在 pane 树，都必须从 `sessions[]` 移除。`removeSessionAndCollapse` 在 leaf 没匹配时是 no-op，安全。同时删除不再使用的 `isSessionInPaneTree` import。
2. 新建 `src/contexts/session/constants.ts` 定义 `DEFAULT_GROUP_ID = 0`、`DEFAULT_GROUP_NAME = "Default"`，以及 `isDefaultGroup(group)` 谓词函数。
3. `src/contexts/session/useSessionPersistence.ts`：从磁盘加载 groups 后，若没有 `id === DEFAULT_GROUP_ID` 的组则在最前面插入一个 `id: 0, name: "Default", configIds: [], collapsed: false` 的默认组。`nextGroupId` 不动（始终 ≥ 1，用户组 id 不会撞车）。
4. `src/contexts/session/useGroupActions.ts`：`deleteGroup(id)` 在 `id === DEFAULT_GROUP_ID` 时直接 return，禁止删除默认组。`createGroup` 的 `nextGroupId` 起点为 1，天然不和 0 冲突。
5. `src/components/sidebar/SessionManager.tsx`：
   - `ungroupedConfigs = savedConfigs.filter(c => !userGroups.some(g => g.configIds.includes(c.id)))`（计算默认组的成员：不在任何用户组里的 config）。
   - `groups.map(group)` 改用块体：当 `group.id === DEFAULT_GROUP_ID` 时 `items = ungroupedConfigs`（持久化的 `group.configIds` 被忽略），其它组沿用 `savedConfigs.filter(c => group.configIds.includes(c.id))`。
   - 默认组的 ContextMenu 不渲染 `Delete` 项（保留 `Create Session`、`Edit`），其它组保留三项。
   - 默认组支持拖入：现有 `useSessionDragDrop` 把 groupId=0 透传到 `moveConfigToGroup(configId, 0)`，后者先把 configId 从所有组剔除，再 append 到 group 0 的持久化 `configIds`；因为渲染忽略 group 0 的持久化 configIds，效果等价于"从所有用户组移出"。
6. 删 create / edit dialog 的 "None" 选项：
   - `src/components/dialogs/SessionTab.tsx`：删除 `GROUP_OPTIONS_NONE` 常量与 `""` 解析；`selectedGroupId` / `onGroupChange` 类型收紧为 `number`。
   - `src/components/dialogs/CreateSessionDialog.tsx`：`selectedGroupId` 默认 `DEFAULT_GROUP_ID`，`initialGroupId` 类型改为 `number`；`handleCreate` / `handleSaveOnly` 去掉 `selectedGroupId !== null` 分支，直接 `addToGroup(selectedGroupId, configId)`。
   - `src/components/dialogs/EditSessionDialog.tsx`：内联 group `<select>` 删 `<option value="none">None</option>`；`selectedGroupId` 默认 `groupId ?? DEFAULT_GROUP_ID`，类型收紧为 `number`。
   - `src/components/AppLayout.tsx`：`createSessionGroupId` 状态默认 `DEFAULT_GROUP_ID`，`onCreateSession` 把 `setCreateSessionGroupId(null)` 改为 `setCreateSessionGroupId(DEFAULT_GROUP_ID)`，与新的 `initialGroupId: number` 类型对齐。
## 是否解决
YES

# Bug 016
## 现象
编辑一个 `tmux-cc` 类型的 session 时，侧栏显示 Shell / SSH 等与 tmux 无关的 section，"session" 面板错误地回退到 Local 配置（shell template / initial directory 等），可改但写回的是无关字段；Terminal 面板 `connectionType` 强制为 `"local"`，导致 Term / charset / initialRows/Cols 等都改不到 tmux 配置。
## 理想效果
编辑 tmux-cc session 时用专属侧栏（无 Shell / SSH）；`session` 面板只展示 Name / Group + 一句"tmux setup 不可改"的说明；Terminal 等 display settings 面板透传 `connectionType="tmux-cc"`；保存时 `config` 字段保留原 `TmuxCcConfig`，不被 `localConfig` / `sshConfig` 覆盖。
## BUG原因
`src/components/dialogs/EditSessionDialog.tsx` 三个地方把 tmux-cc 当成 local/ssh 的特例：
1. `sidebarItems` 写死 `config.type === "ssh" ? SSH : SHELL`，tmux-cc 走到 else → 拿到 SHELL_SIDEBAR_ITEMS（含 Shell 入口）。
2. `"session"` 面板固定渲染 `<SessionTab connectionType={config.type === "ssh" ? "ssh" : "local"}>`，tmux-cc 走到 "local" 分支，显示 shell template 等。
3. `"terminal"` 面板 `connectionType={config.type === "ssh" ? "ssh" : "local"}` —— 同样回退；保存路径里 `if (config.type === "local") ... else ...` 把 tmux-cc 的 `config` 字段替换成 sshConfig（错位类型）。

同时 tmux 的 setup-time 字段（`baseConfigId` / `tmuxSessionName` / `socketName` / `startCommand`）即使渲染出来也无法生效 —— 这些字段决定的是 `tmux -CC new-session` 时的命令行参数，已运行的 tmux 进程不接受改动。
## 解决方案
1. `EditSessionDialog.tsx`：
   - `sidebarItems` 改为三分支：`tmux-cc` → `TMUX_SIDEBAR_ITEMS`（已在 `sessionDialogItems.tsx` 定义，无 Shell / SSH），`ssh` → `SSH_SIDEBAR_ITEMS`，其余 → `SHELL_SIDEBAR_ITEMS`。
   - `"session"` 面板：抽出 inline name+group 字段到局部变量 `inlineFields`；tmux-cc 分支只渲染 `{inlineFields}` + `<p className="edit-session-note">` 一句说明；其他分支保持 `{inlineFields}` + `<SessionTab>`。
   - `"terminal"` 面板：`connectionType={config.type}` 直接透传，让 `TerminalTab` 自带的 tmux-cc 分支生效（其内部对 TERM/charset 走 localConfig 仍不写回，但 lineNumberEnabled / sizingMode / scrollback / cols / rows 这些 `displayConfig` 字段能正常持久化）。
   - `handleSave`：`if (config.type === "local") ... else if (config.type === "ssh") ... else` —— tmux-cc 走 else 分支，`updatedConfig = { ...config, name: trimmedName, displayConfig }`，原 `config` 字段（`TmuxCcConfig`）保持不变。
2. `EditSessionDialog.css`：新增 `.edit-session-note` —— muted色 + canvas-soft 底 + hairline 边 + radius-md，符合 §5 卡片规范；`font-weight: 500` 在设计系统允许范围（§4）。
## 是否解决
YES

# Bug 016 v2
## 现象
Bug 016 修复后（`pending_bootstrap` + `bootstrap_rx` 字段 + `await_first_pane` 优先等 list-panes 响应），日志显示：
```
INFO tmux controller 1: enqueued `new-window` + `list-panes`; ...
INFO tmux controller 1: bootstrap %end id=401 (0 body lines)   ← body 是空！
```
`pending_bootstrap` 在 list-panes 响应**到达前**没设上 → dispatcher 收到 `%begin %end` 时 take 返回 None → body 走"no pending capture, body line dropped"分支 → 0 body lines → `await_first_pane` 3s timeout 后 fall back 到 `first_pane_tx` 路径（也 timeout）→ 5s 后 `create_tmux_session failed: timed out waiting for first pane`。
## 理想效果
list-panes 响应正确填入 `pending_bootstrap.body`，`await_first_pane` 解析第一行拿 `pane_id` 立即返回。
## BUG原因
race condition：writer task 和 dispatcher task 在不同 tokio task 并发运行。`spawn_with_backend` 末尾代码顺序是：
1. 发 `new-window` 到 `stdin_tx`
2. 创建 oneshot channel
3. lock `pending_bootstrap`，set `Some(bootstrap_tx)`
4. 发 `list-panes` 到 `stdin_tx`
5. stash `bootstrap_rx`

步骤 1 之后 server 立即处理 `new-window`（可能发 `%window-add`），步骤 4 之后 server 立即处理 `list-panes`（发 `%begin %end`）。步骤 3 和 4 **间隔极短**，但 dispatcher 可能在步骤 3 完成**前**已经 take `pending_bootstrap`（拿到 None，因为还是 None）→ body drop。

## 解决方案
代码已经修好（先 set sender 再 send list-panes）。**关键**：
1. line 501-507：先 lock `pending_bootstrap` 设 `Some(bootstrap_tx)`（**在发 list-panes 命令前**）
2. line 509-512：再发 list-panes

dispatcher 在 steps 1-3 之间跑，take 不到 sender（pending_bootstrap 还是 None），body 走 drop 分支（无害）。step 3 完成后，dispatcher 在 steps 4 之后的 `%end` 时能正确 take 到 sender。

## 是否解决
YES

# Bug 017
## 现象
`CreateSessionDialog.tsx` 和 `EditSessionDialog.tsx` 各自重复声明了同一组 form state（`name` / `selectedGroupId` / `localConfig` / `sshConfig` / `displayConfig` / `sectionId` / `error`）、各自的 `useEffect` 初始化逻辑、相同的 6 个 panel 渲染分支（`shell` / `ssh` / `appearance` / `terminal` / `input` / `logging`）、相同的错误包壳 `if (error && sectionId === "session") ...`。任何 panel 的 prop 调整或新增第六个 panel，都必须同时改两份，否则两边漂移。
## 理想效果
两份 dialog 共享一份 form state + 6 个 panel 的渲染入口；后续修改一处即同时作用于两个 dialog。
## BUG原因
两份 dialog 都是从早期的 "edit dialog forked from create dialog" 演化而来——共享结构未被提取，每个 panel 直接 `<ShellSettingsPanel ... />` 等写在两份 dialog 的 `renderSection` switch 里，加上各自的 7 个 `useState` 和重置 `useEffect`。
## 解决方案
1. 新建 `src/components/dialogs/useSessionForm.ts`：把 7 个 `useState`（name / selectedGroupId / localConfig / sshConfig / displayConfig / sectionId / error）和重置 `useEffect` 抽到一个 hook。`useEffect` 仅依赖 `[isOpen, initialConfigId]`，初始值用 `useRef` 抓最新（避开父组件每次渲染都传新 object literal 导致 in-flight 输入被擦掉的问题）。Edit 用 `initialConfigId: config.id` 以便用户切到不同 config 时表单同步重置；Create 不传 `initialConfigId`，仅依赖 `isOpen`。
2. 新建 `src/components/dialogs/SessionFormPanels.tsx`：把 6 个 panel 的 switch 分支 + 错误包壳抽到一个组件，接收 `form`、`connectionType`、`renderSessionSection` props。`session` 槽留给 dialog 自己填（Create 用 `SessionTab` / `TmuxForm`，Edit 用 inline name+group + `SessionTab` 或 tmux-cc 说明）。
3. `CreateSessionDialog.tsx`：去掉 7 个 `useState` 改用 `useSessionForm`，去掉 6 个 panel import 和它们的 switch 分支；保留 `topTab` / `tmuxConfig` / `saveConfig` 这些 Create 独有 state、top tabs、`handleCreate` / `handleSaveOnly`、footer（Save Config 复选框 + Cancel + Save Only + Create）。`renderSessionSection` 根据 `topTab` 渲染 `SessionTab` 或 `TmuxForm`。
4. `EditSessionDialog.tsx`：同样去掉 7 个 `useState` 改用 `useSessionForm`（带 `initialConfigId: config.id`），去掉 6 个 panel import 和 switch 分支；保留 inline name+group 局部变量 `inlineFields`、`handleSave`、footer（Cancel + Save）。`renderSessionSection` 对 tmux-cc 渲染 `{inlineFields} + <p className="edit-session-note">`，其他渲染 `{inlineFields} + <SessionTab hideNameAndGroup>`。
## 是否解决
YES

# Bug 007
## 现象
在 Windows 上第一次创建 tmux 会话时，对话框弹出 "program not found" 错误，看不出是哪个程序找不到，也没指引去哪里安装。
## 理想效果
错误信息明确告诉用户 tmux 找不到，并列出 Windows 常见安装路径（WSL / MSYS2 / git-bash）。
## BUG原因
`tokio::process::Command::new("tmux").spawn()` 在 Windows 上找不到 `tmux.exe` 时返回 `std::io::Error { kind: NotFound, .. }`，其 `Display` 是 `program not found`。`StringError::map_err_string()` 透传 `to_string()`，错误一路传到 `CreateSessionDialog` 显示。
## 解决方案
1. `src-tauri/src/services/tmux/controller.rs` 新增 `tmux_spawn_err` helper：检测 `io::ErrorKind::NotFound` → 返回包含 Windows 安装路径的友好消息，其他错误透传 `to_string()`。
2. `spawn_local` / `spawn_attach` / `spawn_with_args` 三处的 `cmd.spawn().map_err_string()` 改用 `cmd.spawn().map_err(|e| tmux_spawn_err(e, &argv_refs))?`。
3. 错误信息携带被尝试的 argv（如 `tmux -CC -L default new-session -d -x 80 -y 24`），便于用户排查。
## 是否解决
YES

# Bug 008
## 现象
创建 SSH 上的 tmux 会话 (`baseConfigId` 指向 SSH config)，tmux 子进程在远端立刻秒退，stderr 输出 `tcgetattr failed: Inappropriate ioctl for device`，前端会话提示"EOF" / session 创建失败。控制台日志最后一行是 `tmux reader: stdout EOF`。
## 理想效果
SSH 上的 tmux 会话正常创建，远端 `tmux -CC` 启动后保持运行，能正确回送 `%output` / `%window-pane-changed` 等 control-mode 通知。
## BUG原因
`tmux -CC`（control mode）**要求 stdin/stdout 是真实的 TTY** —— 它启动时立即 `tcgetattr(0, ...)` 来查询 terminal attributes，如果 stdin 不是 TTY，tmux 报错并退出。
SSH `exec` channel 默认**不分配 PTY**（与 `shell` channel 不同 —— shell path 走 `request_pty` + `request_shell`，会分配伪终端）。`SshTmuxBackend` 走的 `connect_ssh_exec` 路径只发了 `channel.exec(true, command)`，没发 `pty-req` channel request。
## 解决方案
1. `src-tauri/src/infrastructure/ssh.rs::run_ssh_exec_session` 在 `channel.exec(...)` 之前先 `channel.request_pty(true, term_type, cols, rows, 0, 0, &[])`，参考 shell path 已有逻辑。
2. pty 大小 / term_type 读自 `SSHSessionConfig.term_type / initial_rows / initial_cols`，未填则用 `default_pty_size()` + `DEFAULT_TERMINAL_TYPE`（`xterm-256color`）。
3. SSH `exec` + `pty-req` 是 OpenSSH 支持的标准模式，russh 接受；server 端按 exec semantics 执行命令，但 stdin/stdout 走分配的 pty。
## 是否解决
YES

# Bug 009
## 现象
Bug 008 修复后 SSH 上的 tmux 子进程不再秒退，但 control-mode 通知全部丢失 —— 日志里 `tmux controller N: ignoring event Unknown { line: "ESC P 1000p%begin ..." }` 出现多次，前端会话永远拿不到第一个 pane。日志最后是 `tmux reader: stdout EOF` / `dispatch channel closed, exiting`。
## 理想效果
SSH 上的 tmux 会话正常建立，能收到 `%begin` / `%output` / `%end` / `%window-pane-changed` 等 control-mode 通知，第一个 pane 注册成功。
## BUG原因
`tmux -CC` 把整个 control-mode wire protocol 包在 **DCS（Device Control String）passthrough 序列**里：
```
ESC P 1000 p %begin 1788701964 296 0 \n
%output %5 hello\n
%end 1788701964 296 0 \n
ESC \
```
**DCS start `ESC P 1000 p`（7 字节）和第一行通知之间没有 `\n`**，reader 的 `BufReader::lines()` 按 `\n` 切行得到 `"ESC P 1000p%begin 1788701964 296 0"` 整行 —— parser 看到不以 `%` 开头，丢 `Unknown`，整个 `%begin` 失效；后续 `%end` 也成 `Unknown`；command block 永远不开，dispatch 没有事件 emit。
## 解决方案
1. `src-tauri/src/services/tmux/controller.rs::spawn_reader_task` 在 `parser.feed` 之前做 DCS passthrough stripping：
   - `line.strip_prefix("\x1bP1000p")` 去掉 DCS start 前缀
   - `.trim_end_matches("\x1b\\")` 去掉 DCS end 后缀
2. 加单测 `reader_task_strips_dcs_passthrough_start_marker` + `reader_task_strips_dcs_passthrough_end_marker`（`src-tauri/src/services/tmux/controller.rs::tests`）锁定修复。
3. 与 wezterm 的实现对比：wezterm 也是按 `\n` 切行 + 手动识别 DCS 包裹 —— 我们用更小的"只 strip 起止 9 字节"方案，避免完整 DCS state machine 的复杂度。
## 是否解决
YES

# Bug 010
## 现象
Bug 009 修复后 SSH 上的 tmux 子进程能发出 DCS-wrapped 通知、parser 正确识别 `%begin 308` / `%end 308` / `SessionsChanged`，但会话仍然 EOF 立即退出，且日志里看不到 tmux 自己的 stderr 输出（日志只有 `SSH exec channel established` → 几个通知 → `channel_eof`，中间没有任何 `tcgetattr failed` 之类的诊断信息），用户无法判断 tmux 为什么秒退。
## 理想效果
SSH 上的 tmux 子进程 EOF 后，`tmux-controller-exit` 事件 reason 字段携带真实 exit code（如 `exit code: 1`），用户能区分"正常退出（0）"vs"启动失败（非 0）"vs"网络中断（未知）"。同时 tmux 自己的 stderr 输出在 rolling log 里可见（不必进入 xterm）。
## BUG原因
1. **ExitStatus 被丢弃**：`ssh.rs::handle_channel_msg` 的 catch-all arm `_ => false` 把 `russh::ChannelMsg::ExitStatus { exit_status }` 静默丢弃 —— tmux 子进程的退出码从未被记录，monitor_task 看到的总是 `Ok(0)`（因为 `SshTmuxBackend::wait()` 把 stdout EOF 当成"clean exit"）。
2. **stderr 被合并 + 但没接收**：ssh.rs line 784-785 把 `ChannelMsg::ExtendedData`（stderr）合并到 `read_tx`（stdout 流）—— 但 `SshTmuxBackend::from_connect_result` 创建的 stderr_rx 是**空的**（stderr_tx 直接 drop），所以 stderr 数据在 SSH data loop 写入 read_tx 后没人接收，stdout reader 可能看到它们（与 stdout 混在一起），也可能不看到（取决于时序）。
3. **`SshTmuxBackend::wait()` 始终返回 0**：因为 stdout rx EOF 时 `wait()` 返回 `Ok(0)`，但实际是 tmux 启动失败非 0 退出。
## 解决方案
1. `ssh.rs::SshConnectResult` 加 `pub exit_code: Arc<std::sync::Mutex<Option<i32>>>` 字段（共享让 monitor_task 看到真实退出码）。
2. `run_data_loop` + `run_ssh_session` + `run_ssh_exec_session` 多一个 `&Arc<Mutex<Option<i32>>>` 参数。
3. `handle_channel_msg` 新增 `ChannelMsg::ExitStatus { exit_status }` 分支 → 写入 `exit_code` 并 log 一行 `INFO SSH channel received ExitStatus: N`（之前完全丢）。
4. `SshTmuxBackend` 字段加 `exit_code: Arc<Mutex<Option<i32>>>`（从 `SshConnectResult` 接过来）。
5. `SshTmuxBackend::wait()` 在 EOF 时返回 `exit_code.lock().unwrap_or(-1)` —— 之前永远返回 0；现在 tmux 启动失败时返回真实 exit code。
6. 现有 monitor_task 已经把 `Ok(code)` 转成 `ControlEvent::Exit { reason: Some(format!("exit code: {code}")) }`，无需改动 —— 一旦 wait() 返回真实 code，dispatch 就发带 reason 的事件，前端 `TmuxControllerErrorBanner` 显示。
## 是否解决
YES

# Bug 011
## 现象
Bug 010 修复后 SSH 上的 tmux 退出码真实可见（`INFO SSH channel received ExitStatus: 0` —— tmux 主动 clean exit），但 tmux -CC 启动后不应该立即 clean exit。前端 tmux 会话依旧 EOF 无 pane。
## 理想效果
SSH 上的 tmux -CC 启动后保持运行，server 推送 `%session-changed` / `%window-add` / `%window-pane-changed` 等 control-mode 通知给 client，xsterm 注册第一个 pane。
## BUG原因
`tmux -CC`（control mode）启动时 tmux server 端会**立即创建一个 control session**，但**该 control session 默认关联到一个 auto-attached session**（通常：当前用户最近活跃 session）。**如果 client 不主动接管这个 control session**（iTerm2 / wezterm 启动时立即发 `refresh-client -C`），server 会把 control session 关闭 —— tmux 子进程主动 exit code 0。

我们的 controller 在 `spawn_with_backend` 末尾**没有发任何命令**，导致 tmux -CC "启动后立即 clean exit"。
## 解决方案
1. `src-tauri/src/services/tmux/commands.rs` 新增 `refresh_client_control() -> "refresh-client -C\n"`，doc 注释说明这是 `-CC` 集成**必须**发的第一个命令。
2. `src-tauri/src/services/tmux/controller.rs::spawn_with_backend` 末尾 `controller.stdin_tx.send(refresh_client_control())` —— writer task 启动后会从 `stdin_rx` FIFO 读取并写入 tmux stdin。
## 是否解决
YES（待重启 `npm run tauri dev` 验证）

# Bug 012
## 现象
Bug 011 修复 + 详细 INFO log 加入后，日志显示 `INFO tmux controller monitor: backend.wait() returned reason=Some("exit code: -1"), killed=false` —— 在 ssh exec channel 建立 (`SSH exec channel established`) 之后 ~1ms 立即发生。但 server 端 `ExitStatus: 0` 实际在 **~46ms 后**才到达（`INFO SSH channel received ExitStatus: 0`）。结果：`wait()` 返回 -1（错误码），`Exit { reason: Some("exit code: -1") }` 被 dispatch 触发，**tmux controller 在真实 ExitStatus 到达前就认为已经收到退出码**。dispatch 后续的 `SessionsChanged` / `WindowPaneChanged` 等事件没有触发 `record_first_pane`（因为事件在 Exit 之后到达，但 `Exit` 已经让 dispatch task 决定 controller 死了），前端永远等不到 pane。
## 理想效果
`backend.wait()` 一直阻塞直到 SSH server 发来 `ExitStatus`，返回**真实的** exit code。
## BUG原因
`SshTmuxBackend::wait()` 之前的实现（Bug 010 修复时）：

```rust
let mut rx = self.stdout_rx.take();   // ← stdout_rx 在 `take_stdout()` 时已经被 take
let exit_code = Arc::clone(&self.exit_code);
Box::pin(async move {
    let rx = match rx.as_mut() {
        Some(r) => r,
        None => {
            return Ok(exit_code.lock().ok().and_then(|g| *g).unwrap_or(-1));
            // ^^^^^ stdout_rx 已被 reader take → 立即返回 -1（但 exit_code 还是 None）
        }
    };
    loop {
        match rx.recv().await {
            Some(_) => continue,
            None => return Ok(exit_code.lock().ok().and_then(|g| *g).unwrap_or(-1)),
        }
    }
})
```

stdout reader 是**单独的 task**，它调用 `take_stdout()` 时已经把 `self.stdout_rx` 字段 move 走。`wait()` 第二次访问时拿到 `None`，**立即**走 fallback 分支返回 `unwrap_or(-1)`。此时 ExitStatus 远未到达（server 还要发 EOF + close），`exit_code` 还是 `None`，于是返回 `-1` —— **不是真实 exit code**。
## 解决方案
1. `ssh.rs::SshConnectResult` 加 `pub exit_code_notify: Arc<tokio::sync::Notify>` —— 当 `handle_channel_msg` 收到 `ExitStatus` 时 `notify_one()`，唤醒 `wait()`。
2. `handle_channel_msg` / `run_data_loop` / `run_ssh_session` / `run_ssh_exec_session` 全部加上 `exit_code_notify: &Arc<Notify>` 参数透传。
3. `connect_ssh` / `connect_ssh_exec` 在创建时同时建 `Arc::new(Notify::new())`，一份 clone 给 thread、一份存到 `SshConnectResult`。
4. `SshTmuxBackend` 加 `exit_code_notify: Arc<Notify>` 字段（从 `SshConnectResult` 接过来）。
5. `SshTmuxBackend::wait()` 重写：等 `exit_code_notify.notified()` + 5s timeout，然后返回真实 `exit_code`（用 `Arc<Mutex<Option<i32>>>` 读）。**不再依赖 stdout_rx**（reader task 已经 take 走）。
## 是否解决
YES

# Bug 013
## 现象
Bug 012 修复（`tokio::sync::Notify` 唤醒 `wait()`）后，重启 `npm run tauri dev`，日志显示：
- `14:19:17.342260  INFO SSH channel received ExitStatus: 0` —— ExitStatus 立即被 SSH data loop 处理
- `14:19:17.342294  INFO SSH exec data loop ended`
- `14:19:22.301968  WARN SshTmuxBackend::wait timed out after 5 s waiting for ExitStatus` —— wait 5s 后才超时！

`await_first_pane` 也 timeout 5s（`create_tmux_session failed: ... timed out waiting for first pane`）。
## 理想效果
`backend.wait()` 应该立即返回真实 exit code（不是 timeout）。前端 `await_first_pane` 立即返回（5s timeout 内）。
## BUG原因
`tokio::sync::Notify` 的"通知丢失"问题：

```
14:19:17.290657  INFO enqueued refresh-client -C; tasks spawned   ← spawn_with_backend 末尾
14:19:17.290735  INFO await_first_pane called                      ← SessionManager::create_tmux
14:19:17.303092  > msg type 94, len 27                            ← client writes "refresh-client -C\n" to SSH stdin
14:19:17.308829  RAW line "refresh-client -C"                    ← tmux echoes it back
14:19:17.340652  RAW line "\x1bP1000p%begin 1788790757 340 0"   ← DCS-wrapped %begin
14:19:17.340833  RAW line "%exit"                                 ← tmux exits immediately (no window)
14:19:17.341896  < msg type 96, len 5                            ← SSH channel_eof
14:19:17.342260  INFO SSH channel received ExitStatus: 0           ← SSH data loop writes exit_code, notify_one()
14:19:17.342294  INFO SSH exec data loop ended
14:19:22.301968  WARN SshTmuxBackend::wait timed out after 5 s    ← monitor task finally scheduled, missed the notify
```

时序关键：tmux **没有创建 control session 就立即 exit 0**（可能因为 refresh-client -C 到达太晚，或 tmux server 已有 auto-attached session 但 client 没接管 —— 仍然待诊断）。

更重要的 race：`monitor task`（`spawn_monitor_task`）通过 `tokio::spawn` 启动，**不一定立即被调度**。在 monitor task 实际开始 `await exit_code_notify.notified()` 之前，SSH data loop 已经在 14:19:17.342 收到 `ExitStatus` 并 `notify_one()`。**`Notify` 不存储通知** —— 如果 `notified()` future 在调用 `notify_one()` 时还不存在，通知丢失。

这就是为什么 `wait()` 等了 5s 才 timeout —— 通知在 14:19:17.342 已经触发但被丢弃；monitor task 在 14:19:22 才被调度到 await `notified()`，那时 future 永远不会被通知。
## 解决方案
1. 把 `SshConnectResult.exit_code_notify: Arc<Notify>` 改成 `exit_code_tx: tokio::sync::watch::Sender<Option<i32>>`。
2. `handle_channel_msg` ExitStatus 分支：`exit_code_tx.send(Some(exit_status as i32))` —— **watch channel 保留最新值**，`subscribe()` 永远能拿到（即使是晚到的 subscriber）。
3. `run_data_loop` / `run_ssh_session` / `run_ssh_exec_session` 全部加 `exit_code_tx: &watch::Sender<...>` 参数透传。
4. `connect_ssh` / `connect_ssh_exec` 创建 `(exit_code_tx, _rx_unused) = watch::channel(None)`，clone tx 给 thread + 存到 `SshConnectResult`。
5. `SshTmuxBackend` 加 `exit_code_tx: watch::Sender<Option<i32>>` 字段。
6. `SshTmuxBackend::wait()` 重写：先 `exit_code_tx.subscribe()` 拿 receiver；loop 中先读 `rx.borrow().clone()`（已经有值立即返回），否则 `tokio::select! { rx.changed(), sleep(remaining) }` 等 5s 超时。`watch::Receiver::changed()` 在已经有未读变化时**立即返回** —— 没有 race。
## 是否解决
YES

# Bug 014
## 现象
Bug 013 修复后（`backend.wait()` 立即返回），tmux 仍然立即 exit 0：
```
15:04:55.737660  RAW line "\x1bP1000p%begin 1788793496 348 0"  ← 空 body 的 %begin
15:04:55.737730  RAW line "%end 1788793496 348 0"
15:04:55.737768  RAW line "%sessions-changed"             ← 缺 `$1 <name>` 详情
15:04:55.737798  RAW line "%exit"                          ← tmux 立即 clean exit
```

没有 `%session-changed $1 <name>` / `%window-add @1` / `%window-pane-changed @1 %1` —— client 永远等不到 first pane，`await_first_pane` 5s timeout。
## 理想效果
tmux 启动后建立 control session，server 推送完整 session/window/pane 通知，client 注册第一个 pane，frontend 显示 tmux 会话。
## BUG原因
`build_tmux_argv` 拼出 `tmux -CC -L default new-session -d -x 80 -y 24`：
- `-CC` 进入 control mode client
- `new-session -d` 创建 **detached** session（bootstrap pane 是 hidden）
- 启动后 tmux server **没有 active session** 给 client attach

`refresh-client -C` 让 client 成为 control client，但 server 找不到 attach 目标，立即发 `%exit` 关闭 control session —— tmux 子进程 exit 0。

iTerm2 / wezterm 的 tmux -CC 启动序列额外发 `attach-session -c ""`（创建/attach default control session）；少了这一步 server 不会发完整 session 信息。
## 解决方案
1. `services/tmux/commands.rs` 新增 `attach_session_create() -> "attach-session -c \"\"\n"` —— 创建/attach default control session。
2. `services/tmux/controller.rs::spawn_with_backend` 末尾：`controller.stdin_tx.send(refresh_client_control())` 之后**立即** `controller.stdin_tx.send(attach_session_create())` —— writer task 顺序发给 tmux server stdin。
3. log 改成 `"enqueued refresh-client -C + attach-session -c \"\""`。
## 是否解决
部分（`new-session -A` 修复 + 去掉 `refresh-client -C` 才彻底解决，详见 Bug 014 v2）

# Bug 014 v2
## 现象
Bug 014 修复后，`refresh-client -C` 命令在此 tmux server 版本上报错（`parse error: command refresh-client: -C expects an argument`）。同时**即使 session 已建，仍没有 `%window-pane-changed`** —— 因为 `new-session -A` 只创建 session，**不创建 window/pane**。
## 理想效果
同上：tmux 启动后 server 推送完整 session + window + pane 通知，client 注册第一个 pane。
## BUG原因
1. `refresh-client -C` 在某些 tmux 版本（特别是 OpenBSD base 系统带的）需要参数或格式不同（`-C` 可能不是 control-mode flag）。
2. `new-session -A` 创建 control session 但**不创建 window** —— server 发 `%session-changed` 但不会发 `%window-add` 或 `%window-pane-changed`。client 永远等不到 first pane 通知。
## 解决方案
1. `controller.rs::build_tmux_argv` 改 `new-session -d` → `new-session -A`（**Attach to new session**），让 client 立即绑定到新建 session。
2. 去掉 `refresh-client -C` + `attach-session -c ""` 两条 stdin 命令 —— 改用 `new_window_in_current(None)` 在 control session 内创建第一个 window。
3. server 看到 `new-window` 命令 → 创建 window + pane → 发 `%window-add @1` + `%window-pane-changed @1 %1` → dispatcher 5 级 fallthrough case (3) 触发 `record_first_pane`。
## 是否解决
YES

# Bug 015
## 现象
Bug 014 v2 修复后（日志显示 `%session-changed $20 20` 完整 session 通知，session 真的 attach 了），但**仍然没有 `%window-pane-changed`** —— `await_first_pane` 继续 5s timeout。
## 理想效果
session + window + pane 三层通知都收到，client 注册第一个 pane。
## BUG原因
`new-session -A` 创建 control session 但**不创建 window**。server 仅发 `%session-changed` 通知；client 不知道 pane 在哪里，必须显式发 `new-window` 让 server 创建第一个 window + pane。
## 解决方案
1. `controller.rs::spawn_with_backend` 末尾改发 `tmux_cmd::new_window_in_current(None)`（不指定 name，server 用默认名）。
2. 去掉之前的所有 handshake 命令（`refresh-client -C` + `attach-session -c ""`），只留 `new-window`。
3. log: `"enqueued new-window; reader/writer/dispatch/monitor tasks spawned"`。
## 是否解决
部分（`new-window` 触发了 `%window-add @22` 但 server **没发** `%window-pane-changed @22 %5`，见 Bug 016）

# Bug 016
## 现象
Bug 015 修复后，日志显示 `bootstrap %window-add for window @22 — xsterm_window_id=2000001`（dispatcher 5 级 fallthrough case (b) 触发），但**完全没有 `%window-pane-changed @22 %XX`**。`%output %22` 来了（shell prompt），但 `dropping %output for unknown pane %22` —— `pane_bindings` 空。
## 理想效果
server 推送 `%window-pane-changed` → dispatcher 注册 pane → `await_first_pane` 立即返回。
## BUG原因
这个 tmux server 版本（OpenBSD base）control mode 行为差异：创建 window 后**不立即**推 `%window-pane-changed`。server 等控制 client 主动查询才回报。client 必须**自己问** server 才能拿到 pane id。
## 解决方案
1. `services/tmux/commands.rs` 新增 `list_panes_for_bootstrap() -> "list-panes -a -F \"#{session_name} #{window_id} #{window_name} #{pane_id}\"\n"` —— 主动查询所有 pane + window。
2. `services/tmux/controller.rs::TmuxController` 加 `pending_bootstrap: Mutex<Option<oneshot::Sender<Vec<String>>>>` + `bootstrap_rx: Mutex<Option<oneshot::Receiver<Vec<String>>>>` 字段。
3. `spawn_with_backend` 末尾：发 `new-window` 后**立即**发 `list-panes` + 设 `pending_bootstrap = Some(sender)` + stash `bootstrap_rx`。
4. `services/tmux/dispatch.rs::dispatch_event` 的 `CommandOutput` / `CommandEnd` 分支：检查 `pending_bootstrap.is_some()` → 累积 body → CommandEnd send `Vec<String>` 给 sender。
5. `await_first_pane` **优先**等 `bootstrap_rx`（3s timeout）→ 解析第一行拿 `window_id` + `pane_id` → 同步设置 `pane_bindings` / `window_bindings` / `record_first_pane` → 立即返回。
6. 如果 list-panes 3s timeout 还没到，回退到原路径（等 `first_pane_tx`）。
## 是否解决
YES
---END---

