# Model · Common — 职责

> **位置**：`src/model/common/`
> **数据**：跨域纯函数 + 常量 + id 生成
> **被使用方**：所有 model domain + service / app / ui

## 1. 这个 domain 负责什么

common model 持有**跨任何具体 domain 的纯函数和值**——它没有任何"业务概念"，只是基础设施。

承担 3 类职责：

1. **跨域纯函数**——textTransform（ANSI 解析、tab 转换等）
2. **常量**——DEFAULT_PORT、MAX_PASTE_LENGTH 等
3. **id 生成**——generateId（uuid v4）

## 2. 这个 domain **不**负责什么

- **不持有任何业务数据**——所有业务类型归各 domain
- **不依赖任何 model domain**——common 是最底层
- **不调任何外部 API**——纯函数和常量

## 3. 子结构

```
model/common/
├── textTransform.ts        # ANSI 解析、tab 转换、字符编码
├── constants.ts            # DEFAULT_PORT / MAX_PASTE_LENGTH / DEFAULT_SCROLLBACK 等
├── id.ts                   # generateId() —— crypto.randomUUID() 包装
└── *.test.ts
```

**关键**：common 没有 5 文件模板（types/repository/events/accessor/rules），因为它只有"helper 函数"和"常量"。

## 4. 用户故事（基础设施视角）

- **作为开发者**，我希望快速生成 pane id → `generateId()`
- **作为开发者**，我希望解析 ANSI 转义序列 → `parseAnsi(text)` 返回 tokens
- **作为开发者**，我希望使用统一的粘贴长度限制 → `MAX_PASTE_LENGTH` 常量

## 5. 跟其他 model domain 的关系

| domain | 关系 |
|---|---|
| 所有 model domain | 都 import common 的 generateId / constants |
| `model/workspace`（paneTree） | `generateId` 用于创建 pane / window id |
| `model/session` | `getUniqueSessionName` 用 generateId 作为 fallback |

## 6. 跟 service / app / ui 的关系

| 层 | 怎么用 model/common |
|---|---|
| 任何 service | 调 `generateId()` 创建 id |
| 任何 app module | 调 `textTransform.parseAnsi()` 解析 |
| 任何 ui module | 用 `MAX_PASTE_LENGTH` 判断是否需要确认 |

## 7. 这个 domain 的"产品语言"术语

common 是**无产品概念**的——它纯粹是基础设施。

## 8. 关键设计：common 不能 import 其他 model domain

```bash
# 必须为空
grep -rn 'from\s*"\.\./\(session\|workspace\|tmux\|settings\)' src/model/common/ --include='*.ts'
```

**这条规则保证 common 是最底层**——任何 domain 都可以 import common，但 common 不能 import 任何 domain。

## 9. textTransform 的内容

```typescript
// textTransform.ts
export function parseAnsi(text: string): AnsiToken[] {
  // 解析 ANSI 转义序列，返回 token 流
}

export function stripAnsi(text: string): string {
  // 移除所有 ANSI 转义，返回纯文本
}

export function tabToSpaces(text: string, tabSize: number = 4): string {
  // tab 转空格
}

export function truncate(text: string, maxLength: number): string {
  // 截断字符串（带省略号）
}

interface AnsiToken {
  type: "text" | "escape";
  value: string;
  // escape 类型可进一步 narrow：color / cursor / erase 等
}
```

## 10. constants 的内容

```typescript
// constants.ts
export const DEFAULT_PORT = 22;
export const DEFAULT_SHELL = "/bin/bash";   // platform-dependent, override per OS
export const MAX_PASTE_LENGTH = 1000;
export const DEFAULT_SCROLLBACK = 1000;
export const MIN_FONT_SIZE = 8;
export const MAX_FONT_SIZE = 32;
export const DEFAULT_FONT_SIZE = 14;
export const SIDEBAR_MIN_WIDTH = 200;
export const SIDEBAR_MAX_WIDTH = 600;
export const SIDEBAR_DEFAULT_WIDTH = 320;
```

**注意**：constants 是**静态值**——不会因为运行时平台变化。平台相关的默认值（如 `DEFAULT_SHELL`）应该在 service 层根据 OS 决定。

## 11. id 生成

```typescript
// id.ts
export function generateId(): string {
  return crypto.randomUUID();
}
```

**为什么包装一层**：

- 业务代码不直接 import `crypto`——统一通过 common
- 未来可以替换为 nanoid / ulid 而不影响业务
- 测试可以 mock generateId
