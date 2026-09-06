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
  type ProjectConversationSnapshot,
} from './projectConversation'
import { createConversationFilePort } from '../services/FileService'
import { createAdapter, createConversationModel } from '../services/llm/adapters'
import { useAIStore } from '../stores/useAIStore'

export type ProjectConversationFactory = (projectRoot: string) => ProjectConversation

export interface ProjectConversationView extends Omit<ProjectConversationSnapshot, 'loadStatus'> {
  projectRoot: string | null
  loadStatus: Exclude<ProjectConversationSnapshot['loadStatus'], 'failed'> | 'no-project' | 'error'
  loadError: string | null
}

export interface ProjectConversationActions {
  send(
    userText: string,
    attachments?: readonly ConversationAttachment[],
    quickReplySelection?: ConversationQuickReplySelection | null,
  ): ReturnType<ProjectConversation['send']>
  cancel(): ReturnType<ProjectConversation['cancel']>
  retryTurn(turnId: string): ReturnType<ProjectConversation['retryTurn']>
  isRunning(): boolean
  prepareForProjectSwitch(confirmSwitch?: () => boolean): Promise<boolean>
}

interface ProjectConversationContextValue {
  projectRoot: string | null
  conversation: ProjectConversation | null
  loadError: string | null
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
  children,
}: {
  projectRoot: string | null
  createConversation?: ProjectConversationFactory
  children: ReactNode
}) {
  const factoryRef = useRef(createConversation)
  factoryRef.current = createConversation
  const conversation = useMemo(
    () => projectRoot ? factoryRef.current(projectRoot) : null,
    [projectRoot],
  )
  const [loadError, setLoadError] = useState<string | null>(null)

  useEffect(() => {
    let active = true
    setLoadError(null)
    if (!conversation) return () => { active = false }
    void conversation.load().catch(error => {
      if (active) setLoadError(error instanceof Error ? error.message : String(error))
    })
    return () => { active = false }
  }, [conversation])

  const value = useMemo(
    () => ({ projectRoot, conversation, loadError }),
    [projectRoot, conversation, loadError],
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
    diagnostics() {
      if (activeModel?.diagnostics) return activeModel.diagnostics()
      const { provider } = useAIStore.getState()
      if (latestModel?.diagnostics && latestProvider === provider) return latestModel.diagnostics()
      const configuredModel = createLatestModel()
      if (configuredModel?.diagnostics) return configuredModel.diagnostics()
      return { provider, model: 'unknown' }
    },
    async respond(request) {
      const configuredModel = createLatestModel()
      if (!configuredModel) {
        return { success: false as const, error: '请先在「AI 生成（旧版）」中配置 API 密钥' }
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
  )
}

function useProjectConversationContext(): ProjectConversationContextValue {
  const value = useContext(ProjectConversationContext)
  if (!value) throw new Error('useProjectConversation 必须在 ProjectConversationProvider 内使用')
  return value
}

export function useProjectConversation<T>(selector: (view: ProjectConversationView) => T): T {
  const { projectRoot, conversation, loadError } = useProjectConversationContext()
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
    projectRoot,
    loadStatus,
    loadError: effectiveLoadError,
  }
  return selector(view)
}

export function useProjectConversationActions(): ProjectConversationActions {
  const { conversation } = useProjectConversationContext()

  return useMemo(() => ({
    send: (
      userText: string,
      attachments: readonly ConversationAttachment[] = [],
      quickReplySelection: ConversationQuickReplySelection | null = null,
    ) => {
      if (!conversation) return Promise.resolve({ ok: false as const, error: '请先打开项目', code: 'not-loaded' as const })
      return conversation.send(userText, attachments, quickReplySelection)
    },
    cancel: () => conversation
      ? conversation.cancel()
      : Promise.resolve({ ok: true as const }),
    retryTurn: (turnId: string) => {
      if (!conversation) return Promise.resolve({ ok: false as const, error: '请先打开项目', code: 'not-loaded' as const })
      return conversation.retryTurn(turnId)
    },
    isRunning: () => conversation?.hasActiveWork() ?? false,
    prepareForProjectSwitch: async (confirmSwitch = () => window.confirm('AI 正在回复。要取消本轮并切换项目吗？')) => {
      if (!conversation?.hasActiveWork()) return true
      if (!confirmSwitch()) return false
      const result = await conversation.cancel()
      return result.ok && !conversation.hasActiveWork()
    },
  }), [conversation])
}

/**
 * 给事件回调使用的稳定离开守卫；它不会订阅消息变化，也不会导致应用壳重渲染。
 */
export function usePrepareForProjectSwitch(): ProjectConversationActions['prepareForProjectSwitch'] {
  const { prepareForProjectSwitch } = useProjectConversationActions()
  return useCallback((confirmSwitch?: () => boolean) => prepareForProjectSwitch(confirmSwitch), [prepareForProjectSwitch])
}
