import { describe, expect, it, vi } from 'vitest'
import { ProjectConversation, type ConversationModel, type ConversationRequest } from './projectConversation'
import type { ConversationDocument } from './conversationDocument'
import type { ConversationSummaryGenerationRequest } from './conversationSummary'
import type { ConversationRepository } from './conversationRepository'
import type { CardDocument } from '../card/cardDocument'
import { cardDocumentRevision } from '../card/cardAiProposal'

function harness(
  model: ConversationModel,
  options: {
    initial?: ConversationDocument | null
    failSaveCalls?: readonly number[]
    failCertainty?: 'unchanged' | 'uncertain'
    projectDocuments?: () => readonly CardDocument[]
  } = {},
) {
  let saved: ConversationDocument | null = options.initial ? structuredClone(options.initial) : null
  let saveCall = 0
  const repository: ConversationRepository = {
    load: async () => saved ? { status: 'loaded', document: saved } : { status: 'missing' },
    save: async (_path, document) => {
      saveCall += 1
      if (options.failSaveCalls?.includes(saveCall)) return { ok: false, error: `save-${saveCall}-failed`, certainty: options.failCertainty ?? 'unchanged' }
      saved = structuredClone(document)
      return { ok: true }
    },
  }
  let id = 0
  const conversation = new ProjectConversation(
    '/p',
    repository,
    model,
    () => new Date('2026-09-01T00:00:00Z'),
    () => `id-${++id}`,
    options.projectDocuments,
  )
  return { conversation, saved: () => saved, saveCalls: () => saveCall }
}

