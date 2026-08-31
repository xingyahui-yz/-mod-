import {
  createConversationDocument,
  interruptRunningAttempts,
  type ConversationAttachment,
  type ConversationDocumentV1,
  type ConversationTurn,
} from './conversationDocument'
import type { ConversationRepository, ConversationLoadResult } from './conversationRepository'
import { parseConversationResponseText, type ConversationResponseV1 } from './conversationResponse'

export interface ConversationRequest {
  projectPath: string
  turns: readonly ConversationTurn[]
  signal: AbortSignal
}

export interface ConversationModel {
  respond(request: ConversationRequest): Promise<{ success: true; content: string } | { success: false; error: string }>
}

export interface ProjectConversationSnapshot {
  document: ConversationDocumentV1 | null
  loadStatus: ConversationLoadResult['status'] | 'loading'
  quarantineReason: string | null
  isRunning: boolean
  lastError: string | null
}

type Listener = () => void

export class ProjectConversation {
  private snapshot: ProjectConversationSnapshot = {
    document: null,
    loadStatus: 'loading',
    quarantineReason: null,
    isRunning: false,
    lastError: null,
  }
  private listeners = new Set<Listener>()
  private abortController: AbortController | null = null
  private requestSequence = 0

  constructor(
    readonly projectPath: string,
    private readonly repository: ConversationRepository,
    private readonly model: ConversationModel,
    private readonly clock: () => Date = () => new Date(),
    private readonly createId: () => string = () => crypto.randomUUID(),
  ) {}

  getSnapshot = (): ProjectConversationSnapshot => this.snapshot
  subscribe = (listener: Listener) => { this.listeners.add(listener); return () => this.listeners.delete(listener) }

  async load(): Promise<void> {
    const result = await this.repository.load(this.projectPath)
    if (result.status === 'loaded') {
      const recovered = interruptRunningAttempts(result.document, this.now())
      if (recovered !== result.document) await this.repository.save(this.projectPath, recovered)
      this.update({ document: recovered, loadStatus: 'loaded', quarantineReason: null, isRunning: false, lastError: null })
    } else if (result.status === 'quarantined') {
      this.update({ document: null, loadStatus: 'quarantined', quarantineReason: result.reason, isRunning: false, lastError: result.reason })
    } else {
      this.update({ document: null, loadStatus: 'missing', quarantineReason: null, isRunning: false, lastError: null })
    }
  }

  async send(userText: string, attachments: readonly ConversationAttachment[] = []): Promise<{ ok: true } | { ok: false; error: string }> {
    const text = userText.trim()
    if (!text) return { ok: false, error: '请输入消息' }
    if (this.snapshot.isRunning) return { ok: false, error: '当前轮次仍在运行' }
    if (this.snapshot.loadStatus === 'quarantined') return { ok: false, error: '对话文档已隔离，请先处理恢复' }

    const now = this.now()
    const attemptId = this.createId()
    const turn: ConversationTurn = {
      id: this.createId(), userText: text, assistantText: null, quickReplies: [], attachments: [...attachments], createdAt: now,
      attempts: [{ id: attemptId, status: 'running', startedAt: now, finishedAt: null, error: null }],
    }
    const base = this.snapshot.document ?? createConversationDocument(this.projectPath, now)
    const pending = { ...base, turns: [...base.turns, turn], updatedAt: now }
    const saved = await this.repository.save(this.projectPath, pending)
    if (!saved.ok) {
      this.update({ ...this.snapshot, lastError: saved.error })
      return saved
    }

    const controller = new AbortController()
    const requestId = ++this.requestSequence
    this.abortController = controller
    this.update({ document: pending, loadStatus: 'loaded', quarantineReason: null, isRunning: true, lastError: null })
    let response: Awaited<ReturnType<ConversationModel['respond']>>
    try {
      response = await this.model.respond({ projectPath: this.projectPath, turns: pending.turns, signal: controller.signal })
    } catch (error) {
      response = { success: false, error: error instanceof Error ? error.message : String(error) }
    }
    if (requestId !== this.requestSequence || controller.signal.aborted) return { ok: false, error: '请求已取消' }

    if (!response.success) return this.finishFailure(pending, attemptId, response.error)
    const parsed = parseConversationResponseText(response.content)
    if (!parsed.ok) return this.finishFailure(pending, attemptId, parsed.error)
    return this.finishSuccess(pending, attemptId, parsed.value)
  }

  async cancel(): Promise<{ ok: true } | { ok: false; error: string }> {
    const document = this.snapshot.document
    if (!this.snapshot.isRunning || !this.abortController || !document) return { ok: true }
    this.abortController.abort()
    this.requestSequence += 1
    const completed = this.updateLastAttempt(document, 'cancelled', '用户取消')
    const saved = await this.repository.save(this.projectPath, completed)
    if (!saved.ok) {
      this.update({ ...this.snapshot, lastError: saved.error })
      return saved
    }
    this.update({ ...this.snapshot, document: completed, isRunning: false, lastError: null })
    return { ok: true }
  }

  private async finishSuccess(document: ConversationDocumentV1, attemptId: string, response: ConversationResponseV1) {
    const completed = this.mapAttempt(document, attemptId, turn => ({ ...turn, assistantText: response.text, quickReplies: response.quickReplies }), 'completed', null)
    const saved = await this.repository.save(this.projectPath, completed)
    if (!saved.ok) {
      this.update({ ...this.snapshot, isRunning: false, lastError: saved.error })
      return saved
    }
    this.update({ ...this.snapshot, document: completed, isRunning: false, lastError: null })
    return { ok: true } as const
  }

  private async finishFailure(document: ConversationDocumentV1, attemptId: string, error: string) {
    const failed = this.mapAttempt(document, attemptId, turn => turn, 'failed', error)
    const saved = await this.repository.save(this.projectPath, failed)
    if (!saved.ok) error = `${error}；${saved.error}`
    this.update({ ...this.snapshot, document: saved.ok ? failed : document, isRunning: false, lastError: error })
    return { ok: false, error } as const
  }

  private updateLastAttempt(document: ConversationDocumentV1, status: 'cancelled', error: string) {
    const turn = document.turns[document.turns.length - 1]
    const attempt = turn?.attempts[turn.attempts.length - 1]
    return attempt ? this.mapAttempt(document, attempt.id, value => value, status, error) : document
  }

  private mapAttempt(document: ConversationDocumentV1, attemptId: string, mapTurn: (turn: ConversationTurn) => ConversationTurn, status: 'completed' | 'failed' | 'cancelled', error: string | null) {
    const finishedAt = this.now()
    return {
      ...document,
      updatedAt: finishedAt,
      turns: document.turns.map(turn => {
        if (!turn.attempts.some(attempt => attempt.id === attemptId)) return turn
        const mapped = mapTurn(turn)
        return { ...mapped, attempts: mapped.attempts.map(attempt => attempt.id === attemptId ? { ...attempt, status, finishedAt, error } : attempt) }
      }),
    }
  }

  private now() { return this.clock().toISOString() }
  private update(snapshot: ProjectConversationSnapshot) { this.snapshot = snapshot; this.listeners.forEach(listener => listener()) }
}
