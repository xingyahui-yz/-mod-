import { afterEach, describe, expect, it, vi } from 'vitest'
import { fetchProviderModels, HTTPAdapter } from './httpAdapter'
import { createProviderSettings } from '../providerSettings'

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

describe('provider protocols and model discovery', () => {
  it('calls OpenAI compatible providers with the selected model and key', async () => {
    const fetch = vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
      status: 200,
      headers: new Headers(),
      json: async () => ({ choices: [{ message: { content: 'ready' } }] }),
    } as Response)

    const result = await new HTTPAdapter('qwen', { apiKey: 'test-key', model: 'qwen-plus' }).generate('hello')

    expect(result).toEqual({ success: true, content: 'ready' })
    expect(fetch).toHaveBeenCalledWith(
      'https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({ Authorization: 'Bearer test-key' }),
        body: expect.stringContaining('qwen-plus'),
      }),
    )
  })

  it('passes provider-specific body fields and thinking options through compatible APIs', async () => {
    const fetch = vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
      status: 200,
      headers: new Headers(),
      json: async () => ({ choices: [{ message: { content: 'ready' } }] }),
    } as Response)

    await new HTTPAdapter('qwen', {
      apiKey: 'test-key',
      model: 'qwen-plus',
      enableThinking: true,
      extraBodyJson: '{"service_tier":"priority"}',
    }).generate('hello')

    const body = JSON.parse(String(fetch.mock.calls[0][1]?.body))
    expect(body).toMatchObject({ enable_thinking: true, service_tier: 'priority' })
  })

  it('sends Anthropic Messages requests with x-api-key and parses text blocks', async () => {
    const fetch = vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
      status: 200,
      headers: new Headers(),
      json: async () => ({ content: [{ type: 'text', text: 'anthropic ready' }] }),
    } as Response)

    const result = await new HTTPAdapter('anthropic', { apiKey: 'anthropic-key', model: 'claude-test' }).generate('hello')

    expect(result).toEqual({ success: true, content: 'anthropic ready' })
    expect(fetch).toHaveBeenCalledWith('https://api.anthropic.com/v1/messages', expect.objectContaining({
      headers: expect.objectContaining({ 'x-api-key': 'anthropic-key', 'anthropic-version': '2023-06-01' }),
    }))
  })

  it('sends Gemini API keys as query parameters and parses generated candidates', async () => {
    const fetch = vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
      status: 200,
      headers: new Headers(),
      json: async () => ({ candidates: [{ content: { parts: [{ text: 'gemini ready' }] } }] }),
    } as Response)

    const result = await new HTTPAdapter('gemini', { apiKey: 'gemini-key', model: 'gemini-2.5-flash' }).generate('hello')

    expect(result).toEqual({ success: true, content: 'gemini ready' })
    expect(String(fetch.mock.calls[0][0])).toContain('/v1beta/models/gemini-2.5-flash:generateContent?key=gemini-key')
  })

  it('fetches model IDs through a provider-specific protocol endpoint', async () => {
    const fetch = vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
      status: 200,
      headers: new Headers(),
      json: async () => ({ models: [{ name: 'models/gemini-2.5-flash', displayName: 'Gemini 2.5 Flash' }] }),
    } as Response)
    const gemini = createProviderSettings('gemini')

    await expect(fetchProviderModels(gemini, 'gemini-key')).resolves.toEqual([
      { id: 'gemini-2.5-flash', name: 'Gemini 2.5 Flash' },
    ])
    expect(String(fetch.mock.calls[0][0])).toContain('/v1beta/models?key=gemini-key')
  })

  it('rejects unsupported provider response shapes without exposing the key', async () => {
    const secret = 'private-key-value'
    vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: false,
      status: 401,
      headers: new Headers(),
      json: async () => ({ error: { message: `bad token ${secret}` } }),
    } as Response)

    await expect(fetchProviderModels(createProviderSettings('qwen'), secret)).rejects.toThrow('[REDACTED]')
  })
})
