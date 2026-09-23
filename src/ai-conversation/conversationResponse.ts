import { parseCardDocument, type CardDocument } from '../card/cardDocument'
import { EFFECT_KINDS, TRIGGER_KINDS } from '../shared/kinds'

export interface ConversationQuickReply {
  id: string
  label: string
}

export interface ConversationCreateCardProposalInput {
  operation: 'create'
  document: CardDocument
}

export interface ConversationUpdateCardProposalInput {
  operation: 'update'
  targetCardId: string
  baseRevision: string
  document: CardDocument
}

export type ConversationCardProposalInput =
  | ConversationCreateCardProposalInput
  | ConversationUpdateCardProposalInput

export interface ConversationContextExpansionResponseV1 {
  schemaVersion: 1
  action: 'expand-context'
  cardIds: string[]
}

export type ConversationModelResponse =
  | { kind: 'final'; response: ConversationResponseV1 }
  | { kind: 'expand-context'; cardIds: string[] }

export type ConversationModelResponseParseResult =
  | { ok: true; value: ConversationModelResponse }
  | { ok: false; error: string }

export const MAX_CONTEXT_EXPANSION_CARD_IDS = 8

export interface ConversationResponseV1 {
  schemaVersion: 1
  text: string
  quickReplies: ConversationQuickReply[]
  proposals: ConversationCardProposalInput[]
}

export type ConversationResponseParseResult =
  | { ok: true; value: ConversationResponseV1 }
  | { ok: false; error: string }

const EXPANSION_KEYS = ['action', 'cardIds', 'schemaVersion']
const EXACT_KEYS = ['proposals', 'quickReplies', 'schemaVersion', 'text']
const CREATE_PROPOSAL_KEYS = ['document', 'operation']
const UPDATE_PROPOSAL_KEYS = ['baseRevision', 'document', 'operation', 'targetCardId']
const CARD_DOCUMENT_KEYS = ['card', 'generation', 'graph', 'schemaVersion']
const CARD_KEYS = ['cost', 'description', 'id', 'keywords', 'name', 'rarity', 'type']
const CARD_WITH_IMAGE_KEYS = [...CARD_KEYS, 'imagePath'].sort()
const GENERATION_KEYS = ['lastGeneratedFingerprint']
const GRAPH_KEYS = ['edges', 'entityId', 'entityType', 'id', 'metadata', 'nodes', 'version']
const METADATA_KEYS = ['createdAt', 'updatedAt']
const NODE_KEYS = ['data', 'id', 'position', 'type']
const POSITION_KEYS = ['x', 'y']
const EDGE_KEYS = ['from', 'id', 'to']
const EDGE_ENDPOINT_KEYS = ['nodeId', 'port']

export function parseConversationModelResponse(input: unknown): ConversationModelResponseParseResult {
  if (isRecord(input) && input.action === 'expand-context') {
    const expansion = parseConversationContextExpansionResponse(input)
    return expansion.ok
      ? { ok: true, value: { kind: 'expand-context', cardIds: expansion.value.cardIds } }
      : expansion
  }
  const finalResponse = parseConversationResponse(input)
  return finalResponse.ok
    ? { ok: true, value: { kind: 'final', response: finalResponse.value } }
    : finalResponse
}

export function parseConversationContextExpansionResponse(input: unknown):
  | { ok: true; value: ConversationContextExpansionResponseV1 }
  | { ok: false; error: string } {
  if (!isRecord(input) || !hasExactKeys(input, EXPANSION_KEYS)) {
    return { ok: false, error: 'expand-context 响应包含缺失或未知字段' }
  }
  if (input.schemaVersion !== 1) return { ok: false, error: '不支持的补取响应版本' }
  if (input.action !== 'expand-context') return { ok: false, error: '不支持的补取 action' }
  if (!Array.isArray(input.cardIds) || input.cardIds.length < 1 || input.cardIds.length > MAX_CONTEXT_EXPANSION_CARD_IDS) {
    return { ok: false, error: "cardIds 必须包含 1 到 " + MAX_CONTEXT_EXPANSION_CARD_IDS + " 项" }
  }
  const ids = new Set<string>()
  const cardIds: string[] = []
  for (const candidate of input.cardIds) {
    if (typeof candidate !== 'string' || !candidate.trim()) return { ok: false, error: 'cardIds 必须是非空字符串' }
    const cardId = candidate.trim()
    if (ids.has(cardId)) return { ok: false, error: 'cardIds 去除首尾空格后必须唯一' }
    ids.add(cardId)
    cardIds.push(cardId)
  }
  return { ok: true, value: { schemaVersion: 1, action: 'expand-context', cardIds } }
}

