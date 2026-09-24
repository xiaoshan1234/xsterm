# Model · Session — 对下依赖接口

> **位置**：`src/model/session/`

## 1. 依赖图

```
model/session/
├── types.ts        ──►  (无)
├── repository.ts   ──►  ./types
├── events.ts       ──►  ./types
├── accessor.ts     ──►  ./types
├── rules.ts        ──►  ./types
└── *.test.ts       ──►  ./accessor + ./rules
```

**model/session 不依赖任何其他目录**——它是最底层。

## 2. 唯一允许的依赖：common

```typescript
// model/session/rules.ts
import { generateId } from "@/model/common/id";
// 仅当需要 id 生成时
```

**但**：session model **不需要** generateId——sessionId 由 backend 分配，不是前端生成。

所以 model/session **不依赖** common。

## 3. 不允许的依赖

- ❌ `model/session/` → `app/` `ui/` `service/` `infra/`
- ❌ `model/session/` → `@tauri-apps/api`
- ❌ `model/session/` → `react`
- ❌ `model/session/` → 其他 model domain（`workspace / tmux / settings`）

## 4. 强制约束（可机械校验）

```bash
# session model 不能依赖任何 frontend 层
grep -rn 'from\s*"\.\./\(app\|ui\|service\|infra\)' src/model/session/ --include='*.ts'
# 必须为空

# session model 不能依赖其他 model domain
grep -rn 'from\s*"\.\./\(workspace\|tmux\|settings\|common\)' src/model/session/ --include='*.ts'
# 必须为空（session 不依赖 common，因为不需要 generateId）

# session model 不能 import React
grep -rn 'from\s*"react"' src/model/session/ --include='*.ts'
# 必须为空

# session model 不能 import @tauri-apps/api
grep -rn 'from\s*"@tauri-apps' src/model/session/ --include='*.ts'
# 必须为空
```

## 5. 跟 service / app / ui 的依赖方向

```
service/session  ──►  model/session  ✅ 允许（service 持有 model 实例）
app/session      ──►  model/session  ✅ 允许（useCase 读 type）
ui/session       ──►  model/session  ✅ 允许（render 读 type）
model/session    ──►  service/*     ❌ 禁止
```

## 6. 测试依赖

```typescript
// model/session/accessor.test.ts
import { getActiveSession } from "./accessor";
import type { Session } from "./types";

// 测试只 import model 自身——无外部 mock
```

## 7. 跨 module 共享类型

`Session` 类型被以下地方 import（只读）：

- `service/session/store.ts` —— store schema
- `service/session/api.ts` —— api.ts 接口签名
- `app/session/usecases/*.ts` —— useCase 参数 / 返回类型
- `ui/session/view/*.tsx` —— render prop 类型

任何对这些文件的修改都要同步检查本文档 §2。
