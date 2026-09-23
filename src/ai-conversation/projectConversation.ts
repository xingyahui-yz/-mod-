import {
  createConversationDocument,
  interruptRunningAttempts,
  sanitizeConversationError,
  type ConversationAttachment,
  type ConversationAttemptDiagnostics,
  type ConversationAttemptFailureKind,
  type ConversationAttemptStatus,
  type ConversationDocument,
  type ConversationQuickReplySelection,
  type ConversationTurn,
} from './conversationDocument'
import type { ConversationRepository, ConversationLoadResult } from './conversationRepository'
import { parseConversationResponseText, type ConversationResponseV1 } from './conversationResponse'
import { cardDocumentRevision } from '../card/cardAiProposal'
import type { CardDocument } from '../card/cardDocument'
import type { ConversationPromptContext } from '../services/llm/conversationContext'
import {
  acceptConversationCardProposal,
  markConversationProposalTransitionCommitted,
  markConversationCardProposalReverted,
  markConversationCardProposalStale,
  pendingProposalCardTransition,
  recordConversationCardProposalBatch,
  rejectConversationCardProposal,
  restoreConversationCardProposalAfterRedo,
  type ConversationCardProposal,
  type ConversationProposalRejectionFeedback,
} from './proposalLifecycle'

export interface ConversationRequest extends ConversationPromptContext {
  projectPath: string
  turns: readonly ConversationTurn[]
  signal: AbortSignal
}

export type ConversationModelFailureKind = 'cancelled' | 'timeout' | 'provider' | 'invalid-response' | 'persistence'

export interface ConversationModel {
  diagnostics?: () => Partial<ConversationAttemptDiagnostics>
  respond(request: ConversationRequest): Promise<
    | { success: true; content: string; diagnostics?: Partial<ConversationAttemptDiagnostics> }
    | { success: false; error: string; kind?: ConversationModelFailureKind; diagnostics?: Partial<ConversationAttemptDiagnostics> }
  >
}

export type ProjectConversationErrorCode =
  | 'invalid-input'
  | 'not-loaded'
  | 'load-failed'
  | 'quarantined'
  | 'already-running'
  | 'not-retryable'
  | 'cancelled'
  | 'timeout'
  | 'provider'
  | 'invalid-response'
  | 'persistence'
  | 'proposal-not-found'
  | 'proposal-not-pending'
  | 'invalid-card-id'
  | 'duplicate-card-id'
  | 'stale-proposal'
  | 'card-update-failed'

export type ProjectConversationResult =
  | { ok: true }
  | { ok: false; error: string; code: ProjectConversationErrorCode }

export interface ProjectConversationSnapshot {
  document: ConversationDocument | null
  loadStatus: ConversationLoadResult['status'] | 'loading'
  quarantineReason: string | null
  isRunning: boolean
  lastError: string | null
  persistenceError: string | null
  requiresReload: boolean
}

export interface ProposalCardCommit {
  proposal: ConversationCardProposal
  finalCardId: string
  transactionId: string
}

export type ProposalCardCommitResult =
  | { ok: true }
  | { ok: false; error: string; certainty?: 'unchanged' | 'uncertain' }

type Listener = () => void

interface StartedAttempt {
  document: ConversationDocument
  attemptId: string
  requestId: number
  controller: AbortController
  promptContext: ConversationPromptContext
}

interface ResolvedProjectContext {
  promptContext: ConversationPromptContext
  attachments: ConversationAttachment[]
}

export class ProjectConversation {
  private snapshot: ProjectConversationSnapshot = {
    document: null,
    loadStatus: 'loading',
    quarantineReason: null,
    isRunning: false,
    lastError: null,
    persistenceError: null,
    requiresReload: false,
  }
  private listeners = new Set<Listener>()
  private abortController: AbortController | null = null
  private activeAttemptId: string | null = null
  private requestSequence = 0
  private mutation = Promise.resolve()
  private pendingStarts = 0
  private startSequence = 0
  private cancelledStartSequence = 0

  constructor(
    readonly projectPath: string,
    private readonly repository: ConversationRepository,
    private readonly model: ConversationModel,
    private readonly clock: () => Date = () => new Date(),
    private readonly createId: () => string = () => crypto.randomUUID(),
    private readonly getProjectDocuments: () => readonly CardDocument[] = () => [],
  ) {}

  getSnapshot = (): ProjectConversationSnapshot => this.snapshot
  subscribe = (listener: Listener) => { this.listeners.add(listener); return () => this.listeners.delete(listener) }
  hasActiveWork = (): boolean => this.pendingStarts > 0 || this.snapshot.isRunning

