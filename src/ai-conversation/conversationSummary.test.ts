import { describe, expect, it } from 'vitest'
import type { ConversationTurn } from './conversationDocument'
import { buildConversationSummaryInput, estimateUnsummarizedConversationTokens, getUnsummarizedTurns } from './conversationSummary'

function turn(id: string, userText = id, assistantText: string | null = 'answer'): ConversationTurn {
  return {
    id, userText, assistantText, quickReplies: [], quickReplySelection: null, attachments: [],
    attempts: [{ id: 'attempt-' + id, status: 'completed', startedAt: '2026-01-01T00:00:00Z', finishedAt: '2026-01-01T00:00:01Z', error: null, failureKind: null, diagnostics: { provider: 'test', model: 'test', requestId: 'unknown' } }],
    createdAt: '2026-01-01T00:00:00Z', contextSnapshot: null,
  }
}

describe('conversationSummary helpers', () => {
  it('只从有效的 summary cursor 之后保留未摘要轮次，cursor 丢失时退回完整历史', () => {
    const turns = [turn('a'), turn('b'), turn('c')]
    expect(getUnsummarizedTurns(turns, { throughTurnId: 'b', text: 'intent' }).map(item => item.id)).toEqual(['c'])
    expect(getUnsummarizedTurns(turns, { throughTurnId: 'missing', text: 'intent' })).toEqual(turns)
    expect(getUnsummarizedTurns(turns, null)).toEqual(turns)
  })

  it('只估算用户和助手消息，并不把未完成的助手消息误计为历史内容', () => {
    const completed = estimateUnsummarizedConversationTokens([turn('a')])
    const running = estimateUnsummarizedConversationTokens([turn('a', 'a', null)])
    expect(completed).toBeGreaterThan(running)
  })

  it('摘要 prompt 明确把提案/Card 事实留给本地派生层', () => {
    const prompt = buildConversationSummaryInput('prior goals', [turn('a', '用户偏好简洁')])
    expect(prompt).toContain('用户偏好简洁')
    expect(prompt).toContain('提案状态')
    expect(prompt).toContain('prior goals')
  })
})
