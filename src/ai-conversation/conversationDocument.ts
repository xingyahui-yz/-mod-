import type { ConversationQuickReply } from './conversationResponse'
import {
  parseConversationCardProposal,
  referencedCardIds,
  type ConversationCardProposal,
} from './proposalLifecycle'

export type ConversationAttemptStatus = 'running' | 'completed' | 'failed' | 'cancelled' | 'interrupted'
export type ConversationAttemptFailureKind = 'cancelled' | 'timeout' | 'provider' | 'invalid-response' | 'persistence' | 'interrupted'

export interface ConversationAttachment {
  cardId: string
  revision: string
}

export interface ConversationQuickReplySelection {
  turnId: string
  replyId: string
}

export interface ConversationAttemptDiagnostics {
  provider: string
  model: string
  requestId: string
}

export interface ConversationAttempt {
  id: string
  status: ConversationAttemptStatus
  startedAt: string
  finishedAt: string | null
  error: string | null
  failureKind: ConversationAttemptFailureKind | null
  diagnostics: ConversationAttemptDiagnostics
}

export interface ConversationContextSnapshot {
  directoryTier: 'detailed' | 'compact'
  contextWindowTokens: number
  reservedOutputTokens: number
  reservedExpansionTokens: number
  estimatedInputTokens: number
  estimatedTotalTokens: number
  omittedMessageCount: number
  includedTurnIds: string[]
  providedCards: { cardId: string; revision: string; source: 'explicit' | 'expanded' }[]
}

export interface ConversationTurn {
  id: string
  userText: string
  assistantText: string | null
  quickReplies: ConversationQuickReply[]
  quickReplySelection: ConversationQuickReplySelection | null
  attachments: ConversationAttachment[]
  attempts: ConversationAttempt[]
  createdAt: string
  contextSnapshot: ConversationContextSnapshot | null
}

export interface ConversationRollingSummaryV1 {
  throughTurnId: string
  text: string
  updatedAt: string
}

export interface ConversationDocumentV4 {
  schemaVersion: 4
  rollingSummary: ConversationRollingSummaryV1 | null
  turns: ConversationTurn[]
  proposals: ConversationCardProposal[]
  createdAt: string
  updatedAt: string
}

/** The only writable conversation document shape. Older versions exist only at the migration boundary. */
export type ConversationDocument = ConversationDocumentV4

export type ConversationDocumentParseResult =
  | { ok: true; document: ConversationDocument }
  | { ok: false; reason: string; raw: unknown }

export type ConversationDocumentMigrationResult =
  | { ok: true; document: ConversationDocument; migrated: boolean }
  | { ok: false; reason: string; raw: unknown }

const DOCUMENT_KEYS = ['createdAt', 'proposals', 'rollingSummary', 'schemaVersion', 'turns', 'updatedAt']
const DOCUMENT_V3_KEYS = ['createdAt', 'proposals', 'schemaVersion', 'turns', 'updatedAt']
const DOCUMENT_V2_KEYS = ['createdAt', 'proposals', 'schemaVersion', 'turns', 'updatedAt']
const V1_DOCUMENT_KEYS = ['createdAt', 'schemaVersion', 'turns', 'updatedAt']
const LEGACY_DOCUMENT_KEYS = ['createdAt', 'projectPath', 'schemaVersion', 'turns', 'updatedAt']
const TURN_KEYS = ['assistantText', 'attachments', 'attempts', 'contextSnapshot', 'createdAt', 'id', 'quickReplies', 'quickReplySelection', 'userText']
const TURN_V2_KEYS = ['assistantText', 'attachments', 'attempts', 'createdAt', 'id', 'quickReplies', 'quickReplySelection', 'userText']
const LEGACY_TURN_KEYS = ['assistantText', 'attachments', 'attempts', 'createdAt', 'id', 'quickReplies', 'userText']
const ATTEMPT_KEYS = ['diagnostics', 'error', 'failureKind', 'finishedAt', 'id', 'startedAt', 'status']
const LEGACY_ATTEMPT_KEYS = ['error', 'finishedAt', 'id', 'startedAt', 'status']
const LEGACY_ATTEMPT_WITH_KIND_KEYS = [...LEGACY_ATTEMPT_KEYS, 'failureKind'].sort()
const DIAGNOSTIC_KEYS = ['model', 'provider', 'requestId']
const ATTACHMENT_KEYS = ['cardId', 'revision']
const QUICK_REPLY_KEYS = ['id', 'label']
const QUICK_REPLY_SELECTION_KEYS = ['replyId', 'turnId']
const ATTEMPT_STATUSES: readonly ConversationAttemptStatus[] = ['running', 'completed', 'failed', 'cancelled', 'interrupted']
const FAILURE_KINDS: readonly ConversationAttemptFailureKind[] = ['cancelled', 'timeout', 'provider', 'invalid-response', 'persistence', 'interrupted']
const MAX_PERSISTED_ERROR_LENGTH = 500
export const CURRENT_CONVERSATION_SCHEMA_VERSION = 4
export const MAX_ROLLING_SUMMARY_CODE_POINTS = 12000

