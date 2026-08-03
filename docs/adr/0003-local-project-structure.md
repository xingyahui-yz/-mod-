# ADR-0003：本地项目结构

> 状态：已接受 · 日期：2026-08-03 · 来源：`/grill-with-docs` 会话

## 背景（Context）

Mod Studio 是**本地优先**的多 mod 工具（参考 ADR-0003、ADR-0004）。每个 mod 是用户文件系统上的一个文件夹，工具通过 `projectPath` 定位和操作。

当前实现（v0.1）已支持：
- `openProjectDirectory` / `selectSaveDirectory`：用户选择文件夹
- `loadModManifest`：支持 `mod_manifest.json` / `ModTheSpire.json` / `mod.json` 三种文件名
- `loadCardsFromProject`：从 `scripts/Cards/*.cs` 加载卡牌
- `saveCardToProject`：保存到 `scripts/Cards/<ClassName>.cs`

但**当前结构对"8 类实体 + 节点图 + AI 历史"是不足的**——8 类实体对应 8 种 STS2 文件类型，而工具还需要**自己的元数据存储**（不能让 STS2 引擎看到 .modstudio/）。

## 决策（Decision）

**项目根目录 = 用户看到的 mod 根**。工具读 `scripts/` 下的 STS2 文件，但**不写入**——所有工具私有元数据写入项目根的 `.modstudio/` 子目录。

### 项目目录契约

```
MyMod/                              ← 用户在工具中"打开"的目录
│
├── mod_manifest.json               ← STS2 mod 元数据（工具可读可写）
├── README.md                       ← 用户自述（工具不碰）
│
├── scripts/                        ← STS2 引擎读取的源代码
│   ├── Cards/                      ← E1（已支持）
│   │   └── *.cs                    ← Mustache 模板生成
│   ├── Characters/                 ← E2（待开发）
│   │   └── *.gd
│   ├── Relics/                     ← E3
│   │   └── *.gd
│   ├── Potions/                    ← E4
│   │   └── *.gd
│   ├── Events/                     ← E5
│   │   └── *.gd
│   ├── Enemies/                    ← E6
│   │   └── *.gd
│   ├── Buffs/                      ← E7
│   │   └── *.gd
│   └── ui/                         ← E8
│       └── *.tres 或 *.json
│
└── .modstudio/                     ← 工具私有元数据（用户一般不直接编辑）
    ├── entities.json               ← 8 类实体的结构化数据索引
    ├── nodes/                      ← 各实体的节点图
    │   ├── <entity-type>-<id>.json
    │   └── ...
    ├── ai-history/                 ← AI 对话历史
    │   ├── <entity-type>-<id>.jsonl
    │   └── ...
    └── tool-state.json             ← 工具的 UI 状态（最后打开的实体、布局等）
```

### 关键约束

1. **`.modstudio/` 必须加进用户的 `.gitignore`**（工具提供模板）
2. **`.modstudio/` 必须从 STS2 mod 发布包中排除**（工具发布前自动剥离）
3. **`scripts/` 下的所有文件 = 工具生成的产物**——用户不直接编辑（编辑改了工具会覆盖）
4. **`scripts/` 下的文件名 = 实体 ID**——例如 `Fireball.cs` 对应实体 ID `fireball`

## 备选方案（Alternatives Considered）

### 备选 A：把工具元数据存到 userData 目录

- **优点**：项目文件夹纯净，只有 STS2 文件
- **缺点**：
  - 用户换电脑/重装系统时元数据丢失
  - mod 删除了，元数据"孤儿"残留
  - 跨平台 userData 路径复杂（macOS 是 `~/Library/Application Support/...`）
  - 与 git 仓库无法一同 commit

### 备选 B：把工具元数据存到全局数据库

- **优点**：统一管理
- **缺点**：
  - 多 mod 切换时需要查询/索引
  - 备份/迁移复杂

### 备选 C：项目根的 `.modstudio/` 子目录（已选）

- **优点**：
  - **与 mod 一起打包、备份、迁移**——文件即数据
  - 删除 mod 时元数据一起删——**强一致性**
  - 用户可以用 git 给 `.modstudio/` 版本化（可选）
  - 与 STS2 引擎完全隔离（`.` 开头 + 工具剥离逻辑）
- **缺点**：
  - 每次打开 mod 要扫描 `.modstudio/`——但规模小（< 100KB），可接受

## 后果（Consequences）

### 正面
- 数据强一致性：mod 删了 = 元数据删了
- 备份简单：用户备份 mod 文件夹 = 备份全部
- 跨平台路径统一：使用相对路径拼接

### 负面
- 必须实现"STS2 发布剥离逻辑"——发布时递归删除 `.modstudio/`
- 必须为用户准备 `.gitignore` 模板
- 实体 ID 命名约束要严格（影响文件名）

## 实施细节

### 实体 ID 命名规则

- 来源：实体 `name` 字段，PascalCase 化
- 例外：中文名 → `MyEntity-{n}` 占位（参考已修的 `toPascalCase` 中文回退逻辑）
- 唯一性：在所属类型内必须唯一（重复时追加 `-{n}`）

### 实体 ID → 文件名

```
E1 卡牌: scripts/Cards/{ID}.cs
E2 角色: scripts/Characters/{ID}.gd
E3 遗物: scripts/Relics/{ID}.gd
E4 药水: scripts/Potions/{ID}.gd
E5 事件: scripts/Events/{ID}.gd
E6 敌人: scripts/Enemies/{ID}.gd
E7 Buff: scripts/Buffs/{ID}.gd
E8 UI: scripts/ui/{ID}.tres
```

### `.modstudio/entities.json` 结构

```typescript
interface EntitiesIndex {
  version: string
  lastUpdated: string
  entities: {
    [type in EntityType]: Record<string /* ID */, {
      id: string
      name: string
      hasNodeGraph: boolean
      nodeGraphPath?: string    // 相对 .modstudio/ 的路径
      aiHistoryPath?: string
      filePath: string          // 相对项目根的路径
      lastModified: string
    }>
  }
}
```

## 验证（Validation）

- [ ] `FileService` 增加 `.modstudio/` 操作 API（`loadModStudioMeta` / `saveModStudioMeta` / `stripModStudioForPublish`）
- [ ] 发布工作流（未来）能正确剥离 `.modstudio/`
- [ ] 跨平台路径测试（Windows / macOS / Linux）
- [ ] 项目删除时 `.modstudio/` 一同删除（不残留）

## 修订记录

| 日期 | 变更 |
|---|---|
| 2026-08-03 | v1.0 初始建立 |
