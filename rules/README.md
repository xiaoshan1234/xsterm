# rules/ — xsterm 代码规则

本目录是 xsterm 的**强制性**代码规范。任何 AI 编码代理或贡献者，在修改代码前必须先阅读并遵守对应文件。本目录由根目录 `AGENTS.md` 引用，是项目「守护规则」的一部分。

| 文件 | 适用范围 |
|---|---|
| `ts-name-rules.md` | 所有 TypeScript / TSX（`src/`） |
| `rust-name-rules.md` | 所有 Rust（`src-tauri/`） |

核心要点（详细以各文件为准）：

- 语义化命名，禁止拼音、无意义单词（`temp` / `obj` / `data` / `aa`）。
- 禁止类型后缀（`_arr` / `_str` / `_DTO` / `_Type` / `_Wrapper`）。
- 布尔值用 `is_` / `has_` / `should_` / `can_` 前缀。
- TypeScript：变量/函数 `camelCase`，接口/类型/枚举/组件 `PascalCase`，禁止 `I` 前缀接口。
- Rust：变量/函数/模块/文件名 `snake_case`，类型/Trait/枚举 `UpperCamelCase`，常量 `SCREAMING_SNAKE_CASE`，枚举变体用 `UpperCamelCase`（不是全大写）。

修改规范本身时，请保持正文与「速查对照表」一致。