export function parseConversationResponse(input: unknown): ConversationResponseParseResult {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    return { ok: false, error: '响应必须是 JSON 对象' }
  }
  const value = input as Record<string, unknown>
  const keys = Object.keys(value).sort()
  if (keys.length !== EXACT_KEYS.length || keys.some((key, index) => key !== EXACT_KEYS[index])) {
    return { ok: false, error: '响应包含缺失或未知字段' }
  }
  if (value.schemaVersion !== 1) return { ok: false, error: '不支持的响应版本' }
  if (typeof value.text !== 'string') return { ok: false, error: 'text 必须是字符串' }
  if (!Array.isArray(value.quickReplies) || value.quickReplies.length > 4) {
    return { ok: false, error: 'quickReplies 必须包含 0 到 4 项' }
  }
  const ids = new Set<string>()
  const quickReplies: ConversationQuickReply[] = []
  for (const candidate of value.quickReplies) {
    if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) {
      return { ok: false, error: 'quick reply 格式无效' }
    }
    const reply = candidate as Record<string, unknown>
    const replyKeys = Object.keys(reply).sort()
    if (replyKeys.length !== 2 || replyKeys[0] !== 'id' || replyKeys[1] !== 'label') {
      return { ok: false, error: 'quick reply 包含缺失或未知字段' }
    }
    if (typeof reply.id !== 'string' || !reply.id.trim() || typeof reply.label !== 'string' || !reply.label.trim()) {
      return { ok: false, error: 'quick reply 的 id 和 label 不能为空' }
    }
    const id = reply.id.trim()
    const label = reply.label.trim()
    if (ids.has(id)) return { ok: false, error: 'quick reply ID 必须唯一' }
    ids.add(id)
    quickReplies.push({ id, label })
  }
  if (!Array.isArray(value.proposals)) {
    return { ok: false, error: 'proposals 必须是数组' }
  }
  const proposals: ConversationCardProposalInput[] = []
  for (const candidate of value.proposals) {
    const parsed = parseConversationCardProposalInput(candidate)
    if (!parsed.ok) return parsed
    proposals.push(parsed.value)
  }
  const text = value.text.trim()
  if (!text && quickReplies.length === 0) return { ok: false, error: '回复正文和快捷回答不能同时为空' }
  return { ok: true, value: { schemaVersion: 1, text, quickReplies, proposals } }
}

export function parseConversationCardProposalInput(input: unknown):
  | { ok: true; value: ConversationCardProposalInput }
  | { ok: false; error: string } {
  if (!isRecord(input)) return { ok: false, error: 'Card 提案必须是对象' }
  if (input.operation !== 'create' && input.operation !== 'update') {
    return { ok: false, error: 'Card 提案只支持 create 或 update' }
  }
  const expected = input.operation === 'create' ? CREATE_PROPOSAL_KEYS : UPDATE_PROPOSAL_KEYS
  if (!hasExactKeys(input, expected)) return { ok: false, error: 'Card 提案包含缺失或未知字段' }
  const document = parseConversationCardDocument(input.document)
  if (!document.ok) return document
  if (input.operation === 'create') return { ok: true, value: { operation: 'create', document: document.value } }
  if (!isNonEmptyString(input.targetCardId) || !isNonEmptyString(input.baseRevision)) {
    return { ok: false, error: 'update 提案的 targetCardId 和 baseRevision 不能为空' }
  }
  const targetCardId = input.targetCardId.trim()
  if (document.value.card.id !== targetCardId) {
    return { ok: false, error: 'update 提案不能修改 Card ID' }
  }
  return {
    ok: true,
    value: {
      operation: 'update',
      targetCardId,
      baseRevision: input.baseRevision.trim(),
      document: document.value,
    },
  }
}