  async load(): Promise<void> {
    await this.runMutation(async () => {
      if (this.snapshot.isRunning) {
        this.update({ ...this.snapshot, lastError: '当前轮次仍在运行，无法重新加载' })
        return
      }
      this.update({ ...this.snapshot, loadStatus: 'loading', lastError: null })
      const result = await this.repository.load(this.projectPath)
      if (result.status === 'loaded') {
        const recovered = interruptRunningAttempts(result.document, this.now())
        if (recovered !== result.document) {
          const saved = await this.repository.save(this.projectPath, recovered)
          if (!saved.ok) {
            const error = `中断状态恢复保存失败：${saved.error}`
            this.update({
              document: recovered,
              loadStatus: 'loaded',
              quarantineReason: null,
              isRunning: false,
              lastError: error,
              persistenceError: error,
              requiresReload: true,
            })
            return
          }
        }
        this.update({
          document: recovered,
          loadStatus: 'loaded',
          quarantineReason: null,
          isRunning: false,
          lastError: result.warning ?? null,
          persistenceError: null,
          requiresReload: false,
        })
      } else if (result.status === 'quarantined') {
        this.update({
          document: null,
          loadStatus: 'quarantined',
          quarantineReason: result.reason,
          isRunning: false,
          lastError: result.reason,
          persistenceError: null,
          requiresReload: false,
        })
      } else if (result.status === 'failed') {
        this.update({
          document: null,
          loadStatus: 'failed',
          quarantineReason: null,
          isRunning: false,
          lastError: result.reason,
          persistenceError: result.reason,
          requiresReload: false,
        })
      } else {
        this.update({
          document: null,
          loadStatus: 'missing',
          quarantineReason: null,
          isRunning: false,
          lastError: result.warning ?? null,
          persistenceError: null,
          requiresReload: false,
        })
      }
    })
  }

  async send(
    userText: string,
    attachments: readonly ConversationAttachment[] = [],
    quickReplySelection: ConversationQuickReplySelection | null = null,
  ): Promise<ProjectConversationResult> {
    const text = userText.trim()
    if (!text) return failure('invalid-input', '请输入消息')
    if (this.hasActiveWork()) return failure('already-running', '已有轮次正在处理')
    const startId = ++this.startSequence
    this.pendingStarts += 1
    this.update({ ...this.snapshot })
    let started: Awaited<ReturnType<ProjectConversation['startNewTurn']>>
    try {
      started = await this.runMutation(() => this.startNewTurn(text, attachments, quickReplySelection))
    } finally {
      this.pendingStarts -= 1
      this.update({ ...this.snapshot })
    }
    if (!started.ok) return started
    if (startId <= this.cancelledStartSequence) {
      const cancelled = await this.cancel()
      return cancelled.ok ? failure('cancelled', '请求已取消') : cancelled
    }
    return this.executeAttempt(started.value)
  }

  async retryTurn(turnId: string): Promise<ProjectConversationResult> {
    if (!turnId.trim()) return failure('invalid-input', '轮次 ID 不能为空')
    if (this.hasActiveWork()) return failure('already-running', '已有轮次正在处理')
    const startId = ++this.startSequence
    this.pendingStarts += 1
    this.update({ ...this.snapshot })
    let started: Awaited<ReturnType<ProjectConversation['startRetry']>>
    try {
      started = await this.runMutation(() => this.startRetry(turnId))
    } finally {
      this.pendingStarts -= 1
      this.update({ ...this.snapshot })
    }
    if (!started.ok) return started
    if (startId <= this.cancelledStartSequence) {
      const cancelled = await this.cancel()
      return cancelled.ok ? failure('cancelled', '请求已取消') : cancelled
    }
    return this.executeAttempt(started.value)
  }

  async cancel(): Promise<ProjectConversationResult> {
    this.cancelledStartSequence = this.startSequence
    this.abortController?.abort()
    return this.runMutation(async () => {
      const document = this.snapshot.document
      const attemptId = this.activeAttemptId
      if (!this.snapshot.isRunning || !document || !attemptId) return { ok: true }

      this.abortController?.abort()
      this.requestSequence += 1
      const cancelled = this.mapAttempt(document, attemptId, turn => turn, 'cancelled', '用户取消', 'cancelled', this.modelDiagnostics(true))
      const saved = await this.repository.save(this.projectPath, cancelled)
      this.clearActiveRequest()
      if (!saved.ok) return this.persistTerminalFailure(cancelled, `取消状态保存失败：${saved.error}`)
      this.update({
        ...this.snapshot,
        document: cancelled,
        isRunning: false,
        lastError: saved.warning ?? null,
        persistenceError: null,
        requiresReload: false,
      })
      return { ok: true }
    })
  }

