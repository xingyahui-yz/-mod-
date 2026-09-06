import { describe, expect, it, vi } from 'vitest'
import type { ConversationTurn } from '../../../ai-conversation/conversationDocument'
import type { BaseLLMAdapter } from './base'
import { createConversationModel } from './conversationModel'

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
  }
}

describe('createConversationModel', () => {
  it('传递外部 signal，并要求严格的零提案响应信封', async () => {
    const generate = vi.fn().mockResolvedValue({ success: true, content: '{"schemaVersion":1,"text":"好","quickReplies":[],"proposals":[]}' })
    const diagnostics = vi.fn(() => ({ provider: 'qwen', model: 'qwen-turbo' }))
    const model = createConversationModel({ generate, diagnostics } as Pick<BaseLLMAdapter, 'generate' | 'diagnostics'>)
    const controller = new AbortController()

    const result = await model.respond({ projectPath: '/private/project', turns: [turn()], signal: controller.signal })

    expect(result.success).toBe(true)
    expect(generate).toHaveBeenCalledOnce()
    const [prompt, options] = generate.mock.calls[0]
    expect(options.signal).toBe(controller.signal)
    expect(prompt).toContain('"proposals":[]')
    expect(prompt).toContain('Fireball')
    expect(prompt).toContain('"turnId":"turn-1"')
    expect(prompt).toContain('"quickReplies":[]')
    expect(prompt).toContain('"quickReplySelection":null')
    expect(prompt).not.toContain('/private/project')
    expect(result).toMatchObject({
      success: true,
      diagnostics: { provider: 'qwen', model: 'qwen-turbo' },
    })
    expect(model.diagnostics?.()).toEqual({ provider: 'qwen', model: 'qwen-turbo' })
  })

  it('把 adapter 失败映射为 ConversationModel 失败', async () => {
    const generate = vi.fn().mockResolvedValue({ success: false, error: '请求超时', errorType: 'timeout' })
    const diagnostics = vi.fn(() => ({ provider: 'qwen', model: 'qwen-turbo' }))
    const model = createConversationModel({ generate, diagnostics } as Pick<BaseLLMAdapter, 'generate' | 'diagnostics'>)

    await expect(model.respond({ projectPath: '/p', turns: [turn()], signal: new AbortController().signal }))
      .resolves.toEqual({
        success: false,
        error: '请求超时',
        kind: 'timeout',
        diagnostics: { provider: 'qwen', model: 'qwen-turbo' },
      })
  })
})
