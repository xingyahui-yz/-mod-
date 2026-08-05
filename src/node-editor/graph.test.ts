/**
 * 节点图数据模型测试 - 节点编辑器 v0.1 切片
 */
import { describe, it, expect } from 'vitest'
import {
  createEmptyGraph, appendNode, removeNode, moveNode,
  connect, disconnect, hasCycle,
  serialize, deserialize, isValidGraph,
  edgePath, getPortXY, NODE_WIDTH,
  buildNode, addNodeToGraph, touchGraph
} from './graph'
import { NodeGraph } from './types'

describe('createEmptyGraph', () => {
  it('返回空图 + 元数据', () => {
    const g = createEmptyGraph('relic-1', 'relic')
    expect(g.entityId).toBe('relic-1')
    expect(g.entityType).toBe('relic')
    expect(g.nodes).toHaveLength(0)
    expect(g.edges).toHaveLength(0)
    expect(g.version).toBe('0.1.0')
    expect(g.metadata.createdAt).toBeTruthy()
  })
})

describe('appendNode', () => {
  it('追加节点并返回新图 + 节点', () => {
    const g0 = createEmptyGraph('r', 'relic')
    const { graph, node } = appendNode(g0, 'trigger', { x: 10, y: 20 }, { event: 'onCombatStart' })

    expect(graph.nodes).toHaveLength(1)
    expect(node.id).toBeTruthy()
    expect(node.type).toBe('trigger')
    expect(node.position).toEqual({ x: 10, y: 20 })
    expect(node.data).toEqual({ event: 'onCombatStart' })
    // 原图不可变
    expect(g0.nodes).toHaveLength(0)
  })
})

describe('removeNode', () => {
  it('同时删除连接到该节点的边', () => {
    let g = createEmptyGraph('r', 'relic')
    const { graph: g1, node: n1 } = appendNode(g, 'trigger', { x: 0, y: 0 })
    g = g1
    const { graph: g2, node: n2 } = appendNode(g, 'effect', { x: 100, y: 0 })
    g = g2
    const c = connect(g, { nodeId: n1.id, port: 'out' }, { nodeId: n2.id, port: 'in' })
    expect(c.ok).toBe(true)
    if (!c.ok) return
    g = c.graph

    // 删除 n1 → 边也删除
    const g3 = removeNode(g, n1.id)
    expect(g3.nodes).toHaveLength(1)
    expect(g3.edges).toHaveLength(0)
  })

  // v0.6: 短路 —— 节点不存在则返回原图（同引用，不 touch metadata）
  it('节点不存在时短路返回原图（不 touch metadata）', () => {
    const g = createEmptyGraph('r', 'relic')
    const g2 = removeNode(g, 'nonexistent')
    expect(g2).toBe(g)  // 同引用 = 无操作 = 不 touch
  })
})

describe('moveNode', () => {
  it('更新节点位置', () => {
    let g = createEmptyGraph('r', 'relic')
    const { graph: g1, node } = appendNode(g, 'trigger', { x: 0, y: 0 })
    g = moveNode(g1, node.id, { x: 50, y: 60 })
    expect(g.nodes[0].position).toEqual({ x: 50, y: 60 })
  })

  it('节点不存在时静默返回原图', () => {
    const g = createEmptyGraph('r', 'relic')
    const g2 = moveNode(g, 'nonexistent', { x: 1, y: 1 })
    expect(g2).toEqual(g)
    expect(g2.nodes).toHaveLength(0)
  })
})

