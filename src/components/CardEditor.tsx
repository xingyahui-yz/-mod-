import { useState, useEffect, useLayoutEffect, useMemo, useRef, useSyncExternalStore } from 'react'
import {
  cardCatalogActions,
  getCardCatalogView,
  subscribeCardCatalogEvents,
  useCardCatalog,
} from '../card/cardCatalog'
import { CardData, createDefaultCard } from '../types'
import { generateCardDocumentCode } from '../card/codegen'
import { isValidCardId, validateCard } from '../card/cardValidation'
import { getTypeColor } from '../utils/cardUtils'
import { CardIOButtons } from './CardIOButtons'
import { CardSearch } from './CardSearch'
import { Toast } from './Toast'
import { useTransientMessage } from '../hooks/useTransientMessage'
import * as FileService from '../services/FileService'
import { NodeGraphCanvas } from '../node-editor/NodeGraphCanvas'
import { appendNode, connect, createEmptyGraph, disconnect, moveNode, removeNode } from '../node-editor/graph'
import type { NodeGraph } from '../node-editor/types'
import { effectsForEntity, triggersForEntity, EFFECT_KINDS } from '../shared/kinds'
import { CURRENT_CARD_SCHEMA_VERSION, serializeCardDocument, type CardDocument } from '../card/cardDocument'
import { cardDocumentRevision } from '../card/cardAiProposal'
import type { CardDocumentLoadEntry } from '../card/cardRepository'
import type { CardTrashEntry } from '../card/cardTrash'
import type { BatchGenerationReport } from '../card/cardBatchGeneration'
import {
  clearCardPersistenceFailures,
  hasCardPersistenceFailure,
  isCardPersistenceBlocked,
  subscribeCardPersistenceBarrier,
  waitForCardPersistenceBarrier,
} from '../card/cardPersistenceBarrier'
import { registerProjectCardFlusher } from '../card/cardPersistenceCoordinator'
import { reserveCardId } from '../card/cardIdReservation'

interface CardEditorProps {
  projectPath: string | null
}

