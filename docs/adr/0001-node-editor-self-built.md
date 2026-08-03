# ADR-0001：节点编辑器自研

> 状态：已接受 · 日期：2026-08-03 · 来源：`/grill-with-docs` 会话

## 背景（Context）

Mod Studio 最终形态覆盖 8 类 STS2 实体（卡牌、角色、遗物、药水、事件、敌人、Buff、UI），其中至少 4 类（遗物、事件、敌人、Buff）**必须用节点图表达复杂逻辑**——这些实体的行为不能简化为表单字段。

AI 辅助生成能力要求 AI 能**输出完整的节点图**（结构化 JSON），用户和 AI 协作完成节点编辑。

## 决策（Decision）

**节点编辑器自研，不引入第三方节点编辑器库**（如 react-flow、rete.js、drawflow 等）。

## 备选方案（Alternatives Considered）

### 备选 A：引入 react-flow

- **优点**：成熟、文档全、社区活跃、能快速跑通原型
- **缺点**：
  - 体积大（gzip 后约 100KB+），会显著增加 Electron 包体积
  - 节点类型系统与 STS2 领域耦合度低，需要写大量"适配层"代码
  - 样式定制困难（节点编辑器库通常锁死视觉风格）
  - AI 结构化输出与库的数据模型不匹配，需要双向转换

### 备选 B：基于 Rete.js v2

- **优点**：纯框架，比 react-flow 更轻量、更可定制
- **缺点**：
  - 文档相对薄弱
  - 同样存在数据模型适配问题
  - 社区规模比 react-flow 小

### 备选 C：自研（已选）

- **优点**：
  - 数据模型**从一开始就是 STS2 领域对象**，不需要适配层
  - AI 输出（结构化 JSON）**直接就是节点的内部表示**
  - 体积可控（预计 gzip 后 < 30KB）
  - 视觉风格与 Mod Studio 整体一致
  - 长期维护成本可控（节点编辑器核心逻辑约 500-1000 行）
- **缺点**：
  - 开发周期长（自研需要 4-6 周）
  - 缺少现成的边/重排/缩放等"轮子"——需自己实现
  - 一开始可能不如成熟库好用

## 后果（Consequences）

### 正面
- 节点数据结构 = AI 输出结构 = STS2 编译产物生成的中间表示——**三层数据模型统一**
- 整个项目的依赖图简化，少一个外部依赖
- 长期可演进（不会被库的设计决策束缚）

### 负面
- 必须投入 4-6 周开发节点编辑器**基础能力**（拖拽、连线、缩放、保存/加载、撤销/重做）
- 不能"借力"开源社区的修复
- 必须自己做键盘无障碍、触屏支持等（成熟库已经做了）

## 节点数据结构（草案）

```typescript
interface NodeGraph {
  id: string
  entityId: string              // 关联到实体
  entityType: 'relic' | 'event' | 'enemy' | 'buff'
  nodes: GraphNode[]
  edges: GraphEdge[]
  metadata: {
    version: string             // schema 版本，便于迁移
    createdAt: string
    updatedAt: string
  }
}

interface GraphNode {
  id: string
  type: 'trigger' | 'condition' | 'effect' | 'delay' | 'branch'  // 节点类型
  position: { x: number; y: number }
  data: Record<string, unknown>  // 类型特定数据
}

interface GraphEdge {
  id: string
  from: { nodeId: string; port: string }
  to: { nodeId: string; port: string }
}
```

## 验证（Validation）

- [ ] 节点编辑器 MVP 能在 4 周内跑通（拖拽、连线、保存、加载）
- [ ] AI 能在结构化 prompt 下输出符合 `NodeGraph` schema 的 JSON
- [ ] 至少 1 个实体（建议 Relic）端到端走通"AI 生成节点图 → 渲染为 Godot 代码"

## 修订记录

| 日期 | 变更 |
|---|---|
| 2026-08-03 | v1.0 初始建立 |
