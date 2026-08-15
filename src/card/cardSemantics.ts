import { validateGraph } from '../node-editor/graph'
import type { GraphEdge, GraphNode, NodeGraph } from '../node-editor/types'
import { EFFECT_KINDS, TRIGGER_KINDS } from '../shared/kinds'
import { isValidCardId } from './cardValidation'

export type CardSemanticIssueCode =
  | 'invalid-structure'
  | 'wrong-entity'
  | 'card-id-mismatch'
  | 'missing-trigger'
  | 'duplicate-trigger'
  | 'empty-trigger'
  | 'unsupported-node'
  | 'branching'
  | 'shared-effect'
  | 'orphan-node'
  | 'invalid-parameters'
  | 'invalid-receiver'

export interface CardSemanticIssue {
  code: CardSemanticIssueCode
  message: string
  nodeId?: string
  event?: string
  kind?: string
}

export type CardGraphValidation =
  | { ok: true }
  | { ok: false; issues: CardSemanticIssue[] }

const CARD_RECEIVERS = new Set(['self', 'owner'])

function issue(
  code: CardSemanticIssueCode,
  message: string,
  details: Omit<CardSemanticIssue, 'code' | 'message'> = {},
): CardSemanticIssue {
  return { code, message, ...details }
}

function outgoing(edges: GraphEdge[], nodeId: string): GraphEdge[] {
  return edges.filter(edge => edge.from.nodeId === nodeId)
}

function incoming(edges: GraphEdge[], nodeId: string): GraphEdge[] {
  return edges.filter(edge => edge.to.nodeId === nodeId)
}

function parameterIssue(node: GraphNode, kind: string): CardSemanticIssue | null {
  const data = node.data
  if (kind === 'drawCards') {
    if (typeof data.amount !== 'number' || !Number.isInteger(data.amount) || data.amount <= 0) {
      return issue('invalid-parameters', 'drawCards.amount 必须是正整数', { nodeId: node.id, kind })
    }
  }
  if (kind === 'addCardToHand' || kind === 'addCardToDeck') {
    if (typeof data.cardId !== 'string' || !isValidCardId(data.cardId)) {
      return issue('invalid-parameters', `${kind}.cardId 必须是 PascalCase ASCII Card ID`, { nodeId: node.id, kind })
    }
  }
  return null
}

/**
 * Card 的生成语义校验。
 *
 * validateGraph 只保证结构安全，允许空图和孤立节点作为草稿保存；这里才
 * 判断是否已经具备可确定生成 C# 的完整 trigger → 线性 effect 链。
 */
export function validateCardGraph(graph: NodeGraph, cardId = graph.entityId): CardGraphValidation {
  const issues: CardSemanticIssue[] = []
  const entityMismatch = graph.entityType !== 'card'
  if (entityMismatch) {
    issues.push(issue('wrong-entity', `Card graph.entityType 必须是 card，实际是 ${graph.entityType}`))
  }
  if (graph.entityId !== cardId) {
    issues.push(issue('card-id-mismatch', `graph.entityId 必须等于 Card ID ${cardId}`))
  }

  // 用 card entity 验证 registry/端口契约，让 wrong-entity 仍可同时报告其余语义问题。
  const structuralGraph = entityMismatch ? { ...graph, entityType: 'card' as const } : graph
  const structural = validateGraph(structuralGraph)
  if (!structural.ok) {
    return { ok: false, issues: [...issues, issue('invalid-structure', structural.reason)] }
  }

  const triggers = graph.nodes.filter(node => node.type === 'trigger')
  const effects = graph.nodes.filter(node => node.type === 'effect')
  if (triggers.length === 0) {
    issues.push(issue('missing-trigger', 'Card 至少需要一个 trigger'))
  }

  const seenEvents = new Set<string>()
  for (const trigger of triggers) {
    const event = typeof trigger.data.event === 'string' ? trigger.data.event : ''
    const triggerKind = TRIGGER_KINDS[event]
    if (event && seenEvents.has(event)) {
      issues.push(issue('duplicate-trigger', `trigger ${event} 只能出现一次`, { nodeId: trigger.id, event }))
    }
    if (event) seenEvents.add(event)
    if (!triggerKind || triggerKind.entity !== 'card') continue
    const edges = outgoing(graph.edges, trigger.id)
    if (edges.length === 0) {
      issues.push(issue('empty-trigger', `trigger ${event} 必须连接至少一个 effect`, { nodeId: trigger.id, event }))
    }
    if (edges.length > 1) {
      issues.push(issue('branching', `trigger ${event} 只能有一条出边`, { nodeId: trigger.id, event }))
    }
    if (incoming(graph.edges, trigger.id).length > 0) {
      issues.push(issue('branching', `trigger ${event} 不能作为 effect 链的中间节点`, { nodeId: trigger.id, event }))
    }
  }

  for (const node of graph.nodes) {
    if (node.type !== 'trigger' && node.type !== 'effect') {
      issues.push(issue('unsupported-node', `Card v0.9 不支持 ${node.type} 节点`, { nodeId: node.id }))
    }
  }

  for (const effect of effects) {
    const kind = typeof effect.data.kind === 'string' ? effect.data.kind : ''
    const effectKind = EFFECT_KINDS[kind]
    const inEdges = incoming(graph.edges, effect.id)
    const outEdges = outgoing(graph.edges, effect.id)
    if (inEdges.length > 1 || outEdges.length > 1) {
      issues.push(issue('branching', `effect ${kind || effect.id} 必须保持单入单出`, { nodeId: effect.id, kind }))
    }
    if (effectKind && !CARD_RECEIVERS.has(effectKind.receiver)) {
      issues.push(issue('invalid-receiver', `effect ${kind} 的 receiver 不属于 v0.9 Card 语义`, { nodeId: effect.id, kind }))
    }
    const params = parameterIssue(effect, kind)
    if (params) issues.push(params)
  }

  const ownerByNode = new Map<string, Set<string>>()
  for (const trigger of triggers) {
    const visited = new Set<string>()
    const queue = [trigger.id]
    while (queue.length > 0) {
      const nodeId = queue.shift()!
      if (visited.has(nodeId)) continue
      visited.add(nodeId)
      let owners = ownerByNode.get(nodeId)
      if (!owners) {
        owners = new Set<string>()
        ownerByNode.set(nodeId, owners)
      }
      owners.add(trigger.id)
      for (const edge of outgoing(graph.edges, nodeId)) queue.push(edge.to.nodeId)
    }
  }

  for (const effect of effects) {
    const owners = ownerByNode.get(effect.id)
    if (!owners || owners.size === 0) {
      issues.push(issue('orphan-node', 'effect 必须从一个 trigger 可达', { nodeId: effect.id }))
    } else if (owners.size > 1) {
      issues.push(issue('shared-effect', 'effect 不能被多个 trigger 分支共享', { nodeId: effect.id }))
    }
  }
  for (const node of graph.nodes) {
    if (!ownerByNode.has(node.id)) {
      issues.push(issue('orphan-node', `${node.type} 节点必须属于一个 trigger 分支`, { nodeId: node.id }))
    }
  }

  return issues.length > 0 ? { ok: false, issues } : { ok: true }
}
