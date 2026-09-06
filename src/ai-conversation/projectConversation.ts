import {
  createConversationDocument,
  interruptRunningAttempts,
  sanitizeConversationError,
  type ConversationAttachment,
  type ConversationAttemptDiagnostics,
  type ConversationAttemptFailureKind,
  type ConversationAttemptStatus,
  type ConversationDocumentV1,
  type ConversationQuickReplySelection,
  type ConversationTurn,
} from './conversationDocument'
import type { ConversationRepository, ConversationLoadResult } from './conversationRepository'
import { parseConversationResponseText, type ConversationResponseV1 } from './conversationResponse'

export interface ConversationRequest {
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

export type ProjectConversationResult =
  | { ok: true }
  | { ok: false; error: string; code: ProjectConversationErrorCode }

export interface ProjectConversationSnapshot {
  document: ConversationDocumentV1 | null
  loadStatus: ConversationLoadResult['status'] | 'loading'
  quarantineReason: string | null
  isRunning: boolean
  lastError: string | null
  persistenceError: string | null
  requiresReload: boolean
}

type Listener = () => void

interface StartedAttempt {
  document: ConversationDocumentV1
  attemptId: string
  requestId: number
  controller: AbortController
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

  constructor(
    readonly projectPath: string,
    private readonly repository: ConversationRepository,
    private readonly model: ConversationModel,
    private readonly clock: () => Date = () => new Date(),
    private readonly createId: () => string = () => crypto.randomUUID(),
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
    this.pendingStarts += 1
    let started: Awaited<ReturnType<ProjectConversation['startNewTurn']>>
    try {
      started = await this.runMutation(() => this.startNewTurn(text, attachments, quickReplySelection))
    } finally {
      this.pendingStarts -= 1
    }
    return started.ok ? this.executeAttempt(started.value) : started
  }

  async retryTurn(turnId: string): Promise<ProjectConversationResult> {
    if (!turnId.trim()) return failure('invalid-input', '轮次 ID 不能为空')
    this.pendingStarts += 1
    let started: Awaited<ReturnType<ProjectConversation['startRetry']>>
    try {
      started = await this.runMutation(() => this.startRetry(turnId))
    } finally {
      this.pendingStarts -= 1
    }
    return started.ok ? this.executeAttempt(started.value) : started
  }

  async cancel(): Promise<ProjectConversationResult> {
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
    const turn: ConversationTurn = {
      id: this.createId(),
      userText: text,
      assistantText: null,
      quickReplies: [],
      quickReplySelection,
      attachments: [...attachments],
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
    const base = this.snapshot.document ?? createConversationDocument(now)
    return this.persistStartedAttempt({ ...base, turns: [...base.turns, turn], updatedAt: now }, attemptId)
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
    const pending: ConversationDocumentV1 = {
      ...document,
      updatedAt: now,
      turns: document.turns.map(candidate => candidate.id === turnId
        ? {
            ...candidate,
            assistantText: null,
            quickReplies: [],
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
    return this.persistStartedAttempt(pending, attemptId)
  }

  private async persistStartedAttempt(
    document: ConversationDocumentV1,
    attemptId: string,
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
    return { ok: true, value: { document, attemptId, requestId, controller } }
  }

  private async executeAttempt(started: StartedAttempt): Promise<ProjectConversationResult> {
    let response: Awaited<ReturnType<ConversationModel['respond']>>
    try {
      response = await this.model.respond({
        projectPath: this.projectPath,
        turns: started.document.turns,
        signal: started.controller.signal,
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
    const completed = this.mapAttempt(
      started.document,
      started.attemptId,
      turn => ({ ...turn, assistantText: response.text, quickReplies: response.quickReplies }),
      'completed',
      null,
      null,
      diagnostics,
    )
    const saved = await this.repository.save(this.projectPath, completed)
    if (!this.isCurrentRequest(started)) return failure('cancelled', '请求已取消')
    if (!saved.ok) {
      const persistenceFailed = this.mapAttempt(
        started.document,
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
      document: completed,
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
    const failed = this.mapAttempt(started.document, started.attemptId, turn => turn, status, error, kind, diagnostics)
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

  private persistTerminalFailure(document: ConversationDocumentV1, error: string): Extract<ProjectConversationResult, { ok: false }> {
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
    if (this.snapshot.loadStatus === 'loading') return failure('not-loaded', '对话尚未加载完成')
    if (this.snapshot.loadStatus === 'quarantined') return failure('quarantined', '对话文档已隔离，请先处理恢复')
    if (this.snapshot.loadStatus === 'failed') return failure('load-failed', '对话加载失败，请重新加载')
    if (this.snapshot.requiresReload) return failure('persistence', '对话持久化状态不确定，请重新加载')
    if (this.snapshot.isRunning) return failure('already-running', '当前轮次仍在运行')
    return { ok: true }
  }

  private mapAttempt(
    document: ConversationDocumentV1,
    attemptId: string,
    mapTurn: (turn: ConversationTurn) => ConversationTurn,
    status: Exclude<ConversationAttemptStatus, 'running'>,
    error: string | null,
    failureKind: ConversationAttemptFailureKind | null,
    diagnostics?: ConversationAttemptDiagnostics,
  ): ConversationDocumentV1 {
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
    return started.requestId === this.requestSequence &&
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

  private now(): string { return this.clock().toISOString() }
  private update(snapshot: ProjectConversationSnapshot): void {
    this.snapshot = snapshot
    this.listeners.forEach(listener => listener())
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
