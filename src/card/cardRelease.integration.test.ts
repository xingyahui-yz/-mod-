import { mkdtemp, readFile, readdir, rename, rm, mkdir, writeFile, link } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { tmpdir } from 'node:os'
import { afterEach, describe, expect, it } from 'vitest'
import { appendNode, connect, createEmptyGraph } from '../node-editor/graph'
import { serializeCardDocument, type CardDocument } from './cardDocument'
import { createCardDocumentRepository } from './cardRepository'
import { generateCardArtifact } from './cardGeneration'
import { createCardTrashRepository } from './cardTrash'
import { buildPreflightEntries, evaluateCardPreflight } from './cardPreflight'

const projects: string[] = []

function realFiles() {
  return {
    async readDirectory(path: string) {
      const entries = await readdir(path, { withFileTypes: true })
      return entries.map(entry => ({ name: entry.name, isDirectory: entry.isDirectory(), path: join(path, entry.name) }))
    },
    async readFile(path: string) {
      try { return await readFile(path, 'utf8') } catch { return null }
    },
    async mkdir(path: string) { try { await mkdir(path, { recursive: true }); return true } catch { return false } },
    async writeFile(path: string, content: string) {
      try { await mkdir(dirname(path), { recursive: true }); await writeFile(path, content, 'utf8'); return true } catch { return false }
    },
    async rename(from: string, to: string) { try { await mkdir(dirname(to), { recursive: true }); await rename(from, to); return true } catch { return false } },
    async linkNoReplace(from: string, to: string) {
      try {
        await mkdir(dirname(to), { recursive: true })
        await link(from, to)
        return { status: 'linked' as const }
      } catch (error) {
        return error && typeof error === 'object' && 'code' in error && error.code === 'EEXIST'
          ? { status: 'exists' as const }
          : { status: 'failed' as const }
      }
    },
    async remove(path: string) { try { await rm(path, { recursive: true, force: true }); return true } catch { return false } },
  }
}

function makeDocument(id = 'ReleaseCard'): CardDocument {
  let graph = createEmptyGraph(id, 'card')
  const trigger = appendNode(graph, 'trigger', { x: 0, y: 0 }, { event: 'onPlay' })
  graph = trigger.graph
  const effect = appendNode(graph, 'effect', { x: 100, y: 0 }, { kind: 'exhaustSelf' })
  const linked = connect(effect.graph, { nodeId: trigger.node.id, port: 'out' }, { nodeId: effect.node.id, port: 'in' })
  if (!linked.ok) throw new Error(linked.reason)
  return {
    schemaVersion: 2,
    card: { id, name: id, cost: 1, type: 'Attack', rarity: 'Common', description: 'Exhaust.', keywords: [] },
    graph: linked.graph,
    generation: { lastGeneratedFingerprint: null },
  }
}