export function CardEditor({ projectPath }: CardEditorProps) {
  const cards = useCardCatalog(view => view.cards)
  const currentCard = useCardCatalog(view => view.currentCard)
  const currentDocument = useCardCatalog(view => view.currentDocument)
  const selectedCardId = useCardCatalog(view => view.selectedCardId)
  const canUndo = useCardCatalog(view => view.canUndo)
  const canRedo = useCardCatalog(view => view.canRedo)
  const persistenceBarrierSubscribe = useMemo(
    () => (listener: () => void) => projectPath && selectedCardId
      ? subscribeCardPersistenceBarrier(projectPath, selectedCardId, listener)
      : () => undefined,
    [projectPath, selectedCardId],
  )
  const persistenceBarrierSnapshot = useMemo(
    () => () => Boolean(projectPath && selectedCardId &&
      isCardPersistenceBlocked(projectPath, selectedCardId)),
    [projectPath, selectedCardId],
  )
  const cardPersistenceBlocked = useSyncExternalStore(
    persistenceBarrierSubscribe,
    persistenceBarrierSnapshot,
    persistenceBarrierSnapshot,
  )

  const [generatedCode, setGeneratedCode] = useState<string>('')
  const [saving, setSaving] = useState(false)
  const { message: saveMessage, showMessage: showSaveMessage } = useTransientMessage()
  const { message: loadMessage, showMessage: showLoadMessage } = useTransientMessage()
  const [errors, setErrors] = useState<string[]>([])
  const [loadingCards, setLoadingCards] = useState(false)
  const [searchTerm, setSearchTerm] = useState('')
  const [typeFilter, setTypeFilter] = useState<'all' | CardData['type']>('all')
  const graph: NodeGraph | null = currentDocument?.graph ?? null
  const [graphError, setGraphError] = useState<string | null>(null)
  const [autosaveState, setAutosaveState] = useState<'idle' | 'pending' | 'saving' | 'saved' | 'error'>('idle')
  const autosaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const autosaveCardId = useRef<string | null>(null)
  const proposalManagedSnapshots = useRef(new Map<string, string>())
  const deferredAutosaveTokens = useRef(new Map<string, number>())
  const persistedSnapshots = useRef(new Map<string, string>())
  const persistedCardKeys = useRef(new Set<string>())
  const failedTransactionKeys = useRef(new Set<string>())
  const editorPersistenceTails = useRef(new Map<string, Promise<void>>())
  const deferredAutosaveTasks = useRef(new Map<string, Promise<void>>())
  const editorPersistenceErrors = useRef(new Map<string, string>())
  const pendingUnmountFlush = useRef<(() => Promise<boolean>) | null>(null)
  const activeProjectRef = useRef<string | null>(projectPath)
  const loadedProjectRef = useRef<string | null>(null)
  const loadGenerationRef = useRef(0)
  const [showCreateIdDialog, setShowCreateIdDialog] = useState(false)
  const [newCardId, setNewCardId] = useState('NewCard')
  const [recoveryEntries, setRecoveryEntries] = useState<CardDocumentLoadEntry[]>([])
  const [trashEntries, setTrashEntries] = useState<CardTrashEntry[]>([])
  const [batchReport, setBatchReport] = useState<BatchGenerationReport | null>(null)

  // 在 passive autosave cleanup 之前切换项目 token；cleanup 仍持有旧 root，
  // 因此可以安全 flush A，但新 effect 绝不会把 A 文档绑定到 B。
  useLayoutEffect(() => {
    if (activeProjectRef.current === projectPath) return
    activeProjectRef.current = projectPath
    loadedProjectRef.current = null
    proposalManagedSnapshots.current.clear()
    deferredAutosaveTokens.current.clear()
    persistedSnapshots.current.clear()
    loadGenerationRef.current += 1
    setSaving(false)
    setLoadingCards(false)
    setErrors([])
    setGeneratedCode('')
    setRecoveryEntries([])
    setTrashEntries([])
    setBatchReport(null)
    setShowCreateIdDialog(false)
  }, [projectPath])

  const isActiveCatalogProject = (projectRoot: string) =>
    activeProjectRef.current === projectRoot && getCardCatalogView().sourceProjectRoot === projectRoot

  const cardPersistenceKey = (projectRoot: string, cardId: string) =>
    `${projectRoot}\0${cardId.toLowerCase()}`

  /**
   * CardEditor 的所有源文档写入共享这一条逐 Card 队列。首次写入必须走
   * no-replace create；只有本实例已加载或已成功创建的路径才能走 save。
   */
  const persistCardDocument = (
    projectRoot: string,
    document: CardDocument,
  ): ReturnType<typeof FileService.saveCardDocument> => {
    const key = cardPersistenceKey(projectRoot, document.card.id)
    const previous = editorPersistenceTails.current.get(key) ?? Promise.resolve()
    const persist = async () => {
      const transactionPersisted = await waitForCardPersistenceBarrier(projectRoot, document.card.id)
      if (!transactionPersisted) {
        failedTransactionKeys.current.add(key)
        const error = 'Card 事务持久化失败，请重新加载项目后重试'
        editorPersistenceErrors.current.set(key, error)
        return { ok: false as const, error }
      }
      const activeCatalog = isActiveCatalogProject(projectRoot)
      const latest = activeCatalog
        ? getCardCatalogView().documents.find(candidate => candidate.card.id === document.card.id)
        : document
      if (!latest) return { ok: false as const, error: 'Card 已从当前项目移除' }
      const latestSnapshot = serializeCardDocument(latest)
      if (proposalManagedSnapshots.current.get(document.card.id) === latestSnapshot) {
        persistedCardKeys.current.add(key)
      }
      const saved = persistedCardKeys.current.has(key)
        ? await FileService.saveCardDocument(projectRoot, latest)
        : await FileService.createCardDocument(projectRoot, latest)
      if (saved.ok) {
        editorPersistenceErrors.current.delete(key)
        persistedCardKeys.current.add(key)
        if (activeCatalog) {
          persistedSnapshots.current.set(latest.card.id, latestSnapshot)
        }
      } else editorPersistenceErrors.current.set(key, saved.error)
      return saved
    }
    const result = previous.then(persist, persist)
    const tail = result.then(() => undefined, () => undefined)
    editorPersistenceTails.current.set(key, tail)
    void tail.then(() => {
      if (editorPersistenceTails.current.get(key) === tail) editorPersistenceTails.current.delete(key)
    })
    return result
  }

  const drainEditorPersistence = async (projectRoot: string): Promise<void> => {
    const prefix = `${projectRoot}\0`
    while (true) {
      const pending = [...editorPersistenceTails.current]
        .filter(([key]) => key.startsWith(prefix))
        .map(([, tail]) => tail)
        .concat([...deferredAutosaveTasks.current]
          .filter(([key]) => key.startsWith(prefix))
          .map(([, task]) => task))
      if (pending.length === 0) return
      await Promise.all(pending)
      const hasEditorWrite = [...editorPersistenceTails.current.keys()]
        .some(key => key.startsWith(prefix))
      const hasDeferredSave = [...deferredAutosaveTasks.current.keys()]
        .some(key => key.startsWith(prefix))
      if (!hasEditorWrite && !hasDeferredSave) return
    }
  }

  useEffect(() => setGraphError(null), [selectedCardId])

  // AI proposal application 自己负责 `conversation WAL → Card → committed`。
  // Catalog 事件同步到达，因此可在 React effect cleanup 之前丢弃同 Card 的
  // 旧 autosave，并标记新快照不再由通用 autosave 重复/抢先写入。
  useLayoutEffect(() => {
    if (!projectPath) return
    return subscribeCardCatalogEvents(event => {
      if (event.sourceProjectRoot !== projectPath) return
      if (autosaveTimer.current && autosaveCardId.current === event.cardId) {
        clearTimeout(autosaveTimer.current)
        autosaveTimer.current = null
        autosaveCardId.current = null
      }
      const document = getCardCatalogView().documents.find(candidate => candidate.card.id === event.cardId)
      if (document) proposalManagedSnapshots.current.set(event.cardId, serializeCardDocument(document))
    })
  }, [projectPath])

  // Card 属性与行为图共享同一份防抖草稿自动保存；generation 指纹随编辑
  // 失效但不会在这里生成 C#。effect cleanup 会在切换 Card/项目或卸载前
  // 尽力 flush 当前待保存快照，避免用户快速切换丢失最后一次编辑。
  useEffect(() => {
    if (autosaveTimer.current) {
      clearTimeout(autosaveTimer.current)
      autosaveTimer.current = null
      autosaveCardId.current = null
    }
    if (!projectPath || loadedProjectRef.current !== projectPath ||
      getCardCatalogView().sourceProjectRoot !== projectPath) {
      persistedSnapshots.current.clear()
      setAutosaveState('idle')
      return
    }
    if (!currentDocument) {
      setAutosaveState('idle')
      return
    }

    const snapshot = serializeCardDocument(currentDocument)
    if (cardPersistenceBlocked) {
      const managedSnapshot = proposalManagedSnapshots.current.get(currentDocument.card.id)
      if (managedSnapshot !== snapshot) {
        const projectToSave = projectPath
        const cardId = currentDocument.card.id
        const token = (deferredAutosaveTokens.current.get(cardId) ?? 0) + 1
        deferredAutosaveTokens.current.set(cardId, token)
        // 选择可继续切到其他 Card；因此不能只依赖当前 selector 在 barrier
        // 释放时重渲染。这里保存该 Card 的最新目录投影，并用 token 合并多次编辑。
        const taskKey = cardPersistenceKey(projectToSave, cardId)
        const deferredTask = (async () => {
          const transactionPersisted = await waitForCardPersistenceBarrier(projectToSave, cardId)
          if (!transactionPersisted) {
            if (deferredAutosaveTokens.current.get(cardId) === token) {
              deferredAutosaveTokens.current.delete(cardId)
              failedTransactionKeys.current.add(cardPersistenceKey(projectToSave, cardId))
              if (getCardCatalogView().selectedCardId === cardId) setAutosaveState('error')
            }
            return
          }
          while (deferredAutosaveTokens.current.get(cardId) === token &&
            activeProjectRef.current === projectToSave &&
            getCardCatalogView().sourceProjectRoot === projectToSave) {
            const latest = getCardCatalogView().documents.find(candidate => candidate.card.id === cardId)
            if (!latest) {
              deferredAutosaveTokens.current.delete(cardId)
              return
            }
            const latestSnapshot = serializeCardDocument(latest)
            if (proposalManagedSnapshots.current.get(cardId) === latestSnapshot) {
              proposalManagedSnapshots.current.delete(cardId)
              deferredAutosaveTokens.current.delete(cardId)
              persistedCardKeys.current.add(cardPersistenceKey(projectToSave, cardId))
              persistedSnapshots.current.set(cardId, latestSnapshot)
              return
            }
            const result = await persistCardDocument(projectToSave, latest)
            if (deferredAutosaveTokens.current.get(cardId) !== token ||
              activeProjectRef.current !== projectToSave ||
              getCardCatalogView().sourceProjectRoot !== projectToSave) return
            if (!result.ok) {
              deferredAutosaveTokens.current.delete(cardId)
              if (getCardCatalogView().selectedCardId === cardId) setAutosaveState('error')
              return
            }
            const afterSave = getCardCatalogView().documents.find(candidate => candidate.card.id === cardId)
            if (!afterSave || serializeCardDocument(afterSave) === latestSnapshot) {
              deferredAutosaveTokens.current.delete(cardId)
              if (getCardCatalogView().selectedCardId === cardId) setAutosaveState('saved')
              return
            }
            // 写入期间又有编辑：保持 token，并按正常 autosave 窗口合并后继输入，
            // 然后继续追赶同一 Card，即使此时用户已经切换选择。
            if (getCardCatalogView().selectedCardId === cardId) setAutosaveState('pending')
            await new Promise(resolve => setTimeout(resolve, 500))
            const nextTransactionPersisted = await waitForCardPersistenceBarrier(projectToSave, cardId)
            if (!nextTransactionPersisted) {
              deferredAutosaveTokens.current.delete(cardId)
              failedTransactionKeys.current.add(cardPersistenceKey(projectToSave, cardId))
              if (getCardCatalogView().selectedCardId === cardId) setAutosaveState('error')
              return
            }
          }
        })().catch(() => {
          if (deferredAutosaveTokens.current.get(cardId) !== token) return
          deferredAutosaveTokens.current.delete(cardId)
          if (getCardCatalogView().selectedCardId === cardId) setAutosaveState('error')
        })
        deferredAutosaveTasks.current.set(taskKey, deferredTask)
        void deferredTask.finally(() => {
          if (deferredAutosaveTasks.current.get(taskKey) === deferredTask) {
            deferredAutosaveTasks.current.delete(taskKey)
          }
        })
      }
      setAutosaveState('pending')
      return
    }

    if (deferredAutosaveTokens.current.has(currentDocument.card.id)) {
      setAutosaveState('pending')
      return
    }

    if (failedTransactionKeys.current.has(cardPersistenceKey(projectPath, currentDocument.card.id)) ||
      hasCardPersistenceFailure(projectPath, currentDocument.card.id)) {
      setAutosaveState('error')
      return
    }

    if (proposalManagedSnapshots.current.get(currentDocument.card.id) === snapshot) {
      proposalManagedSnapshots.current.delete(currentDocument.card.id)
      persistedCardKeys.current.add(cardPersistenceKey(projectPath, currentDocument.card.id))
      persistedSnapshots.current.set(currentDocument.card.id, snapshot)
      setAutosaveState('saved')
      return
    }
    proposalManagedSnapshots.current.delete(currentDocument.card.id)
    if (persistedSnapshots.current.get(currentDocument.card.id) === snapshot) return

    setAutosaveState('pending')
    const documentToSave = currentDocument
    const projectToSave = projectPath
    const flush = async () => {
      setAutosaveState('saving')
      const result = await persistCardDocument(projectToSave, documentToSave)
      if (activeProjectRef.current !== projectToSave || loadedProjectRef.current !== projectToSave) return result.ok
      if (result.ok) {
        setAutosaveState('saved')
        return true
      } else {
        setAutosaveState('error')
        return false
      }
    }
    autosaveTimer.current = setTimeout(() => {
      autosaveTimer.current = null
      autosaveCardId.current = null
      pendingUnmountFlush.current = null
      void flush()
    }, 500)
    autosaveCardId.current = documentToSave.card.id
    pendingUnmountFlush.current = flush

    return () => {
      if (autosaveTimer.current) {
        clearTimeout(autosaveTimer.current)
        autosaveTimer.current = null
        autosaveCardId.current = null
        const switchedCard = getCardCatalogView().selectedCardId !== documentToSave.card.id
        const switchedProject = activeProjectRef.current !== projectToSave
        if (switchedCard || switchedProject) {
          pendingUnmountFlush.current = null
          // 不等待 Promise，先启动写入；项目切换守卫会等待全局文件队列。
          void flush()
        }
      }
    }
  }, [projectPath, currentDocument, cardPersistenceBlocked])

  useEffect(() => () => {
    const flush = pendingUnmountFlush.current
    pendingUnmountFlush.current = null
    if (flush) void flush()
  }, [])

  useEffect(() => {
    if (!projectPath) return
    return registerProjectCardFlusher(projectPath, async () => {
      while (true) {
        if (autosaveTimer.current) {
          clearTimeout(autosaveTimer.current)
          autosaveTimer.current = null
          autosaveCardId.current = null
        }
        const flush = pendingUnmountFlush.current
        pendingUnmountFlush.current = null
        if (flush) await flush()
        await drainEditorPersistence(projectPath)

        // 上一次写入等待期间用户仍可能继续编辑，React effect 会重新放入
        // timer/flush。循环到引用稳定，项目切换才能获得真正的保存边界。
        if (autosaveTimer.current || pendingUnmountFlush.current) continue
        const prefix = `${projectPath}\0`
        const error = [...editorPersistenceErrors.current]
          .find(([key]) => key.startsWith(prefix))?.[1]
        return error ? { ok: false, error } : { ok: true }
      }
    })
  }, [projectPath])

  // 当项目路径变化时，加载现有卡牌
  useEffect(() => {
    if (projectPath) {
      void loadExistingCards(projectPath)
    } else if (loadedProjectRef.current !== null || getCardCatalogView().sourceProjectRoot !== null) {
      loadedProjectRef.current = null
      cardCatalogActions.clear()
    }
  }, [projectPath])

  // 加载项目中现有的卡牌
  const loadExistingCards = async (projectToLoad: string | null = projectPath) => {
    // 旧项目中的恢复/迁移等异步回调可能在切换后才抵达。任何 UI 或
    // Catalog 变更之前先核对 root，避免它使新项目的加载失效或清空投影。
    if (!projectToLoad || activeProjectRef.current !== projectToLoad) return
    const loadGeneration = ++loadGenerationRef.current
    loadedProjectRef.current = null
    proposalManagedSnapshots.current.clear()
    deferredAutosaveTokens.current.clear()
    persistedSnapshots.current.clear()

    setLoadingCards(true)
    setRecoveryEntries([])
    setTrashEntries([])
    setBatchReport(null)
    // 项目切换先清空旧项目投影，避免加载失败时串出上一项目的 Card。
    cardCatalogActions.clear()
    try {
      // 快速 A→B→A 时，先等 A 上一轮 cleanup 写入真正完成，再以磁盘
      // 为权威重建 ownership；否则会把已存在文件误当成首次 create。
      await drainEditorPersistence(projectToLoad)
      if (loadGeneration !== loadGenerationRef.current || activeProjectRef.current !== projectToLoad) return
      const projectKeyPrefix = `${projectToLoad}\0`
      for (const key of persistedCardKeys.current) {
        if (key.startsWith(projectKeyPrefix)) persistedCardKeys.current.delete(key)
      }
      for (const key of failedTransactionKeys.current) {
        if (key.startsWith(projectKeyPrefix)) failedTransactionKeys.current.delete(key)
      }
      for (const key of editorPersistenceErrors.current.keys()) {
        if (key.startsWith(projectKeyPrefix)) editorPersistenceErrors.current.delete(key)
      }
      const entries = await FileService.loadCardDocuments(projectToLoad)
      if (loadGeneration !== loadGenerationRef.current || activeProjectRef.current !== projectToLoad) return
      const editableDocuments = entries
        .filter(entry => entry.result.status === 'editable')
        .map(entry => entry.result.status === 'editable' ? entry.result.document : null)
        .filter((document): document is NonNullable<typeof document> => document !== null)
      const invalidEntries = entries.filter(entry => entry.result.status !== 'editable')
      setRecoveryEntries(invalidEntries)
      const loaded = cardCatalogActions.loadDocuments(editableDocuments, projectToLoad)
      if (!loaded.ok) throw new Error(`Card 目录状态无效：${loaded.error}`)
      clearCardPersistenceFailures(projectToLoad)
      persistedSnapshots.current = new Map(editableDocuments.map(document => [
        document.card.id,
        serializeCardDocument(document),
      ]))
      for (const document of editableDocuments) {
        persistedCardKeys.current.add(cardPersistenceKey(projectToLoad, document.card.id))
      }
      loadedProjectRef.current = projectToLoad
      const nextTrashEntries = await FileService.listCardTrash(projectToLoad)
      if (loadGeneration !== loadGenerationRef.current || activeProjectRef.current !== projectToLoad) return
      setTrashEntries(nextTrashEntries)
      if (invalidEntries.length > 0) {
        showLoadMessage('error', `${invalidEntries.length} 张 Card 无法编辑，已隔离并保留原文件`)
      }
    } catch (err) {
      if (loadGeneration !== loadGenerationRef.current || activeProjectRef.current !== projectToLoad) return
      console.error('Failed to load existing cards:', err)
      showLoadMessage('error', `加载卡牌失败: ${err instanceof Error ? err.message : String(err)}`)
    } finally {
      if (loadGeneration === loadGenerationRef.current && activeProjectRef.current === projectToLoad) {
        setLoadingCards(false)
      }
    }
  }

  const handleRestoreCard = async (trashId: string) => {
    if (!projectPath) return
    const operationProject = projectPath
    const result = await FileService.restoreCardFromTrash(operationProject, trashId)
    if (!isActiveCatalogProject(operationProject)) return
    if (result.status !== 'restored') {
      showLoadMessage('error', `恢复失败：${result.reason}`)
      return
    }
    showLoadMessage(result.warning ? 'error' : 'success',
      result.warning ? `已恢复 Card ${result.cardId}；${result.warning}` : `已恢复 Card ${result.cardId}`)
    await loadExistingCards(operationProject)
  }

  const handleMigrateRecovery = async (fileName: string) => {
    if (!projectPath) return
    const operationProject = projectPath
    const result = await FileService.migrateCardDocument(operationProject, fileName)
    if (!isActiveCatalogProject(operationProject)) return
    if (result.status !== 'migrated') {
      showLoadMessage('error', `迁移失败：${result.reason}`)
      return
    }
    showLoadMessage('success', `已迁移 ${fileName}，原文备份为 ${result.backupPath}`)
    await loadExistingCards(operationProject)
  }

  const handleBatchGenerate = async () => {
    if (!projectPath || cardPersistenceBlocked || !isActiveCatalogProject(projectPath)) return
    if (cards.some(card => isCardPersistenceBlocked(projectPath, card.id))) {
      showSaveMessage('error', '仍有 Card 事务正在持久化，批量生成已暂停')
      return
    }
    const operationProject = projectPath
    setSaving(true)
    setBatchReport(null)
    try {
      const report = await FileService.generateCardBatch(operationProject)
      if (!isActiveCatalogProject(operationProject)) return
      setBatchReport(report)
      for (const item of report.items) {
        if (item.status === 'generated' && item.document.generation.lastGeneratedFingerprint) {
          const current = getCardCatalogView().documents.find(document => document.card.id === item.document.card.id)
          if (current) cardCatalogActions.recordGeneration({
            cardId: current.card.id,
            baseRevision: cardDocumentRevision(item.document),
            fingerprint: item.document.generation.lastGeneratedFingerprint,
          })
        }
      }
    } catch (error) {
      if (isActiveCatalogProject(operationProject)) {
        showSaveMessage('error', `批量生成失败：${error instanceof Error ? error.message : String(error)}`)
      }
    } finally {
      if (isActiveCatalogProject(operationProject)) setSaving(false)
    }
  }

  const exportRecoveryEntry = (entry: CardDocumentLoadEntry) => {
    const rawValue = entry.result.status === 'editable' ? null : entry.result.raw
    const raw = typeof rawValue === 'string' ? rawValue : JSON.stringify(rawValue, null, 2)
    const blob = new Blob([raw ?? ''], { type: 'application/json;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download = `${entry.fileName}.recovery.json`
    anchor.click()
    URL.revokeObjectURL(url)
  }

  // 过滤卡牌 - 单一useMemo，同时保留原始索引，避免每次渲染O(n²)的findIndex
  const filteredCards = useMemo(() => {
    let result = cards.map((card, originalIndex) => ({ card, originalIndex }))

    if (typeFilter !== 'all') {
      result = result.filter(({ card }) => card.type === typeFilter)
    }

    if (searchTerm.trim()) {
      const term = searchTerm.toLowerCase()
      result = result.filter(({ card }) =>
        card.name.toLowerCase().includes(term) ||
        card.description.toLowerCase().includes(term) ||
        card.keywords.some(k => k.toLowerCase().includes(term))
      )
    }

    return result
  }, [cards, searchTerm, typeFilter])

  // 处理卡牌属性变化
  const handleCardChange = (field: keyof CardData, value: string | number | string[]) => {
    if (selectedCardId === null) return
    const mergeKey = field === 'name' || field === 'description' ? `card.${field}` : undefined
    cardCatalogActions.patchCurrentCard({ [field]: value }, mergeKey ? { mergeKey } : undefined)
    setErrors([]) // 清除错误
  }

  // 处理关键词变化
  const handleKeywordsChange = (value: string) => {
    if (selectedCardId === null) return
    const keywords = value.split(',').map(k => k.trim()).filter(k => k)
    cardCatalogActions.patchCurrentCard({ keywords }, { mergeKey: 'card.keywords' })
  }

  const applyGraph = (next: NodeGraph, transactionKey?: string) => {
    if (!selectedCardId) return
    cardCatalogActions.replaceCurrentGraph(next, transactionKey ? { transactionKey } : undefined)
  }

  const handleDeleteCard = async (cardId: string) => {
    if (!projectPath) {
      cardCatalogActions.removeCard(cardId)
      return
    }
    const operationProject = projectPath
    if (isCardPersistenceBlocked(operationProject, cardId)) {
      showLoadMessage('error', 'Card 历史事务正在持久化，请稍后再删除')
      return
    }
    if (!isActiveCatalogProject(operationProject)) return
    const document = getCardCatalogView().documents.find(item => item.card.id === cardId)
    if (!document) return
    // 删除前先 flush 权威 CardDocument，再把文档和活动 C# 一起移入回收站。
    const saved = await persistCardDocument(operationProject, document)
    if (!isActiveCatalogProject(operationProject)) return
    if (!saved.ok) {
      showLoadMessage('error', `删除失败：${saved.error}`)
      return
    }
    const removed = await FileService.deleteCardToTrash(operationProject, cardId)
    if (!isActiveCatalogProject(operationProject)) return
    if (removed.status !== 'deleted') {
      showLoadMessage('error', `删除失败：${removed.reason}`)
      return
    }
    cardCatalogActions.removeCard(cardId)
    persistedCardKeys.current.delete(cardPersistenceKey(operationProject, cardId))
    persistedSnapshots.current.delete(cardId)
  }

  const openCreateCard = () => {
    setNewCardId('NewCard')
    setErrors([])
    setShowCreateIdDialog(true)
  }

  const confirmCreateCard = async () => {
    if (!isValidCardId(newCardId)) {
      setErrors(['Card ID 必须是以英文字母开头的 PascalCase ASCII 标识符'])
      return
    }
    if (getCardCatalogView().cards.some(card => card.id.toLowerCase() === newCardId.toLowerCase())) {
      setErrors([`Card ID ${newCardId} 已存在，请确认一个新的 ID`])
      return
    }
    const card = { ...createDefaultCard(), id: newCardId }
    const document: CardDocument = {
      schemaVersion: CURRENT_CARD_SCHEMA_VERSION,
      card,
      graph: createEmptyGraph(card.id, 'card'),
      generation: { lastGeneratedFingerprint: null },
    }
    if (!projectPath) {
      const created = cardCatalogActions.createCardDocument(document)
      if (!created.ok) setErrors([`Card ID ${newCardId} 已存在，请确认一个新的 ID`])
      else setShowCreateIdDialog(false)
      return
    }
    if (!isActiveCatalogProject(projectPath)) return
    const reservation = reserveCardId(projectPath, card.id)
    if (!reservation) {
      setErrors([`Card ID ${newCardId} 正在被其他创建操作占用`])
      return
    }
    setSaving(true)
    try {
      const saved = await FileService.createCardDocument(projectPath, document)
      if (!isActiveCatalogProject(projectPath)) return
      if (!saved.ok) {
        setErrors([saved.error])
        return
      }
      const created = cardCatalogActions.createCardDocument(document)
      if (!created.ok) {
        setErrors([`Card ID ${newCardId} 的磁盘与目录状态不一致，请重新加载项目`])
        await loadExistingCards(projectPath)
        return
      }
      persistedCardKeys.current.add(cardPersistenceKey(projectPath, card.id))
      persistedSnapshots.current.set(card.id, serializeCardDocument(document))
      setShowCreateIdDialog(false)
    } finally {
      reservation.release()
      if (isActiveCatalogProject(projectPath)) setSaving(false)
    }
  }

  const addTrigger = (event: string) => {
    if (!graph) return
    applyGraph(appendNode(graph, 'trigger', { x: 50 + graph.nodes.length * 24, y: 50 }, { event }).graph)
  }

  const addEffect = (kind: string) => {
    if (!graph) return
    const definition = EFFECT_KINDS[kind]
    applyGraph(appendNode(graph, 'effect', { x: 280 + graph.nodes.length * 24, y: 50 }, definition?.defaultData ?? { kind }).graph)
  }

  const handleConnect = (from: { nodeId: string; port: string }, to: { nodeId: string; port: string }) => {
    if (!graph) return
    const result = connect(graph, from, to)
    if (!result.ok) {
      setGraphError(`连线失败：${result.reason}`)
      return
    }
    setGraphError(null)
    applyGraph(result.graph)
  }

  // 预览生成的代码
  const handlePreview = () => {
    if (!currentCard) return

    const validationErrors = validateCard(currentCard)
    if (validationErrors.length > 0) {
      setErrors(validationErrors)
      return
    }

    try {
      if (!currentDocument) throw new Error('CardDocument 尚未加载')
      const code = generateCardDocumentCode(currentDocument, 'MyMod.Cards')
      setGeneratedCode(code)
      setErrors([])
    } catch (error) {
      setErrors([error instanceof Error ? error.message : String(error)])
    }
  }

  const handleGenerateArtifact = async () => {
    if (!projectPath || cardPersistenceBlocked || !currentCard || !currentDocument || !isActiveCatalogProject(projectPath)) return
    const operationProject = projectPath
    const documentToGenerate = currentDocument
    const validationErrors = validateCard(currentCard)
    if (validationErrors.length > 0) {
      setErrors(validationErrors)
      return
    }
    setSaving(true)
    setErrors([])
    try {
      // 先保存源数据，再显式生成 C#；自动保存不会触发此路径。
      const saved = await persistCardDocument(operationProject, documentToGenerate)
      if (!isActiveCatalogProject(operationProject)) return
      if (!saved.ok) {
        setErrors([saved.error])
        return
      }
      let result = await FileService.generateCardArtifact(operationProject, documentToGenerate)
      if (!isActiveCatalogProject(operationProject)) return
      if (result.status === 'blocked') {
        const confirmed = typeof window !== 'undefined' && window.confirm('检测到外部 C# 修改。是否先备份外部版本并重新生成？')
        if (confirmed) {
          const backup = await FileService.backupCardArtifact(operationProject, documentToGenerate.card.id)
          if (!isActiveCatalogProject(operationProject)) return
          if (!backup.ok) {
            setErrors([backup.error])
            return
          }
          result = await FileService.generateCardArtifact(operationProject, documentToGenerate, { allowExternalOverwrite: true })
          if (!isActiveCatalogProject(operationProject)) return
        }
      }
      if (result.status === 'generated') {
        const fingerprint = result.document.generation.lastGeneratedFingerprint
        if (fingerprint) cardCatalogActions.recordGeneration({
          cardId: result.document.card.id,
          baseRevision: cardDocumentRevision(documentToGenerate),
          fingerprint,
        })
        setGeneratedCode(generateCardDocumentCode(result.document, 'MyMod.Cards'))
        showSaveMessage('success', `已生成 C#：${result.path}`)
      } else if (result.status === 'blocked') {
        setErrors([`检测到${result.reason === 'external-modification' ? '外部修改' : '未跟踪'}的 C#，请先备份/导出后再确认重生成`])
      } else {
        setErrors([result.reason])
      }
    } catch (error) {
      if (isActiveCatalogProject(operationProject)) {
        setErrors([error instanceof Error ? error.message : String(error)])
      }
    } finally {
      if (isActiveCatalogProject(operationProject)) setSaving(false)
    }
  }

  // 保存卡牌到项目
  const handleSave = async () => {
    if (!projectPath || cardPersistenceBlocked || !currentCard || !currentDocument || !isActiveCatalogProject(projectPath)) return
    const operationProject = projectPath
    const documentToSave = currentDocument

    const validationErrors = validateCard(currentCard)
    if (validationErrors.length > 0) {
      setErrors(validationErrors)
      return
    }

    setSaving(true)
    setErrors([])

    try {
      const result = await persistCardDocument(operationProject, documentToSave)

      if (!isActiveCatalogProject(operationProject)) return

      if (result.ok) {
        setAutosaveState('saved')
        showSaveMessage('success', `已保存到 ${result.path}`)
      } else {
        setErrors([result.error || '保存失败，请检查目录权限'])
      }
    } catch (err) {
      if (isActiveCatalogProject(operationProject)) setErrors([`保存失败: ${err}`])
    }

    if (isActiveCatalogProject(operationProject)) setSaving(false)
  }

  // 生成描述预览
  const getDescriptionPreview = () => {
    if (!currentCard) return ''
    return currentCard.description || '卡牌描述'
  }

  // 获取费用显示
  const getCostDisplay = () => {
    if (!currentCard) return '?'
    return currentCard.cost.toString()
  }

  return (
    <div className="card-editor">
      <div className="editor-header">
        <h2>🃏 卡牌编辑器</h2>
        <div className="header-actions">
          {loadingCards && <span className="loading-text">加载中...</span>}
          <CardIOButtons
            projectPath={projectPath}
            onDocumentPersisted={document => {
              if (projectPath) persistedCardKeys.current.add(cardPersistenceKey(projectPath, document.card.id))
              persistedSnapshots.current.set(document.card.id, serializeCardDocument(document))
            }}
          />
          {autosaveState === 'pending' && <span className="loading-text">草稿待保存</span>}
          {autosaveState === 'saving' && <span className="loading-text">自动保存中...</span>}
          {autosaveState === 'saved' && <span className="loading-text">草稿已保存</span>}
          {autosaveState === 'error' && <span className="error-text">自动保存失败</span>}
          <button onClick={cardCatalogActions.undo} disabled={!canUndo} title="撤销 Card 编辑">↶ 撤销</button>
          <button onClick={cardCatalogActions.redo} disabled={!canRedo} title="重做 Card 编辑">↷ 重做</button>
          <button onClick={() => void handleBatchGenerate()} disabled={saving || cardPersistenceBlocked || !projectPath || cards.length === 0} title="逐张生成当前项目中的 Card">
            ⚡ 批量生成
          </button>
          <button onClick={openCreateCard}>+ 新建卡牌</button>
        </div>
      </div>

      <div className="editor-content">
        {/* 左侧：卡牌列表 */}
        <div className="card-list">
          {cards.length === 0 ? (
            <div className="empty-list">
              <p>暂无卡牌</p>
              <button onClick={openCreateCard}>创建第一张卡牌</button>
            </div>
          ) : (
            <>
              <CardSearch
                searchTerm={searchTerm}
                typeFilter={typeFilter}
                filteredCount={filteredCards.length}
                totalCount={cards.length}
                onSearchTermChange={setSearchTerm}
                onTypeFilterChange={setTypeFilter}
              />
              {filteredCards.map(({ card }) => (
              <div
                key={card.id}
                className={`card-item ${selectedCardId === card.id ? 'selected' : ''}`}
                onClick={() => cardCatalogActions.selectCard(card.id)}
              >
                <div className="card-mini-preview">
                  <span className="mini-cost">{card.cost}</span>
                  <span
                    className="mini-type"
                    style={{ color: getTypeColor(card.type) }}
                  >
                    {card.type.charAt(0)}
                  </span>
                </div>
                <span className="card-name">{card.name || '未命名'}</span>
                <button
                  className="delete-btn"
                  onClick={(e) => { e.stopPropagation(); void handleDeleteCard(card.id); }}
                  disabled={Boolean(projectPath && isCardPersistenceBlocked(projectPath, card.id))}
                >
                  ×
                </button>
              </div>
                )
              )}
            </>
          )}
          {recoveryEntries.length > 0 && (
            <div className="card-recovery-panel" data-testid="card-recovery-panel">
              <h4>只读恢复</h4>
              <p>{recoveryEntries.length} 个文件未进入编辑器，原文已保留。</p>
              {recoveryEntries.map(entry => (
                <details key={entry.fileName} className="recovery-entry">
                  <summary>{entry.fileName} · {entry.result.status}</summary>
                  <pre>{entry.result.status === 'editable' ? '' : typeof entry.result.raw === 'string' ? entry.result.raw : JSON.stringify(entry.result.raw, null, 2)}</pre>
                  {entry.result.status === 'migration-required' && (
                    <button type="button" onClick={() => void handleMigrateRecovery(entry.fileName)}>备份并迁移到当前 schema</button>
                  )}
                  <button type="button" onClick={() => exportRecoveryEntry(entry)}>导出原始 JSON</button>
                </details>
              ))}
            </div>
          )}
          {trashEntries.length > 0 && (
            <div className="card-trash-panel" data-testid="card-trash-panel">
              <h4>回收站</h4>
              {trashEntries.map(entry => (
                <div className="trash-entry" key={entry.trashId}>
                  <span>{entry.result.status === 'editable' ? entry.result.document.card.id : entry.trashId}</span>
                  <button type="button" onClick={() => void handleRestoreCard(entry.trashId)}>恢复</button>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* 右侧：卡牌属性编辑 */}
        <div className="card-properties">
          {currentCard ? (
            <>
              {/* 卡片预览 */}
              <div className="card-preview" style={{ '--type-color': getTypeColor(currentCard.type) } as React.CSSProperties}>
                <div className="preview-header">
                  <span className="preview-name">{currentCard.name || '卡牌名称'}</span>
                  <span className="preview-cost">{getCostDisplay()}</span>
                </div>
                <div className="preview-type" style={{ color: getTypeColor(currentCard.type) }}>
                  {currentCard.type}
                </div>
                <div className="preview-rarity">
                  {currentCard.rarity}
                </div>
                <div className="preview-description">
                  {getDescriptionPreview()}
                </div>
                {currentCard.keywords.length > 0 && (
                  <div className="preview-keywords">
                    {currentCard.keywords.map((k, i) => (
                      <span key={i} className="keyword-tag">{k}</span>
                    ))}
                  </div>
                )}
              </div>

              <div className="form-section">
                <h3>基本信息</h3>

                <div className="form-row">
                  <label>卡牌名称</label>
                  <input
                    type="text"
                    value={currentCard.name}
                    onChange={(e) => handleCardChange('name', e.target.value)}
                    onBlur={() => cardCatalogActions.finishEdit('card.name')}
                    placeholder="例如：火球术"
                  />
                </div>

                <div className="form-row-inline">
                  <div className="form-row half">
                    <label>费用</label>
                    <input
                      type="number"
                      min="0"
                      max="99"
                      value={currentCard.cost}
                      onChange={(e) => handleCardChange('cost', parseInt(e.target.value) || 0)}
                    />
                  </div>

                  <div className="form-row half">
                    <label>稀有度</label>
                    <select
                      value={currentCard.rarity}
                      onChange={(e) => handleCardChange('rarity', e.target.value)}
                    >
                      <option value="Common">普通</option>
                      <option value="Uncommon">优秀</option>
                      <option value="Rare">稀有</option>
                    </select>
                  </div>
                </div>

                <div className="form-row">
                  <label>类型</label>
                  <select
                    value={currentCard.type}
                    onChange={(e) => handleCardChange('type', e.target.value)}
                  >
                    <option value="Attack">⚔️ 攻击 (Attack)</option>
                    <option value="Skill">🛡️ 技能 (Skill)</option>
                    <option value="Power">✨ 力量 (Power)</option>
                  </select>
                </div>
              </div>

              <div className="form-section">
                <h3>效果</h3>

                <div className="form-row">
                  <label>描述</label>
                  <textarea
                    value={currentCard.description}
                    onChange={(e) => handleCardChange('description', e.target.value)}
                    onBlur={() => cardCatalogActions.finishEdit('card.description')}
                    placeholder="例如：造成6点伤害。"
                    rows={3}
                  />
                </div>

                <div className="form-row">
                  <label>关键词 (逗号分隔)</label>
                  <input
                    type="text"
                    value={currentCard.keywords.join(', ')}
                    onChange={(e) => handleKeywordsChange(e.target.value)}
                    onBlur={() => cardCatalogActions.finishEdit('card.keywords')}
                    placeholder="例如：Fire, Damage"
                  />
                </div>
              </div>

              {/* 错误提示 */}
              {errors.length > 0 && !showCreateIdDialog && (
                <div className="error-box">
                  {errors.map((err, i) => (
                    <div key={i} className="error-item">⚠️ {err}</div>
                  ))}
                </div>
              )}

              {graph && (
                <div className="card-node-editor" data-testid="card-node-editor">
                  <div className="node-toolbar">
                    <span>行为图</span>
                    {triggersForEntity('card').map(event => (
                      <button key={event} type="button" onClick={() => addTrigger(event)}>
                        + {event}
                      </button>
                    ))}
                    {effectsForEntity('card').map(kind => (
                      <button key={kind} type="button" onClick={() => addEffect(kind)}>
                        + {kind}
                      </button>
                    ))}
                  </div>
                  <NodeGraphCanvas
                    graph={graph}
                    onMoveNode={(nodeId, position) => applyGraph(moveNode(graph, nodeId, position), `node-drag:${nodeId}`)}
                    onMoveEnd={(nodeId) => cardCatalogActions.finishEdit(`node-drag:${nodeId}`)}
                    onMoveCancel={(nodeId) => cardCatalogActions.cancelEdit(`node-drag:${nodeId}`)}
                    onRemoveNode={(nodeId) => applyGraph(removeNode(graph, nodeId))}
                    onDisconnect={(edgeId) => applyGraph(disconnect(graph, edgeId))}
                    onConnect={handleConnect}
                    width={720}
                    height={360}
                  />
                  {graphError && <div className="error-box" data-testid="card-graph-error">⚠️ {graphError}</div>}
                </div>
              )}

              {/* 操作按钮 */}
              <div className="form-actions">
                <button onClick={handlePreview} className="preview-btn">
                  👁️ 预览代码
                </button>
                <button
                  onClick={() => void handleGenerateArtifact()}
                  className="preview-btn"
                  disabled={saving || cardPersistenceBlocked || !projectPath}
                >
                  ⚡ 生成 C#
                </button>
                <button
                  onClick={handleSave}
                  className="save-btn"
                  disabled={saving || cardPersistenceBlocked || !projectPath}
                >
                  {saving ? '保存中...' : '💾 保存到项目'}
                </button>
              </div>

              {batchReport && (
                <div className="batch-report" data-testid="batch-report">
                  批量生成：成功 {batchReport.counts.generated}，跳过 {batchReport.counts.skipped}，失败 {batchReport.counts.failed}
                  {batchReport.items.some(item => item.status !== 'generated') && (
                    <ul>
                      {batchReport.items.filter(item => item.status !== 'generated').map(item => (
                        <li key={item.cardId}>{item.cardId}：{item.reason}</li>
                      ))}
                    </ul>
                  )}
                </div>
              )}

              {saveMessage && <Toast message={saveMessage} />}
            </>
          ) : (
            <div className="no-selection">
              <div className="empty-card-icon">🃏</div>
              <p>选择一张卡牌进行编辑</p>
              <p>或点击「新建卡牌」创建</p>
            </div>
          )}
        </div>

        {/* 加载错误 Toast：放在 card-properties 之外，不受 currentCard 影响 */}
        {loadMessage && <Toast message={loadMessage} />}

        {/* 下方：代码预览 */}
        {generatedCode && (
          <div className="code-preview">
            <div className="code-header">
              <span>📄 生成的C#代码</span>
              <button onClick={() => setGeneratedCode('')}>关闭</button>
            </div>
            <pre>
              <code>{generatedCode}</code>
            </pre>
          </div>
        )}
      </div>

      {showCreateIdDialog && (
        <div className="card-id-dialog" role="dialog" aria-label="确认 Card ID" data-testid="card-id-dialog">
          <div className="card-id-dialog-body">
            <h3>确认 Card ID</h3>
            <p>Card ID 创建后不可修改，并决定文档、类名和 C# 文件名。</p>
            {errors.length > 0 && (
              <div className="error-box" role="alert">
                {errors.map((error, index) => (
                  <div key={index} className="error-item">⚠️ {error}</div>
                ))}
              </div>
            )}
            <input
              value={newCardId}
              onChange={(event) => setNewCardId(event.target.value)}
              autoFocus
              data-testid="new-card-id-input"
              aria-label="Card ID"
            />
            <div className="card-id-dialog-actions">
              <button onClick={confirmCreateCard}>确认创建</button>
              <button onClick={() => setShowCreateIdDialog(false)}>取消</button>
            </div>
          </div>
        </div>
      )}

      <style>{`
        .card-editor {
          display: flex;
          flex-direction: column;
          height: 100%;
          background: var(--bg-secondary);
          border-radius: 8px;
          overflow: hidden;
        }

        .card-id-dialog {
          position: fixed;
          inset: 0;
          display: grid;
          place-items: center;
          background: rgba(0, 0, 0, 0.45);
          z-index: 20;
        }

        .card-id-dialog-body {
          width: min(420px, calc(100vw - 32px));
          padding: 20px;
          border-radius: 8px;
          background: var(--bg-secondary);
          box-shadow: 0 12px 40px rgba(0, 0, 0, 0.3);
        }

        .card-id-dialog-body h3,
        .card-id-dialog-body p {
          margin-top: 0;
        }

        .card-id-dialog-body input {
          width: 100%;
        }

        .card-id-dialog-actions {
          display: flex;
          gap: 8px;
          justify-content: flex-end;
          margin-top: 16px;
        }

        .editor-header {
          display: flex;
          justify-content: space-between;
          align-items: center;
          padding: 16px;
          background: var(--bg-tertiary);
          border-bottom: 1px solid var(--border);
        }

        .editor-header h2 {
          font-size: 16px;
          font-weight: 600;
        }

        .header-actions {
          display: flex;
          align-items: center;
          gap: 12px;
        }

        .loading-text {
          font-size: 12px;
          color: var(--text-secondary);
        }

        .editor-content {
          display: flex;
          flex: 1;
          overflow: hidden;
        }

        /* 卡牌列表 */
        .card-list {
          width: 200px;
          border-right: 1px solid var(--border);
          overflow-y: auto;
          padding: 8px;
        }

        .card-recovery-panel,
        .card-trash-panel {
          margin-top: 16px;
          padding: 10px;
          border: 1px solid var(--border);
          border-radius: 6px;
          font-size: 12px;
        }

        .card-recovery-panel h4,
        .card-trash-panel h4 {
          margin: 0 0 6px;
          font-size: 12px;
        }

        .card-recovery-panel p {
          color: var(--text-secondary);
          margin: 0 0 8px;
        }

        .recovery-entry {
          margin-top: 6px;
        }

        .recovery-entry pre {
          max-height: 120px;
          overflow: auto;
          white-space: pre-wrap;
          margin: 6px 0;
          padding: 6px;
          background: var(--bg-tertiary);
        }

        .trash-entry {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 6px;
          margin-top: 6px;
        }

        .batch-report {
          margin-top: 12px;
          padding: 8px 10px;
          border: 1px solid var(--border);
          border-radius: 6px;
          font-size: 12px;
        }

        .batch-report ul {
          margin: 6px 0 0;
          padding-left: 18px;
        }

        .empty-list {
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          height: 100%;
          color: var(--text-secondary);
          font-size: 14px;
        }

        .empty-list button {
          margin-top: 12px;
        }

        .card-item {
          display: flex;
          align-items: center;
          gap: 8px;
          padding: 8px 10px;
          border-radius: 4px;
          cursor: pointer;
          transition: background 0.15s;
          position: relative;
        }

        .card-item:hover {
          background: var(--bg-tertiary);
        }

        .card-item.selected {
          background: var(--accent);
          color: white;
        }

        .card-mini-preview {
          display: flex;
          flex-direction: column;
          align-items: center;
          width: 24px;
          font-size: 10px;
        }

        .mini-cost {
          font-weight: bold;
          font-size: 12px;
        }

        .mini-type {
          font-size: 10px;
        }

        .card-item .card-name {
          flex: 1;
          font-size: 13px;
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }

        .card-item .delete-btn {
          background: transparent;
          color: inherit;
          opacity: 0.5;
          padding: 2px 6px;
          font-size: 16px;
          min-width: auto;
        }

        .card-item .delete-btn:hover {
          opacity: 1;
          color: var(--accent);
        }

        /* 属性编辑 */
        .card-properties {
          flex: 1;
          padding: 16px;
          overflow-y: auto;
          display: flex;
          flex-direction: column;
          gap: 16px;
        }

        /* 卡牌预览 */
        .card-preview {
          background: linear-gradient(135deg, #2a2a4a 0%, #1a1a2e 100%);
          border: 2px solid var(--type-color, #888);
          border-radius: 8px;
          padding: 16px;
          position: relative;
        }

        .preview-header {
          display: flex;
          justify-content: space-between;
          align-items: flex-start;
          margin-bottom: 8px;
        }

        .preview-name {
          font-size: 16px;
          font-weight: bold;
          color: white;
        }

        .preview-cost {
          background: var(--type-color, #888);
          color: white;
          width: 28px;
          height: 28px;
          border-radius: 50%;
          display: flex;
          align-items: center;
          justify-content: center;
          font-weight: bold;
        }

        .preview-type {
          font-size: 12px;
          text-transform: uppercase;
          letter-spacing: 1px;
          margin-bottom: 4px;
        }

        .preview-rarity {
          font-size: 11px;
          color: #888;
          margin-bottom: 12px;
        }

        .preview-description {
          font-size: 13px;
          color: #ddd;
          line-height: 1.5;
          min-height: 40px;
        }

        .preview-keywords {
          display: flex;
          flex-wrap: wrap;
          gap: 4px;
          margin-top: 12px;
        }

        .keyword-tag {
          background: rgba(255,255,255,0.1);
          padding: 2px 8px;
          border-radius: 4px;
          font-size: 11px;
          color: #aaa;
        }

        /* 表单 */
        .form-section {
          background: var(--bg-primary);
          border-radius: 8px;
          padding: 16px;
        }

        .form-section h3 {
          font-size: 13px;
          font-weight: 600;
          margin-bottom: 12px;
          color: var(--text-secondary);
        }

        .form-row {
          margin-bottom: 12px;
        }

        .form-row:last-child {
          margin-bottom: 0;
        }

        .form-row-inline {
          display: flex;
          gap: 12px;
        }

        .form-row.half {
          flex: 1;
        }

        .form-row label {
          display: block;
          font-size: 12px;
          font-weight: 500;
          margin-bottom: 6px;
          color: var(--text-secondary);
        }

        .form-row input,
        .form-row select,
        .form-row textarea {
          width: 100%;
        }

        .form-row textarea {
          resize: vertical;
          min-height: 60px;
        }

        .no-selection {
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          height: 100%;
          color: var(--text-secondary);
          font-size: 14px;
        }

        .empty-card-icon {
          font-size: 48px;
          margin-bottom: 12px;
          opacity: 0.5;
        }

        /* 错误提示 */
        .error-box {
          background: rgba(233, 69, 96, 0.1);
          border: 1px solid var(--accent);
          border-radius: 4px;
          padding: 12px;
        }

        .error-item {
          color: var(--accent);
          font-size: 13px;
          margin-bottom: 4px;
        }

        .error-item:last-child {
          margin-bottom: 0;
        }

        /* 操作按钮 */
        .form-actions {
          display: flex;
          gap: 12px;
        }

        .preview-btn {
          flex: 1;
          background: var(--bg-tertiary);
          color: var(--text-primary);
        }

        .save-btn {
          flex: 2;
        }

        /* 代码预览 */
        .code-preview {
          border-top: 1px solid var(--border);
          max-height: 300px;
          display: flex;
          flex-direction: column;
        }

        .code-header {
          display: flex;
          justify-content: space-between;
          align-items: center;
          padding: 10px 16px;
          background: var(--bg-tertiary);
          font-size: 13px;
          font-weight: 500;
        }

        .code-header button {
          padding: 4px 8px;
          font-size: 12px;
          background: transparent;
        }

        .code-preview pre {
          flex: 1;
          margin: 0;
          padding: 12px 16px;
          overflow: auto;
          background: var(--bg-primary);
          font-family: 'Fira Code', 'Consolas', monospace;
          font-size: 12px;
          line-height: 1.5;
        }

        .code-preview code {
          color: var(--text-primary);
        }
      `}</style>
    </div>
  )
}
