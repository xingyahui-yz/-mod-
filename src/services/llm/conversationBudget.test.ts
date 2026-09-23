import { describe, expect, it } from 'vitest'
import {
  allocateConversationBudget,
  estimateConversationTokensConservatively,
  type ConversationBudgetInput,
} from './conversationBudget'

type Attachment = { id: string }
type Message = { id: string }

function budget(overrides: Partial<ConversationBudgetInput<Attachment, Message>> = {}) {
  const input: ConversationBudgetInput<Attachment, Message> = {
    contextWindowTokens: 30,
    reservedOutputTokens: 3,
    reservedExpansionTokens: 2,
    fixedContextSerialized: 'fixed',
    detailedCatalogSerialized: 'detailed',
    compactCatalogSerialized: 'compact',
    attachments: [],
    messages: [{ value: { id: 'latest' }, serialized: 'latest', turnId: 't-latest', role: 'user' }],
    latestUserTurnId: 't-latest',
    estimateTokens: text => costs[text] ?? 1,
    ...overrides,
  }
  return allocateConversationBudget(input)
}

const costs: Record<string, number> = {
  fixed: 1,
  detailed: 8,
  compact: 3,
  latest: 4,
  attachment: 5,
  old: 4,
  middle: 2,
}

describe('allocateConversationBudget', () => {
  it('prefers detailed catalog when mandatory context and the latest user message fit', () => {
    const result = budget({ contextWindowTokens: 25 })

    expect(result).toMatchObject({ ok: true, tier: 'detailed' })
    if (!result.ok) throw new Error('expected budget allocation to succeed')
    expect(result.counts).toMatchObject({
      fixedContextTokens: 1,
      catalogTokens: 8,
      messageTokens: 4,
      reservedOutputTokens: 3,
      reservedExpansionTokens: 2,
      estimatedTotalTokens: 18,
      remainingInputTokens: 7,
    })
  })

  it('downgrades to compact and adds complete messages newest-to-oldest, returning chronological order', () => {
    const messages = [
      { value: { id: 'old' }, serialized: 'old', turnId: 't-old', role: 'user' as const },
      { value: { id: 'middle' }, serialized: 'middle', turnId: 't-middle', role: 'assistant' as const },
      { value: { id: 'latest' }, serialized: 'latest', turnId: 't-latest', role: 'user' as const },
    ]
    const result = budget({ contextWindowTokens: 17, messages })

    expect(result).toMatchObject({ ok: true, tier: 'compact', omittedMessageCount: 1 })
    if (!result.ok) throw new Error('expected budget allocation to succeed')
    expect(result.messages).toEqual([{ id: 'middle' }, { id: 'latest' }])
    expect(result.counts.messageTokens).toBe(6)
    expect(result.counts.estimatedTotalTokens).toBe(15)
  })

  it('keeps every explicit attachment whole and fails instead of dropping one when mandatory attachments exceed budget', () => {
    const attachment = { value: { id: 'attached' }, serialized: 'attachment' }
    const result = budget({
      contextWindowTokens: 10,
      reservedOutputTokens: 1,
      reservedExpansionTokens: 1,
      attachments: [attachment],
    })

    expect(result).toMatchObject({ ok: false, error: 'attachments-over-budget' })
    if (result.ok) throw new Error('expected attachments to exceed budget')
    expect(result.counts.attachmentTokens).toBe(5)
  })

  it('fails when the latest user message cannot fit whole after compact catalog and attachments', () => {
    const result = budget({
      contextWindowTokens: 12,
      reservedOutputTokens: 1,
      reservedExpansionTokens: 1,
      attachments: [{ value: { id: 'attached' }, serialized: 'attachment' }],
    })

    expect(result).toMatchObject({ ok: false, error: 'latest-user-message-over-budget' })
    if (result.ok) throw new Error('expected latest user message to exceed budget')
    expect(result.counts.messageTokens).toBe(4)
  })

  it('never truncates selected messages or attachments and accounts for both reserves', () => {
    const longText = '这是一整段不得截断的用户内容。'
    const longAttachment = '完整CardDocument内容不可截断'
    const result = allocateConversationBudget({
      contextWindowTokens: 200,
      reservedOutputTokens: 17,
      reservedExpansionTokens: 11,
      fixedContextSerialized: 'fixed',
      detailedCatalogSerialized: 'detailed',
      compactCatalogSerialized: 'compact',
      attachments: [{ value: longAttachment, serialized: longAttachment }],
      messages: [{ value: longText, serialized: longText, turnId: 't1', role: 'user' }],
      latestUserTurnId: 't1',
      estimateTokens: text => text.length,
    })

    expect(result).toMatchObject({ ok: true, tier: 'detailed' })
    if (!result.ok) throw new Error('expected budget allocation to succeed')
    expect(result.attachments).toEqual([longAttachment])
    expect(result.messages).toEqual([longText])
    expect(result.counts.estimatedReservedTokens).toBe(28)
    expect(result.counts.estimatedTotalTokens).toBeLessThanOrEqual(200)
  })

  it('uses a deterministic Unicode-code-point heuristic and labels it as an estimate', () => {
    expect(estimateConversationTokensConservatively('猫🙂')).toBe(6)
    expect(estimateConversationTokensConservatively('')).toBe(0)
    expect(estimateConversationTokensConservatively('猫🙂'))
      .toBe(estimateConversationTokensConservatively('猫🙂'))
  })

  it('rejects missing latest user turn and invalid estimator output', () => {
    expect(budget({ messages: [] })).toMatchObject({ ok: false, error: 'missing-latest-user-turn' })
    expect(budget({ estimateTokens: () => Number.NaN })).toMatchObject({ ok: false, error: 'invalid-estimate' })
  })
})
