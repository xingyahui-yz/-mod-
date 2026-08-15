import { describe, expect, it } from 'vitest'
import { appendNode, createEmptyGraph } from '../node-editor/graph'
import type { CardDocument } from './cardDocument'
import { applyCardProposal, cardDocumentRevision, createCardProposal, isCardProposalStale } from './cardAiProposal'

function makeDocument(): CardDocument {
  let graph = createEmptyGraph('Fireball', 'card')
  graph = appendNode(graph, 'trigger', { x: 0, y: 0 }, { event: 'onPlay' }).graph
  return {
    schemaVersion: 2,
    card: { id: 'Fireball', name: 'Fireball', cost: 1, type: 'Attack', rarity: 'Common', description: '', keywords: [] },
    graph,
    generation: { lastGeneratedFingerprint: null },
  }
}

describe('Card AI proposals', () => {
  it('完整 AI CardDocument 先形成可预览提案，不携带旧生成状态', () => {
    const base = makeDocument()
    const candidate = {
      card: { ...base.card, name: '火球术' },
      graph: base.graph,
      generation: { lastGeneratedFingerprint: { sourceHash: 'old', generatorVersion: 'old', artifactHash: 'old' } },
    }
    const result = createCardProposal(base, candidate)
    expect(result.status).toBe('ready')
    if (result.status === 'ready') {
      expect(result.proposal.document.card.name).toBe('火球术')
      expect(result.proposal.document.generation.lastGeneratedFingerprint).toBeNull()
      expect(result.proposal.baseRevision).toBe(cardDocumentRevision(base))
    }
  })

  it('结构违规、未知 kind 或偷换 ID 的响应不可形成提案', () => {
    const base = makeDocument()
    expect(createCardProposal(base, { card: base.card }).status).toBe('invalid')
    expect(createCardProposal(base, { card: { ...base.card, id: 'OtherCard' }, graph: base.graph }).status).toBe('invalid')
    expect(createCardProposal(base, {
      card: base.card,
      graph: { ...base.graph, nodes: [{ id: 'bad', type: 'effect', position: { x: 0, y: 0 }, data: { kind: 'futureEffect' } }] },
    }).status).toBe('invalid')
  })

  it('基线 Card 变化后提案过期，不能覆盖最新草稿', () => {
    const base = makeDocument()
    const result = createCardProposal(base, { card: { ...base.card, name: '候选' }, graph: base.graph })
    expect(result.status).toBe('ready')
    if (result.status !== 'ready') return
    const current = { ...base, card: { ...base.card, description: '用户刚刚编辑' } }
    expect(isCardProposalStale(result.proposal, current)).toBe(true)
    expect(applyCardProposal(current, result.proposal)).toEqual({ ok: false, reason: 'stale-proposal' })
  })
})