export function createConversationDocument(now: string): ConversationDocument {
  return { schemaVersion: 4, turns: [], proposals: [], rollingSummary: null, createdAt: now, updatedAt: now }
}

export function parseConversationDocument(raw: unknown): ConversationDocumentParseResult {
  if (!isRecord(raw)) return invalid('文档必须是对象', raw)
  if (Object.prototype.hasOwnProperty.call(raw, 'schemaVersion') && raw.schemaVersion !== 4) {
    return invalid('不支持的 schemaVersion', raw)
  }
  if (!hasExactKeys(raw, DOCUMENT_KEYS)) return invalid('文档包含缺失或未知字段', raw)
  if (!Array.isArray(raw.turns) || !Array.isArray(raw.proposals) ||
    !isTimestamp(raw.createdAt) || !isTimestamp(raw.updatedAt) ||
    !(raw.rollingSummary === null || isRollingSummary(raw.rollingSummary))) return invalid('文档字段无效', raw)

  const turnsResult = parseTurns(raw.turns, raw)
  if (!turnsResult.ok) return turnsResult

  const rollingSummary = raw.rollingSummary as ConversationRollingSummaryV1 | null
  if (rollingSummary !== null) {
    const throughTurn = turnsResult.turns.find(turn => turn.id === rollingSummary.throughTurnId)
    const completedAt = throughTurn?.attempts[throughTurn.attempts.length - 1].finishedAt
    if (!throughTurn || throughTurn.attempts[throughTurn.attempts.length - 1].status !== 'completed' ||
      !completedAt || Date.parse(rollingSummary.updatedAt) < Date.parse(completedAt)) {
      return invalid('rollingSummary 必须引用已完成且不晚于摘要时间的轮次', raw)
    }
  }
  for (const [turnIndex, turn] of turnsResult.turns.entries()) {
    const snapshot = turn.contextSnapshot
    if (!snapshot) continue
    let previousIndex = -1
    for (const includedTurnId of snapshot.includedTurnIds) {
      const includedIndex = turnsResult.turns.findIndex(candidate => candidate.id === includedTurnId)
      if (includedIndex < 0 || includedIndex > turnIndex || includedIndex <= previousIndex) {
        return invalid('contextSnapshot.includedTurnIds 必须按文档顺序引用当前及此前轮次', raw)
      }
      previousIndex = includedIndex
    }
    if (snapshot.includedTurnIds[snapshot.includedTurnIds.length - 1] !== turn.id) {
      return invalid('contextSnapshot.includedTurnIds 必须以当前轮次结束', raw)
    }
  }

  const proposals: ConversationCardProposal[] = []
  const proposalAndEventIds = new Set<string>()
  const pendingProposalTargets = new Set<string>()
  for (const inputProposal of raw.proposals) {
    const proposal = parseConversationCardProposal(inputProposal)
    if (!proposal) return invalid('Card 提案或事件字段无效', raw)
    if (proposalAndEventIds.has(proposal.id)) return invalid('提案和事件 ID 必须在文档内全局唯一', raw)
    proposalAndEventIds.add(proposal.id)
    for (const event of proposal.events) {
      if (proposalAndEventIds.has(event.id)) return invalid('提案和事件 ID 必须在文档内全局唯一', raw)
      proposalAndEventIds.add(event.id)
    }
    if (proposal.events[0].at !== proposal.createdAt ||
      proposal.events[proposal.events.length - 1].at !== proposal.updatedAt) {
      return invalid('提案时间与事件历史不一致', raw)
    }
    if (!hasValidProposalTransactions(proposal)) return invalid('提案事务历史无效', raw)
    if (proposal.status === 'pending') {
      const targetKey = proposalTargetKey(proposal)
      if (pendingProposalTargets.has(targetKey)) {
        return invalid('同操作、同目标只能有一个 pending 提案', raw)
      }
      pendingProposalTargets.add(targetKey)
    }
    proposals.push(proposal)
  }

  const proposalsById = new Map(proposals.map(proposal => [proposal.id, proposal]))
  if (!hasValidProjectReferences(proposals)) {
    return invalid('提案的项目 Card 引用验证记录无效', raw)
  }
  for (const proposal of proposals) {
    const sourceTurn = turnsResult.turns.find(turn => turn.id === proposal.provenance.turnId)
    const sourceAttempt = sourceTurn?.attempts.find(attempt => attempt.id === proposal.provenance.attemptId)
    if (!sourceAttempt || sourceAttempt.status !== 'completed') {
      return invalid('提案 provenance 必须引用同一轮次中已完成的 attempt', raw)
    }
    for (const event of proposal.events) {
      if (event.type !== 'superseded') continue
      const replacement = proposalsById.get(event.byProposalId)
      if (!replacement || replacement.id === proposal.id || proposalTargetKey(replacement) !== proposalTargetKey(proposal) ||
        Date.parse(replacement.createdAt) < Date.parse(proposal.createdAt) ||
        Date.parse(replacement.createdAt) > Date.parse(event.at)) {
        return invalid('superseded 事件引用无效', raw)
      }
    }
  }
  if (hasSupersededCycle(proposalsById)) return invalid('superseded 事件引用形成循环', raw)

  return {
    ok: true,
    document: {
      schemaVersion: 4,
      turns: turnsResult.turns,
      rollingSummary: raw.rollingSummary as ConversationRollingSummaryV1 | null,
      proposals,
      createdAt: raw.createdAt,
      updatedAt: raw.updatedAt,
    },
  }
}

