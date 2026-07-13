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
Terminal组件同时存在两条独立的粘贴数据路径：
1. `attachCustomKeyEventHandler` 拦截了 `Cmd+V` / `Ctrl+Shift+V` / `Shift+Insert` 等键盘粘贴快捷键，通过 Tauri `readText()` 读取剪贴板并调用 `writeSession` 发送数据。
2. 浏览器的原生 `paste` 事件仍然会被 xterm.js 内部处理，触发 `onData`，再次调用 `writeSession` 发送同样的数据。
当键盘快捷键粘贴后浏览器仍然触发 `paste` 事件时（如 macOS 上 `Cmd+V`），同一份文本被发送两次，后端回显后终端显示双倍内容。
## 解决方案
1. 在 `src/components/Terminal.tsx` 中保留 `lastKeyboardPasteRef`，在键盘粘贴快捷键按下时同步设置标记。
2. 在 document 级别的 `paste` 事件处理器中统一处理文本粘贴：先判断是否为键盘快捷键触发的文本粘贴（最近 100ms 内），若是则阻止 xterm.js 的默认粘贴，避免快捷键与原生 `paste` 事件重复发送。
3. 对于非键盘触发的文本粘贴（如 `Ctrl+V`、右键粘贴），直接在 `paste` 事件中读取剪贴板文本并调用 `writeSession` 发送，阻止 xterm.js 的 `onData` 路径。这样粘贴不会经过 `onData`，即使 local echo 开启也不会出现双倍显示。
4. 对于非文本粘贴（如图片），保留原有的 SSH 图片粘贴逻辑。
## 是否解决
YES

# Bug 004
## 现象
## 理想效果
## BUG原因
## 解决方案
## 是否解决
NO
