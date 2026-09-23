import type { CardDocument } from '../card/cardDocument'
import { cardDocumentRevision } from '../card/cardAiProposal'
import { isValidCardId } from '../card/cardValidation'
import {
  parseConversationCardDocument,
  parseConversationCardProposalInput,
  type ConversationCardProposalInput,
} from './conversationResponse'

export type ConversationCardProposalStatus =
  | 'pending'
  | 'accepted'
  | 'rejected'
  | 'stale'
  | 'superseded'
  | 'reverted'

export interface ConversationProposalSource {
  turnId: string
  attemptId: string
}

export interface ConversationProposalProjectReference {
  cardId: string
  revision: string
}

export interface ConversationProposalRejectionFeedback {
  code: string
  note: string | null
}

export type ConversationProposalEvent =
  | { id: string; type: 'proposed'; at: string }
  | { id: string; type: 'stale'; at: string; observedRevision: string | null }
  | { id: string; type: 'superseded'; at: string; byProposalId: string }
  | { id: string; type: 'accepted'; at: string; transactionId: string; finalCardId: string }
  | { id: string; type: 'rejected'; at: string; feedback: ConversationProposalRejectionFeedback | null }
  | { id: string; type: 'reverted'; at: string; transactionId: string; document: CardDocument }
  | { id: string; type: 'restored'; at: string; transactionId: string; document: CardDocument }
  | { id: string; type: 'committed'; at: string; transactionId: string; transitionEventId: string }

export interface ConversationCardProposal {
  id: string
  operation: 'create' | 'update'
  targetCardId: string
  baseRevision: string | null
  document: CardDocument
  status: ConversationCardProposalStatus
  provenance: ConversationProposalSource
  projectReferences: ConversationProposalProjectReference[]
  events: ConversationProposalEvent[]
  createdAt: string
  updatedAt: string
}

export type ConversationProposalLifecycleError =
  | 'invalid-proposal'
  | 'unaccepted-card-reference'
  | 'proposal-not-pending'
  | 'proposal-not-accepted'
  | 'proposal-not-reverted'
  | 'invalid-card-id'
  | 'duplicate-card-id'
  | 'transaction-mismatch'
  | 'transition-not-committed'

export interface PendingProposalCardTransition {
  eventId: string
  transactionId: string
  desiredDocument: CardDocument
  previousRevision: string | null
  allowMissing: boolean
}

export type ConversationProposalLifecycleResult<T> =
  | { ok: true; value: T }
  | { ok: false; error: ConversationProposalLifecycleError }

