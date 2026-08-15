import { create } from 'zustand'
import { CardData } from '../types'
import { isValidCardId } from '../card/cardValidation'
import type { CardDocument } from '../card/cardDocument'
import { createEmptyGraph } from '../node-editor/graph'
import { commitHistory, createHistory, redoHistory, undoHistory, type HistoryState } from '../history/history'
import { applyCardProposal, type CardProposal } from '../card/cardAiProposal'

interface CardStore {
  cards: CardData[]
  documents: CardDocument[]
  currentCard: CardData | null
  currentDocument: CardDocument | null
  cardHistory: HistoryState<CardDocument> | null
  selectedCardId: string | null
  /** 仅供列表显示映射，不作为 Card 身份。 */
  selectedCardIndex: number | null

  addCard: () => void
  addCardWithData: (card: CardData) => boolean
  updateCard: (cardId: string, card: Partial<CardData>) => void
  updateGraph: (cardId: string, graph: CardDocument['graph']) => void
  applyCardProposal: (proposal: CardProposal) => boolean
  setGeneratedDocument: (document: CardDocument) => boolean
  deleteCard: (cardId: string) => void
  selectCard: (cardId: string | null) => void
  setCurrentCard: (card: CardData | null) => void
  loadCards: (cards: CardData[]) => boolean
  loadCardDocuments: (documents: CardDocument[]) => boolean
  undoCard: () => void
  redoCard: () => void
  canUndoCard: boolean
  canRedoCard: boolean
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

function nextCardId(cards: CardData[]): string {
  const used = new Set(cards.map(card => card.id.toLowerCase()))
  if (!used.has('newcard')) return 'NewCard'
  let suffix = 2
  while (used.has(`newcard${suffix}`)) suffix += 1
  return `NewCard${suffix}`
}

function historyDocument(document: CardDocument): CardDocument {
  return {
    ...document,
    generation: { lastGeneratedFingerprint: null },
  }
}

export const useCardStore = create<CardStore>()(
  (set, get) => ({
      cards: [],
      documents: [],
      currentCard: null,
      currentDocument: null,
      cardHistory: null,
      canUndoCard: false,
      canRedoCard: false,
      selectedCardId: null,
      selectedCardIndex: null,

      addCard: () => {
        const newCard: CardData = { ...defaultCard, id: nextCardId(get().cards) }
        const document = documentForCard(newCard)
        set(state => ({
          cards: [...state.cards, newCard],
          documents: [...state.documents, document],
          currentCard: newCard,
          currentDocument: document,
          cardHistory: createHistory(historyDocument(document)),
          canUndoCard: false,
          canRedoCard: false,
          selectedCardId: newCard.id,
          selectedCardIndex: state.cards.length
        }))
      },

      addCardWithData: (card: CardData) => {
        const ids = get().cards.map(item => item.id.toLowerCase())
        if (!isValidCardId(card.id) || ids.includes(card.id.toLowerCase())) return false
        const document = documentForCard(card)
        set(state => ({
          cards: [...state.cards, card],
          documents: [...state.documents, document],
          currentCard: card,
          currentDocument: document,
          cardHistory: createHistory(historyDocument(document)),
          canUndoCard: false,
          canRedoCard: false,
          selectedCardId: card.id,
          selectedCardIndex: state.cards.length
        }))
        return true
      },

      updateCard: (cardId: string, card: Partial<CardData>) => {
        set(state => {
          const index = state.cards.findIndex(item => item.id === cardId)
          if (index === -1) return state
          const { id: _ignoredId, ...mutableFields } = card
          const currentDocument = state.documents.find(document => document.card.id === cardId)
          if (!currentDocument) return state
          const nextDocument: CardDocument = {
            ...currentDocument,
            card: { ...currentDocument.card, ...mutableFields },
            generation: { ...currentDocument.generation, lastGeneratedFingerprint: null },
          }
          const nextHistory = state.selectedCardId === cardId && state.cardHistory
            ? commitHistory(state.cardHistory, nextDocument)
            : state.cardHistory
          const effectiveDocument = nextHistory?.present ?? nextDocument
          const newDocuments = state.documents.map(document =>
            document.card.id === cardId ? effectiveDocument : document
          )
          const newCards = newDocuments.map(document => document.card)
          return {
            cards: newCards,
            documents: newDocuments,
            currentCard: state.selectedCardId === cardId
              ? effectiveDocument.card
              : state.currentCard,
            currentDocument: state.selectedCardId === cardId
              ? effectiveDocument
              : state.currentDocument,
            cardHistory: nextHistory,
            canUndoCard: nextHistory ? nextHistory.past.length > 0 : false,
            canRedoCard: nextHistory ? nextHistory.future.length > 0 : false,
          }
        })
      },

      updateGraph: (cardId, graph) => {
        set(state => {
          const currentDocument = state.documents.find(document => document.card.id === cardId)
          if (!currentDocument) return state
          const nextDocument: CardDocument = {
            ...currentDocument,
            graph,
            generation: { ...currentDocument.generation, lastGeneratedFingerprint: null },
          }
          const nextHistory = state.selectedCardId === cardId && state.cardHistory
            ? commitHistory(state.cardHistory, nextDocument)
            : state.cardHistory
          const effectiveDocument = nextHistory?.present ?? nextDocument
          const documents = state.documents.map(document => document.card.id === cardId ? effectiveDocument : document)
          return {
            documents,
            cards: documents.map(document => document.card),
            currentDocument: state.selectedCardId === cardId ? effectiveDocument : state.currentDocument,
            currentCard: state.selectedCardId === cardId ? effectiveDocument.card : state.currentCard,
            cardHistory: nextHistory,
            canUndoCard: nextHistory ? nextHistory.past.length > 0 : false,
            canRedoCard: nextHistory ? nextHistory.future.length > 0 : false,
          }
        })
      },

      applyCardProposal: (proposal) => {
        const state = get()
        const current = state.documents.find(document => document.card.id === proposal.cardId)
        if (!current) return false
        const applied = applyCardProposal(current, proposal)
        if (!applied.ok) return false
        const nextDocument = {
          ...applied.document,
          generation: { lastGeneratedFingerprint: null },
        }
        const nextHistory = state.selectedCardId === proposal.cardId && state.cardHistory
          ? commitHistory(state.cardHistory, nextDocument)
          : state.cardHistory
        const effectiveDocument = nextHistory?.present ?? nextDocument
        const documents = state.documents.map(document => document.card.id === proposal.cardId ? effectiveDocument : document)
        set({
          documents,
          cards: documents.map(document => document.card),
          currentDocument: state.selectedCardId === proposal.cardId ? effectiveDocument : state.currentDocument,
          currentCard: state.selectedCardId === proposal.cardId ? effectiveDocument.card : state.currentCard,
          cardHistory: nextHistory,
          canUndoCard: nextHistory ? nextHistory.past.length > 0 : false,
          canRedoCard: nextHistory ? nextHistory.future.length > 0 : false,
        })
        return true
      },

      setGeneratedDocument: (document) => {
        const state = get()
        if (!state.documents.some(item => item.card.id === document.card.id)) return false
        const documents = state.documents.map(item => item.card.id === document.card.id ? document : item)
        set({
          documents,
          cards: documents.map(item => item.card),
          currentDocument: state.selectedCardId === document.card.id ? document : state.currentDocument,
          currentCard: state.selectedCardId === document.card.id ? document.card : state.currentCard,
        })
        return true
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
            cardHistory: state.selectedCardId === cardId ? null : state.cardHistory,
            canUndoCard: state.selectedCardId === cardId ? false : state.canUndoCard,
            canRedoCard: state.selectedCardId === cardId ? false : state.canRedoCard,
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
          cardHistory: index === -1 ? null : (() => {
            const document = get().documents.find(item => item.card.id === cards[index].id)
            return document ? createHistory(historyDocument(document)) : null
          })(),
          canUndoCard: false,
          canRedoCard: false,
        })
      },

      setCurrentCard: (card: CardData | null) => {
        set({ currentCard: card })
        if (card) {
          const index = get().cards.findIndex(c => c.id === card.id)
          if (index !== -1) {
            const document = get().documents.find(item => item.card.id === card.id) ?? null
            set({ selectedCardId: card.id, selectedCardIndex: index, currentDocument: document, cardHistory: document ? createHistory(historyDocument(document)) : null, canUndoCard: false, canRedoCard: false })
          } else {
            set({ selectedCardId: null, selectedCardIndex: null, currentDocument: null, cardHistory: null, canUndoCard: false, canRedoCard: false })
          }
        } else {
          set({ selectedCardId: null, selectedCardIndex: null, currentDocument: null, cardHistory: null, canUndoCard: false, canRedoCard: false })
        }
      },

      loadCards: (cards: CardData[]) => {
        const ids = cards.map(card => card.id.toLowerCase())
        if (cards.some(card => !isValidCardId(card.id)) || new Set(ids).size !== ids.length) return false
        const documents = cards.map(documentForCard)
        set({
          cards,
          documents,
          currentCard: cards.length > 0 ? cards[0] : null,
          currentDocument: documents.length > 0 ? documents[0] : null,
          cardHistory: documents.length > 0 ? createHistory(historyDocument(documents[0])) : null,
          canUndoCard: false,
          canRedoCard: false,
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
          cardHistory: documents.length > 0 ? createHistory(historyDocument(documents[0])) : null,
          canUndoCard: false,
          canRedoCard: false,
          currentCard: cards.length > 0 ? cards[0] : null,
          selectedCardId: cards.length > 0 ? cards[0].id : null,
          selectedCardIndex: cards.length > 0 ? 0 : null,
        })
        return true
      },

      undoCard: () => {
        set(state => {
          if (!state.cardHistory) return state
          const history = undoHistory(state.cardHistory)
          if (history === state.cardHistory) return state
          const documents = state.documents.map(document => document.card.id === history.present.card.id ? history.present : document)
          return { cardHistory: history, documents, cards: documents.map(document => document.card), currentDocument: history.present, currentCard: history.present.card, canUndoCard: history.past.length > 0, canRedoCard: history.future.length > 0 }
        })
      },

      redoCard: () => {
        set(state => {
          if (!state.cardHistory) return state
          const history = redoHistory(state.cardHistory)
          if (history === state.cardHistory) return state
          const documents = state.documents.map(document => document.card.id === history.present.card.id ? history.present : document)
          return { cardHistory: history, documents, cards: documents.map(document => document.card), currentDocument: history.present, currentCard: history.present.card, canUndoCard: history.past.length > 0, canRedoCard: history.future.length > 0 }
        })
      },

      clearCards: () => {
        set({
          cards: [],
          documents: [],
          currentCard: null,
          currentDocument: null,
          cardHistory: null,
          canUndoCard: false,
          canRedoCard: false,
          selectedCardId: null,
          selectedCardIndex: null
        })
      }
    })
)
