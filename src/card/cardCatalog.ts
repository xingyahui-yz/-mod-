import { create } from 'zustand'
import type { CardData } from '../types'
import type { NodeGraph } from '../node-editor/types'
import { createEmptyGraph } from '../node-editor/graph'
import { commitHistory, createHistory, redoHistory, undoHistory, type HistoryState } from '../history/history'
import { applyCardProposal as applyProposalDocument, cardDocumentRevision, type CardProposal } from './cardAiProposal'
import { parseCardDocument, type CardDocument, type GenerationFingerprint } from './cardDocument'
import { isValidCardId } from './cardValidation'

type CardId = string

interface CardEditSnapshot {
  card: CardData
  graph: NodeGraph
}

interface CatalogState {
  order: CardId[]
  documentsById: Map<CardId, CardDocument>
  historiesById: Map<CardId, HistoryState<CardEditSnapshot>>
  selectedCardId: CardId | null
}

export interface CardCatalogView {
  documents: readonly CardDocument[]
  cards: readonly CardData[]
  selectedCardId: CardId | null
  currentDocument: CardDocument | null
  currentCard: CardData | null
  selectedCardIndex: number | null
  canUndo: boolean
  canRedo: boolean
}

export type CatalogError =
  | 'invalid-document'
  | 'invalid-card-id'
  | 'duplicate-card-id'
  | 'card-not-found'
  | 'no-selection'
  | 'stale-proposal'
  | 'stale-generation'

export type CatalogResult<T = void> =
  | { ok: true; value: T }
  | { ok: false; error: CatalogError }

interface OpenEdit {
  cardId: CardId
  base: CardEditSnapshot
  baseGeneration: CardDocument['generation']
  latest: CardEditSnapshot
  timer: ReturnType<typeof setTimeout> | null
}

const openEdits = new Map<string, OpenEdit>()

const emptyState: CatalogState = {
  order: [],
  documentsById: new Map(),
  historiesById: new Map(),
  selectedCardId: null,
}

const useCatalogState = create<CatalogState>()(() => emptyState)

function success<T = void>(value?: T): CatalogResult<T> {
  return { ok: true, value: value as T }
}

function failure(error: CatalogError): CatalogResult<never> {
  return { ok: false, error }
}

function snapshot(document: CardDocument): CardEditSnapshot {
  return { card: document.card, graph: document.graph }
}

function clearGeneration(document: CardDocument, next: CardEditSnapshot): CardDocument {
  return {
    ...document,
    card: next.card,
    graph: next.graph,
    generation: { lastGeneratedFingerprint: null },
  }
}

function sameSnapshot(a: CardEditSnapshot, b: CardEditSnapshot): boolean {
  return (a.card === b.card && a.graph === b.graph) || JSON.stringify(a) === JSON.stringify(b)
}

function deriveView(state: CatalogState): CardCatalogView {
  const documents = state.order.map(id => state.documentsById.get(id)!).filter(Boolean)
  const selectedIndex = state.selectedCardId === null ? -1 : state.order.indexOf(state.selectedCardId)
  const currentDocument = selectedIndex < 0 ? null : state.documentsById.get(state.order[selectedIndex]) ?? null
  const history = state.selectedCardId === null ? null : state.historiesById.get(state.selectedCardId) ?? null
  const hasOpenChange = state.selectedCardId !== null && [...openEdits.values()].some(edit =>
    edit.cardId === state.selectedCardId && !sameSnapshot(edit.base, edit.latest)
  )
  return {
    documents,
    cards: documents.map(document => document.card),
    selectedCardId: state.selectedCardId,
    currentDocument,
    currentCard: currentDocument?.card ?? null,
    selectedCardIndex: selectedIndex < 0 ? null : selectedIndex,
    canUndo: hasOpenChange || Boolean(history?.past.length),
    canRedo: !hasOpenChange && Boolean(history?.future.length),
  }
}

function cancelTimer(edit: OpenEdit): void {
  if (edit.timer) clearTimeout(edit.timer)
  edit.timer = null
}

function finishEditInternal(key: string): CatalogResult {
  const edit = openEdits.get(key)
  if (!edit) return success()
  cancelTimer(edit)
  openEdits.delete(key)
  const state = useCatalogState.getState()
  const history = state.historiesById.get(edit.cardId)
  const document = state.documentsById.get(edit.cardId)
  if (!history || !document) return failure('card-not-found')
  if (sameSnapshot(edit.base, edit.latest)) return success()
  const historiesById = new Map(state.historiesById)
  historiesById.set(edit.cardId, commitHistory(history, edit.latest))
  useCatalogState.setState({ historiesById })
  return success()
}

