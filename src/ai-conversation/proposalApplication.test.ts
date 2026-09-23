import { afterEach, describe, expect, it, vi } from 'vitest'
import { cardCatalogActions, getCardCatalogView } from '../card/cardCatalog'
import type { CardDocument } from '../card/cardDocument'
import type { ConversationCardProposal } from './proposalLifecycle'
import {
  applyProposalToCardCatalog,
  createProposalCardApplication,
  persistProposalToCardCatalog,
  reconcilePendingProposalTransition,
  rekeyCreatedCardDocument,
  type ProposalCardPersistencePort,
  type ProposalCreateReceipt,
} from './proposalApplication'
import { cardDocumentRevision } from '../card/cardAiProposal'

describe('提案应用边界', () => {
  afterEach(() => cardCatalogActions.clear())

  it('只在接受创建提案时占用最终 ID，并保留图后重写自引用', () => {
    cardCatalogActions.loadDocuments([cardDocument('Existing')], '/mods/a')
    const candidate = cardDocument('DraftCard')
    candidate.graph.nodes = [
      effectNode('hand', 'addCardToHand', 'DraftCard'),
      effectNode('deck', 'addCardToDeck', 'draftcard'),
      effectNode('other', 'addCardToHand', 'Existing'),
    ]
    const proposal = createProposal(candidate)

    expect(getCardCatalogView().cards.map(card => card.id)).toEqual(['Existing'])
    expect(applyProposalToCardCatalog('/mods/a', {
      proposal,
      finalCardId: 'FinalCard',
      transactionId: proposal.id,
    })).toEqual({ ok: true })

    const created = getCardCatalogView().currentDocument!
    expect(created.card.id).toBe('FinalCard')
    expect(created.graph).toMatchObject({ id: 'graph-FinalCard', entityId: 'FinalCard' })
    expect(created.graph.nodes.map(node => node.data.cardId)).toEqual(['FinalCard', 'FinalCard', 'Existing'])
    expect(created.graph.nodes.map(node => node.position)).toEqual(candidate.graph.nodes.map(node => node.position))
    expect(created.generation.lastGeneratedFingerprint).toBeNull()
    expect(candidate.card.id).toBe('DraftCard')
    expect(candidate.graph.nodes[0].data.cardId).toBe('DraftCard')
  })

  it('目录属于其他项目时拒绝提交且不改变目录', () => {
    cardCatalogActions.loadDocuments([cardDocument('Existing')], '/mods/b')
    const proposal = createProposal(cardDocument('DraftCard'))

    expect(applyProposalToCardCatalog('/mods/a', {
      proposal,
      finalCardId: 'FinalCard',
      transactionId: proposal.id,
    })).toEqual({
      ok: false,
      error: '当前 Card 目录不属于此项目，请重新打开项目后再接受提案',
      certainty: 'unchanged',
    })
    expect(getCardCatalogView().cards.map(card => card.id)).toEqual(['Existing'])
  })

  it('rekey 不修改非自引用或原始文档', () => {
    const candidate = cardDocument('DraftCard')
    candidate.graph.nodes = [effectNode('draw', 'drawCards', 'DraftCard')]
    const rekeyed = rekeyCreatedCardDocument(candidate, 'FinalCard')

    expect(rekeyed.graph.nodes[0].data.cardId).toBe('DraftCard')
    expect(candidate.graph.id).toBe('graph-DraftCard')
  })

  it('CardDocument 保存失败时不修改目录，accepted 可由上层安全回滚', async () => {
    cardCatalogActions.loadDocuments([cardDocument('Existing')], '/mods/a')
    const proposal = createProposal(cardDocument('DraftCard'))
    const files = persistencePort({ save: { ok: false, error: 'EACCES' } })

    await expect(persistProposalToCardCatalog('/mods/a', {
      proposal,
      finalCardId: 'FinalCard',
      transactionId: proposal.id,
    }, files)).resolves.toEqual({
      ok: false,
      error: 'CardDocument 创建失败：EACCES',
      certainty: 'unchanged',
    })
    expect(getCardCatalogView().cards.map(card => card.id)).toEqual(['Existing'])
  })

  it('保存 update 期间用户继续编辑时恢复最新 Card，而不是用旧 base 覆盖', async () => {
    const base = cardDocument('CardA')
    const candidate = { ...base, card: { ...base.card, description: 'AI 候选' } }
    cardCatalogActions.loadDocuments([base], '/mods/a')
    const firstSave = deferred<{ ok: true } | { ok: false; error: string }>()
    const files = persistencePort()
    vi.mocked(files.saveCardDocument)
      .mockImplementationOnce(() => firstSave.promise)
      .mockResolvedValue({ ok: true })
    const proposal = acceptedUpdateProposal(base, candidate)

    const applying = persistProposalToCardCatalog('/mods/a', {
      proposal,
      finalCardId: 'CardA',
      transactionId: proposal.id,
    }, files)
    await vi.waitFor(() => expect(files.saveCardDocument).toHaveBeenCalledTimes(1))

    expect(cardCatalogActions.patchCurrentCard({ description: '用户继续编辑' }).ok).toBe(true)
    const latest = getCardCatalogView().currentDocument!
    firstSave.resolve({ ok: true })

    await expect(applying).resolves.toMatchObject({ ok: false, certainty: 'unchanged' })
    expect(files.saveCardDocument).toHaveBeenNthCalledWith(2, '/mods/a', latest)
    expect(getCardCatalogView().currentCard?.description).toBe('用户继续编辑')
  })

  it('history Card 只写当前 transition 快照，后继状态必须等待自己的 WAL', async () => {
    const undone = cardDocument('CardA')
    cardCatalogActions.loadDocuments([undone], '/mods/a')
    const firstSave = deferred<{ ok: true } | { ok: false; error: string }>()
    const files = persistencePort()
    vi.mocked(files.saveCardDocument)
      .mockImplementationOnce(() => firstSave.promise)
      .mockResolvedValue({ ok: true })
    const application = createProposalCardApplication('/mods/a', files)
    const saving = application.persistHistoryCard({
      type: 'proposal-status-changed',
      sourceProjectRoot: '/mods/a',
      cardId: 'CardA',
      proposalId: 'proposal-a',
      transactionId: 'proposal-a',
      status: 'reverted',
      source: 'undo',
    }, undone)
    await vi.waitFor(() => expect(files.saveCardDocument).toHaveBeenCalledTimes(1))

    expect(cardCatalogActions.patchCurrentCard({ description: '用户后继编辑' }).ok).toBe(true)
    firstSave.resolve({ ok: true })

    await expect(saving).resolves.toEqual({ ok: true })
    expect(files.saveCardDocument).toHaveBeenCalledTimes(1)
    expect(files.saveCardDocument).toHaveBeenNthCalledWith(1, '/mods/a', undone)
  })

  it('history 开始持久化前已有后继编辑时也不越过后继 WAL 写入 latest', async () => {
    const undone = cardDocument('CardA')
    cardCatalogActions.loadDocuments([undone], '/mods/a')
    expect(cardCatalogActions.patchCurrentCard({ description: '先于持久化发生的后继编辑' }).ok).toBe(true)
    const files = persistencePort()
    const application = createProposalCardApplication('/mods/a', files)

    await expect(application.persistHistoryCard({
      type: 'proposal-status-changed',
      sourceProjectRoot: '/mods/a',
      cardId: 'CardA',
      proposalId: 'proposal-a',
      transactionId: 'proposal-a',
      status: 'reverted',
      source: 'undo',
    }, undone)).resolves.toEqual({ ok: true })

    expect(files.saveCardDocument).toHaveBeenNthCalledWith(1, '/mods/a', undone)
    expect(files.saveCardDocument).toHaveBeenCalledTimes(1)
  })

  it('Card repository 报告恢复不确定时向上保留 uncertain，不伪装成未变更', async () => {
    const document = cardDocument('CardA')
    cardCatalogActions.loadDocuments([document], '/mods/a')
    const files = persistencePort({
      save: { ok: false, error: '恢复结果不确定', certainty: 'uncertain' },
    })
    const application = createProposalCardApplication('/mods/a', files)

    await expect(application.persistHistoryCard({
      type: 'proposal-status-changed',
      sourceProjectRoot: '/mods/a',
      cardId: 'CardA',
      proposalId: 'proposal-a',
      transactionId: 'proposal-a',
      status: 'reverted',
      source: 'undo',
    }, document)).resolves.toEqual({
      ok: false,
      error: 'CardDocument 保存失败：恢复结果不确定',
      certainty: 'uncertain',
    })
  })

  it('创建提案不会覆盖磁盘上未载入的同 ID CardDocument', async () => {
    cardCatalogActions.loadDocuments([], '/mods/a')
    const proposal = createProposal(cardDocument('DraftCard'))
    const files = persistencePort()
    vi.mocked(files.inspectCardDocument).mockResolvedValue({
      status: 'found',
      document: cardDocument('FinalCard'),
    })

    await expect(persistProposalToCardCatalog('/mods/a', {
      proposal,
      finalCardId: 'FinalCard',
      transactionId: proposal.id,
    }, files)).resolves.toMatchObject({ ok: false, certainty: 'unchanged' })
    expect(files.saveCardDocument).not.toHaveBeenCalled()
    expect(getCardCatalogView().documents).toHaveLength(0)
  })

  it('创建提案在检查后被竞争者占用 ID 时保持 pending 且不修改目录', async () => {
    cardCatalogActions.loadDocuments([], '/mods/a')
    const proposal = createProposal(cardDocument('DraftCard'))
    const files = persistencePort()
    vi.mocked(files.createCardDocument).mockResolvedValue({
      ok: false,
      error: 'Card ID 已被占用（大小写不敏感）',
    })

    await expect(persistProposalToCardCatalog('/mods/a', {
      proposal,
      finalCardId: 'FinalCard',
      transactionId: proposal.id,
    }, files)).resolves.toEqual({
      ok: false,
      error: 'CardDocument 创建失败：Card ID 已被占用（大小写不敏感）',
      certainty: 'unchanged',
    })
    expect(files.saveCardDocument).not.toHaveBeenCalled()
    expect(getCardCatalogView().documents).toHaveLength(0)
  })

  it('重启对账在 update 仍为 base 时前向补写候选 Card', async () => {
    const base = cardDocument('CardA')
    const candidate = { ...base, card: { ...base.card, description: 'accepted candidate' } }
    cardCatalogActions.loadDocuments([base], '/mods/a')
    const proposal = acceptedUpdateProposal(base, candidate)
    const files = persistencePort()

    await expect(reconcilePendingProposalTransition('/mods/a', proposal, files)).resolves.toEqual({ ok: true })
    expect(files.saveCardDocument).toHaveBeenCalledWith('/mods/a', candidate)
    expect(getCardCatalogView().currentCard?.description).toBe('accepted candidate')
  })

  it('重启对账在 accepted create 尚未落盘时才创建最终 ID', async () => {
    cardCatalogActions.loadDocuments([], '/mods/a')
    const proposal = acceptedCreateProposal(cardDocument('DraftCard'), 'FinalCard')
    const files = persistencePort()

    await expect(reconcilePendingProposalTransition('/mods/a', proposal, files)).resolves.toEqual({ ok: true })
    const created = getCardCatalogView().currentDocument!
    expect(created.card.id).toBe('FinalCard')
    expect(created.graph).toMatchObject({ id: 'graph-FinalCard', entityId: 'FinalCard' })
    expect(files.createCardDocument).toHaveBeenCalledWith('/mods/a', created)
  })

  it('未 committed 的 create 不把预先存在的同内容回收站项误认为本事务已创建', async () => {
    cardCatalogActions.loadDocuments([], '/mods/a')
    const proposal = acceptedCreateProposal(cardDocument('DraftCard'), 'FinalCard')
    const trashed = rekeyCreatedCardDocument(proposal.document, 'FinalCard')
    const files = persistencePort()
    files.listTrashedCardDocuments = vi.fn(async () => [trashed])

    await expect(reconcilePendingProposalTransition('/mods/a', proposal, files)).resolves.toMatchObject({ ok: false, certainty: 'uncertain', error: expect.stringContaining('无法确认是否应恢复创建') })
    expect(files.createCardDocument).not.toHaveBeenCalled()
    expect(getCardCatalogView().documents).toEqual([])
  })

  it('未 committed 的 create 只有同时命中本事务 receipt 与回收站事实才尊重后继删除', async () => {
    cardCatalogActions.loadDocuments([], '/mods/a')
    const proposal = acceptedCreateProposal(cardDocument('DraftCard'), 'FinalCard')
    const trashed = rekeyCreatedCardDocument(proposal.document, 'FinalCard')
    const files = persistencePort()
    vi.mocked(files.readCreateReceipt).mockResolvedValue({
      status: 'found',
      receipt: createReceipt(proposal, trashed),
    })
    vi.mocked(files.listTrashedCardDocuments!).mockResolvedValue([trashed])

    await expect(reconcilePendingProposalTransition('/mods/a', proposal, files)).resolves.toEqual({ ok: true })
    expect(files.createCardDocument).not.toHaveBeenCalled()
    expect(files.writeCreateReceipt).not.toHaveBeenCalled()
    expect(getCardCatalogView().documents).toHaveLength(0)
  })

  it('只有本事务 receipt、没有匹配回收站项时仍恢复缺失的 create', async () => {
    cardCatalogActions.loadDocuments([], '/mods/a')
    const proposal = acceptedCreateProposal(cardDocument('DraftCard'), 'FinalCard')
    const created = rekeyCreatedCardDocument(proposal.document, 'FinalCard')
    const files = persistencePort()
    vi.mocked(files.readCreateReceipt).mockResolvedValue({
      status: 'found',
      receipt: createReceipt(proposal, created),
    })

    await expect(reconcilePendingProposalTransition('/mods/a', proposal, files)).resolves.toEqual({ ok: true })
    expect(files.createCardDocument).toHaveBeenCalledWith('/mods/a', created)
    expect(getCardCatalogView().documents).toEqual([created])
  })

  it('同路径 receipt 的事务身份不匹配时拒绝猜测恢复结果', async () => {
    cardCatalogActions.loadDocuments([], '/mods/a')
    const proposal = acceptedCreateProposal(cardDocument('DraftCard'), 'FinalCard')
    const created = rekeyCreatedCardDocument(proposal.document, 'FinalCard')
    const files = persistencePort()
    vi.mocked(files.readCreateReceipt).mockResolvedValue({
      status: 'found',
      receipt: { ...createReceipt(proposal, created), proposalId: 'other-proposal' },
    })
    vi.mocked(files.listTrashedCardDocuments!).mockResolvedValue([created])

    await expect(reconcilePendingProposalTransition('/mods/a', proposal, files)).resolves.toEqual({
      ok: false,
      error: 'Card FinalCard 的创建 receipt 与待恢复事务不一致',
      certainty: 'uncertain',
    })
    expect(files.createCardDocument).not.toHaveBeenCalled()
  })

  it('create 在 CardDocument 落盘后、receipt 前崩溃时补写 receipt 并完成恢复', async () => {
    cardCatalogActions.loadDocuments([], '/mods/a')
    const proposal = acceptedCreateProposal(cardDocument('DraftCard'), 'FinalCard')
    const created = rekeyCreatedCardDocument(proposal.document, 'FinalCard')
    const files = persistencePort()
    vi.mocked(files.inspectCardDocument).mockResolvedValue({ status: 'found', document: created })

    await expect(reconcilePendingProposalTransition('/mods/a', proposal, files)).resolves.toEqual({ ok: true })
    expect(files.createCardDocument).not.toHaveBeenCalled()
    expect(files.writeCreateReceipt).toHaveBeenCalledWith('/mods/a', createReceipt(proposal, created))
    expect(getCardCatalogView().documents).toEqual([created])
  })

  it('receipt 读取失败时不猜测 create 是否曾落盘', async () => {
    cardCatalogActions.loadDocuments([], '/mods/a')
    const proposal = acceptedCreateProposal(cardDocument('DraftCard'), 'FinalCard')
    const files = persistencePort()
    vi.mocked(files.readCreateReceipt).mockResolvedValue({ status: 'error', error: 'EACCES' })

    await expect(reconcilePendingProposalTransition('/mods/a', proposal, files)).resolves.toEqual({
      ok: false,
      error: '无法读取 Card 创建 receipt：EACCES',
      certainty: 'uncertain',
    })
    expect(files.createCardDocument).not.toHaveBeenCalled()
  })

  it('create 已落盘但 receipt 保存失败时返回 uncertain 且不提前修改目录', async () => {
    cardCatalogActions.loadDocuments([], '/mods/a')
    const proposal = createProposal(cardDocument('DraftCard'))
    const files = persistencePort()
    vi.mocked(files.writeCreateReceipt).mockResolvedValue({
      ok: false,
      error: 'receipt 读回失败',
      certainty: 'uncertain',
    })

    await expect(persistProposalToCardCatalog('/mods/a', {
      proposal,
      finalCardId: 'FinalCard',
      transactionId: proposal.id,
    }, files)).resolves.toEqual({
      ok: false,
      error: 'CardDocument 已创建，但创建 receipt 保存失败：receipt 读回失败',
      certainty: 'uncertain',
    })
    expect(files.createCardDocument).toHaveBeenCalledOnce()
    expect(files.writeCreateReceipt).toHaveBeenCalledWith('/mods/a', createReceipt(proposal, rekeyCreatedCardDocument(
      proposal.document,
      'FinalCard',
    )))
    expect(getCardCatalogView().documents).toHaveLength(0)
  })

  it('已 committed 的 create 后续被用户删除时不会被旧 accepted 记录复活', async () => {
    cardCatalogActions.loadDocuments([], '/mods/a')
    const accepted = acceptedCreateProposal(cardDocument('DraftCard'), 'FinalCard')
    const proposal: ConversationCardProposal = {
      ...accepted,
      events: [
        ...accepted.events,
        {
          id: 'event-committed',
          type: 'committed',
          at: '2026-09-01T00:01:01.000Z',
          transactionId: accepted.id,
          transitionEventId: 'event-accepted',
        },
      ],
      updatedAt: '2026-09-01T00:01:01.000Z',
    }
    const files = persistencePort()

    await expect(reconcilePendingProposalTransition('/mods/a', proposal, files)).resolves.toEqual({ ok: true })
    expect(files.createCardDocument).not.toHaveBeenCalled()
    expect(getCardCatalogView().documents).toHaveLength(0)
  })

  it('未 committed 的 create 恢复不会覆盖活动目录中的隔离同名文件', async () => {
    cardCatalogActions.loadDocuments([], '/mods/a')
    const proposal = acceptedCreateProposal(cardDocument('DraftCard'), 'FinalCard')
    const files = persistencePort()
    vi.mocked(files.inspectCardDocument).mockResolvedValue({
      status: 'occupied',
      error: 'FinalCard.json 是 future schema',
    })

    await expect(reconcilePendingProposalTransition('/mods/a', proposal, files)).resolves.toEqual({
      ok: false,
      error: 'Card ID FinalCard 已被不可编辑文件占用，未覆盖',
      certainty: 'uncertain',
    })
    expect(files.createCardDocument).not.toHaveBeenCalled()
    expect(getCardCatalogView().documents).toHaveLength(0)
  })

  it('重启对账可把未 committed 的 undo WAL 前向恢复为 base', async () => {
    const base = cardDocument('CardA')
    const candidate = { ...base, card: { ...base.card, description: 'accepted candidate' } }
    cardCatalogActions.loadDocuments([candidate], '/mods/a')
    const accepted = acceptedUpdateProposal(base, candidate)
    const proposal: ConversationCardProposal = {
      ...accepted,
      status: 'reverted',
      events: [
        ...accepted.events,
        {
          id: 'event-accepted-committed',
          type: 'committed',
          at: '2026-09-01T00:01:01.000Z',
          transactionId: accepted.id,
          transitionEventId: 'event-2',
        },
        {
          id: 'event-reverted',
          type: 'reverted',
          at: '2026-09-01T00:02:00.000Z',
          transactionId: accepted.id,
          document: base,
        },
      ],
      updatedAt: '2026-09-01T00:02:00.000Z',
    }
    const files = persistencePort()

    await expect(reconcilePendingProposalTransition('/mods/a', proposal, files)).resolves.toEqual({ ok: true })
    expect(files.saveCardDocument).toHaveBeenCalledWith('/mods/a', base)
    expect(getCardCatalogView().currentCard?.description).toBe(base.card.description)
  })

  it('重启对账遇到合法后继 revision 时以项目实际状态为准并确认日志', async () => {
    const base = cardDocument('CardA')
    const candidate = { ...base, card: { ...base.card, description: 'accepted candidate' } }
    const thirdParty = { ...base, card: { ...base.card, description: 'user changed again' } }
    cardCatalogActions.loadDocuments([thirdParty], '/mods/a')
    const files = persistencePort()

    const result = await reconcilePendingProposalTransition('/mods/a', acceptedUpdateProposal(base, candidate), files)
    expect(result).toEqual({ ok: true })
    expect(files.saveCardDocument).not.toHaveBeenCalled()
    expect(getCardCatalogView().currentCard?.description).toBe('user changed again')
  })
})

