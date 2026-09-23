import { act, render, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ConversationDocument } from './conversationDocument'
import type { ConversationRepository, ConversationSaveResult } from './conversationRepository'
import { ProjectConversation, type ConversationModel } from './projectConversation'
import {
  ProjectConversationProvider,
  useProjectConversationActions,
  type ProjectConversationActions,
} from './ProjectConversationContext'
import { cardCatalogActions, getCardCatalogView } from '../card/cardCatalog'
import { cardDocumentRevision, createCardProposal } from '../card/cardAiProposal'
import type { CardDocument } from '../card/cardDocument'
import { hasCardPersistenceFailure, isCardPersistenceBlocked } from '../card/cardPersistenceBarrier'
import type { ConversationCardProposal } from './proposalLifecycle'
import { registerProjectCardFlusher } from '../card/cardPersistenceCoordinator'
import {
  createProposalCardApplication,
  type ProposalCardApplication,
  type ProposalCardPersistencePort,
} from './proposalApplication'

const NOW = '2026-09-03T05:00:00.000Z'

afterEach(() => cardCatalogActions.clear())

describe('ProjectConversationProvider 项目切换守卫', () => {
  it('发送预保存尚未完成时也阻止未确认的项目切换', async () => {
    const firstSave = deferred<ConversationSaveResult>()
    const repository = repositoryWithSaves([firstSave.promise, Promise.resolve({ ok: true })])
    const model = successModel('完成')
    const actions = renderActions(repository, model)
    await waitFor(() => expect(repository.load).toHaveBeenCalledTimes(1))

    let send!: ReturnType<ProjectConversationActions['send']>
    act(() => { send = actions.current.send('开始') })
    await waitFor(() => expect(repository.save).toHaveBeenCalledTimes(1))

    const confirmSwitch = vi.fn(() => false)
    await expect(actions.current.prepareForProjectSwitch(confirmSwitch)).resolves.toBe(false)
    expect(confirmSwitch).toHaveBeenCalledTimes(1)
    expect(actions.current.isRunning()).toBe(true)

    firstSave.resolve({ ok: true })
    await act(async () => { await send })
  })

  it('确认切换会串行等待预保存、持久化取消，并屏蔽迟到响应', async () => {
    const firstSave = deferred<ConversationSaveResult>()
    const repository = repositoryWithSaves([firstSave.promise, Promise.resolve({ ok: true })])
    const response = deferred<{ success: true; content: string }>()
    const model: ConversationModel = { respond: vi.fn(() => response.promise) }
    const actions = renderActions(repository, model)
    await waitFor(() => expect(repository.load).toHaveBeenCalledTimes(1))

    let send!: ReturnType<ProjectConversationActions['send']>
    act(() => { send = actions.current.send('开始') })
    await waitFor(() => expect(repository.save).toHaveBeenCalledTimes(1))
    const prepare = actions.current.prepareForProjectSwitch(() => true)

    firstSave.resolve({ ok: true })
    await expect(prepare).resolves.toBe(true)
    expect(repository.current?.turns.at(-1)?.attempts.at(-1)?.status).toBe('cancelled')

    response.resolve({ success: true, content: responseText('迟到回复') })
    await expect(send).resolves.toMatchObject({ ok: false, code: 'cancelled' })
    expect(repository.current?.turns.at(-1)?.assistantText).toBeNull()
  })

  it('取消状态保存失败时拒绝项目切换', async () => {
    const repository = repositoryWithSaves([
      Promise.resolve({ ok: true }),
      Promise.resolve({ ok: false, error: 'EACCES', certainty: 'unchanged' }),
    ])
    const response = deferred<{ success: true; content: string }>()
    const model: ConversationModel = { respond: vi.fn(() => response.promise) }
    const actions = renderActions(repository, model)
    await waitFor(() => expect(repository.load).toHaveBeenCalledTimes(1))

    let send!: ReturnType<ProjectConversationActions['send']>
    act(() => { send = actions.current.send('开始') })
    await waitFor(() => expect(model.respond).toHaveBeenCalledTimes(1))

    await expect(actions.current.prepareForProjectSwitch(() => true)).resolves.toBe(false)
    await expect(actions.current.prepareForProjectSwitch(() => true)).resolves.toBe(false)
    response.resolve({ success: true, content: responseText('迟到回复') })
    await expect(send).resolves.toMatchObject({ ok: false, code: 'cancelled' })
  })

  it('Card 草稿 flush 失败时阻止项目切换', async () => {
    const repository = repositoryWithSaves([])
    const actions = renderActions(repository, successModel('不会调用'))
    const unregister = registerProjectCardFlusher('/mods/a', async () => ({
      ok: false,
      error: 'CardA 自动保存失败',
    }))
    try {
      await waitFor(() => expect(repository.load).toHaveBeenCalledTimes(1))
      await expect(actions.current.prepareForProjectSwitch()).resolves.toBe(false)
      await expect(actions.current.send('不能继续')).resolves.toMatchObject({
        ok: false,
        code: 'persistence',
      })
    } finally {
      unregister()
    }
  })

  it('预保存结果不确定时不得被空取消绕过项目切换守卫', async () => {
    const firstSave = deferred<ConversationSaveResult>()
    const repository = repositoryWithSaves([firstSave.promise])
    const actions = renderActions(repository, successModel('不应发送'))
    await waitFor(() => expect(repository.load).toHaveBeenCalledTimes(1))

    let send!: ReturnType<ProjectConversationActions['send']>
    act(() => { send = actions.current.send('开始') })
    await waitFor(() => expect(repository.save).toHaveBeenCalledTimes(1))

    const prepare = actions.current.prepareForProjectSwitch(() => true)
    firstSave.resolve({ ok: false, error: '原子保存结果不确定', certainty: 'uncertain' })

    await expect(prepare).resolves.toBe(false)
    await expect(send).resolves.toMatchObject({ ok: false, code: 'persistence' })
    await expect(actions.current.prepareForProjectSwitch(() => true)).resolves.toBe(false)
  })

  it('接受提案仍在保存 Card 时等待，完成后才允许项目切换', async () => {
    const repository = repositoryWithSaves([])
    const candidate = cardDocument('DraftCard', '候选')
    cardCatalogActions.loadDocuments([], '/mods/a')
    const cardSave = deferred<{ ok: true } | { ok: false; error: string }>()
    const files: ProposalCardPersistencePort = {
      saveCardDocument: vi.fn(() => cardSave.promise),
      createCardDocument: vi.fn(() => cardSave.promise),
      inspectCardDocument: vi.fn(async () => ({ status: 'missing' as const })),
      readCreateReceipt: vi.fn(async () => ({ status: 'missing' as const })),
      writeCreateReceipt: vi.fn(async () => ({ ok: true as const })),
    }
    const model = proposalModel({ operation: 'create', document: candidate })
    const actions = renderActions(
      repository,
      model,
      createProposalCardApplication('/mods/a', files),
    )
    await waitFor(() => expect(repository.load).toHaveBeenCalledTimes(1))
    await act(async () => { await actions.current.send('创建 Card') })
    const proposalId = repository.current!.proposals[0].id

    let accepted!: ReturnType<ProjectConversationActions['acceptProposal']>
    act(() => { accepted = actions.current.acceptProposal(proposalId, 'FinalCard') })
    await waitFor(() => expect(files.createCardDocument).toHaveBeenCalledTimes(1))
    expect(isCardPersistenceBlocked('/mods/a', 'FinalCard')).toBe(true)
    await expect(actions.current.send('Card 事务完成前不应排队发送')).resolves.toMatchObject({
      ok: false,
      code: 'already-running',
    })
    expect(model.respond).toHaveBeenCalledTimes(1)
    let switchSettled = false
    const prepare = actions.current.prepareForProjectSwitch().then(result => {
      switchSettled = true
      return result
    })
    await Promise.resolve()
    expect(switchSettled).toBe(false)
    await expect(actions.current.send('切换开始后不应再发送')).resolves.toMatchObject({
      ok: false,
      code: 'persistence',
    })
    expect(model.respond).toHaveBeenCalledTimes(1)

    cardSave.resolve({ ok: true })
    await expect(accepted).resolves.toEqual({ ok: true })
    expect(isCardPersistenceBlocked('/mods/a', 'FinalCard')).toBe(false)
    await expect(prepare).resolves.toBe(true)
  })

  it('history Card 保存失败后保留 WAL，并经二次确认允许离开项目恢复', async () => {
    const repository = repositoryWithSaves([])
    const current = cardDocument('CardA', '旧内容')
    const candidate = { ...current, card: { ...current.card, description: '提案内容' } }
    cardCatalogActions.loadDocuments([current], '/mods/a')
    const files = successfulCardFiles()
    vi.mocked(files.saveCardDocument)
      .mockResolvedValueOnce({ ok: true })
      .mockResolvedValueOnce({ ok: false, error: 'EACCES' })
    const proposed = {
      operation: 'update',
      targetCardId: 'CardA',
      baseRevision: cardDocumentRevision(current),
      document: candidate,
    }
    const model: ConversationModel = {
      respond: vi.fn()
        .mockResolvedValueOnce({
          success: true as const,
          content: JSON.stringify({ schemaVersion: 1, text: '完成', quickReplies: [], proposals: [proposed] }),
        })
        .mockResolvedValueOnce({ success: false as const, error: 'provider 暂时失败' })
        .mockResolvedValueOnce({ success: true as const, content: responseText('不应重试') }),
    }
    const actions = renderActions(repository, model, createProposalCardApplication('/mods/a', files))
    await waitFor(() => expect(repository.load).toHaveBeenCalledTimes(1))
    await act(async () => {
      await actions.current.send('修改 CardA', [{ cardId: 'CardA', revision: cardDocumentRevision(current) }])
      const proposalId = repository.current!.proposals[0].id
      await actions.current.acceptProposal(proposalId, 'CardA')
    })
    await expect(actions.current.send('产生可重试失败轮次')).resolves.toMatchObject({ ok: false, code: 'provider' })
    const failedTurnId = repository.current!.turns.at(-1)!.id

    act(() => cardCatalogActions.undo())
    await waitFor(() => expect(repository.current!.proposals[0].status).toBe('reverted'))
    expect(repository.current!.proposals[0].events.at(-1)?.type).toBe('reverted')
    const decline = vi.fn(() => false)
    await expect(actions.current.retryTurn(failedTurnId)).resolves.toMatchObject({
      ok: false,
      code: 'persistence',
    })
    expect(model.respond).toHaveBeenCalledTimes(2)
    await expect(actions.current.prepareForProjectSwitch(decline)).resolves.toBe(false)
    expect(decline).toHaveBeenCalledOnce()
    await expect(actions.current.prepareForProjectSwitch(() => true)).resolves.toBe(true)
  })
})

