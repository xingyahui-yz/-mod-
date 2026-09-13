import { describe, expect, it } from 'vitest'
import { mkdtemp, mkdir, readFile, readdir, rename, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createConversationDocument } from './conversationDocument'
import { createConversationRepository, type ConversationFilePort } from './conversationRepository'

function memoryFiles(initial: Record<string, string> = {}) {
  const data = new Map(Object.entries(initial))
  const files: ConversationFilePort = {
    readFile: async path => data.has(path) ? { status: 'found', value: data.get(path)! } : { status: 'missing' },
    readDirectory: async path => ({
      status: 'found',
      value: [...data.keys()]
        .filter(candidate => candidate.startsWith(`${path}/`))
        .map(candidate => candidate.slice(path.length + 1))
        .filter(candidate => !candidate.includes('/')),
    }),
    writeFile: async (path, content) => { data.set(path, content); return true },
    rename: async (from, to) => {
      const value = data.get(from)
      if (value === undefined) return false
      data.set(to, value)
      data.delete(from)
      return true
    },
    mkdir: async () => true,
    remove: async path => data.delete(path),
  }
  return { files, data }
}

function realFiles(): ConversationFilePort {
  return {
    readFile: async path => {
      try { return { status: 'found', value: await readFile(path, 'utf8') } }
      catch (error) { return isMissing(error) ? { status: 'missing' } : { status: 'error', error: errorMessage(error) } }
    },
    readDirectory: async path => {
      try { return { status: 'found', value: await readdir(path) } }
      catch (error) { return isMissing(error) ? { status: 'missing' } : { status: 'error', error: errorMessage(error) } }
    },
    writeFile: async (path, content) => {
      try { await writeFile(path, content, 'utf8'); return true } catch { return false }
    },
    rename: async (from, to) => {
      try { await rename(from, to); return true } catch { return false }
    },
    mkdir: async path => {
      try { await mkdir(path, { recursive: true }); return true } catch { return false }
    },
    remove: async path => {
      try { await rm(path); return true } catch { return false }
    },
  }
}