/** Migrate strict v1/v2/v3 and the released legacy v1 envelope into the current v4 shape. */
export function migrateConversationDocument(raw: unknown): ConversationDocumentMigrationResult {
  const current = parseConversationDocument(raw)
  if (current.ok) return { ...current, migrated: false }
  if (isRecord(raw) && raw.schemaVersion === 3 && Array.isArray(raw.turns) && hasExactKeys(raw, DOCUMENT_V3_KEYS)) {
    if (!raw.turns.every(inputTurn => isRecord(inputTurn) && hasExactKeys(inputTurn, TURN_KEYS))) return current
    const strictV3Candidate: unknown = { ...raw, schemaVersion: 4, rollingSummary: null, turns: raw.turns.map(inputTurn => {
      const turn = inputTurn as Record<string, unknown>
      const snapshot = turn.contextSnapshot
      return { ...turn, contextSnapshot: snapshot === null ? null : { ...(snapshot as Record<string, unknown>), providedCards: [] } }
    }) }
    const parsed = parseConversationDocument(strictV3Candidate)
    return parsed.ok ? { ...parsed, migrated: true } : current
  }
  if (isRecord(raw) && raw.schemaVersion === 2 && Array.isArray(raw.turns) && hasExactKeys(raw, DOCUMENT_V2_KEYS)) {
    if (!raw.turns.every(inputTurn => isRecord(inputTurn) && hasExactKeys(inputTurn, TURN_V2_KEYS))) return current
    const strictV2Candidate: unknown = { ...raw, schemaVersion: 4, rollingSummary: null, turns: raw.turns.map(inputTurn => ({ ...(inputTurn as Record<string, unknown>), contextSnapshot: null })) }
    const parsed = parseConversationDocument(strictV2Candidate)
    if (parsed.ok) return { ...parsed, migrated: true }
    return current
  }
  if (!isRecord(raw) || raw.schemaVersion !== 1 || !Array.isArray(raw.turns)) return current

  if (hasExactKeys(raw, V1_DOCUMENT_KEYS) && raw.turns.every(inputTurn => isRecord(inputTurn) && hasExactKeys(inputTurn, TURN_V2_KEYS))) {
    const strictV1Candidate: unknown = { ...raw, schemaVersion: 4, proposals: [], rollingSummary: null, turns: raw.turns.map(inputTurn => ({ ...(inputTurn as Record<string, unknown>), contextSnapshot: null })) }
    const parsed = parseConversationDocument(strictV1Candidate)
    if (parsed.ok) return { ...parsed, migrated: true }
  }

  if (!(hasExactKeys(raw, LEGACY_DOCUMENT_KEYS) || hasExactKeys(raw, V1_DOCUMENT_KEYS))) return current
  if (Object.prototype.hasOwnProperty.call(raw, 'projectPath') && !isNonEmptyString(raw.projectPath)) return current

  const migratedTurns: ConversationTurn[] = []
  for (const inputTurn of raw.turns) {
    if (!isRecord(inputTurn) || !hasExactKeys(inputTurn, LEGACY_TURN_KEYS) || !Array.isArray(inputTurn.attempts)) return current
    const attempts: ConversationAttempt[] = []
    for (const inputAttempt of inputTurn.attempts) {
      if (!isRecord(inputAttempt) ||
        !(hasExactKeys(inputAttempt, LEGACY_ATTEMPT_KEYS) || hasExactKeys(inputAttempt, LEGACY_ATTEMPT_WITH_KIND_KEYS))) return current
      if (!(inputAttempt.error === null || typeof inputAttempt.error === 'string')) return current
      if (Object.prototype.hasOwnProperty.call(inputAttempt, 'failureKind') &&
        !(inputAttempt.failureKind === null || FAILURE_KINDS.includes(inputAttempt.failureKind as ConversationAttemptFailureKind))) return current
      attempts.push({
        id: inputAttempt.id as string,
        status: inputAttempt.status as ConversationAttemptStatus,
        startedAt: inputAttempt.startedAt as string,
        finishedAt: inputAttempt.finishedAt as string | null,
        error: inputAttempt.error === null ? null : sanitizeConversationError(inputAttempt.error),
        failureKind: inferLegacyFailureKind(inputAttempt),
        diagnostics: unknownDiagnostics(),
      })
    }
    const { id, userText, assistantText, quickReplies, attachments, createdAt } = inputTurn
    migratedTurns.push({
      id: id as string,
      userText: userText as string,
      assistantText: assistantText as string | null,
      quickReplies: quickReplies as ConversationQuickReply[],
      quickReplySelection: null,
      attachments: attachments as ConversationAttachment[],
      attempts,
      createdAt: createdAt as string,
      contextSnapshot: null,
    })
  }
  const migrated: unknown = {
    schemaVersion: 4,
    turns: migratedTurns,
    proposals: [],
    rollingSummary: null,
    createdAt: raw.createdAt,
    updatedAt: raw.updatedAt,
  }
  const parsed = parseConversationDocument(migrated)
  return parsed.ok ? { ...parsed, migrated: true } : parsed
}

