# Mod Studio 领域模型（CONTEXT）

> 最后更新：2026-08-13 · 来源：v0.5.2 → v0.8 实施 + 架构评审 + `/grill-with-docs`
> 状态：v1.34 — 由项目所有者与协作 agent 通过开发迭代同步

## 1. 项目目标（Goal）

为杀戮尖塔 2 (Slay the Spire 2) 的 **mod 爱好者**提供一个**图形化 mod 集成开发环境**。用户懂文件夹、能配 LLM API Key，但**不写 C# / Godot**。

用户用图形化工具 + AI 对话，**产出覆盖 8 类实体的完整 STS2 mod**，最终一键发布到 Steam Workshop。

## 2. 范围（Scope）

### 2.1 包含（8 类实体）

| 编号 | 实体 (中文 / 英文) | 编辑器类型 | AI 能力 |
|---|---|---|---|
| E1 | 卡牌 / Card | 表单 + 实时预览 | 对话迭代 + 完整节点图 |
| E2 | 角色 / Character | 表单 | 对话迭代 + 完整节点图 |
| E3 | 遗物 / Relic | 表单 + 节点 | 对话迭代 + 完整节点图 |
| E4 | 药水 / Potion | 表单 | 对话迭代 |
| E5 | 事件 / Event | 节点图 | 对话迭代 + 完整节点图 |
| E6 | 敌人 / Enemy | 表单 + 节点 | 对话迭代 + 完整节点图 |
| E7 | Buff / Debuff | 节点图 | 对话迭代 + 完整节点图 |
| E8 | UI / 视觉 | 表单 | 对话迭代 |

### 2.2 不包含

- **云端同步 / 多用户协作**——本地优先，单机创作
- **零基础承诺**——用户必须懂文件夹、API Key、备份等基础概念
- **图片生成**——UI 实体使用图片 URL（用户自行准备）
- **Steam Workshop 之外的发布渠道**（GitHub、mod 论坛）

## 3. 通用语言（Ubiquitous Language）

### 3.1 项目层
- **Mod 项目（Mod Project）**：用户的一个 mod 创作，根目录含 `mod_manifest.json`
- **实体（Entity）**：8 类可编辑对象（E1-E8）的统称
- **卡牌（Card）**：一种实体，其基本属性与行为图共同描述同一张卡；不存在独立的“表单版卡牌”或“节点版卡牌”。
  _避免：节点版 Card、第二套 Card_
- **Card ID**：Card 首次落盘前由用户确认、创建后不可变的 PascalCase ASCII 代码标识符；同时决定 Card 文档、C# 类名与生成文件名，并在项目内忽略大小写唯一。
  _避免：用名称或列表位置标识 Card、静默生成不可读占位 ID_
- **Card 文档（Card Document）**：一张 Card 的完整项目源数据，包含其基本属性与行为图；两者作为一个整体保存和迁移。
  _避免：把 Card 属性与行为图视为两个独立记录_
- **Card 回收站（Card Trash）**：位于 `.modstudio/trash/` 的可恢复删除区；被删除 Card 的文档和最后生成产物都移出活动目录，恢复时重新检查 Card ID 冲突。
  _避免：删除后仍让 C# 留在活动目录、默认永久删除_
- **原子删除（Atomic Delete）**：Card 文档与活动 C# 均安全移入回收站且活动 C# 确认不存在后，删除才生效；任一步失败都补偿恢复并保持 Card 活跃。
  _避免：UI 显示已删除但游戏仍加载残留 C#_
- **Card 编辑快照（Card Edit Snapshot）**：用于撤销/重做的一次完整 Card 草稿状态，包含基本属性与行为图；自动保存状态和生成状态不属于该快照。
  _避免：表单历史与节点图历史各自独立_
- **编辑事务（Edit Transaction）**：在撤销历史中被视为一步的完整用户意图；连续文本输入和一次节点拖动会被合并，离散的选择、增删与连线操作各自成步。
  _避免：每次渲染状态变化都占一个撤销步骤_
- **节点图（Node Graph）**：用图形化节点表达复杂逻辑的有向无环图
- **触发根（Trigger Root）**：行为图中一种触发时机的入口。一张 Card 可有多个不同的触发根，但同一种触发根在该 Card 中只能出现一次。
  _避免：一张 Card 只能有一个 trigger、重复 trigger 方法_
- **效果分支（Effect Branch）**：从一个触发根出发的一组效果行为；每个 effect 只属于一个效果分支，不被多个触发根共享。
  _避免：多个 trigger 隐式共享同一个 effect 节点_
