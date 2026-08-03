/**
 * 节点编辑器数据模型（v0.1 切片）
 *
 * 这是 STS2 mod 节点图的"真理来源"——
 *  - UI 状态从这里读
 *  - AI 输出必须符合这个 schema（参考 ADR-0002）
 *  - Godot 代码生成器从这里读
 *
 * 设计原则：
 *  - 节点是"无类型"容器：type 字段是字符串，data 是 Record
 *  - 类型系统的"约束"由上层（每种 EntityType）决定，不由本层强制
 *  - 边是有向的，from→to，单向；不允许自环
 */

export type EntityType = 'card' | 'character' | 'relic' | 'potion' | 'event' | 'enemy' | 'buff' | 'ui'

/** v0.1 支持的节点类型（持续扩展） */
export type NodeType = 'trigger' | 'condition' | 'effect' | 'branch'

/** 节点的端口：data 输入 / output */
export type PortKind = 'input' | 'output'

/** 端口定义（一个节点可声明多个） */
export interface PortDef {
  id: string             // 节点内唯一，例如 'in' / 'out' / 'then' / 'else'
  label: string          // UI 显示
  kind: PortKind
  /** 数据类型（用于校验连线是否合法） */
  dataType: 'flow' | 'bool' | 'number' | 'string' | 'any'
}

export interface GraphNode {
  id: string             // 节点图内唯一，UUID
  type: NodeType
  position: { x: number; y: number }
  /** 类型特定的数据，例如 effect 节点的 'amount' */
  data: Record<string, unknown>
}

export interface GraphEdge {
  id: string
  from: { nodeId: string; port: string }
  to: { nodeId: string; port: string }
}

export interface NodeGraph {
  id: string
  entityId: string
  entityType: EntityType
  version: string                // schema 版本，便于迁移
  nodes: GraphNode[]
  edges: GraphEdge[]
  metadata: {
    createdAt: string            // ISO
    updatedAt: string
  }
}

/** 每种节点类型的端口声明（UI 渲染 + 连线校验用） */
export const NODE_PORT_DEFS: Record<NodeType, PortDef[]> = {
  trigger: [
    { id: 'out', label: '触发', kind: 'output', dataType: 'flow' }
  ],
  condition: [
    { id: 'in', label: '进入', kind: 'input', dataType: 'flow' },
    { id: 'true', label: '是', kind: 'output', dataType: 'flow' },
    { id: 'false', label: '否', kind: 'output', dataType: 'flow' }
  ],
  effect: [
    { id: 'in', label: '进入', kind: 'input', dataType: 'flow' },
    { id: 'out', label: '执行', kind: 'output', dataType: 'flow' }
  ],
  branch: [
    { id: 'in', label: '进入', kind: 'input', dataType: 'flow' },
    { id: 'out', label: '出', kind: 'output', dataType: 'flow' }
  ]
}
