# XSTerm UI 系统测试套件

本目录是 `test/sys-test/ui-click-display-test-cases.md`（160 条手工用例）的自动化实现。通过 tauri-driver + selenium-webdriver 驱动 **Windows 侧真实应用**（WebView2），将可自动化的用例变为可重复运行的 E2E 测试。

## 定位与关系

| 项 | 说明 |
|---|---|
| 用例文档 | `test/sys-test/ui-click-display-test-cases.md`（v1.1，160 条 TC） |
| 覆盖矩阵 | `test/sys-test/COVERAGE.md`（160 条全量映射：AUTOMATED / SKIP-ENV / KNOWN-GAP） |
| 自动化规格 | 154 条转 AUTOMATED，6 条（TC-901~906 初始视图）标 SKIP-ENV，K1-K6 相关标 KNOWN-GAP |
| 冒烟测试 | `test/smoke.spec.ts`（Chrome 结构冒烟，`npm run test:system`） |

## 前置条件

- **Windows 侧**：`npm run dev`（Vite :1420）+ `scripts/windows/start-webdriver.ps1`（tauri-driver :4444）
- **debug exe**：`src-tauri/target/debug/xsterm.exe` 需存在（缺失时请用户在 Windows 侧手动运行一次 `npm run tauri dev` 构建；**本套件不会自动构建**）
- WSL 侧通过 WSL2 NAT 直达 `127.0.0.1:4444`

> 架构细节见仓库根 `test/README.md`（WSL→Windows 驱动栈）。

## 运行方式

```bash
# 预检（检查 tauri-driver / Vite / exe / SSH 配置）
npm run test:ui:preflight

# 全量运行（预检通过后串行执行所有 specs）
npm run test:ui

# 仅运行单个 spec（按文件名子串匹配）
npm run test:ui -- --spec window
```

## 目录结构

```
test/sys-test/
├── lib/                # 共享基础设施
│   ├── harness.ts      # driver 生命周期 / 轮询等待 / 失败产物 / tc() 包装器
│   ├── selectors.ts    # 全部 MUI scoped 选择器（含来源注释）
│   ├── terminal.ts     # 终端输入/读取/轮询断言/会话创建
│   ├── os.ts           # 剪贴板桥接 / 应用数据目录 / 端口探测
│   └── config.ts       # ssh-config.json 读取
├── specs/              # 16 个按模块划分的 spec 文件
├── spike/              # spike 验证残件（probe/recon，非正式测试）
├── preflight.ts        # 预检脚本
├── run.ts              # 串行编排器
├── COVERAGE.md         # 160 条覆盖矩阵
├── ssh-config.example.json  # SSH 测试配置模板
└── artifacts/          # 失败产物（gitignored）
```

## 隔离与命名约定

- **spec 级隔离**：每个 spec 文件通过 `createDriver()`/`quit()` 新建/销毁应用实例（tauri-driver 重新拉起 app）
- **串行执行**：`run.ts` 用 `--test-concurrency=1` 保证 specs 不互相干扰
- **测试命名**：`TC-<id>: <描述>`（`tc("101", "...")` 自动格式化）
- **KNOWN-GAP 注释**：K1-K6 已知缺口的用例断言当前行为，并带 `// KNOWN-GAP: K<n>` 注释

## 失败产物

每个失败测试自动在 `test/sys-test/artifacts/<spec>/` 生成：
- `*.png` — 截图
- `*.html` — `<body>` outerHTML dump
- `*.txt` — 所有 `.xterm-rows` 终端文本
- `crashed.txt` — 应用崩溃时的会话死亡说明

`artifacts/` 与 `ssh-config.json` 均被 gitignore，不会进入版本库。

## SSH 测试配置

SSH 相关用例（TC-806/807/811/812/816/818）由 `test/sys-test/ssh-config.json` 门控（gitignored）。复制 `ssh-config.example.json` 为 `ssh-config.json` 并填写：

```json
{
  "host": "your-host",
  "port": 22,
  "username": "user",
  "authType": "password",
  "password": "***",
  "disconnectCommand": "sudo systemctl restart sshd"
}
```

`disconnectCommand` 可选：用于安全制造 SSH 断连以测试断连横幅/重连。主机不可达或未配置时，SSH 用例文档化跳过（退出码仍为 0）。

## 故障排查

| 现象 | 处理 |
|---|---|
| 预检失败：tauri-driver 未就绪 | Windows 侧运行 `bash scripts/start-webdriver.sh`（或 `start-webdriver.ps1`） |
| 预检失败：Vite 未启动 | Windows 侧运行 `npm run dev` |
| 预检失败：exe 缺失 | Windows 侧手动运行一次 `npm run tauri dev`（不自动构建） |
| WebView2 会话失败 | 重启 tauri-driver；确认无残留 xsterm.exe（`tasklist.exe`） |
| 剪贴板编码乱码 | 确认用 `os.ts` 的 `setWindowsClipboard`/`getWindowsClipboard`（clip.exe/PowerShell bridge） |
| spec 顺序依赖崩溃 | specs 默认串行；确认单 spec 可独立运行（不依赖其他 spec 的残留状态） |

## 已知限制

- v1 仅本地运行，不做 CI 集成
- 拖拽类用例（分割线/侧边栏宽度/标签重排）在 WebView2 下可能降级为 JS/结果断言
- TC-1507（干净首启）依赖应用数据目录可写，环境不满足时 skip
- 术语：`KNOWN-GAP` 用例断言的是当前（含已知缺口）行为，修复 K1-K6 后需更新对应断言