import { beforeEach, describe, expect, it } from 'vitest'
import { createAIStore } from './useAIStore'

describe('useAIStore', () => {
  beforeEach(() => {
    localStorage.clear()
  })

  it('只公开 AI 供应商和 API Key 配置 seam', () => {
    const store = createAIStore({ persistName: 'ai-config-shape' })

    expect(Object.keys(store.getState()).sort()).toEqual([
      'apiKey',
      'isConfigured',
      'provider',
      'setApiKey',
      'setProvider',
    ])
  })

  it('规范化 API Key 并派生配置状态', () => {
    const store = createAIStore({ persistName: 'ai-config-key' })

    store.getState().setApiKey('  secret-key  ')
    expect(store.getState()).toMatchObject({
      apiKey: 'secret-key',
      isConfigured: true,
    })

    store.getState().setApiKey('   ')
    expect(store.getState()).toMatchObject({
      apiKey: '',
      isConfigured: false,
    })
  })

  it('更新并持久化供应商与 API Key', () => {
    const persistName = 'ai-config-persisted'
    const store = createAIStore({ persistName })

    store.getState().setProvider('qwen')
    store.getState().setApiKey('saved-key')

    expect(JSON.parse(localStorage.getItem(persistName) ?? '{}')).toMatchObject({
      state: {
        provider: 'qwen',
        apiKey: 'saved-key',
        isConfigured: true,
      },
    })
  })
})