  async refreshProposal(proposalId: string): Promise<ProjectConversationResult> {
    return this.runMutation(async () => {
      const ready = this.ensureReady()
      if (!ready.ok) return ready
      const document = this.snapshot.document
      const proposal = document?.proposals.find(candidate => candidate.id === proposalId)
      if (!document || !proposal) return failure('proposal-not-found', 'Card 提案不存在')
      if (proposal.status !== 'pending' || proposal.operation !== 'update') return { ok: true }
      const revisions = this.readCurrentCardRevisions()
      if (!revisions.ok) return failure('invalid-input', revisions.error)
      const observedRevision = revisions.value.get(proposal.targetCardId.toLowerCase()) ?? null
      if (observedRevision === proposal.baseRevision) return { ok: true }
      const stale = markConversationCardProposalStale(proposal, {
        at: this.proposalEventTime(proposal),
        eventId: this.createId(),
        observedRevision,
      })
      if (!stale.ok) return failure('proposal-not-pending', 'Card 提案不能再标记为过期')
      const saved = await this.persistProposalReplacement(document, stale.value)
      return saved.ok ? failure('stale-proposal', '目标 Card 已变化，提案已过期') : saved
    })
  }

  async acceptProposal(
    proposalId: string,
    finalCardId: string,
    commitCard: (input: ProposalCardCommit) => ProposalCardCommitResult | Promise<ProposalCardCommitResult>,
  ): Promise<ProjectConversationResult> {
    return this.runMutation(async () => {
      const ready = this.ensureReady()
      if (!ready.ok) return ready
      const document = this.snapshot.document
      const proposal = document?.proposals.find(candidate => candidate.id === proposalId)
      if (!document || !proposal) return failure('proposal-not-found', 'Card 提案不存在')
      if (proposal.status !== 'pending') return failure('proposal-not-pending', 'Card 提案已处理，不能再次接受')
      const revisions = this.readCurrentCardRevisions()
      if (!revisions.ok) return failure('invalid-input', revisions.error)
      const observedRevision = proposal.operation === 'update'
        ? revisions.value.get(proposal.targetCardId.toLowerCase()) ?? null
        : null
      if (proposal.operation === 'update' && observedRevision !== proposal.baseRevision) {
        const stale = markConversationCardProposalStale(proposal, {
          at: this.proposalEventTime(proposal),
          eventId: this.createId(),
          observedRevision,
        })
        if (!stale.ok) return failure('proposal-not-pending', 'Card 提案已处理')
        const persisted = await this.persistProposalReplacement(document, stale.value)
        return persisted.ok ? failure('stale-proposal', '目标 Card 已变化，提案已过期') : persisted
      }

      const transactionId = proposal.id
      const accepted = acceptConversationCardProposal(proposal, {
        at: this.proposalEventTime(proposal),
        eventId: this.createId(),
        transactionId,
        finalCardId,
        currentCardRevisions: revisions.value,
      })
      if (!accepted.ok) return proposalLifecycleFailure(accepted.error)
      const next = replaceProposal(document, accepted.value)
      const saved = await this.repository.save(this.projectPath, next)
      if (!saved.ok) {
        this.updatePersistenceFailure(document, `提案接受状态保存失败：${saved.error}`, saved.certainty)
        return failure('persistence', `提案接受状态保存失败：${saved.error}`)
      }

      let committed: ProposalCardCommitResult
      try {
        const acceptedEvent = accepted.value.events.at(-1)
        const acceptedCardId = acceptedEvent?.type === 'accepted' ? acceptedEvent.finalCardId : finalCardId.trim()
        committed = await commitCard({ proposal, finalCardId: acceptedCardId, transactionId })
      } catch (error) {
        committed = { ok: false, error: sanitizeConversationError(error), certainty: 'uncertain' }
      }
      if (!committed.ok) {
        if (committed.certainty === 'uncertain') {
          const message = `Card 应用结果不确定：${committed.error}`
          this.updatePersistenceFailure(next, message, 'uncertain', true)
          return failure('persistence', message)
        }
        const rolledBack = await this.repository.save(this.projectPath, document)
        if (!rolledBack.ok) {
          const message = `Card 应用失败且提案状态回滚失败：${rolledBack.error}`
          this.updatePersistenceFailure(next, message, rolledBack.certainty, true)
          return failure('persistence', message)
        }
        this.update({
          ...this.snapshot,
          document,
          lastError: committed.error,
          persistenceError: null,
          requiresReload: false,
        })
        return failure('card-update-failed', committed.error)
      }

      const acceptedTransition = pendingProposalCardTransition(accepted.value)
      if (!acceptedTransition) {
        const message = '提案接受事务缺少待兑现的 Card transition'
        this.updatePersistenceFailure(next, message, 'uncertain', true)
        return failure('persistence', message)
      }
      const committedProposal = markConversationProposalTransitionCommitted(accepted.value, {
        at: this.proposalEventTime(accepted.value),
        eventId: this.createId(),
        transitionEventId: acceptedTransition.eventId,
        transactionId,
      })
      if (!committedProposal.ok) {
        const message = `提案接受事务无法确认：${committedProposal.error}`
        this.updatePersistenceFailure(next, message, 'uncertain', true)
        return failure('persistence', message)
      }
      const committedDocument = replaceProposal(next, committedProposal.value)
      const confirmed = await this.repository.save(this.projectPath, committedDocument)
      if (!confirmed.ok) {
        const message = `Card 已应用，但提案事务确认保存失败：${confirmed.error}`
        this.updatePersistenceFailure(next, message, confirmed.certainty, true)
        return failure('persistence', message)
      }

      this.update({
        ...this.snapshot,
        document: committedDocument,
        lastError: confirmed.warning ?? saved.warning ?? null,
        persistenceError: null,
        requiresReload: false,
      })
      return { ok: true }
    })
  }

