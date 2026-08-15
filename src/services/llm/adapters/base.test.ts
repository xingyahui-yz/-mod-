/**
 * Base LLM Adapter 测试
 */
import { describe, it, expect } from 'vitest'
import { BaseLLMAdapter, LLMResponse } from './base'
import { createEmptyGraph } from '../../../node-editor/graph'
import type { CardDocument } from '../../../card/cardDocument'

// 测试用MockAdapter
class MockAdapter extends BaseLLMAdapter {
  getModelName(): string {
    return 'mock'
  }

  async generate(): Promise<LLMResponse> {
    // 模拟成功响应
    return {
      success: true,
      content: JSON.stringify([
        {
          name: '测试卡牌',
          cost: 1,
          type: 'Attack',
          rarity: 'Common',
          description: '测试描述',
          keywords: ['Test']
        }
      ])
    }
  }
}

class ProposalAdapter extends BaseLLMAdapter {
  constructor(private readonly response: string) { super({ apiKey: 'test' }) }
  getModelName(): string { return 'proposal-mock' }
  async generate(): Promise<LLMResponse> { return { success: true, content: this.response } }
}

function proposalBase(): CardDocument {
  return {
    schemaVersion: 2,
    card: { id: 'ProposalCard', name: 'Before', cost: 1, type: 'Attack', rarity: 'Common', description: '', keywords: [] },
    graph: createEmptyGraph('ProposalCard', 'card'),
    generation: { lastGeneratedFingerprint: null },
  }
}

describe('BaseLLMAdapter', () => {
  describe('parseCardResponse', () => {
    it('应该解析JSON数组响应', () => {
      const adapter = new MockAdapter({ apiKey: 'test' })
      // 访问受保护方法
      const result = (adapter as any).parseCardResponse(
        JSON.stringify([{
          name: '卡牌A',
          cost: 1,
          type: 'Attack',
          rarity: 'Common',
          description: '描述A',
          keywords: ['Fire']
        }])
      )

      expect(result).toHaveLength(1)
      expect(result[0].name).toBe('卡牌A')
      expect(result[0].cost).toBe(1)
      expect(result[0].type).toBe('Attack')
    })

    it('应该处理markdown代码块包装的JSON', () => {
      const adapter = new MockAdapter({ apiKey: 'test' })
      const result = (adapter as any).parseCardResponse(
        '```json\n[{"name":"X","cost":1,"type":"Skill","rarity":"Rare","description":"d","keywords":[]}]\n```'
      )

      expect(result).toHaveLength(1)
      expect(result[0].name).toBe('X')
    })

    it('应该过滤无效卡牌', () => {
      const adapter = new MockAdapter({ apiKey: 'test' })
      const result = (adapter as any).parseCardResponse(
        JSON.stringify([
          { name: '有效', cost: 1, type: 'Attack', rarity: 'Common', description: 'd', keywords: [] },
          { name: '无效-无type', cost: 1, rarity: 'Common', description: 'd', keywords: [] },
          { name: '无效-type错', cost: 1, type: 'Wrong', rarity: 'Common', description: 'd', keywords: [] }
        ])
      )

      expect(result).toHaveLength(1)
    })

    it('解析失败应返回空数组', () => {
      const adapter = new MockAdapter({ apiKey: 'test' })
      const result = (adapter as any).parseCardResponse('not a json')

      expect(result).toEqual([])
    })
  })


  describe('generateCards', () => {
    it('应该返回成功结果', async () => {
      const adapter = new MockAdapter({ apiKey: 'test' })
      const result = await adapter.generateCards('测试描述')

      expect(result.success).toBe(true)
      expect(result.cards).toHaveLength(1)
      expect(result.cards[0].name).toBe('测试卡牌')
    })

    it('应该处理preferredType参数', async () => {
      const adapter = new MockAdapter({ apiKey: 'test' })
      const result = await adapter.generateCards('描述', 'Power')

      expect(result.success).toBe(true)
    })
  })

  describe('generateCardProposal', () => {
    it('解析完整 CardDocument 并返回待确认 proposal', async () => {
      const base = proposalBase()
      const adapter = new ProposalAdapter(JSON.stringify({ card: { ...base.card, name: 'After' }, graph: base.graph }))
      const result = await adapter.generateCardProposal(base, '修改名称')
      expect(result.success).toBe(true)
      expect(result.proposal?.document.card.name).toBe('After')
    })

    it('结构违规只返回 violations，不产生 proposal', async () => {
      const base = proposalBase()
      const adapter = new ProposalAdapter(JSON.stringify({ card: base.card }))
      const result = await adapter.generateCardProposal(base, '坏响应')
      expect(result.success).toBe(false)
      expect(result.proposal).toBeUndefined()
      expect(result.violations.length).toBeGreaterThan(0)
    })
  })
})
