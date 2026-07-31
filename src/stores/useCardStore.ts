import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { CardData } from '../types'

interface CardStore {
  cards: CardData[]
  currentCard: CardData | null
  selectedCardIndex: number | null

  addCard: () => void
  addCardWithData: (card: CardData) => void
  updateCard: (index: number, card: Partial<CardData>) => void
  deleteCard: (index: number) => void
  selectCard: (index: number | null) => void
  setCurrentCard: (card: CardData | null) => void
  loadCards: (cards: CardData[]) => void
  clearCards: () => void
}

const defaultCard: CardData = {
  name: '',
  cost: 1,
  type: 'Attack',
  rarity: 'Common',
  description: '',
  keywords: []
}

export const useCardStore = create<CardStore>()(
  persist(
    (set, get) => ({
      cards: [],
      currentCard: null,
      selectedCardIndex: null,

      addCard: () => {
        const newCard: CardData = { ...defaultCard }
        set(state => ({
          cards: [...state.cards, newCard],
          currentCard: newCard,
          selectedCardIndex: state.cards.length
        }))
      },

      addCardWithData: (card: CardData) => {
        set(state => ({
          cards: [...state.cards, card],
          currentCard: card,
          selectedCardIndex: state.cards.length
        }))
      },

      updateCard: (index: number, card: Partial<CardData>) => {
        set(state => {
          const newCards = [...state.cards]
          newCards[index] = { ...newCards[index], ...card }
          return {
            cards: newCards,
            currentCard: state.selectedCardIndex === index
              ? newCards[index]
              : state.currentCard
          }
        })
      },

      deleteCard: (index: number) => {
        set(state => {
          const newCards = state.cards.filter((_, i) => i !== index)
          return {
            cards: newCards,
            currentCard: state.selectedCardIndex === index ? null : state.currentCard,
            selectedCardIndex: null
          }
        })
      },

      selectCard: (index: number | null) => {
        const { cards } = get()
        set({
          selectedCardIndex: index,
          currentCard: index !== null ? cards[index] : null
        })
      },

      setCurrentCard: (card: CardData | null) => {
        set({ currentCard: card })
        if (card) {
          const index = get().cards.findIndex(c => c.name === card.name && c.type === card.type)
          if (index !== -1) {
            set({ selectedCardIndex: index })
          }
        }
      },

      loadCards: (cards: CardData[]) => {
        set({
          cards,
          currentCard: cards.length > 0 ? cards[0] : null,
          selectedCardIndex: cards.length > 0 ? 0 : null
        })
      },

      clearCards: () => {
        set({
          cards: [],
          currentCard: null,
          selectedCardIndex: null
        })
      }
    }),
    {
      name: 'mod-studio-cards',
      // 只持久化卡牌数据（UI状态不持久化）
      partialize: (state) => ({
        cards: state.cards
      }),
      // 重新挂载时重置UI状态
      onRehydrateStorage: () => (state) => {
        if (state) {
          state.currentCard = null
          state.selectedCardIndex = null
        }
      }
    }
  )
)