  async rejectProposal(
    proposalId: string,
    feedback: ConversationProposalRejectionFeedback | null,
  ): Promise<ProjectConversationResult> {
    return this.runMutation(async () => {
      const ready = this.ensureReady()
      if (!ready.ok) return ready
      const document = this.snapshot.document
      const proposal = document?.proposals.find(candidate => candidate.id === proposalId)
      if (!document || !proposal) return failure('proposal-not-found', 'Card 提案不存在')
      const rejected = rejectConversationCardProposal(proposal, {
        at: this.proposalEventTime(proposal),
        eventId: this.createId(),
        feedback,
      })
      if (!rejected.ok) return proposalLifecycleFailure(rejected.error)
      return this.persistProposalReplacement(document, rejected.value)
    })
  }

  async recordProposalHistory(
    proposalId: string,
    transactionId: string,
    status: 'accepted' | 'reverted',
    desiredDocument: CardDocument,
  ): Promise<ProjectConversationResult> {
    return this.runMutation(async () => {
      const ready = this.ensureLoaded()
      if (!ready.ok) return ready
      const conversationDocument = this.snapshot.document
      const proposal = conversationDocument?.proposals.find(candidate => candidate.id === proposalId)
      if (!conversationDocument || !proposal) return failure('proposal-not-found', 'Card 提案不存在')
      if ((status === 'reverted' && proposal.status === 'reverted') ||
        (status === 'accepted' && proposal.status === 'accepted')) return { ok: true }
      const at = this.proposalEventTime(proposal)
      const changed = status === 'reverted'
        ? markConversationCardProposalReverted(proposal, { at, eventId: this.createId(), transactionId, document: desiredDocument })
        : restoreConversationCardProposalAfterRedo(proposal, { at, eventId: this.createId(), transactionId, document: desiredDocument })
      if (!changed.ok) return failure('proposal-not-pending', `提案历史状态不同步：${changed.error}`)
      return this.persistProposalReplacement(conversationDocument, changed.value, true)
    })
  }

  async confirmProposalCardTransition(
    proposalId: string,
    transactionId: string,
  ): Promise<ProjectConversationResult> {
    return this.runMutation(async () => {
      const ready = this.ensureLoaded()
      if (!ready.ok) return ready
      const document = this.snapshot.document
      const proposal = document?.proposals.find(candidate => candidate.id === proposalId)
      if (!document || !proposal) return failure('proposal-not-found', 'Card 提案不存在')
      const pending = pendingProposalCardTransition(proposal)
      if (!pending) {
        const lastCommit = [...proposal.events].reverse().find(event => event.type === 'committed')
        return lastCommit?.type === 'committed' && lastCommit.transactionId === transactionId
          ? { ok: true }
          : failure('proposal-not-pending', '提案没有待确认的 Card transition')
      }
      const changed = markConversationProposalTransitionCommitted(proposal, {
        at: this.proposalEventTime(proposal),
        eventId: this.createId(),
        transitionEventId: pending.eventId,
        transactionId,
      })
      if (!changed.ok) return failure('proposal-not-pending', `提案事务确认失败：${changed.error}`)
      const next = replaceProposal(document, changed.value)
      const saved = await this.repository.save(this.projectPath, next)
      if (!saved.ok) {
        const message = `提案事务确认保存失败：${saved.error}`
        this.updatePersistenceFailure(document, message, saved.certainty, true)
        return failure('persistence', message)
      }
      this.update({
        ...this.snapshot,
        document: next,
        lastError: saved.warning ?? null,
        persistenceError: null,
        requiresReload: false,
      })
      return { ok: true }
    })
  }

  private async startNewTurn(
    text: string,
    attachments: readonly ConversationAttachment[],
    quickReplySelection: ConversationQuickReplySelection | null,
  ): Promise<{ ok: true; value: StartedAttempt } | Extract<ProjectConversationResult, { ok: false }>> {
    const ready = this.ensureReady()
    if (!ready.ok) return ready
    if (!this.isValidQuickReplySelection(text, quickReplySelection)) return failure('invalid-input', '快捷回答引用无效')

    const now = this.now()
    const attemptId = this.createId()
    const base = this.snapshot.document ?? createConversationDocument(now)
    const projectContext = this.resolveProjectContext(base, attachments, false)
    if (!projectContext.ok) return projectContext
    const turn: ConversationTurn = {
      id: this.createId(),
      userText: text,
      assistantText: null,
      quickReplies: [],
      quickReplySelection,
      attachments: projectContext.value.attachments,
      createdAt: now,
      attempts: [{
        id: attemptId,
        status: 'running',
        startedAt: now,
        finishedAt: null,
        error: null,
        failureKind: null,
        diagnostics: this.modelDiagnostics(),
      }],
    }
    const pending = { ...base, turns: [...base.turns, turn], updatedAt: now }
    return this.persistStartedAttempt(pending, attemptId, {
      ...projectContext.value.promptContext,
      proposals: proposalSummaries(pending),
    })
  }

