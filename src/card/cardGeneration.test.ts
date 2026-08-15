import { describe, expect, it } from 'vitest'
import { appendNode, connect, createEmptyGraph } from '../node-editor/graph'
import type { CardDocument } from './cardDocument'
import { generateCardArtifact, type CardGenerationFilePort } from './cardGeneration'

class MemoryFiles implements CardGenerationFilePort {
  files = new Map<string, string>()
  failRead = false
  failRename = false
  failDocumentSave = false

  async mkdir() { return true }
  async writeFile(path: string, content: string) { this.files.set(path, content); return true }
  async rename(from: string, to: string) {
    if (this.failRename) return false
    const content = this.files.get(from)
    if (content === undefined) return false
    this.files.delete(from)
    this.files.set(to, content)
    return true
  }
  async remove(path: string) { this.files.delete(path); return true }
  async readFile(path: string) { return this.failRead ? null : this.files.get(path) ?? null }
}

function makeDocument(): CardDocument {
  let graph = createEmptyGraph('Fireball', 'card')
  const trigger = appendNode(graph, 'trigger', { x: 0, y: 0 }, { event: 'onPlay' })
  graph = trigger.graph
  const effect = appendNode(graph, 'effect', { x: 100, y: 0 }, { kind: 'exhaustSelf' })
  const linked = connect(effect.graph, { nodeId: trigger.node.id, port: 'out' }, { nodeId: effect.node.id, port: 'in' })
  if (!linked.ok) throw new Error(linked.reason)
  return {
    schemaVersion: 2,
    card: { id: 'Fireball', name: 'Fireball', cost: 1, type: 'Attack', rarity: 'Common', description: '', keywords: [] },
    graph: linked.graph,
    generation: { lastGeneratedFingerprint: null },
  }
}

describe('generateCardArtifact', () => {
  it('原子写入 C#、读回 artifactHash，再更新文档指纹', async () => {
    const files = new MemoryFiles()
    const result = await generateCardArtifact('/project', makeDocument(), {
      files,
      saveDocument: async () => true,
    })

    expect(result.status).toBe('generated')
    expect(files.files.has('/project/scripts/Cards/Fireball.cs')).toBe(true)
    if (result.status === 'generated') expect(result.document.generation.lastGeneratedFingerprint?.artifactHash).toBeTruthy()
  })

  it('非法草稿不产生任何 C# 或文档写回调用', async () => {
    const files = new MemoryFiles()
    let saveCalls = 0
    const document = makeDocument()
    document.graph = { ...document.graph, nodes: [] , edges: [] }
    const result = await generateCardArtifact('/project', document, {
      files,
      saveDocument: async () => { saveCalls += 1; return true },
    })
    expect(result.status).toBe('failed')
    expect(files.files.size).toBe(0)
    expect(saveCalls).toBe(0)
  })

  it('产物读回或文档指纹写回失败时报告未同步', async () => {
    const files = new MemoryFiles()
    files.failRead = true
    const readbackFailure = await generateCardArtifact('/project', makeDocument(), {
      files,
      saveDocument: async () => true,
    })
    expect(readbackFailure.status).toBe('failed')

    const saveFailureFiles = new MemoryFiles()
    const documentFailure = await generateCardArtifact('/project', makeDocument(), {
      files: saveFailureFiles,
      saveDocument: async () => false,
    })
    expect(documentFailure.status).toBe('failed')
  })
})
