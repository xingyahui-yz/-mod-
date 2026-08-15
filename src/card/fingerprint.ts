import type { CardDocument } from './cardDocument'
import { TRIGGER_KINDS } from '../shared/kinds'

export const GENERATOR_VERSION = 'card-codegen-v1'

function stableValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stableValue)
  if (value && typeof value === 'object') {
    return Object.keys(value as Record<string, unknown>)
      .sort()
      .reduce<Record<string, unknown>>((result, key) => {
        if (key.startsWith('ui') || key === 'position' || key === 'metadata') return result
        result[key] = stableValue((value as Record<string, unknown>)[key])
        return result
      }, {})
  }
  return value
}

function stableStringify(value: unknown): string {
  return JSON.stringify(stableValue(value))
}

/** 轻量同步 hash，避免 renderer 生成指纹依赖 Node crypto。 */
function hashString(value: string): string {
  let hash = 2166136261
  for (let i = 0; i < value.length; i += 1) {
    hash ^= value.charCodeAt(i)
    hash = Math.imul(hash, 16777619)
  }
  return (hash >>> 0).toString(16).padStart(8, '0')
}

function chainSemantics(document: CardDocument) {
  const { graph } = document
  const nodes = new Map(graph.nodes.map(node => [node.id, node]))
  const triggers = graph.nodes
    .filter(node => node.type === 'trigger')
    .map(node => ({ node, event: String(node.data.event ?? '') }))
    .sort((a, b) => a.event.localeCompare(b.event))

  return triggers.map(({ node, event }) => {
    const effects: unknown[] = []
    let nodeId = node.id
    const visited = new Set<string>()
    while (!visited.has(nodeId)) {
      visited.add(nodeId)
      const edge = graph.edges.find(candidate => candidate.from.nodeId === nodeId)
      if (!edge) break
      const next = nodes.get(edge.to.nodeId)
      if (!next) break
      if (next.type === 'effect') {
        effects.push({ kind: next.data.kind, data: stableValue(next.data) })
      }
      nodeId = next.id
    }
    return {
      event,
      methodName: TRIGGER_KINDS[event]?.methodName ?? null,
      effects,
    }
  })
}

export function generationSourcePayload(document: CardDocument): unknown {
  return {
    card: {
      id: document.card.id,
      name: document.card.name,
      cost: document.card.cost,
      type: document.card.type,
      rarity: document.card.rarity,
      description: document.card.description,
      keywords: document.card.keywords,
      imagePath: document.card.imagePath,
    },
    chains: chainSemantics(document),
  }
}

export function computeGenerationSourceHash(document: CardDocument): string {
  return hashString(stableStringify(generationSourcePayload(document)))
}

export function computeArtifactHash(content: string): string {
  return hashString(content)
}
