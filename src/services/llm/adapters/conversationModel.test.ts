import { describe, expect, it, vi } from 'vitest'
import type { ConversationTurn } from '../../../ai-conversation/conversationDocument'
import { parseConversationResponseText } from '../../../ai-conversation/conversationResponse'
import type { CardDocument } from '../../../card/cardDocument'
import type { ConversationPromptContext } from '../conversationContext'
import type { BaseLLMAdapter } from './base'
import { createConversationModel } from './conversationModel'
import { prepareConversationPrompt } from '../conversationPreparation'

function turn(): ConversationTurn {
  return {
    id: 'turn-1',
    userText: '把火球改得更有趣',
    assistantText: null,
    quickReplies: [],
    quickReplySelection: null,
    attachments: [{ cardId: 'Fireball', revision: 'rev-1' }],
    attempts: [{
      id: 'attempt-1',
      status: 'running',
      startedAt: '2026-01-01T00:00:00.000Z',
      finishedAt: null,
      error: null,
      failureKind: null,
      diagnostics: { provider: 'unknown', model: 'unknown', requestId: 'unknown' },
    }],
    createdAt: '2026-01-01T00:00:00.000Z',
    contextSnapshot: null,
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
      metadata: { createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z' },
    },
    generation: { lastGeneratedFingerprint: null },
  }
}

function context(): ConversationPromptContext {
  return {
    cardCatalog: [
      { id: 'Fireball', name: '火球', type: 'Attack', revision: 'rev-1', tier: 'detailed', rarity: 'Common', cost: 1, keywords: [], description: '火球目录摘要', behaviorKinds: [] },
      { id: 'HiddenCard', name: '隐藏卡', type: 'Skill', revision: 'rev-hidden', tier: 'detailed', rarity: 'Common', cost: 1, keywords: [], description: '隐藏目录摘要', behaviorKinds: [] },
    ],
    compactCardCatalog: [
      { id: 'Fireball', name: '火球', type: 'Attack', revision: 'rev-1', tier: 'compact' },
      { id: 'HiddenCard', name: '隐藏卡', type: 'Skill', revision: 'rev-hidden', tier: 'compact' },
    ],
    resolvedAttachments: [
      {
        cardId: 'Fireball',
        revision: 'rev-1',
        document: cardDocument('Fireball', 'EXPLICIT_FULL_TEXT_MARKER'),
      },
      {
        cardId: 'HiddenCard',
        revision: 'rev-hidden',
        document: cardDocument('HiddenCard', 'HIDDEN_FULL_TEXT_MARKER'),
      },
    ],
    proposals: [
      {
        id: 'proposal-pending',
        operation: 'create',
        targetCardId: 'SuggestedCard',
        baseRevision: null,
        status: 'pending',
        candidate: cardDocument('SuggestedCard', 'PENDING_CANDIDATE_MARKER'),
        rejectionFeedback: null,
        finalCardId: null,
      },
      {
        id: 'proposal-accepted',
        operation: 'update',
        targetCardId: 'Fireball',
        baseRevision: 'rev-1',
        status: 'accepted',
        candidate: null,
        rejectionFeedback: null,
        finalCardId: 'Fireball',
      },
    ],
  }
}

