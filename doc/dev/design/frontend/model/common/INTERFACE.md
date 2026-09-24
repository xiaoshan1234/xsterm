# Model · Common — 对外接口

> **位置**：`src/model/common/`
> **使用方式**：`import { ... } from "@/model/common/<file>"`

## 1. textTransform.ts

```typescript
// ANSI 转义序列解析
export interface AnsiToken {
  type: "text" | "escape";
  value: string;
  escape?: AnsiEscape;
}

export interface AnsiEscape {
  kind: "color" | "cursor" | "erase" | "mode";
  fg?: string;       // color escape
  bg?: string;       // color escape
  x?: number;        // cursor escape
  y?: number;        // cursor escape
}

export function parseAnsi(text: string): AnsiToken[];

export function stripAnsi(text: string): string;

export function tabToSpaces(text: string, tabSize?: number): string;

export function truncate(text: string, maxLength: number, ellipsis?: string): string;
```

## 2. constants.ts

```typescript
// 网络
export const DEFAULT_PORT = 22;
export const DEFAULT_SSH_TIMEOUT = 30;

// Shell
export const DEFAULT_SHELL_LINUX = "/bin/bash";
export const DEFAULT_SHELL_MACOS = "/bin/zsh";
export const DEFAULT_SHELL_WINDOWS = "cmd.exe";

// 限制
export const MAX_PASTE_LENGTH = 1000;
export const MAX_SCROLLBACK_LINES = 100000;
export const MIN_SCROLLBACK_LINES = 1000;

// 字体
export const MIN_FONT_SIZE = 8;
export const MAX_FONT_SIZE = 32;
export const DEFAULT_FONT_SIZE = 14;

// 布局
export const SIDEBAR_MIN_WIDTH = 200;
export const SIDEBAR_MAX_WIDTH = 600;
export const SIDEBAR_DEFAULT_WIDTH = 320;

// Session
export const MAX_RECONNECT_ATTEMPTS = 3;
export const RECONNECT_DELAY_MS = 1000;
```

**注意**：平台相关的默认值（`DEFAULT_SHELL_*`）需要在 service 层根据 OS 选择，常量只是候选值。

## 3. id.ts

```typescript
/**
 * 生成唯一 ID（uuid v4）。
 * 包装 crypto.randomUUID() 是为了：
 * 1. 业务代码不直接 import crypto——统一通过 common
 * 2. 未来可替换为 nanoid / ulid 而不影响业务
 * 3. 测试可以 mock generateId
 */
export function generateId(): string;
```

## 4. 不对外暴露

无——model 全部 export。

## 5. 跟其他 model domain 的关系

```typescript
// model/workspace/rules/paneTree.ts
import { generateId } from "@/model/common/id";

export function createLeafPane(...) {
  return { kind: "leaf", id: generateId(), ... };
}
```

```typescript
// model/session/rules.ts
import { DEFAULT_SHELL_LINUX } from "@/model/common/constants";
// 注意：service 层根据 OS 选择具体默认值
```

## 6. 测试

```typescript
// textTransform.test.ts
describe("parseAnsi", () => {
  it("parses plain text", () => {
    expect(parseAnsi("hello")).toEqual([{ type: "text", value: "hello" }]);
  });
  it("parses color escape", () => {
    expect(parseAnsi("\x1b[31mred\x1b[0m")).toEqual([
      { type: "escape", value: "\x1b[31m", escape: { kind: "color", fg: "red" } },
      { type: "text", value: "red" },
      { type: "escape", value: "\x1b[0m", escape: { kind: "color" } },
    ]);
  });
});

describe("stripAnsi", () => {
  it("removes all escape sequences", () => {
    expect(stripAnsi("\x1b[31mred\x1b[0m")).toBe("red");
  });
});

describe("tabToSpaces", () => {
  it("converts tabs to 4 spaces by default", () => {
    expect(tabToSpaces("a\tb")).toBe("a    b");
  });
});
```

## 7. api.ts 变更流程

1. **新增常量** → 加 constants.ts
2. **新增文本处理函数** → 加 textTransform.ts + 对应测试
3. **修改函数签名** → 同步更新 §1
