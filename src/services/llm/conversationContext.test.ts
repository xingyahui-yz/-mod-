import { describe, expect, it } from 'vitest'
import type { CardDocument } from '../../card/cardDocument'
import { cardDocumentRevision } from '../../card/cardAiProposal'
import { buildConversationCardCatalog, CONVERSATION_CARD_DESCRIPTION_MAX_CODE_POINTS } from './conversationContext'

function cardDocument(overrides: Partial<CardDocument['card']> = {}, nodes: CardDocument['graph']['nodes'] = []): CardDocument {
  const id = overrides.id ?? 'Fireball'
  return {
    schemaVersion: 2,
    card: {
      id,
      name: '火球',
      type: 'Attack',
      rarity: 'Rare',
      cost: 2,
      description: '造成伤害。',
      keywords: ['Exhaust', 'Innate'],
      ...overrides,
    },
    graph: {
      id: `graph-${id}`,
      entityId: id,
      entityType: 'card',
      version: '0.1.0',
      nodes,
      edges: [],
      metadata: { createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z' },
    },
    generation: { lastGeneratedFingerprint: null },
  }
}

function node(type: 'trigger' | 'effect' | 'condition' | 'branch', data: Record<string, unknown>, id: string) {
  return { id, type, data, position: { x: 0, y: 0 } }
}

describe('buildConversationCardCatalog', () => {
  it('详细目录包含基础属性、摘要字段及完整文档 revision', () => {
    const document = cardDocument()

    expect(buildConversationCardCatalog([document], 'detailed')).toEqual([{
      tier: 'detailed',
      id: 'Fireball',
      name: '火球',
      type: 'Attack',
      rarity: 'Rare',
      cost: 2,
      keywords: ['Exhaust', 'Innate'],
      description: '造成伤害。',
      behaviorKinds: [],
      revision: cardDocumentRevision(document),
    }])
  })

  it('紧凑目录仅包含 ID、名称、类型和 revision', () => {
    const document = cardDocument()
    const [summary] = buildConversationCardCatalog([document], 'compact')

    expect(summary).toEqual({
      tier: 'compact',
      id: 'Fireball',
      name: '火球',
      type: 'Attack',
      revision: cardDocumentRevision(document),
    })
    expect(summary).not.toHaveProperty('rarity')
    expect(summary).not.toHaveProperty('cost')
    expect(summary).not.toHaveProperty('keywords')
    expect(summary).not.toHaveProperty('description')
    expect(summary).not.toHaveProperty('behaviorKinds')
  })

  it('按固定 Unicode code point 上限确定性截断描述并为省略号留位', () => {
    const description = '😀'.repeat(CONVERSATION_CARD_DESCRIPTION_MAX_CODE_POINTS + 4)
    const document = cardDocument({ description })

    const first = buildConversationCardCatalog([document], 'detailed')[0]
    const second = buildConversationCardCatalog([document], 'detailed')[0]
    const points = Array.from(first.tier === 'detailed' ? first.description : '')

    expect(first).toEqual(second)
    expect(points).toHaveLength(CONVERSATION_CARD_DESCRIPTION_MAX_CODE_POINTS)
    expect(points.at(-1)).toBe('…')
    expect(first.tier === 'detailed' && first.description).toBe(`${'😀'.repeat(CONVERSATION_CARD_DESCRIPTION_MAX_CODE_POINTS - 1)}…`)
  })

  it('行为摘要去重并按稳定的 code unit 顺序排列，不依赖节点顺序', () => {
    const first = cardDocument({}, [
      node('effect', { kind: 'Zeta' }, 'n1'),
      node('trigger', { event: 'OnPlay' }, 'n2'),
      node('effect', { kind: 'Alpha' }, 'n3'),
      node('effect', { kind: 'Alpha' }, 'n4'),
      node('condition', { kind: 'ignored-condition-kind' }, 'n5'),
      node('branch', { kind: 'ignored-branch-kind' }, 'n6'),
    ])
    const reversed = cardDocument({}, [...first.graph.nodes].reverse())

    const summaries = [first, reversed].map(document => buildConversationCardCatalog([document], 'detailed')[0])
    expect(summaries[0]).toMatchObject({
      tier: 'detailed',
      behaviorKinds: ['effect:Alpha', 'effect:Zeta', 'trigger:OnPlay'],
    })
    expect(summaries[1]).toMatchObject({ behaviorKinds: ['effect:Alpha', 'effect:Zeta', 'trigger:OnPlay'] })
  })

  it('空目录返回空数组', () => {
    expect(buildConversationCardCatalog([], 'detailed')).toEqual([])
    expect(buildConversationCardCatalog([], 'compact')).toEqual([])
  })
})