function finishCardEdits(cardId: CardId): void {
  for (const [key, edit] of [...openEdits]) {
    if (edit.cardId === cardId) finishEditInternal(key)
  }
}

function cancelAllEdits(): void {
  for (const edit of openEdits.values()) cancelTimer(edit)
  openEdits.clear()
}

function commitSnapshot(cardId: CardId, next: CardEditSnapshot): CatalogResult {
  finishCardEdits(cardId)
  const state = useCatalogState.getState()
  const document = state.documentsById.get(cardId)
  const history = state.historiesById.get(cardId)
  if (!document || !history) return failure('card-not-found')
  if (sameSnapshot(snapshot(document), next)) return success()
  const nextDocument = clearGeneration(document, next)
  if (parseCardDocument(nextDocument).status !== 'editable') return failure('invalid-document')
  const documentsById = new Map(state.documentsById)
  documentsById.set(cardId, nextDocument)
  const historiesById = new Map(state.historiesById)
  historiesById.set(cardId, commitHistory(history, next))
  useCatalogState.setState({ documentsById, historiesById })
  return success()
}

function updateMerged(key: string, cardId: CardId, next: CardEditSnapshot, idleMs?: number): CatalogResult {
  let edit = openEdits.get(key)
  if (edit && edit.cardId !== cardId) {
    finishEditInternal(key)
    edit = undefined
  }
  if (!edit) finishCardEdits(cardId)
  const state = useCatalogState.getState()
  const document = state.documentsById.get(cardId)
  const history = state.historiesById.get(cardId)
  if (!document || !history) return failure('card-not-found')
  const nextDocument = clearGeneration(document, next)
  if (parseCardDocument(nextDocument).status !== 'editable') return failure('invalid-document')

  if (!edit) {
    edit = { cardId, base: history.present, baseGeneration: document.generation, latest: next, timer: null }
    openEdits.set(key, edit)
  } else {
    edit.latest = next
  }
  cancelTimer(edit)
  if (idleMs !== undefined) edit.timer = setTimeout(() => finishEditInternal(key), idleMs)

  const documentsById = new Map(state.documentsById)
  documentsById.set(cardId, nextDocument)
  useCatalogState.setState({ documentsById })
  return success()
}

