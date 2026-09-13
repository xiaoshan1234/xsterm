# 新增UI
假设tmux session存在n个windows，打开该session时，需要创建n+1个xsterm-window。  
其中一个是控制整个tmux session的 tmux-control-window，该window在window bar上的名称来自创建 session 时的 session name。
剩余n个是用来输入输出的普通tmux-window。
tmux-control-window 存在两个区域：
    session-control：可以 对tmux session进行 断开，重连，远程删除
    windows-control: 显示该session的所有window和window下面的pane，可以对每个window进行重命名，断开，重连，远程删除，而且可以新建tmux-window

通过window bar点击x或双击 关闭普通 tmux-window 时，仅仅表示断开该window的链接，不在tmux server上删除该window
在tmux-control-window可以删除或者增加
关闭tmux-control-window时表示关闭整个window关联的所有tmux window,注意时关闭和断链，而非删除



一个特殊 Window，windowType === "tmux-control"，不带 xstermWindowId
一个 tmux session = 一个 xsterm workspace = 一组 windows（1 control + N 普通）
"打开 session" 指 createTmuxSession / attachTmuxSession路径，二者最终都调用 createWorkspaceFromSession。
上面的这些话需要改一下
tmux-control-window 还是要带id
一个 tmux session 不等于 一个 xsterm workspace，但对应一组windows
不用createWorkspaceFromSession

你"双击 / ×关闭 = 仅断链" 这条已经和当前 closeSession 行为对 得上，不用改后端。
§0 / §2.3 末尾 / §2.4 末尾 / §3 / §4 detachTmux / §5 是否新命令