export function recordConversationCardProposalBatch(
  existing: readonly ConversationCardProposal[],
  drafts: readonly ConversationCardProposalInput[],
  options: {
    source: ConversationProposalSource
    at: string
    currentCardRevisions: ReadonlyMap<string, string>
    createId: () => string
  },
): ConversationProposalLifecycleResult<ConversationCardProposal[]> {
  if (!isTimestamp(options.at) || !isNonEmptyString(options.source.turnId) || !isNonEmptyString(options.source.attemptId)) {
    return failure('invalid-proposal')
  }
  const currentRevisions = normalizedRevisionMap(options.currentCardRevisions)
  const draftTargets = new Set<string>()
  for (const draft of drafts) {
    const target = normalizeCardId(draft.operation === 'update' ? draft.targetCardId : draft.document.card.id)
    if (draftTargets.has(target)) return failure('invalid-proposal')
    draftTargets.add(target)
  }
  if (!referencesOnlyAcceptedCards(existing, drafts, currentRevisions)) {
    return failure('unaccepted-card-reference')
  }

  const created = drafts.map(draft => {
    const proposalId = options.createId()
    const proposed: ConversationProposalEvent = { id: options.createId(), type: 'proposed', at: options.at }
    const targetCardId = draft.operation === 'update' ? draft.targetCardId : draft.document.card.id
    const baseRevision = draft.operation === 'update' ? draft.baseRevision : null
    const self = normalizeCardId(targetCardId)
    const projectReferences = [...new Map(referencedCardIds(draft.document)
      .filter(cardId => normalizeCardId(cardId) !== self)
      .map(cardId => [normalizeCardId(cardId), {
        cardId,
        revision: currentRevisions.get(normalizeCardId(cardId))!,
      }])).values()]
    return {
      id: proposalId,
      operation: draft.operation,
      targetCardId,
      baseRevision,
      document: draft.document,
      status: 'pending' as const,
      provenance: { ...options.source },
      projectReferences,
      events: [proposed] as ConversationProposalEvent[],
      createdAt: options.at,
      updatedAt: options.at,
    }
  }).map(proposal => {
    const currentRevision = proposal.operation === 'update'
      ? currentRevisions.get(normalizeCardId(proposal.targetCardId)) ?? null
      : null
    const stale = proposal.operation === 'update' && currentRevision !== proposal.baseRevision
    return stale
      ? appendEvent(proposal, {
          id: options.createId(),
          type: 'stale',
          at: options.at,
          observedRevision: currentRevision,
        }, 'stale')
      : proposal
  })

  const pendingTargets = new Map<string, ConversationCardProposal>()
  for (const proposal of created) {
    if (proposal.status === 'pending') pendingTargets.set(proposalTargetKey(proposal), proposal)
  }
  const refreshed = existing.map(proposal => {
    if (proposal.status !== 'pending' || proposal.operation !== 'update') return proposal
    const observedRevision = currentRevisions.get(normalizeCardId(proposal.targetCardId)) ?? null
    if (observedRevision === proposal.baseRevision) return proposal
    return appendEvent(proposal, {
      id: options.createId(),
      type: 'stale',
      at: options.at,
      observedRevision,
    }, 'stale')
  })
  const previous = refreshed.map(proposal => {
    if (proposal.status !== 'pending') return proposal
    const replacement = pendingTargets.get(proposalTargetKey(proposal))
    if (!replacement) return proposal
    return appendEvent(proposal, {
      id: options.createId(),
      type: 'superseded',
      at: options.at,
      byProposalId: replacement.id,
    }, 'superseded')
  })
  return success([...previous, ...created])
}

export function acceptConversationCardProposal(
  proposal: ConversationCardProposal,
  options: {
    at: string
    eventId: string
    transactionId: string
    finalCardId: string
    currentCardRevisions: ReadonlyMap<string, string>
  },
): ConversationProposalLifecycleResult<ConversationCardProposal> {
  if (proposal.status !== 'pending') return failure('proposal-not-pending')
  if (!isNonEmptyString(options.transactionId) || !isValidNewEvent(proposal, options.at, options.eventId)) {
    return failure('invalid-proposal')
  }
  const finalCardId = options.finalCardId.trim()
  if (!isValidCardId(finalCardId)) return failure('invalid-card-id')
  const revisions = normalizedRevisionMap(options.currentCardRevisions)
  if (proposal.operation === 'create') {
    if (revisions.has(normalizeCardId(finalCardId))) return failure('duplicate-card-id')
  } else {
    const currentRevision = revisions.get(normalizeCardId(proposal.targetCardId))
    if (currentRevision !== proposal.baseRevision || finalCardId !== proposal.targetCardId) {
      return failure('proposal-not-pending')
    }
  }
  return success(appendEvent(proposal, {
    id: options.eventId,
    type: 'accepted',
    at: options.at,
    transactionId: options.transactionId,
    finalCardId,
  }, 'accepted'))
}

export function rejectConversationCardProposal(
  proposal: ConversationCardProposal,
  options: { at: string; eventId: string; feedback: ConversationProposalRejectionFeedback | null },
): ConversationProposalLifecycleResult<ConversationCardProposal> {
  if (proposal.status !== 'pending') return failure('proposal-not-pending')
  if (!isValidNewEvent(proposal, options.at, options.eventId) || !validFeedback(options.feedback)) {
    return failure('invalid-proposal')
  }
  return success(appendEvent(proposal, {
    id: options.eventId,
    type: 'rejected',
    at: options.at,
    feedback: options.feedback
      ? { code: options.feedback.code.trim(), note: normalizeNote(options.feedback.note) }
      : null,
  }, 'rejected'))
}

