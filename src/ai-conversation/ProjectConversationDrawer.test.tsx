import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createEmptyGraph } from '../node-editor/graph'
import { cardCatalogActions } from '../card/cardCatalog'
import { cardDocumentRevision } from '../card/cardAiProposal'
import type { CardDocument } from '../card/cardDocument'
import type { ConversationDocumentV1 } from './conversationDocument'
import type { ConversationLoadResult, ConversationRepository } from './conversationRepository'
import { ProjectConversation, type ConversationModel } from './projectConversation'
import { ProjectConversationProvider } from './ProjectConversationContext'
import { ProjectConversationDrawer } from './ProjectConversationDrawer'

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

function renderDrawer(projectRoot: string, repository: ReturnType<typeof memoryRepository>, model: ConversationModel) {
  const conversation = new ProjectConversation(projectRoot, repository, model, () => new Date(NOW), sequentialIds())
  return render(
    <ProjectConversationProvider projectRoot={projectRoot} createConversation={() => conversation}>
      <ProjectConversationDrawer />
    </ProjectConversationProvider>,
  )
}

function memoryRepository(initial: ConversationLoadResult) {
  let current = initial.status === 'loaded' ? initial.document : null
  const repository: ConversationRepository & { current: ConversationDocumentV1 | null } = {
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

function completedDocument(): ConversationDocumentV1 {
  return {
    schemaVersion: 1,
    turns: [{
      id: 'turn-1',
      userText: '我们先做什么？',
      assistantText: '先明确玩法主线。',
      quickReplies: [{ id: 'continue', label: '继续完善' }],
      quickReplySelection: null,
      attachments: [],
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
