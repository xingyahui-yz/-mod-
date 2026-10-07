import { getProviderPreset, type ApiKeyPlacement, type LLMProtocol } from './providerCatalog'

export interface ProviderApiKey {
  id: string
  label: string
  value: string
  enabled: boolean
}

export interface ProviderSettings {
  id: string
  name: string
  protocol: LLMProtocol
  keyPlacement: ApiKeyPlacement
  requiresApiKey: boolean
  baseUrl: string
  chatPath: string
  modelsPath: string
  apiKeyQueryParam: string
  extraHeadersJson: string
  extraQueryJson: string
  extraBodyJson: string
  apiKeys: ProviderApiKey[]
  models: string[]
  selectedModel: string
  enabled: boolean
  temperature: number
  maxTokens: number
  topP: number
  enableThinking: boolean
  unavailableReason?: string
}

export function defaultChatPath(protocol: LLMProtocol): string {
  switch (protocol) {
    case 'anthropic-messages': return '/v1/messages'
    case 'gemini': return '/v1beta/models/{model}:generateContent'
    case 'ollama': return '/api/chat'
    case 'openai-responses': return '/responses'
    default: return '/chat/completions'
  }
}

export function defaultModelsPath(protocol: LLMProtocol): string {
  switch (protocol) {
    case 'anthropic-messages': return '/v1/models'
    case 'gemini': return '/v1beta/models'
    case 'ollama': return '/api/tags'
    default: return '/models'
  }
}

export function createProviderSettings(id: string): ProviderSettings {
  const preset = getProviderPreset(id)
  if (!preset) {
    return {
      id,
      name: id,
      protocol: 'openai-chat',
      keyPlacement: 'bearer',
      requiresApiKey: true,
      baseUrl: '',
      chatPath: defaultChatPath('openai-chat'),
      modelsPath: defaultModelsPath('openai-chat'),
      apiKeyQueryParam: 'key',
      extraHeadersJson: '{}',
      extraQueryJson: '{}',
      extraBodyJson: '{}',
      apiKeys: [{ id: 'key-default', label: '主密钥', value: '', enabled: true }],
      models: [],
      selectedModel: '',
      enabled: true,
      temperature: 0.7,
      maxTokens: 2048,
      topP: 1,
      enableThinking: false,
    }
  }

  const selectedModel = preset.defaultModel ?? ''
  return {
    id: preset.id,
    name: preset.name,
    protocol: preset.protocol,
    keyPlacement: preset.keyPlacement,
    requiresApiKey: preset.requiresApiKey,
    baseUrl: preset.baseUrl,
    chatPath: defaultChatPath(preset.protocol),
    modelsPath: defaultModelsPath(preset.protocol),
    apiKeyQueryParam: 'key',
    extraHeadersJson: '{}',
    extraQueryJson: '{}',
    extraBodyJson: '{}',
    apiKeys: [{ id: 'key-default', label: '主密钥', value: '', enabled: true }],
    models: selectedModel ? [selectedModel] : [],
    selectedModel,
    enabled: !preset.unavailableReason,
    temperature: 0.7,
    maxTokens: 2048,
    topP: 1,
    enableThinking: false,
    ...(preset.unavailableReason ? { unavailableReason: preset.unavailableReason } : {}),
  }
}

export function normalizeProviderSettings(id: string, value: Partial<ProviderSettings> | undefined): ProviderSettings {
  const defaults = createProviderSettings(id)
  if (!value) return defaults
  const protocol = value.protocol ?? defaults.protocol
  const apiKeys = Array.isArray(value.apiKeys)
    ? value.apiKeys
        .filter(key => key && typeof key.value === 'string')
        .map((key, index) => ({
          id: typeof key.id === 'string' ? key.id : `key-${index + 1}`,
          label: typeof key.label === 'string' && key.label.trim() ? key.label.trim() : `密钥 ${index + 1}`,
          value: key.value.trim(),
          enabled: key.enabled !== false,
        }))
    : defaults.apiKeys
  const models = Array.isArray(value.models)
    ? value.models.filter((model): model is string => typeof model === 'string' && model.trim().length > 0)
    : defaults.models
  const selectedModel = typeof value.selectedModel === 'string' ? value.selectedModel : defaults.selectedModel

  return {
    ...defaults,
    ...value,
    id,
    name: typeof value.name === 'string' && value.name.trim() ? value.name.trim() : defaults.name,
    protocol,
    chatPath: typeof value.chatPath === 'string' ? value.chatPath : defaultChatPath(protocol),
    modelsPath: typeof value.modelsPath === 'string' ? value.modelsPath : defaultModelsPath(protocol),
    baseUrl: typeof value.baseUrl === 'string' ? value.baseUrl : defaults.baseUrl,
    apiKeyQueryParam: typeof value.apiKeyQueryParam === 'string' ? value.apiKeyQueryParam : 'key',
    extraHeadersJson: typeof value.extraHeadersJson === 'string' ? value.extraHeadersJson : '{}',
    extraQueryJson: typeof value.extraQueryJson === 'string' ? value.extraQueryJson : '{}',
    extraBodyJson: typeof value.extraBodyJson === 'string' ? value.extraBodyJson : '{}',
    apiKeys,
    models: models.includes(selectedModel) || !selectedModel ? models : [selectedModel, ...models],
    selectedModel,
    enabled: typeof value.enabled === 'boolean' ? value.enabled : defaults.enabled,
    temperature: finiteNumber(value.temperature, defaults.temperature),
    maxTokens: Math.max(1, Math.floor(finiteNumber(value.maxTokens, defaults.maxTokens))),
    topP: finiteNumber(value.topP, defaults.topP),
    enableThinking: value.enableThinking === true,
  }
}

export function providerHasUsableKey(settings: ProviderSettings): boolean {
  return !settings.requiresApiKey || settings.apiKeys.some(key => key.enabled && key.value.trim().length > 0)
}

export function providerIsReady(settings: ProviderSettings): boolean {
  return settings.enabled && providerHasUsableKey(settings) && Boolean(settings.selectedModel.trim())
}

function finiteNumber(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback
}
