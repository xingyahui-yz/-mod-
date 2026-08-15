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
import type { NodeGraph } from '../node-editor/types'
import { EFFECT_KINDS, TRIGGER_KINDS } from '../shared/kinds'
import cardTemplate from './card.mustache?raw'
import { toPascalCase } from '../utils/stringUtils'
import type { CardDocument } from './cardDocument'
import { validateCardGraph } from './cardSemantics'

interface TriggerMethod {
  methodName: string
  statements: string[]
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

function collectLinearStatements(graph: NodeGraph, triggerId: string): string[] {
  const statements: string[] = []
  let nodeId = triggerId
  while (true) {
    const edge = graph.edges.find(candidate => candidate.from.nodeId === nodeId)
    if (!edge) break
    const node = graph.nodes.find(candidate => candidate.id === edge.to.nodeId)
    if (!node) throw new Error(`生成失败：边指向不存在节点 ${edge.to.nodeId}`)
    if (node.type !== 'effect') throw new Error(`生成失败：Card v0.9 只允许线性 effect 链 (${node.id})`)
    const kind = String(node.data.kind ?? '')
    const definition = EFFECT_KINDS[kind]
    if (!definition) throw new Error(`生成失败：effect kind '${kind}' 未注册`)
    const statement = definition.emitStatement(node.data)
    if (!statement) throw new Error(`生成失败：effect kind '${kind}' 暂不支持代码生成`)
    statements.push(statement)
    nodeId = node.id
  }
  return statements
}

/** v0.9 正式入口：只接受通过 CardDocument + Card 语义校验的文档。 */
export function generateCardDocumentCode(
  document: CardDocument,
  namespace: string = 'MyMod.Cards',
): string {
  const validation = validateCardGraph(document.graph, document.card.id)
  if (!validation.ok) {
    throw new Error(validation.issues.map(issue => issue.message).join('；'))
  }

  const triggerMethods: TriggerMethod[] = document.graph.nodes
    .filter(node => node.type === 'trigger')
    .map(node => {
      const event = String(node.data.event)
      const definition = TRIGGER_KINDS[event]
      if (!definition) throw new Error(`生成失败：trigger '${event}' 未注册`)
      return {
        methodName: definition.methodName,
        statements: collectLinearStatements(document.graph, node.id),
      }
    })

  const className = toPascalCase(document.card.id).replace(/[^a-zA-Z0-9]/g, '') || 'MyCard'
  return Mustache.render(cardTemplate, {
    namespace,
    className,
    name: escapeCSharpString(document.card.name),
    cost: document.card.cost,
    type: document.card.type,
    rarity: document.card.rarity,
    description: escapeCSharpString(document.card.description),
    keywords: document.card.keywords.filter(k => k.trim() !== '').map(k => escapeCSharpString(k)),
    triggerMethods,
  })
}