export function markConversationCardProposalStale(
  proposal: ConversationCardProposal,
  options: { at: string; eventId: string; observedRevision: string | null },
): ConversationProposalLifecycleResult<ConversationCardProposal> {
  if (proposal.status !== 'pending' || proposal.operation !== 'update') return failure('proposal-not-pending')
  if (!isValidNewEvent(proposal, options.at, options.eventId)) return failure('invalid-proposal')
  return success(appendEvent(proposal, {
    id: options.eventId,
    type: 'stale',
    at: options.at,
    observedRevision: options.observedRevision,
  }, 'stale'))
}

export function markConversationCardProposalReverted(
  proposal: ConversationCardProposal,
  options: { at: string; eventId: string; transactionId: string; document: CardDocument },
): ConversationProposalLifecycleResult<ConversationCardProposal> {
  if (proposal.status !== 'accepted') return failure('proposal-not-accepted')
  if (!matchesAcceptedTransaction(proposal, options.transactionId)) return failure('transaction-mismatch')
  if (pendingProposalCardTransition(proposal)) return failure('transition-not-committed')
  if (!isValidTransitionDocument(proposal, options.document, proposal.baseRevision)) return failure('invalid-proposal')
  if (!isValidNewEvent(proposal, options.at, options.eventId)) return failure('invalid-proposal')
  return success(appendEvent(proposal, {
    id: options.eventId,
    type: 'reverted',
    at: options.at,
    transactionId: options.transactionId,
    document: options.document,
  }, 'reverted'))
}

export function restoreConversationCardProposalAfterRedo(
  proposal: ConversationCardProposal,
  options: { at: string; eventId: string; transactionId: string; document: CardDocument },
): ConversationProposalLifecycleResult<ConversationCardProposal> {
  if (proposal.status !== 'reverted') return failure('proposal-not-reverted')
  if (!matchesAcceptedTransaction(proposal, options.transactionId)) return failure('transaction-mismatch')
  if (pendingProposalCardTransition(proposal)) return failure('transition-not-committed')
  if (!isValidTransitionDocument(proposal, options.document, cardDocumentRevision(proposal.document))) {
    return failure('invalid-proposal')
  }
  if (!isValidNewEvent(proposal, options.at, options.eventId)) return failure('invalid-proposal')
  return success(appendEvent(proposal, {
    id: options.eventId,
    type: 'restored',
    at: options.at,
    transactionId: options.transactionId,
    document: options.document,
  }, 'accepted'))
}

/**
 * 返回最后一条尚未兑现到 CardDocument 的 transition。对话文档先落 WAL，
 * application 层完成 Card 持久化后再追加 committed，崩溃重启即可安全续做。
 */
export function pendingProposalCardTransition(
  proposal: ConversationCardProposal,
): PendingProposalCardTransition | null {
  const event = proposal.events.at(-1)
  if (!event || !isCardTransitionEvent(event)) return null
  if (event.type === 'accepted') {
    return {
      eventId: event.id,
      transactionId: event.transactionId,
      desiredDocument: proposal.document,
      previousRevision: proposal.operation === 'create' ? null : proposal.baseRevision,
      allowMissing: proposal.operation === 'create',
    }
  }
  return {
    eventId: event.id,
    transactionId: event.transactionId,
    desiredDocument: event.document,
    previousRevision: event.type === 'reverted'
      ? cardDocumentRevision(proposal.document)
      : proposal.baseRevision,
    allowMissing: false,
  }
}

export function markConversationProposalTransitionCommitted(
  proposal: ConversationCardProposal,
  options: { at: string; eventId: string; transitionEventId: string; transactionId: string },
): ConversationProposalLifecycleResult<ConversationCardProposal> {
  const pending = pendingProposalCardTransition(proposal)
  if (!pending) return failure('invalid-proposal')
  if (pending.eventId !== options.transitionEventId || pending.transactionId !== options.transactionId) {
    return failure('transaction-mismatch')
  }
  if (!isValidNewEvent(proposal, options.at, options.eventId)) return failure('invalid-proposal')
  return success(appendEvent(proposal, {
    id: options.eventId,
    type: 'committed',
    at: options.at,
    transactionId: options.transactionId,
    transitionEventId: options.transitionEventId,
  }, proposal.status))
}