describe('v0.9 real filesystem release flow', () => {
  afterEach(async () => {
    await Promise.all(projects.splice(0).map(path => rm(path, { recursive: true, force: true })))
  })

  it('save → reload → generate → external-modification preflight → trash delete/restore', async () => {
    const project = await mkdtemp(join(tmpdir(), 'mod-studio-v09-'))
    projects.push(project)
    const files = realFiles()
    const repository = createCardDocumentRepository({ files })
    const document = makeDocument()

    expect((await repository.create(project, document)).ok).toBe(true)
    const loaded = await repository.load(project)
    expect(loaded[0]?.result.status).toBe('editable')
    const generated = await generateCardArtifact(project, document, {
      files,
      saveDocument: async next => (await repository.save(project, next)).ok,
    })
    expect(generated.status).toBe('generated')

    const artifactPath = join(project, 'scripts/Cards/ReleaseCard.cs')
    await writeFile(artifactPath, 'external edit', 'utf8')
    const afterExternal = await repository.load(project)
    const artifacts = new Map([['ReleaseCard', await files.readFile(artifactPath)]])
    const entries = buildPreflightEntries(afterExternal, artifacts)
    const preflight = evaluateCardPreflight(entries)
    expect(preflight.ok).toBe(false)
    expect(preflight.blocking[0]?.status).toBe('externally-modified')

    const trash = createCardTrashRepository({ files, idSuffix: () => 'release' })
    expect((await trash.delete(project, 'ReleaseCard')).status).toBe('deleted')
    expect(await files.readFile(artifactPath)).toBeNull()
    expect((await trash.restore(project, 'ReleaseCard-release')).status).toBe('restored')
    expect(await files.readFile(artifactPath)).toBe('external edit')
  })

  it('真实文件系统并发创建同一 ID 时只有一个原子占用且不会互相覆盖', async () => {
    const project = await mkdtemp(join(tmpdir(), 'mod-studio-card-claim-'))
    projects.push(project)
    const repository = createCardDocumentRepository({ files: realFiles() })
    const first = makeDocument()
    const second = { ...first, card: { ...first.card, description: '竞争版本' } }

    const results = await Promise.all([
      repository.create(project, first),
      repository.create(project, second),
    ])

    expect(results.filter(result => result.ok)).toHaveLength(1)
    expect(results.filter(result => !result.ok)).toEqual([
      { ok: false, error: 'Card ID 已被占用（大小写不敏感）' },
    ])
    const loaded = await repository.load(project)
    expect(loaded).toHaveLength(1)
    expect(loaded[0]?.result.status).toBe('editable')
  })

  it('真实文件系统并发创建大小写不同的逻辑同 ID 时也只有一个原子占用', async () => {
    const project = await mkdtemp(join(tmpdir(), 'mod-studio-card-case-claim-'))
    projects.push(project)
    const repository = createCardDocumentRepository({ files: realFiles() })

    const results = await Promise.all([
      repository.create(project, makeDocument('FireBall')),
      repository.create(project, makeDocument('Fireball')),
    ])

    expect(results.filter(result => result.ok)).toHaveLength(1)
    expect(results.filter(result => !result.ok)).toEqual([
      { ok: false, error: 'Card ID 已被占用（大小写不敏感）' },
    ])
    const loaded = await repository.load(project)
    expect(loaded).toHaveLength(1)
    expect(loaded[0]?.result.status).toBe('editable')
  })

  it('真实文件系统重启会恢复 save 中断后的 staging CardDocument', async () => {
    const project = await mkdtemp(join(tmpdir(), 'mod-studio-card-save-recovery-'))
    projects.push(project)
    const cardsRoot = join(project, '.modstudio/cards')
    const target = join(cardsRoot, 'ReleaseCard.json')
    const staging = `${target}.save-staging-ReleaseCard-crash`
    await mkdir(cardsRoot, { recursive: true })
    await writeFile(staging, serializeCardDocument(makeDocument()), 'utf8')

    const loaded = await createCardDocumentRepository({ files: realFiles() }).load(project)

    expect(loaded).toHaveLength(1)
    expect(loaded[0]?.result.status).toBe('editable')
    expect(await readFile(target, 'utf8')).toContain('"id": "ReleaseCard"')
    await expect(readFile(staging, 'utf8')).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('真实文件系统在 publish 后崩溃会先封存 staging，之后删除活动 Card 也不会复活旧版本', async () => {
    const project = await mkdtemp(join(tmpdir(), 'mod-studio-card-post-publish-crash-'))
    projects.push(project)
    const cardsRoot = join(project, '.modstudio/cards')
    const target = join(cardsRoot, 'ReleaseCard.json')
    const staging = `${target}.save-staging-ReleaseCard-crash`
    const previous = makeDocument()
    previous.card.name = '旧版本'
    const published = makeDocument()
    published.card.name = '已发布版本'
    await mkdir(cardsRoot, { recursive: true })
    await writeFile(staging, serializeCardDocument(previous), 'utf8')
    await writeFile(target, serializeCardDocument(published), 'utf8')
    const repository = createCardDocumentRepository({ files: realFiles() })

    const firstLoad = await repository.load(project)
    expect(firstLoad).toHaveLength(1)
    expect(firstLoad[0]?.result.status === 'editable' && firstLoad[0].result.document.card.name)
      .toBe('已发布版本')
    await expect(readFile(staging, 'utf8')).rejects.toMatchObject({ code: 'ENOENT' })

    await rm(target)
    await expect(repository.load(project)).resolves.toEqual([])
    await expect(readFile(target, 'utf8')).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('真实文件系统启动会回收 prior-session owner claim 并允许重新创建', async () => {
    const project = await mkdtemp(join(tmpdir(), 'mod-studio-card-stale-claim-'))
    projects.push(project)
    const cardsRoot = join(project, '.modstudio/cards')
    const claimsRoot = join(cardsRoot, '.id-claims')
    await mkdir(claimsRoot, { recursive: true })
    await writeFile(join(claimsRoot, 'releasecard.claim'), JSON.stringify({
      kind: 'mod-studio-card-id-claim',
      version: 1,
      normalizedCardId: 'releasecard',
      sessionId: 'previous-session',
      operationId: 'crashed-create',
    }), 'utf8')
    const repository = createCardDocumentRepository({
      files: realFiles(),
      claimSessionId: 'current-session',
      claimOperationId: () => 'recovered-create',
    })

    await expect(repository.load(project)).resolves.toEqual([])
    await expect(repository.create(project, makeDocument())).resolves.toMatchObject({ ok: true })
    await expect(readFile(join(cardsRoot, 'ReleaseCard.json'), 'utf8')).resolves.toContain('"id": "ReleaseCard"')
  })

  it('真实文件系统发布后的旧版本残留不会在活动 Card 删除后复活', async () => {
    const project = await mkdtemp(join(tmpdir(), 'mod-studio-card-published-residue-'))
    projects.push(project)
    const cardsRoot = join(project, '.modstudio/cards')
    const target = join(cardsRoot, 'ReleaseCard.json')
    const published = `${target}.save-published-ReleaseCard-interrupted-cleanup`
    await mkdir(cardsRoot, { recursive: true })
    await writeFile(published, serializeCardDocument(makeDocument()), 'utf8')

    const loaded = await createCardDocumentRepository({ files: realFiles() }).load(project)

    expect(loaded).toEqual([])
    await expect(readFile(target, 'utf8')).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('真实文件系统并发恢复大小写不同的逻辑同 ID 时也只有一个成功', async () => {
    const project = await mkdtemp(join(tmpdir(), 'mod-studio-trash-case-claim-'))
    projects.push(project)
    const trashRoot = join(project, '.modstudio/trash/cards')
    await mkdir(join(trashRoot, 'FireBall-a'), { recursive: true })
    await mkdir(join(trashRoot, 'Fireball-b'), { recursive: true })
    await writeFile(join(trashRoot, 'FireBall-a/card.json'), JSON.stringify(makeDocument('FireBall')), 'utf8')
    await writeFile(join(trashRoot, 'Fireball-b/card.json'), JSON.stringify(makeDocument('Fireball')), 'utf8')
    const trash = createCardTrashRepository({ files: realFiles() })

    const results = await Promise.all([
      trash.restore(project, 'FireBall-a'),
      trash.restore(project, 'Fireball-b'),
    ])

    expect(results.filter(result => result.status === 'restored')).toHaveLength(1)
    expect(results.filter(result => result.status === 'conflict')).toHaveLength(1)
    const loaded = await createCardDocumentRepository({ files: realFiles() }).load(project)
    expect(loaded).toHaveLength(1)
    expect(loaded[0]?.result.status).toBe('editable')
  })
})
