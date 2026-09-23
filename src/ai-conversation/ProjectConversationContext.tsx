import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from 'react'
import type { ConversationAttachment, ConversationQuickReplySelection } from './conversationDocument'
import { createConversationRepository } from './conversationRepository'
import {
  ProjectConversation,
  type ConversationModel,
  type ProjectConversationResult,
  type ProjectConversationSnapshot,
} from './projectConversation'
import { createConversationFilePort } from '../services/FileService'
import { createAdapter, createConversationModel } from '../services/llm/adapters'
import { prepareConversationPrompt } from '../services/llm/conversationPreparation'
import { useAIStore } from '../stores/useAIStore'
import {
  getCardCatalogView,
  subscribeCardCatalogEvents,
  useCardCatalog,
} from '../card/cardCatalog'
import { acquireCardPersistenceBarrier } from '../card/cardPersistenceBarrier'
import { flushProjectCardChanges } from '../card/cardPersistenceCoordinator'
import {
  pendingProposalCardTransition,
  type ConversationProposalRejectionFeedback,
} from './proposalLifecycle'
import {
  createProposalCardApplication,
  type ProposalCardApplication,
} from './proposalApplication'

export type ProjectConversationFactory = (projectRoot: string) => ProjectConversation

export interface ProjectConversationView extends Omit<ProjectConversationSnapshot, 'loadStatus'> {
  projectRoot: string | null
  loadStatus: Exclude<ProjectConversationSnapshot['loadStatus'], 'failed'> | 'no-project' | 'error'
  loadError: string | null
  isBusy: boolean
}

export interface ProjectConversationActions {
  send(
    userText: string,
    attachments?: readonly ConversationAttachment[],
    quickReplySelection?: ConversationQuickReplySelection | null,
  ): ReturnType<ProjectConversation['send']>
  cancel(): ReturnType<ProjectConversation['cancel']>
  retryTurn(turnId: string): ReturnType<ProjectConversation['retryTurn']>
  refreshProposal(proposalId: string): ReturnType<ProjectConversation['refreshProposal']>
  acceptProposal(proposalId: string, finalCardId: string): ReturnType<ProjectConversation['acceptProposal']>
  rejectProposal(
    proposalId: string,
    feedback?: ConversationProposalRejectionFeedback | null,
  ): ReturnType<ProjectConversation['rejectProposal']>
  isRunning(): boolean
  prepareForProjectSwitch(confirmSwitch?: () => boolean): Promise<boolean>
}

interface ProjectConversationContextValue {
  projectRoot: string | null
  conversation: ProjectConversation | null
  loadError: string | null
  operationError: string | null
  proposalApplication: ProposalCardApplication | null
  operationGate: ProjectOperationGate
}

const ProjectConversationContext = createContext<ProjectConversationContextValue | null>(null)

const EMPTY_SNAPSHOT: ProjectConversationSnapshot = {
  document: null,
  loadStatus: 'loading',
  quarantineReason: null,
  isRunning: false,
  lastError: null,
  persistenceError: null,
  requiresReload: false,
}

const NOOP_UNSUBSCRIBE = () => undefined
const NOOP_SUBSCRIBE = () => NOOP_UNSUBSCRIBE

