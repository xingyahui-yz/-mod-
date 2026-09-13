import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { appendNode, createEmptyGraph, moveNode } from '../node-editor/graph'
import type { CardDocument } from './cardDocument'
import {
  cardCatalogActions,
  getCardCatalogView,
  subscribeCardCatalogEvents,
  type CardEditProvenance,
  type CardCatalogEvent,
} from './cardCatalog'
import { cardDocumentRevision, createCardProposal } from './cardAiProposal'

function document(id: string, name = id): CardDocument {
  return {
    schemaVersion: 2,
    card: { id, name, cost: 1, type: 'Attack', rarity: 'Common', description: '', keywords: [] },
    graph: createEmptyGraph(id, 'card'),
    generation: { lastGeneratedFingerprint: null },
  }
}

function provenance(proposalId: string, transactionId = `transaction:${proposalId}`): CardEditProvenance {
  return { kind: 'ai-proposal', proposalId, transactionId }
}

describe('CardCatalog', () => {
  let unsubscribe = () => {}

  beforeEach(() => {
    unsubscribe()
    unsubscribe = () => {}
    vi.useRealTimers()
    cardCatalogActions.clear()
  })

  afterEach(() => unsubscribe())

  it('原子加载文档并拒绝大小写重复 ID', () => {
    expect(cardCatalogActions.loadDocuments([document('Alpha'), document('Beta')]).ok).toBe(true)
    expect(getCardCatalogView().cards.map(card => card.id)).toEqual(['Alpha', 'Beta'])
    expect(cardCatalogActions.loadDocuments([document('Fireball'), document('FIREBALL')])).toEqual({ ok: false, error: 'duplicate-card-id' })
    expect(getCardCatalogView().cards.map(card => card.id)).toEqual(['Alpha', 'Beta'])
  })

  it('记录当前 Card 投影所属项目', () => {
    expect(cardCatalogActions.loadDocuments([document('Alpha')], '/mods/a').ok).toBe(true)
    expect(getCardCatalogView().sourceProjectRoot).toBe('/mods/a')
    cardCatalogActions.clear()
    expect(getCardCatalogView().sourceProjectRoot).toBeNull()
  })

  it('每张 Card 的 undo/redo 在切换后仍独立保留', () => {
    cardCatalogActions.loadDocuments([document('Alpha'), document('Beta')])
    cardCatalogActions.patchCurrentCard({ name: 'Alpha edited' })
    cardCatalogActions.selectCard('Beta')
    cardCatalogActions.patchCurrentCard({ name: 'Beta edited' })
    cardCatalogActions.selectCard('Alpha')
    expect(getCardCatalogView().canUndo).toBe(true)
    cardCatalogActions.undo()
    expect(getCardCatalogView().currentCard?.name).toBe('Alpha')
    cardCatalogActions.selectCard('Beta')
    expect(getCardCatalogView().canUndo).toBe(true)
    cardCatalogActions.undo()
    expect(getCardCatalogView().currentCard?.name).toBe('Beta')
  })

  it('无变化的 Card 与行为图更新不进入历史', () => {
    cardCatalogActions.loadDocuments([document('Alpha')])
    const current = getCardCatalogView().currentDocument!
    cardCatalogActions.patchCurrentCard({ name: current.card.name })
    cardCatalogActions.replaceCurrentGraph({ ...current.graph })
    expect(getCardCatalogView().canUndo).toBe(false)
  })

  it('连续文本输入在 750ms 或 finishEdit 后只产生一步', () => {
    vi.useFakeTimers()
    cardCatalogActions.loadDocuments([document('Alpha')])
    cardCatalogActions.patchCurrentCard({ name: 'A' }, { mergeKey: 'card.name' })
    cardCatalogActions.patchCurrentCard({ name: 'AB' }, { mergeKey: 'card.name' })
    expect(getCardCatalogView().currentCard?.name).toBe('AB')
    vi.advanceTimersByTime(750)
    expect(getCardCatalogView().canUndo).toBe(true)
    cardCatalogActions.undo()
    expect(getCardCatalogView().currentCard?.name).toBe('Alpha')

    cardCatalogActions.patchCurrentCard({ description: 'one' }, { mergeKey: 'card.description' })
    cardCatalogActions.patchCurrentCard({ description: 'two' }, { mergeKey: 'card.description' })
    cardCatalogActions.finishEdit('card.description')
    cardCatalogActions.undo()
    expect(getCardCatalogView().currentCard?.description).toBe('')
  })

  it('节点拖动多次更新只提交一个历史步骤，取消恢复原图', () => {
    const base = document('GraphCard')
    base.graph = appendNode(base.graph, 'trigger', { x: 0, y: 0 }, { event: 'onPlay' }).graph
    cardCatalogActions.loadDocuments([base])
    const nodeId = base.graph.nodes[0].id
    const first = moveNode(base.graph, nodeId, { x: 10, y: 10 })
    const second = moveNode(first, nodeId, { x: 20, y: 20 })
    cardCatalogActions.replaceCurrentGraph(first, { transactionKey: `node-drag:${nodeId}` })
    cardCatalogActions.replaceCurrentGraph(second, { transactionKey: `node-drag:${nodeId}` })
    cardCatalogActions.finishEdit(`node-drag:${nodeId}`)
    cardCatalogActions.undo()
    expect(getCardCatalogView().currentDocument?.graph.nodes[0].position).toEqual({ x: 0, y: 0 })

    const movedAgain = moveNode(getCardCatalogView().currentDocument!.graph, nodeId, { x: 30, y: 30 })
    cardCatalogActions.replaceCurrentGraph(movedAgain, { transactionKey: `node-drag:${nodeId}` })
    cardCatalogActions.cancelEdit(`node-drag:${nodeId}`)
    expect(getCardCatalogView().currentDocument?.graph.nodes[0].position).toEqual({ x: 0, y: 0 })
  })

  it('Card 属性、行为图和 AI 提案共享同一时间线', () => {
    const base = document('ProposalCard')
    cardCatalogActions.loadDocuments([base])
    cardCatalogActions.patchCurrentCard({ name: 'Manual' })
    const current = getCardCatalogView().currentDocument!
    const proposalResult = createCardProposal(current, {
      card: { ...current.card, name: 'AI' },
      graph: appendNode(current.graph, 'trigger', { x: 0, y: 0 }, { event: 'onPlay' }).graph,
    })
    expect(proposalResult.status).toBe('ready')
    if (proposalResult.status !== 'ready') return
    expect(cardCatalogActions.applyProposal(proposalResult.proposal).ok).toBe(true)
    cardCatalogActions.undo()
    expect(getCardCatalogView().currentCard?.name).toBe('Manual')
    expect(getCardCatalogView().currentDocument?.graph.nodes).toHaveLength(0)
  })

  it('AI 修改提案的 provenance 随单个历史步骤发出 accepted、reverted、accepted', () => {
    const events: CardCatalogEvent[] = []
    unsubscribe = subscribeCardCatalogEvents(event => events.push(event))
    const base = document('ProposalCard')
    cardCatalogActions.loadDocuments([base], '/mods/provenance')
    const proposalResult = createCardProposal(base, {
      card: { ...base.card, name: 'AI edit' },
      graph: appendNode(base.graph, 'trigger', { x: 0, y: 0 }, { event: 'onPlay' }).graph,
    })
    expect(proposalResult.status).toBe('ready')
    if (proposalResult.status !== 'ready') return

    expect(cardCatalogActions.applyProposal(proposalResult.proposal, {
      provenance: provenance('proposal-update-1'),
    }).ok).toBe(true)
    expect(events).toEqual([{
      type: 'proposal-status-changed',
      sourceProjectRoot: '/mods/provenance',
      cardId: 'ProposalCard',
      proposalId: 'proposal-update-1',
      transactionId: 'transaction:proposal-update-1',
      status: 'accepted',
      source: 'apply',
    }])

    cardCatalogActions.undo()
    expect(getCardCatalogView().currentCard?.name).toBe('ProposalCard')
    expect(events.at(-1)?.status).toBe('reverted')

    cardCatalogActions.redo()
    expect(getCardCatalogView().currentCard?.name).toBe('AI edit')
    expect(events.at(-1)?.status).toBe('accepted')
    expect(events.map(event => event.proposalId)).toEqual([
      'proposal-update-1',
      'proposal-update-1',
      'proposal-update-1',
    ])
    expect(events.map(event => event.transactionId)).toEqual([
      'transaction:proposal-update-1',
      'transaction:proposal-update-1',
      'transaction:proposal-update-1',
    ])
    expect(events.map(event => event.source)).toEqual(['apply', 'undo', 'redo'])
  })

  it('普通编辑和 generation 记录不产生 provenance，且 provenance 不参与 revision 或指纹', () => {
    const events: CardCatalogEvent[] = []
    unsubscribe = subscribeCardCatalogEvents(event => events.push(event))
    const base = document('GeneratedProposal')
    base.generation.lastGeneratedFingerprint = { sourceHash: 'old', generatorVersion: '1', artifactHash: 'old' }
    cardCatalogActions.loadDocuments([base])
    const proposalResult = createCardProposal(base, {
      card: { ...base.card, name: 'AI edit' },
      graph: base.graph,
    })
    expect(proposalResult.status).toBe('ready')
    if (proposalResult.status !== 'ready') return

    cardCatalogActions.applyProposal(proposalResult.proposal, {
      provenance: provenance('proposal-generated-1'),
    })
    const acceptedRevision = cardDocumentRevision(getCardCatalogView().currentDocument!)
    expect(acceptedRevision).toBe(cardDocumentRevision(proposalResult.proposal.document))
    expect(getCardCatalogView().currentDocument?.generation.lastGeneratedFingerprint).toBeNull()

    expect(cardCatalogActions.recordGeneration({
      cardId: 'GeneratedProposal',
      baseRevision: acceptedRevision,
      fingerprint: { sourceHash: 'new', generatorVersion: '2', artifactHash: 'new' },
    }).ok).toBe(true)
    expect(cardDocumentRevision(getCardCatalogView().currentDocument!)).toBe(acceptedRevision)
    expect(events).toHaveLength(1)

    cardCatalogActions.patchCurrentCard({ description: 'manual' })
    cardCatalogActions.undo()
    expect(events).toHaveLength(1)
    cardCatalogActions.undo()
    expect(events.at(-1)?.status).toBe('reverted')
    expect(getCardCatalogView().currentDocument?.generation.lastGeneratedFingerprint).toBeNull()
    cardCatalogActions.redo()
    expect(events.at(-1)?.status).toBe('accepted')
    expect(cardDocumentRevision(getCardCatalogView().currentDocument!)).toBe(acceptedRevision)
  })

  it('每张 Card 独立解释 proposal undo/redo provenance', () => {
    const events: CardCatalogEvent[] = []
    unsubscribe = subscribeCardCatalogEvents(event => events.push(event))
    const alpha = document('Alpha')
    const beta = document('Beta')
    cardCatalogActions.loadDocuments([alpha, beta])

    const alphaProposal = createCardProposal(alpha, {
      card: { ...alpha.card, name: 'Alpha AI' },
      graph: alpha.graph,
    })
    const betaProposal = createCardProposal(beta, {
      card: { ...beta.card, name: 'Beta AI' },
      graph: beta.graph,
    })
    expect(alphaProposal.status).toBe('ready')
    expect(betaProposal.status).toBe('ready')
    if (alphaProposal.status !== 'ready' || betaProposal.status !== 'ready') return

    cardCatalogActions.applyProposal(alphaProposal.proposal, {
      provenance: provenance('proposal-alpha'),
    })
    cardCatalogActions.applyProposal(betaProposal.proposal, {
      provenance: provenance('proposal-beta'),
    })
    cardCatalogActions.undo()
    cardCatalogActions.selectCard('Beta')
    cardCatalogActions.undo()
    cardCatalogActions.redo()
    cardCatalogActions.selectCard('Alpha')
    cardCatalogActions.redo()

    expect(events.map(({ proposalId, status }) => `${proposalId}:${status}`)).toEqual([
      'proposal-alpha:accepted',
      'proposal-beta:accepted',
      'proposal-alpha:reverted',
      'proposal-beta:reverted',
      'proposal-beta:accepted',
      'proposal-alpha:accepted',
    ])
  })

  it('新建提案成功时携带 provenance，但不扩张为目录级撤销', () => {
    const events: CardCatalogEvent[] = []
    unsubscribe = subscribeCardCatalogEvents(event => events.push(event))
    expect(cardCatalogActions.createCard(document('CreatedByAI').card, {
      provenance: provenance('proposal-create-1'),
    })).toEqual({ ok: true, value: { cardId: 'CreatedByAI' } })
    expect(events).toEqual([{
      type: 'proposal-status-changed',
      sourceProjectRoot: null,
      cardId: 'CreatedByAI',
      proposalId: 'proposal-create-1',
      transactionId: 'transaction:proposal-create-1',
      status: 'accepted',
      source: 'apply',
    }])
    expect(getCardCatalogView().canUndo).toBe(false)

    cardCatalogActions.undo()
    expect(getCardCatalogView().currentCard?.id).toBe('CreatedByAI')
    expect(events).toHaveLength(1)

    expect(cardCatalogActions.createCard(document('CreatedByAI').card, {
      provenance: provenance('proposal-conflict'),
    })).toEqual({ ok: false, error: 'duplicate-card-id' })
    expect(events).toHaveLength(1)
  })

  it('createCardDocument 原样接收已 rekey 的完整图，并以空的 Card 历史开始', () => {
    const candidate = document('FinalCard', 'AI 创建')
    candidate.graph = appendNode(
      candidate.graph,
      'effect',
      { x: 24, y: 36 },
      { kind: 'drawCards', amount: 2 },
    ).graph
    candidate.generation.lastGeneratedFingerprint = {
      sourceHash: 'source',
      generatorVersion: 'generator',
      artifactHash: 'artifact',
    }

    expect(cardCatalogActions.createCardDocument(candidate, {
      provenance: provenance('proposal-create-document', 'accept-transaction-7'),
    })).toEqual({ ok: true, value: { cardId: 'FinalCard' } })

    expect(getCardCatalogView().currentDocument).toEqual(candidate)
    expect(getCardCatalogView().currentDocument?.graph.nodes).toHaveLength(1)
    expect(getCardCatalogView().canUndo).toBe(false)
    cardCatalogActions.undo()
    expect(getCardCatalogView().currentDocument).toEqual(candidate)
  })

  it('createCardDocument 严格校验完整文档并原子拒绝 ID 冲突', () => {
    cardCatalogActions.loadDocuments([document('Existing')])
    const mismatched = document('Candidate')
    mismatched.graph = { ...mismatched.graph, entityId: 'OtherCard' }

    expect(cardCatalogActions.createCardDocument(mismatched)).toEqual({
      ok: false,
      error: 'invalid-document',
    })
    expect(getCardCatalogView().documents.map(item => item.card.id)).toEqual(['Existing'])
    expect(getCardCatalogView().selectedCardId).toBe('Existing')

    expect(cardCatalogActions.createCardDocument(document('existing'))).toEqual({
      ok: false,
      error: 'invalid-card-id',
    })
    expect(cardCatalogActions.createCardDocument(document('EXISTING'))).toEqual({
      ok: false,
      error: 'duplicate-card-id',
    })
    expect(getCardCatalogView().documents.map(item => item.card.id)).toEqual(['Existing'])
  })

  it('订阅者异常不会破坏 Catalog mutation 或阻断其他订阅者', () => {
    const received: CardCatalogEvent[] = []
    const unsubscribeThrowing = subscribeCardCatalogEvents(() => {
      throw new Error('listener failed')
    })
    const unsubscribeHealthy = subscribeCardCatalogEvents(event => received.push(event))
    unsubscribe = () => {
      unsubscribeThrowing()
      unsubscribeHealthy()
    }
    const base = document('ListenerIsolation')
    cardCatalogActions.loadDocuments([base], '/mods/listener')
    const proposalResult = createCardProposal(base, {
      card: { ...base.card, name: 'Accepted despite listener' },
      graph: base.graph,
    })
    expect(proposalResult.status).toBe('ready')
    if (proposalResult.status !== 'ready') return

    expect(() => cardCatalogActions.applyProposal(proposalResult.proposal, {
      provenance: provenance('proposal-listener', 'transaction-listener'),
    })).not.toThrow()
    expect(getCardCatalogView().currentCard?.name).toBe('Accepted despite listener')
    expect(received).toEqual([{
      type: 'proposal-status-changed',
      sourceProjectRoot: '/mods/listener',
      cardId: 'ListenerIsolation',
      proposalId: 'proposal-listener',
      transactionId: 'transaction-listener',
      status: 'accepted',
      source: 'apply',
    }])
  })

  it('接受内容相同的提案会同步 accepted，但遵守 no-op 不进入历史', () => {
    const events: CardCatalogEvent[] = []
    unsubscribe = subscribeCardCatalogEvents(event => events.push(event))
    const base = document('NoOpProposal')
    cardCatalogActions.loadDocuments([base])
    const proposalResult = createCardProposal(base, { card: base.card, graph: base.graph })
    expect(proposalResult.status).toBe('ready')
    if (proposalResult.status !== 'ready') return

    cardCatalogActions.applyProposal(proposalResult.proposal, {
      provenance: provenance('proposal-no-change'),
    })

    expect(events.map(({ proposalId, status }) => `${proposalId}:${status}`)).toEqual([
      'proposal-no-change:accepted',
    ])
    expect(getCardCatalogView().canUndo).toBe(false)
  })

  it('provenance 元数据不把无变化的合并编辑伪装成历史步骤', () => {
    const events: CardCatalogEvent[] = []
    unsubscribe = subscribeCardCatalogEvents(event => events.push(event))
    const base = document('NoOpAfterProposal')
    cardCatalogActions.loadDocuments([base])
    const proposalResult = createCardProposal(base, {
      card: { ...base.card, name: 'AI edit' },
      graph: base.graph,
    })
    expect(proposalResult.status).toBe('ready')
    if (proposalResult.status !== 'ready') return
    cardCatalogActions.applyProposal(proposalResult.proposal, {
      provenance: provenance('proposal-no-op'),
    })

    cardCatalogActions.patchCurrentCard({ name: 'AI edit' }, { mergeKey: 'card.name' })
    cardCatalogActions.finishEdit('card.name')
    cardCatalogActions.undo()

    expect(getCardCatalogView().currentCard?.name).toBe('NoOpAfterProposal')
    expect(events.map(event => event.status)).toEqual(['accepted', 'reverted'])
  })

  it('编辑与 undo/redo 清空生成指纹，recordGeneration 不进入历史并拒绝过期结果', () => {
    const base = document('Generated')
    base.generation.lastGeneratedFingerprint = { sourceHash: 'old', generatorVersion: '1', artifactHash: 'old' }
    cardCatalogActions.loadDocuments([base])
    cardCatalogActions.patchCurrentCard({ name: 'Changed' })
    expect(getCardCatalogView().currentDocument?.generation.lastGeneratedFingerprint).toBeNull()
    const current = getCardCatalogView().currentDocument!
    const revision = cardDocumentRevision(current)
    expect(cardCatalogActions.recordGeneration({
      cardId: 'Generated',
      baseRevision: revision,
      fingerprint: { sourceHash: 'new', generatorVersion: '2', artifactHash: 'new' },
    }).ok).toBe(true)
    expect(getCardCatalogView().canUndo).toBe(true)
    cardCatalogActions.undo()
    expect(getCardCatalogView().currentDocument?.generation.lastGeneratedFingerprint).toBeNull()
    expect(cardCatalogActions.recordGeneration({
      cardId: 'Generated',
      baseRevision: revision,
      fingerprint: { sourceHash: 'stale', generatorVersion: '2', artifactHash: 'stale' },
    })).toEqual({ ok: false, error: 'stale-generation' })
  })

  it('删除选中 Card 清空选择，删除其他 Card 保留当前历史', () => {
    cardCatalogActions.loadDocuments([document('Alpha'), document('Beta')])
    cardCatalogActions.patchCurrentCard({ name: 'Changed' })
    cardCatalogActions.removeCard('Beta')
    expect(getCardCatalogView().selectedCardId).toBe('Alpha')
    expect(getCardCatalogView().canUndo).toBe(true)
    cardCatalogActions.removeCard('Alpha')
    expect(getCardCatalogView().selectedCardId).toBeNull()
  })
})