function createProposal(document: CardDocument): ConversationCardProposal {
  return {
    id: 'proposal-1',
    operation: 'create',
    targetCardId: document.card.id,
    baseRevision: null,
    document,
    status: 'pending',
    provenance: { turnId: 'turn-1', attemptId: 'attempt-1' },
    projectReferences: [],
    events: [{ id: 'event-1', type: 'proposed', at: '2026-09-01T00:00:00.000Z' }],
    createdAt: '2026-09-01T00:00:00.000Z',
    updatedAt: '2026-09-01T00:00:00.000Z',
  }
}

function acceptedUpdateProposal(base: CardDocument, document: CardDocument): ConversationCardProposal {
  return {
    id: 'proposal-update',
    operation: 'update',
    targetCardId: base.card.id,
    baseRevision: cardDocumentRevision(base),
    document,
    status: 'accepted',
    provenance: { turnId: 'turn-1', attemptId: 'attempt-1' },
    projectReferences: [],
    events: [
      { id: 'event-1', type: 'proposed', at: '2026-09-01T00:00:00.000Z' },
      {
        id: 'event-2',
        type: 'accepted',
        at: '2026-09-01T00:01:00.000Z',
        transactionId: 'proposal-update',
        finalCardId: base.card.id,
      },
    ],
    createdAt: '2026-09-01T00:00:00.000Z',
    updatedAt: '2026-09-01T00:01:00.000Z',
  }
}

