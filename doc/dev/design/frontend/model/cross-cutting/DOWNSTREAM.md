# Model · Cross-cutting — 对下依赖接口

> **位置**：`src/model/cross-cutting/`

## 1. 依赖图

```
model/cross-cutting/
├── textTransform.ts        ──►  (无——纯函数)
├── constants.ts            ──►  (无——纯常量)
├── id.ts                   ──►  (无——包装 crypto.randomUUID())
└── *.test.ts               ──►  ./textTransform + ./constants
```

**model/cross-cutting 是最底层**——它不依赖任何东西。

## 2. 不允许的依赖

- ❌ `model/cross-cutting/` → 其他 model domain（**任何**其他 model domain 都不能 import cross-cutting 的反向）
- ❌ `model/cross-cutting/` → `app/` `ui/` `service/` `infra/`
- ❌ `model/cross-cutting/` → `@tauri-apps/api` 或 `react`
- ❌ `model/cross-cutting/` → `crypto.randomUUID` 之外的其他外部依赖

## 3. 唯一允许的依赖：浏览器 / Node 内置

```typescript
// model/cross-cutting/id.ts
export function generateId(): string {
  return crypto.randomUUID();   // 浏览器 / Node 19+ 内置
}

// model/cross-cutting/textTransform.ts
// 不依赖任何外部——纯字符串处理

// model/cross-cutting/constants.ts
// 不依赖任何外部——纯常量
```

## 4. 强制约束（可机械校验）

```bash
# cross-cutting 不能 import 其他 model domain
grep -rn 'from\s*"\.\./\(session\|workspace\|tmux\|settings\)' src/model/cross-cutting/ --include='*.ts'
# 必须为空

# cross-cutting 不能 import frontend 层
grep -rn 'from\s*"\.\./\(app\|ui\|service\|infra\)' src/model/cross-cutting/ --include='*.ts'
# 必须为空

# cross-cutting 只能 import 浏览器 / Node 内置
grep -rn 'from\s*"' src/model/cross-cutting/ --include='*.ts' | grep -v 'from\s*"\.\./' | grep -v 'from\s*"vitest'
# 应当只有 0 个结果（除了 vitest 测试框架）
```

## 5. cross-cutting 跟其他 model domain 的关系

```
所有 model/<domain>/  ──►  model/cross-cutting/    (允许：cross-cutting 是底层)
model/cross-cutting/   ──►  (无)                    (禁止反向)
```

这条规则保证 cross-cutting 是"叶子节点"——任何 module 都可以依赖 cross-cutting，但 cross-cutting 不依赖任何其他 module。

## 6. 跨域共享的判断标准

```typescript
// ❌ 错误：把业务概念放 cross-cutting
export const DEFAULT_SESSION_TIMEOUT = 5000;   // ❌ session 特定，不该在 cross-cutting
export const TMUX_DEFAULT_SESSION = "main";    // ❌ tmux 特定

// ✅ 正确：纯跨域常量
export const MIN_FONT_SIZE = 8;                // ✅ 跨所有 module
export const MAX_PASTE_LENGTH = 1000;          // ✅ 跨所有 module
export const DEFAULT_PORT = 22;                // ✅ 网络通用
```

判断标准：**这个常量是否在多个 domain 都需要？**

- 是 → cross-cutting
- 否 → 那个 domain 的 constants 或 types

## 7. crypto.randomUUID 的兼容性

```typescript
// model/cross-cutting/id.ts
export function generateId(): string {
  // crypto.randomUUID 在以下环境可用：
  // - 现代浏览器（所有主流浏览器都支持）
  // - Node.js 19+
  // - Deno
  // - Bun
  
  // 如果需要支持更老的环境，可以用 polyfill：
  // import { v4 } from "uuid";
  // return v4();
  
  return crypto.randomUUID();
}
```

**关键**：用 `crypto.randomUUID()` 而不是 `Math.random()`——确保全局唯一性。

## 8. 测试

```typescript
// model/cross-cutting/textTransform.test.ts
import { parseAnsi, stripAnsi, tabToSpaces, truncate } from "./textTransform";

describe("parseAnsi", () => {
  it("handles plain text", () => { ... });
  it("handles color escapes", () => { ... });
  it("handles cursor escapes", () => { ... });
});

// model/cross-cutting/id.test.ts
describe("generateId", () => {
  it("returns a unique id each call", () => {
    const id1 = generateId();
    const id2 = generateId();
    expect(id1).not.toBe(id2);
  });
  it("returns a valid UUID format", () => {
    expect(generateId()).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
  });
});
```
