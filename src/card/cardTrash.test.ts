import { describe, expect, it } from 'vitest'
import { createCardTrashRepository, type CardTrashFileEntry, type CardTrashFilePort } from './cardTrash'

class MemoryFiles implements CardTrashFilePort {
  files = new Map<string, string>()
  directories = new Set<string>()
  failRenameTo: string | null = null

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
  async remove(path: string) { this.files.delete(path); this.directories.delete(path); return true }
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

  it('恢复产物失败时 CardDocument 补偿回回收站', async () => {
    const files = new MemoryFiles()
    files.files.set(`${project}/.modstudio/trash/cards/Fireball-1/card.json`, document)
    files.files.set(`${project}/.modstudio/trash/cards/Fireball-1/artifact.cs`, 'generated')
    files.directories.add(`${project}/.modstudio/trash/cards`)
    files.directories.add(`${project}/.modstudio/trash/cards/Fireball-1`)
    files.failRenameTo = `${project}/scripts/Cards/Fireball.cs`
    const result = await createCardTrashRepository({ files }).restore(project, 'Fireball-1')
    expect(result.status).toBe('failed')
    expect(files.files.get(`${project}/.modstudio/trash/cards/Fireball-1/card.json`)).toBe(document)
    expect(files.files.get(`${project}/.modstudio/trash/cards/Fireball-1/artifact.cs`)).toBe('generated')
  })
})