export function interruptRunningAttempts(document: ConversationDocument, now: string): ConversationDocument {
  let changed = false
  const turns = document.turns.map(turn => ({
    ...turn,
    attempts: turn.attempts.map(attempt => {
      if (attempt.status !== 'running') return attempt
      changed = true
      return {
        ...attempt,
        status: 'interrupted' as const,
        finishedAt: now,
        error: '应用在响应完成前中断',
        failureKind: 'interrupted' as const,
      }
    }),
  }))
  return changed ? { ...document, turns, updatedAt: now } : document
}

type TurnsParseResult =
  | { ok: true; turns: ConversationTurn[] }
  | { ok: false; reason: string; raw: unknown }

function parseTurns(input: readonly unknown[], raw: unknown): TurnsParseResult {
  const turns: ConversationTurn[] = []
  const turnIds = new Set<string>()
  const attemptIds = new Set<string>()
  const running: Array<{ turnIndex: number; attemptIndex: number }> = []
  for (const [turnIndex, inputTurn] of input.entries()) {
    if (!isTurn(inputTurn)) return invalid('轮次字段无效', raw)
    if (turnIds.has(inputTurn.id)) return invalid('轮次 ID 必须唯一', raw)
    turnIds.add(inputTurn.id)
    for (const [attemptIndex, attempt] of inputTurn.attempts.entries()) {
      if (attemptIds.has(attempt.id)) return invalid('attempt ID 必须在文档内全局唯一', raw)
      attemptIds.add(attempt.id)
      if (attempt.status === 'running') running.push({ turnIndex, attemptIndex })
    }
    turns.push(inputTurn)
  }

  if (running.length > 1 || (running.length === 1 &&
    (running[0].turnIndex !== turns.length - 1 || running[0].attemptIndex !== turns[turns.length - 1].attempts.length - 1))) {
    return invalid('running attempt 只能是末轮的最后一次尝试', raw)
  }

  for (const [turnIndex, turn] of turns.entries()) {
    const lastAttempt = turn.attempts[turn.attempts.length - 1]
    const hasAssistantResponse = turn.assistantText !== null && (turn.assistantText.trim().length > 0 || turn.quickReplies.length > 0)
    if ((lastAttempt.status === 'completed') !== hasAssistantResponse) return invalid('助手响应与最后 attempt 状态不一致', raw)
    if (turn.quickReplySelection && !isValidQuickReplySelection(turns, turnIndex, turn)) {
      return invalid('快捷回答引用无效', raw)
    }
  }
  return { ok: true, turns }
}