  private async startRetry(turnId: string): Promise<{ ok: true; value: StartedAttempt } | Extract<ProjectConversationResult, { ok: false }>> {
    const ready = this.ensureReady()
    if (!ready.ok) return ready
    const document = this.snapshot.document
    const turn = document?.turns[document.turns.length - 1]
    const lastAttempt = turn?.attempts[turn.attempts.length - 1]
    if (!document || !turn || turn.id !== turnId || !lastAttempt ||
      !(['failed', 'cancelled', 'interrupted'] as const).includes(lastAttempt.status as 'failed' | 'cancelled' | 'interrupted')) {
      return failure('not-retryable', '只能重试最后一个失败、取消或中断的轮次')
    }

    const now = this.now()
    const attemptId = this.createId()
    const projectContext = this.resolveProjectContext(document, turn.attachments, true)
    if (!projectContext.ok) return projectContext
    const pending: ConversationDocument = {
      ...document,
      updatedAt: now,
      turns: document.turns.map(candidate => candidate.id === turnId
        ? {
            ...candidate,
            assistantText: null,
            quickReplies: [],
            attachments: projectContext.value.attachments,
            attempts: [...candidate.attempts, {
              id: attemptId,
              status: 'running' as const,
              startedAt: now,
              finishedAt: null,
              error: null,
              failureKind: null,
              diagnostics: this.modelDiagnostics(),
            }],
          }
        : candidate),
    }
    return this.persistStartedAttempt(pending, attemptId, {
      ...projectContext.value.promptContext,
      proposals: proposalSummaries(pending),
    })
  }

  private async persistStartedAttempt(
    document: ConversationDocument,
    attemptId: string,
    promptContext: ConversationPromptContext,
  ): Promise<{ ok: true; value: StartedAttempt } | Extract<ProjectConversationResult, { ok: false }>> {
    const saved = await this.repository.save(this.projectPath, document)
    if (!saved.ok) {
      this.update({
        ...this.snapshot,
        lastError: saved.error,
        persistenceError: saved.error,
        requiresReload: saved.certainty === 'uncertain',
      })
      return failure('persistence', saved.error)
    }

    const controller = new AbortController()
    const requestId = ++this.requestSequence
    this.abortController = controller
    this.activeAttemptId = attemptId
    this.update({
      document,
      loadStatus: 'loaded',
      quarantineReason: null,
      isRunning: true,
      lastError: saved.warning ?? null,
      persistenceError: null,
      requiresReload: false,
    })
    return { ok: true, value: { document, attemptId, requestId, controller, promptContext } }
  }

  private async executeAttempt(started: StartedAttempt): Promise<ProjectConversationResult> {
    let response: Awaited<ReturnType<ConversationModel['respond']>>
    try {
      response = await this.model.respond({
        projectPath: this.projectPath,
        turns: started.document.turns,
        signal: started.controller.signal,
        ...started.promptContext,
      })
    } catch (error) {
      response = { success: false, error: sanitizeConversationError(error), kind: 'provider' }
    }

    return this.runMutation(async () => {
      if (!this.isCurrentRequest(started)) return failure('cancelled', '请求已取消')
      const diagnostics = this.responseDiagnostics(started, response.diagnostics)
      if (!response.success) {
        const kind = response.kind ?? 'provider'
        const status = kind === 'cancelled' ? 'cancelled' : 'failed'
        return this.finishFailure(started, status, sanitizeConversationError(response.error), kind, diagnostics)
      }
      const parsed = parseConversationResponseText(response.content)
      if (!parsed.ok) return this.finishFailure(started, 'failed', sanitizeConversationError(parsed.error), 'invalid-response', diagnostics)
      return this.finishSuccess(started, parsed.value, diagnostics)
    })
  }

