import {
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactNode,
  type RefObject,
} from 'react'
import type { CardDocument } from '../card/cardDocument'
import { isValidCardId } from '../card/cardValidation'
import type { GraphEdge, GraphNode } from '../node-editor/types'
import type {
  ConversationCardProposal,
  ConversationCardProposalStatus,
  ConversationProposalRejectionFeedback,
} from './proposalLifecycle'

export interface CardProposalPanelProps {
  documents: readonly CardDocument[]
  proposals: readonly ConversationCardProposal[]
  onPreviewUpdate: (proposalId: string, cardId: string) => void
  onAccept: (proposalId: string, finalCardId: string) => void | Promise<void>
  onReject: (
    proposalId: string,
    feedback: ConversationProposalRejectionFeedback | null,
  ) => void | Promise<void>
  onRedoFromCurrent: (proposalId: string) => void | Promise<void>
}

interface DiffRow {
  id: string
  label: string
  current: string | null
  candidate: string | null
  kind: 'added' | 'removed' | 'changed' | 'unchanged'
}

export interface CardProposalDiff {
  properties: readonly DiffRow[]
  nodes: readonly DiffRow[]
  edges: readonly DiffRow[]
}

const STATUS_PRESENTATION: Record<ConversationCardProposalStatus, { label: string; detail: string }> = {
  pending: { label: '待确认', detail: '尚未写入项目' },
  accepted: { label: '已接受', detail: '内容已写入项目' },
  rejected: { label: '已拒绝', detail: '不可恢复' },
  stale: { label: '已过期', detail: '目标 Card 已继续编辑' },
  superseded: { label: '已替代', detail: '已有更新的同目标提案' },
  reverted: { label: '已撤销', detail: '重做后会恢复为已接受' },
}

const REJECTION_REASONS = [
  { code: '', label: '不填写原因' },
  { code: 'wrong-direction', label: '方向不符合预期' },
  { code: 'balance', label: '数值或平衡问题' },
  { code: 'scope', label: '超出本轮范围' },
  { code: 'other', label: '其他原因' },
] as const

