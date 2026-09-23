/**
 * LLM适配器基类接口
 * 所有模型适配器必须实现此接口
 */
export type LLMErrorType = 'cancelled' | 'timeout' | 'provider'

export interface LLMResponse {
  success: boolean
  content?: string
  error?: string
  /** 机器可判定的失败类别；旧调用方仍可继续展示 error。 */
  errorType?: LLMErrorType
}

export interface LLMRequestOptions {
  signal?: AbortSignal
  /** 默认由 HTTP adapter 使用 30 秒。测试或特殊调用可显式覆盖。 */
  timeoutMs?: number
}

export interface LLMAdapterDiagnostics {
  provider: string
  model: string
  requestId?: string
}

const MAX_PROVIDER_ERROR_LENGTH = 480

/** Provider 文本进入 Store/对话状态机之前的第一道脱敏与限长防线。 */
export function sanitizeProviderError(error: unknown, secrets: readonly string[] = []): string {
  let message = error instanceof Error ? error.message : String(error)
  message = message
    .replace(/\bBearer\s+[A-Za-z0-9._~+\/-]+/gi, 'Bearer [REDACTED]')
    .replace(/\bsk-[A-Za-z0-9_-]{6,}\b/g, '[REDACTED]')
  for (const secret of secrets) {
    if (secret) message = message.split(secret).join('[REDACTED]')
  }
  message = message.replace(/\s+/g, ' ').trim()
  if (!message) return 'Provider 请求失败'
  return message.length <= MAX_PROVIDER_ERROR_LENGTH
    ? message
    : `${message.slice(0, MAX_PROVIDER_ERROR_LENGTH - 1)}…`
}

export interface LLMConfig {
  apiKey: string
  baseUrl?: string
}

export abstract class BaseLLMAdapter {
  protected config: LLMConfig
  protected _modelName: string | null = null

  constructor(config: LLMConfig) {
    this.config = config
  }

  /** Lazy 访问 modelName，避免基类构造时派生类字段尚未初始化的 TS/JS 限制 */
  get modelName(): string {
    if (this._modelName === null) {
      this._modelName = this.getModelName()
    }
    return this._modelName
  }

  abstract getModelName(): string

  diagnostics(): LLMAdapterDiagnostics {
    return { provider: 'custom', model: this.modelName }
  }

  abstract generate(prompt: string, options?: LLMRequestOptions): Promise<LLMResponse>
}