  private async finishSuccess(
    started: StartedAttempt,
    response: ConversationResponseV1,
    diagnostics: ConversationAttemptDiagnostics,
  ): Promise<ProjectConversationResult> {
    const requestCards = new Map(started.promptContext.cardCatalog.map(card => [card.id.toLowerCase(), card]))
    const requestRevisions = new Map([...requestCards].map(([id, card]) => [id, card.revision]))
    const authorizedUpdateTargets = new Set([
      ...started.promptContext.resolvedAttachments.map(attachment => attachment.cardId.toLowerCase()),
      ...started.promptContext.proposals
        .filter(proposal => proposal.operation === 'update' &&
          proposal.status === 'pending' &&
          proposal.candidate !== null &&
          proposal.baseRevision === requestRevisions.get(proposal.targetCardId.toLowerCase()))
        .map(proposal => proposal.targetCardId.toLowerCase()),
    ])
    for (const proposal of response.proposals) {
      if (proposal.operation === 'update' && !authorizedUpdateTargets.has(proposal.targetCardId.toLowerCase())) {
        return this.finishFailure(
          started,
          'failed',
          `Card 提案缺少全文上下文：${proposal.targetCardId}`,
          'invalid-response',
          diagnostics,
        )
      }
    }
    const currentRevisions = this.readCurrentCardRevisions()
    if (!currentRevisions.ok) {
      return this.finishFailure(started, 'failed', currentRevisions.error, 'invalid-response', diagnostics)
    }
    for (const proposal of response.proposals) {
      if (proposal.operation !== 'update') continue
      const requestCard = requestCards.get(proposal.targetCardId.toLowerCase())
      if (!requestCard || requestCard.id !== proposal.targetCardId || requestCard.revision !== proposal.baseRevision) {
        return this.finishFailure(
          started,
          'failed',
          `Card 提案目标或基线无效：${proposal.targetCardId}`,
          'invalid-response',
          diagnostics,
        )
      }
    }
    const completedAt = this.now()
    const currentDocument = this.snapshot.document ?? started.document
    const proposals = recordConversationCardProposalBatch(currentDocument.proposals, response.proposals, {
      source: { turnId: findTurnIdForAttempt(started.document, started.attemptId), attemptId: started.attemptId },
      at: completedAt,
      currentCardRevisions: currentRevisions.value,
      createId: this.createId,
    })
    if (!proposals.ok) {
      return this.finishFailure(
        started,
        'failed',
        `Card 提案无效：${proposals.error}`,
        'invalid-response',
        diagnostics,
      )
    }
    const completed = this.mapAttempt(
      currentDocument,
      started.attemptId,
      turn => ({ ...turn, assistantText: response.text, quickReplies: response.quickReplies }),
      'completed',
      null,
      null,
      diagnostics,
    )
    const completedWithProposals: ConversationDocument = {
      ...completed,
      proposals: proposals.value,
      updatedAt: completedAt,
    }
    const saved = await this.repository.save(this.projectPath, completedWithProposals)
    if (!this.isCurrentRequest(started)) return failure('cancelled', '请求已取消')
    if (!saved.ok) {
      const persistenceFailed = this.mapAttempt(
        currentDocument,
        started.attemptId,
        turn => turn,
        'failed',
        sanitizeConversationError(`最终响应保存失败：${saved.error}`),
        'persistence',
        diagnostics,
      )
      this.clearActiveRequest()
      return this.persistTerminalFailure(persistenceFailed, `最终响应保存失败：${saved.error}`)
    }
    this.clearActiveRequest()
    this.update({
      ...this.snapshot,
      document: completedWithProposals,
      isRunning: false,
      lastError: saved.warning ?? null,
      persistenceError: null,
      requiresReload: false,
    })
    return { ok: true }
  }

  private async finishFailure(
    started: StartedAttempt,
    status: 'failed' | 'cancelled',
    error: string,
    kind: ConversationModelFailureKind,
    diagnostics: ConversationAttemptDiagnostics,
  ): Promise<ProjectConversationResult> {
    const currentDocument = this.snapshot.document ?? started.document
    const failed = this.mapAttempt(currentDocument, started.attemptId, turn => turn, status, error, kind, diagnostics)
    const saved = await this.repository.save(this.projectPath, failed)
    if (!this.isCurrentRequest(started)) return failure('cancelled', '请求已取消')
    this.clearActiveRequest()
    if (!saved.ok) return this.persistTerminalFailure(failed, `${error}；失败状态保存失败：${saved.error}`)
    this.update({
      ...this.snapshot,
      document: failed,
      isRunning: false,
      lastError: saved.warning ? `${error}；${saved.warning}` : error,
      persistenceError: null,
      requiresReload: false,
    })
    return failure(errorCodeFor(kind), error)
  }

  private persistTerminalFailure(document: ConversationDocument, error: string): Extract<ProjectConversationResult, { ok: false }> {
    const safeError = sanitizeConversationError(error)
    this.update({
      ...this.snapshot,
      document,
      isRunning: false,
      lastError: safeError,
      persistenceError: safeError,
      requiresReload: true,
    })
    return failure('persistence', safeError)
  }

  private ensureReady(): ProjectConversationResult {
    const loaded = this.ensureLoaded()
    if (!loaded.ok) return loaded
    if (this.snapshot.isRunning) return failure('already-running', '当前轮次仍在运行')
    return { ok: true }
  }

  private proposalEventTime(proposal: ConversationCardProposal): string {
    const now = this.now()
    return Date.parse(now) >= Date.parse(proposal.updatedAt) ? now : proposal.updatedAt
  }

