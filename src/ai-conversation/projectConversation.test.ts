import { describe, expect, it } from 'vitest'
import { ProjectConversation, type ConversationModel } from './projectConversation'
import type { ConversationDocumentV1 } from './conversationDocument'
import type { ConversationRepository } from './conversationRepository'

function harness(
  model: ConversationModel,
  options: { initial?: ConversationDocumentV1 | null; failSaveCalls?: readonly number[]; failCertainty?: 'unchanged' | 'uncertain' } = {},
) {
  let saved: ConversationDocumentV1 | null = options.initial ? structuredClone(options.initial) : null
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
  const conversation = new ProjectConversation('/p', repository, model, () => new Date('2026-09-01T00:00:00Z'), () => `id-${++id}`)
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
    await Promise.resolve()
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

  it('恢复 running attempt 保存失败时诚实暴露并禁止发送', async () => {
    const running: ConversationDocumentV1 = {
      schemaVersion: 1,
      createdAt: '2026-09-01T00:00:00Z',
      updatedAt: '2026-09-01T00:00:00Z',
      turns: [{
        id: 'turn-1', userText: '继续', assistantText: null, quickReplies: [], quickReplySelection: null, attachments: [], createdAt: '2026-09-01T00:00:00Z',
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
    await Promise.resolve()
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
    let saved: ConversationDocumentV1 | null = null
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

  it('final save 已先线性化时，随后 cancel 不得覆盖 completed', async () => {
    let saveCall = 0
    let saved: ConversationDocumentV1 | null = null
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
    await conversation.load()
    const sending = conversation.send('继续')
    await finalStarted
    const cancelling = conversation.cancel()
    releaseFinalSave()
    await expect(sending).resolves.toEqual({ ok: true })
    await expect(cancelling).resolves.toEqual({ ok: true })
    expect(saveCall).toBe(2)
    expect(saved!.turns[0]).toMatchObject({ assistantText: '已完成', attempts: [{ status: 'completed' }] })
  })
})
