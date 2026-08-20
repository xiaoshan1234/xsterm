# req 1
btn btn--primary panel-send 删掉这个元素
# req 2
btn btn--secondary 保证一样的大小，现在的大小不一致
# req 3
添加一个 btn btn--secondary，用来终止cmd发射过程，  
正常显示灰色，发送过程中显示红色，
正常点击无效果，发射点击终止发送
# req 4
cmd发射过程中，▶点击无效，遇到断点时，点击▶继续
# req 5
Text/Hex 删掉
# req 6
Line/Char 用来选择按照字符发射还是行发射
# req 7
Count 用来选择循环发送多少边
# req 8
Interval 用来选择发射的间隔
Line模式下，默认1s发射1行
Char模式下，默认20ms发射一个字符