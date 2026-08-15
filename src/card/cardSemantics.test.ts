import { describe, expect, it } from 'vitest'
import { appendNode, connect, createEmptyGraph } from '../node-editor/graph'
import type { NodeGraph } from '../node-editor/types'
import { validateCardGraph } from './cardSemantics'

function makeCardGraph(): NodeGraph {
  return createEmptyGraph('Fireball', 'card')
}

function addTrigger(graph: NodeGraph, event = 'onPlay') {
  return appendNode(graph, 'trigger', { x: 0, y: 0 }, { event })
}

function addEffect(graph: NodeGraph, kind = 'exhaustSelf', data: Record<string, unknown> = {}) {
  return appendNode(graph, 'effect', { x: 120, y: 0 }, { kind, ...data })
}

function link(graph: NodeGraph, from: string, to: string, fromPort = 'out', toPort = 'in') {
  const result = connect(graph, { nodeId: from, port: fromPort }, { nodeId: to, port: toPort })
  if (!result.ok) throw new Error(result.reason)
  return result.graph
}

describe('validateCardGraph', () => {
  it('空图可作为草稿保存，但不是可生成 Card', () => {
    const result = validateCardGraph(makeCardGraph())
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.issues[0].code).toBe('missing-trigger')
  })

  it('要求每个 trigger 具有至少一个 effect，并拒绝重复 trigger', () => {
    let graph = makeCardGraph()
    const first = addTrigger(graph, 'onPlay')
    graph = first.graph
    const second = addTrigger(graph, 'onPlay')
    graph = second.graph
    const effect = addEffect(graph)
    graph = link(effect.graph, first.node.id, effect.node.id)

    const result = validateCardGraph(graph)
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.issues.map(issue => issue.code)).toContain('duplicate-trigger')
      expect(result.issues.map(issue => issue.code)).toContain('empty-trigger')
    }
  })

  it('要求每个 effect 只属于一条线性分支，且不允许孤立节点', () => {
    let graph = makeCardGraph()
    const trigger = addTrigger(graph)
    graph = trigger.graph
    const first = addEffect(graph, 'exhaustSelf')
    graph = first.graph
    const second = addEffect(graph, 'discardSelf')
    graph = second.graph
    const orphan = addEffect(graph, 'exhaustSelf')
    graph = orphan.graph
    graph = link(graph, trigger.node.id, first.node.id)
    graph = link(graph, first.node.id, second.node.id)

    const result = validateCardGraph(graph)
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.issues.map(issue => issue.code)).toContain('orphan-node')
    }
  })

  it('拒绝分叉、共享 effect 和跨实体 graph', () => {
    let graph = makeCardGraph()
    const firstTrigger = addTrigger(graph, 'onPlay')
    graph = firstTrigger.graph
    const secondTrigger = addTrigger(graph, 'onSelfDraw')
    graph = secondTrigger.graph
    const effect = addEffect(graph)
    graph = effect.graph
    graph = link(graph, firstTrigger.node.id, effect.node.id)
    graph = {
      ...graph,
      edges: [...graph.edges, { id: 'shared', from: { nodeId: secondTrigger.node.id, port: 'out' }, to: { nodeId: effect.node.id, port: 'in' } }],
    }

    const splitEffect = addEffect(graph, 'discardSelf')
    graph = splitEffect.graph
    graph = {
      ...graph,
      edges: [...graph.edges, { id: 'split', from: { nodeId: firstTrigger.node.id, port: 'out' }, to: { nodeId: splitEffect.node.id, port: 'in' } }],
    }

    const result = validateCardGraph({ ...graph, entityType: 'relic' })
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.issues.map(issue => issue.code)).toContain('wrong-entity')
      expect(result.issues.map(issue => issue.code)).toContain('branching')
    }
  })

  it('检查 effect 参数并接受已注册的固定 receiver 元数据', () => {
    let graph = makeCardGraph()
    const trigger = addTrigger(graph)
    graph = trigger.graph
    const effect = addEffect(graph, 'addCardToHand', { cardId: '' })
    graph = link(effect.graph, trigger.node.id, effect.node.id)

    const result = validateCardGraph(graph)
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.issues.map(issue => issue.code)).toContain('invalid-parameters')
      expect(result.issues.map(issue => issue.code)).not.toContain('invalid-receiver')
    }
  })

  it('完整的多 trigger 线性 Card 通过', () => {
    let graph = makeCardGraph()
    const firstTrigger = addTrigger(graph, 'onPlay')
    graph = firstTrigger.graph
    const firstEffect = addEffect(graph, 'exhaustSelf')
    graph = link(firstEffect.graph, firstTrigger.node.id, firstEffect.node.id)
    const secondTrigger = addTrigger(graph, 'onSelfDraw')
    graph = secondTrigger.graph
    const secondEffect = addEffect(graph, 'drawCards', { amount: 2 })
    graph = link(secondEffect.graph, secondTrigger.node.id, secondEffect.node.id)

    expect(validateCardGraph(graph)).toEqual({ ok: true })
  })
})
