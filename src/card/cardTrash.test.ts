import { describe, expect, it } from 'vitest'
import { createCardTrashRepository, type CardTrashFileEntry, type CardTrashFilePort } from './cardTrash'

class MemoryFiles implements CardTrashFilePort {
  files = new Map<string, string>()
  directories = new Set<string>()
  failRenameTo: string | null = null
  failRemoveFor = new Set<string>()
  beforeLink: ((from: string, to: string) => void) | null = null
  readDirectoryResult?: CardTrashFilePort['readDirectoryResult']
  readFileResult?: CardTrashFilePort['readFileResult']

  async readDirectory(path: string): Promise<CardTrashFileEntry[]> {
    if (!this.directories.has(path) && ![...this.files.keys()].some(file => file.startsWith(`${path}/`))) {
      throw new Error('ENOENT')
    }
    const prefix = `${path}/`
    const children = new Map<string, CardTrashFileEntry>()
    for (const file of this.files.keys()) {
      if (!file.startsWith(prefix)) continue
      const rest = file.slice(prefix.length)
      const [name] = rest.split('/')
      const childPath = `${path}/${name}`
      children.set(name, { name, isDirectory: rest.includes('/'), path: childPath })
    }
    return [...children.values()]
  }
  async readFile(path: string) { return this.files.get(path) ?? null }
  async mkdir(path: string) { this.directories.add(path); return true }
  async rename(from: string, to: string) {
    if (this.failRenameTo === to) return false
    const content = this.files.get(from)
    if (content === undefined) return false
    this.files.delete(from)
    this.files.set(to, content)
    return true
  }
  async linkNoReplace(from: string, to: string) {
    this.beforeLink?.(from, to)
    if (this.failRenameTo === to) return { status: 'failed' } as const
    if (this.files.has(to)) return { status: 'exists' } as const
    const content = this.files.get(from)
    if (content === undefined) return { status: 'failed' } as const
    this.files.set(to, content)
    return { status: 'linked' } as const
  }
  async remove(path: string) {
    if (this.failRemoveFor.has(path)) return false
    this.files.delete(path)
    this.directories.delete(path)
    return true
  }
}

const project = '/project'
const document = JSON.stringify({
  schemaVersion: 2,
  card: { id: 'Fireball', name: 'Fireball', cost: 1, type: 'Attack', rarity: 'Common', description: '', keywords: [] },
  graph: { entityType: 'card', entityId: 'Fireball', nodes: [], edges: [] },
  generation: { lastGeneratedFingerprint: null },
})

