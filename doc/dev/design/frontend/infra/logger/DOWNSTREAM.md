# Infra · Logger — 对下依赖接口

> **位置**：`src/infra/logger/`

## 1. 依赖图

```
infra/logger/
├── api.ts        ────►  @tauri-apps/api/core     (invoke)
├── buffer.ts     ────►  (无——纯 JS)
├── forwarder.ts  ────►  @tauri-apps/api/core     (invoke)
├── level.ts      ────►  (无——纯 JS 过滤)
└── types.ts      ────►  (无——纯类型)
```

**infra logger 是 infra 层少有的"直跳 @tauri-apps/api"的子模块**——这跟其他 infra 子模块（cli / store / clipboard）通过 wrapper 不同。

## 2. @tauri-apps/api/core

```typescript
import { invoke } from "@tauri-apps/api/core";

// forwarder.ts
invoke("log_message", { level, message, meta, error }).catch((e) => {
  // logger 自身不能 throw——只能 console.error 避免循环
  console.error("Failed to forward log to backend:", e);
});
```

**关键**：logger 转发失败**不能抛错**——否则会形成循环（logger 报错 → logger 报错 → ...）。

## 3. 不允许的依赖

- ❌ `infra/logger/` → `service/`、`app/`、`ui/`、`model/`
- ❌ `infra/logger/` → 其他 infra 子模块（logger 是独立的）

## 4. 强制约束（可机械校验）

```bash
grep -rn 'from\s*"\.\./\(app\|ui\|service\|model\)' src/infra/logger/ --include='*.ts'
# 必须为空
```

## 5. 设计意图：logger 在 infra 是特殊的存在

infra 层通常不直跳 `@tauri-apps/api`——所有 IPC 走 `infra/tauri/commands/*` wrapper。

**logger 是例外**，因为：

1. **logger 转发到 backend 是它自己的"主路径"**——不是"调 IPC 实现某个功能"，而是"调 IPC 实现自己"
2. 没有"业务层"需要包装它——logger 是最底层
3. 加 wrapper 会增加抽象层（`infra/logger` → `infra/tauri/commands/logging` → `@tauri-apps/api`）但没有意义

**类比**：`console.log` 也不需要包装——它本身就是底层 API。

## 6. 测试

```
infra/logger/buffer.test.ts        # RingBuffer 单元测试
infra/logger/forwarder.test.ts     # mock invoke 转发测试
infra/logger/level.test.ts         # level 过滤测试
```

logger 测试用 vitest mock `@tauri-apps/api` 的 invoke。
