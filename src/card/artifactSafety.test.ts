import { describe, expect, it } from 'vitest'
import { appendNode, connect, createEmptyGraph } from '../node-editor/graph'
import type { CardDocument } from './cardDocument'
import { computeArtifactHash, computeGenerationSourceHash, GENERATOR_VERSION } from './fingerprint'
import { inspectCardArtifact, isArtifactOverwriteBlocked } from './artifactSafety'

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

describe('artifact safety', () => {
  it('区分缺失、未跟踪、外部修改和同步产物', () => {
    const document = makeDocument()
    expect(inspectCardArtifact(document, null).status).toBe('missing')
    expect(inspectCardArtifact(document, 'manual').status).toBe('untracked')

    const artifact = 'generated'
    const synced: CardDocument = {
      ...document,
      generation: {
        lastGeneratedFingerprint: {
          sourceHash: computeGenerationSourceHash(document),
          generatorVersion: GENERATOR_VERSION,
          artifactHash: computeArtifactHash(artifact),
        },
      },
    }
    expect(inspectCardArtifact(synced, artifact).status).toBe('in-sync')
    expect(inspectCardArtifact(synced, 'changed').status).toBe('externally-modified')
  })

  it('生成器或语义变化时保留可信产物但标记过期', () => {
    const artifact = 'generated'
    const document = makeDocument()
    const synced: CardDocument = {
      ...document,
      generation: {
        lastGeneratedFingerprint: {
          sourceHash: 'old-source',
          generatorVersion: GENERATOR_VERSION,
          artifactHash: computeArtifactHash(artifact),
        },
      },
    }
    expect(inspectCardArtifact(synced, artifact).status).toBe('stale-generation')
  })

  it('只有外部修改和未跟踪产物阻止覆盖', () => {
    expect(isArtifactOverwriteBlocked('externally-modified')).toBe(true)
    expect(isArtifactOverwriteBlocked('untracked')).toBe(true)
    expect(isArtifactOverwriteBlocked('stale-generation')).toBe(false)
    expect(isArtifactOverwriteBlocked('in-sync')).toBe(false)
  })
})
