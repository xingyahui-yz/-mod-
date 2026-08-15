import { describe, expect, it } from 'vitest'
import { appendNode, connect, createEmptyGraph } from '../node-editor/graph'
import type { CardDocument } from './cardDocument'
import { generateCardDocumentCode } from './codegen'

function makeDocument(): CardDocument {
  return {
    schemaVersion: 2,
    card: { id: 'Fireball', name: 'Fireball', cost: 1, type: 'Attack', rarity: 'Common', description: 'Deal damage', keywords: [] },
    graph: createEmptyGraph('Fireball', 'card'),
    generation: { lastGeneratedFingerprint: null },
  }
}

describe('generateCardDocumentCode', () => {
  it('从 canonical CardDocument 生成 trigger 与线性 effect', () => {
    let document = makeDocument()
    const trigger = appendNode(document.graph, 'trigger', { x: 0, y: 0 }, { event: 'onPlay' })
    const effect = appendNode(trigger.graph, 'effect', { x: 120, y: 0 }, { kind: 'exhaustSelf' })
    const linked = connect(effect.graph, { nodeId: trigger.node.id, port: 'out' }, { nodeId: effect.node.id, port: 'in' })
    if (!linked.ok) throw new Error(linked.reason)
    document = { ...document, graph: linked.graph }

    const code = generateCardDocumentCode(document)
    expect(code).toContain('public override void OnPlay()')
    expect(code).toContain('Exhaust();')
    expect(code).toContain('public class Fireball : CardComponent')
  })

  it('空图和非法语义阻止生成，并返回具体问题', () => {
    expect(() => generateCardDocumentCode(makeDocument())).toThrow(/至少需要一个 trigger/)
  })

  it('拒绝 CardDocument graph.entityId 与 Card ID 不一致', () => {
    const document = makeDocument()
    document.graph = { ...document.graph, entityId: 'OtherCard' }
    expect(() => generateCardDocumentCode(document)).toThrow(/entityId/)
  })
})
