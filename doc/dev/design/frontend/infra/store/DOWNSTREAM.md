# Infra · Store — 对下依赖接口

> **位置**：`src/infra/store/`

## 1. 依赖图

```
infra/store/
├── store.ts
│   ├──► @tauri-apps/plugin-store           (Store.load)
│   └──► @/model/*/types                    (Settings / Workspace 类型可选)
│
├── migrations.ts
│   └──► (无——纯函数)
│
├── types.ts
│   └──► (无——纯类型)
│
└── api.ts
    └──► ./store + ./migrations + ./types
```

## 2. @tauri-apps/plugin-store

```typescript
import { Store } from "@tauri-apps/plugin-store";

const store = await Store.load("settings.json");
const value = await store.get<Settings>("settings");
await store.set("settings", { ...value, terminalFontSize: 14 });
await store.save();
```

**这条规则严格**：`infra/store/` 是 frontend 唯一允许 import `@tauri-apps/plugin-store` 的目录。

## 3. model

| 调用 | 来源 | 何时调 |
|---|---|---|
| `Settings` 等类型（可选） | `model/settings/types` | get<T> 的 T 参数 |

**关键**：infra/store **可以**读 model 类型来约束 T——但**不**读 model runtime 值。

## 4. 跟 service / app / ui 的关系

| 层 | 怎么用 infra/store |
|---|---|
| `service/persistence` | `useStore("settings.json").get<T>(key)` 等 |
| `app/*` | **禁止**——通过 service 间接调 |
| `ui/*` | **禁止**——通过 service 间接调 |

## 5. 不允许的依赖

- ❌ `infra/store/` → `app/` `ui/` `service/`
- ❌ `infra/store/` → 其他 model domain runtime 值
- ❌ `infra/store/` → `@tauri-apps/api` 直接（用 plugin-store）

## 6. 强制约束（可机械校验）

```bash
# infra/store 不能依赖 frontend 层
grep -rn 'from\s*"\.\./\(app\|ui\|service\)' src/infra/store/ --include='*.ts'
# 必须为空

# service 是唯一允许调 infra/store 的层
grep -rn 'from\s*"\.\./infra/store' src/ --include='*.ts' | grep -v 'src/infra/' | grep -v 'src/service/'
# 必须为空（service 可以调，infra 内部可以调）

# infra/store 不能直跳 @tauri-apps/api（用 plugin-store）
grep -rn 'from\s*"@tauri-apps/api[^/]' src/infra/store/ --include='*.ts'
# 必须为空（用 @tauri-apps/plugin-store）
```

## 7. tauri-plugin-store 的限制

- **同步限制**：tauri-plugin-store 是异步的，所有操作返回 Promise
- **文件锁**：同一文件多 store 实例可能冲突——infra/store 内部用 cache 复用
- **schema 升级**：store 没有内置 version 字段——infra/store 自己用 metadata 字段追踪