- **效果链（Effect Chain）**：一个触发根下按连线先后执行的线性 effect 序列；v0.9 不用边的插入顺序或画布坐标表达执行顺序。
  _避免：无显式次序的 effect 分叉、按节点位置推断执行顺序_
- **完整触发分支（Complete Trigger Branch）**：包含一个触发根及至少一个相连 effect 的效果链；只有所有触发分支都完整时，Card 才可生成。
  _避免：生成空 override、静默忽略空 trigger_
- **目标化 Effect Kind（Targeted Effect Kind）**：名称与注册定义共同确定动作及其接收者的 effect kind；节点实例不再用通用 `target` 字段覆盖目标。
  _避免：同一动作同时靠 kind 名称和 `data.target` 表达目标_
- **Self**：当前拥有行为图的实体，例如这张 Card 或这个 Relic。
- **Owner**：持有当前实体的玩家或角色。
- **EventTarget**：由 Any trigger 的事件参数提供、供后续 effect 操作的对象。
  _避免：让 Self 随 effect 在实体与 Owner 之间切换含义_
- **AI 对话（AI Conversation）**：用户与 LLM 的多轮交互历史

### 3.2 编辑器层
- **表单（Form）**：键值对编辑界面
- **预览（Preview）**：实时展示 C# / GDScript 代码或游戏内效果
- **生成（Generate）**：从 `.modstudio/` 元数据 → 编译产物（`.cs` / `.gd`）
- **同步（Sync）**：保持 `.modstudio/` 元数据与编译产物一致
- **生成未同步（Generation Out of Sync）**：项目源数据已成功保存，但对应生成产物尚未更新成功的可恢复状态；不表示用户编辑丢失。
  _避免：把生成失败称为保存失败_
- **生成语义哈希（Generation Semantic Hash）**：对会影响 C# 的规范化 Card 语义计算的稳定哈希；排除节点坐标、时间戳与保存状态，用于跨重启判断生成产物是否对应当前草稿。
  _避免：用整个 Card 文档或内存 dirty 标记判断 C# 同步状态_
- **生成指纹（Generation Fingerprint）**：由生成语义哈希与生成器版本共同组成的同步依据；Card 语义或模板/codegen 行为任一变化都会使旧 C# 过期。
  _避免：只用应用版本或 Card 数据判断生成产物是否最新_
- **产物哈希（Artifact Hash）**：成功生成后对实际磁盘 C# 内容计算并记录的哈希，用于发现生成后的外部修改。
  _避免：把“曾生成成功”误当成“磁盘产物仍未改变”_
- **批量生成报告（Batch Generation Report）**：项目级生成结束后的逐 Card 结果汇总，区分成功、跳过与失败；单张失败不阻塞其他可生成 Card。
  _避免：把草稿/只读 Card 计为生成失败、遇到首个错误停止整批任务_
- **测试预检（Test Preflight）**：启动游戏前核对实际会加载的 C# 与 Card 状态；允许明确排除未生成草稿，但默认阻止加载缺失、失败或不是当前版本的生成产物。
  _避免：让用户在不知情时测试旧 C#、为无产物的新草稿阻塞整个项目_
- **Card 草稿（Card Draft）**：结构安全、可保存和恢复，但行为语义尚不满足代码生成条件的 Card 文档。
- **草稿自动保存（Draft Autosave）**：Card 编辑变化经防抖写入 Card 文档，并在切换 Card、切换项目或关闭窗口前强制完成；只保护项目源数据，不更新生成产物。
- **显式生成（Explicit Generation）**：由用户主动触发、通过生成校验后才更新 C# 生成产物的操作。
  _避免：把自动保存等同于自动生成_
- **迁移草稿（Migrated Card Draft）**：从旧 C# 恢复出可证明的 Card 基本属性、但行为图为空的 Card 草稿；旧 C# 在用户完成行为图前受到保护。
  _避免：根据旧 C# 猜测或虚构行为节点_
- **保真只读恢复（Lossless Read-only Recovery）**：当前应用不认识 Card 文档中的 kind 或未来 schema 时，保留原始数据并仅允许查看/导出；禁止编辑、自动保存和生成，且只隔离该 Card。
  _避免：丢弃未知节点、用旧版本重写未来版本数据、因单张异常 Card 阻塞整个项目_
