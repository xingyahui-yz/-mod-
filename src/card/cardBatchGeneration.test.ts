import { describe, expect, it } from 'vitest'
import { appendNode, connect, createEmptyGraph } from '../node-editor/graph'
import type { CardDocument } from './cardDocument'
import { generateCardBatch } from './cardBatchGeneration'
import type { CardGenerationFilePort } from './cardGeneration'

class MemoryFiles implements CardGenerationFilePort {
  files = new Map<string, string>()
  failFor = new Set<string>()
  async mkdir() { return true }
  async writeFile(path: string, content: string) { if (this.failFor.has(path)) return false; this.files.set(path, content); return true }
  async rename(from: string, to: string) { if (this.failFor.has(to)) return false; const content = this.files.get(from); if (content === undefined) return false; this.files.delete(from); this.files.set(to, content); return true }
  async remove(path: string) { this.files.delete(path); return true }
  async readFile(path: string) { return this.files.get(path) ?? null }
}

function makeDocument(id: string, valid = true): CardDocument {
  let graph = createEmptyGraph(id, 'card')
  if (valid) {
    const trigger = appendNode(graph, 'trigger', { x: 0, y: 0 }, { event: 'onPlay' })
    graph = trigger.graph
    const effect = appendNode(graph, 'effect', { x: 100, y: 0 }, { kind: 'exhaustSelf' })
    const linked = connect(effect.graph, { nodeId: trigger.node.id, port: 'out' }, { nodeId: effect.node.id, port: 'in' })
    if (!linked.ok) throw new Error(linked.reason)
    graph = linked.graph
  }
  return {
    schemaVersion: 2,
    card: { id, name: id, cost: 1, type: 'Attack', rarity: 'Common', description: '', keywords: [] },
    graph,
    generation: { lastGeneratedFingerprint: null },
  }
}

describe('generateCardBatch', () => {
  it('按输入顺序汇总成功、草稿跳过、只读跳过和失败', async () => {
    const files = new MemoryFiles()
    files.failFor.add('/project/scripts/Cards/Broken.cs')
    const report = await generateCardBatch('/project', [
      { status: 'editable', document: makeDocument('Good') },
      { status: 'editable', document: makeDocument('Draft', false) },
      { status: 'read-only', cardId: 'Future', reason: 'future-schema' },
      { status: 'editable', document: makeDocument('Broken') },
    ], { files, saveDocument: async () => true })

    expect(report.items.map(item => item.status)).toEqual(['generated', 'skipped', 'skipped', 'failed'])
    expect(report.counts).toEqual({ generated: 1, skipped: 2, failed: 1 })
    expect(files.files.has('/project/scripts/Cards/Good.cs')).toBe(true)
    expect(files.files.has('/project/scripts/Cards/Broken.cs')).toBe(false)
  })

  it('单张文档写回失败只影响当前项，后续 Card 仍继续', async () => {
    const files = new MemoryFiles()
    const saved: string[] = []
    const report = await generateCardBatch('/project', [
      { status: 'editable', document: makeDocument('First') },
      { status: 'editable', document: makeDocument('Second') },
    ], {
      files,
      saveDocument: async document => {
        saved.push(document.card.id)
        return document.card.id !== 'First'
      },
    })
    expect(saved).toEqual(['First', 'Second'])
    expect(report.items.map(item => item.status)).toEqual(['failed', 'generated'])
    expect(files.files.has('/project/scripts/Cards/Second.cs')).toBe(true)
  })
})
