import { create } from 'zustand'
import { CardData } from '../types'
import { isValidCardId } from '../card/cardValidation'
import type { CardDocument } from '../card/cardDocument'
import { createEmptyGraph } from '../node-editor/graph'

interface CardStore {
  cards: CardData[]
  documents: CardDocument[]
  currentCard: CardData | null
  currentDocument: CardDocument | null
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
  loadCardDocuments: (documents: CardDocument[]) => boolean
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

function documentForCard(card: CardData): CardDocument {
  return {
    schemaVersion: 2,
    card,
    graph: createEmptyGraph(card.id, 'card'),
    generation: { lastGeneratedFingerprint: null },
  }
}

export const useCardStore = create<CardStore>()(
  (set, get) => ({
      cards: [],
      documents: [],
      currentCard: null,
      currentDocument: null,
      selectedCardId: null,
      selectedCardIndex: null,

      addCard: () => {
        const newCard: CardData = { ...defaultCard }
        const document = documentForCard(newCard)
        set(state => ({
          cards: [...state.cards, newCard],
          documents: [...state.documents, document],
          currentCard: newCard,
          currentDocument: document,
          selectedCardId: newCard.id,
          selectedCardIndex: state.cards.length
        }))
      },

      addCardWithData: (card: CardData) => {
        const document = documentForCard(card)
        set(state => ({
          cards: [...state.cards, card],
          documents: [...state.documents, document],
          currentCard: card,
          currentDocument: document,
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
          const newDocuments = state.documents.map(document =>
            document.card.id === cardId
              ? {
                ...document,
                card: newCards[index],
                generation: { ...document.generation, lastGeneratedFingerprint: null },
              }
              : document
          )
          return {
            cards: newCards,
            documents: newDocuments,
            currentCard: state.selectedCardId === cardId
              ? newCards[index]
              : state.currentCard,
            currentDocument: state.selectedCardId === cardId
              ? newDocuments.find(document => document.card.id === cardId) ?? state.currentDocument
              : state.currentDocument
          }
        })
      },

      deleteCard: (cardId: string) => {
        set(state => {
          const newCards = state.cards.filter(card => card.id !== cardId)
          if (newCards.length === state.cards.length) return state
          return {
            cards: newCards,
            documents: state.documents.filter(document => document.card.id !== cardId),
            currentCard: state.selectedCardId === cardId ? null : state.currentCard,
            currentDocument: state.selectedCardId === cardId ? null : state.currentDocument,
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
          currentCard: index === -1 ? null : cards[index],
          currentDocument: index === -1 ? null : get().documents.find(document => document.card.id === cards[index].id) ?? null,
        })
      },

      setCurrentCard: (card: CardData | null) => {
        set({ currentCard: card })
        if (card) {
          const index = get().cards.findIndex(c => c.id === card.id)
          if (index !== -1) {
            set({ selectedCardId: card.id, selectedCardIndex: index, currentDocument: get().documents[index] ?? null })
          } else {
            set({ selectedCardId: null, selectedCardIndex: null, currentDocument: null })
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
          documents: cards.map(documentForCard),
          currentCard: cards.length > 0 ? cards[0] : null,
          currentDocument: cards.length > 0 ? documentForCard(cards[0]) : null,
          selectedCardId: cards.length > 0 ? cards[0].id : null,
          selectedCardIndex: cards.length > 0 ? 0 : null
        })
        return true
      },

      loadCardDocuments: (documents: CardDocument[]) => {
        const cards = documents.map(document => document.card)
        const ids = cards.map(card => card.id.toLowerCase())
        if (cards.some(card => !isValidCardId(card.id)) || new Set(ids).size !== ids.length) return false
        set({
          documents,
          cards,
          currentDocument: documents.length > 0 ? documents[0] : null,
          currentCard: cards.length > 0 ? cards[0] : null,
          selectedCardId: cards.length > 0 ? cards[0].id : null,
          selectedCardIndex: cards.length > 0 ? 0 : null,
        })
        return true
      },

      clearCards: () => {
        set({
          cards: [],
          documents: [],
          currentCard: null,
          currentDocument: null,
          selectedCardId: null,
          selectedCardIndex: null
        })
      }
    })
)
