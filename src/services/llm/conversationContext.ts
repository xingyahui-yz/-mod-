import type { CardDocument } from '../../card/cardDocument'
import type { ConversationCardProposalStatus } from '../../ai-conversation/proposalLifecycle'
import type { ConversationProposalRejectionFeedback } from '../../ai-conversation/proposalLifecycle'
import { cardDocumentRevision } from '../../card/cardAiProposal'

export type ConversationCardCatalogTier = 'detailed' | 'compact'

interface ConversationCardCatalogSummaryBase {
  id: string
  name: string
  type: CardDocument['card']['type']
  revision: string
}

export interface DetailedConversationCardCatalogSummary extends ConversationCardCatalogSummaryBase {
  tier: 'detailed'
  rarity: CardDocument['card']['rarity']
  cost: number
  keywords: readonly string[]
  description: string
  behaviorKinds: readonly string[]
}

export interface CompactConversationCardCatalogSummary extends ConversationCardCatalogSummaryBase {
  tier: 'compact'
}

export type ConversationCardCatalogSummary =
  | DetailedConversationCardCatalogSummary
  | CompactConversationCardCatalogSummary

export const CONVERSATION_CARD_DESCRIPTION_MAX_CODE_POINTS = 160

/** Build deterministic directory projections without exposing complete Card documents. */
export function buildConversationCardCatalog(
  documents: readonly CardDocument[],
  tier: 'detailed',
): DetailedConversationCardCatalogSummary[]
export function buildConversationCardCatalog(
  documents: readonly CardDocument[],
  tier: 'compact',
): CompactConversationCardCatalogSummary[]
export function buildConversationCardCatalog(
  documents: readonly CardDocument[],
  tier: ConversationCardCatalogTier,
): ConversationCardCatalogSummary[]
export function buildConversationCardCatalog(
  documents: readonly CardDocument[],
  tier: ConversationCardCatalogTier,
): ConversationCardCatalogSummary[] {
  return documents.map(document => {
    const base: ConversationCardCatalogSummaryBase = {
      id: document.card.id,
      name: document.card.name,
      type: document.card.type,
      revision: cardDocumentRevision(document),
    }
    if (tier === 'compact') return { ...base, tier: 'compact' }
    return {
      ...base,
      tier: 'detailed',
      rarity: document.card.rarity,
      cost: document.card.cost,
      keywords: [...document.card.keywords],
      description: truncateCodePoints(document.card.description, CONVERSATION_CARD_DESCRIPTION_MAX_CODE_POINTS),
      behaviorKinds: behaviorKinds(document),
    }
  })
}

function truncateCodePoints(value: string, maxCodePoints: number): string {
  const points = Array.from(value)
  if (points.length <= maxCodePoints) return value
  return `${points.slice(0, maxCodePoints - 1).join('')}…`
}

function behaviorKinds(document: CardDocument): string[] {
  const kinds = new Set<string>()
  for (const node of document.graph.nodes) {
    if (node.type === 'trigger' && typeof node.data.event === 'string') {
      kinds.add(`trigger:${node.data.event}`)
    } else if (node.type === 'effect' && typeof node.data.kind === 'string') {
      kinds.add(`effect:${node.data.kind}`)
    }
  }
  return [...kinds].sort(compareCodeUnits)
}

function compareCodeUnits(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0
}

/** 每轮都会发送的确定性目录摘要；这里不承载 Card 正文或行为图。 */
export interface ConversationProjectCardSummary {
  id: string
  name: string
  type: CardDocument['card']['type']
  revision: string
}

/** 只有用户显式附加的 Card 才会解析为完整文档并进入 prompt。 */
export interface ConversationResolvedAttachment {
  cardId: string
  revision: string
  document: CardDocument
}

/** 历史提案只提供会话连续性所需的状态，不重复发送完整候选文档。 */
export interface ConversationProposalSummary {
  id: string
  operation: 'create' | 'update'
  targetCardId: string
  baseRevision: string | null
  status: ConversationCardProposalStatus
  /** 只有仍待确认的候选需要全文，支持下一轮继续修改该候选。 */
  candidate: CardDocument | null
  /** 拒绝原因由本地事件派生，LLM 不负责判断提案事实。 */
  rejectionFeedback: ConversationProposalRejectionFeedback | null
  finalCardId: string | null
}

export interface ConversationPromptContext {
  cardCatalog: readonly ConversationCardCatalogSummary[]
  compactCardCatalog: readonly CompactConversationCardCatalogSummary[]
  resolvedAttachments: readonly ConversationResolvedAttachment[]
  proposals: readonly ConversationProposalSummary[]
  /** Internally retrieved for this turn; never stored as a user attachment. */
  expandedAttachmentIds?: readonly string[]
  /** Consume the single reserved expansion allowance on the second provider call. */
  expansionPass?: boolean
}