- **Card Schema 迁移（Card Schema Migration）**：把已知旧版 Card 文档逐版本转换到当前 schema 的纯函数链；首次写回前备份原文档，失败只隔离该 Card。
  _避免：无备份原地改写、让单张迁移失败阻塞整个项目_
- **可生成 Card（Generatable Card）**：通过完整业务语义校验、能够确定性生成 C# 的 Card 文档。
  _避免：要求半成品 Card 必须可生成后才能保存_
- **项目源数据（Project Source Data）**：保存在 `.modstudio/` 中、可完整恢复实体及其行为图的数据；生成产物不是项目源数据。
  _避免：把 `scripts/` 下的生成代码称为源数据_

### 3.4 节点种类层（v0.5.2 Relic 模块化新增）

- **Kind Registry（种类注册表）**：每类实体（如 Relic）维护一张 `kinds.ts`，集中声明该实体支持的所有节点 kind（trigger / effect / condition 等）。一处定义，UI（按钮/下拉）和 codegen（派发表）都从此消费。
- **Trigger Kind（触发器种类）**：定义在 `TRIGGER_KINDS` 表。每条记录含 `kind`、`label`、`methodName`（C# 方法名）、`defaultData`（添加节点时的默认填充）。
- **Effect Kind（效果种类）**：定义在 `EFFECT_KINDS` 表。每条记录含 `kind`、`label`、`emitStatement(data)`（派发函数 data → C# 语句）、`defaultData`。
- **设计动机**：v0.5.2 之前，codegen 派发表（`TRIGGER_DISPATCH` / `EFFECT_DISPATCH`）与 RelicEditor 的 `defaults` 表独立维护，新增 effect 需改两处。`kind registry` 消除这种平行维护。
- **未来扩展（v0.9）**：每类实体（Card/Character/Potion/Event/Enemy/Buff/UI）应有各自的 `kinds.ts`，复用同一"kind registry"模式。

### 3.5 节点编辑器层（v0.6 → v0.7 新增）

- **Graph Snapshot / HistoryState**：节点图编辑器（`useNodeGraph`）维护 `HistoryState { past: NodeGraph[], present: NodeGraph, future: NodeGraph[] }`。详见 [ADR-0005](./docs/adr/0005-history-stack-undo-redo.md)。
- **不可变 Mutation（Immutable Mutation）**：所有 mutation 返回新 `NodeGraph`，引用相等表示 no-op，约定由 [v0.6 数据层硬化](./docs/architecture-review-2026-08-06.md) 沉淀。
- **External Data Seam**（v0.8 新增）：所有外部输入（JSON / LLM 响应 / C# 反向解析）必须经过 `src/card/cardValidation.ts:parseCardData(value: unknown): CardData | null` —— 卡片实体的唯一可信 seam。其他实体在 v0.9+ 各自延展。
- **Factory Seam**（v0.8-2 新增，候选 2）：store 与 service 改为工厂模式 `createX({ dependency })`，消除模块级 `window.__adapterFactory` / `let api = window.electronAPI` 全局 — 解并行测试全局污染。详见架构评审报告 §Candidate 2。
- **ConnectError Lifecycle Seam**（v0.8-3 新增，候选 3）：`useNodeGraph` 拥有 `connectError: string | null` + `clearConnectError()` —— connect 成败路径都更新 hook 内部状态，编辑器纯观察 + 渲染 + 触发清除。详见架构评审报告 §Candidate 3。

### 3.3 AI 层
- **Prompt 模板（Prompt Template）**：每个实体类型对应的结构化 prompt
- **结构化输出（Structured Output）**：LLM 返回的 JSON Schema 校验过的对象
- **AI 提案（AI Proposal）**：通过结构校验、供用户预览但尚未进入项目源数据的完整候选实体草稿；用户确认后才作为一个编辑事务应用。
  _避免：AI 响应直接覆盖当前 Card_
- **过期 AI 提案（Stale AI Proposal）**：其请求基线 revision 已不同于当前 Card 草稿的 AI 提案；仍可查看，但不得应用。
  _避免：用旧提案覆盖请求之后的用户编辑_
- **对话历史（Conversation History）**：保留多轮对话的上下文

## 4. 核心架构决策

完整 ADR 见 `docs/adr/`。本节为概览：

