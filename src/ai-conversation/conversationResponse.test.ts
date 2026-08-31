import { describe, expect, it } from 'vitest'
import { parseConversationResponse } from './conversationResponse'

describe('parseConversationResponse', () => {
  it('接受正文、零提案和快捷回答', () => {
    const result = parseConversationResponse({ schemaVersion: 1, text: '你好', quickReplies: [{ id: 'yes', label: '继续' }], proposals: [] })
    expect(result.ok).toBe(true)
  })

  it.each([
    { schemaVersion: 1, text: '', quickReplies: [], proposals: [] },
    { schemaVersion: 1, text: 'x', quickReplies: [], proposals: [], extra: true },
    { schemaVersion: 1, text: 'x', quickReplies: [{ id: 'a', label: 'A' }, { id: 'a', label: 'B' }], proposals: [] },
    { schemaVersion: 1, text: 'x', quickReplies: [], proposals: [{}] },
  ])('原子拒绝非法信封 %#', value => expect(parseConversationResponse(value).ok).toBe(false))
})
