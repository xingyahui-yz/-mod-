export type ConversationIoOperation = 'load' | 'save'

export interface ConversationIoSample {
  operation: ConversationIoOperation
  durationMs: number
  bytes: number
  messageCount: number
  completedAt: number
}

export interface ConversationPerformanceMetrics {
  scope: 'current-project-session'
  sampleLimit: number
  load: { sampleCount: number; p95Ms: number | null }
  save: { sampleCount: number; p95Ms: number | null }
  softScale: {
    criteria: '>=10MB or >=5000 messages'
    load: { sampleCount: number; p95Ms: number | null }
    save: { sampleCount: number; p95Ms: number | null }
  }
  samples: readonly ConversationIoSample[]
}

export const CONVERSATION_SOFT_SCALE_BYTES = 10 * 1024 * 1024
export const CONVERSATION_SOFT_SCALE_MESSAGES = 5_000
const SAMPLE_LIMIT = 100

export function createConversationPerformanceTracker() {
  const samples: ConversationIoSample[] = []
  return {
    record(operation: ConversationIoOperation, durationMs: number, bytes: number, messageCount: number) {
      samples.push({ operation, durationMs: Math.max(0, durationMs), bytes, messageCount, completedAt: Date.now() })
      if (samples.length > SAMPLE_LIMIT) samples.splice(0, samples.length - SAMPLE_LIMIT)
    },
    snapshot(): ConversationPerformanceMetrics {
      const summarize = (selected: readonly ConversationIoSample[]) => ({
        sampleCount: selected.length,
        p95Ms: percentile95(selected.map(sample => sample.durationMs)),
      })
      const isOperation = (operation: ConversationIoOperation) => samples.filter(sample => sample.operation === operation)
      const softScale = (operation: ConversationIoOperation) => isOperation(operation).filter(sample =>
        sample.bytes >= CONVERSATION_SOFT_SCALE_BYTES || sample.messageCount >= CONVERSATION_SOFT_SCALE_MESSAGES,
      )
      return {
        scope: 'current-project-session',
        sampleLimit: SAMPLE_LIMIT,
        load: summarize(isOperation('load')),
        save: summarize(isOperation('save')),
        softScale: {
          criteria: '>=10MB or >=5000 messages',
          load: summarize(softScale('load')),
          save: summarize(softScale('save')),
        },
        samples: samples.map(sample => ({ ...sample })),
      }
    },
  }
}

function percentile95(values: readonly number[]): number | null {
  if (values.length === 0) return null
  const sorted = [...values].sort((left, right) => left - right)
  return sorted[Math.ceil(sorted.length * 0.95) - 1]
}