- **ADR-0001**：节点编辑器自研（不引入 react-flow）
- **ADR-0002**：AI 输出结构化 JSON（不解析自然语言）
- **ADR-0003**：本地文件夹项目结构（不云端）
- **ADR-0004**：多 mod 模式（用户管理多个项目）
- **ADR-0005**：节点编辑器撤销 / 重做 — History Stack（不可变快照），不采用 Command Pattern
- **ADR-0006**：v0.9 Card 节点 schema — 单一 Card 模型与线性 trigger→effect 链（详见 `docs/adr/0006-v0.9-card-node-schema.md`）

非 ADR 但已沉淀的决策：

- **`/improve-codebase-architecture` 评审 5 候选**（2026-08-06）：[docs/architecture-review-2026-08-06.md](./docs/architecture-review-2026-08-06.md)。Candidate 1（CardData 单 validator）v0.8-1 ✅；Candidate 2（factory seam）v0.8-2 ✅；Candidate 3（connectError 入 hook）v0.8-3 ✅。Candidate 4/5 延后到 v0.9+。

## 5. 项目目录结构

```
MyMod/                          ← 用户项目根
├── mod_manifest.json           ← STS2 mod 元数据（已支持）
├── scripts/                    ← 编译产物（由工具生成）
│   ├── Cards/*.cs              ← 已支持
│   ├── Characters/*.gd         ← 新
│   ├── Relics/*.gd             ← 新
│   ├── Potions/*.gd            ← 新
│   ├── Events/*.gd             ← 新
│   ├── Enemies/*.gd            ← 新
│   └── Buffs/*.gd              ← 新
└── .modstudio/                 ← 工具私有元数据（用户不直接编辑）
    ├── entities.json           ← 可由实体文档重建的派生索引
    ├── cards/                  ← Card 的权威聚合文档（属性 + 行为图）
    ├── nodes/                  ← 尚未聚合迁移的其他实体节点图
    ├── ai-history/             ← AI 对话历史（按实体 ID 组织）
    └── trash/                  ← Card 文档与生成产物的可恢复删除区
```

## 6. 当前状态（截至 2026-08-12，v0.8-3 已 commit 待 PR）

### 6.1 已实现

**核心编辑器与编辑器能力**
- ✅ E1 卡牌：表单 + AI 单次生成 + **单一 validator seam**（v0.8-1：合并 `cardIO/cardParser/base.ts/FileService` 4 个浅模块为 `src/card/cardValidation.ts` 唯一 seam，删 139 行未结算代码）
- ✅ E3 遗物（Relic）：表单 + 节点图 + Kind Registry（v0.5.2）+ 撤销 / 重做（v0.7）
- ✅ 节点编辑器（自研）：v0.1 数据模型 → v0.7 历史栈 + 快捷键
- ✅ 测试基础设施：**292 个**单元 / 集成 / 组件测试（v0.7 后，v0.8-1 加 5）

**技术栈与 CI**
- ✅ Electron + React + TypeScript + Zustand 技术栈
- ✅ Mustache 模板 → C# 代码生成（`escapeCSharpString` 防字符串注入 — v0.6）
- ✅ HTTP LLM 适配器（4 provider）
- ✅ 8 步新手教程 + 6 步任务引导

**架构与决策**
- ✅ 5 份 ADR（0001 自研 / 0002 JSON / 0003 本地 / 0004 多 mod / 0005 历史栈）
- ✅ `/improve-codebase-architecture` 评审报告（v0.7 后，沉淀 v0.8-1 / v0.8-2 / v0.8-3 / v0.9 路线）
- ✅ Git 仓库双远端（origin: gitcode.com / atomgit）

### 6.2 未实现（按优先级排序）

**v0.8 待做**
- ✅ v0.8-1 — CardData 单 validator seam — 候选 1（PR `ae0c558` 已合入 main）
- ✅ v0.8-2 — factory seam（`useAIStore` + `FileService` 去 window 全局）— 候选 2，Strong（已 commit `7ee6602`，待 PR）
- ✅ v0.8-3 — `connectError` 生命周期入 `useNodeGraph` — 候选 3，Worth exploring（已 commit `cb48666`，待 PR）

**v0.9+ 待做**
- ❌ Candidate 4（快捷键 + `isEditableTarget` 抽 seam）等 CardEditor 接入撤销再做
- ❌ Candidate 5（kinds registry 注入 `validateGraph`）等 v0.9 AI JSON Schema 决策
- ❌ **E1 卡牌接入节点编辑器**（v0.9，ADR-0006 已锁定形态）：Card = 完全同构 trigger→effect 链；Card 4 trigger（onPlay / onSelfDraw / onSelfExhaust / onSelfDiscard）；EFFECT_KINDS 共享注册表，Self 与 Owner 目标使用独立目标化 kind。Relic 的 Any/EventTarget 链路延后到 v0.10。
- ❌ AI 对话式迭代（多轮）
- ❌ AI 结构化输出（JSON Schema 校验）
- ❌ E2、E4-E8 实体编辑器（Character / Potion / Event / Enemy / Buff / UI）

