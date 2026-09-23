/**
 * Base LLM Adapter 测试
 */
import { describe, it, expect } from 'vitest'
import { BaseLLMAdapter, type LLMRequestOptions, type LLMResponse, sanitizeProviderError } from './base'

// 测试用MockAdapter
class MockAdapter extends BaseLLMAdapter {
  getModelName(): string {
    return 'mock'
  }

  async generate(prompt: string, options?: LLMRequestOptions): Promise<LLMResponse> {
    return { success: true, content: JSON.stringify({ prompt, hasSignal: Boolean(options?.signal) }) }
  }
}

describe('BaseLLMAdapter', () => {
  it('provider 错误会脱敏并限长', () => {
    const secret = 'sk-secret-value'
    const sanitized = sanitizeProviderError(`Authorization: Bearer ${secret} ${'x'.repeat(700)}`, [secret])
    expect(sanitized).not.toContain(secret)
    expect(sanitized).toContain('[REDACTED]')
    expect(sanitized.length).toBeLessThanOrEqual(480)
  })

  it('只定义统一 generate 契约，并透传外部 AbortSignal', async () => {
    const adapter = new MockAdapter({ apiKey: 'test' })
    const controller = new AbortController()

    const result = await adapter.generate('hello', { signal: controller.signal })

    expect(result).toEqual({ success: true, content: '{"prompt":"hello","hasSignal":true}' })
    expect(adapter.diagnostics()).toEqual({ provider: 'custom', model: 'mock' })
  })
})