  private ensureLoaded(): ProjectConversationResult {
    if (this.snapshot.loadStatus === 'loading') return failure('not-loaded', '对话尚未加载完成')
    if (this.snapshot.loadStatus === 'quarantined') return failure('quarantined', '对话文档已隔离，请先处理恢复')
    if (this.snapshot.loadStatus === 'failed') return failure('load-failed', '对话加载失败，请重新加载')
    if (this.snapshot.requiresReload) return failure('persistence', '对话持久化状态不确定，请重新加载')
    return { ok: true }
  }

  private mapAttempt(
    document: ConversationDocument,
    attemptId: string,
    mapTurn: (turn: ConversationTurn) => ConversationTurn,
    status: Exclude<ConversationAttemptStatus, 'running'>,
    error: string | null,
    failureKind: ConversationAttemptFailureKind | null,
    diagnostics?: ConversationAttemptDiagnostics,
  ): ConversationDocument {
    const finishedAt = this.now()
    return {
      ...document,
      updatedAt: finishedAt,
      turns: document.turns.map(turn => {
        if (!turn.attempts.some(attempt => attempt.id === attemptId)) return turn
        const mapped = mapTurn(turn)
        return {
          ...mapped,
          attempts: mapped.attempts.map(attempt => attempt.id === attemptId
            ? { ...attempt, status, finishedAt, error, failureKind, diagnostics: diagnostics ?? attempt.diagnostics }
            : attempt),
        }
      }),
    }
  }

  private runMutation<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.mutation.then(operation, operation)
    this.mutation = result.then(() => undefined, () => undefined)
    return result
  }

  private isCurrentRequest(started: StartedAttempt): boolean {
    return !started.controller.signal.aborted &&
      started.requestId === this.requestSequence &&
      this.activeAttemptId === started.attemptId &&
      this.abortController === started.controller
  }

  private isValidQuickReplySelection(text: string, selection: ConversationQuickReplySelection | null): boolean {
    if (!selection) return true
    const source = this.snapshot.document?.turns.find(turn => turn.id === selection.turnId)
    const reply = source?.quickReplies.find(candidate => candidate.id === selection.replyId)
    return reply !== undefined && reply.label === text
  }

  private modelDiagnostics(includeRequestId = false): ConversationAttemptDiagnostics {
    let diagnostics: Partial<ConversationAttemptDiagnostics> = {}
    try {
      diagnostics = this.model.diagnostics?.() ?? {}
    } catch {
      // Diagnostics must never prevent a user turn from being persisted.
    }
    return {
      provider: sanitizeDiagnostic(diagnostics.provider),
      model: sanitizeDiagnostic(diagnostics.model),
      requestId: includeRequestId ? sanitizeDiagnostic(diagnostics.requestId) : 'unknown',
    }
  }

  private responseDiagnostics(
    started: StartedAttempt,
    response: Partial<ConversationAttemptDiagnostics> | undefined,
  ): ConversationAttemptDiagnostics {
    const initial = started.document.turns
      .flatMap(turn => turn.attempts)
      .find(attempt => attempt.id === started.attemptId)?.diagnostics ?? {
        provider: 'unknown',
        model: 'unknown',
        requestId: 'unknown',
      }
    return {
      provider: sanitizeDiagnostic(response?.provider ?? initial.provider),
      model: sanitizeDiagnostic(response?.model ?? initial.model),
      requestId: sanitizeDiagnostic(response?.requestId ?? initial.requestId),
    }
  }

  private clearActiveRequest(): void {
    this.abortController = null
    this.activeAttemptId = null
  }

  private resolveProjectContext(
    document: ConversationDocument,
    requestedAttachments: readonly ConversationAttachment[],
    useLatestAttachmentRevisions: boolean,
  ): { ok: true; value: ResolvedProjectContext } | Extract<ProjectConversationResult, { ok: false }> {
    let projectDocuments: readonly CardDocument[]
    try {
      projectDocuments = this.getProjectDocuments()
    } catch (error) {
      return failure('invalid-input', `无法读取当前项目 Card：${sanitizeConversationError(error)}`)
    }
    const normalizedDocumentIds = new Set(projectDocuments.map(candidate => candidate.card.id.toLowerCase()))
    if (normalizedDocumentIds.size !== projectDocuments.length) {
      return failure('invalid-input', '当前项目 Card ID 不唯一')
    }
    const documentsById = new Map(projectDocuments.map(candidate => [candidate.card.id, candidate]))
    const attachmentIds = new Set<string>()
    const attachments: ConversationAttachment[] = []
    const resolvedAttachments = []
    for (const requested of requestedAttachments) {
      if (attachmentIds.has(requested.cardId)) return failure('invalid-input', 'Card 附件不能重复')
      attachmentIds.add(requested.cardId)
      const candidate = documentsById.get(requested.cardId)
      if (!candidate) return failure('invalid-input', `Card 附件不存在：${requested.cardId}`)
      const revision = cardDocumentRevision(candidate)
      if (!useLatestAttachmentRevisions && requested.revision !== revision) {
        return failure('invalid-input', `Card 附件已变化：${requested.cardId}`)
      }
      attachments.push({ cardId: requested.cardId, revision })
      resolvedAttachments.push({ cardId: requested.cardId, revision, document: candidate })
    }
    return {
      ok: true,
      value: {
        attachments,
        promptContext: {
          cardCatalog: projectDocuments.map(candidate => ({
            id: candidate.card.id,
            name: candidate.card.name,
            type: candidate.card.type,
            revision: cardDocumentRevision(candidate),
          })),
          resolvedAttachments,
          proposals: proposalSummaries(document),
        },
      },
    }
  }

  private readCurrentCardRevisions():
    | { ok: true; value: ReadonlyMap<string, string> }
    | { ok: false; error: string } {
    try {
      const revisions = new Map<string, string>()
      for (const document of this.getProjectDocuments()) {
        const normalized = document.card.id.toLowerCase()
        if (revisions.has(normalized)) return { ok: false, error: '当前项目 Card ID 不唯一' }
        revisions.set(normalized, cardDocumentRevision(document))
      }
      return { ok: true, value: revisions }
    } catch (error) {
      return { ok: false, error: `无法核对当前项目 Card：${sanitizeConversationError(error)}` }
    }
  }

  private async persistProposalReplacement(
    document: ConversationDocument,
    proposal: ConversationCardProposal,
    externalMutation = false,
  ): Promise<ProjectConversationResult> {
    const next = replaceProposal(document, proposal)
    const saved = await this.repository.save(this.projectPath, next)
    if (!saved.ok) {
      const message = `提案状态保存失败：${saved.error}`
      const visibleDocument = externalMutation || saved.certainty === 'uncertain' ? next : document
      this.updatePersistenceFailure(visibleDocument, message, saved.certainty, externalMutation)
      return failure('persistence', message)
    }
    this.update({
      ...this.snapshot,
      document: next,
      lastError: saved.warning ?? null,
      persistenceError: null,
      requiresReload: false,
    })
    return { ok: true }
  }

  private updatePersistenceFailure(
    document: ConversationDocument,
    error: string,
    certainty: 'unchanged' | 'uncertain',
    forceReload = false,
  ): void {
    const safeError = sanitizeConversationError(error)
    this.update({
      ...this.snapshot,
      document,
      lastError: safeError,
      persistenceError: safeError,
      requiresReload: forceReload || certainty === 'uncertain',
    })
  }

  private now(): string { return this.clock().toISOString() }
  private update(snapshot: ProjectConversationSnapshot): void {
    this.snapshot = snapshot
    this.listeners.forEach(listener => listener())
  }
}

