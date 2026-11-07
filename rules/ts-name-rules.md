# TypeScript 代码命名规范（团队统一标准版）

## 前言

本规范适用于所有 TypeScript / TSX 项目，统一**变量、常量、函数、接口、类型、枚举、文件、组件**命名规则，解决命名混乱、语义模糊、大小写不统一问题，适配 React/Vue/SSR 等前端业务场景，兼顾可读性、统一性、工程化规范性。

核心原则：**语义化、简洁不缩写、见名知意、大小写严格区分、禁止拼音/无意义命名**

## 一、通用基础规则（强制）

- **禁止**：拼音命名、无意义单词（a/b/c/temp/obj/data）、中文命名、下划线开头/结尾变量

- **禁止**：随意缩写，仅通用行业缩写可使用（ID、URL、API、HTTP、SSR、DOM）

- **强制**：布尔值统一使用状态语义（is/has/should/can）

- **强制**：命名纯英文，语义精准，避免歧义

- **禁止**：类型、接口、变量重名冲突

## 二、变量命名规则

### 2\.1 普通变量（let/var）

**格式**：小驼峰 camelCase

**规则**：语义化名词/动宾结构，描述变量内容

```typescript
// ✅ 正确
const userName = ''
const userInfo = {}
const hydrationStatus = 'success' // 适配SSR水合场景

// ❌ 错误
const username = '' // 无驼峰
const a = ''
const shuiHeState = '' // 拼音

```

### 2\.2 布尔变量

**格式**：小驼峰，固定前缀 **is / has / should / can**

```typescript
// ✅ 正确
const isHydrated = true // 是否完成水合
const hasError = false
const canRender = true
const shouldUpdate = false

// ❌ 错误
const hydrated = true
const errorState = true

```

### 2\.3 数组变量

**规则**：复数名词 / List 后缀

```typescript
// ✅ 正确
const userList = []
const menuItems = []
const hydrationLogs = []

// ❌ 错误
const user = []
const userArr = [] // 禁止带Arr后缀

```

### 2\.4 常量变量（const）

**普通业务常量**：小驼峰

**全局固定常量/配置/枚举值**：全大写下划线分隔 UPPER\_SNAKE\_CASE

```typescript
// 业务常量 ✅
const pageSize = 10
const hydrationTimeout = 3000

// 全局固定常量 ✅
const BASE_URL = 'https://xxx.com'
const HYDRATE_SUCCESS_CODE = 200

```

## 三、函数/方法命名规则

**格式**：小驼峰 camelCase

**规则**：动词 \+ 名词，体现行为逻辑

**常用动词规范**：get/set/handle/init/update/delete/create/check/format

```typescript
// ✅ 正确
function getUserInfo() {}
function handleHydrate() {} // 水合处理函数
function initSSRRender() {}
function checkHydrateMismatch() {}

// ❌ 错误
function user() {}
function hydrateDo() {}

```

**事件处理函数统一前缀**：handleXXX

## 四、TS 类型与接口规范（核心重点）

### 4\.1 接口 Interface

**格式**：大驼峰 PascalCase

**规则**：语义名词，**禁止 I 前缀**（摒弃老旧规范）

**后缀区分**：通用数据结构统一使用 xxxItem / xxxInfo / xxxData

```typescript
// ✅ 正确
interface UserInfo {
  id: number
  name: string
}

interface HydrateConfig {
  timeout: number
  enableLog: boolean
}

// ❌ 错误
interface IUserInfo {} // 禁止I前缀
interface user_info {} // 格式错误

```

### 4\.2 类型别名 Type

**格式**：大驼峰 PascalCase

**使用区分**：

- 对象结构优先用 **interface**

- 联合类型、交叉类型、简单类型复用优先用 **type**

```typescript
// ✅ 正确
type HydrateStatus = 'success' | 'fail' | 'pending'
type RequestMethod = 'GET' | 'POST'

```

### 4\.3 泛型命名

**简单泛型**：T / K / V

**复杂业务泛型**：大驼峰 \+ 语义

```typescript
// ✅ 正确
function getData<T>(params: T) {}
function getList<ItemType>() {}

```

## 五、枚举 Enum 命名规范

**枚举名**：大驼峰 PascalCase

**枚举项**：全大写下划线分隔

```typescript
// ✅ 正确
enum HydrateStatus {
  SUCCESS = 'success',
  FAIL = 'fail',
  PENDING = 'pending'
}

```

## 六、React/TSX 组件命名规范

**组件名称**：大驼峰 PascalCase（TSX 独有）

**文件名**：组件文件统一大驼峰

```typescript
// ✅ 正确
HydrateLayout.tsx
function HydrateLayout() {}

// ❌ 错误
hydrateLayout.tsx

```

## 七、文件/文件夹命名规范

- **ts 工具文件、hooks、普通脚本**：小驼峰 camelCase（hydrateUtil\.ts、useHydrate\.ts）

- **tsx 组件文件**：大驼峰 PascalCase

- **常量/配置文件**：全小写\+下划线（constant\_config\.ts）

## 八、常用统一后缀规范（杜绝命名混乱）

- **Info**：完整主体信息（UserInfo、HydrateInfo）

- **Item**：单条列表项数据（MenuItemItem、LogItem）

- **List**：数组列表数据（userList）

- **Config**：配置参数（HydrateConfig、RequestConfig）

- **Status**：状态枚举（HydrateStatus、LoadStatus）

- **Params**：请求入参

- **Result**：请求出参

## 九、禁止黑名单（严格禁用）

```typescript
// 全部禁止
let temp, obj, data, list // 无意义通用名
let aa, bb, cc // 随机命名
let 用户名, 状态 // 中文命名
let user_arr, user_str // 类型后缀命名
interface IXXX // I前缀接口

```

## 十、快速速查对照表（极简总结）

|代码类型|命名格式|示例|
|---|---|---|
|普通变量/函数|小驼峰|hydrateStatus、handleHydrate|
|布尔变量|is/has/should 前缀|isHydrated、hasError|
|接口/类型/枚举|大驼峰|HydrateConfig、HydrateStatus|
|全局常量|大写下划线|HYDRATE\_SUCCESS\_CODE|
|TSX 组件|大驼峰|HydratePage|

> （注：部分内容可能由 AI 生成）
