/**
 * HTTP LLM适配器
 * 统一的适配器，支持多个LLM提供商
 */
import { BaseLLMAdapter, LLMResponse, LLMConfig, sanitizeProviderError, type LLMAdapterDiagnostics, type LLMErrorType, type LLMRequestOptions } from './base'

export interface ProviderConfig {
  name: string
  baseUrl: string
  model: string
  headers?: Record<string, string>
}

// 预设的提供商配置
export const PROVIDER_CONFIGS: Record<string, ProviderConfig> = {
  minimax: {
    name: 'MiniMax',
    baseUrl: 'https://api.minimax.chat/v1',
    model: 'MiniMax-Text-01'
  },
  qwen: {
    name: '通义千问',
    baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
    model: 'qwen-turbo'
  },
  ernie: {
    name: '文心一言',
    baseUrl: 'https://qianfan.baidubce.com/v2/chat/completions',
    model: 'ernie-4.0-8k-latest'
  },
  chatglm: {
    name: 'ChatGLM',
    baseUrl: 'https://open.bigmodel.cn/api/paas/v4',
    model: 'glm-4-flash'
  }
}

export class HTTPAdapter extends BaseLLMAdapter {
  private providerConfig: ProviderConfig
  private readonly providerId: string
  private lastRequestId: string | undefined

  constructor(provider: string, config: LLMConfig) {
    super(config)
    this.providerId = PROVIDER_CONFIGS[provider] ? provider : 'minimax'
    this.providerConfig = PROVIDER_CONFIGS[this.providerId]
  }

  getModelName(): string {
    return this.providerConfig.name
  }

  diagnostics(): LLMAdapterDiagnostics {
    return {
      provider: this.providerId,
      model: this.providerConfig.model,
      ...(this.lastRequestId ? { requestId: this.lastRequestId } : {}),
    }
  }

  async generate(prompt: string, options: LLMRequestOptions = {}): Promise<LLMResponse> {
    const url = `${this.providerConfig.baseUrl}/chat/completions`
    const abort = createAbortScope(options.signal, options.timeoutMs ?? 30000)

    try {
      if (abort.signal.aborted) return abortFailure(abort.errorType())
      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${this.config.apiKey}`,
        ...this.providerConfig.headers
      }

      const body: Record<string, any> = {
        model: this.providerConfig.model,
        messages: [
          {
            role: 'user',
            content: prompt
          }
        ],
        temperature: 0.7,
        max_tokens: 2048
      }

      const response = await fetch(url, {
        method: 'POST',
        headers,
        body: JSON.stringify(body),
        signal: abort.signal,
      })
      if (abort.signal.aborted) return abortFailure(abort.errorType())
      this.lastRequestId = readRequestId(response)

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}))
        if (abort.signal.aborted) return abortFailure(abort.errorType())
        return {
          success: false,
          error: sanitizeProviderError(errorData.error?.message || `API错误: ${response.status}`, [this.config.apiKey]),
          errorType: 'provider',
        }
      }

      const data = await response.json()
      if (abort.signal.aborted) return abortFailure(abort.errorType())

      if (data.choices && data.choices[0]?.message?.content) {
        return {
          success: true,
          content: data.choices[0].message.content
        }
      }

      return {
        success: false,
        error: '无效的响应格式',
        errorType: 'provider',
      }
    } catch (err) {
      if (abort.errorType()) return abortFailure(abort.errorType())
      return {
        success: false,
        error: sanitizeProviderError(`请求失败: ${err}`, [this.config.apiKey]),
        errorType: 'provider',
      }
    } finally {
      abort.dispose()
    }
  }
}

function readRequestId(response: Response): string | undefined {
  const requestId = response.headers?.get('x-request-id') ?? response.headers?.get('request-id')
  return requestId ? sanitizeProviderError(requestId) : undefined
}

interface AbortScope {
  signal: AbortSignal
  errorType(): Exclude<LLMErrorType, 'provider'> | null
  dispose(): void
}

function createAbortScope(externalSignal: AbortSignal | undefined, timeoutMs: number): AbortScope {
  const controller = new AbortController()
  let kind: Exclude<LLMErrorType, 'provider'> | null = null
  const cancel = () => {
    if (controller.signal.aborted) return
    kind = 'cancelled'
    controller.abort()
  }

  if (externalSignal?.aborted) cancel()
  else externalSignal?.addEventListener('abort', cancel, { once: true })

  const delay = Number.isFinite(timeoutMs) ? Math.max(0, timeoutMs) : 30000
  const timeout = setTimeout(() => {
    if (controller.signal.aborted) return
    kind = 'timeout'
    controller.abort()
  }, delay)

  return {
    signal: controller.signal,
    errorType: () => kind,
    dispose: () => {
      clearTimeout(timeout)
      externalSignal?.removeEventListener('abort', cancel)
    },
  }
}

function abortFailure(errorType: Exclude<LLMErrorType, 'provider'> | null): LLMResponse {
  if (errorType === 'timeout') {
    return { success: false, error: '请求超时，请检查网络连接', errorType }
  }
  return { success: false, error: '请求已取消', errorType: 'cancelled' }
}