describe('ProjectConversationProvider 提案动作', () => {
  it('创建提案在接受前不占 ID，接受时把完整图 rekey 后加入目录', async () => {
    const repository = repositoryWithSaves([])
    const candidate = cardDocument('DraftCard', '候选')
    candidate.graph.nodes = [{
      id: 'add-self',
      type: 'effect',
      position: { x: 18, y: 32 },
      data: { kind: 'addCardToHand', cardId: 'DraftCard' },
    }]
    cardCatalogActions.loadDocuments([cardDocument('Existing', '已有')], '/mods/a')
    const actions = renderActions(repository, proposalModel({ operation: 'create', document: candidate }))
    await waitFor(() => expect(repository.load).toHaveBeenCalledTimes(1))

    await act(async () => { await actions.current.send('创建 Card') })
    const proposalId = repository.current!.proposals[0].id
    expect(getCardCatalogView().cards.map(card => card.id)).toEqual(['Existing'])

    await expect(actions.current.acceptProposal(proposalId, 'FinalCard')).resolves.toEqual({ ok: true })
    const created = getCardCatalogView().currentDocument!
    expect(created.card.id).toBe('FinalCard')
    expect(created.graph).toMatchObject({ id: 'graph-FinalCard', entityId: 'FinalCard' })
    expect(created.graph.nodes[0]).toMatchObject({
      position: { x: 18, y: 32 },
      data: { kind: 'addCardToHand', cardId: 'FinalCard' },
    })
  })

  it('创建提案遇到正常 ID 冲突不会把现有 Card 标成持久化失败', async () => {
    const repository = repositoryWithSaves([])
    const existing = cardDocument('FinalCard', '用户已有内容')
    const candidate = cardDocument('DraftCard', '候选')
    cardCatalogActions.loadDocuments([existing], '/mods/a')
    const actions = renderActions(repository, proposalModel({ operation: 'create', document: candidate }))
    await waitFor(() => expect(repository.load).toHaveBeenCalledTimes(1))
    await act(async () => { await actions.current.send('创建 Card') })

    const proposalId = repository.current!.proposals[0].id
    await expect(actions.current.acceptProposal(proposalId, 'FinalCard')).resolves.toMatchObject({
      ok: false,
      code: 'duplicate-card-id',
    })
    expect(hasCardPersistenceFailure('/mods/a', 'FinalCard')).toBe(false)
    expect(getCardCatalogView().currentCard?.description).toBe('用户已有内容')
  })

  it('接受 update 自动选中目标并只生成一个 Card 历史事务，undo/redo 同步提案状态', async () => {
    const repository = repositoryWithSaves([])
    const current = cardDocument('CardA', '旧内容')
    const other = cardDocument('CardB', '另一张')
    cardCatalogActions.loadDocuments([current, other], '/mods/a')
    cardCatalogActions.selectCard('CardB')
    const candidate = { ...current, card: { ...current.card, description: '提案内容' } }
    const files = successfulCardFiles()
    const actions = renderActions(repository, proposalModel({
      operation: 'update',
      targetCardId: 'CardA',
      baseRevision: cardDocumentRevision(current),
      document: candidate,
    }), createProposalCardApplication('/mods/a', files))
    await waitFor(() => expect(repository.load).toHaveBeenCalledTimes(1))

    let sent!: Awaited<ReturnType<ProjectConversationActions['send']>>
    await act(async () => {
      sent = await actions.current.send('修改 CardA', [{
        cardId: 'CardA',
        revision: cardDocumentRevision(current),
      }])
    })
    expect(sent).toEqual({ ok: true })
    const proposalId = repository.current!.proposals[0].id
    await expect(actions.current.acceptProposal(proposalId, 'CardA')).resolves.toEqual({ ok: true })
    expect(getCardCatalogView()).toMatchObject({ selectedCardId: 'CardA', canUndo: true })
    expect(getCardCatalogView().currentCard?.description).toBe('提案内容')

    act(() => cardCatalogActions.undo())
    expect(getCardCatalogView().currentCard?.description).toBe('旧内容')
    expect(getCardCatalogView()).toMatchObject({ canUndo: false, canRedo: true })
    await waitFor(() => expect(repository.current!.proposals[0].status).toBe('reverted'))
    expect(files.saveCardDocument).toHaveBeenNthCalledWith(2, '/mods/a', current)

    act(() => cardCatalogActions.redo())
    expect(getCardCatalogView().currentCard?.description).toBe('提案内容')
    expect(getCardCatalogView()).toMatchObject({ canUndo: true, canRedo: false })
    await waitFor(() => expect(repository.current!.proposals[0].status).toBe('accepted'))
    expect(files.saveCardDocument).toHaveBeenNthCalledWith(3, '/mods/a', candidate)
    expect(repository.current!.proposals[0].events.map(event => event.type)).toEqual([
      'proposed', 'accepted', 'committed', 'reverted', 'committed', 'restored', 'committed',
    ])
  })

  it('快速 undo→redo 逐事件执行 WAL→Card→committed，后继状态不会越过自己的 WAL', async () => {
    const undoWal = deferred<ConversationSaveResult>()
    const immediate = Promise.resolve({ ok: true as const })
    const repository = repositoryWithSaves([
      immediate, immediate, // send running / completed
      immediate, immediate, // accepted WAL / committed
      undoWal.promise,
      immediate, // undo committed
      immediate, immediate, // redo WAL / committed
    ])
    const base = cardDocument('CardA', '旧内容')
    const candidate = { ...base, card: { ...base.card, description: '提案内容' } }
    const files = successfulCardFiles()
    cardCatalogActions.loadDocuments([base], '/mods/a')
    const actions = renderActions(repository, proposalModel({
      operation: 'update',
      targetCardId: 'CardA',
      baseRevision: cardDocumentRevision(base),
      document: candidate,
    }), createProposalCardApplication('/mods/a', files))
    await waitFor(() => expect(repository.load).toHaveBeenCalledTimes(1))
    await act(async () => {
      await actions.current.send('修改 CardA', [{ cardId: 'CardA', revision: cardDocumentRevision(base) }])
      await actions.current.acceptProposal(repository.current!.proposals[0].id, 'CardA')
    })

    act(() => {
      cardCatalogActions.undo()
      cardCatalogActions.redo()
    })
    await waitFor(() => expect(repository.save).toHaveBeenCalledTimes(5))
    expect(isCardPersistenceBlocked('/mods/a', 'CardA')).toBe(true)
    expect(files.saveCardDocument).toHaveBeenCalledTimes(1)

    undoWal.resolve({ ok: true })
    await waitFor(() => expect(repository.current!.proposals[0].events.map(event => event.type)).toEqual([
      'proposed', 'accepted', 'committed', 'reverted', 'committed', 'restored', 'committed',
    ]))
    expect(files.saveCardDocument).toHaveBeenNthCalledWith(2, '/mods/a', base)
    expect(files.saveCardDocument).toHaveBeenNthCalledWith(3, '/mods/a', candidate)
    expect(isCardPersistenceBlocked('/mods/a', 'CardA')).toBe(false)
  })

  it('忽略其他项目 CardCatalog 发出的 undo/redo 提案事件', async () => {
    const repository = repositoryWithSaves([])
    const conversation = new ProjectConversation('/mods/a', repository, successModel('完成'), () => new Date(NOW), sequentialIds())
    const historySpy = vi.spyOn(conversation, 'recordProposalHistory')
    render(
      <ProjectConversationProvider projectRoot="/mods/a" createConversation={() => conversation}>
        <ActionProbe onRender={() => undefined} />
      </ProjectConversationProvider>,
    )
    await waitFor(() => expect(repository.load).toHaveBeenCalledTimes(1))
    const current = cardDocument('CardB', '旧')
    const candidate = { ...current, card: { ...current.card, description: '新' } }
    cardCatalogActions.loadDocuments([current], '/mods/b')
    const proposal = createCardProposal(current, candidate)
    if (proposal.status !== 'ready') throw new Error('测试提案无效')
    cardCatalogActions.applyProposal(proposal.proposal, {
      provenance: { kind: 'ai-proposal', proposalId: 'proposal-b', transactionId: 'proposal-b' },
    })

    act(() => cardCatalogActions.undo())
    act(() => cardCatalogActions.redo())
    await Promise.resolve()
    expect(historySpy).not.toHaveBeenCalled()
  })

  it('启动时发现 accepted update 仍停在 base，会先保存并前向恢复目录', async () => {
    const base = cardDocument('CardA', '旧内容')
    const candidate = { ...base, card: { ...base.card, description: '提案内容' } }
    const proposal = acceptedUpdateProposal(base, candidate)
    const repository = repositoryWithSaves([], conversationDocumentWith(proposal))
    const files = successfulCardFiles()
    cardCatalogActions.loadDocuments([base], '/mods/a')

    renderActions(
      repository,
      successModel('unused'),
      createProposalCardApplication('/mods/a', files),
    )

    await waitFor(() => expect(getCardCatalogView().currentCard?.description).toBe('提案内容'))
    expect(files.saveCardDocument).toHaveBeenCalledWith('/mods/a', candidate)
  })

  it('启动对账遇到合法后继 revision 会确认旧日志且不覆盖 Card', async () => {
    const base = cardDocument('CardA', '旧内容')
    const candidate = { ...base, card: { ...base.card, description: '提案内容' } }
    const thirdParty = { ...base, card: { ...base.card, description: '用户后续修改' } }
    const repository = repositoryWithSaves([], conversationDocumentWith(acceptedUpdateProposal(base, candidate)))
    const files = successfulCardFiles()
    const application = createProposalCardApplication('/mods/a', files)
    const reconcile = vi.spyOn(application, 'reconcile')
    cardCatalogActions.loadDocuments([thirdParty], '/mods/a')
    const actions = renderActions(repository, successModel('unused'), application)

    await waitFor(() => expect(reconcile).toHaveBeenCalledTimes(1))
    await expect(actions.current.prepareForProjectSwitch()).resolves.toBe(true)
    expect(files.saveCardDocument).not.toHaveBeenCalled()
    expect(getCardCatalogView().currentCard?.description).toBe('用户后续修改')
    expect(repository.current!.proposals[0].events.at(-1)?.type).toBe('committed')
  })
})

