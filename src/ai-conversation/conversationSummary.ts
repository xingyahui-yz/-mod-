import type { ConversationRollingSummaryV1, ConversationTurn } from './conversationDocument'
import { estimateConversationTokensConservatively } from '../services/llm/conversationBudget'

/** Refresh only after a completed turn pushes unsummarized conversation text past this estimate. */
export const CONVERSATION_SUMMARY_REFRESH_THRESHOLD_TOKENS = 3000
export const CONVERSATION_SUMMARY_MAX_TEXT_LENGTH = 4000

export interface ConversationSummaryCursor {
  throughTurnId: string
  text: string
}

/** Turns after the last summarized turn; invalid cursors fail closed to the full history. */
export function getUnsummarizedTurns(
  turns: readonly ConversationTurn[],
  summary: ConversationSummaryCursor | null,
): readonly ConversationTurn[] {
  if (!summary) return turns
  const index = turns.findIndex(turn => turn.id === summary.throughTurnId)
  if (index < 0) return turns
  return turns.slice(index + 1)
}

/** Approximate user/assistant message cost without relying on provider-specific tokenizers. */
export function estimateUnsummarizedConversationTokens(turns: readonly ConversationTurn[]): number {
  return turns.reduce((total, turn) => {
    const user = JSON.stringify({ role: 'user', content: turn.userText })
    const assistant = turn.assistantText === null ? '' : JSON.stringify({ role: 'assistant', content: turn.assistantText })
    return total + estimateConversationTokensConservatively(user) +
      (assistant ? estimateConversationTokensConservatively(assistant) : 0)
  }, 0)
}

/** Only user intent and preferences enter this LLM-derived layer; local facts remain separate. */
export function buildConversationSummaryInput(
  previousSummary: string | null,
  turns: readonly ConversationTurn[],
): string {
  const messages = turns.flatMap(turn => [
    { role: 'user', content: turn.userText },
    ...(turn.assistantText === null ? [] : [{ role: 'assistant', content: turn.assistantText }]),
  ])
  return [
    '仅更新用户的长期目标、要求和偏好摘要；不要总结 Card 当前字段、Card ID 是否存在、提案状态或其他项目事实。',
    '这些项目事实由应用本地状态单独提供，必须以本地数据为准。',
    '保留仍有效的旧目标和偏好；不要把助手提出但用户未确认的建议写成用户偏好。',
    '只返回一个 JSON 对象：{"schemaVersion":1,"text":"最多 4000 字符的摘要"}。',
    JSON.stringify({ previousSummary, messages }),
  ].join('\n')
}

export interface ConversationSummaryGenerationRequest {
  previousSummary: string | null
  turns: readonly ConversationTurn[]
  signal: AbortSignal
}

export type ConversationSummaryGenerationResult =
  | { success: true; text: string }
  | { success: false; error: string; kind?: 'cancelled' | 'timeout' | 'provider' }

export function parseConversationIntentSummaryText(content: string): { ok: true; text: string } | { ok: false; error: string } {
  try {
    const fenced = content.trim().match(/^\x60\x60\x60(?:json)?\s*([\s\S]*?)\s*\x60\x60\x60$/i)
    const value: unknown = JSON.parse(fenced ? fenced[1] : content)
    if (!value || typeof value !== 'object' || Array.isArray(value)) return { ok: false, error: '摘要响应必须是 JSON 对象' }
    const record = value as Record<string, unknown>
    const keys = Object.keys(record).sort()
    if (keys.length !== 2 || keys[0] !== 'schemaVersion' || keys[1] !== 'text' || record.schemaVersion !== 1 || typeof record.text !== 'string') {
      return { ok: false, error: '摘要响应字段无效' }
    }
    const text = record.text.trim()
    if (!text || Array.from(text).length > CONVERSATION_SUMMARY_MAX_TEXT_LENGTH) return { ok: false, error: '摘要必须为 1 到 4000 个字符' }
    return { ok: true, text }
  } catch {
    return { ok: false, error: '模型没有返回有效的摘要 JSON' }
  }
}

export function toRollingSummary(
  throughTurnId: string,
  text: string,
  updatedAt: string,
): ConversationRollingSummaryV1 {
  return { throughTurnId, text, updatedAt }
}