describe('connect - 连线校验', () => {
  function makeTwoNodes() {
    let g = createEmptyGraph('r', 'relic')
    const r1 = appendNode(g, 'trigger', { x: 0, y: 0 })
    g = r1.graph
    const t = r1.node
    const r2 = appendNode(g, 'effect', { x: 100, y: 0 })
    g = r2.graph
    const e = r2.node
    return { graph: g, trigger: t, effect: e }
  }

  it('合法连线成功', () => {
    const { graph, trigger, effect } = makeTwoNodes()
    const r = connect(graph, { nodeId: trigger.id, port: 'out' }, { nodeId: effect.id, port: 'in' })
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.graph.edges).toHaveLength(1)
  })

  it('自环被拒绝', () => {
    const { graph, trigger } = makeTwoNodes()
    const r = connect(graph, { nodeId: trigger.id, port: 'out' }, { nodeId: trigger.id, port: 'in' })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.reason).toMatch(/自身/)
  })

  it('源节点不存在', () => {
    const { graph, effect } = makeTwoNodes()
    const r = connect(graph, { nodeId: 'fake', port: 'out' }, { nodeId: effect.id, port: 'in' })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.reason).toMatch(/源节点/)
  })

  it('目标端口不存在', () => {
    const { graph, trigger, effect } = makeTwoNodes()
    const r = connect(graph, { nodeId: trigger.id, port: 'out' }, { nodeId: effect.id, port: 'bad' })
    expect(r.ok).toBe(false)
  })

  it('output 连 input 是合法的方向', () => {
    // 测试反向：把 input 端口当 source（应当被拒绝）
    const { graph, trigger, effect } = makeTwoNodes()
    const r = connect(graph, { nodeId: effect.id, port: 'in' }, { nodeId: trigger.id, port: 'out' })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.reason).toMatch(/源端口/)
  })

  it('重复连线被拒绝', () => {
    const { graph, trigger, effect } = makeTwoNodes()
    const c1 = connect(graph, { nodeId: trigger.id, port: 'out' }, { nodeId: effect.id, port: 'in' })
    if (!c1.ok) throw new Error('first connect should succeed')
    const c2 = connect(c1.graph, { nodeId: trigger.id, port: 'out' }, { nodeId: effect.id, port: 'in' })
    expect(c2.ok).toBe(false)
    if (!c2.ok) expect(c2.reason).toMatch(/已存在/)
  })

  // v0.6: 环检测（canConnect step 6）—— 反向连线成环被拒
  it('成环被 step 6 拒绝（effect → effect 反向闭合）', () => {
    let g = createEmptyGraph('r', 'relic')
    const r1 = appendNode(g, 'effect', { x: 0, y: 0 })
    g = r1.graph
    const e1 = r1.node
    const r2 = appendNode(g, 'effect', { x: 100, y: 0 })
    g = r2.graph
    const e2 = r2.node
    // 正向 e1.out → e2.in 成功
    const c1 = connect(g, { nodeId: e1.id, port: 'out' }, { nodeId: e2.id, port: 'in' })
    expect(c1.ok).toBe(true)
    if (!c1.ok) return
    // 反向 e2.out → e1.in 会形成 e1→e2→e1 闭环，被 step 6 拒绝
    const c2 = connect(c1.graph, { nodeId: e2.id, port: 'out' }, { nodeId: e1.id, port: 'in' })
    expect(c2.ok).toBe(false)
    if (!c2.ok) expect(c2.reason).toMatch(/环路/)
  })

  // v0.6: 多跳非环仍能加边（回归保护，防止环检测过激）
  it('多跳非环仍能加边（trigger → condition → effect）', () => {
    let g = createEmptyGraph('r', 'relic')
    const r1 = appendNode(g, 'trigger', { x: 0, y: 0 })
    g = r1.graph
    const t = r1.node
    const r2 = appendNode(g, 'condition', { x: 100, y: 0 })
    g = r2.graph
    const c = r2.node
    const r3 = appendNode(g, 'effect', { x: 200, y: 0 })
    g = r3.graph
    const e = r3.node
    // trigger.out → condition.in 成功
    const c1 = connect(g, { nodeId: t.id, port: 'out' }, { nodeId: c.id, port: 'in' })
    expect(c1.ok).toBe(true)
    if (!c1.ok) return
    // condition.true → effect.in 成功（多跳非环）
    const c2 = connect(c1.graph, { nodeId: c.id, port: 'true' }, { nodeId: e.id, port: 'in' })
    expect(c2.ok).toBe(true)
  })
})