describe('createConversationModel', () => {
  it('传递外部 signal，并允许严格的零提案响应信封', async () => {
    const generate = vi.fn().mockResolvedValue({ success: true, content: '{"schemaVersion":1,"text":"好","quickReplies":[],"proposals":[]}' })
    const diagnostics = vi.fn(() => ({ provider: 'qwen', model: 'qwen-turbo' }))
    const model = createConversationModel({ generate, diagnostics } as Pick<BaseLLMAdapter, 'generate' | 'diagnostics'>)
    const controller = new AbortController()

    const request = {
      projectPath: '/private/project',
      turns: [turn()],
      signal: controller.signal,
      ...context(),
    }
    const result = await model.respond(request)

    expect(result.success).toBe(true)
    expect(generate).toHaveBeenCalledOnce()
    const [prompt, options] = generate.mock.calls[0]
    expect(options.signal).toBe(controller.signal)
    expect(prompt).toContain('"proposals":[]')
    expect(prompt).toContain('Fireball')
    expect(prompt).toContain('"turnId":"turn-1"')
    expect(prompt).toContain('"quickReplies":[]')
    expect(prompt).toContain('"quickReplySelection":null')
    expect(prompt).toContain('"name":"隐藏卡"')
    expect(prompt).toContain('EXPLICIT_FULL_TEXT_MARKER')
    expect(prompt).toContain('"id":"proposal-pending"')
    expect(prompt).toContain('"status":"pending"')
    expect(prompt).toContain('PENDING_CANDIDATE_MARKER')
    expect(prompt).toContain('只允许以下两种格式')
    expect(prompt).toContain('禁止输出 delete')
    expect(prompt).not.toContain('HIDDEN_FULL_TEXT_MARKER')
    expect(prompt).not.toContain('/private/project')
    expect(result).toMatchObject({
      success: true,
      diagnostics: { provider: 'qwen', model: 'qwen-turbo' },
    })
    expect(model.diagnostics?.()).toEqual({ provider: 'qwen', model: 'qwen-turbo' })
  })

  it('目录中的未附加 Card 只发送摘要，不会默认发送全文', async () => {
    const generate = vi.fn().mockResolvedValue({ success: true, content: '{"schemaVersion":1,"text":"好","quickReplies":[],"proposals":[]}' })
    const model = createConversationModel({
      generate,
      diagnostics: () => ({ provider: 'mock', model: 'mock' }),
    } as Pick<BaseLLMAdapter, 'generate' | 'diagnostics'>)
    const promptContext = context()
    const request = {
      projectPath: '/p',
      turns: [turn()],
      signal: new AbortController().signal,
      ...promptContext,
      // HiddenCard 虽然被解析过，但本轮没有显式 attachment，prompt 边界必须将它过滤掉。
      cardCatalog: promptContext.cardCatalog.map(card => ({ ...card })),
    }

    await model.respond(request)

    const [prompt] = generate.mock.calls[0]
    expect(prompt).toContain('HiddenCard')
    expect(prompt).not.toContain('HIDDEN_FULL_TEXT_MARKER')
    expect(prompt.match(/EXPLICIT_FULL_TEXT_MARKER/g)).toHaveLength(1)
    expect(prompt).toContain(JSON.stringify(promptContext.cardCatalog))
    expect(prompt).toContain('"cardId":"Fireball"')
    expect(prompt).not.toContain('HIDDEN_FULL_TEXT_MARKER')
  })



  it('补取第二次调用发送完整附加 Card 并消耗扩展预留', async () => {
    const generate = vi.fn().mockResolvedValue({ success: true, content: '{"schemaVersion":1,"text":"已读取","quickReplies":[],"proposals":[]}' })
    const model = createConversationModel({
      generate,
      diagnostics: () => ({ provider: 'mock', model: 'mock' }),
    } as Pick<BaseLLMAdapter, 'generate' | 'diagnostics'>)
    const promptContext = context()
    await model.respond({
      projectPath: '/p',
      turns: [turn()],
      signal: new AbortController().signal,
      ...promptContext,
      expandedAttachmentIds: ['HiddenCard'],
      expansionPass: true,
    })

    const [prompt] = generate.mock.calls[0]
    expect(prompt).toContain('HIDDEN_FULL_TEXT_MARKER')
    expect(prompt).toContain('EXPLICIT_FULL_TEXT_MARKER')
    expect(prompt.match(/HIDDEN_FULL_TEXT_MARKER/g)).toHaveLength(1)
  })

  it('prepare 在预算内选择紧凑目录并只保留近到远的完整历史轮次', () => {
    const promptContext = context()
    const oldTurn = { ...turn(), id: 'turn-old', userText: 'OLD_HISTORY_MARKER', assistantText: 'old answer', attachments: [] }
    const middleTurn = { ...turn(), id: 'turn-middle', userText: 'MIDDLE_HISTORY_MARKER', assistantText: 'middle answer', attachments: [] }
    const latestTurn = { ...turn(), id: 'turn-latest', userText: 'LATEST_REQUIRED_MARKER', assistantText: null, attachments: [] }
    const detailed = JSON.stringify(promptContext.cardCatalog)
    const compact = JSON.stringify(promptContext.compactCardCatalog)
    const prepared = prepareConversationPrompt({
      projectPath: '/p',
      turns: [oldTurn, middleTurn, latestTurn],
      ...promptContext,
    }, {
      contextWindowTokens: 14,
      reservedOutputTokens: 1,
      reservedExpansionTokens: 2,
      estimateTokens: serialized => {
        if (serialized === detailed) return 10
        if (serialized === compact) return 2
        try {
          const parsed = JSON.parse(serialized) as { turnId?: string }
          if (parsed.turnId === 'turn-old') return 5
          if (parsed.turnId === 'turn-middle') return 3
          if (parsed.turnId === 'turn-latest') return 4
        } catch { /* fixed instructions are one estimated block */ }
        return 1
      },
    })

    expect(prepared.ok).toBe(true)
    if (!prepared.ok) return
    expect(prepared.contextSnapshot).toMatchObject({ directoryTier: 'compact', omittedMessageCount: 2, includedTurnIds: ['turn-middle', 'turn-latest'] })
    expect(prepared.turns.map(item => item.id)).toEqual(['turn-middle', 'turn-latest'])
    expect(prepared.promptContext.cardCatalog).toEqual(promptContext.compactCardCatalog)
  })

  it('预算超限时 prepare/respond 都拒绝发送且不调用 provider', async () => {
    const generate = vi.fn().mockResolvedValue({ success: true, content: '{"schemaVersion":1,"text":"不应到达","quickReplies":[],"proposals":[]}' })
    const model = createConversationModel({
      generate,
      diagnostics: () => ({ provider: 'mock', model: 'mock' }),
    } as Pick<BaseLLMAdapter, 'generate' | 'diagnostics'>, {
      contextWindowTokens: 5,
      reservedOutputTokens: 1,
      reservedExpansionTokens: 1,
      estimateTokens: serialized => serialized.includes('LATEST_TOO_LARGE_MARKER') ? 10 : 1,
    })
    const request = {
      projectPath: '/p',
      turns: [{ ...turn(), userText: 'LATEST_TOO_LARGE_MARKER', attachments: [] }],
      cardCatalog: [],
      compactCardCatalog: [],
      resolvedAttachments: [],
      proposals: [],
    }

    expect(model.prepare?.(request)).toMatchObject({ ok: false })
    await expect(model.respond({ ...request, signal: new AbortController().signal })).resolves.toMatchObject({
      success: false,
      kind: 'invalid-response',
    })
    expect(generate).not.toHaveBeenCalled()
  })

  it('create/update 响应原样交给扩展的响应解析器', async () => {
    const create = { operation: 'create', document: cardDocument('SuggestedCard', '新建') }
    const update = {
      operation: 'update',
      targetCardId: 'Fireball',
      baseRevision: 'rev-1',
      document: cardDocument('Fireball', '修改'),
    }
    const content = JSON.stringify({
      schemaVersion: 1,
      text: '已准备两个提案',
      quickReplies: [],
      proposals: [create, update],
    })
    const model = createConversationModel({
      generate: vi.fn().mockResolvedValue({ success: true, content }),
      diagnostics: () => ({ provider: 'mock', model: 'mock' }),
    } as Pick<BaseLLMAdapter, 'generate' | 'diagnostics'>)

    const result = await model.respond({
      projectPath: '/p',
      turns: [turn()],
      signal: new AbortController().signal,
      ...context(),
    })

    expect(result.success).toBe(true)
    if (!result.success) return
    expect(parseConversationResponseText(result.content)).toEqual({
      ok: true,
      value: { schemaVersion: 1, text: '已准备两个提案', quickReplies: [], proposals: [create, update] },
    })
  })

  it('响应完成后读取 adapter 的实际 diagnostics', async () => {
    let actual = false
    const diagnostics = vi.fn(() => actual
      ? { provider: 'qwen', model: 'qwen-plus', requestId: 'provider-request-1' }
      : { provider: 'qwen', model: 'qwen-plus' })
    const generate = vi.fn(async () => {
      actual = true
      return { success: true as const, content: '{"schemaVersion":1,"text":"好","quickReplies":[],"proposals":[]}' }
    })
    const model = createConversationModel({ generate, diagnostics } as Pick<BaseLLMAdapter, 'generate' | 'diagnostics'>)

    const result = await model.respond({
      projectPath: '/p',
      turns: [turn()],
      signal: new AbortController().signal,
      ...context(),
    })

    expect(result).toMatchObject({
      success: true,
      diagnostics: { provider: 'qwen', model: 'qwen-plus', requestId: 'provider-request-1' },
    })
  })

  it('把 adapter 失败映射为 ConversationModel 失败', async () => {
    const generate = vi.fn().mockResolvedValue({ success: false, error: '请求超时', errorType: 'timeout' })
    const diagnostics = vi.fn(() => ({ provider: 'qwen', model: 'qwen-turbo' }))
    const model = createConversationModel({ generate, diagnostics } as Pick<BaseLLMAdapter, 'generate' | 'diagnostics'>)

    await expect(model.respond({
      projectPath: '/p',
      turns: [{ ...turn(), attachments: [] }],
      signal: new AbortController().signal,
      cardCatalog: [],
      compactCardCatalog: [],
      resolvedAttachments: [],
      proposals: [],
    }))
      .resolves.toEqual({
        success: false,
        error: '请求超时',
        kind: 'timeout',
        diagnostics: { provider: 'qwen', model: 'qwen-turbo' },
      })
  })
})