export function parseConversationCardProposal(input: unknown): ConversationCardProposal | null {
  if (!isRecord(input) || !hasExactKeys(input, PROPOSAL_KEYS) || !isNonEmptyString(input.id) ||
    (input.operation !== 'create' && input.operation !== 'update') || !isNonEmptyString(input.targetCardId) ||
    !(input.baseRevision === null || isNonEmptyString(input.baseRevision)) ||
    !PROPOSAL_STATUSES.includes(input.status as ConversationCardProposalStatus) || !isSource(input.provenance) ||
    !isProjectReferences(input.projectReferences) ||
    !Array.isArray(input.events) || input.events.length === 0 || !isTimestamp(input.createdAt) || !isTimestamp(input.updatedAt)) return null
  const draft = input.operation === 'create'
    ? { operation: 'create' as const, document: input.document }
    : {
        operation: 'update' as const,
        targetCardId: input.targetCardId,
        baseRevision: input.baseRevision,
        document: input.document,
      }
  const parsedDraft = parseConversationCardProposalInput(draft)
  if (!parsedDraft.ok) return null
  if (input.operation === 'create' && (input.baseRevision !== null || parsedDraft.value.document.card.id !== input.targetCardId)) return null
  if (input.operation === 'update' && input.baseRevision === null) return null
  const events = input.events.map(parseEvent)
  if (events.some(event => event === null)) return null
  const typedEvents = events as ConversationProposalEvent[]
  if (new Set(typedEvents.map(event => event.id)).size !== typedEvents.length || typedEvents[0].type !== 'proposed') return null
  if (typedEvents.some((event, index) => index > 0 && Date.parse(event.at) < Date.parse(typedEvents[index - 1].at))) return null
  if (input.operation === 'update' && typedEvents.some(event =>
    event.type === 'accepted' && event.finalCardId !== input.targetCardId)) return null
  const derived = statusAfterEvents(typedEvents)
  if (!derived || derived !== input.status) return null
  const proposal: ConversationCardProposal = {
    id: input.id,
    operation: input.operation,
    targetCardId: input.targetCardId,
    baseRevision: input.baseRevision,
    document: parsedDraft.value.document,
    status: input.status as ConversationCardProposalStatus,
    provenance: { ...input.provenance } as ConversationProposalSource,
    projectReferences: input.projectReferences as ConversationProposalProjectReference[],
    events: typedEvents,
    createdAt: input.createdAt,
    updatedAt: input.updatedAt,
  }
  if (!hasValidTransitionDocuments(proposal)) return null
  return proposal
}

const PROPOSAL_KEYS = ['baseRevision', 'createdAt', 'document', 'events', 'id', 'operation', 'projectReferences', 'provenance', 'status', 'targetCardId', 'updatedAt']
const SOURCE_KEYS = ['attemptId', 'turnId']
const PROPOSAL_STATUSES: readonly ConversationCardProposalStatus[] = ['pending', 'accepted', 'rejected', 'stale', 'superseded', 'reverted']

function parseEvent(input: unknown): ConversationProposalEvent | null {
  if (!isRecord(input) || !isNonEmptyString(input.id) || !isTimestamp(input.at) || typeof input.type !== 'string') return null
  if (input.type === 'proposed' && hasExactKeys(input, ['at', 'id', 'type'])) return input as unknown as ConversationProposalEvent
  if (input.type === 'stale' && hasExactKeys(input, ['at', 'id', 'observedRevision', 'type']) &&
    (input.observedRevision === null || isNonEmptyString(input.observedRevision))) return input as unknown as ConversationProposalEvent
  if (input.type === 'superseded' && hasExactKeys(input, ['at', 'byProposalId', 'id', 'type']) && isNonEmptyString(input.byProposalId)) {
    return input as unknown as ConversationProposalEvent
  }
  if (input.type === 'accepted' && hasExactKeys(input, ['at', 'finalCardId', 'id', 'transactionId', 'type']) &&
    isValidCardId(input.finalCardId) && isNonEmptyString(input.transactionId)) return input as unknown as ConversationProposalEvent
  if (input.type === 'rejected' && hasExactKeys(input, ['at', 'feedback', 'id', 'type']) && validFeedback(input.feedback)) {
    return input as unknown as ConversationProposalEvent
  }
  if ((input.type === 'reverted' || input.type === 'restored') &&
    hasExactKeys(input, ['at', 'document', 'id', 'transactionId', 'type']) && isNonEmptyString(input.transactionId)) {
    const document = parseStrictTransitionDocument(input.document)
    if (!document) return null
    return {
      id: input.id,
      type: input.type,
      at: input.at,
      transactionId: input.transactionId,
      document,
    }
  }
  if (input.type === 'committed' &&
    hasExactKeys(input, ['at', 'id', 'transactionId', 'transitionEventId', 'type']) &&
    isNonEmptyString(input.transactionId) && isNonEmptyString(input.transitionEventId)) {
    return input as unknown as ConversationProposalEvent
  }
  return null
}

