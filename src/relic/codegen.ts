/**
 * Relic 代码生成器 - 节点图 + 表单数据 → C# Godot 代码
 *
 * v0.5.2 模块化：从 src/node-editor/codegen.ts 移至 src/relic/codegen.ts
 * 设计原则：
 *  - 纯函数：不依赖 React/DOM，可单测
 *  - 派发表：trigger.event → methodName; effect.kind → statement template
 *  - 遍历策略：从 trigger.out BFS 收集所有可达 effect/condition/branch
 *    （v0.4 不做条件分支短路——所有 reachable effect 都执行）
 */
import Mustache from 'mustache'
import { NodeGraph } from '../node-editor/types'
import { RelicData } from './RelicData'
import relicTemplate from './relic.mustache?raw'
import { toPascalCase } from '../utils/stringUtils'

/** trigger.data.event → C# 方法名 */
const TRIGGER_DISPATCH: Record<string, string> = {
  onCombatStart: 'OnCombatStart',
  onTurnStart: 'OnTurnStart',
  onCardPlayed: 'OnCardPlayed'
}

/** effect.data.kind → C# 语句模板（{buffType}/{amount} 是占位符） */
const EFFECT_DISPATCH: Record<string, (data: Record<string, unknown>) => string | null> = {
  gainBuff: (d) => {
    const buff = String(d.buffType ?? 'Strength')
    const amount = Number(d.amount ?? 1)
    return `ApplyBuff("${buff}", ${amount});`
  },
  loseHp: (d) => {
    const amount = Number(d.amount ?? 1)
    return `Owner.LoseHp(${amount});`
  },
  gainGold: (d) => {
    const amount = Number(d.amount ?? 1)
    return `Owner.GainGold(${amount});`
  },
  drawCards: (d) => {
    const amount = Number(d.amount ?? 1)
    return `Owner.DrawCards(${amount});`
  }
}

interface TriggerMethod {
  methodName: string
  statements: string[]
}

/** 从 trigger.out 端口出发，BFS 收集所有 effect 节点的语句 */
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

    // effect 节点 → 生成语句
    if (node.type === 'effect') {
      const kind = String(node.data.kind ?? '')
      const emit = EFFECT_DISPATCH[kind]
      if (emit) {
        const stmt = emit(node.data)
        if (stmt) statements.push(stmt)
      }
    }

    // 沿所有 output 端口的出边继续
    const nextEdges = graph.edges.filter(e => e.from.nodeId === nodeId)
    for (const edge of nextEdges) {
      queue.push(edge.to.nodeId)
    }
  }

  return statements
}

/** 主入口：生成完整 .cs 文件内容 */
export function generateRelicCode(
  graph: NodeGraph,
  relic: RelicData,
  namespace: string = 'MyMod.Relics'
): string {
  // 1. 找所有 trigger 节点，每个生成一个方法
  const triggerNodes = graph.nodes.filter(n => n.type === 'trigger')
  const triggerMethods: TriggerMethod[] = triggerNodes
    .map(node => {
      const event = String(node.data.event ?? '')
      const methodName = TRIGGER_DISPATCH[event]
      if (!methodName) return null  // 未知 trigger，跳过
      return {
        methodName,
        statements: collectStatements(graph, node.id)
      }
    })
    .filter((m): m is TriggerMethod => m !== null)

  // 2. className：toPascalCase 自带按非字母数字切词，但末尾残留的非字母数字要清掉
  const safeId = relic.id.trim() || relic.name.trim() || 'MyRelic'
  const className = toPascalCase(safeId).replace(/[^a-zA-Z0-9]/g, '') || 'MyRelic'

  // 3. Mustache 渲染
  const view = {
    namespace,
    className,
    id: relic.id,
    name: relic.name,
    description: relic.description,
    tier: relic.tier,
    rarity: relic.rarity,
    triggerMethods
  }
  return Mustache.render(relicTemplate, view)
}

/** 列出支持的 trigger 事件名（UI dropdown 用） */
export const SUPPORTED_TRIGGERS = Object.keys(TRIGGER_DISPATCH)

/** 列出支持的 effect 类型（UI dropdown 用） */
export const SUPPORTED_EFFECTS = Object.keys(EFFECT_DISPATCH)