describe('disconnect', () => {
  it('按 id 删除边', () => {
    let g = createEmptyGraph('r', 'relic')
    const { graph: g1, node: t } = appendNode(g, 'trigger', { x: 0, y: 0 })
    g = g1
    const { graph: g2, node: e } = appendNode(g, 'effect', { x: 100, y: 0 })
    g = g2
    const c = connect(g, { nodeId: t.id, port: 'out' }, { nodeId: e.id, port: 'in' })
    if (!c.ok) throw new Error('connect failed')
    g = c.graph
    const edgeId = g.edges[0].id
    const g3 = disconnect(g, edgeId)
    expect(g3.edges).toHaveLength(0)
  })

  // v0.6: 短路 —— 边不存在则返回原图（同引用，不 touch metadata）
  it('边不存在时短路返回原图（不 touch metadata）', () => {
    const g = createEmptyGraph('r', 'relic')
    const g2 = disconnect(g, 'nonexistent')
    expect(g2).toBe(g)
  })
})

describe('hasCycle', () => {
  it('无环返回 false', () => {
    let g = createEmptyGraph('r', 'relic')
    const { graph: g1, node: t } = appendNode(g, 'trigger', { x: 0, y: 0 })
    g = g1
    const { graph: g2, node: c } = appendNode(g, 'condition', { x: 100, y: 0 })
    g = g2
    const { graph: g3, node: e } = appendNode(g, 'effect', { x: 200, y: 0 })
    g = g3
    const c1 = connect(g, { nodeId: t.id, port: 'out' }, { nodeId: c.id, port: 'in' })
    if (!c1.ok) throw new Error('c1 failed')
    g = c1.graph
    const c2 = connect(g, { nodeId: c.id, port: 'true' }, { nodeId: e.id, port: 'in' })
    if (!c2.ok) throw new Error('c2 failed')

    expect(hasCycle(c2.graph)).toBe(false)
  })

  it('直接环返回 true', () => {
    let g = createEmptyGraph('r', 'relic')
    const { graph: g1, node: t } = appendNode(g, 'trigger', { x: 0, y: 0 })
    g = g1
    const { graph: g2, node: e } = appendNode(g, 'effect', { x: 100, y: 0 })
    g = g2
    // 绕过校验手动构造环（实际不会发生，但 hasCycle 应当能检测）
    const cyclic: NodeGraph = {
      ...g,
      edges: [
        { id: 'e1', from: { nodeId: t.id, port: 'out' }, to: { nodeId: e.id, port: 'in' } },
        { id: 'e2', from: { nodeId: e.id, port: 'out' }, to: { nodeId: t.id, port: 'in' } }
      ]
    }
    expect(hasCycle(cyclic)).toBe(true)
  })
})

describe('serialize / deserialize', () => {
  it('往返不丢失字段', () => {
    let g = createEmptyGraph('r', 'relic')
    const { graph: g1, node: t } = appendNode(g, 'trigger', { x: 5, y: 5 }, { foo: 'bar' })
    g = g1
    const { graph: g2, node: e } = appendNode(g, 'effect', { x: 50, y: 50 })
    g = g2
    const c = connect(g, { nodeId: t.id, port: 'out' }, { nodeId: e.id, port: 'in' })
    if (!c.ok) throw new Error('connect failed')
    g = c.graph

    const json = serialize(g)
    const restored = deserialize(json)
    expect(restored.nodes).toHaveLength(2)
    expect(restored.edges).toHaveLength(1)
    expect(restored.nodes[0].data).toEqual({ foo: 'bar' })
  })

  it('拒绝无效 JSON', () => {
    expect(() => deserialize('not json')).toThrow()
  })

  it('拒绝非图结构', () => {
    expect(() => deserialize('{"foo":1}')).toThrow()
  })
})

describe('isValidGraph', () => {
  it('接受合法图', () => {
    const g = createEmptyGraph('r', 'relic')
    expect(isValidGraph(g)).toBe(true)
  })
  it('拒绝 null/非对象', () => {
    expect(isValidGraph(null)).toBe(false)
    expect(isValidGraph(42)).toBe(false)
    expect(isValidGraph('string')).toBe(false)
  })
})

// ============================================================================
// v0.3: edgePath + getPortXY —— SVG 渲染用的几何助手
// ============================================================================

