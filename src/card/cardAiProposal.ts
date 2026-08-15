import type { CardDocument } from './cardDocument'
import { parseCardDocument } from './cardDocument'

export interface CardProposal {
  cardId: string
  baseRevision: string
  document: CardDocument
}

export type CardProposalResult =
  | { status: 'ready'; proposal: CardProposal }
  | { status: 'invalid'; violations: string[] }

function stableValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stableValue)
  if (value && typeof value === 'object') {
    return Object.keys(value as Record<string, unknown>)
      .sort()
      .reduce<Record<string, unknown>>((result, key) => {
        result[key] = stableValue((value as Record<string, unknown>)[key])
        return result
      }, {})
  }
  return value
}

function hash(value: string): string {
  let result = 2166136261
  for (let index = 0; index < value.length; index += 1) {
    result ^= value.charCodeAt(index)
    result = Math.imul(result, 16777619)
  }
  return (result >>> 0).toString(16).padStart(8, '0')
}

/** revision 覆盖完整草稿（包含坐标），但不把生成状态算入编辑并发基线。 */
export function cardDocumentRevision(document: CardDocument): string {
  return hash(JSON.stringify(stableValue({
    schemaVersion: document.schemaVersion,
    card: document.card,
    graph: document.graph,
  })))
}

function candidateDocument(candidate: unknown): unknown {
  if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) return candidate
  const record = candidate as Record<string, unknown>
  // AI 响应必须包含完整 card + graph；不接受只有 CardData 的旧快捷格式。
  if (!('card' in record) || !('graph' in record)) return candidate
  return {
    ...record,
    schemaVersion: 2,
    // AI 提案不能携带旧的生成状态，应用后必须重新显式生成。
    generation: { lastGeneratedFingerprint: null },
    card: record.card,
    graph: record.graph,
  }
}

/** 通过与磁盘 CardDocument 相同的 parser seam 校验 AI 输出。 */
export function createCardProposal(base: CardDocument, candidate: unknown): CardProposalResult {
  const normalized = candidateDocument(candidate)
  const parsed = parseCardDocument(normalized)
  if (parsed.status !== 'editable') {
    if (parsed.status === 'invalid') return { status: 'invalid', violations: [parsed.reason] }
    return { status: 'invalid', violations: [`AI 提案不可编辑：${parsed.status}`] }
  }
  if (parsed.document.card.id !== base.card.id) {
    return { status: 'invalid', violations: ['AI 提案不能修改当前 Card ID'] }
  }
  return {
    status: 'ready',
    proposal: {
      cardId: base.card.id,
      baseRevision: cardDocumentRevision(base),
      document: parsed.document,
    },
  }
}

export function isCardProposalStale(proposal: CardProposal, current: CardDocument): boolean {
  return proposal.cardId !== current.card.id || proposal.baseRevision !== cardDocumentRevision(current)
}

export function applyCardProposal(current: CardDocument, proposal: CardProposal):
  | { ok: true; document: CardDocument }
  | { ok: false; reason: 'stale-proposal' } {
  if (isCardProposalStale(proposal, current)) return { ok: false, reason: 'stale-proposal' }
  return { ok: true, document: proposal.document }
}
