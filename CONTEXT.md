# Mod Studio 领域模型（CONTEXT）

> 最后更新：2026-08-03 · 来源：`/grill-with-docs` 会话
> 状态：v1.0 — 由项目所有者与 Claude 通过 grilling 工作流达成共识

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

## 6. 当前状态（截至 2026-08-03）

### 6.1 已实现
- ✅ E1 卡牌（表单 + AI 单次生成）
- ✅ Electron + React + TypeScript + Zustand 技术栈
- ✅ Mustache 模板 → C# 代码生成
- ✅ HTTP LLM 适配器（4 provider：MiniMax / 通义千问 / 文心一言 / ChatGLM）
- ✅ 8 步新手教程 + 6 步任务引导
- ✅ 129 个单元 / 集成 / 组件测试
- ✅ Git 仓库已建立

### 6.2 未实现（待开发）
- ❌ E2-E8 实体编辑器（除 E1 外）
- ❌ 节点编辑器（自研）
- ❌ AI 对话式迭代（多轮）
- ❌ AI 结构化输出（JSON Schema 校验）
- ❌ 一键发布 Steam Workshop

## 7. 修订记录

| 日期 | 变更 | 作者 |
|---|---|---|
| 2026-08-03 | v1.0 初始建立 | 用户 + Claude `/grill-with-docs` |