describe('ConversationRepository', () => {
  it('原子保存并读回版本化文档', async () => {
    const memory = memoryFiles()
    const repository = createConversationRepository(memory.files, () => 1, () => 'save-1')
    expect(await repository.save('/project', createConversationDocument('2026-09-01T00:00:00Z'))).toEqual({ ok: true })
    expect((await repository.load('/project')).status).toBe('loaded')
    expect([...memory.data.keys()]).toEqual(['/project/.modstudio/ai/conversation.json'])
  })

  it('加载并原子改写严格 v1 为 proposals 为空的 v2', async () => {
    const path = '/project/.modstudio/ai/conversation.json'
    const current = createConversationDocument('2026-09-01T00:00:00Z')
    const v1 = {
      schemaVersion: 1,
      turns: current.turns,
      createdAt: current.createdAt,
      updatedAt: current.updatedAt,
    }
    const memory = memoryFiles({ [path]: JSON.stringify(v1) })

    const result = await createConversationRepository(memory.files, () => 2, () => 'migrate-v1').load('/project')

    expect(result).toEqual({ status: 'loaded', document: current, warning: undefined })
    expect(JSON.parse(memory.data.get(path)!)).toEqual(current)
  })

  it('read error 不会伪装成 missing', async () => {
    const memory = memoryFiles()
    const files: ConversationFilePort = {
      ...memory.files,
      readDirectory: async () => ({ status: 'error', error: 'EACCES' }),
    }
    await expect(createConversationRepository(files).load('/project')).resolves.toEqual({
      status: 'failed', reason: 'EACCES', path: '/project/.modstudio/ai/conversation.json',
    })
  })

  it('隔离损坏活动文档后恢复最新有效备份', async () => {
    const path = '/project/.modstudio/ai/conversation.json'
    const backup = `${path}.backup-41-valid`
    const document = createConversationDocument('2026-09-01T00:00:00Z')
    const memory = memoryFiles({ [path]: '{bad', [backup]: JSON.stringify(document) })
    const result = await createConversationRepository(memory.files, () => 42, () => 'quarantine').load('/project')
    expect(result).toMatchObject({ status: 'loaded', document })
    expect(result).toHaveProperty('warning', `损坏活动文档已隔离到 ${path}.quarantine-42-quarantine`)
    expect(JSON.parse(memory.data.get(path)!)).toEqual(document)
    expect(memory.data.has(`${path}.quarantine-42-quarantine`)).toBe(true)
  })

  it('损坏的已知 v2 schema 仍可从备份恢复', async () => {
    const path = '/project/.modstudio/ai/conversation.json'
    const backup = `${path}.backup-41-valid`
    const document = createConversationDocument('2026-09-01T00:00:00Z')
    const memory = memoryFiles({
      [path]: JSON.stringify({ ...document, proposals: 'broken' }),
      [backup]: JSON.stringify(document),
    })

    const result = await createConversationRepository(memory.files, () => 42, () => 'known-v2').load('/project')

    expect(result).toMatchObject({ status: 'loaded', document })
    expect(memory.data.has(`${path}.quarantine-42-known-v2`)).toBe(true)
  })

  it('未来 schema 即使存在旧备份也保持隔离，不自动降级继续写入', async () => {
    const path = '/project/.modstudio/ai/conversation.json'
    const backup = `${path}.backup-41-valid`
    const oldDocument = createConversationDocument('2026-09-01T00:00:00Z')
    const memory = memoryFiles({
      [path]: JSON.stringify({ schemaVersion: 99, opaqueFutureHistory: ['must-preserve'] }),
      [backup]: JSON.stringify(oldDocument),
    })

    const result = await createConversationRepository(memory.files, () => 42, () => 'future').load('/project')

    expect(result).toEqual({
      status: 'quarantined',
      reason: '不支持的 schemaVersion',
      path: `${path}.quarantine-future-42-future`,
      warning: undefined,
    })
    expect(memory.data.has(path)).toBe(false)
    expect(memory.data.has(backup)).toBe(true)
    expect(memory.data.get(`${path}.quarantine-future-42-future`)).toContain('opaqueFutureHistory')
    await expect(createConversationRepository(memory.files).load('/project')).resolves.toMatchObject({
      status: 'quarantined',
      reason: '发现未知未来 schema 的隔离对话文档',
      path: `${path}.quarantine-future-42-future`,
    })
  })

  it('有效 active 优先于 orphan backup', async () => {
    const path = '/project/.modstudio/ai/conversation.json'
    const active = createConversationDocument('2026-09-02T00:00:00Z')
    const backup = createConversationDocument('2026-09-01T00:00:00Z')
    const memory = memoryFiles({ [path]: JSON.stringify(active), [`${path}.backup-99-old`]: JSON.stringify(backup) })
    await expect(createConversationRepository(memory.files).load('/project')).resolves.toEqual({ status: 'loaded', document: active, warning: undefined })
    expect(memory.data.has(`${path}.backup-99-old`)).toBe(true)
  })

  it('active 缺失时跳过较新的坏备份并恢复最新有效备份', async () => {
    const path = '/project/.modstudio/ai/conversation.json'
    const valid = createConversationDocument('2026-09-01T00:00:00Z')
    const memory = memoryFiles({
      [`${path}.backup-200-bad`]: '{bad',
      [`${path}.backup-100-valid`]: JSON.stringify(valid),
    })
    await expect(createConversationRepository(memory.files).load('/project')).resolves.toMatchObject({ status: 'loaded', document: valid })
    expect(JSON.parse(memory.data.get(path)!)).toEqual(valid)
  })

  it('重启后通过目录发现已隔离文档', async () => {
    const quarantinePath = '/project/.modstudio/ai/conversation.json.quarantine-42-id'
    const memory = memoryFiles({ [quarantinePath]: '{bad' })
    await expect(createConversationRepository(memory.files).load('/project')).resolves.toEqual({
      status: 'quarantined', reason: '发现先前隔离的对话文档', path: quarantinePath, warning: undefined,
    })
  })

  it('读回不等值时恢复旧文档并报告 unchanged', async () => {
    const path = '/project/.modstudio/ai/conversation.json'
    const original = createConversationDocument('2026-09-01T00:00:00Z')
    const next = createConversationDocument('2026-09-02T00:00:00Z')
    const memory = memoryFiles({ [path]: JSON.stringify(original) })
    let activeReads = 0
    const files: ConversationFilePort = {
      ...memory.files,
      readFile: async candidate => {
        if (candidate === path && ++activeReads === 2) {
          return { status: 'found', value: JSON.stringify({ ...next, updatedAt: '2026-09-03T00:00:00Z' }) }
        }
        return memory.files.readFile(candidate)
      },
    }
    const result = await createConversationRepository(files, () => 7, () => 'rollback').save('/project', next)
    expect(result).toEqual({ ok: false, error: '保存后读回等值校验失败，已恢复旧状态', certainty: 'unchanged' })
    expect(JSON.parse(memory.data.get(path)!)).toEqual(original)
  })

  it('无法确认回滚时报告 uncertain', async () => {
    const path = '/project/.modstudio/ai/conversation.json'
    const original = createConversationDocument('2026-09-01T00:00:00Z')
    const memory = memoryFiles({ [path]: JSON.stringify(original) })
    const files: ConversationFilePort = {
      ...memory.files,
      rename: async (from, to) => {
        if (from.includes('.tmp-') && to === path) return false
        if (from.includes('.backup-') && to === path) return false
        return memory.files.rename(from, to)
      },
    }
    await expect(createConversationRepository(files, () => 7, () => 'uncertain').save('/project', createConversationDocument('2026-09-02T00:00:00Z')))
      .resolves.toMatchObject({ ok: false, certainty: 'uncertain' })
  })

  it('write 失败时清理已产生的临时文件', async () => {
    const memory = memoryFiles()
    const files: ConversationFilePort = {
      ...memory.files,
      writeFile: async (path, content) => { memory.data.set(path, content); return false },
    }
    await expect(createConversationRepository(files, () => 1, () => 'write-fail').save('/project', createConversationDocument('2026-09-01T00:00:00Z')))
      .resolves.toEqual({ ok: false, error: '无法写入临时文件', certainty: 'unchanged' })
    expect([...memory.data.keys()]).toEqual([])
  })

  it('备份清理失败作为成功 warning 可观测', async () => {
    const path = '/project/.modstudio/ai/conversation.json'
    const memory = memoryFiles({ [path]: JSON.stringify(createConversationDocument('2026-09-01T00:00:00Z')) })
    const files: ConversationFilePort = {
      ...memory.files,
      remove: async candidate => candidate.includes('.backup-') ? false : memory.files.remove(candidate),
    }
    await expect(createConversationRepository(files, () => 2, () => 'cleanup').save('/project', createConversationDocument('2026-09-02T00:00:00Z')))
      .resolves.toEqual({ ok: true, warning: `新文档已保存，但备份清理失败：${path}.backup-2-cleanup` })
  })

  it('跨 repository 实例使用 UUID seam 生成不同 temp 路径', async () => {
    const memory = memoryFiles()
    const temporaryPaths: string[] = []
    const files: ConversationFilePort = {
      ...memory.files,
      writeFile: async (path, content) => { temporaryPaths.push(path); memory.data.set(path, content); return true },
    }
    await createConversationRepository(files, () => 99, () => 'instance-a').save('/a', createConversationDocument('2026-09-01T00:00:00Z'))
    await createConversationRepository(files, () => 99, () => 'instance-b').save('/b', createConversationDocument('2026-09-01T00:00:00Z'))
    expect(temporaryPaths).toEqual([
      '/a/.modstudio/ai/conversation.json.tmp-99-instance-a',
      '/b/.modstudio/ai/conversation.json.tmp-99-instance-b',
    ])
  })

  it('真实目录可从 crash orphan backup 恢复并清理 stale tmp', async () => {
    const root = await mkdtemp(join(tmpdir(), 'modstudio-conversation-crash-'))
    const aiDirectory = join(root, '.modstudio/ai')
    const document = createConversationDocument('2026-09-01T00:00:00Z')
    try {
      await mkdir(aiDirectory, { recursive: true })
      await writeFile(join(aiDirectory, 'conversation.json.backup-100-crash'), JSON.stringify(document), 'utf8')
      await writeFile(join(aiDirectory, 'conversation.json.tmp-101-crash'), 'partial', 'utf8')
      const result = await createConversationRepository(realFiles()).load(root)
      expect(result).toMatchObject({ status: 'loaded', document })
      expect(await readdir(aiDirectory)).toEqual(['conversation.json'])
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  it('真实目录加载 v1 后持久化为 v2 且不遗留临时文件', async () => {
    const root = await mkdtemp(join(tmpdir(), 'modstudio-conversation-migrate-'))
    const aiDirectory = join(root, '.modstudio/ai')
    const path = join(aiDirectory, 'conversation.json')
    const current = createConversationDocument('2026-09-01T00:00:00Z')
    const v1 = {
      schemaVersion: 1,
      turns: current.turns,
      createdAt: current.createdAt,
      updatedAt: current.updatedAt,
    }
    try {
      await mkdir(aiDirectory, { recursive: true })
      await writeFile(path, JSON.stringify(v1), 'utf8')

      const result = await createConversationRepository(realFiles(), () => 2, () => 'real-migrate').load(root)

      expect(result).toEqual({ status: 'loaded', document: current, warning: undefined })
      expect(JSON.parse(await readFile(path, 'utf8'))).toEqual(current)
      expect(await readdir(aiDirectory)).toEqual(expect.arrayContaining(['conversation.json', 'conversation.json.backup-2-real-migrate']))
      expect((await readdir(aiDirectory)).some(entry => entry.includes('.tmp-'))).toBe(false)
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  it('真实目录 rollback 保留旧活动文档', async () => {
    const root = await mkdtemp(join(tmpdir(), 'modstudio-conversation-rollback-'))
    const aiDirectory = join(root, '.modstudio/ai')
    const path = join(aiDirectory, 'conversation.json')
    const original = createConversationDocument('2026-09-01T00:00:00Z')
    try {
      await mkdir(aiDirectory, { recursive: true })
      await writeFile(path, JSON.stringify(original), 'utf8')
      const base = realFiles()
      const files: ConversationFilePort = {
        ...base,
        rename: async (from, to) => from.includes('.tmp-') && to === path ? false : base.rename(from, to),
      }
      const result = await createConversationRepository(files, () => 2, () => 'rollback').save(root, createConversationDocument('2026-09-02T00:00:00Z'))
      expect(result).toMatchObject({ ok: false, certainty: 'unchanged' })
      expect(JSON.parse(await readFile(path, 'utf8'))).toEqual(original)
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  it('真实目录上的 EACCES tagged error 阻止恢复猜测', async () => {
    const root = await mkdtemp(join(tmpdir(), 'modstudio-conversation-eacces-'))
    const base = realFiles()
    const files: ConversationFilePort = {
      ...base,
      readDirectory: async path => path.endsWith('/.modstudio/ai')
        ? { status: 'error', error: 'EACCES: permission denied' }
        : base.readDirectory(path),
    }
    try {
      await expect(createConversationRepository(files).load(root)).resolves.toMatchObject({ status: 'failed', reason: 'EACCES: permission denied' })
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })
})

function isMissing(error: unknown): boolean {
  return Boolean(error && typeof error === 'object' && 'code' in error && (error as { code?: string }).code === 'ENOENT')
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