export function CardProposalPanel({
  documents,
  proposals,
  onPreviewUpdate,
  onAccept,
  onReject,
  onRedoFromCurrent,
}: CardProposalPanelProps) {
  const [activeProposalId, setActiveProposalId] = useState<string | null>(null)
  const [rejectingProposalId, setRejectingProposalId] = useState<string | null>(null)
  const [rejectionCode, setRejectionCode] = useState('')
  const [rejectionNote, setRejectionNote] = useState('')
  const [finalIds, setFinalIds] = useState<Record<string, string>>({})
  const [busyAction, setBusyAction] = useState<string | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)
  const rejectCancelRef = useRef<HTMLButtonElement>(null)
  const rejectTriggerRef = useRef<HTMLButtonElement>(null)
  const proposalSummaryRefs = useRef(new Map<string, HTMLButtonElement>())
  const restoreRejectFocusRef = useRef(false)
  const restoreSummaryFocusRef = useRef<string | null>(null)
  const headingId = useId()

  const activeProposal = proposals.find(proposal => proposal.id === activeProposalId) ?? null
  const rejectingProposal = proposals.find(proposal => proposal.id === rejectingProposalId) ?? null
  const documentsById = useMemo(
    () => new Map(documents.map(document => [document.card.id, document])),
    [documents],
  )

  useEffect(() => {
    if (activeProposalId && !activeProposal) {
      setActiveProposalId(null)
      setRejectingProposalId(null)
    }
  }, [activeProposal, activeProposalId])

  useEffect(() => {
    if (rejectingProposalId) {
      rejectCancelRef.current?.focus()
      return
    }
    if (restoreRejectFocusRef.current) {
      restoreRejectFocusRef.current = false
      rejectTriggerRef.current?.focus()
    }
  }, [rejectingProposalId])

  useEffect(() => {
    if (activeProposalId !== null || restoreSummaryFocusRef.current === null) return
    const proposalId = restoreSummaryFocusRef.current
    restoreSummaryFocusRef.current = null
    proposalSummaryRefs.current.get(proposalId)?.focus()
  }, [activeProposalId])

  const openProposal = (proposal: ConversationCardProposal) => {
    setActionError(null)
    setRejectingProposalId(null)
    setActiveProposalId(current => current === proposal.id ? null : proposal.id)
    if (proposal.operation === 'update' && activeProposalId !== proposal.id) {
      onPreviewUpdate(proposal.id, proposal.targetCardId)
    }
  }

  const closePreview = () => {
    restoreSummaryFocusRef.current = activeProposalId
    setRejectingProposalId(null)
    setActiveProposalId(null)
    setActionError(null)
  }

  const closeRejectionConfirmation = () => {
    restoreRejectFocusRef.current = true
    setRejectingProposalId(null)
  }

  const focusProposalSummary = (proposalId: string) => {
    proposalSummaryRefs.current.get(proposalId)?.focus()
  }

  const handleKeyDown = (event: KeyboardEvent<HTMLElement>) => {
    if (event.key !== 'Escape') return
    if (rejectingProposalId) {
      event.preventDefault()
      event.stopPropagation()
      closeRejectionConfirmation()
      return
    }
    if (activeProposalId) {
      event.preventDefault()
      event.stopPropagation()
      closePreview()
    }
  }

  const runAction = async (key: string, action: () => void | Promise<void>) => {
    setBusyAction(key)
    setActionError(null)
    try {
      await action()
    } catch (error) {
      setActionError(error instanceof Error ? error.message : '操作失败，请重试')
    } finally {
      setBusyAction(null)
    }
  }

  const confirmRejection = () => {
    if (!rejectingProposal) return
    const feedback: ConversationProposalRejectionFeedback | null = rejectionCode
      ? { code: rejectionCode, note: rejectionNote.trim() || null }
      : null
    void runAction(`reject:${rejectingProposal.id}`, async () => {
      await onReject(rejectingProposal.id, feedback)
      focusProposalSummary(rejectingProposal.id)
      setRejectingProposalId(null)
      setRejectionCode('')
      setRejectionNote('')
    })
  }

  return (
    <section className="card-proposal-panel" aria-labelledby={headingId} onKeyDown={handleKeyDown}>
      <header className="card-proposal-heading">
        <div>
          <span className="card-proposal-eyebrow">CARD PROPOSALS</span>
          <h3 id={headingId}>Card 提案</h3>
        </div>
        <span className="card-proposal-count" aria-label={`${proposals.length} 个提案`}>{proposals.length}</span>
      </header>

      {actionError && <p className="card-proposal-error" role="alert">{actionError}</p>}

      {proposals.length === 0 ? (
        <div className="card-proposal-empty">
          <span aria-hidden="true">◇</span>
          <strong>这一轮没有 Card 提案</strong>
          <p>可以继续讨论；只有明确接受的提案才会改动项目。</p>
        </div>
      ) : (
        <ol className="card-proposal-list" aria-label="Card 提案列表">
          {proposals.map(proposal => {
            const status = STATUS_PRESENTATION[proposal.status]
            const isActive = proposal.id === activeProposalId
            return (
              <li className="card-proposal-item" data-status={proposal.status} key={proposal.id}>
                <button
                  ref={element => {
                    if (element) proposalSummaryRefs.current.set(proposal.id, element)
                    else proposalSummaryRefs.current.delete(proposal.id)
                  }}
                  type="button"
                  className="card-proposal-summary"
                  aria-expanded={isActive}
                  aria-controls={`card-proposal-preview-${proposal.id}`}
                  onClick={() => openProposal(proposal)}
                >
                  <span className="card-proposal-summary-main">
                    <strong>@{proposal.targetCardId}</strong>
                    <small>{proposal.operation === 'create' ? '创建新 Card' : '修改现有 Card'}</small>
                  </span>
                  <span className={`card-proposal-status is-${proposal.status}`}>
                    <span>{status.label}</span>
                    <small>{status.detail}</small>
                  </span>
                  <span className="card-proposal-chevron" aria-hidden="true">{isActive ? '−' : '+'}</span>
                </button>

                {isActive && activeProposal && (
                  <ProposalPreview
                    proposal={activeProposal}
                    currentDocument={documentsById.get(activeProposal.targetCardId) ?? null}
                    documents={documents}
                    finalId={finalIds[activeProposal.id] ?? activeProposal.document.card.id}
                    busyAction={busyAction}
                    rejecting={rejectingProposalId === activeProposal.id}
                    rejectionCode={rejectionCode}
                    rejectionNote={rejectionNote}
                    rejectCancelRef={rejectCancelRef}
                    rejectTriggerRef={rejectTriggerRef}
                    onFinalIdChange={value => setFinalIds(current => ({ ...current, [activeProposal.id]: value }))}
                    onAccept={(finalCardId) => void runAction(
                      `accept:${activeProposal.id}`,
                      async () => {
                        await onAccept(activeProposal.id, finalCardId)
                        focusProposalSummary(activeProposal.id)
                      },
                    )}
                    onStartReject={() => {
                      setRejectionCode('')
                      setRejectionNote('')
                      setRejectingProposalId(activeProposal.id)
                    }}
                    onCancelReject={closeRejectionConfirmation}
                    onConfirmReject={confirmRejection}
                    onRejectionCodeChange={setRejectionCode}
                    onRejectionNoteChange={setRejectionNote}
                    onRedo={() => void runAction(
                      `redo:${activeProposal.id}`,
                      () => onRedoFromCurrent(activeProposal.id),
                    )}
                    onClose={closePreview}
                  />
                )}
              </li>
            )
          })}
        </ol>
      )}
      <style>{CARD_PROPOSAL_STYLES}</style>
    </section>
  )
}