export function ProjectConversationProvider({
  projectRoot,
  createConversation = createDefaultProjectConversation,
  createProposalApplication = createProposalCardApplication,
  children,
}: {
  projectRoot: string | null
  createConversation?: ProjectConversationFactory
  createProposalApplication?: (projectRoot: string) => ProposalCardApplication
  children: ReactNode
}) {
  const factoryRef = useRef(createConversation)
  factoryRef.current = createConversation
  const conversation = useMemo(
    () => projectRoot ? factoryRef.current(projectRoot) : null,
    [projectRoot],
  )
  const proposalApplication = useMemo(
    () => projectRoot ? createProposalApplication(projectRoot) : null,
    [createProposalApplication, projectRoot],
  )
  const [loadError, setLoadError] = useState<string | null>(null)
  const [operationError, setOperationError] = useState<string | null>(null)
  const operationGate = useMemo(
    () => new ProjectOperationGate(error => setOperationError(error)),
    [conversation],
  )
  const conversationSnapshot = useSyncExternalStore(
    conversation?.subscribe ?? NOOP_SUBSCRIBE,
    conversation?.getSnapshot ?? (() => EMPTY_SNAPSHOT),
    conversation?.getSnapshot ?? (() => EMPTY_SNAPSHOT),
  )
  const catalogProjectRoot = useCardCatalog(view => view.sourceProjectRoot)

  useEffect(() => {
    let active = true
    setLoadError(null)
    setOperationError(null)
    if (!conversation) return () => { active = false }
    void conversation.load().catch(error => {
      if (active) setLoadError(error instanceof Error ? error.message : String(error))
    })
    return () => { active = false }
  }, [conversation])

  useEffect(() => {
    if (!conversation || !projectRoot) return
    return subscribeCardCatalogEvents(event => {
      if (event.sourceProjectRoot !== projectRoot || event.source === 'apply') return
      // 同步获取 barrier，使 CardEditor 在本事件的 WAL→Card→committed 完成前
      // 不能把后继草稿抢先落盘。rapid undo/redo 会持有两个 lease，直到
      // 两个事件按 operationGate 顺序分别完成。
      const persistenceLease = acquireCardPersistenceBarrier(projectRoot, event.cardId)
      // 事件发出时立刻捕获对应快照；快速 undo/redo 会排队，但不能都保存成最后状态。
      const document = getCardCatalogView().documents.find(candidate => candidate.card.id === event.cardId)
      if (!document || !proposalApplication) {
        persistenceLease.release('failed')
        operationGate.block('Card 历史状态无法定位对应文档，已停止继续操作')
        return
      }
      let persisted = false
      void operationGate.run(async () => {
        if (operationGate.error) return
        const recorded = await conversation.recordProposalHistory(
          event.proposalId,
          event.transactionId,
          event.status,
          document,
        )
        if (!recorded.ok) {
          operationGate.block(recorded.error)
          return
        }
        const cardSaved = await proposalApplication.persistHistoryCard(event, document)
        if (!cardSaved.ok) {
          operationGate.block(cardSaved.error)
          return
        }
        const confirmed = await conversation.confirmProposalCardTransition(
          event.proposalId,
          event.transactionId,
        )
        if (!confirmed.ok) {
          operationGate.block(confirmed.error)
          return
        }
        persisted = true
      }).catch(error => operationGate.block(operationErrorMessage(error)))
        .finally(() => persistenceLease.release(persisted ? 'persisted' : 'failed'))
    })
  }, [conversation, operationGate, projectRoot, proposalApplication])

  // 每次 Provider 生命周期只做一次启动对账。只有末尾没有 committed 的 transition
  // 才需要恢复；已完成的 accepted 不会因用户后续编辑或删除而被反复回放。
  const reconciledConversation = useRef<ProjectConversation | null>(null)

  useEffect(() => {
    if (!conversation || !proposalApplication || conversationSnapshot.loadStatus !== 'loaded' ||
      catalogProjectRoot !== projectRoot || reconciledConversation.current === conversation) return
    reconciledConversation.current = conversation
    const pending = (conversationSnapshot.document?.proposals ?? [])
      .filter(proposal => pendingProposalCardTransition(proposal) !== null)
    if (pending.length === 0) return
    void operationGate.run(async () => {
      if (operationGate.error) return
      for (const proposal of pending) {
        const result = await proposalApplication.reconcile(proposal)
        if (!result.ok) {
          operationGate.block(result.error)
          return
        }
        const transition = pendingProposalCardTransition(proposal)
        if (!transition) continue
        const confirmed = await conversation.confirmProposalCardTransition(
          proposal.id,
          transition.transactionId,
        )
        if (!confirmed.ok) {
          operationGate.block(confirmed.error)
          return
        }
      }
    }).catch(error => operationGate.block(operationErrorMessage(error)))
  }, [catalogProjectRoot, conversation, conversationSnapshot.document?.proposals,
    conversationSnapshot.loadStatus, operationGate, projectRoot, proposalApplication])

  const value = useMemo(
    () => ({ projectRoot, conversation, loadError, operationError, proposalApplication, operationGate }),
    [projectRoot, conversation, loadError, operationError, proposalApplication, operationGate],
  )

  return (
    <ProjectConversationContext.Provider value={value}>
      {children}
    </ProjectConversationContext.Provider>
  )
}