function statusAfterEvents(events: readonly ConversationProposalEvent[]): ConversationCardProposalStatus | null {
  let status: ConversationCardProposalStatus = 'pending'
  let transactionId: string | null = null
  let pendingTransition: Extract<ConversationProposalEvent, { type: 'accepted' | 'reverted' | 'restored' }> | null = null
  for (const [index, event] of events.entries()) {
    if (index === 0) {
      if (event.type !== 'proposed') return null
      continue
    }
    if (pendingTransition) {
      if (event.type !== 'committed' || event.transitionEventId !== pendingTransition.id ||
        event.transactionId !== pendingTransition.transactionId) return null
      pendingTransition = null
      continue
    }
    if (event.type === 'committed') return null
    if (status === 'pending' && event.type === 'stale') status = 'stale'
    else if (status === 'pending' && event.type === 'superseded') status = 'superseded'
    else if (status === 'pending' && event.type === 'accepted') {
      status = 'accepted'
      transactionId = event.transactionId
      pendingTransition = event
    }
    else if (status === 'pending' && event.type === 'rejected') status = 'rejected'
    else if (status === 'accepted' && event.type === 'reverted' && event.transactionId === transactionId) {
      status = 'reverted'
      pendingTransition = event
    }
    else if (status === 'reverted' && event.type === 'restored' && event.transactionId === transactionId) {
      status = 'accepted'
      pendingTransition = event
    }
    else return null
  }
  return status
}

function referencesOnlyAcceptedCards(
  existing: readonly ConversationCardProposal[],
  drafts: readonly ConversationCardProposalInput[],
  currentRevisions: ReadonlyMap<string, string>,
): boolean {
  const accepted = new Set(currentRevisions.keys())
  const unacceptedCreates = new Set<string>()
  for (const proposal of existing) {
    const target = normalizeCardId(proposal.targetCardId)
    if (proposal.operation === 'create' && proposal.status === 'pending' && !accepted.has(target)) {
      unacceptedCreates.add(target)
    }
  }
  for (const draft of drafts) {
    const target = normalizeCardId(draft.document.card.id)
    if (draft.operation === 'create' && !accepted.has(target)) unacceptedCreates.add(target)
  }
  for (const draft of drafts) {
    const self = normalizeCardId(draft.operation === 'update' ? draft.targetCardId : draft.document.card.id)
    for (const reference of referencedCardIds(draft.document)) {
      const normalized = normalizeCardId(reference)
      if (normalized === self) continue
      if (unacceptedCreates.has(normalized) || !accepted.has(normalized)) return false
    }
  }
  return true
}

export function referencedCardIds(document: CardDocument): string[] {
  return document.graph.nodes.flatMap(node => {
    const kind = node.data.kind
    return (kind === 'addCardToHand' || kind === 'addCardToDeck') && isNonEmptyString(node.data.cardId)
      ? [node.data.cardId]
      : []
  })
}

function appendEvent(
  proposal: ConversationCardProposal,
  event: ConversationProposalEvent,
  status: ConversationCardProposalStatus,
): ConversationCardProposal {
  return { ...proposal, status, events: [...proposal.events, event], updatedAt: event.at }
}

function matchesAcceptedTransaction(proposal: ConversationCardProposal, transactionId: string): boolean {
  if (!isNonEmptyString(transactionId)) return false
  const accepted = [...proposal.events].reverse().find(event => event.type === 'accepted')
  return accepted?.type === 'accepted' && accepted.transactionId === transactionId
}