function ProposalPreview({
  proposal,
  currentDocument,
  documents,
  finalId,
  busyAction,
  rejecting,
  rejectionCode,
  rejectionNote,
  rejectCancelRef,
  rejectTriggerRef,
  onFinalIdChange,
  onAccept,
  onStartReject,
  onCancelReject,
  onConfirmReject,
  onRejectionCodeChange,
  onRejectionNoteChange,
  onRedo,
  onClose,
}: {
  proposal: ConversationCardProposal
  currentDocument: CardDocument | null
  documents: readonly CardDocument[]
  finalId: string
  busyAction: string | null
  rejecting: boolean
  rejectionCode: string
  rejectionNote: string
  rejectCancelRef: RefObject<HTMLButtonElement>
  rejectTriggerRef: RefObject<HTMLButtonElement>
  onFinalIdChange: (value: string) => void
  onAccept: (finalCardId: string) => void
  onStartReject: () => void
  onCancelReject: () => void
  onConfirmReject: () => void
  onRejectionCodeChange: (value: string) => void
  onRejectionNoteChange: (value: string) => void
  onRedo: () => void
  onClose: () => void
}) {
  const isCreate = proposal.operation === 'create'
  const diff = buildCardProposalDiff(isCreate ? null : currentDocument, proposal.document)
  const idConflict = isCreate
    ? documents.find(document => document.card.id.toLowerCase() === finalId.toLowerCase())
    : null
  const idError = isCreate
    ? !isValidCardId(finalId)
      ? 'ID 必须为 PascalCase ASCII，且只能包含字母和数字。'
      : idConflict
        ? `与现有 @${idConflict.card.id} 冲突（ID 不区分大小写）。`
        : null
    : null
  const terminal = proposal.status !== 'pending'
  const rejectBusy = busyAction === `reject:${proposal.id}`

  return (
    <div
      className="card-proposal-preview"
      id={`card-proposal-preview-${proposal.id}`}
      aria-label={`@${proposal.targetCardId} 提案预览`}
    >
      <div className="card-proposal-preview-toolbar">
        <span>{isCreate ? '只读新 Card 预览' : '当前内容 ↔ 提案内容'}</span>
        <button type="button" className="card-proposal-quiet-button" onClick={onClose} aria-label="离开提案预览">收起</button>
      </div>

      {!isCreate && !currentDocument && (
        <p className="card-proposal-warning" role="status">当前项目中已找不到目标 Card；此提案不能直接接受。</p>
      )}

      <DiffSection title="基本属性" rows={diff.properties} emptyLabel="基本属性没有变化" />
      <DiffSection title="行为节点" rows={diff.nodes} emptyLabel="行为节点没有变化" />
      <DiffSection title="连线" rows={diff.edges} emptyLabel="连线没有变化" />

      {isCreate && proposal.status === 'pending' && (
        <label className="card-proposal-id-field">
          <span>最终 Card ID</span>
          <input
            aria-label="最终 Card ID"
            value={finalId}
            onChange={event => onFinalIdChange(event.target.value)}
            aria-invalid={Boolean(idError)}
            aria-describedby={`card-proposal-id-help-${proposal.id}`}
            autoComplete="off"
            spellCheck={false}
          />
          <small id={`card-proposal-id-help-${proposal.id}`} className={idError ? 'is-error' : ''}>
            {idError ?? '点击接受前不会加入项目，也不会占用这个 ID。'}
          </small>
        </label>
      )}

      {proposal.status === 'stale' && (
        <div className="card-proposal-terminal-note is-stale">
          <strong>此修改已过期</strong>
          <p>你可以保留这份预览，并以 Card 当前内容发起一轮新修改。</p>
          <button
            type="button"
            className="card-proposal-primary-button"
            onClick={onRedo}
            disabled={busyAction !== null}
          >
            {busyAction === `redo:${proposal.id}` ? '正在准备…' : '基于当前内容重做'}
          </button>
        </div>
      )}

      {terminal && proposal.status !== 'stale' && <TerminalDetails proposal={proposal} />}

      {proposal.status === 'pending' && !rejecting && (
        <div className="card-proposal-actions">
          <button
            type="button"
            className="card-proposal-primary-button"
            disabled={Boolean(idError) || (!isCreate && !currentDocument) || busyAction !== null}
            onClick={() => onAccept(isCreate ? finalId : proposal.targetCardId)}
          >
            {busyAction === `accept:${proposal.id}`
              ? '正在应用…'
              : isCreate ? '创建并接受' : '接受整张修改'}
          </button>
          <button
            ref={rejectTriggerRef}
            type="button"
            className="card-proposal-danger-button"
            disabled={busyAction !== null}
            onClick={onStartReject}
          >
            拒绝提案
          </button>
        </div>
      )}

      {proposal.status === 'pending' && rejecting && (
        <div className="card-proposal-reject-confirm" role="group" aria-label="确认拒绝提案">
          <strong>拒绝后不可恢复</strong>
          <p>这份提案仍会作为审计记录保留，但不能再次接受。</p>
          <label>
            <span>原因（可选）</span>
            <select value={rejectionCode} onChange={event => onRejectionCodeChange(event.target.value)}>
              {REJECTION_REASONS.map(reason => <option value={reason.code} key={reason.code}>{reason.label}</option>)}
            </select>
          </label>
          <label>
            <span>补充说明（可选）</span>
            <textarea
              value={rejectionNote}
              disabled={!rejectionCode}
              maxLength={500}
              onChange={event => onRejectionNoteChange(event.target.value)}
              rows={2}
              placeholder="说明不接受的具体原因"
            />
          </label>
          <div className="card-proposal-confirm-actions">
            <button
              ref={rejectCancelRef}
              type="button"
              className="card-proposal-quiet-button"
              disabled={rejectBusy}
              onClick={onCancelReject}
            >
              返回预览
            </button>
            <button
              type="button"
              className="card-proposal-danger-button"
              disabled={rejectBusy}
              onClick={onConfirmReject}
            >
              {rejectBusy ? '正在拒绝…' : '确认永久拒绝'}
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

function DiffSection({ title, rows, emptyLabel }: { title: string; rows: readonly DiffRow[]; emptyLabel: string }) {
  return (
    <section className="card-proposal-diff-section" aria-label={`${title}差异`}>
      <h4>{title}<span>{rows.length}</span></h4>
      {rows.length === 0 ? <p className="card-proposal-no-change">{emptyLabel}</p> : (
        <div className="card-proposal-diff-list">
          {rows.map(row => <DiffRowView row={row} key={row.id} />)}
        </div>
      )}
    </section>
  )
}

function DiffRowView({ row }: { row: DiffRow }) {
  return (
    <div className="card-proposal-diff-row" data-kind={row.kind}>
      <strong>{row.label}</strong>
      <div className="card-proposal-diff-values">
        {row.current !== null && <DiffValue label="当前" value={row.current} />}
        {row.current !== null && row.candidate !== null && <span className="card-proposal-arrow" aria-hidden="true">→</span>}
        {row.candidate !== null && <DiffValue label="提案" value={row.candidate} />}
      </div>
    </div>
  )
}

function DiffValue({ label, value }: { label: string; value: ReactNode }) {
  return <span className="card-proposal-diff-value"><small>{label}</small><span>{value}</span></span>
}

function TerminalDetails({ proposal }: { proposal: ConversationCardProposal }) {
  const status = STATUS_PRESENTATION[proposal.status]
  const latestEvent = proposal.events.at(-1)
  const feedback = latestEvent?.type === 'rejected' ? latestEvent.feedback : null
  const acceptedEvent = [...proposal.events].reverse().find(event => event.type === 'accepted')
  return (
    <div className={`card-proposal-terminal-note is-${proposal.status}`}>
      <strong>{status.label}</strong>
      <p>{status.detail}。离开预览不会改变该状态。</p>
      {feedback && (
        <dl>
          <div><dt>原因</dt><dd>{rejectionReasonLabel(feedback.code)}</dd></div>
          {feedback.note && <div><dt>说明</dt><dd>{feedback.note}</dd></div>}
        </dl>
      )}
      {acceptedEvent?.type === 'accepted' && (
        <dl>
          <div><dt>Card</dt><dd>@{acceptedEvent.finalCardId}</dd></div>
        </dl>
      )}
    </div>
  )
}

export function buildCardProposalDiff(
  current: CardDocument | null,
  candidate: CardDocument,
): CardProposalDiff {
  const currentCard = current?.card ?? null
  const propertyDefinitions = [
    ['id', 'Card ID'],
    ['name', '名称'],
    ['cost', '费用'],
    ['type', '类型'],
    ['rarity', '稀有度'],
    ['description', '描述'],
    ['keywords', '关键词'],
    ['imagePath', '图片'],
  ] as const
  const properties = propertyDefinitions.flatMap(([key, label]) => {
    const before = currentCard ? formatCardProperty(currentCard[key]) : null
    const after = formatCardProperty(candidate.card[key])
    if (currentCard && before === after) return []
    return [diffRow(`property:${key}`, label, before, after)]
  })
  return {
    properties,
    nodes: diffEntities(current?.graph.nodes ?? null, candidate.graph.nodes, formatNode, '节点'),
    edges: diffEntities(current?.graph.edges ?? null, candidate.graph.edges, formatEdge, '连线'),
  }
}

function diffEntities<T extends { id: string }>(
  current: readonly T[] | null,
  candidate: readonly T[],
  format: (value: T) => string,
  label: string,
): DiffRow[] {
  if (current === null) {
    return candidate.map(value => diffRow(`${label}:${value.id}`, `${label} · ${value.id}`, null, format(value)))
  }
  const currentById = new Map(current.map(value => [value.id, value]))
  const candidateById = new Map(candidate.map(value => [value.id, value]))
  const ids = [...new Set([...current.map(value => value.id), ...candidate.map(value => value.id)])]
  return ids.flatMap(id => {
    const before = currentById.get(id)
    const after = candidateById.get(id)
    const beforeText = before ? format(before) : null
    const afterText = after ? format(after) : null
    if (beforeText === afterText) return []
    return [diffRow(`${label}:${id}`, `${label} · ${id}`, beforeText, afterText)]
  })
}

function diffRow(id: string, label: string, current: string | null, candidate: string | null): DiffRow {
  return {
    id,
    label,
    current,
    candidate,
    kind: current === null ? 'added' : candidate === null ? 'removed' : current === candidate ? 'unchanged' : 'changed',
  }
}

function formatCardProperty(value: unknown): string {
  if (value === undefined || value === '') return '—'
  if (Array.isArray(value)) return value.length ? value.join('、') : '—'
  return String(value)
}

function formatNode(node: GraphNode): string {
  const data = Object.keys(node.data).length > 0 ? stableJson(node.data) : '无参数'
  return `${node.type} · ${data} · (${node.position.x}, ${node.position.y})`
}

function formatEdge(edge: GraphEdge): string {
  return `${edge.from.nodeId}.${edge.from.port} → ${edge.to.nodeId}.${edge.to.port}`
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(', ')}]`
  if (typeof value === 'object' && value !== null) {
    return `{ ${Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entry]) => `${key}: ${stableJson(entry)}`)
      .join(', ')} }`
  }
  return JSON.stringify(value) ?? String(value)
}

function rejectionReasonLabel(code: string): string {
  return REJECTION_REASONS.find(reason => reason.code === code)?.label ?? code
}

const CARD_PROPOSAL_STYLES = `
  .card-proposal-panel { color: var(--text-primary); font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", "Noto Sans SC", sans-serif; }
  .card-proposal-heading { min-height: 58px; display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 12px 14px; border-block: 1px solid var(--border); background: var(--bg-secondary); background: linear-gradient(145deg, color-mix(in srgb, var(--bg-tertiary) 38%, var(--bg-secondary)), var(--bg-secondary)); }
  .card-proposal-heading h3 { margin: 2px 0 0; font-size: 14px; font-weight: 650; }
  .card-proposal-eyebrow { color: color-mix(in srgb, var(--text-secondary) 76%, #82b7df 24%); font-size: 9px; font-weight: 700; letter-spacing: .12em; }
  .card-proposal-count { min-width: 28px; height: 28px; display: grid; place-items: center; border: 1px solid color-mix(in srgb, var(--border) 72%, #82b7df 28%); border-radius: 9px; color: var(--text-secondary); font-size: 11px; }
  .card-proposal-error, .card-proposal-warning { margin: 10px 12px; padding: 9px 10px; border: 1px solid color-mix(in srgb, var(--accent) 55%, var(--border)); border-radius: 8px; background: color-mix(in srgb, var(--bg-secondary) 92%, var(--accent) 8%); font-size: 11px; line-height: 1.5; }
  .card-proposal-empty { min-height: 150px; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 7px; padding: 22px; text-align: center; color: var(--text-secondary); }
  .card-proposal-empty > span { width: 40px; height: 40px; display: grid; place-items: center; margin-bottom: 4px; border: 1px solid color-mix(in srgb, var(--border) 64%, #82b7df 36%); border-radius: 14px; color: #82b7df; }
  .card-proposal-empty strong { color: var(--text-primary); font-size: 13px; }
  .card-proposal-empty p { max-width: 260px; margin: 0; font-size: 11px; line-height: 1.6; }
  .card-proposal-list { margin: 0; padding: 0; list-style: none; }
  .card-proposal-item { border-bottom: 1px solid var(--border); }
  .card-proposal-summary { width: 100%; min-height: 68px; display: grid; grid-template-columns: minmax(0, 1fr) auto 28px; align-items: center; gap: 9px; padding: 10px 10px 10px 14px; border-radius: 0; background: var(--bg-secondary); color: var(--text-primary); text-align: left; }
  .card-proposal-summary:hover, .card-proposal-summary[aria-expanded="true"] { opacity: 1; background: color-mix(in srgb, var(--bg-tertiary) 76%, #7baed4 7%); }
  .card-proposal-summary:focus-visible, .card-proposal-panel button:focus-visible, .card-proposal-panel input:focus-visible, .card-proposal-panel select:focus-visible, .card-proposal-panel textarea:focus-visible { outline: 2px solid color-mix(in srgb, var(--accent) 58%, #76b5e1); outline-offset: -2px; }
  .card-proposal-summary-main { min-width: 0; display: flex; flex-direction: column; gap: 4px; }
  .card-proposal-summary-main strong { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 12px; }
  .card-proposal-summary-main small { color: var(--text-secondary); font-size: 10px; }
  .card-proposal-status { display: flex; flex-direction: column; align-items: flex-end; gap: 2px; }
  .card-proposal-status > span { font-size: 10px; font-weight: 700; }
  .card-proposal-status small { max-width: 100px; color: var(--text-secondary); font-size: 8px; text-align: right; }
  .card-proposal-status.is-pending > span { color: #78b5df; }
  .card-proposal-status.is-stale > span, .card-proposal-status.is-reverted > span { color: #d8a85e; }
  .card-proposal-status.is-rejected > span { color: color-mix(in srgb, var(--accent) 75%, #e6a16d); }
  .card-proposal-chevron { color: var(--text-secondary); font-size: 17px; text-align: center; }
  .card-proposal-preview { padding: 0 12px 14px; background: var(--bg-primary); box-shadow: inset 3px 0 0 color-mix(in srgb, #79b7e2 45%, transparent); }
  .card-proposal-preview-toolbar { min-height: 48px; display: flex; align-items: center; justify-content: space-between; gap: 8px; color: var(--text-secondary); font-size: 10px; }
  .card-proposal-preview-toolbar button { flex: 0 0 auto; }
  .card-proposal-diff-section { padding: 10px 0; border-top: 1px solid var(--border); }
  .card-proposal-diff-section h4 { display: flex; align-items: center; gap: 7px; margin: 0 0 8px; color: var(--text-secondary); font-size: 10px; font-weight: 650; }
  .card-proposal-diff-section h4 span { min-width: 19px; padding: 2px 5px; border-radius: 5px; background: var(--bg-tertiary); text-align: center; font-size: 8px; }
  .card-proposal-no-change { margin: 0; color: var(--text-secondary); font-size: 10px; }
  .card-proposal-diff-list { display: grid; gap: 7px; }
  .card-proposal-diff-row { padding: 8px; border: 1px solid var(--border); border-radius: 8px; background: var(--bg-secondary); }
  .card-proposal-diff-row[data-kind="added"] { border-left-color: #68b591; }
  .card-proposal-diff-row[data-kind="removed"] { border-left-color: color-mix(in srgb, var(--accent) 70%, #d6a26b); }
  .card-proposal-diff-row > strong { display: block; margin-bottom: 6px; color: var(--text-secondary); font-size: 9px; font-weight: 650; overflow-wrap: anywhere; }
  .card-proposal-diff-values { display: grid; grid-template-columns: minmax(0, 1fr) auto minmax(0, 1fr); align-items: center; gap: 5px; }
  .card-proposal-diff-value { min-width: 0; display: flex; flex-direction: column; gap: 3px; }
  .card-proposal-diff-value small { color: var(--text-secondary); font-size: 8px; }
  .card-proposal-diff-value > span { overflow-wrap: anywhere; font-size: 10px; line-height: 1.45; }
  .card-proposal-arrow { color: #78afd5; font-size: 11px; }
  .card-proposal-id-field, .card-proposal-reject-confirm label { display: grid; gap: 6px; margin-top: 10px; color: var(--text-secondary); font-size: 10px; }
  .card-proposal-id-field input, .card-proposal-reject-confirm select, .card-proposal-reject-confirm textarea { min-height: 44px; border-radius: 8px; font-size: 12px; }
  .card-proposal-id-field small { min-height: 15px; color: var(--text-secondary); font-size: 9px; line-height: 1.45; }
  .card-proposal-id-field small.is-error { color: color-mix(in srgb, var(--accent) 72%, #e2a272); }
  .card-proposal-actions, .card-proposal-confirm-actions { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; margin-top: 12px; }
  .card-proposal-primary-button, .card-proposal-danger-button, .card-proposal-quiet-button { min-height: 44px; padding: 7px 10px; border-radius: 8px; font-size: 11px; font-weight: 600; }
  .card-proposal-primary-button { background: linear-gradient(145deg, color-mix(in srgb, var(--accent) 76%, #659fcf), var(--accent)); color: white; }
  .card-proposal-danger-button { border: 1px solid color-mix(in srgb, var(--accent) 45%, var(--border)); background: color-mix(in srgb, var(--bg-secondary) 92%, var(--accent) 8%); color: var(--text-primary); }
  .card-proposal-quiet-button { border: 1px solid var(--border); background: var(--bg-secondary); color: var(--text-secondary); }
  .card-proposal-reject-confirm, .card-proposal-terminal-note { margin-top: 12px; padding: 11px; border: 1px solid color-mix(in srgb, var(--accent) 46%, var(--border)); border-radius: 9px; background: color-mix(in srgb, var(--bg-secondary) 94%, var(--accent) 6%); }
  .card-proposal-reject-confirm > strong, .card-proposal-terminal-note > strong { display: block; margin-bottom: 4px; font-size: 11px; }
  .card-proposal-reject-confirm > p, .card-proposal-terminal-note > p { margin: 0; color: var(--text-secondary); font-size: 10px; line-height: 1.5; }
  .card-proposal-terminal-note.is-stale { border-color: color-mix(in srgb, #d5a55d 58%, var(--border)); }
  .card-proposal-terminal-note button { width: 100%; margin-top: 10px; }
  .card-proposal-terminal-note dl { display: grid; gap: 6px; margin: 9px 0 0; font-size: 10px; }
  .card-proposal-terminal-note dl div { display: grid; grid-template-columns: 42px 1fr; gap: 8px; }
  .card-proposal-terminal-note dt { color: var(--text-secondary); }
  .card-proposal-terminal-note dd { margin: 0; overflow-wrap: anywhere; }
  @media (max-width: 420px) {
    .card-proposal-summary { grid-template-columns: minmax(0, 1fr) 28px; }
    .card-proposal-status { grid-column: 1; align-items: flex-start; }
    .card-proposal-status small { text-align: left; }
    .card-proposal-chevron { grid-column: 2; grid-row: 1 / span 2; }
    .card-proposal-actions, .card-proposal-confirm-actions { grid-template-columns: 1fr; }
  }
  @media (prefers-reduced-motion: reduce) {
    .card-proposal-panel *, .card-proposal-panel *::before, .card-proposal-panel *::after { scroll-behavior: auto !important; transition: none !important; animation: none !important; }
  }
  @supports not (color: color-mix(in srgb, white, black)) {
    .card-proposal-heading, .card-proposal-summary, .card-proposal-preview, .card-proposal-diff-row { background: var(--bg-secondary); }
  }
`
