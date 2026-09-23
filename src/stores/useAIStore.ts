/**
 * AI 配置 Store。
 *
 * 项目级对话负责请求、提案和错误状态；这里仅持久化创建适配器所需的
 * 用户配置，避免重新引入一套平行的生成工作流。
 */
import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import type { LLMProvider } from '../services/llm/adapters'

interface AIState {
  provider: LLMProvider
  apiKey: string
  isConfigured: boolean
  setProvider: (provider: LLMProvider) => void
  setApiKey: (apiKey: string) => void
}

export function createAIStore(options: { persistName?: string } = {}) {
  const { persistName = 'mod-studio-ai-config' } = options

  return create<AIState>()(
    persist(
      set => ({
        provider: 'minimax',
        apiKey: '',
        isConfigured: false,

        setProvider: provider => set({ provider }),
        setApiKey: apiKey => {
          const normalizedApiKey = apiKey.trim()
          set({
            apiKey: normalizedApiKey,
            isConfigured: normalizedApiKey.length > 0,
          })
        },
      }),
      {
        name: persistName,
        partialize: state => ({
          provider: state.provider,
          apiKey: state.apiKey,
          isConfigured: state.isConfigured,
        }),
      },
    ),
  )
}

export type AIStore = ReturnType<typeof createAIStore>

export const useAIStore: AIStore = createAIStore()
