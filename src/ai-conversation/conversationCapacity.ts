import type { ConversationDocument } from './conversationDocument'

const MEGABYTE = 1_000_000

export const DEFAULT_CONVERSATION_CAPACITY_LIMITS = {
  warningBytes: 10 * MEGABYTE,
  warningMessages: 5_000,
  hardBytes: 50 * MEGABYTE,
  hardMessages: 20_000,
} as const

export interface ConversationCapacityLimits {
  warningBytes: number
  warningMessages: number
  hardBytes: number
  hardMessages: number
}

export interface ConversationCapacity {
  level: 'normal' | 'warning' | 'hard'
  bytes: number
  messageCount: number
}

/** Measures the exact pretty-printed UTF-8 JSON written by the repository. */
export function measureConversationCapacity(
  document: ConversationDocument | null,
  limits: ConversationCapacityLimits = DEFAULT_CONVERSATION_CAPACITY_LIMITS,
): ConversationCapacity {
  if (!document) return { level: 'normal', bytes: 0, messageCount: 0 }
  const bytes = new TextEncoder().encode(JSON.stringify(document, null, 2)).byteLength
  const messageCount = document.turns.reduce((count, turn) =>
    count + 1 + (turn.assistantText === null ? 0 : 1), 0)
  const level = bytes > limits.hardBytes || messageCount > limits.hardMessages
    ? 'hard'
    : bytes > limits.warningBytes || messageCount > limits.warningMessages
      ? 'warning'
      : 'normal'
  return { level, bytes, messageCount }
}