export function parseConversationCardDocument(input: unknown):
  | { ok: true; value: CardDocument }
  | { ok: false; error: string } {
  if (!isRecord(input) || !hasExactKeys(input, CARD_DOCUMENT_KEYS)) {
    return { ok: false, error: 'CardDocument 包含缺失或未知字段' }
  }
  if (!isRecord(input.card) || !(hasExactKeys(input.card, CARD_KEYS) || hasExactKeys(input.card, CARD_WITH_IMAGE_KEYS))) {
    return { ok: false, error: 'CardDocument.card 包含缺失或未知字段' }
  }
  if (!isRecord(input.generation) || !hasExactKeys(input.generation, GENERATION_KEYS) ||
    input.generation.lastGeneratedFingerprint !== null) {
    return { ok: false, error: 'AI Card 提案不能携带生成指纹' }
  }
  if (!isStrictGraph(input.graph)) return { ok: false, error: 'CardDocument.graph 包含缺失或未知字段' }
  const parsed = parseCardDocument(input)
  if (parsed.status !== 'editable') {
    return {
      ok: false,
      error: parsed.status === 'invalid' ? parsed.reason : `CardDocument 不可编辑：${parsed.status}`,
    }
  }
  return { ok: true, value: parsed.document }
}

function isStrictGraph(input: unknown): boolean {
  if (!isRecord(input) || !hasExactKeys(input, GRAPH_KEYS) || !isRecord(input.metadata) ||
    !hasExactKeys(input.metadata, METADATA_KEYS) || !Array.isArray(input.nodes) || !Array.isArray(input.edges)) return false
  for (const node of input.nodes) {
    if (!isRecord(node) || !hasExactKeys(node, NODE_KEYS) || !isRecord(node.position) ||
      !hasExactKeys(node.position, POSITION_KEYS) ||
      !Number.isFinite(node.position.x) || !Number.isFinite(node.position.y) ||
      !hasStrictCardNodeData(node.type, node.data)) return false
  }
  for (const edge of input.edges) {
    if (!isRecord(edge) || !hasExactKeys(edge, EDGE_KEYS) || !isRecord(edge.from) || !isRecord(edge.to) ||
      !hasExactKeys(edge.from, EDGE_ENDPOINT_KEYS) || !hasExactKeys(edge.to, EDGE_ENDPOINT_KEYS)) return false
  }
  return true
}

function hasStrictCardNodeData(nodeType: unknown, input: unknown): boolean {
  if (!isRecord(input)) return false
  if (nodeType === 'trigger') {
    if (typeof input.event !== 'string') return false
    const definition = TRIGGER_KINDS[input.event]
    return definition?.entity === 'card' && hasTemplateShape(input, definition.defaultData)
  }
  if (nodeType === 'effect') {
    if (typeof input.kind !== 'string') return false
    const definition = EFFECT_KINDS[input.kind]
    return Boolean(definition && (!definition.entity || definition.entity === 'card') &&
      hasTemplateShape(input, definition.defaultData))
  }
  return false
}

function hasTemplateShape(input: Record<string, unknown>, template: Record<string, unknown>): boolean {
  if (!hasExactKeys(input, Object.keys(template).sort())) return false
  return Object.entries(template).every(([key, expected]) => hasValueShape(input[key], expected))
}

function hasValueShape(input: unknown, template: unknown): boolean {
  if (typeof template === 'number') return typeof input === 'number' && Number.isFinite(input)
  if (typeof template === 'string' || typeof template === 'boolean') return typeof input === typeof template
  if (template === null) return input === null
  if (Array.isArray(template)) {
    return Array.isArray(input) && (template.length === 0 || input.every(value => hasValueShape(value, template[0])))
  }
  if (isRecord(template)) return isRecord(input) && hasTemplateShape(input, template)
  return false
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function hasExactKeys(value: Record<string, unknown>, expected: readonly string[]): boolean {
  const keys = Object.keys(value).sort()
  return keys.length === expected.length && keys.every((key, index) => key === expected[index])
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0
}

export function parseConversationModelResponseText(content: string): ConversationModelResponseParseResult {
  try {
    const fenced = content.trim().match(/^\x60\x60\x60(?:json)?\s*([\s\S]*?)\s*\x60\x60\x60$/i)
    return parseConversationModelResponse(JSON.parse(fenced ? fenced[1] : content))
  } catch {
    return { ok: false, error: '模型没有返回有效 JSON' }
  }
}

export function parseConversationResponseText(content: string): ConversationResponseParseResult {
  try {
    const fenced = content.trim().match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i)
    return parseConversationResponse(JSON.parse(fenced ? fenced[1] : content))
  } catch {
    return { ok: false, error: '模型没有返回有效 JSON' }
  }
}
