# Infra · Clipboard — 对外接口

> **位置**：`src/infra/clipboard/`
> **使用方式**：`import { readText, writeText } from "@/infra/clipboard/api"`

## 1. 接口

```typescript
// infra/clipboard/api.ts

/**
 * 读取剪贴板文本。
 * @returns 剪贴板文本；剪贴板为空或非文本格式时返回 null。
 */
export async function readText(): Promise<string | null>;

/**
 * 写入文本到剪贴板。
 */
export async function writeText(text: string): Promise<void>;

// 未来扩展（保留 API 占位）：
// export async function readImage(): Promise<Uint8Array | null>;
// export async function writeImage(data: Uint8Array): Promise<void>;
// export async function readHtml(): Promise<string | null>;
// export async function writeHtml(html: string): Promise<void>;
```

## 2. 关键设计

**当前只支持文本**——image / HTML 是未来扩展。

```typescript
// infra/clipboard/read.ts
import { readText as tauriReadText } from "@tauri-apps/plugin-clipboard-manager";

export async function readText(): Promise<string | null> {
  try {
    return await tauriReadText();
  } catch (err) {
    logger.warn("Failed to read clipboard text", err);
    return null;   // 错误时返回 null，不抛
  }
}

// infra/clipboard/write.ts
import { writeText as tauriWriteText } from "@tauri-apps/plugin-clipboard-manager";

export async function writeText(text: string): Promise<void> {
  await tauriWriteText(text);
}
```

**错误处理**：read 失败返回 null（不是抛错），write 失败抛错（让调用方知道）。

## 3. 不对外暴露

- tauri-plugin-clipboard-manager 的具体包名
- 错误处理细节

## 4. 接缝契约

```
// ui/dialogs/SaveWorkspaceDialog.tsx
import { readText, writeText } from "@/infra/clipboard";

function SaveWorkspaceDialog({ defaultName, onSave }) {
  const handlePaste = async () => {
    const text = await readText();
    if (text) {
      // 用 text 作为 name
    }
  };

  const handleCopy = async (config: PersistedSessionConfig) => {
    await writeText(JSON.stringify(config, null, 2));
  };

  return <Form onPaste={handlePaste} onCopy={handleCopy} />;
}
```

## 5. tauri capability 权限

`tauri.conf.json` 需要声明：

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

如果未来加 image / HTML，需要加：
- `clipboard-manager:allow-read-image`
- `clipboard-manager:allow-write-image`
- `clipboard-manager:allow-read-html`
- `clipboard-manager:allow-write-html`

## 6. api.ts 变更流程

1. **新增方法**（如 readImage）→ 加 read.ts + api.ts export + 更新 capability
2. **修改方法签名** → 同步更新 §1