describe('getPortXY', () => {
  it('trigger 只有 output 端口，位于节点右边', () => {
    const xy = getPortXY({ id: 't', type: 'trigger', position: { x: 0, y: 0 }, data: {} }, 'out')
    expect(xy).toEqual({ x: NODE_WIDTH, y: 15 })
  })

  it('effect 的 input 端口位于节点左边', () => {
    const xy = getPortXY({ id: 'e', type: 'effect', position: { x: 0, y: 0 }, data: {} }, 'in')
    expect(xy).toEqual({ x: 0, y: 15 })
  })

  it('effect 的 output 端口位于节点右边且 y 更大', () => {
    const xy = getPortXY({ id: 'e', type: 'effect', position: { x: 0, y: 0 }, data: {} }, 'out')
    expect(xy).toEqual({ x: NODE_WIDTH, y: 27 })
  })

  it('condition 的 true/false 端口分别 y=27, 39', () => {
    const node = { id: 'c', type: 'condition' as const, position: { x: 0, y: 0 }, data: {} }
    // NODE_PORT_DEFS.condition: in(idx=0,y=15), true(idx=1,y=27), false(idx=2,y=39)
    expect(getPortXY(node, 'in')).toEqual({ x: 0, y: 15 })
    expect(getPortXY(node, 'true')).toEqual({ x: NODE_WIDTH, y: 27 })
    expect(getPortXY(node, 'false')).toEqual({ x: NODE_WIDTH, y: 39 })
  })

  it('未知端口 fallback 到 output 侧', () => {
    const xy = getPortXY({ id: 't', type: 'trigger', position: { x: 0, y: 0 }, data: {} }, 'unknown')
    expect(xy.x).toBe(NODE_WIDTH)
  })
})

describe('edgePath', () => {
  function buildPair() {
    let g = createEmptyGraph('r', 'relic')
    const { graph: g1, node: t } = appendNode(g, 'trigger', { x: 0, y: 0 })
    g = g1
    const { graph: g2, node: e } = appendNode(g, 'effect', { x: 100, y: 0 })
    g = g2
    const c = connect(g, { nodeId: t.id, port: 'out' }, { nodeId: e.id, port: 'in' })
    if (!c.ok) throw new Error('connect failed')
    return { graph: c.graph, trigger: t, effect: e, edge: c.graph.edges[0] }
  }

  it('从 output 端口 (右) 到 input 端口 (左)', () => {
    const { edge, trigger, effect } = buildPair()
    const d = edgePath(edge, trigger, effect)
    // 起点 = trigger 右边 = (120, 15)
    expect(d).toMatch(/^M 120 15 C /)
    // 终点 = effect 左边 = (100, 15)
    expect(d).toMatch(/, 100 15$/)
  })

  it('返回的 path 是有效的贝塞尔三次曲线字符串', () => {
    const { edge, trigger, effect } = buildPair()
    const d = edgePath(edge, trigger, effect)
    // M sx sy C cx1 cy1, cx2 cy2, tx ty
    expect(d.split(' ')).toHaveLength(10)
    expect(d.startsWith('M')).toBe(true)
    expect(d).toContain(' C ')
  })

  it('节点位置变化时 path 同步更新', () => {
    const { edge, trigger, effect } = buildPair()
    const moved = { ...trigger, position: { x: 50, y: 80 } }
    const d = edgePath(edge, moved, effect)
    expect(d).toContain('170')  // sx = 50 + 120
    expect(d).toContain('95')   // sy = 80 + 15
  })

  it('trigger→effect 水平距离 +40，控制点水平居中', () => {
    const { edge, trigger, effect } = buildPair()
    // effect 在 x=100, trigger 在 x=0, NODE_WIDTH=120
    // sx = 120, tx = 100, dx = -20
    // cx1 = 120 + (-20)*0.5 = 110, cx2 = 100 - (-20)*0.5 = 110
    const d = edgePath(edge, trigger, effect)
    expect(d).toContain('110 15') // cx1=cy1=110,15; cx2=cy2=110,15
  })
})

// ============================================================================
// v0.5.1: buildNode / addNodeToGraph / touchGraph —— 节点构造与图变更的
// 三个公开纯函数，appendNode 是它们的组合
// ============================================================================