/** 生产接线保持惰性：每次发送读取最新 provider/API Key，而不是把凭据写入项目状态。 */
export function createDefaultProjectConversation(projectRoot: string): ProjectConversation {
  let latestModel: ConversationModel | null = null
  let latestProvider: string | null = null
  let activeModel: ConversationModel | null = null
  const createLatestModel = (): ConversationModel | null => {
    const { provider, apiKey, isConfigured } = useAIStore.getState()
    if (!isConfigured) return null
    latestModel = createConversationModel(createAdapter(provider, apiKey))
    latestProvider = provider
    return latestModel
  }
  const model: ConversationModel = {
    prepare(request) {
      const configuredModel = createLatestModel()
      return configuredModel?.prepare?.(request) ?? prepareConversationPrompt(request)
    },
    diagnostics() {
      if (activeModel?.diagnostics) return activeModel.diagnostics()
      const { provider } = useAIStore.getState()
      if (latestModel?.diagnostics && latestProvider === provider) return latestModel.diagnostics()
      const configuredModel = createLatestModel()
      if (configuredModel?.diagnostics) return configuredModel.diagnostics()
      return { provider, model: 'unknown' }
    },
    async summarize(request) {
      const configuredModel = createLatestModel()
      if (!configuredModel?.summarize) return { success: false as const, error: '请先在「设置」中配置 API 密钥', kind: 'provider' as const }
      return configuredModel.summarize(request)
    },
    async respond(request) {
      const configuredModel = createLatestModel()
      if (!configuredModel) {
        return { success: false as const, error: '请先在「设置」中配置 API 密钥' }
      }
      activeModel = configuredModel
      try {
        return await configuredModel.respond(request)
      } finally {
        if (activeModel === configuredModel) activeModel = null
      }
    },
  }
  return new ProjectConversation(
    projectRoot,
    createConversationRepository(createConversationFilePort()),
    model,
    undefined,
    undefined,
    () => {
      const catalog = getCardCatalogView()
      if (catalog.sourceProjectRoot !== projectRoot) {
        throw new Error('Card 目录尚未加载到当前项目')
      }
      return catalog.documents
    },
  )
}

function useProjectConversationContext(): ProjectConversationContextValue {
  const value = useContext(ProjectConversationContext)
  if (!value) throw new Error('useProjectConversation 必须在 ProjectConversationProvider 内使用')
  return value
}

export function useProjectConversation<T>(selector: (view: ProjectConversationView) => T): T {
  const { projectRoot, conversation, loadError, operationError } = useProjectConversationContext()
  const snapshot = useSyncExternalStore(
    conversation?.subscribe ?? NOOP_SUBSCRIBE,
    conversation?.getSnapshot ?? (() => EMPTY_SNAPSHOT),
    conversation?.getSnapshot ?? (() => EMPTY_SNAPSHOT),
  )
  const effectiveLoadError = loadError ?? (snapshot.loadStatus === 'failed' ? snapshot.lastError : null)
  const loadStatus: ProjectConversationView['loadStatus'] = projectRoot === null
    ? 'no-project'
    : loadError || snapshot.loadStatus === 'failed'
      ? 'error'
      : snapshot.loadStatus
  const view: ProjectConversationView = {
    ...snapshot,
    persistenceError: operationError ?? snapshot.persistenceError,
    requiresReload: Boolean(operationError) || snapshot.requiresReload,
    projectRoot,
    loadStatus,
    loadError: effectiveLoadError,
    isBusy: conversation?.hasActiveWork() ?? false,
  }
  return selector(view)
}

