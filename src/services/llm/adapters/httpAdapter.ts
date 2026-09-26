/** HTTP adapters for the provider protocols used by Mod Studio's AI conversation. */
import { BaseLLMAdapter, type LLMConfig, type LLMResponse, sanitizeProviderError, type LLMAdapterDiagnostics, type LLMErrorType, type LLMRequestOptions } from './base'
import { LLM_PROVIDERS, getProviderPreset, type ApiKeyPlacement, type LLMProtocol } from '../providerCatalog'
import { defaultChatPath, defaultModelsPath, type ProviderSettings } from '../providerSettings'

export interface ProviderConfig extends LLMConfig {
  name: string
  baseUrl: string
  model: string
  protocol: LLMProtocol
  keyPlacement: ApiKeyPlacement
}

/** Kept as a registry seam for older call sites and provider-specific tests. */
export const PROVIDER_CONFIGS: Record<string, ProviderConfig> = Object.fromEntries(
  LLM_PROVIDERS.map(provider => [provider.id, {
    apiKey: '',
    name: provider.name,
    baseUrl: provider.baseUrl,
    model: provider.defaultModel ?? '',
    protocol: provider.protocol,
    keyPlacement: provider.keyPlacement,
  }]),
)

export class HTTPAdapter extends BaseLLMAdapter {
  private providerConfig: ProviderConfig
  private readonly providerId: string
  private lastRequestId: string | undefined

  constructor(provider: string, config: LLMConfig) {
    super(config)
    const preset = getProviderPreset(provider) ?? getProviderPreset('minimax')!
    const protocol = config.protocol ?? preset.protocol
    this.providerId = provider
    this.providerConfig = {
      name: config.name ?? preset.name,
      baseUrl: config.baseUrl ?? preset.baseUrl,
      model: config.model ?? preset.defaultModel ?? '',
      protocol,
      keyPlacement: config.keyPlacement ?? preset.keyPlacement,
      chatPath: config.chatPath ?? defaultChatPath(protocol),
      modelsPath: config.modelsPath ?? defaultModelsPath(protocol),
      apiKeyQueryParam: config.apiKeyQueryParam ?? 'key',
      extraHeadersJson: config.extraHeadersJson ?? '{}',
      extraQueryJson: config.extraQueryJson ?? '{}',
      extraBodyJson: config.extraBodyJson ?? '{}',
      temperature: config.temperature ?? 0.7,
      maxTokens: config.maxTokens ?? 2048,
      topP: config.topP ?? 1,
      enableThinking: config.enableThinking ?? false,
      apiKey: config.apiKey,
    }
    this.config = this.providerConfig
  }

  getModelName(): string {
    return this.providerConfig.model || '未选择模型'
  }

  diagnostics(): LLMAdapterDiagnostics {
    return {
      provider: this.providerId,
      model: this.providerConfig.model || '未选择模型',
      ...(this.lastRequestId ? { requestId: this.lastRequestId } : {}),
    }
  }

