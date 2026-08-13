# ADR-0003：本地项目结构

> 状态：已接受 · 日期：2026-08-03 · 修订：2026-08-13 · 来源：`/grill-with-docs` 会话

## 背景（Context）

Mod Studio 是**本地优先**的多 mod 工具（参考 ADR-0003、ADR-0004）。每个 mod 是用户文件系统上的一个文件夹，工具通过 `projectPath` 定位和操作。

旧实现（v0.1）已支持：
- `openProjectDirectory` / `selectSaveDirectory`：用户选择文件夹
- `loadModManifest`：支持 `mod_manifest.json` / `ModTheSpire.json` / `mod.json` 三种文件名
- `loadCardsFromProject`：从 `scripts/Cards/*.cs` 加载卡牌
- `saveCardToProject`：保存到 `scripts/Cards/<ClassName>.cs`

但这种从生成代码恢复编辑模型的结构对“8 类实体 + 节点图 + AI 历史”是不足的——生成代码无法无损表达工具的全部项目源数据，而工具还需要**自己的元数据存储**（不能让 STS2 引擎看到 `.modstudio/`）。

## 决策（Decision）

**项目根目录 = 用户看到的 mod 根**。所有可恢复编辑状态的项目源数据写入项目根的 `.modstudio/` 子目录；工具根据这些数据生成并写入 `scripts/` 下的 STS2 文件。

正常打开项目时只从 `.modstudio/` 恢复 Card，不从 `scripts/Cards/*.cs` 反向解析。仅当旧项目尚无相应 `.modstudio/` 数据时，允许执行一次性 C# 导入；导入成功并写入项目源数据后，后续加载不得再回退到 C#。

一次性导入只恢复能够从旧文件证明的 Card ID 与基本属性，并创建空行为图的迁移草稿；不得猜测 `onPlay` 或从任意 C# 方法体部分推导节点。迁移报告逐张列出新 Card ID、已恢复字段、未迁移内容以及旧 C# 保护状态。用户补完行为图并通过生成校验前，工具不得覆盖旧 C#。

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
    ├── entities.json               ← 可由实体文档重建的派生索引
    ├── cards/                      ← E1 Card 的权威项目源数据
    │   └── <card-id>.json          ← 基本属性 + NodeGraph 原子聚合
    ├── nodes/                      ← 各实体的节点图
    │   ├── <entity-type>-<id>.json ← 尚未迁移到聚合文档的其他实体
    │   └── ...
    ├── ai-history/                 ← AI 对话历史
    │   ├── <entity-type>-<id>.jsonl
    │   └── ...
    ├── trash/                      ← 项目内可恢复删除区
    │   └── cards/<card-id>/
    │       ├── card.json           ← 删除时的 Card 文档
    │       └── generated.cs        ← 删除时最后存在的生成产物（若有）
    └── tool-state.json             ← 工具的 UI 状态（最后打开的实体、布局等）
