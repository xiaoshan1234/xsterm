# Service · Persistence — 对下依赖接口

> **位置**：`src/service/persistence/`

## 1. 依赖图

```
service/persistence/
├── api.ts        ────►  @/infra/store              (tauri-plugin-store wrapper)
├── store.ts      ────►  @/infra/store              (Store 句柄缓存)
├── migrations.ts ────►  (无——纯函数)
└── types.ts      ────►  (无——纯类型)
```

## 2. infra/store

| 调用 | 来源 | 何时调 |
|---|---|---|
| `Store.load(filename)` | `infra/store` | 首次访问某个文件名时 lazy load |
| `store.get(key)` | `infra/store` | api.ts get() |
| `store.set(key, value)` | `infra/store` | api.ts set() |
| `store.save()` | `infra/store` | api.ts flush() |

**关键**：persistence service 是 **infra/store 的 thin wrapper**——它做的是"句柄缓存 + 错误处理 + migration"，不是"业务存储"。

## 3. infra 其他

- `infra/store/migrations.ts` — migration 函数的实际应用（如果有）

## 4. 不允许的依赖

- ❌ `service/persistence/` → `app/`、`ui/`、`@tauri-apps/api` 直接
- ❌ `service/persistence/` → 其他 service api.ts（特别是 session/workspace/settings——它们不通过 persistence 互相调）

## 5. 强制约束（可机械校验）

```bash
grep -rn 'from\s*"\.\./\(app\|ui\|service/[^p]\|model\)' src/service/persistence/ --include='*.ts'
# 必须为空
```

## 6. 设计意图：persistence 是底层原语

persistence service **不存具体业务数据**——它只暴露 `get/set/delete` 通用 API。具体业务（session config / workspace / settings）的"持久化逻辑"在 app/usecases 编排。

**为什么不让 session/workspace/settings service 自己调 `infra/store`**：

- 业务 service 调 persistence 而不是 infra——保持"service 调 infra" 的统一边界
- persistence 提供 schema migration、错误 fallback 等通用能力
- 业务 service 不需要重复实现这些能力