describe('ProjectConversation', () => {
  it('先保存 running，再在最终原子保存后展示回复', async () => {
    let statusDuringCall = ''
    const h = harness({ respond: async () => { statusDuringCall = h.saved()!.turns[0].attempts[0].status; return { success: true, content: '{"schemaVersion":1,"text":"完成","quickReplies":[],"proposals":[]}' } } })
    await h.conversation.load()
    expect(await h.conversation.send('设计一张牌')).toEqual({ ok: true })
    expect(statusDuringCall).toBe('running')
    expect(h.conversation.getSnapshot().document?.turns[0].assistantText).toBe('完成')
    expect(h.saved()?.turns[0].attempts[0].status).toBe('completed')
  })

  it('取消后丢弃迟到响应并持久化 cancelled', async () => {
    let resolve!: (value: { success: true; content: string }) => void
    const h = harness({ respond: () => new Promise(result => { resolve = result }) })
    await h.conversation.load()
    const sending = h.conversation.send('继续')
    await vi.waitFor(() => expect(resolve).toBeTypeOf('function'))
    await h.conversation.cancel()
    resolve({ success: true, content: '{"schemaVersion":1,"text":"太迟了","quickReplies":[],"proposals":[]}' })
    expect((await sending).ok).toBe(false)
    expect(h.saved()?.turns[0].attempts[0].status).toBe('cancelled')
    expect(h.saved()?.turns[0].assistantText).toBeNull()
  })

  it('非法响应只记录失败，不展示部分内容', async () => {
    const h = harness({ respond: async () => ({ success: true, content: '{"schemaVersion":1,"text":"x","quickReplies":[],"proposals":[],"extra":1}' }) })
    await h.conversation.load()
    expect((await h.conversation.send('继续')).ok).toBe(false)
    expect(h.saved()?.turns[0].assistantText).toBeNull()
    expect(h.saved()?.turns[0].attempts[0].status).toBe('failed')
    expect(h.saved()?.turns[0].attempts[0].failureKind).toBe('invalid-response')
  })

  it('预算准备失败时不持久化 running attempt，也不调用模型', async () => {
    const respond = vi.fn(async () => ({ success: true as const, content: '{"schemaVersion":1,"text":"完成","quickReplies":[],"proposals":[]}' }))
    const h = harness({
      prepare: () => ({ ok: false as const, error: '最新消息超过可用预算' }),
      respond,
    })
    await h.conversation.load()

    await expect(h.conversation.send('很长的消息')).resolves.toMatchObject({ ok: false, code: 'context-over-budget' })
    expect(h.saveCalls()).toBe(0)
    expect(respond).not.toHaveBeenCalled()
    expect(h.conversation.getSnapshot()).toMatchObject({ isRunning: false, document: null })
  })

  it('持久化实际采用的预算快照，并仅把预算选中的完整历史发送给模型', async () => {
    let promptTurnCount = 0
    const h = harness({
      prepare: request => ({
        ok: true as const,
        turns: request.turns.slice(-1),
        promptContext: request,
        contextSnapshot: {
          directoryTier: 'compact' as const, contextWindowTokens: 8192, reservedOutputTokens: 2048,
          reservedExpansionTokens: 1024, estimatedInputTokens: 2300, estimatedTotalTokens: 5472,
          omittedMessageCount: 2, includedTurnIds: [request.turns.at(-1)!.id], providedCards: [],
        },
      }),
      respond: async request => {
        promptTurnCount = request.turns.length
        return { success: true, content: '{"schemaVersion":1,"text":"完成","quickReplies":[],"proposals":[]}' }
      },
    })
    await h.conversation.load()
    await h.conversation.send('第一轮')
    await h.conversation.send('第二轮')

    expect(promptTurnCount).toBe(1)
    expect(h.saved()?.turns[1].contextSnapshot).toMatchObject({
      directoryTier: 'compact', omittedMessageCount: 2, includedTurnIds: [h.saved()?.turns[1].id],
    })
  })

  it('对有效的首次补取只调用一次内部第二轮并且不改写用户附件', async () => {
    const calls: ConversationRequest[] = []
    const h = harness({
      respond: async request => {
        calls.push(request)
        return calls.length === 1
          ? { success: true as const, content: JSON.stringify({ schemaVersion: 1, action: 'expand-context', cardIds: ['Fireball'] }) }
          : { success: true as const, content: '{"schemaVersion":1,"text":"已读取火球","quickReplies":[],"proposals":[]}' }
      },
    }, { projectDocuments: () => [cardDocument('Fireball', '火焰伤害')] })
    await h.conversation.load()

    await expect(h.conversation.send('比较火球')).resolves.toEqual({ ok: true })
    expect(calls).toHaveLength(2)
    expect(calls[1].expandedAttachmentIds).toEqual(['Fireball'])
    expect(calls[1].expansionPass).toBe(true)
    expect(calls[1].resolvedAttachments.map(attachment => attachment.cardId)).toEqual(['Fireball'])
    expect(calls[1].turns[0].attachments).toEqual([])
    expect(h.saved()?.turns[0].attachments).toEqual([])
    expect(h.saved()?.turns[0].contextSnapshot?.reservedExpansionTokens).toBe(0)
    expect(h.saved()?.turns[0].contextSnapshot?.providedCards).toEqual([{ cardId: 'Fireball', revision: cardDocumentRevision(cardDocument('Fireball', '火焰伤害')), source: 'expanded' }])
    expect(h.saved()?.turns[0].assistantText).toBe('已读取火球')
  })

  it('拒绝目录外 Card 补取且不发送第二次请求', async () => {
    let calls = 0
    const h = harness({
      respond: async () => {
        calls += 1
        return { success: true as const, content: JSON.stringify({ schemaVersion: 1, action: 'expand-context', cardIds: ['Secret'] }) }
      },
    }, { projectDocuments: () => [cardDocument('Fireball', '火焰伤害')] })
    await h.conversation.load()

    await expect(h.conversation.send('比较火球')).resolves.toMatchObject({ ok: false, code: 'invalid-response' })
    expect(calls).toBe(1)
    expect(h.saved()?.turns[0].attempts[0]).toMatchObject({ status: 'failed', failureKind: 'invalid-response' })
  })

  it('第二次模型调用再次请求补取时终止该轮', async () => {
    let calls = 0
    const h = harness({
      respond: async () => {
        calls += 1
        return { success: true as const, content: JSON.stringify({ schemaVersion: 1, action: 'expand-context', cardIds: [calls === 1 ? 'Fireball' : 'IceBolt'] }) }
      },
    }, { projectDocuments: () => [cardDocument('Fireball', '火焰伤害'), cardDocument('IceBolt', '冰霜伤害')] })
    await h.conversation.load()

    await expect(h.conversation.send('比较')).resolves.toMatchObject({ ok: false, code: 'invalid-response' })
    expect(calls).toBe(2)
    expect(h.saved()?.turns[0].attempts[0]).toMatchObject({ status: 'failed', failureKind: 'invalid-response' })
  })

  it('加载前禁止发送', async () => {
    const h = harness({ respond: async () => ({ success: true, content: '{"schemaVersion":1,"text":"完成","quickReplies":[],"proposals":[]}' }) })
    await expect(h.conversation.send('继续')).resolves.toMatchObject({ ok: false, code: 'not-loaded' })
    expect(h.saveCalls()).toBe(0)
  })

  it('并发调用 load 和 send 时先完成加载门禁', async () => {
    let resolveLoad!: () => void
    let responded = false
    const repository: ConversationRepository = {
      load: () => new Promise(resolve => { resolveLoad = () => resolve({ status: 'missing' }) }),
      save: async () => ({ ok: true }),
    }
    const conversation = new ProjectConversation('/p', repository, {
      respond: async () => {
        responded = true
        return { success: true, content: '{"schemaVersion":1,"text":"完成","quickReplies":[],"proposals":[]}' }
      },
    }, () => new Date('2026-09-01T00:00:00Z'), () => crypto.randomUUID())
    const loading = conversation.load()
    const sending = conversation.send('继续')
    await Promise.resolve()
    expect(responded).toBe(false)
    resolveLoad()
    await loading
    expect(await sending).toEqual({ ok: true })
  })

  it('最终保存失败时不展示回复并阻止继续写入', async () => {
    const h = harness({
      respond: async () => ({ success: true, content: '{"schemaVersion":1,"text":"不能显示","quickReplies":[],"proposals":[]}' }),
    }, { failSaveCalls: [2] })
    await h.conversation.load()
    await expect(h.conversation.send('继续')).resolves.toMatchObject({ ok: false, code: 'persistence' })
    const snapshot = h.conversation.getSnapshot()
    expect(snapshot.document?.turns[0].assistantText).toBeNull()
    expect(snapshot.document?.turns[0].attempts[0]).toMatchObject({ status: 'failed', failureKind: 'persistence' })
    expect(snapshot).toMatchObject({ isRunning: false, requiresReload: true, persistenceError: '最终响应保存失败：save-2-failed' })
    await expect(h.conversation.send('另一条')).resolves.toMatchObject({ ok: false, code: 'persistence' })
    expect(h.saveCalls()).toBe(2)
  })


  it('达到估算阈值后异步摘要已完成前缀，并在写回时保留并发新轮次', async () => {
    let resolveSummary!: (result: { success: true; text: string }) => void
    let summarizedTurnCount = 0
    const summarize = vi.fn((request: ConversationSummaryGenerationRequest) => {
      summarizedTurnCount = request.turns.length
      return new Promise<{ success: true; text: string }>(resolve => { resolveSummary = resolve })
    })
    const h = harness({
      respond: async () => ({ success: true as const, content: '{"schemaVersion":1,"text":"完成","quickReplies":[],"proposals":[]}' }),
      summarize,
    })
    await h.conversation.load()
    await h.conversation.send('a'.repeat(1800))
    await h.conversation.send('b'.repeat(1800))
    await vi.waitFor(() => expect(summarize).toHaveBeenCalledTimes(1))
    expect(summarizedTurnCount).toBe(2)

    await h.conversation.send('并发的新轮次')
    resolveSummary({ success: true, text: '用户正在制作一款卡牌游戏' })
    await vi.waitFor(() => expect(h.conversation.getSnapshot().document?.rollingSummary?.throughTurnId).toBe(h.saved()?.turns[1].id))

    expect(h.conversation.getSnapshot().document?.turns).toHaveLength(3)
    expect(h.conversation.getSnapshot().document?.rollingSummary?.text).toBe('用户正在制作一款卡牌游戏')
    expect(h.saved()?.turns[2].assistantText).toBe('完成')
  })

  it('摘要尚未达到阈值或生成失败都不影响成功轮次和后续发送', async () => {
    const summarize = vi.fn(async () => ({ success: false as const, error: '摘要失败', kind: 'provider' as const }))
    const h = harness({
      respond: async () => ({ success: true as const, content: '{"schemaVersion":1,"text":"完成","quickReplies":[],"proposals":[]}' }),
      summarize,
    })
    await h.conversation.load()
    await h.conversation.send('短消息')
    expect(summarize).not.toHaveBeenCalled()
    await h.conversation.send('x'.repeat(1800))
    await h.conversation.send('y'.repeat(1800))
    await vi.waitFor(() => expect(summarize).toHaveBeenCalledTimes(1))
    expect(h.conversation.getSnapshot().document?.rollingSummary).toBeNull()
    expect(h.conversation.getSnapshot().document?.turns).toHaveLength(3)
    await expect(h.conversation.send('仍然可以继续')).resolves.toEqual({ ok: true })
  })
  it('恢复 running attempt 保存失败时诚实暴露并禁止发送', async () => {
    const running: ConversationDocument = {
      schemaVersion: 4,
      rollingSummary: null,
      proposals: [],
      createdAt: '2026-09-01T00:00:00Z',
      updatedAt: '2026-09-01T00:00:00Z',
      turns: [{
        id: 'turn-1', userText: '继续', assistantText: null, quickReplies: [], quickReplySelection: null, attachments: [], createdAt: '2026-09-01T00:00:00Z', contextSnapshot: null,
        attempts: [{
          id: 'attempt-1', status: 'running', startedAt: '2026-09-01T00:00:00Z', finishedAt: null, error: null, failureKind: null,
          diagnostics: { provider: 'unknown', model: 'unknown', requestId: 'unknown' },
        }],
      }],
    }
    const h = harness({ respond: async () => ({ success: false, error: 'unused' }) }, { initial: running, failSaveCalls: [1] })
    await h.conversation.load()
    expect(h.conversation.getSnapshot()).toMatchObject({ requiresReload: true, persistenceError: '中断状态恢复保存失败：save-1-failed' })
    expect(h.conversation.getSnapshot().document?.turns[0].attempts[0]).toMatchObject({ status: 'interrupted', failureKind: 'interrupted' })
    await expect(h.conversation.send('不能发送')).resolves.toMatchObject({ ok: false, code: 'persistence' })
  })

  it('仅重试最后失败轮次并追加 attempt', async () => {
    let call = 0
    const h = harness({ respond: async () => {
      call += 1
      return call === 1
        ? { success: false, error: '超时', kind: 'timeout' }
        : { success: true, content: '{"schemaVersion":1,"text":"重试成功","quickReplies":[],"proposals":[]}' }
    } })
    await h.conversation.load()
    await expect(h.conversation.send('保留原消息')).resolves.toMatchObject({ ok: false, code: 'timeout' })
    const turnId = h.conversation.getSnapshot().document!.turns[0].id
    await expect(h.conversation.retryTurn(turnId)).resolves.toEqual({ ok: true })
    const turn = h.saved()!.turns[0]
    expect(turn.userText).toBe('保留原消息')
    expect(turn.assistantText).toBe('重试成功')
    expect(turn.attempts).toHaveLength(2)
    expect(turn.attempts.map(attempt => attempt.status)).toEqual(['failed', 'completed'])
    expect(turn.attempts[0].failureKind).toBe('timeout')
  })

  it('拒绝重试非最后轮次', async () => {
    let call = 0
    const h = harness({ respond: async () => {
      call += 1
      return call === 1
        ? { success: false, error: '失败', kind: 'provider' }
        : { success: true, content: '{"schemaVersion":1,"text":"完成","quickReplies":[],"proposals":[]}' }
    } })
    await h.conversation.load()
    await h.conversation.send('第一轮')
    const firstTurnId = h.conversation.getSnapshot().document!.turns[0].id
    await h.conversation.send('第二轮')
    await expect(h.conversation.retryTurn(firstTurnId)).resolves.toMatchObject({ ok: false, code: 'not-retryable' })
  })

  it('取消状态保存失败时丢弃迟到响应并要求重新加载', async () => {
    let resolve!: (value: { success: true; content: string }) => void
    const h = harness({ respond: () => new Promise(result => { resolve = result }) }, { failSaveCalls: [2] })
    await h.conversation.load()
    const sending = h.conversation.send('继续')
    await vi.waitFor(() => expect(resolve).toBeTypeOf('function'))
    await expect(h.conversation.cancel()).resolves.toMatchObject({ ok: false, code: 'persistence' })
    resolve({ success: true, content: '{"schemaVersion":1,"text":"太迟了","quickReplies":[],"proposals":[]}' })
    await expect(sending).resolves.toMatchObject({ ok: false, code: 'cancelled' })
    expect(h.conversation.getSnapshot()).toMatchObject({ isRunning: false, requiresReload: true })
    expect(h.conversation.getSnapshot().document?.turns[0].assistantText).toBeNull()
  })

  it('持久化合法快捷回答选择并拒绝伪造引用', async () => {
    let call = 0
    const h = harness({ respond: async () => {
      call += 1
      return call === 1
        ? { success: true, content: '{"schemaVersion":1,"text":"请选择","quickReplies":[{"id":"yes","label":"继续"}],"proposals":[]}' }
        : { success: true, content: '{"schemaVersion":1,"text":"收到","quickReplies":[],"proposals":[]}' }
    } })
    await h.conversation.load()
    await h.conversation.send('第一轮')
    const sourceTurnId = h.saved()!.turns[0].id
    const selection = { turnId: sourceTurnId, replyId: 'yes' }
    await expect(h.conversation.send('错误文字', [], selection)).resolves.toMatchObject({ ok: false, code: 'invalid-input' })
    await expect(h.conversation.send('继续', [], selection)).resolves.toEqual({ ok: true })
    expect(h.saved()!.turns[1].quickReplySelection).toEqual(selection)
  })

  it('记录模型 diagnostics，缺失值使用 unknown', async () => {
    const h = harness({
      diagnostics: () => ({ provider: 'qwen', model: 'turbo', requestId: 'request-42' }),
      respond: async () => ({
        success: true,
        content: '{"schemaVersion":1,"text":"完成","quickReplies":[],"proposals":[]}',
        diagnostics: { provider: 'qwen', model: 'turbo', requestId: 'request-42' },
      }),
    })
    await h.conversation.load()
    await h.conversation.send('继续')
    expect(h.saved()!.turns[0].attempts[0].diagnostics).toEqual({ provider: 'qwen', model: 'turbo', requestId: 'request-42' })

    const fallback = harness({ respond: async () => ({ success: false, error: '失败' }) })
    await fallback.conversation.load()
    await fallback.conversation.send('继续')
    expect(fallback.saved()!.turns[0].attempts[0].diagnostics).toEqual({ provider: 'unknown', model: 'unknown', requestId: 'unknown' })
  })

  it('终态诊断绑定实际请求结果，不被运行中修改的 provider 设置覆盖', async () => {
    let configuredProvider = 'provider-a'
    const h = harness({
      diagnostics: () => ({ provider: configuredProvider, model: `${configuredProvider}-model` }),
      respond: async () => {
        configuredProvider = 'provider-b'
        return {
          success: true,
          content: '{"schemaVersion":1,"text":"完成","quickReplies":[],"proposals":[]}',
          diagnostics: { provider: 'provider-a', model: 'provider-a-model', requestId: 'request-a' },
        }
      },
    })
    await h.conversation.load()
    await h.conversation.send('继续')

    expect(h.saved()!.turns[0].attempts[0].diagnostics).toEqual({
      provider: 'provider-a',
      model: 'provider-a-model',
      requestId: 'request-a',
    })
  })

  it('持久化前脱敏并限制 provider 错误长度', async () => {
    const secret = 'sk-super-secret-value'
    const h = harness({ respond: async () => ({ success: false, kind: 'provider', error: `apiKey=${secret} Bearer abc.def ${'x'.repeat(700)}` }) })
    await h.conversation.load()
    await h.conversation.send('继续')
    const error = h.saved()!.turns[0].attempts[0].error!
    expect(error).not.toContain(secret)
    expect(error).not.toContain('abc.def')
    expect(error.length).toBeLessThanOrEqual(500)
  })

  it('hasActiveWork 同步覆盖尚未完成首次保存的 starting 状态', async () => {
    let resolveSave!: () => void
    let firstSave = true
    let saved: ConversationDocument | null = null
    let resolveModel!: (value: { success: true; content: string }) => void
    let markModelStarted!: () => void
    const modelStarted = new Promise<void>(resolve => { markModelStarted = resolve })
    const repository: ConversationRepository = {
      load: async () => ({ status: 'missing' }),
      save: async (_path, document) => {
        if (firstSave) {
          firstSave = false
          await new Promise<void>(resolve => { resolveSave = resolve })
        }
        saved = structuredClone(document)
        return { ok: true }
      },
    }
    const conversation = new ProjectConversation('/p', repository, {
      respond: () => {
        markModelStarted()
        return new Promise(resolve => { resolveModel = resolve })
      },
    })
    await conversation.load()
    const sending = conversation.send('继续')
    expect(conversation.hasActiveWork()).toBe(true)
    await Promise.resolve()
    resolveSave()
    await modelStarted
    expect(conversation.hasActiveWork()).toBe(true)
    resolveModel({ success: true, content: '{"schemaVersion":1,"text":"完成","quickReplies":[],"proposals":[]}' })
    await sending
    const savedDocument = () => saved
    expect(savedDocument()?.turns[0].assistantText).toBe('完成')
    expect(conversation.hasActiveWork()).toBe(false)
  })

  it('首次保存 uncertain 时要求 reload，unchanged 时允许重试', async () => {
    const model = { respond: async () => ({ success: false as const, error: 'unused' }) }
    const uncertain = harness(model, { failSaveCalls: [1], failCertainty: 'uncertain' })
    await uncertain.conversation.load()
    await uncertain.conversation.send('继续')
    expect(uncertain.conversation.getSnapshot().requiresReload).toBe(true)

    const unchanged = harness(model, { failSaveCalls: [1], failCertainty: 'unchanged' })
    await unchanged.conversation.load()
    await unchanged.conversation.send('继续')
    expect(unchanged.conversation.getSnapshot().requiresReload).toBe(false)
  })

  it('provider 已返回但最终保存未完成时，cancel 获胜且不展示 completed', async () => {
    let saveCall = 0
    let saved: ConversationDocument | null = null
    let finalSaveStarted!: () => void
    const finalStarted = new Promise<void>(resolve => { finalSaveStarted = resolve })
    let releaseFinalSave!: () => void
    const repository: ConversationRepository = {
      load: async () => ({ status: 'missing' }),
      save: async (_path, document) => {
        saveCall += 1
        if (saveCall === 2) {
          finalSaveStarted()
          await new Promise<void>(resolve => { releaseFinalSave = resolve })
        }
        saved = structuredClone(document)
        return { ok: true }
      },
    }
    const conversation = new ProjectConversation('/p', repository, {
      respond: async () => ({ success: true, content: '{"schemaVersion":1,"text":"已完成","quickReplies":[],"proposals":[]}' }),
    })
    const visibleStatuses: string[] = []
    conversation.subscribe(() => {
      const turn = conversation.getSnapshot().document?.turns[0]
      if (turn) visibleStatuses.push(`${turn.assistantText ?? 'null'}:${turn.attempts[0].status}`)
    })
    await conversation.load()
    const sending = conversation.send('继续')
    await finalStarted
    const cancelling = conversation.cancel()
    releaseFinalSave()
    await expect(sending).resolves.toMatchObject({ ok: false, code: 'cancelled' })
    await expect(cancelling).resolves.toEqual({ ok: true })
    expect(saveCall).toBe(3)
    expect(saved!.turns[0]).toMatchObject({ assistantText: null, attempts: [{ status: 'cancelled' }] })
    expect(visibleStatuses).not.toContain('已完成:completed')
  })

  it('每轮捕获当前 Card 目录，并只解析显式附件全文', async () => {
    const fire = cardDocument('Fireball', '火球')
    const frost = cardDocument('FrostArc', '霜弧')
    const captured: ConversationRequest[] = []
    const h = harness({
      respond: async request => {
        captured.push(request)
        return { success: true, content: responseText('已读取') }
      },
    }, { projectDocuments: () => [fire, frost] })
    await h.conversation.load()

    await expect(h.conversation.send('只看火球', [{
      cardId: fire.card.id,
      revision: cardDocumentRevision(fire),
    }])).resolves.toEqual({ ok: true })

    expect(captured[0].cardCatalog.map(card => card.id)).toEqual(['Fireball', 'FrostArc'])
    expect(captured[0].resolvedAttachments).toEqual([{
      cardId: 'Fireball',
      revision: cardDocumentRevision(fire),
      document: fire,
    }])
  })

  it('拒绝大小写冲突的项目 Card ID，不向模型泄露模糊目录', async () => {
    let responded = false
    const h = harness({ respond: async () => {
      responded = true
      return { success: true, content: '{"schemaVersion":1,"text":"unused","quickReplies":[],"proposals":[]}' }
    } }, {
      projectDocuments: () => [cardDocument('FrostArc', '霜弧'), cardDocument('frostarc', '冲突霜弧')],
    })
    await h.conversation.load()

    await expect(h.conversation.send('继续')).resolves.toMatchObject({
      ok: false,
      code: 'invalid-input',
      error: '当前项目 Card ID 不唯一',
    })
    expect(responded).toBe(false)
    expect(h.saveCalls()).toBe(0)
  })

  it('把同轮多个提案与完成回复原子保存，并逐 Card 判定请求期间过期', async () => {
    const originalA = cardDocument('CardA', 'A0')
    const originalB = cardDocument('CardB', 'B0')
    let projectDocuments: CardDocument[] = [originalA, originalB]
    const model: ConversationModel = {
      respond: async request => {
        projectDocuments = [originalA, cardDocument('CardB', 'B1')]
        return {
          success: true,
          content: JSON.stringify({
            schemaVersion: 1,
            text: '三个候选已准备',
            quickReplies: [],
            proposals: [
              updateProposal(originalA, request.cardCatalog.find(card => card.id === 'CardA')!.revision, 'A2'),
              updateProposal(originalB, request.cardCatalog.find(card => card.id === 'CardB')!.revision, 'B2'),
              { operation: 'create', document: cardDocument('NewCard', 'N') },
            ],
          }),
        }
      },
    }
    const h = harness(model, { projectDocuments: () => projectDocuments })
    await h.conversation.load()

    await expect(h.conversation.send('同时调整', [
      { cardId: 'CardA', revision: cardDocumentRevision(originalA) },
      { cardId: 'CardB', revision: cardDocumentRevision(originalB) },
    ])).resolves.toEqual({ ok: true })
    expect(h.saved()?.turns[0]).toMatchObject({ assistantText: '三个候选已准备', attempts: [{ status: 'completed' }] })
    expect(h.saved()?.proposals.map(proposal => [proposal.targetCardId, proposal.status])).toEqual([
      ['CardA', 'pending'],
      ['CardB', 'stale'],
      ['NewCard', 'pending'],
    ])
  })

  it('模型伪造 update 基线时整轮失败，不展示文字或部分提案', async () => {
    const current = cardDocument('CardA', 'A0')
    const h = harness({
      respond: async () => ({
        success: true,
        content: JSON.stringify({
          schemaVersion: 1,
          text: '不能展示',
          quickReplies: [],
          proposals: [updateProposal(current, 'forged-revision', 'A1')],
        }),
      }),
    }, { projectDocuments: () => [current] })
    await h.conversation.load()

    await expect(h.conversation.send('修改 A', [{
      cardId: 'CardA',
      revision: cardDocumentRevision(current),
    }])).resolves.toMatchObject({ ok: false, code: 'invalid-response' })
    expect(h.saved()?.turns[0]).toMatchObject({ assistantText: null, attempts: [{ status: 'failed', failureKind: 'invalid-response' }] })
    expect(h.saved()?.proposals).toEqual([])
  })

  it('模型不能用不同大小写改写现有 Card ID', async () => {
    const current = cardDocument('CardA', 'A0')
    const wrongCase = cardDocument('carda', 'A1')
    const h = harness({
      respond: async request => ({
        success: true,
        content: JSON.stringify({
          schemaVersion: 1,
          text: '不能展示',
          quickReplies: [],
          proposals: [updateProposal(wrongCase, request.cardCatalog[0].revision, 'A1')],
        }),
      }),
    }, { projectDocuments: () => [current] })
    await h.conversation.load()

    await expect(h.conversation.send('修改 A', [{
      cardId: 'CardA',
      revision: cardDocumentRevision(current),
    }])).resolves.toMatchObject({ ok: false, code: 'invalid-response' })
    expect(h.saved()?.proposals).toEqual([])
  })

  it('仅有目录摘要时拒绝 update 提案，整轮不展示', async () => {
    const current = cardDocument('CardA', 'A0')
    const h = harness({
      respond: async request => ({
        success: true,
        content: JSON.stringify({
          schemaVersion: 1,
          text: '不能展示',
          quickReplies: [],
          proposals: [updateProposal(current, request.cardCatalog[0].revision, 'A1')],
        }),
      }),
    }, { projectDocuments: () => [current] })
    await h.conversation.load()

    await expect(h.conversation.send('修改 A')).resolves.toMatchObject({
      ok: false,
      code: 'invalid-response',
      error: 'Card 提案缺少全文上下文：CardA',
    })
    expect(h.saved()?.turns[0]).toMatchObject({
      assistantText: null,
      attempts: [{ status: 'failed', failureKind: 'invalid-response' }],
    })
    expect(h.saved()?.proposals).toEqual([])
  })

  it('待确认的同目标候选已进入 prompt 时，允许不重复附加 Card 全文', async () => {
    const current = cardDocument('CardA', 'A0')
    let call = 0
    const h = harness({
      respond: async request => {
        call += 1
        return {
          success: true,
          content: JSON.stringify({
            schemaVersion: 1,
            text: call === 1 ? '第一版' : '第二版',
            quickReplies: [],
            proposals: [updateProposal(current, request.cardCatalog[0].revision, call === 1 ? 'A1' : 'A2')],
          }),
        }
      },
    }, { projectDocuments: () => [current] })
    await h.conversation.load()
    const attachment = [{ cardId: 'CardA', revision: cardDocumentRevision(current) }]

    await expect(h.conversation.send('先做一版', attachment)).resolves.toEqual({ ok: true })
    await expect(h.conversation.send('继续调整这个候选')).resolves.toEqual({ ok: true })
    expect(h.saved()?.turns[1].assistantText).toBe('第二版')
    expect(h.saved()?.proposals.map(proposal => proposal.status)).toEqual(['superseded', 'pending'])
  })

  it('待确认候选的 base 已过期时，不能替代当前 Card 的显式全文附件', async () => {
    const original = cardDocument('CardA', 'A0')
    let projectDocuments = [original]
    let call = 0
    const h = harness({
      respond: async request => {
        call += 1
        const current = projectDocuments[0]
        return {
          success: true,
          content: JSON.stringify({
            schemaVersion: 1,
            text: call === 1 ? '第一版' : '不应展示',
            quickReplies: [],
            proposals: [updateProposal(current, request.cardCatalog[0].revision, call === 1 ? 'A1' : 'A2')],
          }),
        }
      },
    }, { projectDocuments: () => projectDocuments })
    await h.conversation.load()

    await expect(h.conversation.send('先做一版', [{
      cardId: 'CardA',
      revision: cardDocumentRevision(original),
    }])).resolves.toEqual({ ok: true })
    projectDocuments = [cardDocument('CardA', '用户已修改')]

    await expect(h.conversation.send('继续调整这个候选')).resolves.toMatchObject({
      ok: false,
      code: 'invalid-response',
      error: 'Card 提案缺少全文上下文：CardA',
    })
    expect(h.saved()?.turns[1].assistantText).toBeNull()
  })

  it('手动重试读取最新项目基线而不是失败尝试的旧 revision', async () => {
    let projectDocuments = [cardDocument('CardA', 'A0')]
    const revisions: string[] = []
    let calls = 0
    const h = harness({
      respond: async request => {
        revisions.push(request.cardCatalog[0].revision)
        calls += 1
        return calls === 1
          ? { success: false, error: '超时', kind: 'timeout' }
          : { success: true, content: responseText('重试完成') }
      },
    }, { projectDocuments: () => projectDocuments })
    await h.conversation.load()
    await h.conversation.send('调整 A')
    projectDocuments = [cardDocument('CardA', 'A1')]
    const turnId = h.conversation.getSnapshot().document!.turns[0].id

    await expect(h.conversation.retryTurn(turnId)).resolves.toEqual({ ok: true })
    expect(revisions).toEqual([
      cardDocumentRevision(cardDocument('CardA', 'A0')),
      cardDocumentRevision(cardDocument('CardA', 'A1')),
    ])
  })

  it('接受 update 后持久化事务，并随同一事务 undo/redo 记录 reverted/accepted', async () => {
    const current = cardDocument('CardA', 'A0')
    const revision = cardDocumentRevision(current)
    const h = harness({
      respond: async () => ({
        success: true,
        content: JSON.stringify({
          schemaVersion: 1,
          text: '修改好了',
          quickReplies: [],
          proposals: [updateProposal(current, revision, 'A1')],
        }),
      }),
    }, { projectDocuments: () => [current] })
    await h.conversation.load()
    await h.conversation.send('修改 A', [{ cardId: 'CardA', revision }])
    const proposal = h.saved()!.proposals[0]
    const commits: string[] = []

    await expect(h.conversation.acceptProposal(proposal.id, 'CardA', async input => {
      await Promise.resolve()
      commits.push(input.transactionId)
      expect(input.proposal.id).toBe(proposal.id)
      return { ok: true }
    })).resolves.toEqual({ ok: true })
    expect(commits).toEqual([proposal.id])
    expect(h.saved()!.proposals[0].status).toBe('accepted')

    await expect(h.conversation.recordProposalHistory(proposal.id, proposal.id, 'reverted', current)).resolves.toEqual({ ok: true })
    expect(h.saved()!.proposals[0].status).toBe('reverted')
    await expect(h.conversation.confirmProposalCardTransition(proposal.id, proposal.id)).resolves.toEqual({ ok: true })
    await expect(h.conversation.recordProposalHistory(proposal.id, proposal.id, 'accepted', proposal.document)).resolves.toEqual({ ok: true })
    expect(h.saved()!.proposals[0].status).toBe('accepted')
    await expect(h.conversation.confirmProposalCardTransition(proposal.id, proposal.id)).resolves.toEqual({ ok: true })
    expect(h.saved()!.proposals[0].events.map(event => event.type)).toEqual([
      'proposed', 'accepted', 'committed', 'reverted', 'committed', 'restored', 'committed',
    ])
  })

  it('接受前目标 Card 变化会持久化 stale，且不会调用 Card commit', async () => {
    const original = cardDocument('CardA', 'A0')
    let current = original
    const h = harness({
      respond: async () => ({
        success: true,
        content: JSON.stringify({
          schemaVersion: 1,
          text: '修改好了',
          quickReplies: [],
          proposals: [updateProposal(original, cardDocumentRevision(original), 'A1')],
        }),
      }),
    }, { projectDocuments: () => [current] })
    await h.conversation.load()
    await h.conversation.send('修改 A', [{
      cardId: 'CardA',
      revision: cardDocumentRevision(original),
    }])
    const proposalId = h.saved()!.proposals[0].id
    current = cardDocument('CardA', '用户编辑')
    let committed = false

    await expect(h.conversation.acceptProposal(proposalId, 'CardA', () => {
      committed = true
      return { ok: true }
    })).resolves.toMatchObject({ ok: false, code: 'stale-proposal' })
    expect(committed).toBe(false)
    expect(h.saved()!.proposals[0].status).toBe('stale')
  })

  it('Card commit 失败时把已保存的 accepted 补偿回 pending', async () => {
    const current = cardDocument('CardA', 'A0')
    const h = harness({
      respond: async () => ({
        success: true,
        content: JSON.stringify({
          schemaVersion: 1,
          text: '修改好了',
          quickReplies: [],
          proposals: [updateProposal(current, cardDocumentRevision(current), 'A1')],
        }),
      }),
    }, { projectDocuments: () => [current] })
    await h.conversation.load()
    await h.conversation.send('修改 A', [{
      cardId: 'CardA',
      revision: cardDocumentRevision(current),
    }])
    const proposalId = h.saved()!.proposals[0].id

    await expect(h.conversation.acceptProposal(proposalId, 'CardA', () => ({
      ok: false,
      error: 'Card 写入失败',
    }))).resolves.toEqual({ ok: false, code: 'card-update-failed', error: 'Card 写入失败' })
    expect(h.saved()!.proposals[0].status).toBe('pending')
    expect(h.conversation.getSnapshot().document!.proposals[0].status).toBe('pending')
  })

  it('Card 异步 commit 结果不确定时保留 accepted 恢复日志并要求重载', async () => {
    const current = cardDocument('CardA', 'A0')
    const revision = cardDocumentRevision(current)
    const h = harness({
      respond: async () => ({
        success: true,
        content: JSON.stringify({
          schemaVersion: 1,
          text: '修改好了',
          quickReplies: [],
          proposals: [updateProposal(current, revision, 'A1')],
        }),
      }),
    }, { projectDocuments: () => [current] })
    await h.conversation.load()
    await h.conversation.send('修改 A', [{ cardId: 'CardA', revision }])
    const proposalId = h.saved()!.proposals[0].id

    await expect(h.conversation.acceptProposal(proposalId, 'CardA', async () => {
      await Promise.resolve()
      return { ok: false, error: 'Card 文档原子写入超时', certainty: 'uncertain' }
    })).resolves.toEqual({
      ok: false,
      code: 'persistence',
      error: 'Card 应用结果不确定：Card 文档原子写入超时',
    })
    expect(h.saveCalls()).toBe(3)
    expect(h.saved()!.proposals[0].status).toBe('accepted')
    expect(h.conversation.getSnapshot()).toMatchObject({
      requiresReload: true,
      persistenceError: 'Card 应用结果不确定：Card 文档原子写入超时',
    })
    expect(h.conversation.getSnapshot().document!.proposals[0].status).toBe('accepted')
  })

  it('Card 已应用但 committed 标记保存失败时保留 WAL 并要求重载', async () => {
    const current = cardDocument('CardA', 'A0')
    const revision = cardDocumentRevision(current)
    const h = harness({
      respond: async () => ({
        success: true,
        content: JSON.stringify({
          schemaVersion: 1,
          text: '修改好了',
          quickReplies: [],
          proposals: [updateProposal(current, revision, 'A1')],
        }),
      }),
    }, { projectDocuments: () => [current], failSaveCalls: [4] })
    await h.conversation.load()
    await h.conversation.send('修改 A', [{ cardId: 'CardA', revision }])
    const proposalId = h.saved()!.proposals[0].id

    await expect(h.conversation.acceptProposal(proposalId, 'CardA', () => ({ ok: true })))
      .resolves.toMatchObject({ ok: false, code: 'persistence' })
    expect(h.saved()!.proposals[0].events.map(event => event.type)).toEqual(['proposed', 'accepted'])
    expect(h.conversation.getSnapshot()).toMatchObject({ requiresReload: true })
  })

  it('模型回复运行期间仍可记录 undo WAL，终态保存不会覆盖历史事件', async () => {
    const base = cardDocument('CardA', 'A0')
    const candidate = cardDocument('CardA', 'A1')
    let projectDocument = base
    let call = 0
    let resolveSecond!: (value: { success: true; content: string }) => void
    const h = harness({
      respond: async () => {
        call += 1
        if (call === 1) {
          return {
            success: true as const,
            content: JSON.stringify({
              schemaVersion: 1,
              text: '修改好了',
              quickReplies: [],
              proposals: [updateProposal(base, cardDocumentRevision(base), 'A1')],
            }),
          }
        }
        return new Promise(resolve => { resolveSecond = resolve })
      },
    }, { projectDocuments: () => [projectDocument] })
    await h.conversation.load()
    await h.conversation.send('修改 A', [{ cardId: 'CardA', revision: cardDocumentRevision(base) }])
    const proposal = h.saved()!.proposals[0]
    await h.conversation.acceptProposal(proposal.id, 'CardA', () => {
      projectDocument = candidate
      return { ok: true }
    })

    const sending = h.conversation.send('继续讨论')
    await Promise.resolve()
    await expect(h.conversation.recordProposalHistory(
      proposal.id,
      proposal.id,
      'reverted',
      base,
    )).resolves.toEqual({ ok: true })
    projectDocument = base
    resolveSecond({ success: true, content: responseText('继续完成') })
    await expect(sending).resolves.toEqual({ ok: true })

    expect(h.saved()!.proposals[0].events.map(event => event.type)).toEqual([
      'proposed', 'accepted', 'committed', 'reverted',
    ])
    expect(h.saved()!.turns.at(-1)?.assistantText).toBe('继续完成')
  })

  it('拒绝永久保存结构化原因，之后不能再接受', async () => {
    const h = harness({
      respond: async () => ({
        success: true,
        content: JSON.stringify({
          schemaVersion: 1,
          text: '新 Card',
          quickReplies: [],
          proposals: [{ operation: 'create', document: cardDocument('NewCard', 'N') }],
        }),
      }),
    })
    await h.conversation.load()
    await h.conversation.send('创建')
    const proposalId = h.saved()!.proposals[0].id

    await expect(h.conversation.rejectProposal(proposalId, {
      code: 'wrong-direction',
      note: '不要使用这个机制',
    })).resolves.toEqual({ ok: true })
    expect(h.saved()!.proposals[0]).toMatchObject({
      status: 'rejected',
      events: [{ type: 'proposed' }, { type: 'rejected', feedback: { code: 'wrong-direction', note: '不要使用这个机制' } }],
    })
    await expect(h.conversation.acceptProposal(proposalId, 'NewCard', () => ({ ok: true })))
      .resolves.toMatchObject({ ok: false, code: 'proposal-not-pending' })
  })
})

function responseText(text: string): string {
  return JSON.stringify({ schemaVersion: 1, text, quickReplies: [], proposals: [] })
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
      metadata: { createdAt: '2026-09-01T00:00:00Z', updatedAt: '2026-09-01T00:00:00Z' },
    },
    generation: { lastGeneratedFingerprint: null },
  }
}

function updateProposal(base: CardDocument, baseRevision: string, description: string) {
  return {
    operation: 'update' as const,
    targetCardId: base.card.id,
    baseRevision,
    document: cardDocument(base.card.id, description),
  }
}
