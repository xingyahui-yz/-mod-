/** Registry and factory for the provider protocol adapters. */
import { BaseLLMAdapter, type LLMConfig } from './base'
import { HTTPAdapter } from './httpAdapter'
import { LLM_PROVIDERS, type LLMProviderInfo } from '../providerCatalog'

export type LLMProvider = string
export { LLM_PROVIDERS }
export type { LLMProviderInfo }
export type { LLMProtocol, ApiKeyPlacement } from '../providerCatalog'

export function createAdapter(provider: LLMProvider, apiKeyOrConfig: string | LLMConfig): BaseLLMAdapter {
  const config = typeof apiKeyOrConfig === 'string' ? { apiKey: apiKeyOrConfig } : apiKeyOrConfig
  return new HTTPAdapter(provider, config)
}

export { BaseLLMAdapter } from './base'
export type { LLMResponse, LLMErrorType, LLMRequestOptions, LLMAdapterDiagnostics, LLMConfig } from './base'
export { HTTPAdapter, fetchProviderModels, testProviderConnection, PROVIDER_CONFIGS } from './httpAdapter'
export type { ProviderConfig, DiscoveredModel } from './httpAdapter'
export { createConversationModel } from './conversationModel'
export { createProviderSettings, normalizeProviderSettings, providerHasUsableKey, providerIsReady } from '../providerSettings'
export type { ProviderSettings, ProviderApiKey } from '../providerSettings'
