import { describe, expect, it } from 'vitest'
import { createConversationDocument, migrateConversationDocument, parseConversationDocument, type ConversationDocumentV1 } from './conversationDocument'

const diagnostics = { provider: 'qwen', model: 'qwen-turbo', requestId: 'request-1' }

function validDocument(): ConversationDocumentV1 {
  return {
    ...createConversationDocument('2026-09-01T00:00:00Z'),
    turns: [{
      id: 'turn-1',
      userText: '继续',
      assistantText: null,
      quickReplies: [],
      quickReplySelection: null,
      attachments: [{ cardId: 'card-1', revision: 'rev-1' }],
      attempts: [{
        id: 'attempt-1',
        status: 'failed',
        startedAt: '2026-09-01T00:00:00Z',
        finishedAt: '2026-09-01T00:01:00Z',
        error: '超时',
        failureKind: 'timeout',
        diagnostics,
      }],
      createdAt: '2026-09-01T00:00:00Z',
    }],
  }
}

describe('parseConversationDocument', () => {
  it('接受严格的当前 v1 文档并提供迁移入口', () => {
    const document = validDocument()
    expect(parseConversationDocument(document)).toEqual({ ok: true, document })
    expect(migrateConversationDocument(document)).toEqual({ ok: true, document, migrated: false })
  })

  it.each([
    (document: ConversationDocumentV1) => ({ ...document, unknown: true }),
    (document: ConversationDocumentV1) => ({ ...document, turns: [{ ...document.turns[0], unknown: true }] }),
    (document: ConversationDocumentV1) => ({ ...document, turns: [{ ...document.turns[0], quickReplies: [{ id: 'yes', label: '继续', unknown: true }] }] }),
    (document: ConversationDocumentV1) => ({ ...document, turns: [{ ...document.turns[0], quickReplySelection: { turnId: 'x', replyId: 'x', unknown: true } }] }),
    (document: ConversationDocumentV1) => ({ ...document, turns: [{ ...document.turns[0], attachments: [{ cardId: 'card-1', revision: 'rev-1', unknown: true }] }] }),
    (document: ConversationDocumentV1) => ({ ...document, turns: [{ ...document.turns[0], attempts: [{ ...document.turns[0].attempts[0], unknown: true }] }] }),
    (document: ConversationDocumentV1) => ({ ...document, turns: [{ ...document.turns[0], attempts: [{ ...document.turns[0].attempts[0], diagnostics: { ...diagnostics, unknown: true } }] }] }),
  ])('逐层拒绝未知字段 %#', mutate => {
    expect(parseConversationDocument(mutate(validDocument())).ok).toBe(false)
  })

  it('迁移 bb5f191 的带 projectPath v1 文档', () => {
    const legacy = {
      schemaVersion: 1,
      projectPath: '/legacy-project',
      createdAt: '2026-09-01T00:00:00Z',
      updatedAt: '2026-09-01T00:01:00Z',
      turns: [{
        id: 'turn-1', userText: '继续', assistantText: null, quickReplies: [], attachments: [], createdAt: '2026-09-01T00:00:00Z',
        attempts: [{
          id: 'attempt-1', status: 'failed', startedAt: '2026-09-01T00:00:00Z', finishedAt: '2026-09-01T00:01:00Z',
          error: `apiKey=sk-legacy-secret ${'x'.repeat(600)}`,
        }],
      }],
    }
    const result = migrateConversationDocument(legacy)
    expect(result).toMatchObject({ ok: true, migrated: true })
    if (!result.ok) throw new Error(result.reason)
    expect(result.document).not.toHaveProperty('projectPath')
    expect(result.document.turns[0]).toMatchObject({ quickReplySelection: null })
    expect(result.document.turns[0].attempts[0]).toMatchObject({ failureKind: 'provider', diagnostics: { provider: 'unknown', model: 'unknown', requestId: 'unknown' } })
    expect(result.document.turns[0].attempts[0].error).not.toContain('sk-legacy-secret')
    expect(result.document.turns[0].attempts[0].error!.length).toBeLessThanOrEqual(500)
  })

  it('快捷回答只能引用此前回复，且用户文字必须等于 label', () => {
    const first = {
      ...validDocument().turns[0],
      assistantText: '请选择',
      quickReplies: [{ id: 'yes', label: '继续' }],
      attempts: [{ ...validDocument().turns[0].attempts[0], status: 'completed' as const, error: null, failureKind: null }],
    }
    const second = {
      ...validDocument().turns[0],
      id: 'turn-2',
      attempts: [{ ...validDocument().turns[0].attempts[0], id: 'attempt-2' }],
      quickReplySelection: { turnId: 'turn-1', replyId: 'yes' },
    }
    expect(parseConversationDocument({ ...validDocument(), turns: [first, second] }).ok).toBe(true)
    expect(parseConversationDocument({ ...validDocument(), turns: [first, { ...second, userText: '别的文字' }] }).ok).toBe(false)
    expect(parseConversationDocument({ ...validDocument(), turns: [{ ...second, quickReplySelection: { turnId: 'turn-2', replyId: 'yes' } }] }).ok).toBe(false)
  })

  it.each([
    (document: ConversationDocumentV1) => ({ ...document, turns: [{ ...document.turns[0], attempts: [{ ...document.turns[0].attempts[0], status: 'running', finishedAt: null, error: null, failureKind: null }] }, document.turns[0]] }),
    (document: ConversationDocumentV1) => ({ ...document, turns: [{ ...document.turns[0], attempts: [] }] }),
    (document: ConversationDocumentV1) => ({ ...document, turns: [{ ...document.turns[0], attachments: [...document.turns[0].attachments, document.turns[0].attachments[0]] }] }),
    (document: ConversationDocumentV1) => ({ ...document, turns: [document.turns[0], { ...document.turns[0], id: 'turn-2' }] }),
    (document: ConversationDocumentV1) => ({ ...document, turns: [{ ...document.turns[0], failureKind: 'cancelled' }] }),
    (document: ConversationDocumentV1) => ({ ...document, turns: [{ ...document.turns[0], assistantText: '幽灵响应' }] }),
  ])('拒绝全局或状态不变量违规 %#', mutate => {
    expect(parseConversationDocument(mutate(validDocument())).ok).toBe(false)
  })

  it('attempt ID 跨轮次也必须唯一', () => {
    const document = validDocument()
    const second = { ...document.turns[0], id: 'turn-2', quickReplySelection: null }
    expect(parseConversationDocument({ ...document, turns: [document.turns[0], second] }).ok).toBe(false)
  })

  it.each([
    { status: 'cancelled', failureKind: 'provider' },
    { status: 'failed', failureKind: 'cancelled' },
    { status: 'interrupted', failureKind: 'provider' },
    { status: 'completed', failureKind: 'provider', error: null },
  ])('拒绝 status/failureKind 非法组合 %#', patch => {
    const document = validDocument()
    const attempt = { ...document.turns[0].attempts[0], ...patch }
    const assistantText = patch.status === 'completed' ? '完成' : null
    expect(parseConversationDocument({ ...document, turns: [{ ...document.turns[0], assistantText, attempts: [attempt] }] }).ok).toBe(false)
  })
})
