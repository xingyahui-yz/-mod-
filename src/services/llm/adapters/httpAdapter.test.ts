import { afterEach, describe, expect, it, vi } from 'vitest'
import { HTTPAdapter } from './httpAdapter'

afterEach(() => {
  vi.restoreAllMocks()
})

describe('HTTPAdapter cancellation', () => {
  it('外部 AbortSignal 取消时返回 cancelled', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation((_input, init) => new Promise((_resolve, reject) => {
      init?.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')), { once: true })
    }))
    const controller = new AbortController()
    const request = new HTTPAdapter('qwen', { apiKey: 'key' }).generate('hello', { signal: controller.signal })

    controller.abort()

    await expect(request).resolves.toMatchObject({ success: false, errorType: 'cancelled' })
  })

  it('provider 忽略取消并迟到返回时仍丢弃响应', async () => {
    let finish: ((response: Response) => void) | undefined
    vi.spyOn(globalThis, 'fetch').mockImplementation(() => new Promise(resolve => { finish = resolve }))
    const controller = new AbortController()
    const request = new HTTPAdapter('qwen', { apiKey: 'key' }).generate('hello', { signal: controller.signal })

    controller.abort()
    finish?.({
      ok: true,
      json: async () => ({ choices: [{ message: { content: 'late' } }] }),
    } as Response)

    await expect(request).resolves.toMatchObject({ success: false, errorType: 'cancelled' })
  })

  it('内部截止时间到达时返回 timeout', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation((_input, init) => new Promise((_resolve, reject) => {
      init?.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')), { once: true })
    }))

    const result = await new HTTPAdapter('qwen', { apiKey: 'key' }).generate('hello', { timeoutMs: 1 })

    expect(result).toMatchObject({ success: false, errorType: 'timeout' })
  })

  it('HTTP 错误与网络错误归类为 provider', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: false,
      status: 429,
      json: async () => ({ error: { message: 'rate limited' } }),
    } as Response)

    await expect(new HTTPAdapter('qwen', { apiKey: 'key' }).generate('hello'))
      .resolves.toEqual({ success: false, error: 'rate limited', errorType: 'provider' })
  })

  it('provider 错误不会泄露 API key，并暴露真实 provider/model diagnostics', async () => {
    const secret = 'sk-secret-value'
    vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: false,
      status: 401,
      headers: new Headers({ 'x-request-id': 'request-42' }),
      json: async () => ({ error: { message: `Bearer ${secret} is invalid` } }),
    } as Response)
    const adapter = new HTTPAdapter('qwen', { apiKey: secret })

    const result = await adapter.generate('hello')

    expect(result.error).not.toContain(secret)
    expect(result.error).toContain('[REDACTED]')
    expect(adapter.diagnostics()).toEqual({ provider: 'qwen', model: 'qwen-turbo', requestId: 'request-42' })
  })
})
