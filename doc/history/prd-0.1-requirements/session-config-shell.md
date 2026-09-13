## 📊 Tauri 终端配置项完整参考表

| 分类  | 配置项     | 输入类型            | 默认值           | 说明 / 备注                                    |     |
| :-- | :------ | :-------------- | :------------ | :----------------------------------------- | --- |
| 会话  | name    | string          | 根据shell配置自动生成 | 会话的名称，所有会话的名称必须                            |     |
| 会话  | group   | string          | None          | 会话所属的group                                 |     |
| 会话  | shell   | enum            |               | 提供一组shell模板:pws cmd wsl 外加自定义              |     |
| 会话  | 终端类型    | enum            | xterm-256     | xterm，xterm-256 etc                        |     |
| 会话  | 字符集     | enum            | utf-8         | utf-8 gbk etc                              |     |
| 进程  | 参数      | string          | none          | 启动shell附加的参数                               |     |
| 进程  | 工作目录    | string          | none          | 启动shell的目录                                 |     |
| 进程  | 启动后执行命令 | string          | none          | shell启动后，想要调用的命令，加一个延时选项，可以设定启动后多长时间执行这条命令 |     |
| 进程  | 环境变量    | string pair set | None          | 附加给shell的环境变量                              |     |
|     |         |                 |               |                                            |     |