function renderActions(
  repository: TestRepository,
  model: ConversationModel,
  proposalApplication?: ProposalCardApplication,
) {
  const actions: { current: ProjectConversationActions } = {} as { current: ProjectConversationActions }
  const conversation = new ProjectConversation(
    '/mods/a',
    repository,
    model,
    () => new Date(NOW),
    sequentialIds(),
    () => {
      const catalog = getCardCatalogView()
      return catalog.sourceProjectRoot === '/mods/a' ? catalog.documents : []
    },
  )
  render(
    <ProjectConversationProvider
      projectRoot="/mods/a"
      createConversation={() => conversation}
      createProposalApplication={() => proposalApplication ?? createProposalCardApplication('/mods/a', successfulCardFiles())}
    >
      <ActionProbe onRender={value => { actions.current = value }} />
    </ProjectConversationProvider>,
  )
  return actions
}

function successfulCardFiles(): ProposalCardPersistencePort {
  return {
    saveCardDocument: vi.fn(async () => ({ ok: true as const })),
    createCardDocument: vi.fn(async () => ({ ok: true as const })),
    inspectCardDocument: vi.fn(async () => ({ status: 'missing' as const })),
    readCreateReceipt: vi.fn(async () => ({ status: 'missing' as const })),
    writeCreateReceipt: vi.fn(async () => ({ ok: true as const })),
  }
}