function isTurn(input: unknown): input is ConversationTurn {
  if (!isRecord(input) || !hasExactKeys(input, TURN_KEYS) || !isNonEmptyString(input.id) || !isNonEmptyString(input.userText) ||
    !(input.assistantText === null || typeof input.assistantText === 'string') || !Array.isArray(input.quickReplies) ||
    input.quickReplies.length > 4 || !isQuickReplySelection(input.quickReplySelection) || !Array.isArray(input.attachments) ||
    !Array.isArray(input.attempts) || input.attempts.length === 0 || !isTimestamp(input.createdAt) || !(input.contextSnapshot === null || isConversationContextSnapshot(input.contextSnapshot))) return false

  const quickReplyIds = new Set<string>()
  for (const inputReply of input.quickReplies) {
    if (!isRecord(inputReply) || !hasExactKeys(inputReply, QUICK_REPLY_KEYS) || !isNonEmptyString(inputReply.id) ||
      !isNonEmptyString(inputReply.label) || quickReplyIds.has(inputReply.id)) return false
    quickReplyIds.add(inputReply.id)
  }

  const attachmentIds = new Set<string>()
  for (const inputAttachment of input.attachments) {
    if (!isRecord(inputAttachment) || !hasExactKeys(inputAttachment, ATTACHMENT_KEYS) || !isNonEmptyString(inputAttachment.cardId) ||
      !isNonEmptyString(inputAttachment.revision) || attachmentIds.has(inputAttachment.cardId)) return false
    attachmentIds.add(inputAttachment.cardId)
  }

  return input.attempts.every(isAttempt)
}

function isRollingSummary(input: unknown): input is ConversationRollingSummaryV1 {
  return isRecord(input) && hasExactKeys(input, ['text', 'throughTurnId', 'updatedAt']) &&
    isBoundedString(input.throughTurnId, 200) && isNonEmptyString(input.text) &&
    input.text.trim().length > 0 && Array.from(input.text).length <= MAX_ROLLING_SUMMARY_CODE_POINTS &&
    isBoundedString(input.updatedAt, 100) && isTimestamp(input.updatedAt)
}

