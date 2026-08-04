/**
 * 节点图操作 - 纯函数 + 不依赖 React/DOM
 * 单元测试直接覆盖这些
 */
import {
  GraphNode, GraphEdge, NodeGraph, NodeType, EntityType, PortKind,
  NODE_PORT_DEFS
} from './types'

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

/** 删除节点（同时删除连接到该节点的边） */
export function removeNode(graph: NodeGraph, nodeId: string): NodeGraph {
  return touchGraph({
    ...graph,
    nodes: graph.nodes.filter(n => n.id !== nodeId),
    edges: graph.edges.filter(e => e.from.nodeId !== nodeId && e.to.nodeId !== nodeId),
  })
}

/** 移动节点 */
export function moveNode(
  graph: NodeGraph,
  nodeId: string,
  position: { x: number; y: number }
): NodeGraph {
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

  // 5. 不允许重复连线（同 from+to 视为重复）
  const dup = graph.edges.find(
    e => e.from.nodeId === from.nodeId && e.from.port === from.port
      && e.to.nodeId === to.nodeId && e.to.port === to.port
  )
  if (dup) return { ok: false, reason: '已存在相同连线' }

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

/** 删除边 */
export function disconnect(graph: NodeGraph, edgeId: string): NodeGraph {
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
  if (!isValidGraph(parsed)) {
    throw new Error('无效的 NodeGraph JSON')
  }
  return parsed
}

/** Schema 校验 - 完整但不严格（接受任意 data） */
export function isValidGraph(obj: unknown): obj is NodeGraph {
  if (!obj || typeof obj !== 'object') return false
  const g = obj as Record<string, unknown>
  return (
    typeof g.id === 'string' &&
    typeof g.entityId === 'string' &&
    typeof g.entityType === 'string' &&
    typeof g.version === 'string' &&
    Array.isArray(g.nodes) &&
    Array.isArray(g.edges) &&
    typeof g.metadata === 'object'
  )
}