function ActionProbe({ onRender }: { onRender: (actions: ProjectConversationActions) => void }) {
  onRender(useProjectConversationActions())
  return null
}

type TestRepository = ConversationRepository & { current: ConversationDocument | null }

function repositoryWithSaves(
  saves: Array<Promise<ConversationSaveResult>>,
  initial: ConversationDocument | null = null,
): TestRepository {
  let current: ConversationDocument | null = initial
  let saveIndex = 0
  return {
    get current() { return current },
    load: vi.fn(async () => current
      ? { status: 'loaded' as const, document: structuredClone(current) }
      : { status: 'missing' as const }),
    save: vi.fn(async (_projectRoot, document) => {
      const result = await (saves[saveIndex++] ?? Promise.resolve({ ok: true as const }))
      if (result.ok) current = structuredClone(document)
      return result
    }),
  }
}

function conversationDocumentWith(proposal: ConversationCardProposal): ConversationDocument {
  return {
    schemaVersion: 3,
    turns: [],
    proposals: [proposal],
    createdAt: NOW,
    updatedAt: proposal.updatedAt,
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
      { id: 'event-1', type: 'proposed', at: NOW },
      {
        id: 'event-2',
        type: 'accepted',
        at: '2026-09-03T05:01:00.000Z',
        transactionId: 'proposal-update',
        finalCardId: base.card.id,
      },
    ],
    createdAt: NOW,
    updatedAt: '2026-09-03T05:01:00.000Z',
  }
}

function successModel(text: string): ConversationModel {
  return { respond: vi.fn(async () => ({ success: true as const, content: responseText(text) })) }
}

function responseText(text: string): string {
  return JSON.stringify({ schemaVersion: 1, text, quickReplies: [], proposals: [] })
}

function proposalModel(proposal: unknown): ConversationModel {
  return {
    respond: vi.fn(async () => ({
      success: true as const,
      content: JSON.stringify({ schemaVersion: 1, text: '完成', quickReplies: [], proposals: [proposal] }),
    })),
  }
}

function cardDocument(id: string, description: string): CardDocument {
  return {
    schemaVersion: 2,
    card: { id, name: id, cost: 1, type: 'Attack', rarity: 'Common', description, keywords: [] },
    graph: {
      id: `graph-${id}`,
      entityId: id,
      entityType: 'card',
      version: '0.1.0',
      nodes: [],
      edges: [],
      metadata: { createdAt: NOW, updatedAt: NOW },
    },
    generation: { lastGeneratedFingerprint: null },
  }
}

function sequentialIds() {
  let value = 1
  return () => `id-${value++}`
}

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>(next => { resolve = next })
  return { promise, resolve }
}
