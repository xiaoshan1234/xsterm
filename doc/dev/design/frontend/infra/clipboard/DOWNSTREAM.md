# Infra · Clipboard — 对下依赖接口

> **位置**：`src/infra/clipboard/`

## 1. 依赖图

```
infra/clipboard/
├── read.ts
│   ├──► @tauri-apps/plugin-clipboard-manager   (readText)
│   └──► @/infra/logger                         (错误 log)
│
├── write.ts
│   └──► @tauri-apps/plugin-clipboard-manager   (writeText)
│
└── api.ts
    └──► ./read + ./write
```

## 2. @tauri-apps/plugin-clipboard-manager

```typescript
import { readText as tauriReadText, writeText as tauriWriteText } from "@tauri-apps/plugin-clipboard-manager";
```

**这条规则严格**：`infra/clipboard/` 是 frontend 唯一允许 import `@tauri-apps/plugin-clipboard-manager` 的目录。

## 3. infra/logger

```typescript
// infra/clipboard/read.ts
import { readText as tauriReadText } from "@tauri-apps/plugin-clipboard-manager";
import { logger } from "@/infra/logger/api";

export async function readText(): Promise<string | null> {
  try {
    return await tauriReadText();
  } catch (err) {
    logger.warn("Failed to read clipboard text", err);
    return null;
  }
}
```

**关键**：clipboard 错误时调 logger——logger 是单例，任何层都可以 import。

## 4. 跟 service / app / ui 的关系

| 层 | 怎么用 infra/clipboard |
|---|---|
| `ui/dialogs` | 直接调用（特例） |
| `ui/terminal` | 可选——粘贴确认 dialog |
| `app/*` | **通常不调** |
| `service/*` | **不调** |

## 5. 不允许的依赖

- ❌ `infra/clipboard/` → `app/` `ui/` `service/`
- ❌ `infra/clipboard/` → 其他 model / infra 子模块（除 logger）
- ❌ `infra/clipboard/` → `@tauri-apps/api` 直接（用 plugin-clipboard-manager）

## 6. 强制约束（可机械校验）

```bash
# infra/clipboard 不能依赖 frontend 层
grep -rn 'from\s*"\.\./\(app\|ui\|service\)' src/infra/clipboard/ --include='*.ts'
# 必须为空

# infra/clipboard 不能直跳 @tauri-apps/api（用 plugin）
grep -rn 'from\s*"@tauri-apps/api[^/]' src/infra/clipboard/ --include='*.ts'
# 必须为空

# ui/dialogs 是 ui 中唯一允许调 clipboard 的子目录
grep -rn 'from\s*"\.\./infra/clipboard\|from\s*"@/infra/clipboard' src/ui/ --include='*.tsx' --include='*.ts'
# 应当只在 ui/dialogs/ 出现
```

## 7. tauri capability 权限

```json
{
  "capabilities": {
    "frontend": {
      "permissions": [
        "clipboard-manager:allow-read-text",
        "clipboard-manager:allow-write-text"
      ]
    }
  }
}
```

如果未来加 image / HTML，需要加对应 permission。
