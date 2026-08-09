/**
 * AI Store - 管理AI配置和生成状态
 *
 * 工厂模式 (v0.8-2 Candidate 2):
 *   每个 useAIStore 实例由 createAIStore({ factory }) 创建.
 *   factory 闭包捕获于 generateCards 内, 杜绝 `(window as any).__adapterFactory`
 *   模块级可读全局. 测试每个测试文件自己创建 store, 完全隔离.
 *
 * 产线单例 export `useAIStore` 仍导出, 内部使用 prod factory (createAdapter).
 */
import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { CardData } from '../types'
import {
  createAdapter,
  LLMProvider,
  BaseLLMAdapter,
  CardGenerationResult
} from '../services/llm/adapters'

// Adapter工厂类型 - 可注入用于测试
export type AdapterFactory = (provider: LLMProvider, apiKey: string) => BaseLLMAdapter

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

/**
 * 创建一个 AI Store 实例. 工厂模式 seam:
 *   - factory 通过闭包注入, 不再走 window 全局
 *   - persist 名字默认 'mod-studio-ai-config'. 测试可传 persistName
 *     让每个测试用独立 storage, 避免 localStorage 跨测试污染.
 *
 * 测试用:
 *   const myStore = createAIStore({ factory: () => mockAdapter, persistName: 'test-A' })
 *   await myStore.getState().generateCards('desc')
 */
export function createAIStore(deps: { factory: AdapterFactory; persistName?: string }) {
  const { factory, persistName = 'mod-studio-ai-config' } = deps

  return create<AIState>()(
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
        name: persistName,
        // 只持久化配置，不持久化生成状态
        partialize: (state) => ({
          provider: state.provider,
          apiKey: state.apiKey,
          isConfigured: state.isConfigured
        })
      }
    )
  )
}

export type AIStore = ReturnType<typeof createAIStore>

/**
 * 产线默认单例. 用 prod factory (createAdapter). 组件内 `useAIStore()` 直接用.
 * 不要在测试里 import 这个 — 测试应自己调 createAIStore({ factory: mockFactory }).
 */
export const useAIStore: AIStore = createAIStore({ factory: createAdapter })
