## 📊 Tauri 终端配置项完整参考表

| 分类 | 配置项 | 输入类型 | 推荐默认值 | 说明 / 备注 |
| :--- | :--- | :--- | :--- | :--- |
| 显示与布局 | 列 (Columns) | `number` | 自动（由窗口决定） | 通常由 `fit` 插件动态计算，无需用户手动设置；若提供，应允许输入 20~500 的整数。 |
| 显示与布局 | 行 (Rows) | `number` | 自动（由窗口决定） | 同列，通常动态计算。 |
| 显示与布局 | 回滚行数 (Scrollback) | `number` | `10000` | 历史缓冲区大小，建议可输入 0~100000，过大会消耗内存。 |
| 显示与布局 | 光标样式 (Cursor Style) | `enum` (block, underline, bar) | `block` | 用户偏好，提供三种形状选择。 |
| 显示与布局 | 行时间戳 (Line Timestamp) | `bool` (开关) | `false` (禁用) | 启用后每行输出前添加时间戳；实现较复杂，默认关闭。 |
| 显示与布局 | 时间格式 (Time Format) | `string` (文本输入) | `[HH:mm:ss]` | 仅当行时间戳启用时生效，使用 `chrono` 格式字符串。 |
| 显示与布局 | 日期时间格式 (DateTime Format) | `string` (文本输入) | `yyyy-MM-dd HH:mm:ss` | 同上，完整日期时间格式。 |
| 显示与布局 | 自动换行 (DECAWM) | `bool` (开关) | `true` (启用) | 超出列数的文本是否自动折行，默认开启。 |
| 显示与布局 | 屏幕反色 (DECSCNM) | `bool` (开关) | `false` (禁用) | 反转前景/背景色，辅助功能。 |
| 显示与布局 | 鼠标滚轮滚动步长 | `number` | `1` | 每次滚动滚轮移动的行数，可输入 1~10。 |
| 显示与布局 | 调整窗口时自动调整行列 | `bool` (开关) | `true` (启用) | 窗口尺寸变化时自动调整终端行列并通知 PTY。 |
| 显示与布局 | 远程标题更改标签标题 | `bool` (开关) | `true` (启用) | 远程程序修改终端标题时是否同步更新标签页标题。 |
| 键盘与输入 | 退格键发送 (Backspace) | `enum` (auto, backspace, delete) | `auto` | 选择退格键发送的 ASCII 码：`^H` (backspace) 或 `^?` (delete)。 |
| 键盘与输入 | 删除键发送 (Delete) | `enum` (auto, backspace, delete) | `auto` | 极少需要调整，保持 auto 即可。 |
| 键盘与输入 | 新命令行模式 (LNM) | `bool` (开关) | `false` (禁用) | 控制 Enter 发送 CR 还是 CR+LF，现代系统均已废弃此选项。 |
| 键盘与输入 | 光标键模式 (DECCKM) | `enum` (normal, application) | `normal` | 方向键发送的标准序列格式，通常保持 normal。 |
| 键盘与输入 | 数字键盘模式 (DECNKM) | `enum` (normal, application) | `normal` | 数字小键盘输入数字或应用命令，保持 normal。 |
| 键盘与输入 | 其他修饰键格式 | `enum` (xterm, fixterm) | `xterm` | 编码 Ctrl/Shift/Alt 组合的格式，仅提供 xterm 即可，fixterm 已过时。 |
| 键盘与输入 | Alt 修饰键行为 | `enum` (esc-prefix, 8bit) | `esc-prefix` | 现代应用（如 vim）依赖 ESC 前缀，不应提供 8-bit 选项。 |
| 键盘与输入 | Meta 修饰键 | 无 | 无 | 现代键盘无 Meta 键，此配置无意义，无需提供。 |
| 键盘与输入 | 分词符 (主屏幕) | `string` (文本输入) | ` !@#$%^&*()_+-=[]{}|;:'",.<>/?` | 双击选词时的分隔字符集合，可自由增删字符。 |
| 键盘与输入 | 备选屏幕分词符 | `string` (文本输入) | 同主屏幕 | 为 vim/htop 等全屏应用单独设置分词符。 |
| 安全 | 远程读取剪贴板权限 | `enum` (ask, allow, deny) | `ask` | 远程程序能否读取本地剪贴板，建议默认询问。 |
| 安全 | 远程写入剪贴板权限 | `enum` (ask, allow, deny) | `ask` 或 `allow` | 远程程序能否写入本地剪贴板，根据用户习惯调整。 |
| 日志 | 日志类型 (Log Type) | `enum` (none, printable, all) | `none` | 是否记录会话输出及范围，默认不记录保护隐私。 |
| 日志 | 日志选项 (Log Option) | `enum` (overwrite, append) | `append` | 覆盖或追加到已有日志文件。 |
| 日志 | 日志文件名模板 | `string` (文本输入) | `%n_%Y-%m-%d_%H-%M-%S.log` | 支持 `%n`(会话名)、`%Y`(年) 等占位符。 |
| 日志 | 日志最大大小 | `number` 或 `none` | `10` (MB) | 单个日志文件大小上限，0 或空表示无限制。 |
| 日志 | 日志内容格式 | `string` (文本输入) | `[%Y-%m-%d %H:%M:%S] %v` | `%v` 为实际输出内容，其他为固定格式。 |