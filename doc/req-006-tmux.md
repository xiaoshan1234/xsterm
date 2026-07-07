# Tmux会话管理需求

## 目标
能够用本软件，完成对本地 tmux-session 和  remote-ssh-tmux-session 的 读取/显示/写入/配置读取/配置存储/配置设置 。

## 约束
1. tmux-session 需要一个 local-session/ssh-session 来做底层通信通道，我称之为 underlay-session
2. tmux-session 分为 session -> window -> pane 三级结构
3. 本软件显示分为 workspace -> window -> pane 三级结构

## 实现细则

### 连接 tmux 会话
1. 连接 underlay-session , 如果失败，弹窗报错，用户点击明白，流程结束
2. 探测是否安装了 tmux server , 如果没有，弹窗报错，用户点击明白，流程结束
3. 探测是否存在设置的 tmux-session, 如果没有,弹窗报错，用户点击明白，流程结束
4. 成功建立连接
### 读取 tmux 会话
1. 探测设置的tmux-session, 有几个window,每个window有多少pane
2. 读取每个pane的内容
### 显示 tmux 会话
1. 建立一个 underlay-session-window, 用来管理tmux总会话
2. 探测到tmux-session有多少window,多少pane,在本软件active workspace创建对应的window与pane
3. 在本软件的window与pane上显示对应的tmux的pane的内容
4. 一个tmux-session的所有tmux window使用 session-name:window-name 这样的格式，window-name 来源于远端tmux的window-name
### 通过 tmux 输入
1. 可以正常的在tmux-pane上输入输出
2. underlay-session-window 不可以用来输入输出，只能选择连接和断开
3. underlay-session-window 关闭后，断开连接，清理这个tmux-session的所有window
### 通过 tmux 配置
1. 右击 underlay-session-window 的 tab，可以新建 tmux-window
2. 双击关闭 tmux-window,远端的tmux-window也要关闭
3. 右击 tmux pane,可以选择关闭/水平切割/垂直切割/这个pane

