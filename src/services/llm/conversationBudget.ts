/**
 * Deterministic conservative budget allocation for a conversation prompt.
 * Counts are estimates, not provider-tokenizer measurements. Callers should
 * leave the configured reserves for output and one possible context expansion.
 */

export type ConversationBudgetTier = 'detailed' | 'compact'

export interface ConversationBudgetAttachment<T> {
  value: T
  serialized: string
}

export interface ConversationBudgetMessage<T> {
  value: T
  serialized: string
  turnId: string
  role: 'user' | 'assistant'
}

export interface ConversationBudgetInput<TAttachment, TMessage> {
  contextWindowTokens: number
  reservedOutputTokens: number
  reservedExpansionTokens: number
  fixedContextSerialized: string
  detailedCatalogSerialized: string
  compactCatalogSerialized: string
  attachments: readonly ConversationBudgetAttachment<TAttachment>[]
  /** Ordered oldest to newest. */
  messages: readonly ConversationBudgetMessage<TMessage>[]
  latestUserTurnId: string
  estimateTokens?: (serialized: string) => number
}

export interface ConversationBudgetCounts {
  fixedContextTokens: number
  catalogTokens: number
  attachmentTokens: number
  messageTokens: number
  reservedOutputTokens: number
  reservedExpansionTokens: number
  estimatedInputTokens: number
  estimatedReservedTokens: number
  estimatedTotalTokens: number
  availableInputTokens: number
  remainingInputTokens: number
}

export type ConversationBudgetFailureKind =
  | 'invalid-budget'
  | 'invalid-estimate'
  | 'missing-latest-user-turn'
  | 'duplicate-latest-user-message'
  | 'fixed-context-over-budget'
  | 'compact-catalog-over-budget'
  | 'attachments-over-budget'
  | 'latest-user-message-over-budget'

export type ConversationBudgetResult<TAttachment, TMessage> =
  | {
      ok: true
      tier: ConversationBudgetTier
      attachments: readonly TAttachment[]
      /** Kept in original chronological order after selecting newest first. */
      messages: readonly TMessage[]
      omittedMessageCount: number
      counts: ConversationBudgetCounts
    }
  | {
      ok: false
      error: ConversationBudgetFailureKind
      counts: ConversationBudgetCounts
    }

/**
 * A conservative, deterministic heuristic based on Unicode code points.
 * It intentionally does not claim to match any provider tokenizer.
 */
export function estimateConversationTokensConservatively(serialized: string): number {
  return Array.from(serialized).length + (serialized.length > 0 ? 4 : 0)
}

/**
 * Allocates input budget in this order: fixed facts, compact catalog,
 * complete attachments, latest user message, preferred detailed catalog,
 * then older complete messages from newest to oldest.
 */
