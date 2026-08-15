import { describe, expect, it } from 'vitest'
import { appendNode, connect, createEmptyGraph } from '../node-editor/graph'
import type { CardDocument } from './cardDocument'
import { computeArtifactHash, computeGenerationSourceHash, GENERATOR_VERSION } from './fingerprint'
import { evaluateCardPreflight } from './cardPreflight'

function makeDocument(id: string, generated = false): CardDocument {
  let graph = createEmptyGraph(id, 'card')
  const trigger = appendNode(graph, 'trigger', { x: 0, y: 0 }, { event: 'onPlay' })
  graph = trigger.graph
  const effect = appendNode(graph, 'effect', { x: 100, y: 0 }, { kind: 'exhaustSelf' })
  const linked = connect(effect.graph, { nodeId: trigger.node.id, port: 'out' }, { nodeId: effect.node.id, port: 'in' })
  if (!linked.ok) throw new Error(linked.reason)
  const artifact = 'generated'
  return {
    schemaVersion: 2,
    card: { id, name: id, cost: 1, type: 'Attack', rarity: 'Common', description: '', keywords: [] },
    graph: linked.graph,
    generation: { lastGeneratedFingerprint: generated ? { sourceHash: computeGenerationSourceHash({
      schemaVersion: 2,
      card: { id, name: id, cost: 1, type: 'Attack', rarity: 'Common', description: '', keywords: [] },
      graph: linked.graph,
      generation: { lastGeneratedFingerprint: null },
    }), generatorVersion: GENERATOR_VERSION, artifactHash: computeArtifactHash(artifact) } : null },
  }
}

describe('card preflight', () => {
  it('默认阻止草稿、缺失产物、外部修改与过期生成器', () => {
    const draft = makeDocument('Draft')
    const generated = makeDocument('Ready', true)
    const report = evaluateCardPreflight([
      { cardId: 'Draft', document: draft, loadStatus: 'editable', artifact: null },
      { cardId: 'Ready', document: generated, loadStatus: 'editable', artifact: 'changed' },
      { cardId: 'Future', loadStatus: 'read-only', artifact: null },
    ])
    expect(report.ok).toBe(false)
    expect(report.items.map(item => item.status)).toEqual(['draft', 'externally-modified', 'read-only'])
    expect(report.blocking.map(item => item.cardId)).toEqual(['Ready', 'Future', 'Draft'])
  })

  it('允许明确排除草稿和本次使用上次可信版本', () => {
    const draft = makeDocument('Draft')
    const stale = makeDocument('Stale', true)
    stale.generation.lastGeneratedFingerprint!.sourceHash = 'old'
    const report = evaluateCardPreflight([
      { cardId: 'Draft', document: draft, loadStatus: 'editable', artifact: null },
      { cardId: 'Stale', document: stale, loadStatus: 'editable', artifact: 'generated' },
    ], { excludedDraftIds: ['Draft'], allowStaleGeneratedIds: ['Stale'] })
    expect(report.ok).toBe(true)
    expect(report.items.map(item => item.status)).toEqual(['draft', 'stale-allowed'])
  })
})
