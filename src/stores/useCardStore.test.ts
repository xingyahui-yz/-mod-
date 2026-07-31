/**
 * useCardStore 持久化测试
 */
import { describe, it, expect, beforeEach } from 'vitest'
import { useCardStore } from './useCardStore'

describe('useCardStore persist behavior', () => {
  beforeEach(() => {
    // 清除store状态
    useCardStore.setState({
      cards: [],
      currentCard: null,
      selectedCardIndex: null
    })
    localStorage.clear()
  })

  it('默认应该有空的卡牌数组', () => {
    const state = useCardStore.getState()
    expect(state.cards).toEqual([])
    expect(state.currentCard).toBeNull()
    expect(state.selectedCardIndex).toBeNull()
  })

  it('添加卡牌后应该更新状态', () => {
    const { addCard } = useCardStore.getState()
    addCard()

    const state = useCardStore.getState()
    expect(state.cards).toHaveLength(1)
    expect(state.currentCard).not.toBeNull()
    expect(state.selectedCardIndex).toBe(0)
  })

  it('partialize应该只持久化cards', () => {
    const { addCard } = useCardStore.getState()
    addCard()

    // 检查localStorage
    const stored = localStorage.getItem('mod-studio-cards')
    expect(stored).toBeTruthy()

    if (stored) {
      const parsed = JSON.parse(stored)
      expect(parsed.state.cards).toBeDefined()
      // UI状态不应持久化
      expect(parsed.state.currentCard).toBeUndefined()
      expect(parsed.state.selectedCardIndex).toBeUndefined()
    }
  })

  it('updateCard应该正确更新卡牌', () => {
    const { addCard, updateCard } = useCardStore.getState()
    addCard()

    updateCard(0, { name: 'Updated', cost: 5 })

    const state = useCardStore.getState()
    expect(state.cards[0].name).toBe('Updated')
    expect(state.cards[0].cost).toBe(5)
  })

  it('deleteCard应该删除指定索引的卡牌', () => {
    const { addCardWithData, deleteCard, selectCard } = useCardStore.getState()

    addCardWithData({ name: 'Card 1', cost: 1, type: 'Attack', rarity: 'Common', description: '', keywords: [] })
    addCardWithData({ name: 'Card 2', cost: 2, type: 'Skill', rarity: 'Common', description: '', keywords: [] })
    selectCard(0)

    deleteCard(0)

    const state = useCardStore.getState()
    expect(state.cards).toHaveLength(1)
    expect(state.cards[0].name).toBe('Card 2')
    expect(state.selectedCardIndex).toBeNull()
  })

  it('clearCards应该清空所有卡牌', () => {
    const { addCard, clearCards } = useCardStore.getState()
    addCard()
    addCard()

    clearCards()

    const state = useCardStore.getState()
    expect(state.cards).toEqual([])
    expect(state.currentCard).toBeNull()
  })

  it('loadCards应该替换现有卡牌', () => {
    const { loadCards } = useCardStore.getState()
    const newCards = [
      { name: 'A', cost: 1, type: 'Attack' as const, rarity: 'Common' as const, description: '', keywords: [] },
      { name: 'B', cost: 2, type: 'Skill' as const, rarity: 'Rare' as const, description: '', keywords: [] }
    ]

    loadCards(newCards)

    const state = useCardStore.getState()
    expect(state.cards).toEqual(newCards)
    expect(state.currentCard).toEqual(newCards[0])
  })
})