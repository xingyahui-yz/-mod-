import { beforeEach, describe, expect, it } from 'vitest'
import { LLM_PROVIDERS } from '../services/llm/providerCatalog'
import { createProviderSettings } from '../services/llm/providerSettings'
import { createAIStore } from './useAIStore'

describe('useAIStore', () => {
  beforeEach(() => {
    localStorage.clear()
  })

  it('provides a model-service directory with 60+ built-in providers', () => {
    const store = createAIStore({ persistName: 'ai-config-directory' })

    expect(LLM_PROVIDERS.length).toBeGreaterThanOrEqual(60)
    expect(store.getState().providerSettings.openai.protocol).toBe('openai-responses')
    expect(store.getState().providerSettings.anthropic.protocol).toBe('anthropic-messages')
    expect(store.getState().providerSettings.gemini.protocol).toBe('gemini')
    expect(store.getState().providerSettings.ollama.protocol).toBe('ollama')
  })

  it('normalizes a primary API Key and derives readiness from the selected model', () => {
    const store = createAIStore({ persistName: 'ai-config-key' })

    store.getState().setApiKey('  secret-key  ')
    expect(store.getState()).toMatchObject({
      apiKey: 'secret-key',
      isConfigured: true,
    })

    const minimax = store.getState().providerSettings.minimax
    store.getState().updateProviderSettings({ ...minimax, selectedModel: '' })
    expect(store.getState().isConfigured).toBe(false)

    store.getState().setApiKey('   ')
    expect(store.getState()).toMatchObject({ apiKey: '', isConfigured: false })
  })

  it('persists provider endpoints, model selection and multiple API keys', () => {
    const persistName = 'ai-config-persisted'
    const store = createAIStore({ persistName })
    const qwen = createProviderSettings('qwen')
    qwen.apiKeys = [
      { id: 'primary', label: '主账号', value: 'saved-key', enabled: true },
      { id: 'backup', label: '备用账号', value: 'backup-key', enabled: true },
    ]
    qwen.models = ['qwen-plus', 'qwen-max']
    qwen.selectedModel = 'qwen-plus'
    qwen.baseUrl = 'https://gateway.example/v1'
    store.getState().saveProviderSettings([qwen], [], 'qwen')

    const persisted = JSON.parse(localStorage.getItem(persistName) ?? '{}').state
    expect(persisted).toMatchObject({
      provider: 'qwen',
      apiKey: 'saved-key',
      providerSettings: {
        qwen: {
          baseUrl: 'https://gateway.example/v1',
          selectedModel: 'qwen-plus',
          apiKeys: [
            { id: 'primary', value: 'saved-key', enabled: true },
            { id: 'backup', value: 'backup-key', enabled: true },
          ],
        },
      },
    })
    expect(persisted.providerKeys).toBeUndefined()
  })

  it('round-robins enabled keys and skips disabled keys', () => {
    const store = createAIStore({ persistName: 'ai-config-rotation' })
    const provider = createProviderSettings('deepseek')
    provider.models = ['deepseek-chat']
    provider.selectedModel = 'deepseek-chat'
    provider.apiKeys = [
      { id: 'one', label: '一', value: 'key-one', enabled: true },
      { id: 'off', label: '停用', value: 'key-off', enabled: false },
      { id: 'two', label: '二', value: 'key-two', enabled: true },
    ]
    store.getState().saveProviderSettings([provider], [], 'deepseek')

    expect([
      store.getState().getNextApiKey('deepseek'),
      store.getState().getNextApiKey('deepseek'),
      store.getState().getNextApiKey('deepseek'),
    ]).toEqual(['key-one', 'key-two', 'key-one'])
  })

  it('migrates older per-provider keys and the original single-key shape', () => {
    localStorage.setItem('ai-config-legacy-map', JSON.stringify({
      state: { provider: 'qwen', apiKey: 'old-current-key', providerKeys: { minimax: 'old-minimax-key' } },
      version: 0,
    }))
    const perProvider = createAIStore({ persistName: 'ai-config-legacy-map' })
    expect(perProvider.getState()).toMatchObject({
      provider: 'qwen',
      apiKey: 'old-current-key',
      providerKeys: { qwen: 'old-current-key', minimax: 'old-minimax-key' },
    })

    localStorage.setItem('ai-config-legacy-key', JSON.stringify({
      state: { provider: 'qwen', apiKey: 'legacy-key', isConfigured: true },
      version: 0,
    }))
    const singleKey = createAIStore({ persistName: 'ai-config-legacy-key' })
    expect(singleKey.getState()).toMatchObject({
      provider: 'qwen',
      apiKey: 'legacy-key',
      providerKeys: { qwen: 'legacy-key' },
      isConfigured: true,
    })
  })

  it('adds and removes custom providers without mutating built-in entries', () => {
    const store = createAIStore({ persistName: 'ai-config-custom-provider' })
    const custom = createProviderSettings('custom-studio')
    custom.name = 'Studio Gateway'
    custom.baseUrl = 'http://localhost:9000/v1'
    custom.models = ['local-chat']
    custom.selectedModel = 'local-chat'
    store.getState().saveProviderSettings([custom], [], custom.id)
    expect(store.getState().providerSettings['custom-studio'].name).toBe('Studio Gateway')

    store.getState().removeProvider('custom-studio')
    expect(store.getState().providerSettings['custom-studio']).toBeUndefined()
    expect(store.getState().providerSettings.minimax).toBeDefined()
  })
})