function proposalSummaries(document: ConversationDocument): ConversationPromptContext['proposals'] {
  return document.proposals.map(proposal => {
    const rejected = [...proposal.events].reverse().find(event => event.type === 'rejected')
    const accepted = [...proposal.events].reverse().find(event => event.type === 'accepted')
    return {
      id: proposal.id,
      operation: proposal.operation,
      targetCardId: proposal.targetCardId,
      baseRevision: proposal.baseRevision,
      status: proposal.status,
      candidate: proposal.status === 'pending' ? proposal.document : null,
      rejectionFeedback: rejected?.type === 'rejected' ? rejected.feedback : null,
      finalCardId: accepted?.type === 'accepted' ? accepted.finalCardId : null,
    }
  })
}

function findTurnIdForAttempt(document: ConversationDocument, attemptId: string): string {
  return document.turns.find(turn => turn.attempts.some(attempt => attempt.id === attemptId))?.id ?? ''
}

function replaceProposal(
  document: ConversationDocument,
  proposal: ConversationCardProposal,
): ConversationDocument {
  return {
    ...document,
    proposals: document.proposals.map(candidate => candidate.id === proposal.id ? proposal : candidate),
    updatedAt: proposal.updatedAt,
  }
}

function proposalLifecycleFailure(error: string): Extract<ProjectConversationResult, { ok: false }> {
  switch (error) {
    case 'invalid-card-id': return failure('invalid-card-id', 'Card ID 必须是 PascalCase')
    case 'duplicate-card-id': return failure('duplicate-card-id', 'Card ID 已被占用')
    case 'proposal-not-pending': return failure('proposal-not-pending', 'Card 提案已处理')
    default: return failure('invalid-input', `Card 提案状态无效：${error}`)
  }
}

function failure(code: ProjectConversationErrorCode, error: string): Extract<ProjectConversationResult, { ok: false }> {
  return { ok: false, code, error }
}

function errorCodeFor(kind: ConversationModelFailureKind): ProjectConversationErrorCode {
  return kind
}

function sanitizeDiagnostic(value: unknown): string {
  if (typeof value !== 'string' || !value.trim()) return 'unknown'
  const sanitized = sanitizeConversationError(value).trim()
  return sanitized.slice(0, 200) || 'unknown'
}
