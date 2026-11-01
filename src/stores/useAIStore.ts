/** Provider, model, and API key configuration for project AI conversations. */
import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import type { LLMProvider } from '../services/llm/adapters'
import { LLM_PROVIDERS } from '../services/llm/providerCatalog'
import {
  createProviderSettings,
  normalizeProviderSettings,
  providerIsReady,
  type ProviderSettings,
} from '../services/llm/providerSettings'

interface AIState {
  provider: LLMProvider
  apiKey: string
  /** Compatibility view for callers that still expect one key per provider. */
  providerKeys: Partial<Record<LLMProvider, string>>
  providerSettings: Record<LLMProvider, ProviderSettings>
  isConfigured: boolean
  setProvider: (provider: LLMProvider) => void
  setApiKey: (apiKey: string) => void
  updateProviderSettings: (settings: ProviderSettings) => void
  addProvider: (settings: ProviderSettings) => void
  removeProvider: (provider: LLMProvider) => void
  saveProviderSettings: (settings: ProviderSettings[], removedProviders: string[], selectedProvider: string) => void
  getNextApiKey: (provider: LLMProvider) => string
}

function deriveProviderKeys(providerSettings: Record<string, ProviderSettings>): Partial<Record<string, string>> {
  return Object.fromEntries(Object.entries(providerSettings).flatMap(([id, settings]) => {
    const key = settings.apiKeys.find(entry => entry.enabled && entry.value.trim())?.value
    return key ? [[id, key]] : []
  }))
}

function firstEnabledKey(settings: ProviderSettings): string {
  return settings.apiKeys.find(entry => entry.enabled && entry.value.trim())?.value ?? ''
}

function withActiveState(
  provider: LLMProvider,
  providerSettings: Record<string, ProviderSettings>,
): Pick<AIState, 'provider' | 'providerSettings' | 'apiKey' | 'providerKeys' | 'isConfigured'> {
  const settings = providerSettings[provider]
  return {
    provider,
    providerSettings,
    apiKey: settings ? firstEnabledKey(settings) : '',
    providerKeys: deriveProviderKeys(providerSettings),
    isConfigured: settings ? providerIsReady(settings) : false,
  }
}

function mergePersistedSettings(persistedState: unknown, currentSettings: Record<string, ProviderSettings>) {
  const persisted = persistedState && typeof persistedState === 'object'
    ? persistedState as Partial<AIState>
    : {}
  const providerSettings = { ...currentSettings } as Record<string, ProviderSettings>

  if (persisted.providerSettings && typeof persisted.providerSettings === 'object') {
    for (const [id, value] of Object.entries(persisted.providerSettings)) {
      providerSettings[id] = normalizeProviderSettings(id, value)
    }
  }

  // Migrate the prior providerKeys map, then the original single API Key field.
  const legacyKeys = persisted.providerKeys && typeof persisted.providerKeys === 'object'
    ? persisted.providerKeys
    : {}
  const oldKeys = { ...legacyKeys } as Record<string, unknown>
  if (typeof persisted.apiKey === 'string' && persisted.apiKey.trim()) {
    oldKeys[persisted.provider ?? 'minimax'] ??= persisted.apiKey
  }
  for (const [id, rawKey] of Object.entries(oldKeys)) {
    if (typeof rawKey !== 'string' || !rawKey.trim()) continue
    const settings = providerSettings[id] ?? createProviderSettings(id)
    const existing = settings.apiKeys.find(key => key.id === 'key-default')
    if (existing && !existing.value.trim()) {
      providerSettings[id] = normalizeProviderSettings(id, {
        ...settings,
        apiKeys: settings.apiKeys.map(key => key.id === 'key-default'
          ? { ...key, value: rawKey.trim(), enabled: true }
          : key),
      })
    }
  }
  return { persisted, providerSettings }
}

