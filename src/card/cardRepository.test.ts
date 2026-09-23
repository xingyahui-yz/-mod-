import { describe, expect, it } from 'vitest'
import { createEmptyGraph } from '../node-editor/graph'
import type { CardDocument } from './cardDocument'
import { createCardDocumentRepository, type CardDocumentFilePort } from './cardRepository'

function makeDocument(id = 'Fireball'): CardDocument {
  return {
    schemaVersion: 2,
    card: {
      id,
      name: id,
      cost: 1,
      type: 'Attack',
      rarity: 'Common',
      description: '',
      keywords: [],
    },
    graph: createEmptyGraph(id, 'card'),
    generation: { lastGeneratedFingerprint: null },
  }
}

class MemoryFiles implements CardDocumentFilePort {
  files = new Map<string, string>()
  directories = new Set<string>()
  renameCalls: Array<{ from: string; to: string }> = []
  failRename = false
  failWrite = false
  linkResult: 'linked' | 'exists' | 'failed' = 'linked'
  beforeLink: ((from: string, to: string) => void) | null = null
  beforeRename: ((from: string, to: string) => void) | null = null
  failRemove: ((path: string) => boolean) | null = null
  failRenameWhen: ((from: string, to: string) => boolean) | null = null

  async readDirectory(path: string) {
    const prefix = `${path}/`
    const names = new Set<string>()
    for (const file of this.files.keys()) {
      if (file.startsWith(prefix)) {
        const rest = file.slice(prefix.length)
        if (!rest.includes('/')) names.add(rest)
      }
    }
    return [...names].map(name => ({ name, isDirectory: false, path: `${path}/${name}` }))
  }

  async readFile(path: string) {
    return this.files.get(path) ?? null
  }

  readFileResult: NonNullable<CardDocumentFilePort['readFileResult']> = async path => {
    const value = this.files.get(path)
    return value === undefined
      ? { status: 'missing' as const }
      : { status: 'found' as const, value }
  }

  async mkdir(path: string) {
    this.directories.add(path)
    return true
  }

  async writeFile(path: string, content: string) {
    if (this.failWrite) return false
    this.files.set(path, content)
    return true
  }

  async rename(from: string, to: string) {
    this.beforeRename?.(from, to)
    if (this.failRename || this.failRenameWhen?.(from, to)) return false
    const content = this.files.get(from)
    if (content === undefined) return false
    this.files.delete(from)
    this.files.set(to, content)
    this.renameCalls.push({ from, to })
    return true
  }

  async linkNoReplace(from: string, to: string) {
    this.beforeLink?.(from, to)
    if (this.linkResult !== 'linked') return { status: this.linkResult } as const
    if (this.files.has(to)) return { status: 'exists' } as const
    const content = this.files.get(from)
    if (content === undefined) return { status: 'failed' } as const
    this.files.set(to, content)
    return { status: 'linked' } as const
  }

  async remove(path: string) {
    if (this.failRemove?.(path)) return false
    this.files.delete(path)
    return true
  }
}

