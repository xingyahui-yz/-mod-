import { CardData } from '../types'
import { EFFECT_KINDS, TRIGGER_KINDS } from '../shared/kinds'
import { validateGraph } from '../node-editor/graph'
import { NodeGraph } from '../node-editor/types'

export const CURRENT_CARD_SCHEMA_VERSION = 2

export interface GenerationFingerprint {
  sourceHash: string
  generatorVersion: string
  artifactHash: string
}

export interface CardDocument {
  schemaVersion: number
  card: CardData
  graph: NodeGraph
  generation: {
    lastGeneratedFingerprint: GenerationFingerprint | null
  }
}

export type CardDocumentParseResult =
  | { status: 'editable'; document: CardDocument }
  | { status: 'migration-required'; schemaVersion: number; raw: unknown }
  | { status: 'read-only'; reason: 'future-schema' | 'unknown-kind'; raw: unknown; unknownKinds?: string[] }
  | { status: 'invalid'; reason: string; raw?: unknown }

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isCardData(value: unknown): value is CardData {
  if (!isRecord(value)) return false
  return typeof value.id === 'string' && /^[A-Z][A-Za-z0-9]*$/.test(value.id)
    && typeof value.name === 'string'
    && typeof value.cost === 'number' && Number.isFinite(value.cost)
    && (value.type === 'Attack' || value.type === 'Skill' || value.type === 'Power')
    && (value.rarity === 'Common' || value.rarity === 'Uncommon' || value.rarity === 'Rare')
    && typeof value.description === 'string'
    && Array.isArray(value.keywords) && value.keywords.every(k => typeof k === 'string')
    && (value.imagePath === undefined || typeof value.imagePath === 'string')
}

function unknownKindsInGraph(graph: unknown): string[] {
  if (!isRecord(graph) || !Array.isArray(graph.nodes)) return []
  const unknown = new Set<string>()
  for (const node of graph.nodes) {
    if (!isRecord(node) || !isRecord(node.data)) continue
    if (node.type === 'trigger' && typeof node.data.event === 'string' && !TRIGGER_KINDS[node.data.event]) {
      unknown.add(`trigger:${node.data.event}`)
    }
    if (node.type === 'effect' && typeof node.data.kind === 'string' && !EFFECT_KINDS[node.data.kind]) {
      unknown.add(`effect:${node.data.kind}`)
    }
  }
  return [...unknown]
}

function isFingerprint(value: unknown): value is GenerationFingerprint {
  return isRecord(value)
    && typeof value.sourceHash === 'string'
    && typeof value.generatorVersion === 'string'
    && typeof value.artifactHash === 'string'
}

export function parseCardDocument(value: unknown): CardDocumentParseResult {
  if (!isRecord(value)) return { status: 'invalid', reason: 'CardDocument 必须是对象', raw: value }
  if (typeof value.schemaVersion !== 'number' || !Number.isInteger(value.schemaVersion)) {
    return { status: 'invalid', reason: 'schemaVersion 必须是整数', raw: value }
  }
  if (value.schemaVersion > CURRENT_CARD_SCHEMA_VERSION) {
    return { status: 'read-only', reason: 'future-schema', raw: value }
  }
  if (value.schemaVersion < CURRENT_CARD_SCHEMA_VERSION) {
    return { status: 'migration-required', schemaVersion: value.schemaVersion, raw: value }
  }
  if (!isCardData(value.card)) return { status: 'invalid', reason: 'card 结构无效', raw: value }
  const unknownKinds = unknownKindsInGraph(value.graph)
  if (unknownKinds.length > 0) {
    return { status: 'read-only', reason: 'unknown-kind', raw: value, unknownKinds }
  }
  const graphResult = validateGraph(value.graph)
  if (!graphResult.ok) return { status: 'invalid', reason: graphResult.reason, raw: value }
  if (!isRecord(value.generation) ||
      !(value.generation.lastGeneratedFingerprint === null || isFingerprint(value.generation.lastGeneratedFingerprint))) {
    return { status: 'invalid', reason: 'generation.lastGeneratedFingerprint 结构无效', raw: value }
  }
  return {
    status: 'editable',
    document: value as unknown as CardDocument,
  }
}

export function parseCardDocumentJson(json: string): CardDocumentParseResult {
  try {
    return parseCardDocument(JSON.parse(json))
  } catch {
    return { status: 'invalid', reason: 'JSON 损坏', raw: json }
  }
}

export function serializeCardDocument(document: CardDocument): string {
  return JSON.stringify(document, null, 2)
}
