import { create } from 'zustand'
import { CardData } from '../types'
import { isValidCardId } from '../card/cardValidation'

interface CardStore {
  cards: CardData[]
  currentCard: CardData | null
  selectedCardId: string | null
  /** 仅供列表显示映射，不作为 Card 身份。 */
  selectedCardIndex: number | null

  addCard: () => void
  addCardWithData: (card: CardData) => void
  updateCard: (cardId: string, card: Partial<CardData>) => void
  deleteCard: (cardId: string) => void
  selectCard: (cardId: string | null) => void
  setCurrentCard: (card: CardData | null) => void
  loadCards: (cards: CardData[]) => boolean
  clearCards: () => void
}

const defaultCard: CardData = {
  id: 'NewCard',
  name: '',
  cost: 1,
  type: 'Attack',
  rarity: 'Common',
  description: '',
  keywords: []
}

export const useCardStore = create<CardStore>()(
  (set, get) => ({
      cards: [],
      currentCard: null,
      selectedCardId: null,
      selectedCardIndex: null,

      addCard: () => {
        const newCard: CardData = { ...defaultCard }
        set(state => ({
          cards: [...state.cards, newCard],
          currentCard: newCard,
          selectedCardId: newCard.id,
          selectedCardIndex: state.cards.length
        }))
      },

      addCardWithData: (card: CardData) => {
        set(state => ({
          cards: [...state.cards, card],
          currentCard: card,
          selectedCardId: card.id,
          selectedCardIndex: state.cards.length
        }))
      },

      updateCard: (cardId: string, card: Partial<CardData>) => {
        set(state => {
          const newCards = [...state.cards]
          const index = newCards.findIndex(item => item.id === cardId)
          if (index === -1) return state
          const { id: _ignoredId, ...mutableFields } = card
          newCards[index] = { ...newCards[index], ...mutableFields }
          return {
            cards: newCards,
            currentCard: state.selectedCardId === cardId
              ? newCards[index]
              : state.currentCard
          }
        })
      },

      deleteCard: (cardId: string) => {
        set(state => {
          const newCards = state.cards.filter(card => card.id !== cardId)
          if (newCards.length === state.cards.length) return state
          return {
            cards: newCards,
            currentCard: state.selectedCardId === cardId ? null : state.currentCard,
            selectedCardId: state.selectedCardId === cardId ? null : state.selectedCardId,
            selectedCardIndex: state.selectedCardId === cardId
              ? null
              : newCards.findIndex(card => card.id === state.selectedCardId)
          }
        })
      },

      selectCard: (cardId: string | null) => {
        const { cards } = get()
        const index = cardId === null ? -1 : cards.findIndex(card => card.id === cardId)
        set({
          selectedCardId: index === -1 ? null : cards[index].id,
          selectedCardIndex: index === -1 ? null : index,
          currentCard: index === -1 ? null : cards[index]
        })
      },

      setCurrentCard: (card: CardData | null) => {
        set({ currentCard: card })
        if (card) {
          const index = get().cards.findIndex(c => c.id === card.id)
          if (index !== -1) {
            set({ selectedCardId: card.id, selectedCardIndex: index })
          }
        } else {
          set({ selectedCardId: null, selectedCardIndex: null })
        }
      },

      loadCards: (cards: CardData[]) => {
        const ids = cards.map(card => card.id.toLowerCase())
        if (cards.some(card => !isValidCardId(card.id)) || new Set(ids).size !== ids.length) return false
        set({
          cards,
          currentCard: cards.length > 0 ? cards[0] : null,
          selectedCardId: cards.length > 0 ? cards[0].id : null,
          selectedCardIndex: cards.length > 0 ? 0 : null
        })
        return true
      },

      clearCards: () => {
        set({
          cards: [],
          currentCard: null,
          selectedCardId: null,
          selectedCardIndex: null
        })
      }
    })
)