export function useProjectConversationActions(): ProjectConversationActions {
  const {
    conversation,
    projectRoot,
    proposalApplication,
    operationGate,
  } = useProjectConversationContext()

  const blockedResult = () => ({
    ok: false as const,
    error: operationGate.error ?? (operationGate.isClosing
      ? '项目正在切换，不能再开始新的操作'
      : '项目操作已停止，请重新打开项目完成恢复'),
    code: 'persistence' as const,
  })

  const runProjectMutation = (
    operation: () => Promise<ProjectConversationResult>,
  ): Promise<ProjectConversationResult> => {
    if (operationGate.isClosing) return Promise.resolve(blockedResult())
    return operationGate.run(async () => {
      if (operationGate.error) return blockedResult()
      const result = await operation()
      if (!result.ok && result.code === 'persistence') operationGate.block(result.error)
      return result
    })
  }

  const runOutsideProjectMutations = (
    operation: () => Promise<ProjectConversationResult>,
  ): Promise<ProjectConversationResult> => {
    if (operationGate.error || operationGate.isClosing) return Promise.resolve(blockedResult())
    if (operationGate.hasPending) {
      return Promise.resolve({
        ok: false,
        error: 'Card 事务正在持久化，请完成后再发送',
        code: 'already-running',
      })
    }
    return operation()
  }

  return useMemo(() => ({
    send: (
      userText: string,
      attachments: readonly ConversationAttachment[] = [],
      quickReplySelection: ConversationQuickReplySelection | null = null,
    ) => {
      if (!conversation) return Promise.resolve({ ok: false as const, error: '请先打开项目', code: 'not-loaded' as const })
      return runOutsideProjectMutations(() => conversation.send(userText, attachments, quickReplySelection))
    },
    cancel: () => conversation
      ? conversation.cancel()
      : Promise.resolve({ ok: true as const }),
    retryTurn: (turnId: string) => {
      if (!conversation) return Promise.resolve({ ok: false as const, error: '请先打开项目', code: 'not-loaded' as const })
      return runOutsideProjectMutations(() => conversation.retryTurn(turnId))
    },
    refreshProposal: (proposalId: string) => {
      if (!conversation) return Promise.resolve({ ok: false as const, error: '请先打开项目', code: 'not-loaded' as const })
      return runProjectMutation(() => conversation.refreshProposal(proposalId))
    },
    acceptProposal: (proposalId: string, finalCardId: string) => {
      if (!conversation || !projectRoot || !proposalApplication) {
        return Promise.resolve({ ok: false as const, error: '请先打开项目', code: 'not-loaded' as const })
      }
      if (operationGate.isClosing) return Promise.resolve(blockedResult())
      const proposal = conversation.getSnapshot().document?.proposals
        .find(candidate => candidate.id === proposalId)
      const cardId = proposal?.operation === 'update' ? proposal.targetCardId : finalCardId.trim()
      const persistenceLease = cardId
        ? acquireCardPersistenceBarrier(projectRoot, cardId)
        : null
      const result = runProjectMutation(() => conversation.acceptProposal(
        proposalId,
        finalCardId,
        async input => {
          const result = await proposalApplication.commit(input)
          if (!result.ok && result.certainty === 'uncertain') operationGate.block(result.error)
          return result
        },
      ))
      return result.then(value => {
        // stale/ID 冲突等业务失败会把 accepted WAL 安全回滚为 pending，
        // Card 文件没有不确定性；只有真正的 persistence 失败才保持粘性阻断。
        persistenceLease?.release(value.ok || value.code !== 'persistence' ? 'persisted' : 'failed')
        return value
      }, error => {
        persistenceLease?.release('failed')
        throw error
      })
    },
    rejectProposal: (
      proposalId: string,
      feedback: ConversationProposalRejectionFeedback | null = null,
    ) => {
      if (!conversation) return Promise.resolve({ ok: false as const, error: '请先打开项目', code: 'not-loaded' as const })
      return runProjectMutation(() => conversation.rejectProposal(proposalId, feedback))
    },
    isRunning: () => (conversation?.hasActiveWork() ?? false) || operationGate.hasPending,
    prepareForProjectSwitch: async (confirmSwitch = () => window.confirm(
      operationGate.error
        ? '项目 AI 状态需要重新加载。仍要离开当前项目吗？未完成事务会在重新打开时恢复。'
        : 'AI 正在回复。要取消本轮并切换项目吗？',
    )) => {
      if (!operationGate.beginClose()) return false
      let maySwitch = false
      try {
        await operationGate.drain()
        if (projectRoot) {
          const cardsFlushed = await flushProjectCardChanges(projectRoot)
          if (!cardsFlushed.ok) {
            operationGate.block(cardsFlushed.error)
            return false
          }
          // flush 期间仍可能收到 Card undo/redo 事件；再次 drain，确保离开前
          // 它们也完成 WAL → Card → committed，不能留在旧项目后台运行。
          await operationGate.drain()
        }
        let confirmed = false
        if (operationGate.error) {
          confirmed = confirmSwitch()
          if (!confirmed) return false
        }
        // 运行请求的取消/终态保存失败时，磁盘是否记录终态尚不确定。
        // 这类错误不能靠第二次点击绕过；只有重启/重新加载同项目才能恢复。
        if (conversation?.getSnapshot().requiresReload && !operationGate.error) return false
        if (!conversation?.hasActiveWork()) {
          maySwitch = true
          return true
        }
        if (!confirmed && !confirmSwitch()) return false
        const result = await conversation.cancel()
        await operationGate.drain()
        const snapshot = conversation.getSnapshot()
        maySwitch = result.ok &&
          !snapshot.requiresReload &&
          !conversation.hasActiveWork() &&
          !operationGate.hasPending &&
          (!operationGate.error || confirmed)
        return maySwitch
      } finally {
        if (!maySwitch) operationGate.cancelClose()
      }
    },
  }), [conversation, projectRoot, proposalApplication, operationGate])
}

