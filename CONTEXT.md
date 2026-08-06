# Mod Studio 领域模型（CONTEXT）

> 最后更新：2026-08-06 · 来源：v0.5.2 → v0.8 实施 + 架构评审
> 状态：v1.1 — 由项目所有者与 Claude 通过开发迭代同步

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
- **节点图（Node Graph）**：用图形化节点表达复杂逻辑的有向无环图
- **AI 对话（AI Conversation）**：用户与 LLM 的多轮交互历史

### 3.2 编辑器层
- **表单（Form）**：键值对编辑界面
- **预览（Preview）**：实时展示 C# / GDScript 代码或游戏内效果
- **生成（Generate）**：从 `.modstudio/` 元数据 → 编译产物（`.cs` / `.gd`）
- **同步（Sync）**：保持 `.modstudio/` 元数据与编译产物一致

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

### 3.3 AI 层
- **Prompt 模板（Prompt Template）**：每个实体类型对应的结构化 prompt
- **结构化输出（Structured Output）**：LLM 返回的 JSON Schema 校验过的对象
- **对话历史（Conversation History）**：保留多轮对话的上下文

## 4. 核心架构决策

完整 ADR 见 `docs/adr/`。本节为概览：

- **ADR-0001**：节点编辑器自研（不引入 react-flow）
- **ADR-0002**：AI 输出结构化 JSON（不解析自然语言）
- **ADR-0003**：本地文件夹项目结构（不云端）
- **ADR-0004**：多 mod 模式（用户管理多个项目）
- **ADR-0005**：节点编辑器撤销 / 重做 — History Stack（不可变快照），不采用 Command Pattern

非 ADR 但已沉淀的决策：

- **`/improve-codebase-architecture` 评审 5 候选**（2026-08-06）：[docs/architecture-review-2026-08-06.md](./docs/architecture-review-2026-08-06.md)。Candidate 1（CardData 单 validator）已在 v0.8-1 实施；Candidate 2（factory seam）在 v0.8-2 计划中。

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
    ├── entities.json           ← 8 类实体的结构化数据索引
    ├── nodes/                  ← 各实体的节点图（JSON）
    └── ai-history/             ← AI 对话历史（按实体 ID 组织）
```

## 6. 当前状态（截至 2026-08-06，v0.8-1 合入 main）

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
- ⏳ v0.8-2 — factory seam（`useAIStore` + `FileService` 去 window 全局）— 候选 2，Strong
- ⏳ v0.8-3 — `connectError` 生命周期入 `useNodeGraph` — 候选 3，Worth exploring

**v0.9+ 待做**
- ❌ Candidate 4（快捷键 + `isEditableTarget` 抽 seam）等 CardEditor 接入撤销再做
- ❌ Candidate 5（kinds registry 注入 `validateGraph`）等 v0.9 AI JSON Schema 决策
- ❌ **E1 卡牌接入节点编辑器**（v0.9）：卡片目前只有表单，接入节点编辑器后支持 trigger / effect 节点 — 同时是 AI JSON Schema 落地的载体
- ❌ AI 对话式迭代（多轮）
- ❌ AI 结构化输出（JSON Schema 校验）
- ❌ E2、E4-E8 实体编辑器（Character / Potion / Event / Enemy / Buff / UI）

**v1.0+**
- ❌ 一键发布 Steam Workshop

### 6.3 当前活跃主线

- **节点编辑器**：v0.6 数据层硬化 ✅ → v0.7 撤销 / 重做 ✅ → v0.9 接入 E1
- **架构清理**：v0.8-1 CardData seam ✅ → v0.8-2 factory seam → v0.8-3 connectError 入 hook

## 7. 修订记录

| 日期 | 变更 | 作者 |
|---|---|---|
| 2026-08-03 | v1.0 初始建立 | 用户 + Claude `/grill-with-docs` |
| 2026-08-06 | v1.1 同步到 v0.8-1 — 新增 §3.5 节点编辑器层 / 更新 §4 加 ADR-0005 / 重写 §6.1 全已实现清单 / 拆 §6.2 为 v0.8/v0.9/v1.0 三档 / 新增 §6.3 当前活跃主线 | Claude（基于 git log + 架构评审） |