function acceptedCreateProposal(document: CardDocument, finalCardId: string): ConversationCardProposal {
  const proposal = createProposal(document)
  return {
    ...proposal,
    status: 'accepted',
    events: [
      ...proposal.events,
      {
        id: 'event-accepted',
        type: 'accepted',
        at: '2026-09-01T00:01:00.000Z',
        transactionId: proposal.id,
        finalCardId,
      },
    ],
    updatedAt: '2026-09-01T00:01:00.000Z',
  }
}

function persistencePort(options: {
  save?: { ok: true } | { ok: false; error: string; certainty?: 'unchanged' | 'uncertain' }
} = {}): ProposalCardPersistencePort {
  return {
    saveCardDocument: vi.fn(async () => options.save ?? { ok: true as const }),
    createCardDocument: vi.fn(async () => options.save ?? { ok: true as const }),
    inspectCardDocument: vi.fn(async () => ({ status: 'missing' as const })),
    listTrashedCardDocuments: vi.fn(async () => []),
    readCreateReceipt: vi.fn(async () => ({ status: 'missing' as const })),
    writeCreateReceipt: vi.fn(async () => ({ ok: true as const })),
  }
}

function createReceipt(proposal: ConversationCardProposal, document: CardDocument): ProposalCreateReceipt {
  return {
    schemaVersion: 1,
    proposalId: proposal.id,
    transactionId: proposal.id,
    finalCardId: document.card.id,
    documentRevision: cardDocumentRevision(document),
  }
}

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>(res => { resolve = res })
  return { promise, resolve }
}

function cardDocument(id: string): CardDocument {
  return {
    schemaVersion: 2,
    card: { id, name: id, cost: 1, type: 'Attack', rarity: 'Common', description: '', keywords: [] },
    graph: {
      id: `graph-${id}`,
      entityId: id,
      entityType: 'card',
      version: '0.1.0',
      nodes: [],
      edges: [],
      metadata: { createdAt: '2026-09-01T00:00:00.000Z', updatedAt: '2026-09-01T00:00:00.000Z' },
    },
    generation: { lastGeneratedFingerprint: null },
  }
}

function effectNode(id: string, kind: string, cardId: string) {
  return { id, type: 'effect' as const, position: { x: 10, y: 20 }, data: { kind, cardId } }
}