/**
 * 给事件回调使用的稳定离开守卫；它不会订阅消息变化，也不会导致应用壳重渲染。
 */
export function usePrepareForProjectSwitch(): ProjectConversationActions['prepareForProjectSwitch'] {
  const { prepareForProjectSwitch } = useProjectConversationActions()
  return useCallback((confirmSwitch?: () => boolean) => prepareForProjectSwitch(confirmSwitch), [prepareForProjectSwitch])
}

class ProjectOperationGate {
  private tail: Promise<void> = Promise.resolve()
  private pending = 0
  private blockingError: string | null = null
  private closing = false

  constructor(private readonly reportError: (error: string) => void) {}

  get error(): string | null { return this.blockingError }
  get hasPending(): boolean { return this.pending > 0 }
  get isClosing(): boolean { return this.closing }

  beginClose(): boolean {
    if (this.closing) return false
    this.closing = true
    return true
  }

  cancelClose(): void { this.closing = false }

  block(error: string): void {
    if (this.blockingError) return
    this.blockingError = error
    this.reportError(error)
  }

  run<T>(operation: () => Promise<T>): Promise<T> {
    this.pending += 1
    const result = this.tail.then(operation, operation)
    this.tail = result.then(
      () => { this.pending -= 1 },
      error => {
        this.pending -= 1
        this.block(error instanceof Error ? error.message : String(error))
      },
    )
    return result
  }

  async drain(): Promise<void> {
    while (true) {
      const observed = this.tail
      await observed
      if (observed === this.tail) return
    }
  }
}

function operationErrorMessage(error: unknown): string {
  return `项目 AI 操作失败：${error instanceof Error ? error.message : String(error)}`
}