export const cardCatalogActions = {
  loadDocuments(documents: readonly CardDocument[]): CatalogResult {
    const ids = new Set<string>()
    for (const document of documents) {
      if (parseCardDocument(document).status !== 'editable') return failure('invalid-document')
      const normalized = document.card.id.toLowerCase()
      if (ids.has(normalized)) return failure('duplicate-card-id')
      ids.add(normalized)
    }
    cancelAllEdits()
    const order = documents.map(document => document.card.id)
    const documentsById = new Map(documents.map(document => [document.card.id, document]))
    const historiesById = new Map(documents.map(document => [document.card.id, createHistory(snapshot(document))]))
    useCatalogState.setState({ order, documentsById, historiesById, selectedCardId: order[0] ?? null })
    return success()
  },

  clear(): void {
    cancelAllEdits()
    useCatalogState.setState({ order: [], documentsById: new Map(), historiesById: new Map(), selectedCardId: null })
  },

  selectCard(cardId: CardId | null): CatalogResult {
    const state = useCatalogState.getState()
    if (cardId !== null && !state.documentsById.has(cardId)) return failure('card-not-found')
    if (state.selectedCardId) finishCardEdits(state.selectedCardId)
    useCatalogState.setState({ selectedCardId: cardId })
    return success()
  },

  createCard(card: CardData): CatalogResult<{ cardId: string }> {
    let state = useCatalogState.getState()
    if (!isValidCardId(card.id)) return failure('invalid-card-id')
    if (state.order.some(id => id.toLowerCase() === card.id.toLowerCase())) return failure('duplicate-card-id')
    if (state.selectedCardId) finishCardEdits(state.selectedCardId)
    state = useCatalogState.getState()
    const document: CardDocument = {
      schemaVersion: 2,
      card,
      graph: createEmptyGraph(card.id, 'card'),
      generation: { lastGeneratedFingerprint: null },
    }
    const documentsById = new Map(state.documentsById)
    documentsById.set(card.id, document)
    const historiesById = new Map(state.historiesById)
    historiesById.set(card.id, createHistory(snapshot(document)))
    useCatalogState.setState({ order: [...state.order, card.id], documentsById, historiesById, selectedCardId: card.id })
    return success({ cardId: card.id })
  },

  removeCard(cardId: CardId): CatalogResult {
    const state = useCatalogState.getState()
    if (!state.documentsById.has(cardId)) return failure('card-not-found')
    for (const [key, edit] of [...openEdits]) {
      if (edit.cardId === cardId) {
        cancelTimer(edit)
        openEdits.delete(key)
      }
    }
    const documentsById = new Map(state.documentsById)
    documentsById.delete(cardId)
    const historiesById = new Map(state.historiesById)
    historiesById.delete(cardId)
    useCatalogState.setState({
      order: state.order.filter(id => id !== cardId),
      documentsById,
      historiesById,
      selectedCardId: state.selectedCardId === cardId ? null : state.selectedCardId,
    })
    return success()
  },

  patchCurrentCard(
    patch: Partial<Omit<CardData, 'id'>>,
    options: { mergeKey?: string; idleMs?: number } = {},
  ): CatalogResult {
    const view = deriveView(useCatalogState.getState())
    if (!view.currentDocument) return failure('no-selection')
    const next = { card: { ...view.currentDocument.card, ...patch }, graph: view.currentDocument.graph }
    return options.mergeKey
      ? updateMerged(options.mergeKey, view.currentDocument.card.id, next, options.idleMs ?? 750)
      : commitSnapshot(view.currentDocument.card.id, next)
  },

  replaceCurrentGraph(graph: NodeGraph, options: { transactionKey?: string } = {}): CatalogResult {
    const view = deriveView(useCatalogState.getState())
    if (!view.currentDocument) return failure('no-selection')
    const next = { card: view.currentDocument.card, graph }
    return options.transactionKey
      ? updateMerged(options.transactionKey, view.currentDocument.card.id, next)
      : commitSnapshot(view.currentDocument.card.id, next)
  },

  finishEdit: finishEditInternal,

  cancelEdit(key: string): CatalogResult {
    const edit = openEdits.get(key)
    if (!edit) return success()
    cancelTimer(edit)
    openEdits.delete(key)
    const state = useCatalogState.getState()
    const document = state.documentsById.get(edit.cardId)
    if (!document) return failure('card-not-found')
    const documentsById = new Map(state.documentsById)
    documentsById.set(edit.cardId, {
      ...document,
      card: edit.base.card,
      graph: edit.base.graph,
      generation: edit.baseGeneration,
    })
    useCatalogState.setState({ documentsById })
    return success()
  },

  applyProposal(proposal: CardProposal): CatalogResult {
    const state = useCatalogState.getState()
    const current = state.documentsById.get(proposal.cardId)
    if (!current) return failure('card-not-found')
    const applied = applyProposalDocument(current, proposal)
    if (!applied.ok) return failure('stale-proposal')
    return commitSnapshot(proposal.cardId, snapshot(applied.document))
  },

  recordGeneration(input: { cardId: CardId; baseRevision: string; fingerprint: GenerationFingerprint }): CatalogResult {
    finishCardEdits(input.cardId)
    const state = useCatalogState.getState()
    const document = state.documentsById.get(input.cardId)
    if (!document) return failure('card-not-found')
    if (cardDocumentRevision(document) !== input.baseRevision) return failure('stale-generation')
    const documentsById = new Map(state.documentsById)
    documentsById.set(input.cardId, { ...document, generation: { lastGeneratedFingerprint: input.fingerprint } })
    useCatalogState.setState({ documentsById })
    return success()
  },

  undo(): void {
    const state = useCatalogState.getState()
    const cardId = state.selectedCardId
    if (!cardId) return
    finishCardEdits(cardId)
    const latest = useCatalogState.getState()
    const history = latest.historiesById.get(cardId)
    const document = latest.documentsById.get(cardId)
    if (!history || !document) return
    const nextHistory = undoHistory(history)
    if (nextHistory === history) return
    const historiesById = new Map(latest.historiesById)
    historiesById.set(cardId, nextHistory)
    const documentsById = new Map(latest.documentsById)
    documentsById.set(cardId, clearGeneration(document, nextHistory.present))
    useCatalogState.setState({ historiesById, documentsById })
  },

  redo(): void {
    const state = useCatalogState.getState()
    const cardId = state.selectedCardId
    if (!cardId) return
    finishCardEdits(cardId)
    const latest = useCatalogState.getState()
    const history = latest.historiesById.get(cardId)
    const document = latest.documentsById.get(cardId)
    if (!history || !document) return
    const nextHistory = redoHistory(history)
    if (nextHistory === history) return
    const historiesById = new Map(latest.historiesById)
    historiesById.set(cardId, nextHistory)
    const documentsById = new Map(latest.documentsById)
    documentsById.set(cardId, clearGeneration(document, nextHistory.present))
    useCatalogState.setState({ historiesById, documentsById })
  },
}

export function useCardCatalog<T>(selector: (view: CardCatalogView) => T): T {
  return useCatalogState(state => selector(deriveView(state)))
}

export function getCardCatalogView(): CardCatalogView {
  return deriveView(useCatalogState.getState())
}
