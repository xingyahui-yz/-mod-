/**
 * 节点图操作 - 纯函数 + 不依赖 React/DOM
 * 单元测试直接覆盖这些
 */
import {
  GraphNode, GraphEdge, NodeGraph, NodeType, EntityType, PortKind,
  NODE_PORT_DEFS
} from './types'
import { TRIGGER_KINDS, EFFECT_KINDS } from '../shared/kinds'

/** 节点尺寸（与 NodeGraphCanvas 共享） */
export const NODE_WIDTH = 120
export const NODE_HEIGHT = 60

/** 端口相对节点原点的坐标（x：input 在左，output 在右；y：按索引排列） */
export function getPortXY(node: GraphNode, portId: string): { x: number; y: number } {
  const ports = NODE_PORT_DEFS[node.type]
  const idx = ports.findIndex(p => p.id === portId)
  const port = ports[idx]
  const kind: PortKind = port?.kind ?? 'output'
  const x = kind === 'input' ? 0 : NODE_WIDTH
  const y = 15 + idx * 12
  return { x, y }
}

/** 计算一条边的 SVG path (贝塞尔曲线)
 *  - 从 from 节点 output 端口 出发
 *  - 到 to 节点 input 端口 结束
 *  - 控制点 = 水平方向的中点
 */
export function edgePath(edge: GraphEdge, fromNode: GraphNode, toNode: GraphNode): string {
  const fromLocal = getPortXY(fromNode, edge.from.port)
  const toLocal = getPortXY(toNode, edge.to.port)
  const sx = fromNode.position.x + fromLocal.x
  const sy = fromNode.position.y + fromLocal.y
  const tx = toNode.position.x + toLocal.x
  const ty = toNode.position.y + toLocal.y
  const dx = tx - sx
  const cx1 = sx + dx * 0.5
  const cy1 = sy
  const cx2 = tx - dx * 0.5
  const cy2 = ty
  return `M ${sx} ${sy} C ${cx1} ${cy1}, ${cx2} ${cy2}, ${tx} ${ty}`
}

/** 创建空图 */
export function createEmptyGraph(
  entityId: string,
  entityType: EntityType
): NodeGraph {
  const now = new Date().toISOString()
  return {
    id: crypto.randomUUID(),
    entityId,
    entityType,
    version: '0.1.0',
    nodes: [],
    edges: [],
    metadata: { createdAt: now, updatedAt: now }
  }
}

/**
 * 构造一个新节点（不连入图）。
 * id 不传时用 crypto.randomUUID()；传时直接用（v0.8 AI JSON Schema 路径）。
 * 纯函数，不依赖图状态。
 */
export function buildNode(
  type: NodeType,
  position: { x: number; y: number },
  data: Record<string, unknown> = {},
  id?: string
): GraphNode {
  return {
    id: id ?? crypto.randomUUID(),
    type,
    position,
    data
  }
}

/**
 * 把节点追加到图的 nodes 末尾，返回新图。
 * 不动 metadata（updatedAt 不变）。纯函数，不动原图。
 */
export function addNodeToGraph(graph: NodeGraph, node: GraphNode): NodeGraph {
  return {
    ...graph,
    nodes: [...graph.nodes, node]
  }
}

/**
 * 触碰图，返回 metadata.updatedAt 更新到当前时刻的新图。
 * 不动 nodes / edges；createdAt 保留。纯函数，不动原图。
 */
export function touchGraph(graph: NodeGraph): NodeGraph {
  return {
    ...graph,
    metadata: { ...graph.metadata, updatedAt: new Date().toISOString() }
  }
}

/**
 * 添加节点 - 返回新图与新节点。
 * 组合：buildNode + addNodeToGraph + touchGraph。
 */
export function appendNode(
  graph: NodeGraph,
  type: NodeType,
  position: { x: number; y: number },
  data: Record<string, unknown> = {},
  id?: string
): { graph: NodeGraph; node: GraphNode } {
  const node = buildNode(type, position, data, id)
  return {
    graph: touchGraph(addNodeToGraph(graph, node)),
    node
  }
}

