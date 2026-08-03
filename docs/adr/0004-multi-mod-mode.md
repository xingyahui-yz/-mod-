# ADR-0004：多 mod 模式

> 状态：已接受 · 日期：2026-08-03 · 来源：`/grill-with-docs` 会话

## 背景（Context）

Mod Studio 的最终形态支持**用户同时管理多个 mod**（参考 ADR-0003 的本地项目结构）。每个 mod 是文件系统上一个独立的文件夹。

当前实现（v0.1）**已隐式支持**多 mod：
- `useProjectStore.projectPath` 是单一状态
- 用户可通过 `openProject` 切换到不同目录
- App.tsx 顶层根据 `projectPath` 是否为 null 决定显示"打开项目"提示还是编辑器

但**当前实现没有"mod 列表"的概念**——用户每次切换 mod 都要走文件选择对话框。**这违反了"多 mod"的承诺**。

## 决策（Decision）

**工具维护一个 mod 注册表（registry），记录用户曾经打开过的 mod 路径**。App 启动时显示"我的 mods"列表，用户可：
- 打开最近 mod（默认行为）
- 切换到另一个 mod
- 新建 mod（弹出现有 NewProjectModal）
- 从注册表移除 mod（不删除文件夹，只移除记录）

### 注册表存储位置

注册表**不放在项目里**（每个 mod 的 `.modstudio/` 是项目私有），而是放在**用户级别**：
- macOS: `~/Library/Application Support/ModStudio/mod-registry.json`
- Windows: `%APPDATA%/ModStudio/mod-registry.json`
- Linux: `~/.config/ModStudio/mod-registry.json`

通过 Electron 的 `app.getPath('userData')` 获取。

### 注册表数据结构

```typescript
interface ModRegistry {
  version: string
  mods: ModRegistryEntry[]
  lastOpenedModId: string | null
}

interface ModRegistryEntry {
  id: string                       // UUID（与文件系统无关）
  path: string                     // 绝对路径
  name: string                     // 来自 mod_manifest.json
  lastOpenedAt: string             // ISO 时间
  openCount: number                // 打开次数（用于排序）
  isMissing: boolean               // 文件夹被删/移动时标记
}
```

### 启动流程

```
启动
  ↓
读 mod-registry.json
  ↓
如果 lastOpenedModId 对应的 mod 存在 → 自动打开
否则 → 显示 "我的 mods" 列表页
  ↓
用户选择/新建/移除
  ↓
进入编辑器
```

## 备选方案（Alternatives Considered）

### 备选 A：单 mod（每次启动选择）

- **优点**：实现最简单
- **缺点**：
  - 用户每次都要走 2-3 步
  - 不符合"多 mod 模式"承诺
  - 与"项目结构" ADR 中"用户能管理多个 mod"语义不符

### 备选 B：固定 mod 目录（`~/Documents/ModStudio/`）

- **优点**：自动发现——扫描目录即可
- **缺点**：
  - 用户**必须**把 mod 放在固定位置（违反自由）
  - 跨设备同步困难
  - 已有 mod 在其他位置时需要"导入"操作

### 备选 C：注册表 + 最近使用（已选）

- **优点**：
  - 用户自由选择 mod 位置
  - "最近使用"列表自动排序
  - 缺失检测（路径变了能提示用户重新定位）
  - 与 ADR-0003 的"本地项目结构"正交——注册表是工具级，项目结构是 mod 级
- **缺点**：
  - 注册表与文件系统状态可能不一致（用户移动/删除文件夹）
  - 跨设备需手动同步（但 mod 文件夹本身也是手动的）

## 后果（Consequences）

### 正面
- 启动到创作的步骤从 3 步降到 1 步（如果最近 mod 存在）
- 用户能直观看到自己"有哪些 mod"
- 自动排序（按 openCount + lastOpenedAt）

### 负面
- 必须处理"mod 路径失效"情况（移动/删除/外接磁盘未挂载）
- 注册表损坏需要恢复策略
- 跨设备需用户手动迁移（不如云端方案）

## 实施细节

### UI 状态机

```
[启动] → 读注册表
  ├ 失败/空 → [我的 mods 列表页 - 空状态] → 用户选/新建
  ├ lastOpened 存在 → [加载中] → 成功 [编辑器] / 失败 [列表页 + 提示]
  └ lastOpened 不存在 → [列表页]
```

### 缺失 mod 处理

- 启动时校验每个 mod 路径是否存在
- 不存在的标记 `isMissing: true`
- 列表页显示"路径失效，请重新定位或移除"
- 用户操作：定位新路径 / 移除

### 注册表操作 API（新增 `ModRegistryService.ts`）

```typescript
// 路径：src/services/ModRegistryService.ts
export function loadRegistry(): ModRegistry
export function saveRegistry(registry: ModRegistry): void
export function addMod(path: string, name: string): ModRegistryEntry
export function removeMod(id: string): void
export function markOpened(id: string): void        // 增加 openCount、更新 lastOpenedAt
export function findMissingMods(entries: ModRegistryEntry[]): ModRegistryEntry[]
```

### 与现有 `useProjectStore` 的关系

`useProjectStore.projectPath` **保留**——它表示"当前打开的 mod 路径"。
`ModRegistryService` **独立**——它管理"用户的所有 mod"。
两者通过 `App.tsx` 协调：启动时从 registry 决定 `projectPath`，切换 mod 时同时更新 registry。

## 验证（Validation）

- [ ] 首次启动显示空列表 + "新建 mod" 引导
- [ ] 第二次启动自动打开最近 mod
- [ ] 用户删除 mod 文件夹后，启动时显示"路径失效"
- [ ] 列表按 `openCount * 0.7 + recencyScore * 0.3` 排序合理
- [ ] 单元测试覆盖 registry 的 CRUD

## 修订记录

| 日期 | 变更 |
|---|---|
| 2026-08-03 | v1.0 初始建立 |
