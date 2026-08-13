/**
 * useAIStore 测试 — 每个测试构造独立 store 实例 (v0.8-2 工厂 seam)
 *
 * 不再依赖全局注入 (旧 setAdapterFactory) — 每个 beforeEach 调
 * createAIStore({ factory }) 创建一个新的 zustand store, 完全隔离.
 */
import { describe, it, expect, beforeEach } from 'vitest'
import { createAIStore, AdapterFactory, AIStore } from './useAIStore'
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

describe('useAIStore (factory seam)', () => {
  let store: AIStore

  beforeEach(() => {
    // 清 localStorage 防止上一个测试残留 apiKey/isConfigured 干扰
    localStorage.clear()
    // 每次新建独立 store (同名 storage 已清), 完全隔离 — 不依赖模块级全局
    store = createAIStore({ factory: successFactory, persistName: 'test-success' })
  })

  describe('API配置', () => {
    it('设置API key后应标记为已配置', () => {
      const { setApiKey } = store.getState()
      setApiKey('test-api-key')

      const state = store.getState()
      expect(state.apiKey).toBe('test-api-key')
      expect(state.isConfigured).toBe(true)
    })

    it('空API key应标记为未配置', () => {
      const { setApiKey } = store.getState()
      setApiKey('   ')

      const state = store.getState()
      expect(state.isConfigured).toBe(false)
    })

    it('切换provider应清除错误', () => {
      const { setProvider, setApiKey } = store.getState()
      setApiKey('key')
      store.setState({ lastError: 'Some error' })

      setProvider('qwen')

      const state = store.getState()
      expect(state.provider).toBe('qwen')
      expect(state.lastError).toBeNull()
    })
  })

  describe('generateCards', () => {
    it('未配置API时应返回错误', async () => {
      const { generateCards } = store.getState()
      const result = await generateCards('test description')

      expect(result).toEqual([])
      const state = store.getState()
      expect(state.lastError).toBe('请先配置API密钥')
    })

    it('空描述应返回错误', async () => {
      const { setApiKey, generateCards } = store.getState()
      setApiKey('key')

      const result = await generateCards('')

      expect(result).toEqual([])
      const state = store.getState()
      expect(state.lastError).toBe('请输入卡牌描述')
    })

    it('成功生成应填充 generatedCards', async () => {
      const { setApiKey, generateCards } = store.getState()
      setApiKey('key')
      // store 已用 successFactory 构造 — 不用 setAdapterFactory

      const result = await generateCards('description')

      expect(result).toHaveLength(1)
      const state = store.getState()
      expect(state.generatedCards).toHaveLength(1)
      expect(state.generatedCards[0].name).toBe('MockCard')
      expect(state.isGenerating).toBe(false)
    })

    it('adapter错误应显示错误信息（用单独的 errorFactory store）', async () => {
      // 关键测试: 不同的 store 用不同的 factory, 互不污染
      const errorStore = createAIStore({ factory: errorFactory, persistName: 'test-error' })
      const { setApiKey, generateCards } = errorStore.getState()
      setApiKey('key')

      const result = await generateCards('description')

      expect(result).toEqual([])
      const state = errorStore.getState()
      expect(state.lastError).toBe('Mock error')
      expect(state.isGenerating).toBe(false)

      // 同时: 主 store 不应受 errorStore 影响 (这就是 seam 解决的事)
      expect(store.getState().lastError).toBeNull()
      expect(store.getState().generatedCards).toEqual([])
    })

    it('每个 store 持有独立的 factory 闭包 — 不共享模块级全局', async () => {
      // 工厂 seam 的核心证明: 两个 store 用不同 factory, 结果互不影响
      const storeA = createAIStore({ factory: successFactory, persistName: 'test-A' })
      const storeB = createAIStore({ factory: errorFactory, persistName: 'test-B' })

      storeA.getState().setApiKey('key-a')
      storeB.getState().setApiKey('key-b')

      const [resultA, resultB] = await Promise.all([
        storeA.getState().generateCards('desc'),
        storeB.getState().generateCards('desc')
      ])

      expect(resultA).toHaveLength(1)  // success
      expect(resultB).toEqual([])     // error
      expect(storeA.getState().generatedCards).toHaveLength(1)
      expect(storeB.getState().lastError).toBe('Mock error')
    })
  })

  describe('clearGeneratedCards', () => {
    it('应清除生成结果', () => {
      store.setState({
        generatedCards: [{ id: 'X', name: 'X', cost: 1, type: 'Attack', rarity: 'Common', description: '', keywords: [] }]
      })
      const { clearGeneratedCards } = store.getState()
      clearGeneratedCards()

      const state = store.getState()
      expect(state.generatedCards).toEqual([])
    })
  })

  describe('clearError', () => {
    it('应清除错误状态', () => {
      store.setState({ lastError: 'Some error' })
      const { clearError } = store.getState()
      clearError()

      const state = store.getState()
      expect(state.lastError).toBeNull()
    })
  })
})
