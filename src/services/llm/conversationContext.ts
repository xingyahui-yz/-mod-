import type { CardDocument } from '../../card/cardDocument'
import type { ConversationCardProposalStatus } from '../../ai-conversation/proposalLifecycle'
import type { ConversationProposalRejectionFeedback } from '../../ai-conversation/proposalLifecycle'

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
  cardCatalog: readonly ConversationProjectCardSummary[]
  resolvedAttachments: readonly ConversationResolvedAttachment[]
  proposals: readonly ConversationProposalSummary[]
}
