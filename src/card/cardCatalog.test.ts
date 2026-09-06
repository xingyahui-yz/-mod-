import { beforeEach, describe, expect, it, vi } from 'vitest'
import { appendNode, createEmptyGraph, moveNode } from '../node-editor/graph'
import type { CardDocument } from './cardDocument'
import { cardCatalogActions, getCardCatalogView } from './cardCatalog'
import { cardDocumentRevision, createCardProposal } from './cardAiProposal'

function document(id: string, name = id): CardDocument {
  return {
    schemaVersion: 2,
    card: { id, name, cost: 1, type: 'Attack', rarity: 'Common', description: '', keywords: [] },
    graph: createEmptyGraph(id, 'card'),
    generation: { lastGeneratedFingerprint: null },
  }
}

describe('CardCatalog', () => {
  beforeEach(() => {
    vi.useRealTimers()
    cardCatalogActions.clear()
  })

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
