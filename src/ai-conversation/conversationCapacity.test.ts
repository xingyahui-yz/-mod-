import { describe, expect, it } from 'vitest'
import { createConversationDocument, type ConversationDocument, type ConversationTurn } from './conversationDocument'
import { measureConversationCapacity } from './conversationCapacity'

function turn(id: string, assistantText: string | null = null): ConversationTurn {
  return {
    id,
    userText: '用户',
    assistantText,
    quickReplies: [],
    quickReplySelection: null,
    attachments: [],
    attempts: [],
    createdAt: '2026-09-01T00:00:00Z',
    contextSnapshot: null,
  }
}

function documentWith(turns: ConversationTurn[]): ConversationDocument {
  return { ...createConversationDocument('2026-09-01T00:00:00Z'), turns }
}

describe('measureConversationCapacity', () => {
  const limits = { warningBytes: 10_000, warningMessages: 2, hardBytes: 20_000, hardMessages: 4 }

  it('按消息数量的严格超过边界分级，assistant 回复作为单独消息计数', () => {
    expect(measureConversationCapacity(documentWith([turn('one')]), limits)).toMatchObject({ level: 'normal', messageCount: 1 })
    expect(measureConversationCapacity(documentWith([turn('one', 'reply')]), limits)).toMatchObject({ level: 'normal', messageCount: 2 })
    expect(measureConversationCapacity(documentWith([turn('one'), turn('two')]), limits)).toMatchObject({ level: 'normal', messageCount: 2 })
    expect(measureConversationCapacity(documentWith([turn('one', 'reply'), turn('two')]), limits)).toMatchObject({ level: 'warning', messageCount: 3 })
    expect(measureConversationCapacity(documentWith([turn('one', 'reply'), turn('two', 'reply')]), limits))
      .toMatchObject({ level: 'warning', messageCount: 4 })
    expect(measureConversationCapacity(documentWith([turn('one', 'reply'), turn('two', 'reply'), turn('three')]), limits))
      .toMatchObject({ level: 'hard', messageCount: 5 })
  })

  it('使用实际 UTF-8 JSON 字节数并在严格超过字节阈值时告警', () => {
    const ascii = documentWith([turn('one')])
    const multibyte = documentWith([{ ...turn('one'), userText: '卡'.repeat(5000) }])
    const measured = measureConversationCapacity(ascii)
    expect(measureConversationCapacity(ascii, { ...limits, warningBytes: measured.bytes }).level).toBe('normal')
    expect(measureConversationCapacity(multibyte, { ...limits, warningBytes: measured.bytes }).level).toBe('warning')
  })

  it('无活动文档时返回零容量', () => {
    expect(measureConversationCapacity(null)).toEqual({ level: 'normal', bytes: 0, messageCount: 0 })
  })
})