**v1.0+**
- ❌ 一键发布 Steam Workshop

### 6.3 当前活跃主线

- **节点编辑器**：v0.6 数据层硬化 ✅ → v0.7 撤销 / 重做 ✅ → v0.9 接入 E1
- **架构清理**：v0.8-1 CardData seam ✅ → v0.8-2 factory seam ✅ → v0.8-3 connectError 入 hook ✅ → 等待 main 合入 → 评估 v0.9 起点

## 7. 修订记录

| 日期 | 变更 | 作者 |
|---|---|---|
| 2026-08-03 | v1.0 初始建立 | 用户 + Claude `/grill-with-docs` |
| 2026-08-06 | v1.1 同步到 v0.8-1 — 新增 §3.5 节点编辑器层 / 更新 §4 加 ADR-0005 / 重写 §6.1 全已实现清单 / 拆 §6.2 为 v0.8/v0.9/v1.0 三档 / 新增 §6.3 当前活跃主线 | Claude（基于 git log + 架构评审） |
| 2026-08-12 | v1.2 同步到 v0.8-3 — §3.5 加 ConnectError Lifecycle Seam / §4 评审候选进度更新到 3/5 / §6 状态日期更新 / §6.2 v0.8 三档全标 ✅ / §6.3 活跃主线补 v0.9 评估节点 | Claude（基于 commit `cb48666` + 架构评审进度） |
| 2026-08-12 | v1.3 同步 ADR-0006 — §4 加 v0.9 Card 节点 schema 决策 / §6.2 E1 加 ADR-0006 锁定形态 / 修订记录加 v1.3 行 | 用户 + Claude `/grill-with-docs`（4 Q 评审：同构性 / 表结构 / trigger 范围 / Self-Any 命名） |
| 2026-08-13 | v1.4 明确 Card 单一模型 — 基本属性与行为图属于同一张卡，v0.9 原位升级现有编辑流程，不引入“节点版 Card”平行概念 | 用户 + Codex `/grill-with-docs` |
| 2026-08-13 | v1.5 明确 Card ID — 创建时确定且不可变，名称仅用于展示，不再用列表位置或名称判断身份 | 用户 + Codex `/grill-with-docs` |
| 2026-08-13 | v1.6 明确项目源数据 — `.modstudio/` 是 Card 的权威来源，C# 仅为生成产物；反向解析只服务旧项目的一次性迁移 | 用户 + Codex `/grill-with-docs` |
| 2026-08-13 | v1.7 定义 Card 文档 — 每张 Card 的基本属性与行为图构成一个原子聚合；实体索引可从 Card 文档重建 | 用户 + Codex `/grill-with-docs` |
| 2026-08-13 | v1.8 定义生成未同步 — Card 文档保存优先；生成产物写入失败不回滚项目源数据，可随后重试生成 | 用户 + Codex `/grill-with-docs` |
| 2026-08-13 | v1.9 定义触发根 — 一张 Card 可包含多个不同触发入口，同一种 trigger 在该 Card 内唯一 | 用户 + Codex `/grill-with-docs` |
| 2026-08-13 | v1.10 定义效果分支归属 — 每个 effect 只从一个触发根可达；相同行为在不同分支中使用独立节点 | 用户 + Codex `/grill-with-docs` |
| 2026-08-13 | v1.11 定义效果链 — v0.9 每个触发根下只允许线性 effect 序列，连线本身表达执行顺序 | 用户 + Codex `/grill-with-docs` |
| 2026-08-13 | v1.12 区分 Card 草稿与可生成 Card — 草稿可写入项目源数据；仅完整语义校验通过后更新 C# | 用户 + Codex `/grill-with-docs` |
| 2026-08-13 | v1.13 定义迁移草稿 — 旧 Card 恢复基本属性并使用空行为图；用户完成新图前不覆盖旧 C# | 用户 + Codex `/grill-with-docs` |
| 2026-08-13 | v1.14 定义目标化 Effect Kind — effect 目标由 kind 唯一表达，删除节点级通用 `target` 覆盖 | 用户 + Codex `/grill-with-docs` |
| 2026-08-13 | v1.15 固化 effect 接收者词汇 — Self 指当前实体，Owner 指玩家/角色，EventTarget 指 trigger 事件对象 | 用户 + Codex `/grill-with-docs` |
| 2026-08-13 | v1.16 区分草稿自动保存与显式生成 — 编辑自动保存 Card 文档；用户主动生成且校验通过后才更新 C# | 用户 + Codex `/grill-with-docs` |
| 2026-08-13 | v1.17 定义 Card 编辑快照 — 表单与行为图共享同一撤销时间线；自动保存和生成不进入历史 | 用户 + Codex `/grill-with-docs` |
| 2026-08-13 | v1.18 定义编辑事务 — 连续输入按 750ms/失焦合并，一次拖动合并为一步，离散图操作各自成步 | 用户 + Codex `/grill-with-docs` |
| 2026-08-13 | v1.19 定义 AI 提案 — 完整候选 Card 先预览，确认后作为一个可撤销编辑事务应用，不自动生成 C# | 用户 + Codex `/grill-with-docs` |
| 2026-08-13 | v1.20 定义过期 AI 提案 — AI 请求绑定 Card revision；基线变化后提案只可查看，必须基于最新草稿重新生成 | 用户 + Codex `/grill-with-docs` |
| 2026-08-13 | v1.21 定义完整触发分支 — 草稿可保留空 trigger，但生成要求每个 trigger 后至少有一个 effect | 用户 + Codex `/grill-with-docs` |
| 2026-08-13 | v1.22 收紧 Card ID — 创建时确认 PascalCase ASCII 代码标识符，首次落盘后不可变，项目内忽略大小写唯一 | 用户 + Codex `/grill-with-docs` |
| 2026-08-13 | v1.23 定义 Card 回收站 — 删除时 Card 文档与生成产物一并移出活动目录，默认可恢复，恢复时重新检查 ID 冲突 | 用户 + Codex `/grill-with-docs` |
| 2026-08-13 | v1.24 定义原子删除 — 回收站写入与活动文件移除必须全部成功；失败时补偿恢复且 Card 保持活跃 | 用户 + Codex `/grill-with-docs` |
| 2026-08-13 | v1.25 定义保真只读恢复 — 未知 kind 或未来 schema 只隔离单张 Card，保留原始数据并禁止编辑、自动保存与生成 | 用户 + Codex `/grill-with-docs` |
| 2026-08-13 | v1.26 定义 Card Schema 迁移 — 已知旧版逐 Card、逐版本纯函数升级，写回前备份，失败则单 Card 只读隔离 | 用户 + Codex `/grill-with-docs` |
| 2026-08-13 | v1.27 定义生成语义哈希 — 只哈希影响 C# 的规范化 Card 语义，记录最近成功生成值以跨重启判断同步状态 | 用户 + Codex `/grill-with-docs` |
| 2026-08-13 | v1.28 定义生成指纹 — sourceHash 与 generatorVersion 共同判断同步；模板、emit 或 codegen 变化要求重新生成 | 用户 + Codex `/grill-with-docs` |
| 2026-08-13 | v1.29 定义批量生成报告 — 逐 Card 独立生成，草稿/只读项跳过，失败不阻塞其余项，最终汇总结果 | 用户 + Codex `/grill-with-docs` |
| 2026-08-13 | v1.30 定义测试预检 — 未生成草稿可排除，实际会加载的缺失/失败/过期 C# 默认阻止，并展示本次测试清单 | 用户 + Codex `/grill-with-docs` |
| 2026-08-13 | v1.31 定义产物哈希 — 生成后读取实际 C# 计算 artifactHash，发现外部修改时阻止测试与无提示覆盖 | 用户 + Codex `/grill-with-docs` |
| 2026-08-13 | v1.32 锁定 v0.9 范围 — 只交付 Card 端到端；Relic Any/EventTarget 设计保留但延后 v0.10，不注册半成品 kind | 用户 + Codex `/grill-with-docs` |
| 2026-08-13 | v1.33 锁定 v0.9 交付策略 — 内部按纵向切片小步提交且每步测试全绿，对用户在完整链路就绪后一次切换，不保留双轨实现 | 用户 + Codex `/grill-with-docs` |
| 2026-08-13 | v1.34 锁定 v0.9 验收门槛 — 自动化覆盖数据安全与真实文件集成，Electron 手工 smoke test 覆盖核心生命周期 | 用户 + Codex `/grill-with-docs` |
