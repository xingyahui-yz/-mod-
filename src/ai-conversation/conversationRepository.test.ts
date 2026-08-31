import { describe, expect, it } from 'vitest'
import { createConversationDocument } from './conversationDocument'
import { createConversationRepository, type ConversationFilePort } from './conversationRepository'

function memoryFiles(initial: Record<string, string> = {}) {
  const data = new Map(Object.entries(initial))
  const files: ConversationFilePort = {
    readFile: async path => data.get(path) ?? null,
    writeFile: async (path, content) => { data.set(path, content); return true },
    rename: async (from, to) => { const value = data.get(from); if (value === undefined) return false; data.set(to, value); data.delete(from); return true },
    mkdir: async () => true,
    remove: async path => data.delete(path),
  }
  return { files, data }
}

describe('ConversationRepository', () => {
  it('原子保存并读回版本化文档', async () => {
    const memory = memoryFiles()
    const repository = createConversationRepository(memory.files)
    expect(await repository.save('/project', createConversationDocument('/project', '2026-09-01T00:00:00Z'))).toEqual({ ok: true })
    expect((await repository.load('/project')).status).toBe('loaded')
    expect([...memory.data.keys()]).toEqual(['/project/.modstudio/ai/conversation.json'])
  })

  it('隔离损坏文档而不是覆盖', async () => {
    const path = '/project/.modstudio/ai/conversation.json'
    const memory = memoryFiles({ [path]: '{bad' })
    const result = await createConversationRepository(memory.files, () => 42).load('/project')
    expect(result).toEqual({ status: 'quarantined', reason: 'JSON 损坏', path: `${path}.quarantine-42` })
  })
})