export function createAIStore(options: { persistName?: string } = {}) {
  const { persistName = 'mod-studio-ai-config' } = options
  const rotationCursors = new Map<string, number>()
  const initialSettings = Object.fromEntries(LLM_PROVIDERS.map(preset => [preset.id, createProviderSettings(preset.id)])) as Record<string, ProviderSettings>

  return create<AIState>()(
    persist(
      (set, get) => ({
        provider: 'minimax',
        apiKey: '',
        providerKeys: {},
        providerSettings: initialSettings,
        isConfigured: false,

        setProvider: provider => set(state => {
          const providerSettings = state.providerSettings[provider]
            ? state.providerSettings
            : { ...state.providerSettings, [provider]: createProviderSettings(provider) }
          return withActiveState(provider, providerSettings)
        }),

        setApiKey: apiKey => set(state => {
          const id = state.provider
          const settings = state.providerSettings[id] ?? createProviderSettings(id)
          const value = apiKey.trim()
          const key = settings.apiKeys[0] ?? { id: 'key-default', label: '主密钥', value: '', enabled: true }
          const nextSettings = normalizeProviderSettings(id, {
            ...settings,
            apiKeys: [
              { ...key, value, enabled: value ? true : key.enabled },
              ...settings.apiKeys.slice(settings.apiKeys[0] ? 1 : 0),
            ],
          })
          const providerSettings = { ...state.providerSettings, [id]: nextSettings }
          return { ...withActiveState(id, providerSettings) }
        }),

        updateProviderSettings: settings => set(state => {
          const normalized = normalizeProviderSettings(settings.id, settings)
          const providerSettings = { ...state.providerSettings, [settings.id]: normalized }
          return withActiveState(state.provider, providerSettings)
        }),

        addProvider: settings => set(state => {
          const normalized = normalizeProviderSettings(settings.id, settings)
          return {
            ...state,
            providerSettings: { ...state.providerSettings, [settings.id]: normalized },
          }
        }),

        removeProvider: provider => set(state => {
          if (LLM_PROVIDERS.some(preset => preset.id === provider)) return state
          if (!state.providerSettings[provider]) return state
          const providerSettings = { ...state.providerSettings }
          delete providerSettings[provider]
          const selectedProvider = state.provider === provider ? 'minimax' : state.provider
          return withActiveState(selectedProvider, providerSettings)
        }),

        saveProviderSettings: (settingsList, removedProviders, selectedProvider) => set(state => {
          const providerSettings = { ...state.providerSettings }
          for (const id of removedProviders) {
            if (!LLM_PROVIDERS.some(preset => preset.id === id)) delete providerSettings[id]
          }
          for (const settings of settingsList) {
            if (!removedProviders.includes(settings.id)) {
              providerSettings[settings.id] = normalizeProviderSettings(settings.id, settings)
            }
          }
          if (!providerSettings[selectedProvider]) providerSettings[selectedProvider] = createProviderSettings(selectedProvider)
          return withActiveState(selectedProvider, providerSettings)
        }),

        getNextApiKey: provider => {
          const settings = get().providerSettings[provider]
          if (!settings || !settings.enabled) return ''
          const keys = settings.apiKeys.filter(key => key.enabled && key.value.trim())
          if (keys.length === 0) return ''
          const cursor = rotationCursors.get(provider) ?? 0
          rotationCursors.set(provider, (cursor + 1) % keys.length)
          return keys[cursor % keys.length].value
        },
      }),
      {
        name: persistName,
        version: 2,
        migrate: persistedState => persistedState as Partial<AIState>,
        partialize: state => ({
          provider: state.provider,
          apiKey: state.apiKey,
          providerSettings: state.providerSettings,
        }) as AIState,
        merge: (persistedState, currentState) => {
          const { persisted, providerSettings } = mergePersistedSettings(persistedState, currentState.providerSettings)
          const provider = persisted.provider ?? currentState.provider
          if (!providerSettings[provider]) providerSettings[provider] = createProviderSettings(provider)
          return {
            ...currentState,
            ...withActiveState(provider, providerSettings),
          }
        },
      },
    ),
  )
}

export type AIStore = ReturnType<typeof createAIStore>

export const useAIStore: AIStore = createAIStore()