/** 删除节点（同时删除连接到该节点的边）—— v0.6：节点不存在则短路返回原图 */
export function removeNode(graph: NodeGraph, nodeId: string): NodeGraph {
  if (!graph.nodes.some(n => n.id === nodeId)) return graph
  return touchGraph({
    ...graph,
    nodes: graph.nodes.filter(n => n.id !== nodeId),
    edges: graph.edges.filter(e => e.from.nodeId !== nodeId && e.to.nodeId !== nodeId),
  })
}

/** 移动节点 —— v0.6：节点不存在则短路返回原图 */
export function moveNode(
  graph: NodeGraph,
  nodeId: string,
  position: { x: number; y: number }
): NodeGraph {
  if (!graph.nodes.some(n => n.id === nodeId)) return graph
  return touchGraph({
    ...graph,
    nodes: graph.nodes.map(n =>
      n.id === nodeId ? { ...n, position } : n
    ),
  })
}

/** 校验连线合法性 */
export function canConnect(
  graph: NodeGraph,
  from: { nodeId: string; port: string },
  to: { nodeId: string; port: string }
): { ok: true } | { ok: false; reason: string } {
  // 1. 不允许自环
  if (from.nodeId === to.nodeId) {
    return { ok: false, reason: '不能连接节点自身' }
  }

  // 2. 节点必须存在
  const fromNode = graph.nodes.find(n => n.id === from.nodeId)
  const toNode = graph.nodes.find(n => n.id === to.nodeId)
  if (!fromNode) return { ok: false, reason: '源节点不存在' }
  if (!toNode) return { ok: false, reason: '目标节点不存在' }

  // 3. 端口必须存在且方向正确
  const fromPorts = NODE_PORT_DEFS[fromNode.type]
  const toPorts = NODE_PORT_DEFS[toNode.type]
  const fromPort = fromPorts.find(p => p.id === from.port)
  const toPort = toPorts.find(p => p.id === to.port)
  if (!fromPort) return { ok: false, reason: `源节点无端口 ${from.port}` }
  if (!toPort) return { ok: false, reason: `目标节点无端口 ${to.port}` }
  if (fromPort.kind !== 'output') return { ok: false, reason: '源端口必须是 output' }
  if (toPort.kind !== 'input') return { ok: false, reason: '目标端口必须是 input' }

  // 4. 数据类型必须兼容
  if (fromPort.dataType !== toPort.dataType && fromPort.dataType !== 'any' && toPort.dataType !== 'any') {
    return {
      ok: false,
      reason: `类型不兼容：${fromPort.dataType} → ${toPort.dataType}`
    }
  }

  // Card v0.9 的编辑态就是 trigger → 单链 effect；Relic 保留旧的
  // condition/branch 能力，避免改变现有实体的交互语义。
  if (graph.entityType === 'card') {
    const allowedOrder = (fromNode.type === 'trigger' && toNode.type === 'effect')
      || (fromNode.type === 'effect' && toNode.type === 'effect')
    if (!allowedOrder) {
      return { ok: false, reason: 'Card v0.9 只允许 trigger → effect → effect 的线性顺序' }
    }
    if (graph.edges.some(edge => edge.from.nodeId === from.nodeId)) {
      return { ok: false, reason: 'Card 节点只能有一条出边，不能创建分叉' }
    }
    if (graph.edges.some(edge => edge.to.nodeId === to.nodeId)) {
      return { ok: false, reason: 'Card 节点只能有一条入边，不能共享分支' }
    }
  }

  // 5. 不允许重复连线（同 from+to 视为重复）
  const dup = graph.edges.find(
    e => e.from.nodeId === from.nodeId && e.from.port === from.port
      && e.to.nodeId === to.nodeId && e.to.port === to.port
  )
  if (dup) return { ok: false, reason: '已存在相同连线' }

  // 6. 新增边后不允许成环（DAG 约束）—— v0.6
  //    hasCycle 只看 nodeId 拓扑，临时边 id 随意
  const candidate: NodeGraph = {
    ...graph,
    edges: [...graph.edges, { id: 'temp-cycle-check', from, to }]
  }
  if (hasCycle(candidate)) return { ok: false, reason: '连线将形成环路' }

  return { ok: true }
}

