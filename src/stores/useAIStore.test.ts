/**
 * useAIStore 测试 - 演示依赖注入的好处
 */
import { describe, it, expect, beforeEach } from 'vitest'
import { useAIStore, setAdapterFactory, AdapterFactory } from './useAIStore'
import { BaseLLMAdapter, LLMResponse } from '../services/llm/adapters'

// Mock Adapter
class MockSuccessAdapter extends BaseLLMAdapter {
  getModelName() { return 'mock-success' }

  async generate(): Promise<LLMResponse> {
    return {
      success: true,
      content: JSON.stringify([{
        name: 'MockCard',
        cost: 2,
        type: 'Skill',
        rarity: 'Uncommon',
        description: 'Mock description',
        keywords: ['Mock']
      }])
    }
  }
}

class MockErrorAdapter extends BaseLLMAdapter {
  getModelName() { return 'mock-error' }

  async generate(): Promise<LLMResponse> {
    return {
      success: false,
      error: 'Mock error'
    }
  }
}

const successFactory: AdapterFactory = () => new MockSuccessAdapter({ apiKey: 'test' })
const errorFactory: AdapterFactory = () => new MockErrorAdapter({ apiKey: 'test' })

describe('useAIStore', () => {
  beforeEach(() => {
    // 清除mock和store状态
    setAdapterFactory(null)
    useAIStore.setState({
      provider: 'minimax',
      apiKey: '',
      isConfigured: false,
      isGenerating: false,
      generatedCards: [],
      lastError: null
    })
  })

  describe('API配置', () => {
    it('设置API key后应标记为已配置', () => {
      const { setApiKey } = useAIStore.getState()
      setApiKey('test-api-key')

      const state = useAIStore.getState()
      expect(state.apiKey).toBe('test-api-key')
      expect(state.isConfigured).toBe(true)
    })

    it('空API key应标记为未配置', () => {
      const { setApiKey } = useAIStore.getState()
      setApiKey('   ')

      const state = useAIStore.getState()
      expect(state.isConfigured).toBe(false)
    })

    it('切换provider应清除错误', () => {
      const { setProvider, setApiKey } = useAIStore.getState()
      setApiKey('key')
      useAIStore.setState({ lastError: 'Some error' })

      setProvider('qwen')

      const state = useAIStore.getState()
      expect(state.provider).toBe('qwen')
      expect(state.lastError).toBeNull()
    })
  })

  describe('generateCards', () => {
    it('未配置API时应返回错误', async () => {
      const { generateCards } = useAIStore.getState()
      const result = await generateCards('test description')

      expect(result).toEqual([])
      const state = useAIStore.getState()
      expect(state.lastError).toBe('请先配置API密钥')
    })

    it('空描述应返回错误', async () => {
      const { setApiKey, generateCards } = useAIStore.getState()
      setApiKey('key')

      const result = await generateCards('')

      expect(result).toEqual([])
      const state = useAIStore.getState()
      expect(state.lastError).toBe('请输入卡牌描述')
    })

    it('成功生成应填充generatedCards', async () => {
      const { setApiKey, generateCards } = useAIStore.getState()
      setApiKey('key')
      setAdapterFactory(successFactory)

      const result = await generateCards('description')

      expect(result).toHaveLength(1)
      const state = useAIStore.getState()
      expect(state.generatedCards).toHaveLength(1)
      expect(state.generatedCards[0].name).toBe('MockCard')
      expect(state.isGenerating).toBe(false)
    })

    it('adapter错误应显示错误信息', async () => {
      const { setApiKey, generateCards } = useAIStore.getState()
      setApiKey('key')
      setAdapterFactory(errorFactory)

      const result = await generateCards('description')

      expect(result).toEqual([])
      const state = useAIStore.getState()
      expect(state.lastError).toBe('Mock error')
      expect(state.isGenerating).toBe(false)
    })
  })

  describe('clearGeneratedCards', () => {
    it('应清除生成结果', () => {
      useAIStore.setState({
        generatedCards: [{ name: 'X', cost: 1, type: 'Attack', rarity: 'Common', description: '', keywords: [] }]
      })
      const { clearGeneratedCards } = useAIStore.getState()
      clearGeneratedCards()

      const state = useAIStore.getState()
      expect(state.generatedCards).toEqual([])
    })
  })

  describe('clearError', () => {
    it('应清除错误状态', () => {
      useAIStore.setState({ lastError: 'Some error' })
      const { clearError } = useAIStore.getState()
      clearError()

      const state = useAIStore.getState()
      expect(state.lastError).toBeNull()
    })
  })
})