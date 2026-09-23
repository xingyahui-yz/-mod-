import { describe, expect, it } from 'vitest'
import { link, mkdtemp, mkdir, readFile, readdir, rename, rm, writeFile } from 'node:fs/promises'
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
    linkNoReplace: async (from, to) => {
      const value = data.get(from)
      if (value === undefined) return { status: 'failed' }
      if (data.has(to)) return { status: 'exists' }
      data.set(to, value)
      return { status: 'linked' }
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
    linkNoReplace: async (from, to) => {
      try { await link(from, to); return { status: 'linked' } }
      catch (error) { return isExists(error) ? { status: 'exists' } : { status: 'failed' } }
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

  it('加载并原子改写严格 v1 为当前 v4', async () => {
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

  it('损坏的已知 v4 schema 仍可从备份恢复', async () => {
    const path = '/project/.modstudio/ai/conversation.json'
    const backup = `${path}.backup-41-valid`
    const document = createConversationDocument('2026-09-01T00:00:00Z')
    const memory = memoryFiles({
      [path]: JSON.stringify({ ...document, proposals: 'broken' }),
      [backup]: JSON.stringify(document),
    })

    const result = await createConversationRepository(memory.files, () => 42, () => 'known-v4').load('/project')

    expect(result).toMatchObject({ status: 'loaded', document })
    expect(memory.data.has(`${path}.quarantine-42-known-v4`)).toBe(true)
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

  it('真实目录加载 v1 后持久化为当前 v4 且不遗留临时文件', async () => {
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

  it('原子归档成功后重置 active，列表与读取仅暴露已校验文档', async () => {
    const path = '/project/.modstudio/ai/conversation.json'
    const original = createConversationDocument('2026-09-01T00:00:00Z')
    const memory = memoryFiles({ [path]: JSON.stringify(original) })
    const repository = createConversationRepository(memory.files, () => 5, () => 'archive-1')

    const result = await repository.archiveAndReset('/project', original, '2026-09-02T00:00:00Z')

    expect(result).toEqual({ ok: true, archiveId: 'archive-1' })
    expect(JSON.parse(memory.data.get(path)!)).toEqual(createConversationDocument('2026-09-02T00:00:00.000Z'))
    await expect(repository.listArchives('/project')).resolves.toEqual({
      ok: true,
      archives: [{ archiveId: 'archive-1', createdAt: original.createdAt, updatedAt: original.updatedAt, turnCount: 0, bytes: new TextEncoder().encode(JSON.stringify(original, null, 2)).byteLength }],
    })
    await expect(repository.readArchive('/project', 'archive-1')).resolves.toEqual({
      ok: true, archiveId: 'archive-1', document: original, rawJson: JSON.stringify(original, null, 2),
    })
  })

  it('归档写入或发布读回失败时不重置 active', async () => {
    const path = '/project/.modstudio/ai/conversation.json'
    const original = createConversationDocument('2026-09-01T00:00:00Z')
    for (const mode of ['write', 'readback'] as const) {
      const memory = memoryFiles({ [path]: JSON.stringify(original) })
      const base = memory.files
      let archiveReads = 0
      const files: ConversationFilePort = {
        ...base,
        writeFile: async (candidate, content) => mode === 'write' && candidate.includes('/archives/') ? false : base.writeFile(candidate, content),
        readFile: async candidate => mode === 'readback' && candidate.endsWith('/archive-1.json') && ++archiveReads > 1
          ? { status: 'found', value: '{tampered' }
          : base.readFile(candidate),
      }
      const result = await createConversationRepository(files, () => 1, () => 'archive-1')
        .archiveAndReset('/project', original, '2026-09-02T00:00:00Z')
      expect(result).toMatchObject({ ok: false, certainty: 'unchanged' })
      expect(JSON.parse(memory.data.get(path)!)).toEqual(original)
    }
  })

  it('active reset 失败时保留已验证归档', async () => {
    const path = '/project/.modstudio/ai/conversation.json'
    const original = createConversationDocument('2026-09-01T00:00:00Z')
    const memory = memoryFiles({ [path]: JSON.stringify(original) })
    const base = memory.files
    const files: ConversationFilePort = {
      ...base,
      rename: async (from, to) => from.includes('.tmp-') && to === path ? false : base.rename(from, to),
    }

    const result = await createConversationRepository(files, () => 1, () => 'archive-1')
      .archiveAndReset('/project', original, '2026-09-02T00:00:00Z')

    expect(result).toMatchObject({ ok: false, certainty: 'unchanged' })
    expect(JSON.parse(memory.data.get(path)!)).toEqual(original)
    expect(JSON.parse(memory.data.get('/project/.modstudio/ai/archives/archive-1.json')!)).toEqual(original)
  })

  it('归档读取拒绝路径穿越和未知 schema', async () => {
    const memory = memoryFiles({
      '/project/.modstudio/ai/archives/future.json': JSON.stringify({ schemaVersion: 99 }),
    })
    const repository = createConversationRepository(memory.files)
    await expect(repository.readArchive('/project', '../conversation')).resolves.toMatchObject({ ok: false })
    await expect(repository.readArchive('/project', 'future')).resolves.toMatchObject({ ok: false })
    await expect(repository.listArchives('/project')).resolves.toEqual({ ok: true, archives: [] })
  })

  it('真实目录可原子归档、列出、读回并拒绝路径穿越', async () => {
    const root = await mkdtemp(join(tmpdir(), 'modstudio-conversation-archive-'))
    const active = join(root, '.modstudio/ai/conversation.json')
    const original = createConversationDocument('2026-09-01T00:00:00Z')
    try {
      await mkdir(join(root, '.modstudio/ai'), { recursive: true })
      await writeFile(active, JSON.stringify(original), 'utf8')
      const repository = createConversationRepository(realFiles(), () => 2, () => 'real-archive')
      await expect(repository.archiveAndReset(root, original, '2026-09-02T00:00:00Z')).resolves.toEqual({ ok: true, archiveId: 'real-archive' })
      await expect(repository.listArchives(root)).resolves.toMatchObject({ ok: true, archives: [{ archiveId: 'real-archive', turnCount: 0 }] })
      await expect(repository.readArchive(root, 'real-archive')).resolves.toMatchObject({ ok: true, document: original })
      await expect(repository.readArchive(root, '../conversation')).resolves.toMatchObject({ ok: false })
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  it('读取并恢复可迁移隔离文档，保留原始隔离字节', async () => {
    const path = '/project/.modstudio/ai/conversation.json.quarantine-42-old'
    const current = createConversationDocument('2026-09-01T00:00:00Z')
    const v1 = { schemaVersion: 1, turns: current.turns, createdAt: current.createdAt, updatedAt: current.updatedAt }
    const raw = JSON.stringify(v1, null, 2)
    const memory = memoryFiles({ [path]: raw })
    const repository = createConversationRepository(memory.files)

    const read = await repository.readQuarantine('/project', 'conversation.json.quarantine-42-old')
    expect(read).toMatchObject({ ok: true, recoverable: true, migrated: true, document: current, rawJson: raw })
    await expect(repository.listQuarantines('/project')).resolves.toEqual({
      ok: true,
      quarantines: [{ quarantineId: 'conversation.json.quarantine-42-old', reason: '支持的旧版本，可迁移恢复', schemaVersion: 1, bytes: new TextEncoder().encode(raw).byteLength, recoverable: true }],
    })
    await expect(repository.restoreQuarantine('/project', 'conversation.json.quarantine-42-old')).resolves.toEqual({
      ok: true, quarantineId: 'conversation.json.quarantine-42-old', document: current, migrated: true,
    })
    expect(memory.data.get(path)).toBe(raw)
    expect(JSON.parse(memory.data.get('/project/.modstudio/ai/conversation.json')!)).toEqual(current)
  })

  it('未来 schema quarantine 可导出原始内容但不可恢复', async () => {
    const id = 'conversation.json.quarantine-future-88-future'
    const path = '/project/.modstudio/ai/' + id
    const raw = JSON.stringify({ schemaVersion: 99, opaque: 'preserve' })
    const memory = memoryFiles({ [path]: raw })
    const repository = createConversationRepository(memory.files)

    await expect(repository.readQuarantine('/project', id)).resolves.toEqual({
      ok: true, quarantineId: id, reason: '不支持的 schemaVersion', schemaVersion: 99,
      recoverable: false, migrated: false, document: null, rawJson: raw,
    })
    await expect(repository.listQuarantines('/project')).resolves.toMatchObject({
      ok: true, quarantines: [{ quarantineId: id, schemaVersion: 99, recoverable: false, bytes: new TextEncoder().encode(raw).byteLength }],
    })
    await expect(repository.restoreQuarantine('/project', id)).resolves.toMatchObject({ ok: false, certainty: 'unchanged' })
    expect(memory.data.has(path)).toBe(true)
    expect(memory.data.has('/project/.modstudio/ai/conversation.json')).toBe(false)
  })

  it('quarantine restore 在 active 存在时拒绝覆盖', async () => {
    const id = 'conversation.json.quarantine-42-valid'
    const quarantinePath = '/project/.modstudio/ai/' + id
    const activePath = '/project/.modstudio/ai/conversation.json'
    const active = createConversationDocument('2026-09-02T00:00:00Z')
    const quarantined = createConversationDocument('2026-09-01T00:00:00Z')
    const memory = memoryFiles({ [quarantinePath]: JSON.stringify(quarantined), [activePath]: JSON.stringify(active) })

    await expect(createConversationRepository(memory.files).restoreQuarantine('/project', id)).resolves.toMatchObject({
      ok: false, certainty: 'unchanged', error: '活动对话已存在，拒绝覆盖',
    })
    expect(JSON.parse(memory.data.get(activePath)!)).toEqual(active)
    expect(JSON.parse(memory.data.get(quarantinePath)!)).toEqual(quarantined)
  })

  it('quarantine API 拒绝路径穿越与不匹配的 basename', async () => {
    const repository = createConversationRepository(memoryFiles().files)
    await expect(repository.readQuarantine('/project', '../conversation.json.quarantine-1-x')).resolves.toMatchObject({ ok: false })
    await expect(repository.readQuarantine('/project', 'conversation.json.quarantine-x-id')).resolves.toMatchObject({ ok: false })
    await expect(repository.restoreQuarantine('/project', 'conversation.json.quarantine-1-../../active')).resolves.toMatchObject({ ok: false, certainty: 'unchanged' })
  })

  it('隔离恢复期间若另一实例原子创建 active，不覆盖并发文档', async () => {
    const id = 'conversation.json.quarantine-42-old'
    const quarantinePath = '/project/.modstudio/ai/' + id
    const activePath = '/project/.modstudio/ai/conversation.json'
    const quarantineDocument = createConversationDocument('2026-09-01T00:00:00Z')
    const concurrentDocument = createConversationDocument('2026-09-02T00:00:00Z')
    const memory = memoryFiles({ [quarantinePath]: JSON.stringify(quarantineDocument) })
    const files: ConversationFilePort = {
      ...memory.files,
      linkNoReplace: async (from, to) => {
        if (to === activePath) memory.data.set(activePath, JSON.stringify(concurrentDocument))
        return memory.files.linkNoReplace(from, to)
      },
    }
    const quarantinedRaw = memory.data.get(quarantinePath)

    await expect(createConversationRepository(files).restoreQuarantine('/project', id)).resolves.toMatchObject({
      ok: false, certainty: 'unchanged', error: '活动对话已存在，拒绝覆盖',
    })
    expect(JSON.parse(memory.data.get(activePath)!)).toEqual(concurrentDocument)
    expect(memory.data.get(quarantinePath)).toBe(quarantinedRaw)
  })

  it('原子写入失败时恢复不改 active 且保留 quarantine', async () => {
    const id = 'conversation.json.quarantine-42-valid'
    const quarantinePath = '/project/.modstudio/ai/' + id
    const original = createConversationDocument('2026-09-01T00:00:00Z')
    const raw = JSON.stringify(original)
    const memory = memoryFiles({ [quarantinePath]: raw })
    const files: ConversationFilePort = {
      ...memory.files,
      writeFile: async (path, content) => path.includes('/conversation.json.tmp-') ? false : memory.files.writeFile(path, content),
    }

    await expect(createConversationRepository(files).restoreQuarantine('/project', id)).resolves.toMatchObject({ ok: false, certainty: 'unchanged' })
    expect(memory.data.has('/project/.modstudio/ai/conversation.json')).toBe(false)
    expect(memory.data.get(quarantinePath)).toBe(raw)
  })

  it('真实目录可读取并恢复 quarantine，且源文件保留', async () => {
    const root = await mkdtemp(join(tmpdir(), 'modstudio-conversation-quarantine-'))
    const aiDirectory = join(root, '.modstudio/ai')
    const id = 'conversation.json.quarantine-42-valid'
    const quarantinePath = join(aiDirectory, id)
    const original = createConversationDocument('2026-09-01T00:00:00Z')
    const raw = JSON.stringify(original, null, 2)
    try {
      await mkdir(aiDirectory, { recursive: true })
      await writeFile(quarantinePath, raw, 'utf8')
      const repository = createConversationRepository(realFiles())
      await expect(repository.listQuarantines(root)).resolves.toMatchObject({ ok: true, quarantines: [{ quarantineId: id, recoverable: true }] })
      await expect(repository.restoreQuarantine(root, id)).resolves.toMatchObject({ ok: true, document: original, migrated: false })
      expect(await readFile(quarantinePath, 'utf8')).toBe(raw)
      expect(JSON.parse(await readFile(join(aiDirectory, 'conversation.json'), 'utf8'))).toEqual(original)
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

function isExists(error: unknown): boolean {
  return Boolean(error && typeof error === 'object' && 'code' in error && (error as { code?: string }).code === 'EEXIST')
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
