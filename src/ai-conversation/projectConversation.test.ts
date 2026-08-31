import { describe, expect, it } from 'vitest'
import { ProjectConversation, type ConversationModel } from './projectConversation'
import type { ConversationDocumentV1 } from './conversationDocument'
import type { ConversationRepository } from './conversationRepository'

function harness(model: ConversationModel) {
  let saved: ConversationDocumentV1 | null = null
  const repository: ConversationRepository = {
    load: async () => saved ? { status: 'loaded', document: saved } : { status: 'missing' },
    save: async (_path, document) => { saved = structuredClone(document); return { ok: true } },
  }
  let id = 0
  const conversation = new ProjectConversation('/p', repository, model, () => new Date('2026-09-01T00:00:00Z'), () => `id-${++id}`)
  return { conversation, saved: () => saved }
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
  })
})
