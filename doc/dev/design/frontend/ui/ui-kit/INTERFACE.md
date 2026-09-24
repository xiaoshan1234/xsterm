# Module · ui-kit — 对外接口

> **位置（目标态）**：`src/ui/ui-kit/`
> **消费方**：terminal / sidebar / layout 三个 L2 业务视图

## 1. 统一 props 形态

### 1.1 Dialog 形态（dialogs/ 下所有 *Dialog.tsx）

```typescript
interface DialogProps<TFormValues> {
  open: boolean;
  initialValues?: Partial<TFormValues>;
  onSubmit: (values: TFormValues) => void | Promise<void>;
  onCancel: () => void;
  isSubmitting?: boolean;
  title?: string;
}
```

### 1.2 Form 原子形态（form-atoms/ 下所有 *Field.tsx）

每个 FormXxxField 接受受控 value + onChange + error + label：

```typescript
// FormTextField
interface FormTextFieldProps {
  label: string;
  value: string;
  onChange: (v: string) => void;
  error?: string;
  placeholder?: string;
  required?: boolean;
  type?: "text" | "password" | "email";
}

// FormNumberField
interface FormNumberFieldProps {
  label: string;
  value: number;
  onChange: (v: number) => void;
  min?: number; max?: number; step?: number;
  error?: string;
}

// FormCheckboxField
interface FormCheckboxFieldProps {
  label: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}

// FormSelectField / FormRadioGroup（泛型）
interface FormSelectFieldProps<T extends string> {
  label: string;
  value: T;
  options: ReadonlyArray<{ value: T; label: string }>;
  onChange: (v: T) => void;
}
```

### 1.3 Settings 形态（settings/ 下所有 Tab）

```typescript
interface SettingsTabProps<TValues> {
  values: TValues;
  onChange: (patch: Partial<TValues>) => void;
}
```

## 2. 顶层组件清单

### 2.1 dialogs/ — session 域

```typescript
interface CreateSessionDialogProps {
  open: boolean;
  defaultType?: "local" | "ssh" | "tmux";
  onSubmit: (config: SessionConfig) => Promise<void>;
  onCancel: () => void;
  isSubmitting?: boolean;
}

interface EditSessionDialogProps {
  open: boolean;
  sessionId: number;
  onSubmit: (patch: Partial<SessionConfig>) => Promise<void>;
  onCancel: () => void;
}

interface SelectSessionDialogProps {
  open: boolean;
  filterType?: "local" | "ssh" | "tmux";
  onSelect: (configId: string) => void;
  onCancel: () => void;
}
```

### 2.2 dialogs/ — group 域

```typescript
interface NewGroupDialogProps {
  open: boolean;
  onSubmit: (name: string) => Promise<void>;
  onCancel: () => void;
}

interface EditGroupDialogProps {
  open: boolean;
  groupId: string;
  onSubmit: (patch: { name: string }) => Promise<void>;
  onCancel: () => void;
}
```

### 2.3 dialogs/ — workspace 域

```typescript
interface SaveWorkspaceDialogProps {
  open: boolean;
  workspaceId: string;
  defaultName?: string;
  onSubmit: (name: string) => Promise<void>;
  onCancel: () => void;
}
```

### 2.4 dialogs/ — paste 域

```typescript
interface PasteConfirmDialogProps {
  open: boolean;
  content: string;
  warning?: string;
  onConfirm: () => void;
  onCancel: () => void;
}
```

### 2.5 primitives/

```typescript
interface DialogProps {
  open: boolean;
  onClose: () => void;
  children: React.ReactNode;
  title?: string;
}

interface FormFieldProps {
  label: string;
  error?: string;
  required?: boolean;
  children: React.ReactNode;
}

interface ContextMenuProps {
  x: number;
  y: number;
  items: ReadonlyArray<ContextMenuItem>;
  onSelect: (item: ContextMenuItem) => void;
  onClose: () => void;
}
```

### 2.6 settings/

```typescript
interface SettingsViewProps {
  initialCategory?: SettingsCategory;       // 默认展示哪个 tab
}
```

## 3. 公开 hook

### 3.1 `useSessionForm<T>(initialValues)`

封装"受控表单 + 字段校验 + 提交中状态"。返回：

```typescript
{
  values: T;
  errors: Partial<Record<keyof T, string>>;
  handleChange: (field: keyof T, value: any) => void;
  handleSubmit: (onSubmit: (values: T) => Promise<void>) => Promise<void>;
  isSubmitting: boolean;
  reset: () => void;
}
```

被 CreateSessionDialog / EditSessionDialog / NewGroupDialog / EditGroupDialog / SaveWorkspaceDialog 复用。

### 3.2 `useDialogOpenState<T>()`（**新增**，当前未实现）

封装"打开哪个 dialog + 关闭"的 state hook，让 sidebar 不用每个 dialog 都 `useState`。返回：

```typescript
{
  openDialog: (dialog: T, props?: any) => void;
  closeDialog: () => void;
  currentDialog: T | null;
  currentProps: any;
}
```

## 4. 不对外暴露

- `primitives/Dialog` 套壳细节（modal 动画、focus trap）——只暴露 `open` + `onClose`
- `formParsers.ts` 内部校验逻辑——只在 dialogs 内部调用
- `paneContextMenu.ts` 内部菜单组装——只暴露 `showPaneContextMenu(x, y, paneId)`
- `sessionDialogItems.tsx`——只被 SelectSessionDialog 复用

## 5. 跟调用方接缝的契约

```
// sidebar/SessionManager.tsx
const dialog = useDialogOpenState<"rename" | "delete" | null>();
const handleRename = async (patch: Partial<SessionConfig>) => {
  await app/modules/session/lifecycle.renameSession(editingId, patch);
  dialog.closeDialog();
};
return (
  <>
    <SessionList ... onEdit={(id) => dialog.openDialog("rename", { id })} />
    <EditSessionDialog
      open={dialog.currentDialog === "rename"}
      sessionId={dialog.currentProps?.id}
      onSubmit={handleRename}
      onCancel={dialog.closeDialog}
    />
  </>
);
```

**接缝约束**：

- dialog 调用方**必须**自己持有 `open` 状态——dialog 不持有
- 提交回调**必须**返回 `Promise<void>`——dialog 等待 Promise resolve 后由调用方关闭
- dialog **不**直跳 `app/modules/*`——业务逻辑在调用方的 `onSubmit` 里
- settings tab **不**调持久化——`onChange` 冒泡到 SettingsView，由 SettingsView 决定何时保存
