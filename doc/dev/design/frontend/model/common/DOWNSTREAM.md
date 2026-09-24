# Model · Common — 对下依赖接口

> **位置**：`src/model/common/`

## 1. 依赖图

```
model/common/
├── textTransform.ts        ──►  (无——纯函数)
├── constants.ts            ──►  (无——纯常量)
├── id.ts                   ──►  (无——包装 crypto.randomUUID())
└── *.test.ts               ──►  ./textTransform + ./constants
```

**model/common 是最底层**——它不依赖任何东西。

## 2. 不允许的依赖

- ❌ `model/common/` → 其他 model domain（**任何**其他 model domain 都不能 import common 的反向）
- ❌ `model/common/` → `app/` `ui/` `service/` `infra/`
- ❌ `model/common/` → `@tauri-apps/api` 或 `react`
- ❌ `model/common/` → `crypto.randomUUID` 之外的其他外部依赖

## 3. 唯一允许的依赖：浏览器 / Node 内置

```typescript
// model/common/id.ts
export function generateId(): string {
  return crypto.randomUUID();   // 浏览器 / Node 19+ 内置
}

// model/common/textTransform.ts
// 不依赖任何外部——纯字符串处理

// model/common/constants.ts
// 不依赖任何外部——纯常量
```

## 4. 强制约束（可机械校验）

```bash
# common 不能 import 其他 model domain
grep -rn 'from\s*"\.\./\(session\|workspace\|tmux\|settings\)' src/model/common/ --include='*.ts'
# 必须为空

# common 不能 import frontend 层
grep -rn 'from\s*"\.\./\(app\|ui\|service\|infra\)' src/model/common/ --include='*.ts'
# 必须为空

# common 只能 import 浏览器 / Node 内置
grep -rn 'from\s*"' src/model/common/ --include='*.ts' | grep -v 'from\s*"\.\./' | grep -v 'from\s*"vitest'
# 应当只有 0 个结果（除了 vitest 测试框架）
```

## 5. common 跟其他 model domain 的关系

```
所有 model/<domain>/  ──►  model/common/    (允许：common 是底层)
model/common/         ──►  (无)             (禁止反向)
```

这条规则保证 common 是"叶子节点"——任何 module 都可以依赖 common，但 common 不依赖任何其他 module。

## 6. 跨域共享的判断标准

```typescript
// ❌ 错误：把业务概念放 common
export const DEFAULT_SESSION_TIMEOUT = 5000;   // ❌ session 特定，不该在 common
export const TMUX_DEFAULT_SESSION = "main";   // ❌ tmux 特定

// ✅ 正确：纯跨域常量
export const MIN_FONT_SIZE = 8;               // ✅ 跨所有 module
export const MAX_PASTE_LENGTH = 1000;         // ✅ 跨所有 module
export const DEFAULT_PORT = 22;               // ✅ 网络通用
```

判断标准：**这个常量是否在多个 domain 都需要？**

- 是 → common
- 否 → 那个 domain 的 constants 或 types

## 7. crypto.randomUUID 的兼容性

```typescript
// model/common/id.ts
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
// model/common/textTransform.test.ts
import { parseAnsi, stripAnsi, tabToSpaces, truncate } from "./textTransform";

describe("parseAnsi", () => {
  it("handles plain text", () => { ... });
  it("handles color escapes", () => { ... });
  it("handles cursor escapes", () => { ... });
});

// model/common/id.test.ts
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
