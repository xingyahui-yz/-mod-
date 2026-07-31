/**
 * AI Store - 管理AI配置和生成状态
 */
import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { CardData } from '../types'
import { createAdapter, LLMProvider, BaseLLMAdapter, CardGenerationResult } from '../services/llm/adapters'

// Adapter工厂类型 - 可注入用于测试
export type AdapterFactory = (provider: LLMProvider, apiKey: string) => BaseLLMAdapter

// 默认工厂
const defaultFactory: AdapterFactory = (provider, apiKey) => createAdapter(provider, apiKey)

interface AIState {
  // 配置
  provider: LLMProvider
  apiKey: string
  isConfigured: boolean

  // 生成状态
  isGenerating: boolean
  generatedCards: CardData[]
  lastError: string | null
  lastRawResponse: string | null

  // Actions
  setProvider: (provider: LLMProvider) => void
  setApiKey: (apiKey: string) => void
  generateCards: (description: string, preferredType?: CardData['type']) => Promise<CardData[]>
  clearGeneratedCards: () => void
  clearError: () => void
}

export const useAIStore = create<AIState>()(
  persist(
    (set, get) => ({
      provider: 'minimax',
      apiKey: '',
      isConfigured: false,
      isGenerating: false,
      generatedCards: [],
      lastError: null,
      lastRawResponse: null,

      setProvider: (provider) => {
        set({ provider, lastError: null })
      },

      setApiKey: (apiKey) => {
        const isConfigured = apiKey.trim().length > 0
        set({ apiKey: apiKey.trim(), isConfigured, lastError: null })
      },

      generateCards: async (description, preferredType) => {
        const { provider, apiKey, isConfigured } = get()

        if (!isConfigured) {
          set({ lastError: '请先配置API密钥' })
          return []
        }

        if (!description.trim()) {
          set({ lastError: '请输入卡牌描述' })
          return []
        }

        set({ isGenerating: true, lastError: null, generatedCards: [] })

        try {
          // 使用注入的工厂或默认工厂
          const factory: AdapterFactory = (window as any).__adapterFactory || defaultFactory
          const adapter = factory(provider, apiKey)
          const result: CardGenerationResult = await adapter.generateCards(description, preferredType)

          if (result.success) {
            set({
              generatedCards: result.cards || [],
              lastRawResponse: result.rawResponse || null,
              isGenerating: false
            })
            return result.cards || []
          } else {
            set({
              lastError: result.error || '生成失败',
              isGenerating: false
            })
            return []
          }
        } catch (err) {
          if (err instanceof Error && err.name === 'TimeoutError') {
            set({
              lastError: '请求超时，请稍后重试',
              isGenerating: false
            })
          } else {
            set({
              lastError: `生成失败: ${err}`,
              isGenerating: false
            })
          }
          return []
        }
      },

      clearGeneratedCards: () => {
        set({ generatedCards: [], lastRawResponse: null })
      },

      clearError: () => {
        set({ lastError: null })
      }
    }),
    {
      name: 'mod-studio-ai-config',
      // 只持久化配置，不持久化生成状态
      partialize: (state) => ({
        provider: state.provider,
        apiKey: state.apiKey,
        isConfigured: state.isConfigured
      })
    }
  )
)

/**
 * 设置自定义Adapter工厂（用于测试或自定义provider）
 */
export function setAdapterFactory(factory: AdapterFactory | null): void {
  if (factory) {
    (window as any).__adapterFactory = factory
  } else {
    delete (window as any).__adapterFactory
  }
}