describe('CardDocumentRepository', () => {
  it('只扫描 .modstudio/cards 下的 JSON，并隔离单 Card 损坏', async () => {
    const files = new MemoryFiles()
    const project = '/project'
    const cards = `${project}/.modstudio/cards`
    files.files.set(`${cards}/Fireball.json`, JSON.stringify(makeDocument()))
    files.files.set(`${cards}/Broken.json`, '{broken')
    files.files.set(`${project}/scripts/Cards/Legacy.cs`, 'class Legacy {}')

    const result = await createCardDocumentRepository({ files }).load(project)
    expect(result).toHaveLength(2)
    expect(result.find(item => item.fileName === 'Fireball.json')?.result.status).toBe('editable')
    expect(result.find(item => item.fileName === 'Broken.json')?.result.status).toBe('invalid')
  })

  it('保存成功后活动 Card 是完整新文档且不遗留可恢复临时文件', async () => {
    const files = new MemoryFiles()
    const repository = createCardDocumentRepository({ files })
    files.files.set('/project/.modstudio/cards/IceBolt.json', JSON.stringify(makeDocument('IceBolt')))
    const result = await repository.save('/project', makeDocument('IceBolt'))

    expect(result).toEqual({ ok: true, path: '/project/.modstudio/cards/IceBolt.json' })
    expect(JSON.parse(files.files.get('/project/.modstudio/cards/IceBolt.json')!).card.id).toBe('IceBolt')
    expect([...files.files.keys()].some(path => path.includes('.tmp-'))).toBe(false)
    expect([...files.files.keys()].some(path => path.includes('.save-staging-'))).toBe(false)
  })

  it('保存不存在的 Card 不会退化成 create 或覆盖随后出现的文件', async () => {
    const files = new MemoryFiles()
    const repository = createCardDocumentRepository({ files })

    await expect(repository.save('/project', makeDocument('Fireball'))).resolves.toEqual({
      ok: false,
      error: 'CardDocument 不存在，不能覆盖保存',
    })
    const created = await repository.create('/project', makeDocument('Fireball'))
    expect(created.ok).toBe(true)
    expect(JSON.parse(files.files.get('/project/.modstudio/cards/Fireball.json')!).card.name).toBe('Fireball')
  })

  it('保存取得 claim 前目标被外部替换时拒绝覆盖', async () => {
    const files = new MemoryFiles()
    const target = '/project/.modstudio/cards/Fireball.json'
    files.files.set(target, JSON.stringify(makeDocument('Fireball')))
    const external = makeDocument('Fireball')
    external.card.name = '外部版本'
    files.beforeLink = (_from, to) => {
      if (to.endsWith('/.id-claims/fireball.claim')) {
        files.files.set(target, JSON.stringify(external))
      }
    }

    const local = makeDocument('Fireball')
    local.card.name = '本地版本'
    const result = await createCardDocumentRepository({ files }).save('/project', local)

    expect(result).toEqual({ ok: false, error: 'CardDocument 保存期间被外部修改，未覆盖' })
    expect(JSON.parse(files.files.get(target)!).card.name).toBe('外部版本')
  })

  it('最后一次校验后目标被外部替换时仍不覆盖', async () => {
    const files = new MemoryFiles()
    const target = '/project/.modstudio/cards/Fireball.json'
    files.files.set(target, JSON.stringify(makeDocument('Fireball')))
    const external = makeDocument('Fireball')
    external.card.name = '最后时刻的外部版本'
    let replaced = false
    files.beforeRename = () => {
      if (replaced) return
      replaced = true
      files.files.set(target, JSON.stringify(external))
    }

    const local = makeDocument('Fireball')
    local.card.name = '本地版本'
    const result = await createCardDocumentRepository({ files }).save('/project', local)

    expect(result).toMatchObject({ ok: false })
    expect(JSON.parse(files.files.get(target)!).card.name).toBe('最后时刻的外部版本')
  })

  it('文件权限错误会使整次加载失败，不伪装成损坏 Card', async () => {
    const files = new MemoryFiles()
    const target = '/project/.modstudio/cards/Fireball.json'
    files.files.set(target, JSON.stringify(makeDocument('Fireball')))
    files.readFileResult = async () => ({ status: 'error' as const, error: 'EACCES' })

    await expect(createCardDocumentRepository({ files }).load('/project')).rejects.toThrow('EACCES')
  })

  it('重启加载会恢复被中断的 save staging，不丢失旧 CardDocument', async () => {
    const files = new MemoryFiles()
    const cards = '/project/.modstudio/cards'
    const target = `${cards}/Fireball.json`
    const staging = `${target}.save-staging-Fireball-crash`
    files.files.set(staging, JSON.stringify(makeDocument('Fireball')))

    const loaded = await createCardDocumentRepository({ files }).load('/project')

    expect(loaded).toHaveLength(1)
    expect(loaded[0].result.status).toBe('editable')
    expect(files.files.get(target)).toBeDefined()
    expect(files.files.has(staging)).toBe(false)
  })

  it("外部竞争目标不能让重启恢复误删原 Card save staging", async () => {
    const files = new MemoryFiles()
    const target = "/project/.modstudio/cards/Fireball.json"
    const original = makeDocument("Fireball")
    const external = makeDocument("Fireball")
    external.card.name = "外部竞争版本"
    files.files.set(target, JSON.stringify(original))
    files.beforeLink = (_from, to) => {
      if (to === target) files.files.set(target, JSON.stringify(external))
    }
    const local = makeDocument("Fireball")
    local.card.name = "本地候选版本"

    const saved = await createCardDocumentRepository({ files }).save("/project", local)
    expect(saved).toMatchObject({ ok: false, certainty: "uncertain" })
    const staging = [...files.files.keys()].find(path => path.includes(".save-staging-"))
    expect(staging).toBeDefined()
    expect(files.files.get(staging!)).toBe(JSON.stringify(original))
    expect([...files.files.keys()].some(path => path.includes(".tmp-"))).toBe(true)

    await expect(createCardDocumentRepository({ files }).load("/project"))
      .rejects.toThrow("活动 CardDocument 与待发布版本不一致")
    expect(files.files.get(target)).toBe(JSON.stringify(external))
    expect(files.files.get(staging!)).toBe(JSON.stringify(original))
  })

  it('活动 Card 无法验证时不会把 save staging 误判为已发布残留', async () => {
    const files = new MemoryFiles()
    const cards = '/project/.modstudio/cards'
    const target = `${cards}/Fireball.json`
    const staging = `${target}.save-staging-Fireball-crash`
    files.files.set(target, '{broken')
    files.files.set(staging, JSON.stringify(makeDocument('Fireball')))

    await expect(createCardDocumentRepository({ files }).load('/project'))
      .rejects.toThrow('活动 CardDocument 无法证明已发布')
    expect(files.files.has(staging)).toBe(true)
  })

  it('发布后清理旧版本失败也不会在活动 Card 删除后复活', async () => {
    const files = new MemoryFiles()
    const target = '/project/.modstudio/cards/Fireball.json'
    files.files.set(target, JSON.stringify(makeDocument('Fireball')))
    files.failRemove = path => path.includes('.save-published-')

    const next = makeDocument('Fireball')
    next.card.name = '已发布版本'
    const repository = createCardDocumentRepository({ files })
    await expect(repository.save('/project', next)).resolves.toEqual({ ok: true, path: target })

    expect([...files.files.keys()].some(path => path.includes('.save-published-'))).toBe(true)
    files.files.delete(target)

    await expect(repository.load('/project')).resolves.toEqual([])
    expect(files.files.has(target)).toBe(false)
  })

  it('启动加载会回收 prior-session owner claim', async () => {
    const files = new MemoryFiles()
    const claimsRoot = '/project/.modstudio/cards/.id-claims'
    const claim = `${claimsRoot}/fireball.claim`
    files.files.set(claim, JSON.stringify({
      kind: 'mod-studio-card-id-claim',
      version: 1,
      normalizedCardId: 'fireball',
      sessionId: 'previous-session',
      operationId: 'interrupted-create',
    }))

    await expect(createCardDocumentRepository({
      files,
      claimSessionId: 'current-session',
    }).load('/project')).resolves.toEqual([])
    expect(files.files.has(claim)).toBe(false)
  })

  it('create 的 owner claim release 失败会传播 uncertain 而不静默报告成功', async () => {
    const files = new MemoryFiles()
    files.failRenameWhen = from => from.endsWith('/.id-claims/fireball.claim')
    const repository = createCardDocumentRepository({
      files,
      claimSessionId: 'current-session',
      claimOperationId: () => 'create-release-failure',
    })

    const result = await repository.create('/project', makeDocument('Fireball'))

    expect(result).toMatchObject({ ok: false, certainty: 'uncertain' })
    expect(files.files.has('/project/.modstudio/cards/Fireball.json')).toBe(true)
  })

  it('rename 失败时不报告成功，并保留原活动文件', async () => {
    const files = new MemoryFiles()
    const target = '/project/.modstudio/cards/Fireball.json'
    const original = JSON.stringify(makeDocument('Fireball'))
    files.files.set(target, original)
    files.failRename = true

    const result = await createCardDocumentRepository({ files }).save('/project', makeDocument('Fireball'))
    expect(result.ok).toBe(false)
    expect(files.files.get(target)).toBe(original)
    expect([...files.files.keys()].some(path => path.includes('.tmp-'))).toBe(false)
  })

  it('创建用 fail-if-exists 原子占用 ID，竞争者出现时不覆盖文件', async () => {
    const files = new MemoryFiles()
    const target = '/project/.modstudio/cards/Fireball.json'
    const competing = JSON.stringify(makeDocument('Fireball'))
    files.beforeLink = (_from, to) => {
      if (to === target) files.files.set(to, competing)
    }

    const result = await createCardDocumentRepository({ files }).create('/project', makeDocument('Fireball'))

    expect(result).toEqual({ ok: false, error: 'Card ID 已被占用（大小写不敏感）' })
    expect(files.files.get(target)).toBe(competing)
    expect([...files.files.keys()].some(path => path.includes('.tmp-'))).toBe(false)
  })

  it('创建在落临时文件前拒绝大小写不同的同 ID 文档', async () => {
    const files = new MemoryFiles()
    const occupied = '/project/.modstudio/cards/fireball.json'
    files.files.set(occupied, JSON.stringify(makeDocument('Fireball')))

    const result = await createCardDocumentRepository({ files }).create('/project', makeDocument('Fireball'))

    expect(result).toEqual({ ok: false, error: 'Card ID 已被占用（大小写不敏感）' })
    expect(files.files.get(occupied)).toBeDefined()
    expect([...files.files.keys()].some(path => path.includes('.tmp-'))).toBe(false)
  })

  it('已知旧 schema 写回前先备份原文，再原子保存迁移结果', async () => {
    const files = new MemoryFiles()
    const target = '/project/.modstudio/cards/Fireball.json'
    const legacy = { ...makeDocument(), schemaVersion: 1 }
    delete (legacy as Partial<CardDocument>).generation
    const original = JSON.stringify(legacy)
    files.files.set(target, original)

    const result = await createCardDocumentRepository({ files }).migrateAndSave('/project', 'Fireball.json')
    expect(result.status).toBe('migrated')
    expect(files.files.get(`${target}.v1.bak`)).toBe(original)
    expect(JSON.parse(files.files.get(target)!).schemaVersion).toBe(2)
  })

  it('备份失败时不写回原 CardDocument', async () => {
    const files = new MemoryFiles()
    const target = '/project/.modstudio/cards/Fireball.json'
    const original = JSON.stringify({ ...makeDocument(), schemaVersion: 1 })
    files.files.set(target, original)
    files.failWrite = true

    const result = await createCardDocumentRepository({ files }).migrateAndSave('/project', 'Fireball.json')
    expect(result.status).toBe('failed')
    expect(files.files.get(target)).toBe(original)
  })
})
