# AI Terminal — MVP 功能清单

按 MUST / SHOULD / COULD 分级。每条带验收条件。

================================================================
MUST（MVP 必交付，阻塞发布）
================================================================

## M1. 标签页 + 多窗口
- [ ] 多标签页（创建 / 关闭 / 重命名 / 切换）
  - 验收：键盘 Ctrl+T 创建、Ctrl+W 关闭、Ctrl+1-9 直跳
- [ ] 标签页拖拽排序
  - 验收：拖拽后顺序持久化到 config
- [ ] 单标签页内水平 / 垂直分屏（最多 4 pane）
  - 验收：Ctrl+Shift+D / Ctrl+Shift+E 创建，Ctrl+Shift+W 关闭
- [ ] 标签页右键菜单（重命名 / 复制 / 拆分 / 关闭）
  - 验收：右键可见，键盘可达

## M2. 执行环境（5 种）
- [ ] PowerShell 7 默认
  - 验收：PATH 中找到 pwsh.exe，未找到则用 powershell.exe
- [ ] CMD
  - 验收：基本命令执行正常
- [ ] WSL（自动列出发行版）
  - 验收：profile 选择器列出 wsl -l -q 的输出
- [ ] SSH（密码 + 私钥认证）
  - 验收：密码 / 私钥 / ssh-agent 全部支持
- [ ] tmux session 映射
  - 验收：标签页关闭后 tmux session 仍在运行；重新打开可选 attach
- [ ] Docker 容器 attach
  - 验收：列出运行中容器，exec bash 进去

## M3. TUI 兼容性（完整档）
- [ ] 24-bit true color
  - 验收：用 24-bit color 测试脚本输出正确
- [ ] 256 color fallback
  - 验收：TERM=xterm-256color 下颜色索引正确
- [ ] 鼠标协议（X10 / SGR / SGR-Pixels / urxvt）
  - 验收：vim 鼠标选中、htop 鼠标滚动可用
- [ ] Bracketed paste mode
  - 验收：粘贴 1000 行到 vim 不触发命令
- [ ] Kitty graphics protocol
  - 验收：kitty 图像测试程序显示图片
- [ ] 完整 Unicode
  - 验收：CJK / emoji / 零宽字符宽度正确（vttest 通过）
- [ ] 备用屏幕切换
  - 验收：vim 退出后无残留
- [ ] 常见 OSC 序列（0/1/2/4/7/8/10/11/12/52）
  - 验收：每个 OSC 有单元测试

## M4. 复制粘贴
- [ ] 选中即复制
  - 验收：左键拖选 → 剪贴板有内容
- [ ] Ctrl+Shift+C / Ctrl+Shift+V
  - 验收：快捷键可重映射
- [ ] 右键菜单（复制 / 粘贴 / 全选）
  - 验收：菜单可见且键盘可达
- [ ] 多行粘贴检测
  - 验收：粘贴 ≥ 2 行时弹确认提示
- [ ] 自动 trim
  - 验收：粘贴前移除首尾空行
- [ ] 路径 / URL 检测
  - 验收：选中后悬浮按钮出现，点击调用系统默认

## M5. 快捷键（无冲突）
- [ ] 标签页：Ctrl+T/W/Tab/1-9
- [ ] 分屏：Ctrl+Shift+D/E/W
- [ ] 跳转：Ctrl+Shift+方向键
- [ ] 复制粘贴：Ctrl+Shift+C/V
- [ ] 配置可覆盖（settings.json）
  - 验收：所有快捷键可在 UI 设置页查看 / 修改
- [ ] PowerShell / TUI 应用不被快捷键抢占
  - 验收：在 vim 中按 Ctrl+T 不触发新建标签页

## M6. MCP server（核心）
- [ ] stdio 启动
  - 验收：Claude Desktop / Cursor / Codex 配置 stdio 即可连接
- [ ] list_sessions
- [ ] create_session(profile)
- [ ] close_session(session_id)
- [ ] send_keys(session_id, keys | text)
  - 验收：能注入普通文本、控制序列、组合键
- [ ] capture_screen(session_id, mode: text | ansi | screenshot)
- [ ] subscribe_output(session_id)
  - 验收：增量文本流，不丢不重
- [ ] attach_session(session_id)
  - 验收：用户键盘被屏蔽，UI banner 出现
- [ ] detach_session(session_id)
- [ ] wait_for(session_id, pattern, timeout)
- [ ] TCP 监听（可选，127.0.0.1 + token）
  - 验收：默认关闭，开启需用户显式确认

## M7. 本地 AI 一键接管
- [ ] UI 按钮"🤖 AI 接管"
- [ ] session 标记为 AI 独占
- [ ] 顶部 banner
- [ ] 释放方式：UI 按钮 + 终端输入口令
- [ ] 释放口令可配置（默认 ctrl-cmd-ai-release）

## M8. 远程 SSH agent 接入
- [ ] 反向 SSH tunnel 管理
  - 验收：ssh -R 形式，本地 MCP server 暴露给远端
- [ ] 自动生成隧道脚本
  - 验收：PowerShell + bash 双版本
- [ ] 断线自动重连（指数退避，5 次）

## M9. 配置
- [ ] 配置文件 %APPDATA%\ai-terminal\config.toml
- [ ] schema（VS Code JSON schema）
- [ ] 文件改动自动 reload
  - 验收：修改后 < 1s 内 UI 反映

## M10. Microsoft Store
- [ ] MSIX 打包
- [ ] 应用签名
- [ ] 隐私政策 URL
- [ ] 通过 Partner Center 审核

## M11. 自动更新
- [ ] Store 通道
- [ ] GitHub Releases 通道（用户可切换）
- [ ] 启动时检查
- [ ] 提示重启

================================================================
SHOULD（v1.1，MVP 阶段预留接口但不实现）
================================================================

- [ ] 标签页分组（工作区）
- [ ] 会话录像与回放（asciinema 格式）
- [ ] 主题商店
- [ ] 跨设备同步配置
- [ ] 插件系统（WebAssembly）
- [ ] Sentry 崩溃上报（可选加入）

================================================================
COULD（v2+）
================================================================

- [ ] 团队协作（多人 cursor 共享）
- [ ] AI 自动生成快捷键 / 主题
- [ ] 云端 AI session 持久化
- [ ] macOS / Linux 移植

================================================================
非目标（MVP 明确不做）
================================================================

- 不做账号系统（除非企业版要求）
- 不做云端同步（v1.1）
- 不做团队协作（v2+）
- 不做 IDE 集成（VSCode 插件另起项目）
- 不做 AI 自动补全（这层在 agent 侧）