/** 添加边（自动校验） */
export function connect(
  graph: NodeGraph,
  from: { nodeId: string; port: string },
  to: { nodeId: string; port: string }
): { ok: true; graph: NodeGraph } | { ok: false; reason: string } {
  const check = canConnect(graph, from, to)
  if (!check.ok) return check
  const edge: GraphEdge = {
    id: crypto.randomUUID(),
    from,
    to
  }
  return {
    ok: true,
    graph: touchGraph({ ...graph, edges: [...graph.edges, edge] })
  }
}

/** 删除边 —— v0.6：边不存在则短路返回原图 */
export function disconnect(graph: NodeGraph, edgeId: string): NodeGraph {
  if (!graph.edges.some(e => e.id === edgeId)) return graph
  return touchGraph({
    ...graph,
    edges: graph.edges.filter(e => e.id !== edgeId),
  })
}

/** 检测环（BFS）- 节点图必须是有向无环图 */
export function hasCycle(graph: NodeGraph): boolean {
  const adj = new Map<string, string[]>()
  for (const node of graph.nodes) adj.set(node.id, [])
  for (const edge of graph.edges) {
    adj.get(edge.from.nodeId)?.push(edge.to.nodeId)
  }
  // 三色 DFS
  const WHITE = 0, GRAY = 1, BLACK = 2
  const color = new Map<string, number>()
  for (const n of graph.nodes) color.set(n.id, WHITE)

  function dfs(nodeId: string): boolean {
    color.set(nodeId, GRAY)
    for (const next of adj.get(nodeId) || []) {
      if (color.get(next) === GRAY) return true
      if (color.get(next) === WHITE && dfs(next)) return true
    }
    color.set(nodeId, BLACK)
    return false
  }
  for (const n of graph.nodes) {
    if (color.get(n.id) === WHITE && dfs(n.id)) return true
  }
  return false
}

/** 序列化 / 反序列化 */
export function serialize(graph: NodeGraph): string {
  return JSON.stringify(graph, null, 2)
}

export function deserialize(json: string): NodeGraph {
  const parsed = JSON.parse(json)
  const result = validateGraph(parsed)
  if (!result.ok) {
    throw new Error(`无效的 NodeGraph JSON: ${result.reason}`)
  }
  return result.graph
}

/** 详细校验结果 —— v0.6：含具体字段路径，便于 v0.8 AI 导入调试 */
export type GraphValidation =
  | { ok: true; graph: NodeGraph }
  | { ok: false; reason: string }

/**
 * 详细校验图数据 —— v0.6（最严 + 具体错误）
 *
 * 校验项：
 *  - 顶层 7 字段（id / entityId / entityType / version / nodes / edges / metadata）
 *  - metadata.createdAt / metadata.updatedAt 必须是字符串
 *  - 每个节点：id 字符串 + 全图唯一；type 在 NODE_PORT_DEFS；position.x/y 是数字；
 *    data 是对象；per-kind data：trigger.data.event / effect.data.kind 必须是字符串
 *  - 每条边：id 字符串；from/to.nodeId 引用存在的节点；from/to.port 在对应节点的
 *    NODE_PORT_DEFS 中存在；方向：from 是 output、to 是 input
 *
 * 失败时返回首个错误的字段路径（如 `nodes[2].position.x 必须是数字`）。
 */