function isConversationContextSnapshot(input: unknown): input is ConversationContextSnapshot {
  if (!isRecord(input) || !hasExactKeys(input, [
    'contextWindowTokens', 'directoryTier', 'estimatedInputTokens', 'estimatedTotalTokens',
    'includedTurnIds', 'omittedMessageCount', 'providedCards', 'reservedExpansionTokens', 'reservedOutputTokens',
  ]) || (input.directoryTier !== 'detailed' && input.directoryTier !== 'compact') ||
    !isPositiveSafeInteger(input.contextWindowTokens) || !isNonNegativeSafeInteger(input.reservedOutputTokens) ||
    !isNonNegativeSafeInteger(input.reservedExpansionTokens) || !isNonNegativeSafeInteger(input.estimatedInputTokens) ||
    !isNonNegativeSafeInteger(input.estimatedTotalTokens) || !isNonNegativeSafeInteger(input.omittedMessageCount) ||
    !Array.isArray(input.includedTurnIds) || !Array.isArray(input.providedCards)) return false
  const expectedTotal = input.estimatedInputTokens + input.reservedOutputTokens + input.reservedExpansionTokens
  if (!Number.isSafeInteger(expectedTotal) || input.estimatedTotalTokens !== expectedTotal || expectedTotal > input.contextWindowTokens) return false
  const cardIds = new Set<string>()
  for (const card of input.providedCards) {
    if (!isRecord(card) || !hasExactKeys(card, ['cardId', 'revision', 'source']) ||
      !isBoundedString(card.cardId, 200) || !isNonEmptyString(card.revision) ||
      (card.source !== 'explicit' && card.source !== 'expanded') || cardIds.has(card.cardId.toLowerCase())) return false
    cardIds.add(card.cardId.toLowerCase())
  }
  const ids = new Set<string>()
  for (const id of input.includedTurnIds) {
    if (!isNonEmptyString(id) || ids.has(id)) return false
    ids.add(id)
  }
  return true
}

function isPositiveSafeInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0
}

function isNonNegativeSafeInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0
}

function isAttempt(input: unknown): input is ConversationAttempt {
  if (!isRecord(input) || !hasExactKeys(input, ATTEMPT_KEYS) || !isNonEmptyString(input.id) ||
    !ATTEMPT_STATUSES.includes(input.status as ConversationAttemptStatus) || !isTimestamp(input.startedAt) ||
    !(input.finishedAt === null || isTimestamp(input.finishedAt)) || !(input.error === null || isBoundedString(input.error, MAX_PERSISTED_ERROR_LENGTH)) ||
    !(input.failureKind === null || FAILURE_KINDS.includes(input.failureKind as ConversationAttemptFailureKind)) ||
    !isDiagnostics(input.diagnostics)) return false
  return isAttemptStateValid(input as unknown as ConversationAttempt)
}

function isAttemptStateValid(attempt: ConversationAttempt): boolean {
  if (attempt.status === 'running') return attempt.finishedAt === null && attempt.error === null && attempt.failureKind === null
  if (attempt.finishedAt === null) return false
  if (attempt.status === 'completed') return attempt.error === null && attempt.failureKind === null
  if (!isNonEmptyString(attempt.error)) return false
  if (attempt.status === 'cancelled') return attempt.failureKind === 'cancelled'
  if (attempt.status === 'interrupted') return attempt.failureKind === 'interrupted'
  return attempt.failureKind === 'timeout' || attempt.failureKind === 'provider' ||
    attempt.failureKind === 'invalid-response' || attempt.failureKind === 'persistence'
}

function isDiagnostics(input: unknown): input is ConversationAttemptDiagnostics {
  return isRecord(input) && hasExactKeys(input, DIAGNOSTIC_KEYS) && isBoundedString(input.provider, 200) &&
    isBoundedString(input.model, 200) && isBoundedString(input.requestId, 200)
}

function isQuickReplySelection(input: unknown): input is ConversationQuickReplySelection | null {
  return input === null || (isRecord(input) && hasExactKeys(input, QUICK_REPLY_SELECTION_KEYS) &&
    isNonEmptyString(input.turnId) && isNonEmptyString(input.replyId))
}

function isValidQuickReplySelection(turns: readonly ConversationTurn[], turnIndex: number, turn: ConversationTurn): boolean {
  const selection = turn.quickReplySelection
  if (!selection) return true
  const source = turns.slice(0, turnIndex).find(candidate => candidate.id === selection.turnId)
  const reply = source?.quickReplies.find(candidate => candidate.id === selection.replyId)
  return reply !== undefined && turn.userText === reply.label
}

