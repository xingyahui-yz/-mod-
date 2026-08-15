/**
 * useCardStore 身份与状态测试
 */
import { describe, it, expect, beforeEach } from 'vitest'
import { useCardStore } from './useCardStore'
import { createEmptyGraph } from '../node-editor/graph'

describe('useCardStore persist behavior', () => {
  beforeEach(() => {
    useCardStore.setState({
      cards: [],
      documents: [],
      currentCard: null,
      currentDocument: null,
      selectedCardId: null,
      selectedCardIndex: null
    })
  })

  it('默认应该有空的卡牌数组', () => {
    const state = useCardStore.getState()
    expect(state.cards).toEqual([])
    expect(state.currentCard).toBeNull()
    expect(state.selectedCardId).toBeNull()
    expect(state.selectedCardIndex).toBeNull()
  })

  it('添加卡牌后应该更新状态', () => {
    const { addCard } = useCardStore.getState()
    addCard()

    const state = useCardStore.getState()
    expect(state.cards).toHaveLength(1)
    expect(state.currentCard).not.toBeNull()
    expect(state.selectedCardId).toBe('NewCard')
    expect(state.selectedCardIndex).toBe(0)
  })

  it('Card 数据不写入 localStorage，由项目文档负责持久化', () => {
    const { addCard } = useCardStore.getState()
    addCard()
    expect(localStorage.getItem('mod-studio-cards')).toBeNull()
  })

  it('updateCard应该正确更新卡牌', () => {
    const { addCard, updateCard } = useCardStore.getState()
    addCard()

    updateCard('NewCard', { name: 'Updated', cost: 5 })

    const state = useCardStore.getState()
    expect(state.cards[0].name).toBe('Updated')
    expect(state.cards[0].cost).toBe(5)
  })

  it('updateCard 不允许修改已创建卡牌的 ID', () => {
    const { addCardWithData, updateCard } = useCardStore.getState()
    addCardWithData({ id: 'StableId', name: 'Old', cost: 1, type: 'Attack', rarity: 'Common', description: '', keywords: [] })
    updateCard('StableId', { id: 'ChangedId', name: 'Renamed' })
    expect(useCardStore.getState().cards[0]).toMatchObject({ id: 'StableId', name: 'Renamed' })
  })

  it('deleteCard应该删除指定索引的卡牌', () => {
    const { addCardWithData, deleteCard, selectCard } = useCardStore.getState()

    addCardWithData({ id: 'CardOne', name: 'Card 1', cost: 1, type: 'Attack', rarity: 'Common', description: '', keywords: [] })
    addCardWithData({ id: 'CardTwo', name: 'Card 2', cost: 2, type: 'Skill', rarity: 'Common', description: '', keywords: [] })
    selectCard('CardOne')

    deleteCard('CardOne')

    const state = useCardStore.getState()
    expect(state.cards).toHaveLength(1)
    expect(state.cards[0].name).toBe('Card 2')
    expect(state.selectedCardId).toBeNull()
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
      { id: 'A', name: 'A', cost: 1, type: 'Attack' as const, rarity: 'Common' as const, description: '', keywords: [] },
      { id: 'B', name: 'B', cost: 2, type: 'Skill' as const, rarity: 'Rare' as const, description: '', keywords: [] }
    ]

    expect(loadCards(newCards)).toBe(true)

    const state = useCardStore.getState()
    expect(state.cards).toEqual(newCards)
    expect(state.currentCard).toEqual(newCards[0])
    expect(state.selectedCardId).toBe('A')
  })

  it('loadCards 拒绝大小写冲突的 Card ID，不替换现有状态', () => {
    const { addCardWithData, loadCards } = useCardStore.getState()
    addCardWithData({ id: 'Stable', name: 'Stable', cost: 1, type: 'Attack', rarity: 'Common', description: '', keywords: [] })
    expect(loadCards([
      { id: 'Fireball', name: 'A', cost: 1, type: 'Attack', rarity: 'Common', description: '', keywords: [] },
      { id: 'fireball', name: 'B', cost: 1, type: 'Attack', rarity: 'Common', description: '', keywords: [] },
    ])).toBe(false)
    expect(useCardStore.getState().cards.map(card => card.id)).toEqual(['Stable'])
  })

  it('按 CardDocument 加载与更新时保留同一文档的行为图', () => {
    const graph = createEmptyGraph('GraphCard', 'card')
    const document = {
      schemaVersion: 2,
      card: { id: 'GraphCard', name: 'Graph Card', cost: 1, type: 'Attack' as const, rarity: 'Common' as const, description: '', keywords: [] },
      graph,
      generation: { lastGeneratedFingerprint: null },
    }
    const { loadCardDocuments, updateCard } = useCardStore.getState()
    expect(loadCardDocuments([document])).toBe(true)
    updateCard('GraphCard', { name: 'Renamed' })
    const state = useCardStore.getState()
    expect(state.currentDocument?.card.name).toBe('Renamed')
    expect(state.currentDocument?.graph).toBe(graph)
    expect(state.currentDocument?.generation.lastGeneratedFingerprint).toBeNull()
    expect(state.documents[0].graph).toBe(graph)
  })
})