```

### 关键约束

1. **`.modstudio/` 必须加进用户的 `.gitignore`**（工具提供模板）
2. **`.modstudio/` 必须从 STS2 mod 发布包中排除**（工具发布前自动剥离）
3. **`scripts/` 下的所有文件 = 工具生成的产物**——用户不直接编辑（编辑改了工具会覆盖）
4. **`scripts/` 下的文件名 = 实体 ID**——例如 `Fireball.cs` 对应 Card ID `Fireball`
5. **生成代码不是权威数据源**——C# 反向解析只用于旧项目的一次性迁移，不参与正常加载或同步
6. **Card 文档是保存原子边界**——`.modstudio/cards/<card-id>.json` 同时包含 Card 基本属性与行为图；不得把两者作为两个独立权威文件保存
7. **`entities.json` 是派生索引**——损坏或缺失时可扫描实体文档重建，不得包含无法从实体文档恢复的唯一数据
8. **删除 Card 默认可恢复**——Card 文档与当前生成产物都移入 `.modstudio/trash/cards/<card-id>/`，使活动 Card 列表和 `scripts/Cards/` 同时停止包含它

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
- 必须提供旧项目的一次性导入，并对无法无损恢复的字段给出明确迁移结果
- 迁移后的 Card 初始为草稿，用户需要显式补全行为图后才能由新模型接管 C# 生成

## 实施细节

### 实体 ID 命名规则

- Card ID 是 PascalCase ASCII 代码标识符：以英文字母开头，后续仅允许英文字母与数字
- 创建 Card 时可从初始显示名称生成建议 ID；若名称无法可靠生成（例如纯中文），创建流程要求用户输入或确认代码标识符
- 用户只可在 Card 首次落盘前修改建议 ID；创建后 ID 不可变，显示名称变化不影响 ID
- Card ID 在项目内按不区分大小写比较必须唯一；冲突必须明确报告，不静默追加后缀
- Card ID 同时用作 Card 文档名、C# 类名与生成文件名，例如 `FireStrike` → `.modstudio/cards/FireStrike.json` 与 `scripts/Cards/FireStrike.cs`

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

### `.modstudio/cards/<card-id>.json` 结构

```typescript
interface CardDocument {
  schemaVersion: 1
  card: CardData
  graph: NodeGraph
  generation: {
    lastGeneratedFingerprint: {
      sourceHash: string
      generatorVersion: string
      artifactHash: string
    } | null
  }
}
```

Card 文档应通过“同目录临时文件 → 原子重命名”写入，避免进程中断留下部分 JSON。

`sourceHash` 从会影响 C# 的规范化 Card 语义计算：包含生成所需的 Card 字段、trigger/effect kind、effect 参数与效果链顺序；排除节点坐标、图布局、时间戳、保存状态及其他纯编辑元数据。

`generatorVersion` 标识生成逻辑内容，覆盖模板、kind emit 规则与 codegen 行为；不能直接使用应用版本，因为纯 UI 升级不应使 C# 过期。成功原子写入并确认 C# 后，Card 文档记录对应的 `lastGeneratedFingerprint { sourceHash, generatorVersion, artifactHash }`。

成功写入 C# 后必须重新读取实际磁盘内容并计算 `artifactHash`，与 sourceHash、generatorVersion 一起记录。打开项目与测试预检时比较当前磁盘 C# 哈希：不一致表示“生成产物被外部修改”，必须阻止测试和无提示覆盖。用户可先把外部版本备份/导出后重新生成，但工具不把 C# 反向合并到 Card 文档。

- 当前 sourceHash、generatorVersion、artifactHash 均与 `lastGeneratedFingerprint` 一致且 C# 存在：已同步
- sourceHash 不一致：有未生成 Card 改动
- generatorVersion 不一致：生成器已升级，需要重新生成
- 指纹一致但 C# 缺失，或最近写入失败：生成未同步
- artifactHash 与磁盘 C# 不一致：生成产物被外部修改

该判定可从 Card 文档和文件系统恢复，不依赖只存在于内存的 dirty 标记。拖动节点等不改变代码语义的操作不会导致 C# 过期。

应用提供项目级“重新生成所有可生成 Card”；草稿与保真只读 Card 不属于可生成集合。

批量生成逐 Card 独立执行：仅尝试通过生成校验的活动 Card；草稿与保真只读 Card 记录为“跳过”而非失败；单张 codegen 或写盘失败不阻塞其余 Card；每张成功后立即独立更新其生成指纹。批次结束时输出成功、跳过、失败及逐项原因，不承诺项目级全有或全无事务。

### 游戏测试预检

启动游戏前展示本次实际加载的 Card 清单，并按以下规则预检：

- 从未生成过 C# 的 Card 草稿：明确标记“不参与本次测试”，允许继续
- 当前 sourceHash 比现有生成指纹新：默认阻止，用户可先生成，或针对本次启动明确选择“测试上次生成版本”
- C# 缺失、最近写入失败或 generatorVersion 过期：阻止启动并列出修复项，不允许用一次性覆盖绕过
- artifactHash 与磁盘 C# 不一致：阻止启动，要求先备份/导出外部版本或确认重新生成
- 保真只读 Card：仅当保存的生成指纹仍与现有 C# 状态一致时允许参与，否则阻止

测试预检不得隐式批量生成；它只解释将要测试的实际产物并要求用户处理危险不一致。

### Card 保存与生成顺序

Card 使用两级校验：

- **结构校验**保证 Card 文档可安全保存和恢复，包括 schema、Card ID、节点/边引用与基础类型。
- **生成校验**保证业务语义完整，包括至少一个 trigger、同类 trigger 唯一、每个 trigger 至少一个 effect、无孤立节点、参数齐全、效果链和 effect receiver 上下文合法。

保存与生成顺序：

1. 执行结构校验；失败则拒绝保存。
2. 原子写入 `.modstudio/cards/<card-id>.json`，允许保存尚未通过生成校验的 Card 草稿。
3. 执行生成校验；若失败，保留草稿且不改动现有 C#，展示具体待完成项。
4. 在内存中生成 C#；若生成失败，保留 Card 文档且不改动现有 C#。
5. 原子写入 `scripts/Cards/<card-id>.cs`。

若步骤 3–5 未完成，保留已成功保存的 Card 文档。生成校验未通过时，该 Card 是草稿；代码生成或产物写入失败时，该 Card 为“生成未同步”。两种状态都不得回滚用户编辑，且不得覆盖上一次成功生成的 C#。

Card 编辑变化通过防抖自动执行步骤 1–2，并在切换 Card、切换项目或关闭窗口前强制 flush。步骤 3–5 只由用户显式触发“生成 C#”；自动保存不得隐式更新生成产物。UI 分别呈现草稿保存状态与生成产物状态。

### Card 删除与恢复

删除 Card 前先 flush 当前草稿，然后将 Card 文档与当前存在的 C# 移入 `.modstudio/trash/cards/<card-id>/`。删除完成后，活动目录中不得残留 `scripts/Cards/<card-id>.cs`，避免游戏继续加载已删除 Card；`entities.json` 作为派生索引随活动文档重建。

删除向用户呈现原子语义：先把 Card 文档与当前 C# 写入回收站并校验完整，再移除活动 C# 与活动 Card 文档。只有确认活动 C# 不存在后，UI 才移除 Card。任一步失败都执行补偿恢复并保持 Card 活跃，显示“删除未完成”；不得以警告替代活动 C# 的清理。

恢复时把 Card 文档和保存的生成产物移回活动目录，并按不区分大小写规则重新检查 Card ID 冲突。冲突时拒绝恢复，不自动改 ID。永久删除是回收站中的独立显式操作。

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

该索引只加速发现与展示；所有字段必须能从各实体文档或其路径重建。

### 未知 kind 与未来 schema

若单张 Card 文档包含当前版本不认识的 trigger/effect kind，或声明高于当前应用支持的 schemaVersion，则以保真只读恢复模式打开该 Card：保留原始文档与未知字段，只允许查看、导出和复制原始 JSON，禁止编辑、自动保存及生成 C#。UI 列出未知 kind，并提示升级应用或恢复所需扩展。

该状态只隔离当前 Card；项目内其他可识别 Card 继续正常加载。不得丢弃未知节点、把它降级为普通草稿后重写，或因单张 Card 异常拒绝打开整个项目。

### 已知旧版 schema 迁移

应用能够识别的旧版 Card 文档在打开时通过逐版本纯函数链迁移内存模型，例如 `v1 → v2 → v3`，不允许跨版本散落条件分支。首次自动保存迁移结果前：

1. 将原始文档复制到 `.modstudio/backups/schema-migrations/<timestamp>/cards/<card-id>.json`。
2. 对迁移后的完整 Card 文档执行当前版本结构校验。
3. 校验通过后原子替换活动 Card 文档。

迁移或备份失败时保留原文件，并让该 Card 进入保真只读恢复；其他 Card 继续加载。迁移逐 Card 执行，不要求整个项目同时成功，也不为每张 Card 弹出确认。

## 验证（Validation）

- [ ] `FileService` 增加 `.modstudio/` 操作 API（`loadModStudioMeta` / `saveModStudioMeta` / `stripModStudioForPublish`）
- [ ] 发布工作流（未来）能正确剥离 `.modstudio/`
- [ ] 跨平台路径测试（Windows / macOS / Linux）
- [ ] 项目删除时 `.modstudio/` 一同删除（不残留）

## 修订记录

| 日期 | 变更 |
|---|---|
| 2026-08-03 | v1.0 初始建立 |
| 2026-08-13 | v1.1 明确 `.modstudio/` 为项目源数据，`scripts/` 为可重新生成的产物；C# 反向解析仅保留为旧项目的一次性迁移 |
| 2026-08-13 | v1.2 Card 文档成为保存原子边界 — `.modstudio/cards/<id>.json` 包含基本属性与行为图；`entities.json` 降为可重建索引 |
| 2026-08-13 | v1.3 明确保存失败语义 — 源数据写入优先；生成产物写入失败保留 Card 文档并标记“生成未同步” |
| 2026-08-13 | v1.4 两级校验 — 结构安全的 Card 草稿允许保存；只有完整业务语义通过生成校验后才更新 C# |
| 2026-08-13 | v1.5 旧 Card 导入为空图迁移草稿 — 只恢复可证明字段，不推测行为图，补全前保护现有 C# |
| 2026-08-13 | v1.6 草稿自动保存 + 显式生成 — 防抖保存 Card 文档并在离开前 flush；只有用户主动生成才更新 C# |
| 2026-08-13 | v1.7 Card ID 格式 — 创建时确认 PascalCase ASCII 代码标识符，首次落盘后不可变，项目内忽略大小写唯一且不静默改名 |
| 2026-08-13 | v1.8 Card 回收站 — 删除时文档与 C# 一并移出活动目录，默认可恢复；恢复时检查 ID 冲突，永久删除单独确认 |
| 2026-08-13 | v1.9 原子删除 — 先完整暂存回收站，再移除活动文件；仅确认活动 C# 不存在后生效，失败则补偿恢复 |
| 2026-08-13 | v1.10 保真只读恢复 — 未知 kind 或未来 schema 只隔离单张 Card，保留原始文档并禁止编辑、自动保存和生成 |
| 2026-08-13 | v1.11 已知 schema 迁移 — 逐 Card、逐版本纯函数升级，写回前备份并原子替换；失败只隔离该 Card |
| 2026-08-13 | v1.12 生成语义哈希 — Card 文档记录最近成功生成的 sourceHash；哈希排除布局元数据，用于跨重启恢复 C# 同步状态 |
| 2026-08-13 | v1.13 生成指纹 — sourceHash 与 generatorVersion 共同判断同步；模板、kind emit 或 codegen 变化会使旧 C# 过期 |
| 2026-08-13 | v1.14 批量生成策略 — 逐 Card 尽力完成并独立更新指纹；草稿/只读项跳过，单张失败不阻塞，最终汇总报告 |
| 2026-08-13 | v1.15 游戏测试预检 — 未生成草稿可明确排除；缺失/失败/生成器过期产物阻止，测试旧有效版本需本次显式确认 |
| 2026-08-13 | v1.16 外部产物修改检测 — 成功写盘后记录 artifactHash；磁盘哈希不符时阻止测试和无提示覆盖，不反向导入 C# |
