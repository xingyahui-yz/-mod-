import { useEffect, useMemo, useRef, useState, type FormEvent, type KeyboardEvent } from 'react'
import { cardDocumentRevision } from '../card/cardAiProposal'
import { cardCatalogActions, useCardCatalog } from '../card/cardCatalog'
import type {
  ConversationAttemptStatus,
  ConversationQuickReplySelection,
  ConversationTurn,
} from './conversationDocument'
import {
  useProjectConversation,
  useProjectConversationActions,
  type ProjectConversationView,
} from './ProjectConversationContext'
import { CardProposalPanel } from './CardProposalPanel'
import type { ConversationProposalRejectionFeedback } from './proposalLifecycle'
import type { ConversationArchiveSummary, ConversationArchiveReadResult, ConversationQuarantineSummary, ConversationQuarantineReadResult } from './conversationRepository'
import type { ConversationPerformanceMetrics } from './conversationPerformance'

const RETRIABLE_STATUSES = new Set<ConversationAttemptStatus>(['failed', 'cancelled', 'interrupted'])
const NO_CARD_DOCUMENTS: readonly never[] = []

export function ProjectConversationDrawer({
  onOpenCard,
}: {
  onOpenCard?: (cardId: string) => void
} = {}) {
  const view = useProjectConversation(value => value)
  const actions = useProjectConversationActions()
  const documents = useCardCatalog(value => value.documents)
  const currentDocument = useCardCatalog(value => value.currentDocument)
  const sourceProjectRoot = useCardCatalog(value => value.sourceProjectRoot)
  const [isOpen, setIsOpen] = useState(Boolean(view.projectRoot))
  const [isNarrow, setIsNarrow] = useState(() => window.matchMedia?.('(max-width: 1099px)').matches ?? false)
  const [draft, setDraft] = useState('')
  const [selectedQuickReply, setSelectedQuickReply] = useState<ConversationQuickReplySelection | null>(null)
  const [attachmentIds, setAttachmentIds] = useState<string[]>([])
  const [actionError, setActionError] = useState<string | null>(null)
  const [archiveError, setArchiveError] = useState<string | null>(null)
  const [archiveBrowserOpen, setArchiveBrowserOpen] = useState(false)
  const [archives, setArchives] = useState<readonly ConversationArchiveSummary[]>([])
  const [isLoadingArchives, setIsLoadingArchives] = useState(false)
  const [selectedArchiveId, setSelectedArchiveId] = useState<string | null>(null)
  const [archiveRead, setArchiveRead] = useState<Extract<ConversationArchiveReadResult, { ok: true }> | null>(null)
  const [performanceMetrics, setPerformanceMetrics] = useState<ConversationPerformanceMetrics | null>(null)
  const [quarantineError, setQuarantineError] = useState<string | null>(null)
  const [quarantines, setQuarantines] = useState<readonly ConversationQuarantineSummary[]>([])
  const [isLoadingQuarantines, setIsLoadingQuarantines] = useState(false)
  const [quarantineBrowserOpen, setQuarantineBrowserOpen] = useState(false)
  const [selectedQuarantineId, setSelectedQuarantineId] = useState<string | null>(null)
  const [quarantineRead, setQuarantineRead] = useState<Extract<ConversationQuarantineReadResult, { ok: true }> | null>(null)
  const quarantineListRequest = useRef(0)
  const quarantineReadRequest = useRef(0)
  const archiveReadRequest = useRef(0)
  const archiveListRequest = useRef(0)
  const currentProjectRoot = useRef(view.projectRoot)
  currentProjectRoot.current = view.projectRoot
  const [hasUnread, setHasUnread] = useState(false)
  const historyRef = useRef<HTMLDivElement>(null)
  const drawerRef = useRef<HTMLElement>(null)
  const closeButtonRef = useRef<HTMLButtonElement>(null)
  const railButtonRef = useRef<HTMLButtonElement>(null)
  const composerRef = useRef<HTMLTextAreaElement>(null)
  const restoreRailFocusRef = useRef(false)
  const previousProjectRoot = useRef(view.projectRoot)
  const previousActivityCount = useRef(0)
  const unreadBaselineReadyRef = useRef(view.loadStatus !== 'loading')
  const turns = view.document?.turns ?? []
  const activityCount = turns.reduce((count, turn) => {
    const lastAttempt = turn.attempts.at(-1)
    return count + (turn.assistantText !== null || (lastAttempt && lastAttempt.status !== 'running') ? 1 : 0)
  }, 0)

  useEffect(() => {
    const media = window.matchMedia?.('(max-width: 1099px)')
    if (!media) return
    const update = () => setIsNarrow(media.matches)
    update()
    media.addEventListener?.('change', update)
    return () => media.removeEventListener?.('change', update)
  }, [])

  useEffect(() => {
    if (view.projectRoot && previousProjectRoot.current === null) setIsOpen(true)
    if (view.projectRoot !== previousProjectRoot.current) {
      setDraft('')
      setSelectedQuickReply(null)
      setAttachmentIds([])
      setActionError(null)
      setArchiveError(null)
      setArchiveBrowserOpen(false)
      setPerformanceMetrics(null)
      setArchives([])
      setIsLoadingArchives(false)
      setSelectedArchiveId(null)
      setArchiveRead(null)
      archiveReadRequest.current += 1
      archiveListRequest.current += 1
      setQuarantineError(null)
      setQuarantines([])
      setIsLoadingQuarantines(false)
      setQuarantineBrowserOpen(false)
      setSelectedQuarantineId(null)
      setQuarantineRead(null)
      quarantineListRequest.current += 1
      quarantineReadRequest.current += 1
      setHasUnread(false)
      previousActivityCount.current = activityCount
      unreadBaselineReadyRef.current = view.loadStatus !== 'loading'
    }
    previousProjectRoot.current = view.projectRoot
  }, [activityCount, view.loadStatus, view.projectRoot])

  useEffect(() => {
    if (!isOpen && restoreRailFocusRef.current) {
      restoreRailFocusRef.current = false
      railButtonRef.current?.focus()
    }
  }, [isOpen])

  useEffect(() => {
    if (!isOpen || !isNarrow) return
    const background = Array.from(document.querySelectorAll<HTMLElement>(
      '.app > .header, .app > .tabs, .workspace-shell > .main',
    ))
    const previous = background.map(element => ({
      element,
      inert: element.hasAttribute('inert'),
      ariaHidden: element.getAttribute('aria-hidden'),
    }))
    for (const { element } of previous) {
      element.setAttribute('inert', '')
      element.setAttribute('aria-hidden', 'true')
    }
    closeButtonRef.current?.focus()
    return () => {
      for (const { element, inert, ariaHidden } of previous) {
        if (!inert) element.removeAttribute('inert')
        if (ariaHidden === null) element.removeAttribute('aria-hidden')
        else element.setAttribute('aria-hidden', ariaHidden)
      }
    }
  }, [isNarrow, isOpen])

  useEffect(() => {
    const history = historyRef.current
    if (history) history.scrollTop = history.scrollHeight
  }, [view.document?.turns.length, view.isBusy])

  const projectDocuments = sourceProjectRoot === view.projectRoot ? documents : NO_CARD_DOCUMENTS
  const projectCurrentDocument = sourceProjectRoot === view.projectRoot ? currentDocument : null
  const isCardCatalogReady = Boolean(view.projectRoot && sourceProjectRoot === view.projectRoot)
  const documentsById = useMemo(
    () => new Map(projectDocuments.map(document => [document.card.id, document])),
    [projectDocuments],
  )
  const pendingUpdateRevisionSignature = view.loadStatus === 'loaded' && sourceProjectRoot === view.projectRoot
    ? (view.document?.proposals ?? [])
        .filter(proposal => proposal.operation === 'update' && proposal.status === 'pending')
        .map(proposal => {
          const current = documentsById.get(proposal.targetCardId)
          return `${proposal.id}:${current ? cardDocumentRevision(current) : 'missing'}`
        })
        .join('|')
    : ''

  useEffect(() => {
    if (!pendingUpdateRevisionSignature) return
    const proposalIds = (view.document?.proposals ?? [])
      .filter(proposal => proposal.operation === 'update' && proposal.status === 'pending')
      .map(proposal => proposal.id)
    let active = true
    void (async () => {
      for (const proposalId of proposalIds) {
        const result = await actions.refreshProposal(proposalId)
        if (!active) return
        if (!result.ok && result.code !== 'stale-proposal' && result.code !== 'proposal-not-pending') {
          setActionError(result.error)
        }
      }
    })()
    return () => { active = false }
  }, [actions, pendingUpdateRevisionSignature, view.document?.proposals])

  const attachedDocuments = attachmentIds.flatMap(cardId => {
    const document = documentsById.get(cardId)
    return document ? [document] : []
  })
  const availableDocuments = projectDocuments.filter(document => !attachmentIds.includes(document.card.id))
  const canSend = Boolean(
    view.projectRoot &&
    !selectedArchiveId &&
    isCardCatalogReady &&
    view.loadStatus !== 'loading' &&
    view.loadStatus !== 'error' &&
    view.loadStatus !== 'quarantined' &&
    !view.persistenceError &&
    view.capacity.level !== 'hard' &&
    !view.isBusy &&
    draft.trim(),
  )
  useEffect(() => {
    if (!unreadBaselineReadyRef.current) {
      previousActivityCount.current = activityCount
      if (view.loadStatus !== 'loading') unreadBaselineReadyRef.current = true
      setHasUnread(false)
      return
    }
    if (isOpen) setHasUnread(false)
    else if (activityCount > previousActivityCount.current) setHasUnread(true)
    previousActivityCount.current = activityCount
  }, [activityCount, isOpen, view.loadStatus])

  const handleSubmit = async (event?: FormEvent) => {
    event?.preventDefault()
    if (!canSend) return
    setActionError(null)
    const sentDraft = draft
    const result = await actions.send(
      sentDraft,
      attachedDocuments.map(document => ({
        cardId: document.card.id,
        revision: cardDocumentRevision(document),
      })),
      selectedQuickReply,
    )
    if (result.ok) {
      setDraft('')
      setSelectedQuickReply(null)
      setAttachmentIds([])
    } else {
      setActionError(result.error)
    }
  }

  const handleKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
      event.preventDefault()
      void handleSubmit()
    }
  }

  const retryTurn = async (turnId: string) => {
    setActionError(null)
    const result = await actions.retryTurn(turnId)
    if (!result.ok) setActionError(result.error)
  }

  const selectQuickReply = (turnId: string, id: string, label: string) => {
    setDraft(label)
    setSelectedQuickReply({ turnId, replyId: id })
    requestAnimationFrame(() => composerRef.current?.focus())
  }

  const updateDraft = (value: string) => {
    setDraft(value)
    setSelectedQuickReply(null)
  }


  const refreshArchives = async () => {
    const request = ++archiveListRequest.current
    const requestedProjectRoot = view.projectRoot
    setIsLoadingArchives(true)
    setArchiveError(null)
    try {
      const result = await actions.listArchives()
      if (request !== archiveListRequest.current || currentProjectRoot.current !== requestedProjectRoot) return
      if (result.ok) setArchives(result.archives)
      else setArchiveError(result.error)
    } catch (error) {
      if (request === archiveListRequest.current && currentProjectRoot.current === requestedProjectRoot) {
        setArchiveError(error instanceof Error ? error.message : '读取归档列表失败')
      }
    } finally {
      if (request === archiveListRequest.current && currentProjectRoot.current === requestedProjectRoot) {
        setIsLoadingArchives(false)
      }
    }
  }

  const refreshQuarantines = async () => {
    const request = ++quarantineListRequest.current
    const requestedProjectRoot = view.projectRoot
    setIsLoadingQuarantines(true)
    setQuarantineError(null)
    try {
      const result = await actions.listQuarantines()
      if (request !== quarantineListRequest.current || currentProjectRoot.current !== requestedProjectRoot) return
      if (result.ok) setQuarantines(result.quarantines)
      else setQuarantineError(result.error)
    } catch (error) {
      if (request === quarantineListRequest.current && currentProjectRoot.current === requestedProjectRoot) {
        setQuarantineError(error instanceof Error ? error.message : '读取隔离文件列表失败')
      }
    } finally {
      if (request === quarantineListRequest.current && currentProjectRoot.current === requestedProjectRoot) {
        setIsLoadingQuarantines(false)
      }
    }
  }

  const openArchiveBrowser = () => {
    setArchiveBrowserOpen(true)
    void refreshArchives()
    void refreshQuarantines()
  }

  const showArchive = async (archiveId: string) => {
    setSelectedArchiveId(archiveId)
    setArchiveRead(null)
    setArchiveError(null)
    const request = ++archiveReadRequest.current
    const requestedProjectRoot = view.projectRoot
    try {
      const result = await actions.readArchive(archiveId)
      if (request !== archiveReadRequest.current || currentProjectRoot.current !== requestedProjectRoot) return
      if (result.ok) setArchiveRead(result)
      else setArchiveError(result.error)
    } catch (error) {
      if (request === archiveReadRequest.current && currentProjectRoot.current === requestedProjectRoot) {
        setArchiveError(error instanceof Error ? error.message : '读取归档失败')
      }
    }
  }

  const leaveArchive = () => {
    archiveReadRequest.current += 1
    setSelectedArchiveId(null)
    setArchiveRead(null)
    setArchiveError(null)
  }


  const showQuarantine = async (quarantineId: string) => {
    setSelectedQuarantineId(quarantineId)
    setQuarantineRead(null)
    setQuarantineError(null)
    const request = ++quarantineReadRequest.current
    try {
      const result = await actions.readQuarantine(quarantineId)
      if (request !== quarantineReadRequest.current || currentProjectRoot.current !== view.projectRoot) return
      if (result.ok) setQuarantineRead(result)
      else setQuarantineError(result.error)
    } catch (error) {
      if (request === quarantineReadRequest.current && currentProjectRoot.current === view.projectRoot) {
        setQuarantineError(error instanceof Error ? error.message : '读取隔离文件失败')
      }
    }
  }

  const leaveQuarantine = () => {
    quarantineReadRequest.current += 1
    setSelectedQuarantineId(null)
    setQuarantineRead(null)
    setQuarantineError(null)
  }

  const exportQuarantine = () => {
    if (!quarantineRead) return
    const blob = new Blob([quarantineRead.rawJson], { type: 'application/json;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download = 'quarantine-' + safeArchiveFilename(quarantineRead.quarantineId) + '.json'
    document.body.append(anchor)
    anchor.click()
    anchor.remove()
    window.setTimeout(() => URL.revokeObjectURL(url), 0)
  }

  const canRestoreQuarantine = Boolean(
    quarantineRead?.recoverable &&
    !view.document &&
    !view.isBusy &&
    (view.loadStatus === 'quarantined' || view.loadStatus === 'missing'),
  )

  const restoreQuarantine = async () => {
    if (!selectedQuarantineId || !canRestoreQuarantine) return
    const confirmed = window.confirm(
      '将隔离文档迁移并恢复为当前项目的活动对话。原始隔离文件会保留。确定恢复吗？',
    )
    if (!confirmed) return
    setQuarantineError(null)
    try {
      const result = await actions.restoreQuarantine(selectedQuarantineId)
      if (!result.ok) {
        setQuarantineError(result.error)
        return
      }
      await refreshQuarantines()
    } catch (error) {
      setQuarantineError(error instanceof Error ? error.message : '恢复隔离对话失败')
    }
  }

  const exportArchive = () => {
    if (!archiveRead) return
    const blob = new Blob([archiveRead.rawJson], { type: 'application/json;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download = 'conversation-' + safeArchiveFilename(archiveRead.archiveId) + '.json'
    document.body.append(anchor)
    anchor.click()
    anchor.remove()
    window.setTimeout(() => URL.revokeObjectURL(url), 0)
  }

  const archiveAndReset = async () => {
    if (view.isBusy || !view.document) return
    const confirmed = window.confirm('将当前项目对话完整归档，并清空活动对话。归档只能只读查看或导出，不会自动恢复。确定继续吗？')
    if (!confirmed) return
    setArchiveError(null)
    try {
      const result = await actions.archiveAndReset()
      if (!result.ok) {
        setArchiveError(result.error)
        return
      }
      setDraft('')
      setSelectedQuickReply(null)
      setAttachmentIds([])
      leaveArchive()
      setArchiveBrowserOpen(true)
      await refreshArchives()
    } catch (error) {
      setArchiveError(error instanceof Error ? error.message : '归档并重置失败')
    }
  }

  const previewUpdateProposal = async (proposalId: string, cardId: string) => {
    setActionError(null)
    const proposal = view.document?.proposals.find(candidate => candidate.id === proposalId)
    if (proposal?.status === 'pending') {
      const refreshed = await actions.refreshProposal(proposalId)
      if (!refreshed.ok && refreshed.code !== 'stale-proposal' && refreshed.code !== 'proposal-not-pending') {
        setActionError(refreshed.error)
      }
    }
    const selected = cardCatalogActions.selectCard(cardId)
    if (!selected.ok) {
      setActionError(`无法定位 @${cardId}：${selected.error}`)
      return
    }
    onOpenCard?.(cardId)
  }

  const acceptProposal = async (proposalId: string, finalCardId: string) => {
    setActionError(null)
    const result = await actions.acceptProposal(proposalId, finalCardId)
    if (!result.ok) {
      throw new Error(result.error)
    }
    onOpenCard?.(finalCardId)
  }

  const rejectProposal = async (
    proposalId: string,
    feedback: ConversationProposalRejectionFeedback | null,
  ) => {
    setActionError(null)
    const result = await actions.rejectProposal(proposalId, feedback)
    if (!result.ok) throw new Error(result.error)
  }

  const redoFromCurrent = (proposalId: string) => {
    const proposal = view.document?.proposals.find(candidate => candidate.id === proposalId)
    if (!proposal) {
      setActionError('Card 提案不存在')
      return
    }
    setActionError(null)
    setSelectedQuickReply(null)
    setDraft(`基于当前版本重做 @${proposal.targetCardId}`)
    if (documentsById.has(proposal.targetCardId)) {
      setAttachmentIds(ids => ids.includes(proposal.targetCardId) ? ids : [...ids, proposal.targetCardId])
    }
    requestAnimationFrame(() => composerRef.current?.focus())
  }

  const latestTurnId = turns.at(-1)?.id ?? null
  const closeDrawer = () => {
    restoreRailFocusRef.current = true
    setIsOpen(false)
  }

  const openDrawer = () => {
    setIsOpen(true)
    requestAnimationFrame(() => closeButtonRef.current?.focus())
  }

  const handleDrawerKeyDown = (event: KeyboardEvent<HTMLElement>) => {
    if (!isOpen || !isNarrow) return
    if (event.key === 'Escape') {
      event.preventDefault()
      closeDrawer()
      return
    }
    if (event.key !== 'Tab') return
    const focusable = Array.from(drawerRef.current?.querySelectorAll<HTMLElement>(
      'button:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex]:not([tabindex="-1"])',
    ) ?? [])
    if (focusable.length === 0) return
    const first = focusable[0]
    const last = focusable.at(-1)!
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault()
      last.focus()
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault()
      first.focus()
    }
  }

  const railStatus = view.isBusy ? 'AI 正在处理' : hasUnread ? '有未读消息' : null

  return (
    <>
      {isOpen && isNarrow && <button className="conversation-overlay" tabIndex={-1} aria-hidden="true" onClick={closeDrawer} />}
      <aside
        ref={drawerRef}
        className={`project-conversation-drawer ${isOpen ? 'is-open' : 'is-collapsed'}`}
        aria-label="项目 AI 对话"
        role={isOpen && isNarrow ? 'dialog' : undefined}
        aria-modal={isOpen && isNarrow ? true : undefined}
        data-running={view.isBusy || undefined}
        onKeyDown={handleDrawerKeyDown}
      >
        {!isOpen ? (
          <button
            className="conversation-rail-button"
            ref={railButtonRef}
            onClick={openDrawer}
            disabled={!view.projectRoot}
            aria-label={view.projectRoot ? `展开项目 AI 对话${railStatus ? `，${railStatus}` : ''}` : '请先打开项目'}
            title={view.projectRoot ? '展开项目 AI 对话' : '请先打开项目'}
          >
            <span className="conversation-spark" aria-hidden="true">✦</span>
            <span className="conversation-rail-label">AI 对话</span>
            {(view.isBusy || hasUnread) && (
              <span
                className={`conversation-status-dot ${hasUnread && !view.isBusy ? 'has-unread' : ''}`}
                aria-label={view.isBusy ? 'AI 正在处理' : '有未读 AI 回复'}
              />
            )}
          </button>
        ) : (
          <div className="conversation-panel">
            <header className="conversation-header">
              <div>
                <span className="conversation-eyebrow">PROJECT COPILOT · BETA</span>
                <h2>项目 AI 对话</h2>
              </div>
              <button ref={closeButtonRef} className="conversation-icon-button" onClick={closeDrawer} aria-label="收起项目 AI 对话">›</button>
            </header>

            <div className="conversation-project-status">
              <span className={`conversation-status-dot ${view.isBusy ? 'is-active' : ''}`} aria-hidden="true" />
              <span>{view.projectRoot ? projectName(view.projectRoot) : '未打开项目'}</span>
              {view.isBusy && <strong>处理中</strong>}
            </div>

            {view.capacity.level === 'warning' && (
              <div className="conversation-capacity-notice is-warning" role="status">
                对话已达到容量提醒阈值：{formatCapacityBytes(view.capacity.bytes)} / 10 MB，
                {view.capacity.messageCount.toLocaleString('zh-CN')} / 5,000 条消息。仍可继续对话；建议适时归档并重置。
              </div>
            )}
            {view.capacity.level === 'hard' && (
              <div className="conversation-capacity-notice is-hard" role="alert">
                <strong>项目对话已达到硬容量上限，不能开始新一轮。</strong>
                <span>
                  {view.isBusy
                    ? '当前轮次会完成或取消，之后将封锁新消息；请先归档并重置活动对话。'
                    : '请先归档并重置活动对话，然后再继续。'}
                </span>
                <button type="button" onClick={openArchiveBrowser}>打开归档管理</button>
              </div>
            )}

            <section className="conversation-archive-controls" aria-label="对话归档">
              <button type="button" onClick={openArchiveBrowser} aria-expanded={archiveBrowserOpen}>
                {archiveBrowserOpen ? '刷新归档列表' : '浏览归档' + (archives.length ? '（' + archives.length + '）' : '')}
              </button>
              {archiveBrowserOpen && (
                <div className="conversation-archive-browser">
                  <p className="conversation-archive-readonly-note">
                    归档为只读历史，不会自动恢复到活动对话；可浏览或额外导出 JSON。
                  </p>
                  <button type="button" onClick={() => setPerformanceMetrics(actions.getPerformanceMetrics())}>刷新存储性能与 SQLite 评估数据</button>
                  {performanceMetrics && <section aria-label="对话存储性能指标">
                    <strong>本项目会话实例最近 {performanceMetrics.sampleLimit} 次可测量仓储样本（仅成功加载；保存包括已序列化的失败尝试）</strong>
                    <p>常规活动文档仓储端到端耗时（含排队、解析/校验；不含归档重置）：加载 p95：{formatMetric(performanceMetrics.load.p95Ms)}（{performanceMetrics.load.sampleCount} 次）；原子保存 p95：{formatMetric(performanceMetrics.save.p95Ms)}（{performanceMetrics.save.sampleCount} 次）。</p>
                    <p>软阈值规模样本（≥10 MB 或 ≥5,000 条消息）：加载 p95 {formatMetric(performanceMetrics.softScale.load.p95Ms)}（{performanceMetrics.softScale.load.sampleCount} 次）；保存 p95 {formatMetric(performanceMetrics.softScale.save.p95Ms)}（{performanceMetrics.softScale.save.sampleCount} 次）。</p>
                    <p>若软阈值规模的加载或保存 p95 超过 500 ms，或硬容量限制拦截频繁，应立项评估 SQLite；当前项目会话内硬限制拦截 {performanceMetrics.hardLimitBlockCount} 次。样本仅保留于内存，不含对话文本，也不会持久化。</p>
                  </section>}
                  <button
                    type="button"
                    className="conversation-archive-reset-button"
                    onClick={() => void archiveAndReset()}
                    disabled={view.isBusy || !view.document || (!view.document.turns.length && !view.document.proposals.length) || view.loadStatus !== 'loaded'}
                  >归档当前对话并重置</button>
                  <button type="button" onClick={() => void refreshArchives()} disabled={isLoadingArchives}>
                    {isLoadingArchives ? '正在读取…' : '刷新列表'}
                  </button>
                  {isLoadingArchives && <span role="status">正在读取归档列表…</span>}
                  {!isLoadingArchives && archives.length === 0 && <p>尚无归档。</p>}
                  {archives.length > 0 && (
                    <ul aria-label="项目对话归档列表">
                      {archives.map(archive => (
                        <li key={archive.archiveId}>
                          <button
                            type="button"
                            aria-label={'查看归档 ' + archive.archiveId}
                            aria-pressed={selectedArchiveId === archive.archiveId}
                            onClick={() => void showArchive(archive.archiveId)}
                          >
                            {new Date(archive.createdAt).toLocaleString('zh-CN')} · {archive.turnCount} 轮 · {formatCapacityBytes(archive.bytes)}
                          </button>
                        </li>
                      ))}
                    </ul>
                  )}
                  {selectedArchiveId && (
                    <div className="conversation-archive-viewer" aria-label="归档只读查看">
                      <strong>归档只读查看 · {selectedArchiveId}</strong>
                      <p>此内容不会替换或恢复活动对话。</p>
                      <button type="button" onClick={leaveArchive}>返回当前对话</button>
                      <button type="button" onClick={exportArchive} disabled={!archiveRead}>导出此归档 JSON</button>
                      {archiveRead && <span>{archiveRead.document.turns.length} 轮历史</span>}
                    </div>
                  )}
                  <section className="conversation-quarantines" aria-label="隔离对话文件">
                    <h3>隔离文件</h3>
                    <button
                      type="button"
                      aria-expanded={quarantineBrowserOpen}
                      onClick={() => {
                        setQuarantineBrowserOpen(true)
                        void refreshQuarantines()
                      }}
                    >{quarantineBrowserOpen ? '刷新隔离文件列表' : '查看隔离文件'}</button>
                    {quarantineBrowserOpen && (
                      <>
                        <p>隔离文件会保留原始内容；未知未来 schema 或损坏文件仅可导出，不可恢复。</p>
                        <button type="button" onClick={() => void refreshQuarantines()} disabled={isLoadingQuarantines}>
                          {isLoadingQuarantines ? '正在读取…' : '刷新隔离列表'}
                        </button>
                        {isLoadingQuarantines && <span role="status">正在读取隔离文件列表…</span>}
                        {!isLoadingQuarantines && quarantines.length === 0 && <p>没有隔离文件。</p>}
                        {quarantines.length > 0 && (
                          <ul aria-label="隔离文件列表">
                            {quarantines.map(item => (
                              <li key={item.quarantineId}>
                                <button
                                  type="button"
                                  aria-label={'查看隔离文件 ' + item.quarantineId}
                                  aria-pressed={selectedQuarantineId === item.quarantineId}
                                  onClick={() => void showQuarantine(item.quarantineId)}
                                >
                                  {item.quarantineId} · schema {item.schemaVersion ?? '未知'} · {formatCapacityBytes(item.bytes)} · {item.recoverable ? '可恢复' : '仅可导出'}
                                </button>
                                <small>{item.reason}</small>
                              </li>
                            ))}
                          </ul>
                        )}
                        {selectedQuarantineId && (
                          <div className="conversation-quarantine-viewer" aria-label="隔离文件只读查看">
                            <strong>隔离原始文档 · {selectedQuarantineId}</strong>
                            {quarantineRead ? (
                              <>
                                <p>原因：{quarantineRead.reason}</p>
                                <p>schemaVersion：{quarantineRead.schemaVersion ?? '未知或损坏'}</p>
                                <p>状态：{quarantineRead.recoverable ? quarantineRead.migrated ? '可迁移恢复' : '可恢复' : '仅可导出，不能恢复'}</p>
                                <button type="button" onClick={leaveQuarantine}>关闭隔离查看</button>
                                <button type="button" onClick={exportQuarantine}>导出隔离原始 JSON</button>
                                <button
                                  type="button"
                                  onClick={() => void restoreQuarantine()}
                                  disabled={!canRestoreQuarantine}
                                >确认恢复隔离对话</button>
                                {view.document && <p role="status">当前活动对话包含内容，因此禁止用隔离文档覆盖。</p>}
                                {!view.document && view.loadStatus !== 'quarantined' && view.loadStatus !== 'missing' && (
                                  <p role="status">当前项目状态不允许恢复隔离文档。</p>
                                )}
                                <pre aria-label="隔离文件原始 JSON">{quarantineRead.rawJson}</pre>
                              </>
                            ) : <p>正在读取隔离文件…</p>}
                          </div>
                        )}
                      </>
                    )}
                  </section>
                </div>
              )}
            </section>
            {archiveError && <div className="conversation-error" role="alert">归档操作失败：{archiveError}</div>}
            {quarantineError && <div className="conversation-error" role="alert">隔离文件操作失败：{quarantineError}</div>}

            <div className="conversation-history" ref={historyRef} role="log" aria-live="polite" aria-label={selectedArchiveId ? '归档对话历史' : '对话历史'}>
              {selectedArchiveId ? (archiveRead
                ? <>
                    {archiveRead.document.turns.length > 0
                      ? archiveRead.document.turns.map(turn => (
                        <ConversationTurnView
                          key={turn.id}
                          turn={turn}
                          isLatest={false}
                          isRunning={false}
                          persistenceBlocked
                          selectedQuickReply={null}
                          onSelectQuickReply={() => undefined}
                          onRetry={() => undefined}
                        />
                      ))
                      : <div className="conversation-empty">该归档没有对话轮次。</div>}
                    {archiveRead.document.proposals.length > 0 && (
                      <section className="conversation-archive-proposals" aria-label="归档提案摘要">
                        <h3>归档提案摘要（只读）</h3>
                        <ul>
                          {archiveRead.document.proposals.map(proposal => (
                            <li key={proposal.id}>
                              <strong>{proposal.operation === 'create' ? '创建新 Card' : '修改现有 Card'}</strong>
                              <span>目标：@{proposal.targetCardId}</span>
                              <span>状态：{proposalStatusLabel(proposal.status)}</span>
                            </li>
                          ))}
                        </ul>
                      </section>
                    )}
                  </>
                : <div className="conversation-empty">正在读取归档历史…</div>) : <>
              <ConversationState view={view} />
              {turns.map(turn => (
                <ConversationTurnView
                  key={turn.id}
                  turn={turn}
                  isLatest={turn.id === latestTurnId}
                  isRunning={view.isBusy}
                  persistenceBlocked={Boolean(view.persistenceError)}
                  selectedQuickReply={selectedQuickReply}
                  onSelectQuickReply={selectQuickReply}
                  onRetry={retryTurn}
                />
              ))}
              {view.isBusy && (
                <div className="conversation-message assistant is-running" aria-label="AI 正在回复">
                  <span /><span /><span />
                </div>
              )}
              {view.document && (
                <CardProposalPanel
                  key={view.projectRoot}
                  documents={projectDocuments}
                  proposals={view.document.proposals}
                  onPreviewUpdate={(proposalId, cardId) => void previewUpdateProposal(proposalId, cardId)}
                  onAccept={acceptProposal}
                  onReject={rejectProposal}
                  onRedoFromCurrent={redoFromCurrent}
                />
              )}
              </>}
            </div>

            {(view.persistenceError || actionError || (view.lastError && !view.isBusy)) && (
              <div className="conversation-error" role="alert">
                {view.persistenceError ?? actionError ?? view.lastError}
              </div>
            )}

            {!selectedArchiveId && <form className="conversation-composer" onSubmit={event => void handleSubmit(event)}>
              {attachedDocuments.length > 0 && (
                <div className="conversation-attachments" aria-label="已添加的 Card 上下文">
                  {attachedDocuments.map(document => (
                    <span className="conversation-attachment" key={document.card.id}>
                      <span>@{document.card.id}</span>
                      <small>{shortRevision(cardDocumentRevision(document))}</small>
                      <button
                        type="button"
                        aria-label={`移除 ${document.card.id} 上下文`}
                        onClick={() => setAttachmentIds(ids => ids.filter(id => id !== document.card.id))}
                      >×</button>
                    </span>
                  ))}
                </div>
              )}

              <label className="conversation-context-picker">
                <span>添加上下文</span>
                <select
                  aria-label="添加 Card 上下文"
                  value=""
                  disabled={!isCardCatalogReady || availableDocuments.length === 0 || view.isBusy}
                  onChange={event => {
                    if (event.target.value) setAttachmentIds(ids => [...ids, event.target.value])
                  }}
                >
                  <option value="">选择 Card（不会默认附加）</option>
                  {[...availableDocuments]
                    .sort((left, right) => {
                      if (left.card.id === projectCurrentDocument?.card.id) return -1
                      if (right.card.id === projectCurrentDocument?.card.id) return 1
                      return left.card.id.localeCompare(right.card.id)
                    })
                    .map(document => (
                      <option value={document.card.id} key={document.card.id}>
                        @{document.card.id}{document.card.id === projectCurrentDocument?.card.id ? ' · 当前建议' : ''}
                      </option>
                    ))}
                </select>
              </label>

              <div className="conversation-input-shell">
                <textarea
                  ref={composerRef}
                  value={draft}
                  onChange={event => updateDraft(event.target.value)}
                  onKeyDown={handleKeyDown}
                  placeholder={composerPlaceholder(view.loadStatus, isCardCatalogReady)}
                  aria-label="发送给项目 AI 的消息"
                  rows={3}
                  disabled={!isCardCatalogReady || view.loadStatus === 'loading' || view.loadStatus === 'error' || view.loadStatus === 'quarantined' || Boolean(view.persistenceError) || view.capacity.level === 'hard' || view.isBusy}
                />
                {view.isBusy ? (
                  <button type="button" className="conversation-send-button is-cancel" onClick={() => void actions.cancel()}>
                    停止
                  </button>
                ) : (
                  <button type="submit" className="conversation-send-button" disabled={!canSend}>
                    发送
                  </button>
                )}
              </div>
              <p className="conversation-composer-hint">
                {view.projectRoot && !isCardCatalogReady
                  ? '正在等待当前项目 Card 目录加载完成…'
                  : view.capacity.level === 'hard'
                    ? '容量达到硬限制；请先归档并重置后再发送'
                    : 'Enter 发送 · Shift + Enter 换行 · 附件仅记录发送时版本'}
              </p>
            </form>}
          </div>
        )}
      </aside>
      <style>{DRAWER_STYLES}</style>
    </>
  )
}

function ConversationState({ view }: { view: ProjectConversationView }) {
  if (view.loadStatus === 'no-project') {
    return <div className="conversation-empty"><strong>打开一个 Mod 项目后开始对话</strong><p>对话按项目独立保存，不会跟随当前 Card 切换。</p></div>
  }
  if (view.loadStatus === 'loading') {
    return <div className="conversation-empty is-loading"><span className="conversation-loader" /><strong>正在恢复项目对话…</strong></div>
  }
  if (view.loadStatus === 'error') {
    return <div className="conversation-state-card is-danger" role="alert"><strong>对话加载失败</strong><p>{view.loadError}</p><small>Card 编辑仍可继续；重新打开项目可再次恢复。</small></div>
  }
  if (view.loadStatus === 'quarantined') {
    return <div className="conversation-state-card is-danger" role="alert"><strong>对话已进入只读隔离</strong><p>{view.quarantineReason}</p><small>原始历史未被覆盖；处理恢复前不能继续发送。</small></div>
  }
  if (!view.document?.turns.length) {
    return <div className="conversation-empty"><span className="conversation-orb" aria-hidden="true">✦</span><strong>从项目目标开始</strong><p>可以先讨论设计，也可以显式附加 Card。第一条消息发送后才会创建对话文档。</p></div>
  }
  return null
}

function ConversationTurnView({
  turn,
  isLatest,
  isRunning,
  persistenceBlocked,
  selectedQuickReply,
  onSelectQuickReply,
  onRetry,
}: {
  turn: ConversationTurn
  isLatest: boolean
  isRunning: boolean
  persistenceBlocked: boolean
  selectedQuickReply: ConversationQuickReplySelection | null
  onSelectQuickReply: (turnId: string, id: string, label: string) => void
  onRetry: (turnId: string) => void
}) {
  const latestAttempt = turn.attempts.at(-1)
  const canRetry = Boolean(isLatest && !isRunning && !persistenceBlocked && latestAttempt && RETRIABLE_STATUSES.has(latestAttempt.status))
  return (
    <article className="conversation-turn" data-turn-id={turn.id}>
      <div className="conversation-message user">
        <p>{turn.userText}</p>
        {turn.attachments.length > 0 && (
          <div className="conversation-message-attachments">
            {turn.attachments.map(attachment => (
              <span key={`${attachment.cardId}-${attachment.revision}`}>@{attachment.cardId} · {shortRevision(attachment.revision)}</span>
            ))}
          </div>
        )}
      </div>
      {turn.contextSnapshot && (turn.contextSnapshot.directoryTier === "compact" || turn.contextSnapshot.omittedMessageCount > 0) && (
        <p className="conversation-context-notice" role="note">
          {turn.contextSnapshot.directoryTier === "compact" && <>本轮使用了精简版项目目录上下文。 </>}
          {turn.contextSnapshot.omittedMessageCount > 0 && <>省略了 {turn.contextSnapshot.omittedMessageCount} 条较早的对话消息。</>}
        </p>
      )}
      {turn.assistantText !== null && (
        <div className="conversation-message assistant">
          {turn.assistantText && <p>{turn.assistantText}</p>}
          {turn.quickReplies.length > 0 && (
            <div className="conversation-quick-replies" aria-label="快捷回答">
              {turn.quickReplies.map(reply => (
                <button
                  type="button"
                  key={reply.id}
                  className={selectedQuickReply?.turnId === turn.id && selectedQuickReply.replyId === reply.id ? 'is-selected' : ''}
                  aria-pressed={selectedQuickReply?.turnId === turn.id && selectedQuickReply.replyId === reply.id}
                  onClick={() => onSelectQuickReply(turn.id, reply.id, reply.label)}
                  disabled={!isLatest || isRunning}
                >
                  {reply.label}
                </button>
              ))}
            </div>
          )}
        </div>
      )}
      {turn.attempts.map((attempt, index) => {
        if (attempt.status === 'running') return null
        const isLatestAttempt = index === turn.attempts.length - 1
        return (
          <div
            className={`conversation-attempt-status is-${attempt.status}`}
            key={attempt.id}
            data-attempt-id={attempt.id}
          >
            <span>{attemptStatusLabel(attempt.status)}</span>
            {attempt.error && <small>{attempt.error}</small>}
            {canRetry && isLatestAttempt && <button type="button" onClick={() => onRetry(turn.id)}>手动重试</button>}
          </div>
        )
      })}
    </article>
  )
}

function proposalStatusLabel(status: string): string {
  switch (status) {
    case 'pending': return '待确认'
    case 'accepted': return '已接受'
    case 'rejected': return '已拒绝'
    case 'stale': return '已过期'
    case 'superseded': return '已被替代'
    case 'reverted': return '已撤销'
    default: return status
  }
}

function safeArchiveFilename(archiveId: string): string {
  return archiveId.replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 80) || 'archive'
}

function projectName(projectRoot: string): string {
  return projectRoot.split(/[/\\]/).filter(Boolean).at(-1) ?? projectRoot
}

function shortRevision(revision: string): string {
  return revision.slice(0, 8)
}

function formatMetric(value: number | null): string {
  return value === null ? '暂无样本' : `${Math.round(value)} ms`
}

function formatCapacityBytes(bytes: number): string {
  return `${(bytes / 1_000_000).toFixed(1)} MB`
}

function composerPlaceholder(status: ProjectConversationView['loadStatus'], isCardCatalogReady: boolean): string {
  if (status === 'no-project') return '请先打开项目'
  if (status === 'loading') return '正在恢复对话…'
  if (status === 'quarantined') return '对话已隔离，暂时无法发送'
  if (status === 'error') return '对话加载失败'
  if (!isCardCatalogReady) return '正在加载当前项目 Card 目录…'
  return '讨论项目目标、比较 Card，或提出下一步修改…'
}

function attemptStatusLabel(status: ConversationAttemptStatus): string {
  switch (status) {
    case 'cancelled': return '本次回复已取消'
    case 'interrupted': return '上次回复因应用中断'
    case 'failed': return '本次回复失败'
    case 'running': return '正在回复'
    case 'completed': return '已完成'
  }
}

const DRAWER_STYLES = `
  .project-conversation-drawer {
    --conversation-width: 368px;
    position: relative;
    z-index: 20;
    flex: 0 0 auto;
    min-width: 0;
    color: var(--text-primary);
    background: color-mix(in srgb, var(--bg-secondary) 95%, #8fb8df 5%);
    border-left: 1px solid color-mix(in srgb, var(--border) 82%, #8fb8df 18%);
    box-shadow: -16px 0 36px rgba(5, 12, 28, 0.12);
    transition: width 180ms ease, transform 180ms ease;
  }
  .project-conversation-drawer.is-open { width: var(--conversation-width); }
  .project-conversation-drawer.is-collapsed { width: 48px; }
  .conversation-panel { height: 100%; display: flex; flex-direction: column; overflow: hidden; }
  .conversation-header { display: flex; align-items: center; justify-content: space-between; min-height: 70px; padding: 14px 12px 12px 18px; border-bottom: 1px solid var(--border); background: linear-gradient(145deg, color-mix(in srgb, var(--bg-tertiary) 74%, transparent), color-mix(in srgb, var(--bg-secondary) 92%, transparent)); }
  .conversation-eyebrow { display: block; margin-bottom: 4px; color: color-mix(in srgb, var(--text-secondary) 82%, #8fb8df 18%); font-size: 9px; font-weight: 700; letter-spacing: .12em; }
  .conversation-header h2 { margin: 0; font-size: 16px; font-weight: 650; letter-spacing: .01em; }
  .conversation-icon-button { width: 44px; height: 44px; padding: 0; border: 1px solid var(--border); border-radius: 12px; background: color-mix(in srgb, var(--bg-secondary) 86%, transparent); color: var(--text-secondary); font-size: 25px; line-height: 1; }
  .conversation-icon-button:hover { color: var(--text-primary); border-color: color-mix(in srgb, var(--accent) 45%, var(--border)); }
  .conversation-project-status { min-height: 34px; display: flex; align-items: center; gap: 8px; padding: 7px 18px; border-bottom: 1px solid var(--border); color: var(--text-secondary); font-size: 11px; }
  .conversation-project-status > span:nth-child(2) { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .conversation-project-status strong { margin-left: auto; color: color-mix(in srgb, var(--accent) 70%, #7fb8e8); font-weight: 600; }
  .conversation-capacity-notice { display: flex; flex-direction: column; gap: 3px; margin: 8px 12px 0; padding: 8px 10px; border: 1px solid var(--border); border-radius: 9px; font-size: 10px; line-height: 1.45; }
  .conversation-capacity-notice.is-warning { border-color: color-mix(in srgb, #d5a64c 48%, var(--border)); background: color-mix(in srgb, var(--bg-secondary) 94%, #d5a64c 6%); color: var(--text-secondary); }
  .conversation-capacity-notice.is-hard { border-color: color-mix(in srgb, var(--accent) 58%, var(--border)); background: color-mix(in srgb, var(--bg-secondary) 90%, var(--accent) 10%); color: var(--text-primary); }
  .conversation-capacity-notice strong { font-size: 11px; }
  .conversation-status-dot { width: 7px; height: 7px; flex: 0 0 auto; border-radius: 50%; background: var(--text-secondary); opacity: .42; }
  .conversation-status-dot.is-active, [data-running="true"] .conversation-status-dot { background: #6db9e9; opacity: 1; box-shadow: 0 0 0 4px rgba(109, 185, 233, .12); animation: conversation-pulse 1.3s ease-in-out infinite; }
  .conversation-status-dot.has-unread { background: #75b6df; opacity: 1; box-shadow: 0 0 0 3px rgba(117,182,223,.12); }
  .conversation-history { flex: 1; min-height: 0; overflow-y: auto; padding: 18px 14px 22px; scroll-behavior: smooth; }
  .conversation-context-notice { margin: 4px 0 10px; padding: 8px 10px; border-left: 2px solid color-mix(in srgb, var(--accent) 48%, var(--border)); color: var(--text-secondary); font-size: 11px; line-height: 1.5; }
  .conversation-empty { min-height: 220px; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 8px; padding: 24px; text-align: center; color: var(--text-secondary); }
  .conversation-empty strong { color: var(--text-primary); font-size: 14px; font-weight: 600; }
  .conversation-empty p { max-width: 270px; margin: 0; font-size: 12px; line-height: 1.65; }
  .conversation-orb { display: grid; place-items: center; width: 48px; height: 48px; margin-bottom: 8px; border: 1px solid color-mix(in srgb, var(--border) 52%, #8fb8df 48%); border-radius: 18px; background: linear-gradient(145deg, rgba(125, 180, 224, .13), rgba(125, 180, 224, .03)); color: #83b8df; font-size: 20px; box-shadow: inset 0 1px 0 rgba(255,255,255,.12); }
  .conversation-empty.is-loading { min-height: 150px; }
  .conversation-loader { width: 24px; height: 24px; border: 2px solid var(--border); border-top-color: #77b4df; border-radius: 50%; animation: conversation-spin .8s linear infinite; }
  .conversation-state-card { margin-bottom: 14px; padding: 13px; border: 1px solid var(--border); border-radius: 10px; background: var(--bg-secondary); font-size: 12px; line-height: 1.55; }
  .conversation-state-card strong, .conversation-state-card p, .conversation-state-card small { display: block; margin: 0 0 5px; }
  .conversation-state-card small { margin-bottom: 0; color: var(--text-secondary); }
  .conversation-state-card.is-danger { border-color: color-mix(in srgb, var(--accent) 56%, var(--border)); background: color-mix(in srgb, var(--bg-secondary) 94%, var(--accent) 6%); }
  .conversation-turn { display: flex; flex-direction: column; gap: 8px; margin-bottom: 18px; }
  .conversation-message { max-width: 91%; padding: 10px 12px; border: 1px solid var(--border); border-radius: 12px; font-size: 13px; line-height: 1.58; overflow-wrap: anywhere; }
  .conversation-message p { margin: 0; white-space: pre-wrap; }
  .conversation-message.user { align-self: flex-end; border-bottom-right-radius: 4px; border-color: color-mix(in srgb, var(--border) 58%, #6ca8d3 42%); background: color-mix(in srgb, var(--bg-tertiary) 80%, #6ca8d3 20%); color: var(--text-primary); }
  .conversation-message.assistant { align-self: flex-start; border-bottom-left-radius: 4px; background: color-mix(in srgb, var(--bg-secondary) 94%, #9fc5e1 6%); }
  .conversation-message-attachments { display: flex; flex-wrap: wrap; gap: 5px; margin-top: 8px; }
  .conversation-message-attachments span { padding: 3px 6px; border: 1px solid rgba(255,255,255,.14); border-radius: 6px; font-size: 9px; opacity: .78; }
  .conversation-quick-replies { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 10px; }
  .conversation-quick-replies button { min-height: 44px; padding: 8px 12px; border: 1px solid color-mix(in srgb, var(--border) 66%, #75aeda 34%); border-radius: 9px; background: color-mix(in srgb, var(--bg-tertiary) 70%, transparent); color: var(--text-primary); font-size: 11px; }
  .conversation-quick-replies button.is-selected { border-color: #75aeda; box-shadow: 0 0 0 2px rgba(117,174,218,.12); }
  .conversation-message.is-running { display: flex; gap: 5px; width: 52px; }
  .conversation-message.is-running span { width: 6px; height: 6px; border-radius: 50%; background: #7fb8df; animation: conversation-typing 1s ease-in-out infinite; }
  .conversation-message.is-running span:nth-child(2) { animation-delay: .12s; }
  .conversation-message.is-running span:nth-child(3) { animation-delay: .24s; }
  .conversation-attempt-status { display: grid; grid-template-columns: 1fr auto; gap: 2px 8px; align-items: center; padding: 8px 10px; border-left: 2px solid var(--text-secondary); color: var(--text-secondary); font-size: 11px; }
  .conversation-attempt-status small { grid-column: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .conversation-attempt-status button { grid-column: 2; grid-row: 1 / span 2; min-height: 44px; padding: 7px 11px; border: 1px solid var(--border); border-radius: 8px; background: var(--bg-tertiary); color: var(--text-primary); font-size: 11px; }
  .conversation-attempt-status.is-failed { border-left-color: var(--accent); }
  .conversation-error { margin: 0 14px 10px; padding: 8px 10px; border: 1px solid color-mix(in srgb, var(--accent) 58%, var(--border)); border-radius: 9px; background: color-mix(in srgb, var(--bg-secondary) 92%, var(--accent) 8%); color: var(--text-primary); font-size: 11px; line-height: 1.45; }
  .conversation-composer { flex: 0 0 auto; padding: 10px 12px 12px; border-top: 1px solid var(--border); background: color-mix(in srgb, var(--bg-secondary) 97%, transparent); }
  .conversation-attachments { display: flex; flex-wrap: wrap; gap: 6px; margin-bottom: 8px; }
  .conversation-attachment { display: inline-flex; align-items: center; gap: 5px; min-height: 44px; padding: 3px 4px 3px 10px; border: 1px solid color-mix(in srgb, var(--border) 66%, #75aeda 34%); border-radius: 8px; background: color-mix(in srgb, var(--bg-tertiary) 62%, transparent); font-size: 10px; }
  .conversation-attachment small { color: var(--text-secondary); }
  .conversation-attachment button { width: 44px; height: 44px; padding: 0; border-radius: 6px; background: transparent; color: var(--text-secondary); }
  .conversation-context-picker { display: grid; grid-template-columns: auto 1fr; align-items: center; gap: 8px; margin-bottom: 7px; color: var(--text-secondary); font-size: 10px; }
  .conversation-context-picker select { min-height: 44px; padding: 6px 30px 6px 10px; border-radius: 8px; font-size: 10px; }
  .conversation-input-shell { display: grid; grid-template-columns: 1fr auto; gap: 8px; align-items: end; padding: 7px; border: 1px solid var(--border); border-radius: 12px; background: var(--bg-primary); transition: border-color .15s, box-shadow .15s; }
  .conversation-input-shell:focus-within { border-color: color-mix(in srgb, var(--accent) 56%, #75aeda); box-shadow: 0 0 0 3px color-mix(in srgb, var(--accent) 10%, transparent); }
  .conversation-input-shell textarea { min-height: 58px; max-height: 150px; padding: 5px; resize: none; border: 0; background: transparent; font: inherit; font-size: 12px; line-height: 1.5; }
  .conversation-input-shell textarea:focus { border: 0; outline: 0; }
  .conversation-send-button { min-width: 58px; min-height: 44px; padding: 8px 11px; border-radius: 9px; background: linear-gradient(145deg, color-mix(in srgb, var(--accent) 82%, #659dcb), var(--accent)); font-size: 12px; font-weight: 600; }
  .conversation-send-button.is-cancel { background: var(--bg-tertiary); color: var(--text-primary); }
  .conversation-composer-hint { margin: 6px 2px 0; color: var(--text-secondary); font-size: 9px; }
  .conversation-rail-button { width: 48px; height: 100%; min-height: 180px; display: flex; flex-direction: column; align-items: center; gap: 10px; padding: 14px 6px; border-radius: 0; background: color-mix(in srgb, var(--bg-secondary) 96%, #7baed4 4%); color: var(--text-secondary); }
  .conversation-rail-button:not(:disabled):hover { color: var(--text-primary); background: color-mix(in srgb, var(--bg-tertiary) 84%, #7baed4 16%); }
  .conversation-spark { display: grid; place-items: center; width: 30px; height: 30px; border: 1px solid color-mix(in srgb, var(--border) 58%, #7baed4 42%); border-radius: 10px; color: #7fb8df; }
  .conversation-rail-label { writing-mode: vertical-rl; font-size: 11px; letter-spacing: .16em; }
  .conversation-overlay { display: none; }
  @keyframes conversation-spin { to { transform: rotate(360deg); } }
  @keyframes conversation-pulse { 50% { opacity: .5; transform: scale(.86); } }
  @keyframes conversation-typing { 50% { opacity: .35; transform: translateY(-2px); } }
  @media (max-width: 1099px) {
    .project-conversation-drawer { position: absolute; top: 0; right: 0; bottom: 0; z-index: 40; }
    .project-conversation-drawer.is-open { width: min(var(--conversation-width), calc(100vw - 32px)); box-shadow: -24px 0 54px rgba(2,8,22,.34); }
    .project-conversation-drawer.is-collapsed { width: 48px; }
    .conversation-overlay { display: block; position: absolute; inset: 0; z-index: 35; width: 100%; height: 100%; padding: 0; border-radius: 0; background: rgba(2,8,20,.42); backdrop-filter: blur(2px); }
  }
  @media (prefers-reduced-motion: reduce) {
    .project-conversation-drawer, .conversation-history { transition: none; scroll-behavior: auto; }
    .conversation-status-dot.is-active, [data-running="true"] .conversation-status-dot, .conversation-loader, .conversation-message.is-running span { animation: none; }
  }
  @supports not (color: color-mix(in srgb, white, black)) {
    .project-conversation-drawer, .conversation-header, .conversation-composer { background: var(--bg-secondary); }
  }
`
