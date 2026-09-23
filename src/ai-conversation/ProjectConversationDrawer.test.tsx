import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createEmptyGraph } from '../node-editor/graph'
import { cardCatalogActions, getCardCatalogView } from '../card/cardCatalog'
import { cardDocumentRevision } from '../card/cardAiProposal'
import type { CardDocument } from '../card/cardDocument'
import type { ConversationDocument } from './conversationDocument'
import type { ConversationLoadResult, ConversationRepository } from './conversationRepository'
import { ProjectConversation, type ConversationModel } from './projectConversation'
import { ProjectConversationProvider } from './ProjectConversationContext'
import { ProjectConversationDrawer } from './ProjectConversationDrawer'
import {
  createProposalCardApplication,
  type ProposalCardPersistencePort,
} from './proposalApplication'
import type { ConversationCardProposal, ConversationProposalEvent } from './proposalLifecycle'

const NOW = '2026-09-02T01:00:00.000Z'

beforeEach(() => {
  cardCatalogActions.clear()
  setNarrow(false)
})

afterEach(() => { vi.unstubAllGlobals() })

describe('ProjectConversationDrawer', () => {
  it('缺少历史时不创建空文档，首次消息完成后显示回复', async () => {
    const repository = memoryRepository({ status: 'missing' })
    const model = successModel('我们先确定项目主题。')
    renderDrawer('/mods/quiet-depth', repository, model)

    expect(await screen.findByText('从项目目标开始')).toBeTruthy()
    expect(repository.save).not.toHaveBeenCalled()

    fireEvent.change(screen.getByLabelText('发送给项目 AI 的消息'), { target: { value: '做一个冰系项目' } })
    fireEvent.click(screen.getByRole('button', { name: '发送' }))

    expect(await screen.findByText('我们先确定项目主题。')).toBeTruthy()
    expect(repository.save).toHaveBeenCalledTimes(2)
    expect((screen.getByLabelText('发送给项目 AI 的消息') as HTMLTextAreaElement).value).toBe('')
  })

  it('压缩目录且省略较早消息时，为该轮提供可访问的中文上下文说明', async () => {
    const document = completedDocument()
    document.turns[0].contextSnapshot = {
      directoryTier: 'compact',
      contextWindowTokens: 8000,
      reservedOutputTokens: 1000,
      reservedExpansionTokens: 500,
      estimatedInputTokens: 5000,
      estimatedTotalTokens: 6500,
      omittedMessageCount: 3,
      includedTurnIds: ['turn-1'],
      providedCards: [],
    }
    renderDrawer('/mods/quiet-depth', memoryRepository({ status: 'loaded', document }), successModel('不会调用'))

    const notice = await screen.findByRole('note')
    expect(notice.textContent).toContain('精简版项目目录上下文')
    expect(notice.textContent).toContain('省略了 3 条较早的对话消息')
  })


  it('仅目录降级或仅历史省略时也会分别披露', async () => {
    const compact = completedDocument()
    compact.turns[0].contextSnapshot = {
      directoryTier: 'compact',
      contextWindowTokens: 8000,
      reservedOutputTokens: 1000,
      reservedExpansionTokens: 500,
      estimatedInputTokens: 5000,
      estimatedTotalTokens: 6500,
      omittedMessageCount: 0,
      includedTurnIds: ['turn-1'],
      providedCards: [],
    }
    const first = renderDrawer('/mods/quiet-depth', memoryRepository({ status: 'loaded', document: compact }), successModel('不会调用'))
    expect((await screen.findByRole('note')).textContent).toContain('精简版项目目录上下文')
    first.unmount()

    const omitted = completedDocument()
    omitted.turns[0].contextSnapshot = {
      directoryTier: 'detailed',
      contextWindowTokens: 8000,
      reservedOutputTokens: 1000,
      reservedExpansionTokens: 500,
      estimatedInputTokens: 6000,
      estimatedTotalTokens: 7500,
      omittedMessageCount: 2,
      includedTurnIds: ['turn-1'],
      providedCards: [],
    }
    renderDrawer('/mods/quiet-depth', memoryRepository({ status: 'loaded', document: omitted }), successModel('不会调用'))
    expect((await screen.findByRole('note')).textContent).toContain('省略了 2 条较早的对话消息')
  })

  it('未记录上下文快照时不显示上下文说明', async () => {
    renderDrawer('/mods/quiet-depth', memoryRepository({ status: 'loaded', document: completedDocument() }), successModel('不会调用'))

    await screen.findByText('先明确玩法主线。')
    expect(screen.queryByRole('note')).toBeNull()
  })

  it('快捷回答带来源填入草稿，编辑后取消关联', async () => {
    const repository = memoryRepository({ status: 'loaded', document: completedDocument() })
    const model = successModel('收到。')
    renderDrawer('/mods/quiet-depth', repository, model)

    const quickReply = await screen.findByRole('button', { name: '继续完善' })
    fireEvent.click(quickReply)

    expect((screen.getByLabelText('发送给项目 AI 的消息') as HTMLTextAreaElement).value).toBe('继续完善')
    expect(model.respond).not.toHaveBeenCalled()

    fireEvent.change(screen.getByLabelText('发送给项目 AI 的消息'), { target: { value: '继续完善伤害曲线' } })
    expect(quickReply.className).not.toContain('is-selected')
    expect(model.respond).not.toHaveBeenCalled()

    fireEvent.click(screen.getByRole('button', { name: '发送' }))
    await waitFor(() => expect(model.respond).toHaveBeenCalledTimes(1))
    expect(repository.current?.turns.at(-1)?.quickReplySelection).toBeNull()
  })

  it('快捷回答未经编辑发送时持久化来源 turnId 与 replyId', async () => {
    const repository = memoryRepository({ status: 'loaded', document: completedDocument() })
    const model = successModel('收到。')
    renderDrawer('/mods/quiet-depth', repository, model)

    fireEvent.click(await screen.findByRole('button', { name: '继续完善' }))
    fireEvent.click(screen.getByRole('button', { name: '发送' }))

    await waitFor(() => expect(model.respond).toHaveBeenCalledTimes(1))
    expect(repository.current?.turns.at(-1)?.quickReplySelection).toEqual({
      turnId: 'turn-1',
      replyId: 'continue',
    })
  })

  it('显式 Card 附件在发送时记录当前 revision，不默认附加当前 Card', async () => {
    const document = cardDocument('FrostArc', '霜弧')
    cardCatalogActions.loadDocuments([document], '/mods/quiet-depth')
    const repository = memoryRepository({ status: 'missing' })
    const model = successModel('已读取附件。')
    renderDrawer('/mods/quiet-depth', repository, model)
    await screen.findByText('从项目目标开始')

    fireEvent.change(screen.getByLabelText('发送给项目 AI 的消息'), { target: { value: '先讨论这张卡' } })
    expect(screen.queryByLabelText('已添加的 Card 上下文')).toBeNull()

    fireEvent.change(screen.getByLabelText('添加 Card 上下文'), { target: { value: 'FrostArc' } })
    expect(screen.getByLabelText('已添加的 Card 上下文').textContent).toContain('@FrostArc')
    fireEvent.click(screen.getByRole('button', { name: '发送' }))

    await waitFor(() => expect(model.respond).toHaveBeenCalledTimes(1))
    const request = vi.mocked(model.respond).mock.calls[0][0]
    expect(request.turns.at(-1)?.attachments).toEqual([{
      cardId: 'FrostArc',
      revision: cardDocumentRevision(document),
    }])
  })

  it('同一轮的多个 Card 提案都显示在项目抽屉中', async () => {
    const document = completedDocument()
    document.proposals = [
      proposal('proposal-a', cardDocument('CardA', 'A1'), 'create'),
      proposal('proposal-b', cardDocument('CardB', 'B1'), 'create'),
    ]

    renderDrawer('/mods/quiet-depth', memoryRepository({ status: 'loaded', document }), successModel('不会调用'))

    expect(await screen.findByRole('button', { name: /@CardA.*创建新 Card/ })).toBeTruthy()
    expect(screen.getByRole('button', { name: /@CardB.*创建新 Card/ })).toBeTruthy()
    expect(screen.getByLabelText('2 个提案')).toBeTruthy()
  })

  it('预览 update 时先刷新提案，再定位 Card 并通知 App 打开编辑器', async () => {
    const first = cardDocument('CardA', 'A0')
    const target = cardDocument('CardB', 'B0')
    const candidate = cardDocument('CardB', 'B1')
    cardCatalogActions.loadDocuments([first, target], '/mods/quiet-depth')
    const document = completedDocument()
    document.proposals = [proposal(
      'proposal-update',
      candidate,
      'update',
      'pending',
      cardDocumentRevision(target),
    )]
    const onOpenCard = vi.fn()
    renderDrawer(
      '/mods/quiet-depth',
      memoryRepository({ status: 'loaded', document }),
      successModel('不会调用'),
      onOpenCard,
    )

    fireEvent.click(await screen.findByRole('button', { name: /@CardB.*修改现有 Card/ }))

    await waitFor(() => expect(getCardCatalogView().selectedCardId).toBe('CardB'))
    expect(onOpenCard).toHaveBeenCalledWith('CardB')
    expect(screen.getByText('当前内容 ↔ 提案内容')).toBeTruthy()
  })

  it('目标 Card 在提案生成后继续编辑时，列表自动持久化为已过期', async () => {
    const target = cardDocument('FrostArc', '生成时内容')
    cardCatalogActions.loadDocuments([target], '/mods/quiet-depth')
    const document = completedDocument()
    document.proposals = [proposal(
      'proposal-auto-stale',
      cardDocument('FrostArc', 'AI 候选'),
      'update',
      'pending',
      cardDocumentRevision(target),
    )]
    const repository = memoryRepository({ status: 'loaded', document })
    renderDrawer('/mods/quiet-depth', repository, successModel('不会调用'))
    expect(await screen.findByText('待确认')).toBeTruthy()

    act(() => {
      expect(cardCatalogActions.patchCurrentCard({ description: '用户继续编辑后的内容' }).ok).toBe(true)
    })

    expect(await screen.findByText('已过期')).toBeTruthy()
    expect(repository.current?.proposals[0].status).toBe('stale')
  })

  it('创建提案只有接受时才以最终 ID 加入项目', async () => {
    cardCatalogActions.loadDocuments([cardDocument('CardA', 'A0')], '/mods/quiet-depth')
    const conversationDocument = completedDocument()
    conversationDocument.proposals = [proposal(
      'proposal-create',
      cardDocument('SuggestedCard', '候选'),
      'create',
    )]
    const repository = memoryRepository({ status: 'loaded', document: conversationDocument })
    const onOpenCard = vi.fn()
    renderDrawer('/mods/quiet-depth', repository, successModel('不会调用'), onOpenCard)

    fireEvent.click(await screen.findByRole('button', { name: /@SuggestedCard.*创建新 Card/ }))
    expect(getCardCatalogView().documents.map(value => value.card.id)).toEqual(['CardA'])
    fireEvent.change(screen.getByLabelText('最终 Card ID'), { target: { value: 'FinalCard' } })
    fireEvent.click(screen.getByRole('button', { name: '创建并接受' }))

    await waitFor(() => expect(getCardCatalogView().documents.map(value => value.card.id)).toEqual(['CardA', 'FinalCard']))
    expect(repository.current?.proposals[0].status).toBe('accepted')
    expect(getCardCatalogView().currentDocument).toMatchObject({
      card: { id: 'FinalCard' },
      graph: { entityId: 'FinalCard' },
    })
    expect(onOpenCard).toHaveBeenCalledWith('FinalCard')
  })

  it('拒绝提案经二次确认后保存结构化原因', async () => {
    const conversationDocument = completedDocument()
    conversationDocument.proposals = [proposal(
      'proposal-reject',
      cardDocument('RejectedCard', '不要'),
      'create',
    )]
    const repository = memoryRepository({ status: 'loaded', document: conversationDocument })
    renderDrawer('/mods/quiet-depth', repository, successModel('不会调用'))

    fireEvent.click(await screen.findByRole('button', { name: /@RejectedCard.*创建新 Card/ }))
    fireEvent.click(screen.getByRole('button', { name: '拒绝提案' }))
    fireEvent.change(screen.getByLabelText('原因（可选）'), { target: { value: 'scope' } })
    fireEvent.change(screen.getByLabelText('补充说明（可选）'), { target: { value: '稍后再做' } })
    fireEvent.click(screen.getByRole('button', { name: '确认永久拒绝' }))

    await waitFor(() => expect(repository.current?.proposals[0].status).toBe('rejected'))
    expect(repository.current?.proposals[0].events.at(-1)).toMatchObject({
      type: 'rejected',
      feedback: { code: 'scope', note: '稍后再做' },
    })
  })

  it('提案动作失败时显示错误且不导航、不关闭确认层', async () => {
    const conversationDocument = completedDocument()
    conversationDocument.proposals = [proposal(
      'proposal-failure',
      cardDocument('FailedCard', '候选'),
      'create',
    )]
    const repository = memoryRepository({ status: 'loaded', document: conversationDocument })
    vi.mocked(repository.save).mockResolvedValueOnce({
      ok: false,
      error: '磁盘不可写',
      certainty: 'unchanged',
    })
    const onOpenCard = vi.fn()
    renderDrawer('/mods/quiet-depth', repository, successModel('不会调用'), onOpenCard)

    fireEvent.click(await screen.findByRole('button', { name: /@FailedCard.*创建新 Card/ }))
    fireEvent.click(screen.getByRole('button', { name: '拒绝提案' }))
    fireEvent.click(screen.getByRole('button', { name: '确认永久拒绝' }))

    expect(await screen.findByText('提案状态保存失败：磁盘不可写')).toBeTruthy()
    expect(screen.getByRole('group', { name: '确认拒绝提案' })).toBeTruthy()
    expect(onOpenCard).not.toHaveBeenCalled()
    expect(repository.current?.proposals[0].status).toBe('pending')
  })

  it('接受状态保存失败时显示错误，且不创建 Card、不导航', async () => {
    cardCatalogActions.loadDocuments([cardDocument('CardA', 'A0')], '/mods/quiet-depth')
    const conversationDocument = completedDocument()
    conversationDocument.proposals = [proposal(
      'proposal-accept-failure',
      cardDocument('CandidateCard', '候选'),
      'create',
    )]
    const repository = memoryRepository({ status: 'loaded', document: conversationDocument })
    vi.mocked(repository.save).mockResolvedValueOnce({
      ok: false,
      error: '磁盘不可写',
      certainty: 'unchanged',
    })
    const onOpenCard = vi.fn()
    renderDrawer('/mods/quiet-depth', repository, successModel('不会调用'), onOpenCard)

    fireEvent.click(await screen.findByRole('button', { name: /@CandidateCard.*创建新 Card/ }))
    fireEvent.click(screen.getByRole('button', { name: '创建并接受' }))

    expect(await screen.findByText('提案接受状态保存失败：磁盘不可写')).toBeTruthy()
    expect(getCardCatalogView().documents.map(value => value.card.id)).toEqual(['CardA'])
    expect(onOpenCard).not.toHaveBeenCalled()
    expect(repository.current?.proposals[0].status).toBe('pending')
  })

  it('过期提案的重做只填入可编辑草稿，不自动发送', async () => {
    const model = successModel('不应调用')
    const target = cardDocument('FrostArc', '当前内容')
    cardCatalogActions.loadDocuments([target], '/mods/quiet-depth')
    const conversationDocument = completedDocument()
    conversationDocument.proposals = [proposal(
      'proposal-stale',
      cardDocument('FrostArc', '旧候选'),
      'update',
      'stale',
      'old-revision',
    )]
    renderDrawer('/mods/quiet-depth', memoryRepository({ status: 'loaded', document: conversationDocument }), model)

    fireEvent.click(await screen.findByRole('button', { name: /@FrostArc.*修改现有 Card/ }))
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: '基于当前内容重做' }))
    })

    expect((screen.getByLabelText('发送给项目 AI 的消息') as HTMLTextAreaElement).value)
      .toBe('基于当前版本重做 @FrostArc')
    expect(screen.getByLabelText('已添加的 Card 上下文').textContent).toContain('@FrostArc')
    expect(model.respond).not.toHaveBeenCalled()
  })

  it('切换项目会关闭同 ID 提案的旧预览', async () => {
    const firstDocument = completedDocument()
    firstDocument.proposals = [proposal('shared-proposal', cardDocument('FirstCard', 'A'), 'create')]
    const secondDocument = completedDocument()
    secondDocument.proposals = [proposal('shared-proposal', cardDocument('SecondCard', 'B'), 'create')]
    const conversations = new Map([
      ['/mods/a', new ProjectConversation('/mods/a', memoryRepository({ status: 'loaded', document: firstDocument }), successModel('不会调用'))],
      ['/mods/b', new ProjectConversation('/mods/b', memoryRepository({ status: 'loaded', document: secondDocument }), successModel('不会调用'))],
    ])
    const factory = (projectRoot: string) => conversations.get(projectRoot)!
    const rendered = render(
      <ProjectConversationProvider projectRoot="/mods/a" createConversation={factory}>
        <ProjectConversationDrawer />
      </ProjectConversationProvider>,
    )
    fireEvent.click(await screen.findByRole('button', { name: /@FirstCard.*创建新 Card/ }))
    expect(screen.getByLabelText('@FirstCard 提案预览')).toBeTruthy()

    rendered.rerender(
      <ProjectConversationProvider projectRoot="/mods/b" createConversation={factory}>
        <ProjectConversationDrawer />
      </ProjectConversationProvider>,
    )

    const second = await screen.findByRole('button', { name: /@SecondCard.*创建新 Card/ })
    expect(second.getAttribute('aria-expanded')).toBe('false')
    expect(screen.queryByLabelText('@SecondCard 提案预览')).toBeNull()
  })

  it('切换项目会清除旧项目未读，并以新项目已加载历史重置计数基线', async () => {
    const first = new ProjectConversation(
      '/mods/a',
      memoryRepository({ status: 'loaded', document: completedDocument() }),
      successModel('A 的新回复'),
      () => new Date(NOW),
      sequentialIds(),
    )
    const second = new ProjectConversation(
      '/mods/b',
      memoryRepository({ status: 'loaded', document: completedDocument() }),
      successModel('B 的新回复'),
      () => new Date(NOW),
      sequentialIds(),
    )
    const conversations = new Map([['/mods/a', first], ['/mods/b', second]])
    const factory = (projectRoot: string) => conversations.get(projectRoot)!
    const rendered = render(
      <ProjectConversationProvider projectRoot="/mods/a" createConversation={factory}>
        <ProjectConversationDrawer />
      </ProjectConversationProvider>,
    )
    await screen.findByText('先明确玩法主线。')
    fireEvent.click(screen.getByRole('button', { name: '收起项目 AI 对话' }))

    await act(async () => { await first.send('A 的追加消息') })
    expect(screen.getByRole('button', { name: /展开项目 AI 对话，有未读消息/ })).toBeTruthy()

    rendered.rerender(
      <ProjectConversationProvider projectRoot="/mods/b" createConversation={factory}>
        <ProjectConversationDrawer />
      </ProjectConversationProvider>,
    )
    await waitFor(() => {
      expect(screen.getByRole('button', { name: '展开项目 AI 对话' })).toBeTruthy()
    })

    await act(async () => { await second.send('B 的追加消息') })
    expect(screen.getByRole('button', { name: /展开项目 AI 对话，有未读消息/ })).toBeTruthy()
  })

  it('失败、取消或中断的最后一轮提供手动重试', async () => {
    const document = completedDocument()
    document.turns[0] = {
      ...document.turns[0],
      assistantText: null,
      quickReplies: [],
      attempts: [{
        id: 'attempt-1',
        status: 'interrupted',
        startedAt: NOW,
        finishedAt: NOW,
        error: '应用在响应完成前中断',
        failureKind: 'interrupted',
        diagnostics: diagnostics(),
      }],
    }
    const repository = memoryRepository({ status: 'loaded', document })
    const model = successModel('重试已完成。')
    renderDrawer('/mods/quiet-depth', repository, model)

    const retry = await screen.findByRole('button', { name: '手动重试' })
    fireEvent.click(retry)

    expect(await screen.findByText('重试已完成。')).toBeTruthy()
    expect(repository.current?.turns[0].attempts).toHaveLength(2)
    expect(screen.getByText('上次回复因应用中断')).toBeTruthy()
    expect(screen.getByText('已完成')).toBeTruthy()
    expect(screen.queryByRole('button', { name: '手动重试' })).toBeNull()
  })

  it('运行中可取消，并保留取消状态', async () => {
    let resolveModel: ((value: { success: true; content: string }) => void) | null = null
    const model: ConversationModel = {
      respond: vi.fn(() => new Promise(resolve => { resolveModel = resolve })),
    }
    const repository = memoryRepository({ status: 'missing' })
    renderDrawer('/mods/quiet-depth', repository, model)
    await screen.findByText('从项目目标开始')

    fireEvent.change(screen.getByLabelText('发送给项目 AI 的消息'), { target: { value: '开始设计' } })
    fireEvent.click(screen.getByRole('button', { name: '发送' }))
    const stop = await screen.findByRole('button', { name: '停止' })
    fireEvent.click(stop)

    expect(await screen.findByText('本次回复已取消')).toBeTruthy()
    expect(screen.getByRole('button', { name: '手动重试' })).toBeTruthy()

    await act(async () => {
      resolveModel?.({ success: true, content: responseText('这条迟到回复不可见。') })
    })
    expect(screen.queryByText('这条迟到回复不可见。')).toBeNull()
  })

  it('预保存阶段立即进入忙碌态，停止后不会调用 provider', async () => {
    const firstSave = deferred<void>()
    const repository = memoryRepository({ status: 'missing' })
    const save = repository.save.bind(repository)
    let call = 0
    repository.save = vi.fn(async (projectRoot, document) => {
      call += 1
      if (call === 1) await firstSave.promise
      return save(projectRoot, document)
    })
    const model = successModel('不应出现')
    renderDrawer('/mods/quiet-depth', repository, model)
    await screen.findByText('从项目目标开始')

    fireEvent.change(screen.getByLabelText('发送给项目 AI 的消息'), { target: { value: '开始设计' } })
    fireEvent.click(screen.getByRole('button', { name: '发送' }))
    const stop = await screen.findByRole('button', { name: '停止' })
    expect((screen.getByLabelText('发送给项目 AI 的消息') as HTMLTextAreaElement).disabled).toBe(true)
    fireEvent.click(stop)
    firstSave.resolve()

    expect(await screen.findByText('本次回复已取消')).toBeTruthy()
    expect(model.respond).not.toHaveBeenCalled()
  })

  it('隔离历史显示保真提示并禁用发送', async () => {
    const repository = memoryRepository({ status: 'quarantined', reason: '不支持的 schemaVersion', path: '/mods/p/.modstudio/ai/conversation.json.quarantine' })
    renderDrawer('/mods/p', repository, successModel('不会调用'))

    expect(await screen.findByText('对话已进入只读隔离')).toBeTruthy()
    expect(screen.getByText('原始历史未被覆盖；处理恢复前不能继续发送。')).toBeTruthy()
    expect((screen.getByLabelText('发送给项目 AI 的消息') as HTMLTextAreaElement).disabled).toBe(true)
  })

  it('抽屉可收起，收起入口保留项目级运行状态位置', async () => {
    renderDrawer('/mods/p', memoryRepository({ status: 'missing' }), successModel('ok'))
    await screen.findByText('从项目目标开始')
    fireEvent.click(screen.getByRole('button', { name: '收起项目 AI 对话' }))

    const drawer = screen.getByLabelText('项目 AI 对话')
    expect(drawer.className).toContain('is-collapsed')
    fireEvent.click(screen.getByRole('button', { name: '展开项目 AI 对话' }))
    expect(drawer.className).toContain('is-open')
    await waitFor(() => expect(document.activeElement).toBe(
      screen.getByRole('button', { name: '收起项目 AI 对话' }),
    ))
  })

  it('无项目时入口禁用', () => {
    render(
      <ProjectConversationProvider projectRoot={null} createConversation={() => { throw new Error('不应创建实例') }}>
        <ProjectConversationDrawer />
      </ProjectConversationProvider>,
    )
    expect((screen.getByRole('button', { name: '请先打开项目' }) as HTMLButtonElement).disabled).toBe(true)
  })

  it('Card 投影不属于当前项目时禁止作为附件泄漏', async () => {
    cardCatalogActions.loadDocuments([cardDocument('SecretCard', '旧项目卡')], '/mods/project-a')
    renderDrawer('/mods/project-b', memoryRepository({ status: 'missing' }), successModel('ok'))
    await screen.findByText('从项目目标开始')

    const picker = screen.getByLabelText('添加 Card 上下文') as HTMLSelectElement
    expect(picker.disabled).toBe(true)
    expect(screen.queryByRole('option', { name: /SecretCard/ })).toBeNull()
    expect((screen.getByLabelText('发送给项目 AI 的消息') as HTMLTextAreaElement).disabled).toBe(true)
    expect(screen.getByText('正在等待当前项目 Card 目录加载完成…')).toBeTruthy()
  })

  it('未绑定 Card 目录时等待加载，已绑定的空目录仍可发送', async () => {
    const projectRoot = '/mods/empty-project'
    const repository = memoryRepository({ status: 'missing' })
    const model = successModel('已收到')
    const conversation = new ProjectConversation(projectRoot, repository, model)
    const rendered = render(
      <ProjectConversationProvider projectRoot={projectRoot} createConversation={() => conversation}>
        <ProjectConversationDrawer />
      </ProjectConversationProvider>,
    )
    await screen.findByText('从项目目标开始')
    const composer = screen.getByLabelText('发送给项目 AI 的消息') as HTMLTextAreaElement
    expect(composer.disabled).toBe(true)
    expect(screen.getByText('正在等待当前项目 Card 目录加载完成…')).toBeTruthy()

    act(() => { cardCatalogActions.loadDocuments([], projectRoot) })
    expect(composer.disabled).toBe(false)
    fireEvent.change(composer, { target: { value: '从空项目开始' } })
    fireEvent.click(screen.getByRole('button', { name: '发送' }))
    await waitFor(() => expect(model.respond).toHaveBeenCalledTimes(1))
    rendered.unmount()
  })

  it('输入法组合期间按 Enter 不发送，组合结束后才发送', async () => {
    const model = successModel('ok')
    renderDrawer('/mods/p', memoryRepository({ status: 'missing' }), model)
    const composer = await screen.findByLabelText('发送给项目 AI 的消息')
    fireEvent.change(composer, { target: { value: '冰霜' } })

    fireEvent.keyDown(composer, { key: 'Enter', isComposing: true })
    expect(model.respond).not.toHaveBeenCalled()
    fireEvent.keyDown(composer, { key: 'Enter', isComposing: false })
    await waitFor(() => expect(model.respond).toHaveBeenCalledTimes(1))
  })

  it('窄屏使用模态抽屉，Escape 关闭并恢复入口焦点', async () => {
    setNarrow(true)
    renderDrawer('/mods/p', memoryRepository({ status: 'missing' }), successModel('ok'))
    const dialog = await screen.findByRole('dialog', { name: '项目 AI 对话' })
    expect(dialog.getAttribute('aria-modal')).toBe('true')

    fireEvent.keyDown(dialog, { key: 'Escape' })
    const rail = screen.getByRole('button', { name: '展开项目 AI 对话' })
    expect(document.activeElement).toBe(rail)
  })
})