function isValidNewEvent(proposal: ConversationCardProposal, at: string, eventId: string): boolean {
  if (!isTimestamp(at) || !isNonEmptyString(eventId) || proposal.id === eventId ||
    proposal.events.some(event => event.id === eventId)) return false
  const previous = proposal.events.at(-1)
  return !previous || Date.parse(at) >= Date.parse(previous.at)
}

function isCardTransitionEvent(
  event: ConversationProposalEvent,
): event is Extract<ConversationProposalEvent, { type: 'accepted' | 'reverted' | 'restored' }> {
  return event.type === 'accepted' || event.type === 'reverted' || event.type === 'restored'
}

function parseStrictTransitionDocument(input: unknown): CardDocument | null {
  const parsed = parseConversationCardDocument(input)
  return parsed.ok ? parsed.value : null
}

function isValidTransitionDocument(
  proposal: ConversationCardProposal,
  input: CardDocument,
  expectedRevision: string | null,
): boolean {
  if (proposal.operation !== 'update' || expectedRevision === null) return false
  const parsed = parseStrictTransitionDocument(input)
  return Boolean(parsed && parsed.card.id === proposal.targetCardId &&
    cardDocumentRevision(parsed) === expectedRevision)
}

function hasValidTransitionDocuments(proposal: ConversationCardProposal): boolean {
  for (const event of proposal.events) {
    if (event.type !== 'reverted' && event.type !== 'restored') continue
    const expectedRevision = event.type === 'reverted'
      ? proposal.baseRevision
      : cardDocumentRevision(proposal.document)
    if (!isValidTransitionDocument(proposal, event.document, expectedRevision)) return false
  }
  return true
}

function proposalTargetKey(proposal: Pick<ConversationCardProposal, 'operation' | 'targetCardId'>): string {
  return `${proposal.operation}:${normalizeCardId(proposal.targetCardId)}`
}

function normalizedRevisionMap(input: ReadonlyMap<string, string>): Map<string, string> {
  return new Map([...input].map(([id, revision]) => [normalizeCardId(id), revision]))
}

function normalizeCardId(cardId: string): string {
  return cardId.toLowerCase()
}

function validFeedback(input: unknown): input is ConversationProposalRejectionFeedback | null {
  if (input === null) return true
  return isRecord(input) && hasExactKeys(input, ['code', 'note']) && isNonEmptyString(input.code) &&
    (input.note === null || (typeof input.note === 'string' && input.note.length <= 500))
}

function normalizeNote(note: string | null): string | null {
  if (note === null) return null
  return note.trim() || null
}

function isSource(input: unknown): input is ConversationProposalSource {
  return isRecord(input) && hasExactKeys(input, SOURCE_KEYS) && isNonEmptyString(input.turnId) && isNonEmptyString(input.attemptId)
}

function isProjectReferences(input: unknown): input is ConversationProposalProjectReference[] {
  if (!Array.isArray(input)) return false
  const ids = new Set<string>()
  for (const reference of input) {
    if (!isRecord(reference) || !hasExactKeys(reference, ['cardId', 'revision']) ||
      !isNonEmptyString(reference.cardId) || !isNonEmptyString(reference.revision)) return false
    const normalized = normalizeCardId(reference.cardId)
    if (ids.has(normalized)) return false
    ids.add(normalized)
  }
  return true
}

function isRecord(input: unknown): input is Record<string, unknown> {
  return Boolean(input) && typeof input === 'object' && !Array.isArray(input)
}

function hasExactKeys(input: Record<string, unknown>, expected: readonly string[]): boolean {
  const keys = Object.keys(input).sort()
  return keys.length === expected.length && keys.every((key, index) => key === expected[index])
}

function isNonEmptyString(input: unknown): input is string {
  return typeof input === 'string' && input.trim().length > 0
}

function isTimestamp(input: unknown): input is string {
  return isNonEmptyString(input) && !Number.isNaN(Date.parse(input))
}

function success<T>(value: T): ConversationProposalLifecycleResult<T> {
  return { ok: true, value }
}

function failure(error: ConversationProposalLifecycleError): ConversationProposalLifecycleResult<never> {
  return { ok: false, error }
}