  async generate(prompt: string, options: LLMRequestOptions = {}): Promise<LLMResponse> {
    if (!this.providerConfig.model.trim()) {
      return { success: false, error: '请先在模型服务设置中获取或添加模型', errorType: 'provider' }
    }
    if (!this.providerConfig.baseUrl.trim()) {
      return { success: false, error: '请先填写服务商 API 地址', errorType: 'provider' }
    }

    const abort = createAbortScope(options.signal, options.timeoutMs ?? 30000)
    try {
      if (abort.signal.aborted) return abortFailure(abort.errorType())
      const request = buildChatRequest(this.providerConfig, prompt)
      const response = await fetch(request.url, {
        method: 'POST',
        headers: request.headers,
        body: JSON.stringify(request.body),
        signal: abort.signal,
      })
      if (abort.signal.aborted) return abortFailure(abort.errorType())
      this.lastRequestId = readRequestId(response)

      const data = await response.json().catch(() => ({}))
      if (abort.signal.aborted) return abortFailure(abort.errorType())
      if (!response.ok) {
        return {
          success: false,
          error: sanitizeProviderError(extractError(data) || `API 错误: ${response.status}`, [this.config.apiKey]),
          errorType: 'provider',
        }
      }

      const content = extractResponseText(this.providerConfig.protocol, data)
      return content
        ? { success: true, content }
        : { success: false, error: '服务商返回了空内容或不支持的响应格式', errorType: 'provider' }
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

export interface DiscoveredModel {
  id: string
  name: string
}

export async function fetchProviderModels(
  settings: ProviderSettings,
  apiKey: string,
  options: { signal?: AbortSignal; timeoutMs?: number } = {},
): Promise<DiscoveredModel[]> {
  if (!settings.baseUrl.trim()) throw new Error('请先填写服务商 API 地址')
  const config = { ...settings, apiKey, model: settings.selectedModel } as ProviderConfig
  const abort = createAbortScope(options.signal, options.timeoutMs ?? 15000)
  try {
    const url = addQueryParameters(
      buildEndpointUrl(config.baseUrl, config.modelsPath ?? defaultModelsPath(config.protocol), '', false),
      config,
      apiKey,
    )
    const response = await fetch(url, {
      method: 'GET',
      headers: createHeaders(config, apiKey),
      signal: abort.signal,
    })
    if (abort.signal.aborted) throw abortFailure(abort.errorType())
    const data = await response.json().catch(() => ({}))
    if (!response.ok) throw new Error(sanitizeProviderError(extractError(data) || `API 错误: ${response.status}`, [apiKey]))
    const items = extractModelItems(settings.protocol, data)
    if (items.length === 0) throw new Error('服务商没有返回模型列表；你仍可手动添加模型 ID')
    return items
  } catch (error) {
    if (abort.errorType()) throw new Error(abortFailure(abort.errorType()).error)
    throw new Error(sanitizeProviderError(error, [apiKey]))
  } finally {
    abort.dispose()
  }
}

export async function testProviderConnection(
  settings: ProviderSettings,
  apiKey: string,
  model: string,
): Promise<LLMResponse> {
  const adapter = new HTTPAdapter(settings.id, { ...settings, apiKey, model })
  return adapter.generate('请只回复：连接成功', { timeoutMs: 20000 })
}

function buildChatRequest(config: ProviderConfig, prompt: string): { url: string; headers: Record<string, string>; body: Record<string, unknown> } {
  const path = config.chatPath ?? defaultChatPath(config.protocol)
  const url = addQueryParameters(
    buildEndpointUrl(config.baseUrl, path, config.model),
    config,
    config.apiKey,
  )
  const headers = createHeaders(config, config.apiKey)
  const temperature = config.temperature ?? 0.7
  const maxTokens = config.maxTokens ?? 2048
  const topP = config.topP ?? 1
  const extraBody = parseJsonObject(config.extraBodyJson)

  switch (config.protocol) {
    case 'anthropic-messages':
      headers['anthropic-version'] = headers['anthropic-version'] ?? '2023-06-01'
      return { url, headers, body: { ...{
        model: config.model,
        max_tokens: maxTokens,
        temperature,
        top_p: topP,
        messages: [{ role: 'user', content: prompt }],
      }, ...extraBody } }
    case 'gemini':
      return { url, headers, body: { ...{
        contents: [{ role: 'user', parts: [{ text: prompt }] }],
        generationConfig: { temperature, topP, maxOutputTokens: maxTokens },
        ...(config.enableThinking ? { thinkingConfig: { includeThoughts: true } } : {}),
      }, ...extraBody } }
    case 'ollama':
      return { url, headers, body: { ...{
        model: config.model,
        stream: false,
        messages: [{ role: 'user', content: prompt }],
        options: { temperature, top_p: topP, num_predict: maxTokens },
      }, ...extraBody } }
    case 'openai-responses':
      return { url, headers, body: { ...{
        model: config.model,
        input: [{ role: 'user', content: [{ type: 'input_text', text: prompt }] }],
        temperature,
        top_p: topP,
        max_output_tokens: maxTokens,
      }, ...extraBody } }
    default:
      return { url, headers, body: { ...{
        model: config.model,
        messages: [{ role: 'user', content: prompt }],
        temperature,
        top_p: topP,
        max_tokens: maxTokens,
        ...(config.enableThinking ? { enable_thinking: true } : {}),
      }, ...extraBody } }
  }
}

function createHeaders(config: ProviderConfig, apiKey: string): Record<string, string> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
  if (config.protocol === 'anthropic-messages') headers['anthropic-version'] = '2023-06-01'
  switch (config.keyPlacement) {
    case 'bearer': if (apiKey) headers.Authorization = `Bearer ${apiKey}`; break
    case 'api-key': if (apiKey) headers['api-key'] = apiKey; break
    case 'x-api-key': if (apiKey) headers['x-api-key'] = apiKey; break
    case 'query':
    case 'none':
      break
  }
  Object.assign(headers, parseJsonRecord(config.extraHeadersJson))
  return headers
}

function buildEndpointUrl(baseUrl: string, endpointPath: string, model = '', exactBase = true): string {
  const resolvedPath = endpointPath.replaceAll('{model}', encodeURIComponent(model))
  if (/^https?:\/\//i.test(resolvedPath)) return resolvedPath.replace(/#$/, '')
  const base = baseUrl.trim().replace(/#$/, '').replace(/\/+$/, '')
  if (!base) return ''
  if (exactBase && baseUrl.trim().endsWith('#')) return base
  if (!resolvedPath) return base
  return `${base}/${resolvedPath.replace(/^\/+/, '').replace(/#$/, '')}`
}

function addQueryParameters(url: string, config: ProviderConfig, apiKey: string): string {
  const query = parseJsonRecord(config.extraQueryJson)
  if (config.keyPlacement === 'query' && apiKey) {
    query[config.apiKeyQueryParam?.trim() || 'key'] = apiKey
  }
  const entries = Object.entries(query)
  if (!entries.length) return url
  try {
    const parsed = new URL(url)
    for (const [key, value] of entries) parsed.searchParams.set(key, value)
    return parsed.toString()
  } catch {
    const separator = url.includes('?') ? '&' : '?'
    return `${url}${separator}${entries.map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(value)}`).join('&')}`
  }
}

function parseJsonRecord(input?: string): Record<string, string> {
  if (!input?.trim()) return {}
  try {
    const parsed: unknown = JSON.parse(input)
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {}
    return Object.fromEntries(Object.entries(parsed).filter((entry): entry is [string, string] => typeof entry[1] === 'string'))
  } catch {
    return {}
  }
}

function parseJsonObject(input?: string): Record<string, unknown> {
  if (!input?.trim()) return {}
  try {
    const parsed: unknown = JSON.parse(input)
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : {}
  } catch {
    return {}
  }
}

function extractModelItems(protocol: LLMProtocol, payload: unknown): DiscoveredModel[] {
  if (!payload || typeof payload !== 'object') return []
  const record = payload as Record<string, unknown>
  const source = protocol === 'gemini'
    ? record.models
    : protocol === 'ollama'
      ? record.models
      : record.data
  if (!Array.isArray(source)) return []
  const models = source.flatMap(item => {
    if (!item || typeof item !== 'object') return []
    const value = item as Record<string, unknown>
    const rawId = typeof value.id === 'string' ? value.id : typeof value.name === 'string' ? value.name : ''
    if (!rawId) return []
    const id = protocol === 'gemini' ? rawId.replace(/^models\//, '') : rawId
    const name = typeof value.display_name === 'string'
      ? value.display_name
      : typeof value.displayName === 'string'
        ? value.displayName
        : typeof value.name === 'string' && protocol !== 'gemini'
          ? value.name
          : id
    return [{ id, name }]
  })
  return models.filter((item, index) => models.findIndex(candidate => candidate.id === item.id) === index)
}

function extractResponseText(protocol: LLMProtocol, payload: unknown): string | undefined {
  if (!payload || typeof payload !== 'object') return undefined
  const record = payload as Record<string, unknown>
  if (protocol === 'ollama') {
    const message = record.message
    return typeof record.response === 'string'
      ? record.response
      : message && typeof message === 'object' && typeof (message as Record<string, unknown>).content === 'string'
        ? (message as Record<string, unknown>).content as string
        : undefined
  }
  if (protocol === 'gemini') {
    const candidate = Array.isArray(record.candidates) ? record.candidates[0] : undefined
    const content = candidate && typeof candidate === 'object' ? (candidate as Record<string, unknown>).content : undefined
    const parts = content && typeof content === 'object' ? (content as Record<string, unknown>).parts : undefined
    return Array.isArray(parts)
      ? parts.map(part => part && typeof part === 'object' ? (part as Record<string, unknown>).text : undefined).filter((text): text is string => typeof text === 'string').join('') || undefined
      : undefined
  }
  if (protocol === 'anthropic-messages') {
    return Array.isArray(record.content)
      ? record.content.map(part => part && typeof part === 'object' ? (part as Record<string, unknown>).text : undefined).filter((text): text is string => typeof text === 'string').join('') || undefined
      : undefined
  }
  if (protocol === 'openai-responses') {
    if (typeof record.output_text === 'string') return record.output_text
    return Array.isArray(record.output)
      ? record.output.flatMap(item => {
          const content = item && typeof item === 'object' ? (item as Record<string, unknown>).content : undefined
          return Array.isArray(content) ? content.map(part => part && typeof part === 'object' ? (part as Record<string, unknown>).text : undefined) : []
        }).filter((text): text is string => typeof text === 'string').join('') || undefined
      : undefined
  }
  const choices = record.choices
  const choice = Array.isArray(choices) ? choices[0] : undefined
  const message = choice && typeof choice === 'object' ? (choice as Record<string, unknown>).message : undefined
  const content = message && typeof message === 'object' ? (message as Record<string, unknown>).content : undefined
  if (typeof content === 'string') return content
  return Array.isArray(content)
    ? content.map(part => part && typeof part === 'object' ? (part as Record<string, unknown>).text : undefined).filter((text): text is string => typeof text === 'string').join('') || undefined
    : undefined
}

function extractError(payload: unknown): string | undefined {
  if (!payload || typeof payload !== 'object') return undefined
  const record = payload as Record<string, unknown>
  const error = record.error
  if (typeof error === 'string') return error
  if (error && typeof error === 'object') {
    const message = (error as Record<string, unknown>).message
    if (typeof message === 'string') return message
  }
  return typeof record.message === 'string' ? record.message : undefined
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
  if (errorType === 'timeout') return { success: false, error: '请求超时，请检查网络连接', errorType }
  return { success: false, error: '请求已取消', errorType: 'cancelled' }
}
