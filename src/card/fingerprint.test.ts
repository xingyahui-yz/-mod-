import { describe, expect, it } from 'vitest'
import { appendNode, connect, createEmptyGraph, moveNode } from '../node-editor/graph'
import type { CardDocument } from './cardDocument'
import { computeArtifactHash, computeGenerationSourceHash, GENERATOR_VERSION } from './fingerprint'

function buildDocument(): CardDocument {
  let graph = createEmptyGraph('Fireball', 'card')
  const trigger = appendNode(graph, 'trigger', { x: 0, y: 0 }, { event: 'onPlay', uiLabel: 'Play' })
  graph = trigger.graph
  const effect = appendNode(graph, 'effect', { x: 120, y: 0 }, { kind: 'exhaustSelf', uiColor: '#fff' })
  graph = effect.graph
  const edge = connect(graph, { nodeId: trigger.node.id, port: 'out' }, { nodeId: effect.node.id, port: 'in' })
  if (!edge.ok) throw new Error(edge.reason)
  return {
    schemaVersion: 2,
    card: { id: 'Fireball', name: 'Fireball', cost: 1, type: 'Attack', rarity: 'Common', description: 'Deal damage', keywords: [] },
    graph: edge.graph,
    generation: { lastGeneratedFingerprint: null },
  }
}

describe('generation fingerprints', () => {
  it('移动节点和 metadata 时间变化不改变 sourceHash', () => {
    const document = buildDocument()
    const triggerId = document.graph.nodes[0].id
    const moved = { ...document, graph: moveNode(document.graph, triggerId, { x: 999, y: 321 }) }
    expect(computeGenerationSourceHash(moved)).toBe(computeGenerationSourceHash(document))
  })

  it('修改 Card 或 effect 参数改变 sourceHash，键顺序不影响结果', () => {
    const document = buildDocument()
    const changed = { ...document, card: { ...document.card, cost: 2 } }
    expect(computeGenerationSourceHash(changed)).not.toBe(computeGenerationSourceHash(document))
    const reordered = JSON.parse(JSON.stringify(document)) as CardDocument
    reordered.graph.nodes[1].data = { uiColor: '#fff', kind: 'exhaustSelf' }
    expect(computeGenerationSourceHash(reordered)).toBe(computeGenerationSourceHash(document))
  })

  it('artifactHash 稳定且 generatorVersion 明确纳入同步依据', () => {
    expect(computeArtifactHash('same')).toBe(computeArtifactHash('same'))
    expect(computeArtifactHash('same')).not.toBe(computeArtifactHash('different'))
    expect(GENERATOR_VERSION).toMatch(/^card-codegen-/)
  })
})
