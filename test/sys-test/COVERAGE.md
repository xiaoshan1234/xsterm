# UI 测试用例覆盖矩阵（自动化）

> 对应用例文档：`test/sys-test/ui-click-display-test-cases.md`（v1.1，160 条）
> 状态：AUTOMATED=已自动化 / SKIP-ENV=需特殊环境 / SKIP-CROSS=交叉引用 / KNOWN-GAP=已知缺口（断言当前行为）

| TC | 用例 | 状态 | spec 文件 | 备注 |
|---|---|---|---|---|
| TC-101 | 最小化按钮 | AUTOMATED | window.spec.ts |  |
| TC-102 | 最大化按钮 | AUTOMATED | window.spec.ts |  |
| TC-103 | 还原按钮 | AUTOMATED | window.spec.ts |  |
| TC-104 | 最大化状态同步 | AUTOMATED | window.spec.ts |  |
| TC-105 | 关闭按钮 | AUTOMATED | window.spec.ts |  |
| TC-106 | 标题栏拖拽移动 | AUTOMATED | window.spec.ts |  |
| TC-107 | 标题栏显示 | AUTOMATED | window.spec.ts |  |
| TC-201 | 打开会话面板 | AUTOMATED | sidebar.spec.ts |  |
| TC-202 | 打开工作区面板 | AUTOMATED | sidebar.spec.ts |  |
| TC-203 | 打开窗口面板 | AUTOMATED | sidebar.spec.ts |  |
| TC-204 | 打开设置面板 | AUTOMATED | sidebar.spec.ts |  |
| TC-205 | 面板直接切换 | AUTOMATED | sidebar.spec.ts |  |
| TC-206 | 再次点击收起面板 | AUTOMATED | sidebar.spec.ts |  |
| TC-207 | Logs 按钮（已知 K1） | KNOWN-GAP | sidebar.spec.ts | 断言当前行为 |
| TC-208 | 子菜单宽度拖拽 | AUTOMATED | sidebar.spec.ts |  |
| TC-209 | 按钮悬停提示 | AUTOMATED | sidebar.spec.ts |  |
| TC-210 | 设置分类入口 | AUTOMATED | sidebar.spec.ts |  |
| TC-301 | 新建分组 | AUTOMATED | session-panel.spec.ts |  |
| TC-302 | 新建分组-空名校验 | AUTOMATED | session-panel.spec.ts |  |
| TC-303 | 新建分组-重名校验 | AUTOMATED | session-panel.spec.ts |  |
| TC-304 | 分组折叠/展开 | AUTOMATED | session-panel.spec.ts |  |
| TC-305 | 分组数量显示 | AUTOMATED | session-panel.spec.ts |  |
| TC-306 | 分组右键菜单 | AUTOMATED | session-panel.spec.ts |  |
| TC-307 | 分组右键-新建会话 | AUTOMATED | session-panel.spec.ts |  |
| TC-308 | 分组重命名 | AUTOMATED | session-panel.spec.ts |  |
| TC-309 | 删除分组 | AUTOMATED | session-panel.spec.ts |  |
| TC-310 | 单击选中 | AUTOMATED | session-panel.spec.ts |  |
| TC-311 | 双击打开会话 | AUTOMATED | session-panel.spec.ts |  |
| TC-312 | 类型图标 | AUTOMATED | session-panel.spec.ts |  |
| TC-313 | 连接状态颜色 | AUTOMATED | session-panel.spec.ts |  |
| TC-314 | 右键菜单 | AUTOMATED | session-panel.spec.ts |  |
| TC-315 | 关闭按钮-已连接 | AUTOMATED | session-panel.spec.ts |  |
| TC-316 | 关闭按钮-未连接 | AUTOMATED | session-panel.spec.ts |  |
| TC-317 | 拖拽移入分组 | AUTOMATED | session-panel.spec.ts |  |
| TC-318 | 编辑会话配置 | AUTOMATED | session-panel.spec.ts |  |
| TC-319 | New Session 按钮 | AUTOMATED | session-panel.spec.ts |  |
| TC-320 | 同一配置多次打开 | AUTOMATED | session-panel.spec.ts |  |
| TC-401 | default 项显示 | AUTOMATED | workspace-manager.spec.ts |  |
| TC-402 | 双击 default | AUTOMATED | workspace-manager.spec.ts |  |
| TC-403 | 双击 default-已存在 | AUTOMATED | workspace-manager.spec.ts |  |
| TC-404 | 双击已保存工作区 | AUTOMATED | workspace-manager.spec.ts |  |
| TC-405 | 右键菜单-标签切换 | AUTOMATED | workspace-manager.spec.ts |  |
| TC-406 | 删除已保存工作区（已知 K4） | KNOWN-GAP | workspace-manager.spec.ts | 断言当前行为 |
| TC-407 | 重命名工作区 | AUTOMATED | workspace-manager.spec.ts |  |
| TC-408 | 空列表提示 | AUTOMATED | workspace-manager.spec.ts |  |
| TC-409 | 选中高亮 | AUTOMATED | workspace-manager.spec.ts |  |
| TC-410 | 加载失败回滚 | AUTOMATED | workspace-manager.spec.ts |  |
| TC-501 | 双击加载窗口 | AUTOMATED | window-manager.spec.ts |  |
| TC-502 | 右键菜单 | AUTOMATED | window-manager.spec.ts |  |
| TC-503 | 重命名窗口配置 | AUTOMATED | window-manager.spec.ts |  |
| TC-504 | 删除窗口配置（已知 K4） | KNOWN-GAP | window-manager.spec.ts | 断言当前行为 |
| TC-505 | 空列表提示 | AUTOMATED | window-manager.spec.ts |  |
| TC-601 | 新建窗口按钮 | AUTOMATED | tabs-windows.spec.ts |  |
| TC-602 | 保存工作区-default | AUTOMATED | tabs-windows.spec.ts |  |
| TC-603 | 保存工作区-命名工作区 | AUTOMATED | tabs-windows.spec.ts |  |
| TC-604 | 保存校验 | AUTOMATED | tabs-windows.spec.ts |  |
| TC-605 | 点击标签切换窗口 | AUTOMATED | tabs-windows.spec.ts |  |
| TC-606 | 标签关闭按钮 | AUTOMATED | tabs-windows.spec.ts |  |
| TC-607 | 关闭最后一个标签 | AUTOMATED | tabs-windows.spec.ts |  |
| TC-608 | 标签右键菜单 | AUTOMATED | tabs-windows.spec.ts |  |
| TC-609 | 标签拖拽（已知 K3） | KNOWN-GAP | tabs-windows.spec.ts | 断言当前行为 |
| TC-610 | 窗口重命名 | AUTOMATED | tabs-windows.spec.ts |  |
| TC-611 | 保存窗口配置 | AUTOMATED | tabs-windows.spec.ts |  |
| TC-612 | 点击激活工作区 | AUTOMATED | tabs-windows.spec.ts |  |
| TC-613 | 标签溢出滚动 | AUTOMATED | tabs-windows.spec.ts |  |
| TC-701 | 右键菜单-有已连接会话 | AUTOMATED | panes.spec.ts |  |
| TC-702 | 右键菜单-已断开 | AUTOMATED | panes.spec.ts |  |
| TC-703 | 右键菜单-无会话 | AUTOMATED | panes.spec.ts |  |
| TC-704 | 水平分屏 | AUTOMATED | panes.spec.ts |  |
| TC-705 | 垂直分屏 | AUTOMATED | panes.spec.ts |  |
| TC-706 | 分屏弹窗内容 | AUTOMATED | panes.spec.ts |  |
| TC-707 | 分屏拖拽分割线 | AUTOMATED | panes.spec.ts |  |
| TC-708 | 点击聚焦窗格 | AUTOMATED | panes.spec.ts |  |
| TC-709 | 窗格编号徽标 | AUTOMATED | panes.spec.ts |  |
| TC-710 | Attach Session | AUTOMATED | panes.spec.ts |  |
| TC-711 | Attach 已被占用的会话 | AUTOMATED | panes.spec.ts |  |
| TC-712 | Close Pane | AUTOMATED | panes.spec.ts |  |
| TC-713 | Close Session | AUTOMATED | panes.spec.ts |  |
| TC-714 | Select All / Copy / Clear | AUTOMATED | panes.spec.ts |  |
| TC-715 | 弹窗提交中锁定 | AUTOMATED | panes.spec.ts |  |
| TC-801 | 输入回显 | AUTOMATED | terminal.spec.ts |  |
| TC-802 | 大量输出滚动 | AUTOMATED | terminal.spec.ts |  |
| TC-803 | 鼠标选中自动复制 | AUTOMATED | terminal.spec.ts |  |
| TC-804 | 快捷键复制 | AUTOMATED | terminal.spec.ts |  |
| TC-805 | 快捷键粘贴 | AUTOMATED | terminal.spec.ts |  |
| TC-806 | 断开时禁止粘贴 | AUTOMATED | ssh.spec.ts |  |
| TC-807 | SSH 粘贴图片 | AUTOMATED | ssh.spec.ts |  |
| TC-808 | 本地回显开关 | AUTOMATED | terminal.spec.ts |  |
| TC-809 | 终端自适应尺寸 | AUTOMATED | terminal.spec.ts |  |
| TC-810 | 切换标签后内容回放 | AUTOMATED | terminal.spec.ts |  |
| TC-811 | SSH 断连提示 | AUTOMATED | ssh.spec.ts |  |
| TC-812 | 回车重连 | AUTOMATED | ssh.spec.ts |  |
| TC-813 | shell exit 自动收起 | AUTOMATED | terminal.spec.ts |  |
| TC-814 | 显示配置生效 | AUTOMATED | terminal.spec.ts |  |
| TC-815 | 主题即时生效 | AUTOMATED | terminal.spec.ts |  |
| TC-816 | 断连快速回车 | AUTOMATED | ssh.spec.ts |  |
| TC-817 | OSC52 剪贴板写入 | AUTOMATED | terminal.spec.ts |  |
| TC-818 | 本地会话粘贴图片 | AUTOMATED | ssh.spec.ts |  |
| TC-901 | 初始视图显示 | SKIP-ENV | — | 初始窗口视图（InitWindowView/PaneInitCard），无专门 spec |
| TC-902 | 卡片悬停效果 | SKIP-ENV | — | 初始窗口视图（InitWindowView/PaneInitCard），无专门 spec |
| TC-903 | Create New | SKIP-ENV | — | 初始窗口视图（InitWindowView/PaneInitCard），无专门 spec |
| TC-904 | Open Saved | SKIP-ENV | — | 初始窗口视图（InitWindowView/PaneInitCard），无专门 spec |
| TC-905 | 创建后转换 | SKIP-ENV | — | 初始窗口视图（InitWindowView/PaneInitCard），无专门 spec |
| TC-906 | 空窗格卡片 | SKIP-ENV | — | 初始窗口视图（InitWindowView/PaneInitCard），无专门 spec |
| TC-1001 | 打开/收起面板 | AUTOMATED | command-panel.spec.ts |  |
| TC-1002 | 输入命令 | AUTOMATED | command-panel.spec.ts |  |
| TC-1003 | 目标窗口选择 | AUTOMATED | command-panel.spec.ts |  |
| TC-1004 | 目标窗格选择 | AUTOMATED | command-panel.spec.ts |  |
| TC-1005 | 行/字符模式切换 | AUTOMATED | command-panel.spec.ts |  |
| TC-1006 | 手动间隔优先 | AUTOMATED | command-panel.spec.ts |  |
| TC-1007 | 次数加减 | AUTOMATED | command-panel.spec.ts |  |
| TC-1008 | 断点设置 | AUTOMATED | command-panel.spec.ts |  |
| TC-1009 | 开始发送 | AUTOMATED | command-panel.spec.ts |  |
| TC-1010 | 执行行高亮 | AUTOMATED | command-panel.spec.ts |  |
| TC-1011 | 停止发送 | AUTOMATED | command-panel.spec.ts |  |
| TC-1012 | 面板高度拖拽 | AUTOMATED | command-panel.spec.ts |  |
| TC-1013 | 无可用目标窗格 | AUTOMATED | command-panel.spec.ts |  |
| TC-1101 | 工作区下拉切换 | AUTOMATED | bottom-bar.spec.ts |  |
| TC-1102 | 关闭工作区 | AUTOMATED | bottom-bar.spec.ts |  |
| TC-1103 | default 不可关闭 | AUTOMATED | bottom-bar.spec.ts |  |
| TC-1104 | 设置视图隐藏底部栏 | AUTOMATED | bottom-bar.spec.ts |  |
| TC-1201 | 进入设置视图 | AUTOMATED | settings.spec.ts |  |
| TC-1202 | 应用明暗模式 | AUTOMATED | settings.spec.ts |  |
| TC-1203 | 终端主题切换 | AUTOMATED | settings.spec.ts |  |
| TC-1204 | 终端主题不持久化（已知 K5） | KNOWN-GAP | settings.spec.ts | 断言当前行为 |
| TC-1205 | 全局本地回显开关 | AUTOMATED | settings.spec.ts |  |
| TC-1206 | 快捷键列表 | AUTOMATED | settings.spec.ts |  |
| TC-1207 | About 页 | AUTOMATED | settings.spec.ts |  |
| TC-1301 | 标签页切换 | AUTOMATED | session-create.spec.ts |  |
| TC-1302 | 创建本地会话 | AUTOMATED | session-create.spec.ts |  |
| TC-1303 | 保存配置开关 | AUTOMATED | session-create.spec.ts |  |
| TC-1304 | 分组选择 | AUTOMATED | session-create.spec.ts |  |
| TC-1305 | SSH 必填校验 | AUTOMATED | session-create.spec.ts |  |
| TC-1306 | SSH 认证方式切换 | AUTOMATED | session-create.spec.ts |  |
| TC-1307 | SSH 连接失败提示 | AUTOMATED | session-create.spec.ts |  |
| TC-1308 | SSH 高级字段 | AUTOMATED | session-create.spec.ts |  |
| TC-1309 | 本地表单-环境变量 | AUTOMATED | session-create.spec.ts |  |
| TC-1310 | 本地表单-shell 选项 | AUTOMATED | session-create.spec.ts |  |
| TC-1311 | 弹窗关闭途径 | AUTOMATED | session-create.spec.ts |  |
| TC-1312 | 回显完整 | AUTOMATED | dialogs-edit-save.spec.ts |  |
| TC-1313 | 修改并保存 | AUTOMATED | dialogs-edit-save.spec.ts |  |
| TC-1314 | SSH 校验 | AUTOMATED | dialogs-edit-save.spec.ts |  |
| TC-1315 | 显示配置区 | AUTOMATED | dialogs-edit-save.spec.ts |  |
| TC-1316 | 名称保存 | AUTOMATED | dialogs-edit-save.spec.ts |  |
| TC-1317 | 空名处理 | AUTOMATED | dialogs-edit-save.spec.ts |  |
| TC-1318 | 预填与聚焦 | AUTOMATED | dialogs-edit-save.spec.ts |  |
| TC-1401 | Ctrl+Shift+N | AUTOMATED | shortcuts.spec.ts |  |
| TC-1402 | Ctrl+Tab / Ctrl+Shift+Tab | AUTOMATED | shortcuts.spec.ts |  |
| TC-1403 | Ctrl+W | AUTOMATED | shortcuts.spec.ts |  |
| TC-1404 | Ctrl+L（已知 K1） | KNOWN-GAP | shortcuts.spec.ts | 断言当前行为 |
| TC-1405 | Ctrl+,（已知 K2） | KNOWN-GAP | shortcuts.spec.ts | 断言当前行为 |
| TC-1406 | 快捷键不误伤终端 | AUTOMATED | shortcuts.spec.ts |  |
| TC-1407 | 边界无操作行为 | AUTOMATED | shortcuts.spec.ts |  |
| TC-1501 | 会话配置持久化 | AUTOMATED | persistence.spec.ts |  |
| TC-1502 | 分组持久化 | AUTOMATED | persistence.spec.ts |  |
| TC-1503 | 已保存工作区/窗口持久化 | AUTOMATED | persistence.spec.ts |  |
| TC-1504 | 本地回显设置持久化 | AUTOMATED | persistence.spec.ts |  |
| TC-1505 | 主题持久化差异（已知 K5） | KNOWN-GAP | persistence.spec.ts | 断言当前行为 |
| TC-1506 | 运行时状态不恢复 | AUTOMATED | persistence.spec.ts |  |
| TC-1507 | 首次启动（干净数据） | AUTOMATED | persistence.spec.ts |  |