describe('Card trash repository', () => {
  it('将 CardDocument 与现有 C# 一起移入回收站', async () => {
    const files = new MemoryFiles()
    files.files.set(`${project}/.modstudio/cards/Fireball.json`, document)
    files.files.set(`${project}/scripts/Cards/Fireball.cs`, 'generated')
    const repo = createCardTrashRepository({ files, idSuffix: () => '1' })
    const result = await repo.delete(project, 'Fireball')
    expect(result).toMatchObject({ status: 'deleted', trashId: 'Fireball-1' })
    expect(files.files.has(`${project}/.modstudio/cards/Fireball.json`)).toBe(false)
    expect(files.files.has(`${project}/scripts/Cards/Fireball.cs`)).toBe(false)
    expect(files.files.get(`${project}/.modstudio/trash/cards/Fireball-1/card.json`)).toBe(document)
    expect(files.files.get(`${project}/.modstudio/trash/cards/Fireball-1/artifact.cs`)).toBe('generated')
  })

  it('暂存失败时补偿恢复 Card，活动文件保持完整', async () => {
    const files = new MemoryFiles()
    const docPath = `${project}/.modstudio/cards/Fireball.json`
    const artifactPath = `${project}/scripts/Cards/Fireball.cs`
    files.files.set(docPath, document)
    files.files.set(artifactPath, 'generated')
    files.failRenameTo = `${project}/.modstudio/trash/cards/Fireball-1/artifact.cs`
    const result = await createCardTrashRepository({ files, idSuffix: () => '1' }).delete(project, 'Fireball')
    expect(result.status).toBe('failed')
    expect(files.files.get(docPath)).toBe(document)
    expect(files.files.get(artifactPath)).toBe('generated')
  })

  it('CardDocument 暂存失败时补偿恢复已停用的 C#', async () => {
    const files = new MemoryFiles()
    const docPath = `${project}/.modstudio/cards/Fireball.json`
    const artifactPath = `${project}/scripts/Cards/Fireball.cs`
    const trashPath = `${project}/.modstudio/trash/cards/Fireball-1`
    files.files.set(docPath, document)
    files.files.set(artifactPath, 'generated')
    files.failRenameTo = `${trashPath}/active-document.staging`

    const result = await createCardTrashRepository({ files, idSuffix: () => '1' }).delete(project, 'Fireball')

    expect(result.status).toBe('failed')
    expect(files.files.get(docPath)).toBe(document)
    expect(files.files.get(artifactPath)).toBe('generated')
    expect(files.files.get(`${trashPath}/card.json`)).toBe(document)
    expect(files.files.get(`${trashPath}/artifact.cs`)).toBe('generated')
  })

  it('补偿恢复遇到竞争文件时关闭删除并保留 staging', async () => {
    const files = new MemoryFiles()
    const docPath = `${project}/.modstudio/cards/Fireball.json`
    const artifactPath = `${project}/scripts/Cards/Fireball.cs`
    const trashPath = `${project}/.modstudio/trash/cards/Fireball-1`
    const stagingDocument = `${trashPath}/active-document.staging`
    const stagingArtifact = `${trashPath}/active-artifact.staging`
    files.files.set(docPath, document)
    files.files.set(artifactPath, 'generated')
    const rename = files.rename.bind(files)
    files.rename = async (from, to) => {
      if (to === stagingDocument) {
        files.files.set(artifactPath, 'external replacement')
        return false
      }
      return rename(from, to)
    }

    const result = await createCardTrashRepository({ files, idSuffix: () => '1' }).delete(project, 'Fireball')

    expect(result.status).toBe('failed')
    expect(files.files.get(docPath)).toBe(document)
    expect(files.files.get(artifactPath)).toBe('external replacement')
    expect(files.files.get(stagingArtifact)).toBe('generated')
    expect(files.files.get(`${trashPath}/card.json`)).toBe(document)
    expect(files.files.get(`${trashPath}/artifact.cs`)).toBe('generated')
  })

  it('两个活动文件都安全停用后，staging 清理失败不会把删除降级为半删除', async () => {
    const files = new MemoryFiles()
    const docPath = `${project}/.modstudio/cards/Fireball.json`
    const artifactPath = `${project}/scripts/Cards/Fireball.cs`
    const trashPath = `${project}/.modstudio/trash/cards/Fireball-1`
    const stagingDocument = `${trashPath}/active-document.staging`
    const stagingArtifact = `${trashPath}/active-artifact.staging`
    files.files.set(docPath, document)
    files.files.set(artifactPath, 'generated')
    files.failRemoveFor.add(stagingDocument)
    files.failRemoveFor.add(stagingArtifact)

    const result = await createCardTrashRepository({ files, idSuffix: () => '1' }).delete(project, 'Fireball')

    expect(result).toMatchObject({ status: 'deleted', trashId: 'Fireball-1' })
    expect(files.files.has(docPath)).toBe(false)
    expect(files.files.has(artifactPath)).toBe(false)
    expect(files.files.get(`${trashPath}/card.json`)).toBe(document)
    expect(files.files.get(`${trashPath}/artifact.cs`)).toBe('generated')
    expect(files.files.get(stagingDocument)).toBe(document)
    expect(files.files.get(stagingArtifact)).toBe('generated')
  })

  it('恢复前按忽略大小写检查 ID 冲突，并支持无 C# Card 恢复', async () => {
    const files = new MemoryFiles()
    files.files.set(`${project}/.modstudio/trash/cards/Fireball-1/card.json`, document)
    files.directories.add(`${project}/.modstudio/trash/cards`)
    files.directories.add(`${project}/.modstudio/trash/cards/Fireball-1`)
    files.files.set(`${project}/.modstudio/cards/fireball.json`, document)
    const conflict = await createCardTrashRepository({ files }).restore(project, 'Fireball-1')
    expect(conflict.status).toBe('conflict')

    files.files.delete(`${project}/.modstudio/cards/fireball.json`)
    const restored = await createCardTrashRepository({ files }).restore(project, 'Fireball-1')
    expect(restored).toEqual({ status: 'restored', cardId: 'Fireball' })
    expect(files.files.get(`${project}/.modstudio/cards/Fireball.json`)).toBe(document)
  })

  it('恢复产物失败时保留已恢复 CardDocument 与回收站副本，不按路径回删', async () => {
    const files = new MemoryFiles()
    files.files.set(`${project}/.modstudio/trash/cards/Fireball-1/card.json`, document)
    files.files.set(`${project}/.modstudio/trash/cards/Fireball-1/artifact.cs`, 'generated')
    files.directories.add(`${project}/.modstudio/trash/cards`)
    files.directories.add(`${project}/.modstudio/trash/cards/Fireball-1`)
    files.failRenameTo = `${project}/scripts/Cards/Fireball.cs`
    files.beforeLink = (_from, to) => {
      if (to === `${project}/scripts/Cards/Fireball.cs`) {
        files.files.set(`${project}/.modstudio/cards/Fireball.json`, 'external replacement')
      }
    }
    const result = await createCardTrashRepository({ files }).restore(project, 'Fireball-1')
    expect(result).toEqual({
      status: 'restored',
      cardId: 'Fireball',
      warning: 'CardDocument 已恢复；C# 产物恢复失败，回收站副本已保留',
    })
    expect(files.files.get(`${project}/.modstudio/cards/Fireball.json`)).toBe('external replacement')
    expect(files.files.get(`${project}/.modstudio/trash/cards/Fireball-1/card.json`)).toBe(document)
    expect(files.files.get(`${project}/.modstudio/trash/cards/Fireball-1/artifact.cs`)).toBe('generated')
  })

  it('活动目录读取失败时关闭恢复，不把 EACCES 当作空目录', async () => {
    const files = new MemoryFiles()
    const trashDocument = `${project}/.modstudio/trash/cards/Fireball-1/card.json`
    files.files.set(trashDocument, document)
    files.directories.add(`${project}/.modstudio/trash/cards/Fireball-1`)
    files.readDirectoryResult = async path => path === `${project}/.modstudio/cards`
      ? { status: 'error', error: 'EACCES' }
      : { status: 'missing' }

    const result = await createCardTrashRepository({ files }).restore(project, 'Fireball-1')

    expect(result).toEqual({ status: 'failed', reason: '无法确认活动 Card 目录，回收站内容保留' })
    expect(files.files.has(`${project}/.modstudio/cards/Fireball.json`)).toBe(false)
    expect(files.files.get(trashDocument)).toBe(document)
  })

  it('删除时 C# 读取失败会关闭操作，不把 EACCES 当作没有产物', async () => {
    const files = new MemoryFiles()
    const sourceDocument = `${project}/.modstudio/cards/Fireball.json`
    const sourceArtifact = `${project}/scripts/Cards/Fireball.cs`
    files.files.set(sourceDocument, document)
    files.files.set(sourceArtifact, 'generated')
    files.readFileResult = async path => {
      if (path === sourceDocument) return { status: 'found', value: document }
      if (path === sourceArtifact) return { status: 'error', error: 'EACCES' }
      return { status: 'missing' }
    }

    const result = await createCardTrashRepository({ files, idSuffix: () => '1' }).delete(project, 'Fireball')

    expect(result).toEqual({ status: 'failed', reason: '无法确认 C# 产物，未删除 Card' })
    expect(files.files.get(sourceDocument)).toBe(document)
    expect(files.files.get(sourceArtifact)).toBe('generated')
  })

  it('恢复读回内容被替换时保留回收站权威副本并返回警告', async () => {
    const files = new MemoryFiles()
    const trashDocument = `${project}/.modstudio/trash/cards/Fireball-1/card.json`
    const targetDocument = `${project}/.modstudio/cards/Fireball.json`
    files.files.set(trashDocument, document)
    files.directories.add(`${project}/.modstudio/trash/cards/Fireball-1`)
    const readFile = files.readFile.bind(files)
    files.readFile = async path => {
      if (path === targetDocument) {
        files.files.set(targetDocument, 'external replacement')
        return 'external replacement'
      }
      return readFile(path)
    }

    const result = await createCardTrashRepository({ files }).restore(project, 'Fireball-1')

    expect(result).toEqual({
      status: 'restored',
      cardId: 'Fireball',
      warning: 'Card 文件已恢复但无法完成读回校验；回收站副本已保留，请核对活动目录',
    })
    expect(files.files.get(targetDocument)).toBe('external replacement')
    expect(files.files.get(trashDocument)).toBe(document)
  })

  it('恢复占用 ID 时使用 no-replace，检查后出现的竞争文件不会被覆盖', async () => {
    const files = new MemoryFiles()
    const trashDocument = `${project}/.modstudio/trash/cards/Fireball-1/card.json`
    const targetDocument = `${project}/.modstudio/cards/Fireball.json`
    const competing = 'future-schema-document'
    files.files.set(trashDocument, document)
    files.directories.add(`${project}/.modstudio/trash/cards`)
    files.directories.add(`${project}/.modstudio/trash/cards/Fireball-1`)
    files.beforeLink = (_from, to) => {
      if (to === targetDocument) files.files.set(to, competing)
    }

    const result = await createCardTrashRepository({ files }).restore(project, 'Fireball-1')

    expect(result).toMatchObject({ status: 'conflict', cardId: 'Fireball' })
    expect(files.files.get(targetDocument)).toBe(competing)
    expect(files.files.get(trashDocument)).toBe(document)
  })
})