describe('buildNode', () => {
  it('默认 id 是 UUID 格式', () => {
    const n = buildNode('trigger', { x: 0, y: 0 }, { event: 'onCombatStart' })
    expect(n.id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i)
    expect(n.type).toBe('trigger')
    expect(n.position).toEqual({ x: 0, y: 0 })
    expect(n.data).toEqual({ event: 'onCombatStart' })
  })

  it('传 id 时用传入的 id（v0.8 AI JSON Schema 路径）', () => {
    const n = buildNode('effect', { x: 1, y: 2 }, { kind: 'gainBuff' }, 'my-stable-id')
    expect(n.id).toBe('my-stable-id')
    expect(n.type).toBe('effect')
    expect(n.data).toEqual({ kind: 'gainBuff' })
  })

  it('data 默认空对象', () => {
    const n = buildNode('trigger', { x: 0, y: 0 })
    expect(n.data).toEqual({})
  })

  it('不连入图（纯构造）', () => {
    const n = buildNode('effect', { x: 0, y: 0 })
    // 单纯返回一个节点，不操作图
    expect(n.id).toBeTruthy()
    // type / position / data 已断言
  })
})

describe('addNodeToGraph', () => {
  it('追加节点到 nodes 末尾', () => {
    const g = createEmptyGraph('r', 'relic')
    const n = buildNode('effect', { x: 0, y: 0 })
    const g2 = addNodeToGraph(g, n)
    expect(g2.nodes).toHaveLength(1)
    expect(g2.nodes[0]).toEqual(n)
  })

  it('不修改原图（不可变）', () => {
    const g = createEmptyGraph('r', 'relic')
    const n = buildNode('effect', { x: 0, y: 0 })
    addNodeToGraph(g, n)
    expect(g.nodes).toHaveLength(0)
  })

  it('不动 metadata（updatedAt 不变）', () => {
    const g = createEmptyGraph('r', 'relic')
    const before = g.metadata.updatedAt
    const g2 = addNodeToGraph(g, buildNode('effect', { x: 0, y: 0 }))
    expect(g2.metadata.updatedAt).toBe(before)
  })

  it('保留 edges 不变', () => {
    // 构造：trigger→effect 已 connect，再 addNode 一个 effect
    let g = createEmptyGraph('r', 'relic')
    const { graph: g1, node: t } = appendNode(g, 'trigger', { x: 0, y: 0 }, { event: 'onCombatStart' })
    g = g1
    const { graph: g2, node: e } = appendNode(g, 'effect', { x: 100, y: 0 }, { kind: 'gainBuff' })
    g = g2
    const c = connect(g, { nodeId: t.id, port: 'out' }, { nodeId: e.id, port: 'in' })
    if (!c.ok) throw new Error('connect failed')
    g = c.graph
    const f = buildNode('effect', { x: 200, y: 0 }, { kind: 'loseHp' })
    const g3 = addNodeToGraph(g, f)
    expect(g3.edges).toEqual(g.edges)  // edges 不变
    expect(g3.nodes).toHaveLength(3)
  })
})

describe('touchGraph', () => {
  it('更新 updatedAt', async () => {
    const g = createEmptyGraph('r', 'relic')
    const before = g.metadata.updatedAt
    // 等 5ms 确保 new Date() 不同
    await new Promise(r => setTimeout(r, 5))
    const g2 = touchGraph(g)
    expect(g2.metadata.updatedAt).not.toBe(before)
    // 验证确实是新 ISO 字符串
    expect(new Date(g2.metadata.updatedAt).getTime()).toBeGreaterThan(new Date(before).getTime())
  })

  it('不动 nodes', () => {
    const g = createEmptyGraph('r', 'relic')
    const g2 = touchGraph(g)
    expect(g2.nodes).toEqual(g.nodes)
  })

  it('不动 edges', () => {
    const g = createEmptyGraph('r', 'relic')
    const g2 = touchGraph(g)
    expect(g2.edges).toEqual(g.edges)
  })

  it('保留 createdAt 不变', () => {
    const g = createEmptyGraph('r', 'relic')
    const g2 = touchGraph(g)
    expect(g2.metadata.createdAt).toBe(g.metadata.createdAt)
  })

  it('不修改原图（不可变）', () => {
    const g = createEmptyGraph('r', 'relic')
    const before = g.metadata.updatedAt
    touchGraph(g)
    expect(g.metadata.updatedAt).toBe(before)
  })
})