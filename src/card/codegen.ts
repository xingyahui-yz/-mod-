/**
 * Card 代码生成器 - 节点图 + 表单数据 → C# Godot 代码 (v0.9 Step 4)
 *
 * v0.9 (ADR-0006 §决策 §7): CardEditor UI 走法 1 — 顶部表单横排 + 下部节点画布 + 折叠预览
 * 本文件为 codegen 侧, 与 src/relic/codegen.ts 同构 (relic 走的是走法 1 的旧版分支,
 * relic 用的 3-栏布局, 但 codegen 抽出来都是 BFS 收集 effect 节点语句).
 *
 * 路径说明：
 *  - collectStatements 与 relic 平行实现 (本文件内, 不抽公共)
 *    v0.9 Step 5 会抽到 src/node-editor/collectStatements.ts 共享
 *  - effect 派发表读 shared/kinds.ts (跟 relic 一致)
 *  - Card 专属 4 个 effect (exhaustSelf / discardSelf / addCardToHand / addCardToDeck)
 *    在 v0.9 Step 4 加入; target 字段在 Step 6 接入 codegen
 */
import Mustache from 'mustache'
import { NodeGraph } from '../node-editor/types'
import { EFFECT_KINDS } from '../shared/kinds'
import { CardData } from '../types'
import cardTemplate from './card.mustache?raw'
import { toPascalCase } from '../utils/stringUtils'

interface TriggerMethod {
  methodName: string
  statements: string[]
}

/**
 * 从 trigger.out 出发, BFS 收集所有 effect 节点的语句
 *  - 与 src/relic/codegen.ts 的 collectStatements 平行实现
 *  - v0.9 Step 5 抽到 src/node-editor/collectStatements.ts
 */
function collectStatements(
  graph: NodeGraph,
  startNodeId: string
): string[] {
  const visited = new Set<string>()
  const queue: string[] = [startNodeId]
  const statements: string[] = []

  while (queue.length > 0) {
    const nodeId = queue.shift()!
    if (visited.has(nodeId)) continue
    visited.add(nodeId)

    const node = graph.nodes.find(n => n.id === nodeId)
    if (!node) continue

    if (node.type === 'effect') {
      const kind = String(node.data.kind ?? '')
      const effectKind = EFFECT_KINDS[kind]
      if (effectKind) {
        const stmt = effectKind.emitStatement(node.data)
        if (stmt) statements.push(stmt)
      }
    }

    const nextEdges = graph.edges.filter(e => e.from.nodeId === nodeId)
    for (const edge of nextEdges) {
      queue.push(edge.to.nodeId)
    }
  }

  return statements
}

/** Escape user input for embedding in C# double-quoted string literal */
function escapeCSharpString(s: string): string {
  return s
    .replace(/\\/g, '\\\\')
    .replace(/"/g, '\\"')
    .replace(/\r/g, '\\r')
    .replace(/\n/g, '\\n')
    .replace(/\t/g, '\\t')
}

/** 主入口：生成 Card 完整 .cs 文件内容 (节点版) */
export function generateCardCode(
  graph: NodeGraph,
  card: CardData,
  namespace: string = 'MyMod.Cards'
): string {
  // 1. 找所有 trigger 节点, 每个生成一个 override 方法
  // 注意：Card trigger 都注册在 TRIGGER_KINDS (shared/kinds.ts); 这里直接读 graph
  //  即可, 跟 relic 一样, codegen 不需要 import TRIGGER_KINDS (methodName 从 nodes 推)
  const triggerNodes = graph.nodes.filter(n => n.type === 'trigger')
  const triggerMethods: TriggerMethod[] = triggerNodes
    .map(node => {
      // event 字段 → methodName 直接派生 (PascalCase + On 前缀)
      const event = String(node.data.event ?? '')
      if (!event) return null
      // Card trigger 全是 onXxx 命名, OnXxx 是 C# 方法名约定
      const methodName = 'On' + event.charAt(2).toUpperCase() + event.slice(3)
      return {
        methodName,
        statements: collectStatements(graph, node.id)
      }
    })
    .filter((m): m is TriggerMethod => m !== null)

  // 2. className 派生
  const safeId = card.id.trim() || card.name.trim() || 'MyCard'
  const className = toPascalCase(safeId).replace(/[^a-zA-Z0-9]/g, '') || 'MyCard'

  // 3. Mustache 渲染
  const view = {
    namespace,
    className,
    name: escapeCSharpString(card.name),
    cost: card.cost,
    type: card.type,
    rarity: card.rarity,
    description: escapeCSharpString(card.description),
    keywords: card.keywords.filter(k => k.trim() !== '').map(k => escapeCSharpString(k)),
    triggerMethods,
  }
  return Mustache.render(cardTemplate, view)
}
