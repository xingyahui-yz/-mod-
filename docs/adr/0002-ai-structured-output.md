# ADR-0002：AI 输出结构化 JSON

> 状态：已接受 · 日期：2026-08-03 · 来源：`/grill-with-docs` 会话

## 背景（Context）

Mod Studio 最终形态中，AI 是用户**生成所有 8 类实体的核心工具**。当前实现（E1 卡牌）采用"自然语言 prompt → LLM → 自然语言响应 → 正则解析"的方式，已经暴露出三个问题：

1. **脆弱**：LLM 返回稍微带点 markdown（```json ... ```）就解析失败
2. **不可控**：无法约束 LLM 输出符合前端 UI 期望的字段
3. **难迭代**：多轮对话时，前一轮的"卡片信息"是自然语言，重新喂给 LLM 时容易丢失结构

特别地，**节点编辑器要求 AI 输出完整的节点图**（参考 ADR-0001）——节点图是结构化数据，不可能用自然语言表达。

## 决策（Decision）

**AI 输出统一采用结构化 JSON**，通过 JSON Schema 在调用时强制约束 LLM 输出格式。

每个实体类型（E1-E8）**必须定义**：
- 输入 prompt 模板（含上下文占位符）
- 输出 JSON Schema
- TypeScript 类型定义（与 schema 同步）

## 备选方案（Alternatives Considered）

### 备选 A：保持现有方案（自然语言 + 正则解析）

- **优点**：实现简单，4 个 prompt 模板就够了
- **缺点**：
  - 8 类实体 × 4 provider = 32 个 prompt 模板，每类都要写"解析器"，维护成本爆炸
  - 节点图根本不能用正则解析
  - 用户改一次实体，AI 重新生成时容易丢字段

### 备选 B：Function Calling / Tool Use（OpenAI 风格）

- **优点**：LLM 原生支持结构化输出
- **缺点**：
  - 只有部分 LLM 支持（OpenAI 完整支持、Anthropic 支持、MiniMax 部分支持、国产 4 家支持度参差）
  - 需要写"工具定义"——又是另一套抽象
  - 与节点编辑器的数据结构**依然需要适配层**

### 备选 C：结构化 JSON + JSON Schema 约束（已选）

- **优点**：
  - **4 家 LLM 全部支持**（OpenAI 兼容的 `response_format: { type: "json_schema" }`）
  - 数据结构 = UI 数据结构 = 节点图数据结构 = 持久化数据结构——**四层统一**
  - 单元测试可针对 schema 写——LLM 输出可直接断言
  - 用户在 AI 对话中改字段，下一轮的"上下文"就是上一轮的结构化 JSON——**不会丢字段**
- **缺点**：
  - 需要为每类实体写 JSON Schema（首次成本）
  - JSON Schema 校验失败的错误信息对用户不友好
  - LLM 在 schema 复杂时偶发"幻觉字段"——需要后置校验

## 后果（Consequences）

### 正面
- 节点图数据**直接来自 AI**——零转换
- 测试可断言 LLM 输出的字段、类型、必需性
- 多轮对话上下文 = 上一轮结构化输出，**稳定可靠**
- 后端 FileService / 节点编辑器 / AI 三层**共享同一份 TypeScript 类型**

### 负面
- 8 类实体 × JSON Schema 编写 + 维护（~200 行 schema/类）
- 必须实现"JSON Schema 校验 + 友好错误信息"——新增工具函数
- LLM provider 的 JSON Schema 支持有差异——需要封装适配

## 设计要点

### 通用结构

```typescript
// 每类实体的 AI 调用都返回这个结构
interface AIEntityResponse<T> {
  success: boolean
  entity: T | null           // 校验后的实体
  schemaViolations: string[]  // 校验失败的字段（用于提示用户）
  raw: string                 // 原始 LLM 输出（用于调试）
  provider: string
  model: string
}
```

### 8 类实体的 schema 字段（草案）

| 实体 | 核心 schema 字段 |
|---|---|
| E1 卡牌 | name, cost, type, rarity, description, keywords, effectNodeGraph? |
| E2 角色 | name, archetype, hp, startingCards[], startingRelics[], passiveNodeGraph? |
| E3 遗物 | name, rarity, trigger, effectNodeGraph |
| E4 药水 | name, rarity, effect |
| E5 事件 | name, condition, choices[{text, outcomeNodeGraph}] |
| E6 敌人 | name, hp, intents[], behaviorNodeGraph |
| E7 Buff | name, trigger, duration, modifiers[], stackBehavior, effectNodeGraph |
| E8 UI | cardName, artUrl, description |

### Prompt 模板结构

```
[系统] 你是 STS2 mod 设计师，输出必须严格符合 JSON Schema。
[用户] 用户想要：{userDescription}
       上下文：{context}            ← 上一轮结构化输出
       偏好：{preferences}
       Schema：{jsonSchema}         ← 注入到 prompt 中
```

## 验证（Validation）

- [ ] 8 类实体的 JSON Schema 全部定义完成
- [ ] 4 个 LLM provider 全部支持结构化输出（或回退到 "JSON 模式 + 后置 schema 校验"
- [ ] 单元测试覆盖每类实体的 schema 校验
- [ ] E1 卡牌升级到结构化输出后，原有 86 个测试仍然通过

## 修订记录

| 日期 | 变更 |
|---|---|
| 2026-08-03 | v1.0 初始建立 |
