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
    if (this.failRename) return false
    const content = this.files.get(from)
    if (content === undefined) return false
    this.files.delete(from)
    this.files.set(to, content)
    this.renameCalls.push({ from, to })
    return true
  }

  async remove(path: string) {
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

  it('保存先写临时文件，再原子 rename 到 Card ID 文件名', async () => {
    const files = new MemoryFiles()
    const repository = createCardDocumentRepository({ files })
    const result = await repository.save('/project', makeDocument('IceBolt'))

    expect(result).toEqual({ ok: true, path: '/project/.modstudio/cards/IceBolt.json' })
    expect(files.renameCalls).toHaveLength(1)
    expect(files.files.has('/project/.modstudio/cards/IceBolt.json')).toBe(true)
    expect([...files.files.keys()].some(path => path.includes('.tmp-'))).toBe(false)
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