function hasValidProposalTransactions(proposal: ConversationCardProposal): boolean {
  let transactionId: string | null = null
  for (const event of proposal.events) {
    if (event.type === 'accepted') transactionId = event.transactionId
    if ((event.type === 'reverted' || event.type === 'restored') && event.transactionId !== transactionId) return false
  }
  return true
}

function proposalTargetKey(proposal: Pick<ConversationCardProposal, 'operation' | 'targetCardId'>): string {
  return `${proposal.operation}:${proposal.targetCardId.toLowerCase()}`
}

function hasSupersededCycle(proposalsById: ReadonlyMap<string, ConversationCardProposal>): boolean {
  const visiting = new Set<string>()
  const visited = new Set<string>()
  const visit = (proposalId: string): boolean => {
    if (visiting.has(proposalId)) return true
    if (visited.has(proposalId)) return false
    visiting.add(proposalId)
    const proposal = proposalsById.get(proposalId)
    const superseded = proposal?.events.find(event => event.type === 'superseded')
    if (superseded?.type === 'superseded' && visit(superseded.byProposalId)) return true
    visiting.delete(proposalId)
    visited.add(proposalId)
    return false
  }
  return [...proposalsById.keys()].some(visit)
}

function hasValidProjectReferences(proposals: readonly ConversationCardProposal[]): boolean {
  return proposals.every(proposal => {
    const self = proposal.targetCardId.toLowerCase()
    const actualReferences = new Set(referencedCardIds(proposal.document)
      .map(cardId => cardId.toLowerCase())
      .filter(cardId => cardId !== self))
    const recordedReferences = new Set(proposal.projectReferences.map(reference => reference.cardId.toLowerCase()))
    return actualReferences.size === recordedReferences.size &&
      [...actualReferences].every(cardId => recordedReferences.has(cardId))
  })
}

function inferLegacyFailureKind(attempt: Record<string, unknown>): ConversationAttemptFailureKind | null {
  if (FAILURE_KINDS.includes(attempt.failureKind as ConversationAttemptFailureKind)) return attempt.failureKind as ConversationAttemptFailureKind
  if (attempt.status === 'cancelled') return 'cancelled'
  if (attempt.status === 'interrupted') return 'interrupted'
  if (attempt.status === 'failed') return 'provider'
  return null
}

function unknownDiagnostics(): ConversationAttemptDiagnostics {
  return { provider: 'unknown', model: 'unknown', requestId: 'unknown' }
}

export function sanitizeConversationError(error: unknown): string {
  let message = error instanceof Error ? error.message : String(error)
  message = message
    .replace(/\bBearer\s+[A-Za-z0-9._~+\/-]+/gi, 'Bearer [REDACTED]')
    .replace(/\bsk-[A-Za-z0-9_-]{6,}\b/g, '[REDACTED]')
    .replace(/((?:api[_ -]?key|token|secret|authorization)\s*[:=]\s*)[^\s,;]+/gi, '$1[REDACTED]')
    .replace(/(https?:\/\/)[^\s/@]+:[^\s/@]+@/gi, '$1[REDACTED]@')
    .replace(/\s+/g, ' ')
    .trim()
  if (!message) return '未知错误'
  return message.length <= MAX_PERSISTED_ERROR_LENGTH
    ? message
    : `${message.slice(0, MAX_PERSISTED_ERROR_LENGTH - 1)}…`
}

function invalid(reason: string, raw: unknown): Extract<ConversationDocumentParseResult, { ok: false }> {
  return { ok: false, reason, raw }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function hasExactKeys(value: Record<string, unknown>, expected: readonly string[]): boolean {
  const actual = Object.keys(value).sort()
  return actual.length === expected.length && actual.every((key, index) => key === expected[index])
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0
}

function isBoundedString(value: unknown, maxLength: number): value is string {
  return isNonEmptyString(value) && value.length <= maxLength
}

function isTimestamp(value: unknown): value is string {
  return isNonEmptyString(value) && !Number.isNaN(Date.parse(value))
}