export function validateGraph(obj: unknown): GraphValidation {
  if (!obj || typeof obj !== 'object') {
    return { ok: false, reason: 'graph 必须是对象' }
  }
  const g = obj as Record<string, unknown>

  // 顶层字段
  if (typeof g.id !== 'string') return { ok: false, reason: 'id 必须是字符串' }
  if (typeof g.entityId !== 'string') return { ok: false, reason: 'entityId 必须是字符串' }
  if (typeof g.entityType !== 'string') return { ok: false, reason: 'entityType 必须是字符串' }
  if (typeof g.version !== 'string') return { ok: false, reason: 'version 必须是字符串' }
  if (!Array.isArray(g.nodes)) return { ok: false, reason: 'nodes 必须是数组' }
  if (!Array.isArray(g.edges)) return { ok: false, reason: 'edges 必须是数组' }
  if (!g.metadata || typeof g.metadata !== 'object') {
    return { ok: false, reason: 'metadata 必须是对象' }
  }

  // metadata 形状
  const meta = g.metadata as Record<string, unknown>
  if (typeof meta.createdAt !== 'string') {
    return { ok: false, reason: 'metadata.createdAt 必须是字符串' }
  }
  if (typeof meta.updatedAt !== 'string') {
    return { ok: false, reason: 'metadata.updatedAt 必须是字符串' }
  }

  // 节点校验 + 重复 id
  const validNodeTypes = Object.keys(NODE_PORT_DEFS) as NodeType[]
  const nodeIds = new Set<string>()
  const nodeMap = new Map<string, Record<string, unknown>>()
  const nodesRaw = g.nodes as Array<unknown>
  for (let i = 0; i < nodesRaw.length; i++) {
    const n = nodesRaw[i]
    const prefix = `nodes[${i}]`
    if (!n || typeof n !== 'object') {
      return { ok: false, reason: `${prefix} 必须是对象` }
    }
    const node = n as Record<string, unknown>
    if (typeof node.id !== 'string') {
      return { ok: false, reason: `${prefix}.id 必须是字符串` }
    }
    if (nodeIds.has(node.id)) {
      return { ok: false, reason: `${prefix}.id "${node.id}" 重复` }
    }
    nodeIds.add(node.id)
    nodeMap.set(node.id, node)

    if (typeof node.type !== 'string' || !validNodeTypes.includes(node.type as NodeType)) {
      return {
        ok: false,
        reason: `${prefix}.type "${String(node.type)}" 必须是 ${validNodeTypes.join('/')} 之一`
      }
    }

    const pos = node.position as Record<string, unknown> | undefined
    if (!pos || typeof pos !== 'object') {
      return { ok: false, reason: `${prefix}.position 必须是对象` }
    }
    if (typeof pos.x !== 'number') {
      return { ok: false, reason: `${prefix}.position.x 必须是数字` }
    }
    if (typeof pos.y !== 'number') {
      return { ok: false, reason: `${prefix}.position.y 必须是数字` }
    }

    if (!node.data || typeof node.data !== 'object') {
      return { ok: false, reason: `${prefix}.data 必须是对象` }
    }

    // per-kind data 校验
    const data = node.data as Record<string, unknown>
    const nodeType = node.type as NodeType
    if (nodeType === 'trigger') {
      if (typeof data.event !== 'string') {
        return { ok: false, reason: `${prefix} (trigger) data.event 必须是字符串` }
      }
      // v0.9 (ADR-0006 §决策 §4): trigger.entity === graph.entityType
      const event = data.event as string
      const triggerKind = TRIGGER_KINDS[event]
      if (!triggerKind) {
        return { ok: false, reason: `${prefix} (trigger) event '${event}' 未注册` }
      }
      if (triggerKind.entity !== g.entityType) {
        return {
          ok: false,
          reason: `${prefix} (trigger) event '${event}' 不允许用于实体类型 '${String(g.entityType)}'（属于 '${triggerKind.entity}'）`
        }
      }
    } else if (nodeType === 'effect') {
      if (typeof data.kind !== 'string') {
        return { ok: false, reason: `${prefix} (effect) data.kind 必须是字符串` }
      }
      const effectKind = EFFECT_KINDS[data.kind]
      if (!effectKind) {
        return { ok: false, reason: `${prefix} (effect) kind '${data.kind}' 未注册` }
      }
      if (effectKind.entity && effectKind.entity !== g.entityType) {
        return { ok: false, reason: `${prefix} (effect) kind '${data.kind}' 不允许用于实体类型 '${String(g.entityType)}'` }
      }
    }
    // condition / branch 不要求 data 特定字段
  }

  // 边校验
  const edgesRaw = g.edges as Array<unknown>
  for (let i = 0; i < edgesRaw.length; i++) {
    const e = edgesRaw[i]
    const prefix = `edges[${i}]`
    if (!e || typeof e !== 'object') {
      return { ok: false, reason: `${prefix} 必须是对象` }
    }
    const edge = e as Record<string, unknown>
    if (typeof edge.id !== 'string') {
      return { ok: false, reason: `${prefix}.id 必须是字符串` }
    }

    const from = edge.from as Record<string, unknown> | undefined
    const to = edge.to as Record<string, unknown> | undefined
    if (!from || typeof from !== 'object') {
      return { ok: false, reason: `${prefix}.from 必须是对象` }
    }
    if (!to || typeof to !== 'object') {
      return { ok: false, reason: `${prefix}.to 必须是对象` }
    }
    if (typeof from.nodeId !== 'string' || !nodeIds.has(from.nodeId)) {
      return {
        ok: false,
        reason: `${prefix}.from.nodeId "${String(from.nodeId)}" 指向不存在的节点`
      }
    }
    if (typeof to.nodeId !== 'string' || !nodeIds.has(to.nodeId)) {
      return {
        ok: false,
        reason: `${prefix}.to.nodeId "${String(to.nodeId)}" 指向不存在的节点`
      }
    }
    if (typeof from.port !== 'string') {
      return { ok: false, reason: `${prefix}.from.port 必须是字符串` }
    }
    if (typeof to.port !== 'string') {
      return { ok: false, reason: `${prefix}.to.port 必须是字符串` }
    }

    // 端口存在性 + 方向校验（按 NODE_PORT_DEFS）
    const fromNode = nodeMap.get(from.nodeId as string)!
    const toNode = nodeMap.get(to.nodeId as string)!
    const fromPorts = NODE_PORT_DEFS[fromNode.type as NodeType]
    const toPorts = NODE_PORT_DEFS[toNode.type as NodeType]
    const fromPort = fromPorts.find(p => p.id === from.port)
    const toPort = toPorts.find(p => p.id === to.port)

    if (!fromPort) {
      return {
        ok: false,
        reason: `${prefix}.from.port "${from.port}" 在 ${fromNode.type} 上不存在`
      }
    }
    if (!toPort) {
      return {
        ok: false,
        reason: `${prefix}.to.port "${to.port}" 在 ${toNode.type} 上不存在`
      }
    }
    if (fromPort.kind !== 'output') {
      return {
        ok: false,
        reason: `${prefix}.from.port "${from.port}" 必须是 output，实际是 ${fromPort.kind}`
      }
    }
    if (toPort.kind !== 'input') {
      return {
        ok: false,
        reason: `${prefix}.to.port "${to.port}" 必须是 input，实际是 ${toPort.kind}`
      }
    }
  }

  // 结构层保证图是 DAG；是否满足某个实体的业务链规则由上层语义校验负责。
  if (hasCycle(g as unknown as NodeGraph)) {
    return { ok: false, reason: 'edges 将形成环路' }
  }

  return { ok: true, graph: g as unknown as NodeGraph }
}

/** 快速 boolean 检查（向后兼容）—— 等价于 validateGraph(obj).ok */
export function isValidGraph(obj: unknown): obj is NodeGraph {
  return validateGraph(obj).ok
}
