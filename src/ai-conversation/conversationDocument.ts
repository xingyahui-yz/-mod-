import type { ConversationQuickReply } from './conversationResponse'

export type ConversationAttemptStatus = 'running' | 'completed' | 'failed' | 'cancelled' | 'interrupted'

export interface ConversationAttachment {
  cardId: string
  revision: string
}

export interface ConversationAttempt {
  id: string
  status: ConversationAttemptStatus
  startedAt: string
  finishedAt: string | null
  error: string | null
}

export interface ConversationTurn {
  id: string
  userText: string
  assistantText: string | null
  quickReplies: ConversationQuickReply[]
  attachments: ConversationAttachment[]
  attempts: ConversationAttempt[]
  createdAt: string
}

export interface ConversationDocumentV1 {
  schemaVersion: 1
  projectPath: string
  turns: ConversationTurn[]
  createdAt: string
  updatedAt: string
}

export type ConversationDocumentParseResult =
  | { ok: true; document: ConversationDocumentV1 }
  | { ok: false; reason: string; raw: unknown }

export function createConversationDocument(projectPath: string, now: string): ConversationDocumentV1 {
  return { schemaVersion: 1, projectPath, turns: [], createdAt: now, updatedAt: now }
}

export function parseConversationDocument(raw: unknown): ConversationDocumentParseResult {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return { ok: false, reason: '文档必须是对象', raw }
  const value = raw as Record<string, unknown>
  if (value.schemaVersion !== 1) return { ok: false, reason: '不支持的 schemaVersion', raw }
  if (typeof value.projectPath !== 'string' || !Array.isArray(value.turns) || typeof value.createdAt !== 'string' || typeof value.updatedAt !== 'string') {
    return { ok: false, reason: '文档字段无效', raw }
  }
  for (const turn of value.turns) {
    if (!isTurn(turn)) return { ok: false, reason: '轮次字段无效', raw }
  }
  return { ok: true, document: value as unknown as ConversationDocumentV1 }
}

function isTurn(input: unknown): input is ConversationTurn {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return false
  const turn = input as Record<string, unknown>
  if (typeof turn.id !== 'string' || typeof turn.userText !== 'string' || !(turn.assistantText === null || typeof turn.assistantText === 'string') ||
    !Array.isArray(turn.quickReplies) || !Array.isArray(turn.attachments) || !Array.isArray(turn.attempts) || typeof turn.createdAt !== 'string') return false
  return turn.attempts.every(attempt => {
    if (!attempt || typeof attempt !== 'object' || Array.isArray(attempt)) return false
    const item = attempt as Record<string, unknown>
    return typeof item.id === 'string' && ['running', 'completed', 'failed', 'cancelled', 'interrupted'].includes(String(item.status)) &&
      typeof item.startedAt === 'string' && (item.finishedAt === null || typeof item.finishedAt === 'string') &&
      (item.error === null || typeof item.error === 'string')
  })
}

export function interruptRunningAttempts(document: ConversationDocumentV1, now: string): ConversationDocumentV1 {
  let changed = false
  const turns = document.turns.map(turn => ({
    ...turn,
    attempts: turn.attempts.map(attempt => {
      if (attempt.status !== 'running') return attempt
      changed = true
      return { ...attempt, status: 'interrupted' as const, finishedAt: now, error: '应用在响应完成前中断' }
    }),
  }))
  return changed ? { ...document, turns, updatedAt: now } : document
}
