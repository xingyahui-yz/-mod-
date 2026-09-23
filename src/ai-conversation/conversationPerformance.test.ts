import { describe, expect, it } from 'vitest'
import { createConversationPerformanceTracker, CONVERSATION_SOFT_SCALE_BYTES } from './conversationPerformance'

describe('conversation performance tracker', () => {
  it('只保留最近 100 个样本，并按 nearest-rank 计算 p95', () => {
    const tracker = createConversationPerformanceTracker()
    for (let index = 1; index <= 101; index += 1) tracker.record('save', index, 10, 1)

    const metrics = tracker.snapshot()
    expect(metrics.save).toEqual({ sampleCount: 100, p95Ms: 96 })
    expect(metrics.samples).toHaveLength(100)
    expect(metrics.samples[0].durationMs).toBe(2)
  })

  it('只将软阈值规模及以上样本纳入 SQLite 性能评估', () => {
    const tracker = createConversationPerformanceTracker()
    tracker.record('load', 100, CONVERSATION_SOFT_SCALE_BYTES, 10)
    tracker.record('load', 700, CONVERSATION_SOFT_SCALE_BYTES - 1, 4_999)
    tracker.record('save', 520, 1, 5_000)

    expect(tracker.snapshot().softScale).toMatchObject({
      load: { sampleCount: 1, p95Ms: 100 },
      save: { sampleCount: 1, p95Ms: 520 },
    })
  })
})