function renderDrawer(
  projectRoot: string,
  repository: ReturnType<typeof memoryRepository>,
  model: ConversationModel,
  onOpenCard?: (cardId: string) => void,
) {
  const catalog = getCardCatalogView()
  if (catalog.sourceProjectRoot === null && catalog.documents.length === 0) {
    cardCatalogActions.loadDocuments([], projectRoot)
  }
  const conversation = new ProjectConversation(
    projectRoot,
    repository,
    model,
    () => new Date(NOW),
    sequentialIds(),
    () => {
      const catalog = getCardCatalogView()
      return catalog.sourceProjectRoot === projectRoot ? catalog.documents : []
    },
  )
  return render(
    <ProjectConversationProvider
      projectRoot={projectRoot}
      createConversation={() => conversation}
      createProposalApplication={() => createProposalCardApplication(projectRoot, successfulCardFiles())}
    >
      <ProjectConversationDrawer onOpenCard={onOpenCard} />
    </ProjectConversationProvider>,
  )
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

function memoryRepository(initial: ConversationLoadResult) {
  let current = initial.status === 'loaded' ? initial.document : null
  const repository: ConversationRepository & { current: ConversationDocument | null } = {
    get current() { return current },
    set current(value) { current = value },
    load: vi.fn(async () => current ? { status: 'loaded' as const, document: current } : initial),
    save: vi.fn(async (_projectRoot, document) => {
      current = structuredClone(document)
      return { ok: true as const }
    }),
  }
  return repository
}

function successModel(text: string): ConversationModel {
  return {
    respond: vi.fn(async () => ({ success: true as const, content: responseText(text) })),
  }
}

function responseText(text: string): string {
  return JSON.stringify({ schemaVersion: 1, text, quickReplies: [], proposals: [] })
}

function completedDocument(): ConversationDocument {
  return {
    schemaVersion: 4,
    rollingSummary: null,
    proposals: [],
    turns: [{
      id: 'turn-1',
      userText: '我们先做什么？',
      assistantText: '先明确玩法主线。',
      quickReplies: [{ id: 'continue', label: '继续完善' }],
      quickReplySelection: null,
      attachments: [],
      contextSnapshot: null,
      attempts: [{
        id: 'attempt-1',
        status: 'completed',
        startedAt: NOW,
        finishedAt: NOW,
        error: null,
        failureKind: null,
        diagnostics: diagnostics(),
      }],
      createdAt: NOW,
    }],
    createdAt: NOW,
    updatedAt: NOW,
  }
}

function proposal(
  id: string,
  document: CardDocument,
  operation: 'create' | 'update',
  status: 'pending' | 'stale' = 'pending',
  baseRevision: string | null = null,
): ConversationCardProposal {
  const events: ConversationProposalEvent[] = [{ id: `${id}-proposed`, type: 'proposed', at: NOW }]
  if (status === 'stale') {
    events.push({ id: `${id}-stale`, type: 'stale', at: NOW, observedRevision: null })
  }
  return {
    id,
    operation,
    targetCardId: document.card.id,
    baseRevision: operation === 'update' ? baseRevision ?? 'revision' : null,
    document,
    status,
    provenance: { turnId: 'turn-1', attemptId: 'attempt-1' },
    projectReferences: [],
    events,
    createdAt: NOW,
    updatedAt: NOW,
  }
}

function diagnostics() {
  return { provider: 'test', model: 'test-model', requestId: 'request-1' }
}

function setNarrow(matches: boolean) {
  vi.stubGlobal('matchMedia', vi.fn(() => ({
    matches,
    media: '(max-width: 1099px)',
    onchange: null,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    addListener: vi.fn(),
    removeListener: vi.fn(),
    dispatchEvent: vi.fn(),
  })))
}

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>(next => { resolve = next })
  return { promise, resolve }
}

function cardDocument(id: string, name: string): CardDocument {
  return {
    schemaVersion: 2,
    card: {
      id,
      name,
      cost: 1,
      type: 'Attack',
      rarity: 'Common',
      description: '造成 6 点伤害。',
      keywords: ['Frost'],
    },
    graph: createEmptyGraph(id, 'card'),
    generation: { lastGeneratedFingerprint: null },
  }
}

function sequentialIds() {
  let value = 1
  return () => `generated-${value++}`
}