export function allocateConversationBudget<TAttachment, TMessage>(
  input: ConversationBudgetInput<TAttachment, TMessage>,
): ConversationBudgetResult<TAttachment, TMessage> {
  const estimate = input.estimateTokens ?? estimateConversationTokensConservatively
  const emptyCounts = makeCounts(0, 0, 0, 0, input, 0)
  if (!isNonNegativeInteger(input.contextWindowTokens) ||
      !isNonNegativeInteger(input.reservedOutputTokens) ||
      !isNonNegativeInteger(input.reservedExpansionTokens) ||
      input.reservedOutputTokens + input.reservedExpansionTokens > input.contextWindowTokens) {
    return { ok: false, error: 'invalid-budget', counts: emptyCounts }
  }

  const latestMatches = input.messages.filter(message =>
    message.turnId === input.latestUserTurnId && message.role === 'user')
  if (latestMatches.length === 0) return { ok: false, error: 'missing-latest-user-turn', counts: emptyCounts }
  if (latestMatches.length > 1) return { ok: false, error: 'duplicate-latest-user-message', counts: emptyCounts }

  const latestMessage = latestMatches[0]
  const latestIndex = input.messages.indexOf(latestMessage)
  // No future message can be part of the prompt for the current user turn.
  const eligibleMessages = input.messages.slice(0, latestIndex + 1)
  const fixedTokens = safeEstimate(estimate, input.fixedContextSerialized)
  const compactTokens = safeEstimate(estimate, input.compactCatalogSerialized)
  const detailedTokens = safeEstimate(estimate, input.detailedCatalogSerialized)
  const attachmentTokenCounts = input.attachments.map(item => safeEstimate(estimate, item.serialized))
  const messageTokenCounts = eligibleMessages.map(item => safeEstimate(estimate, item.serialized))
  if ([fixedTokens, compactTokens, detailedTokens, ...attachmentTokenCounts, ...messageTokenCounts]
    .some(tokens => tokens === null)) {
    return { ok: false, error: 'invalid-estimate', counts: emptyCounts }
  }

  const exactFixedTokens = fixedTokens as number
  const exactCompactTokens = compactTokens as number
  const exactDetailedTokens = detailedTokens as number
  const exactAttachmentTokens = attachmentTokenCounts as number[]
  const exactMessageTokens = messageTokenCounts as number[]
  const available = input.contextWindowTokens - input.reservedOutputTokens - input.reservedExpansionTokens
  const attachmentSum = sum(exactAttachmentTokens)
  const latestMessageTokens = exactMessageTokens[latestIndex]

  if (exactFixedTokens > available) {
    return failed('fixed-context-over-budget', exactFixedTokens, exactCompactTokens,
      attachmentSum, 0, input, available)
  }
  if (exactFixedTokens + exactCompactTokens > available) {
    return failed('compact-catalog-over-budget', exactFixedTokens, exactCompactTokens,
      attachmentSum, 0, input, available)
  }
  if (exactFixedTokens + exactCompactTokens + attachmentSum > available) {
    return failed('attachments-over-budget', exactFixedTokens, exactCompactTokens,
      attachmentSum, 0, input, available)
  }
  if (exactFixedTokens + exactCompactTokens + attachmentSum + latestMessageTokens > available) {
    return failed('latest-user-message-over-budget', exactFixedTokens, exactCompactTokens,
      attachmentSum, latestMessageTokens, input, available)
  }

  const detailedBase = exactFixedTokens + attachmentSum + latestMessageTokens
  const tier: ConversationBudgetTier = detailedBase + exactDetailedTokens <= available
    ? 'detailed'
    : 'compact'
  const catalogTokens = tier === 'detailed' ? exactDetailedTokens : exactCompactTokens
  let messageTokens = latestMessageTokens
  const selectedIndexes = new Set<number>([latestIndex])

  // Include the contiguous recent history suffix; never split or jump over a
  // too-large message to cherry-pick older content.
  for (let index = latestIndex - 1; index >= 0; index -= 1) {
    const candidate = eligibleMessages[index]
    if (candidate.role === 'user' && candidate.turnId === input.latestUserTurnId) continue
    const nextTotal = exactFixedTokens + catalogTokens + attachmentSum + messageTokens + exactMessageTokens[index]
    if (nextTotal > available) break
    selectedIndexes.add(index)
    messageTokens += exactMessageTokens[index]
  }

  const selectedMessages = eligibleMessages
    .filter((_, index) => selectedIndexes.has(index))
    .map(message => message.value)
  const selectedInputTokens = exactFixedTokens + catalogTokens + attachmentSum + messageTokens
  const counts = makeCounts(exactFixedTokens, catalogTokens, attachmentSum,
    messageTokens, input, available, selectedInputTokens)
  return {
    ok: true,
    tier,
    attachments: input.attachments.map(attachment => attachment.value),
    messages: selectedMessages,
    omittedMessageCount: eligibleMessages.length - selectedMessages.length,
    counts,
  }
}

function safeEstimate(estimate: (serialized: string) => number, serialized: string): number | null {
  try {
    const value = estimate(serialized)
    return Number.isFinite(value) && value >= 0 ? Math.ceil(value) : null
  } catch {
    return null
  }
}

function failed<TAttachment, TMessage>(
  error: ConversationBudgetFailureKind,
  fixedTokens: number,
  catalogTokens: number,
  attachmentTokens: number,
  messageTokens: number,
  input: ConversationBudgetInput<TAttachment, TMessage>,
  available: number,
): ConversationBudgetResult<TAttachment, TMessage> {
  return {
    ok: false,
    error,
    counts: makeCounts(fixedTokens, catalogTokens, attachmentTokens, messageTokens,
      input, available, fixedTokens + catalogTokens + attachmentTokens + messageTokens),
  }
}

function makeCounts<TAttachment, TMessage>(
  fixedContextTokens: number,
  catalogTokens: number,
  attachmentTokens: number,
  messageTokens: number,
  input: ConversationBudgetInput<TAttachment, TMessage>,
  availableInputTokens: number,
  estimatedInputTokens = fixedContextTokens + catalogTokens + attachmentTokens + messageTokens,
): ConversationBudgetCounts {
  const estimatedReservedTokens = input.reservedOutputTokens + input.reservedExpansionTokens
  return {
    fixedContextTokens,
    catalogTokens,
    attachmentTokens,
    messageTokens,
    reservedOutputTokens: input.reservedOutputTokens,
    reservedExpansionTokens: input.reservedExpansionTokens,
    estimatedInputTokens,
    estimatedReservedTokens,
    estimatedTotalTokens: estimatedInputTokens + estimatedReservedTokens,
    availableInputTokens,
    remainingInputTokens: availableInputTokens - estimatedInputTokens,
  }
}

function isNonNegativeInteger(value: number): boolean {
  return Number.isSafeInteger(value) && value >= 0
}

function sum(values: readonly number[]): number {
  return values.reduce((total, value) => total + value, 0)
}
