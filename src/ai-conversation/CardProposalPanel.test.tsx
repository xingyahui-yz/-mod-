import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { CardDocument } from '../card/cardDocument'
import type {
  ConversationCardProposal,
  ConversationCardProposalStatus,
  ConversationProposalEvent,
} from './proposalLifecycle'
import { CardProposalPanel, type CardProposalPanelProps } from './CardProposalPanel'

const NOW = '2026-09-09T10:00:00.000Z'

describe('CardProposalPanel', () => {
  it('允许零提案，并说明不会隐式修改项目', () => {
    renderPanel({ proposals: [] })

    expect(screen.getByText('这一轮没有 Card 提案')).toBeTruthy()
    expect(screen.getByText('可以继续讨论；只有明确接受的提案才会改动项目。')).toBeTruthy()
  })

  it('逐提案清晰展示所有生命周期状态', () => {
    const statuses: ConversationCardProposalStatus[] = [
      'pending', 'accepted', 'rejected', 'stale', 'superseded', 'reverted',
    ]
    renderPanel({
      proposals: statuses.map((status, index) => proposal(
        `proposal-${status}`,
        status,
        cardDocument(`Card${index}`, `Card ${index}`),
      )),
    })

    for (const label of ['待确认', '已接受', '已拒绝', '已过期', '已替代', '已撤销']) {
      expect(screen.getByText(label)).toBeTruthy()
    }
    expect(screen.getByText('不可恢复')).toBeTruthy()
    expect(screen.getByText('重做后会恢复为已接受')).toBeTruthy()
  })

  it('修改现有 Card 时先定位目标，并分区显示属性、节点和连线差异', async () => {
    const current = cardDocument('FrostArc', '霜弧', {
      nodes: [triggerNode('trigger-1', 10)],
      edges: [],
    })
    const candidate = cardDocument('FrostArc', '霜弧·强化', {
      nodes: [triggerNode('trigger-1', 30), effectNode('effect-1')],
      edges: [{
        id: 'edge-1',
        from: { nodeId: 'trigger-1', port: 'out' },
        to: { nodeId: 'effect-1', port: 'in' },
      }],
    })
    const onPreviewUpdate = vi.fn()
    const onAccept = vi.fn()
    renderPanel({
      documents: [current],
      proposals: [proposal('proposal-update', 'pending', candidate, 'update')],
      onPreviewUpdate,
      onAccept,
    })

    fireEvent.click(screen.getByRole('button', { name: /@FrostArc.*修改现有 Card/ }))

    expect(onPreviewUpdate).toHaveBeenCalledWith('proposal-update', 'FrostArc')
    expect(screen.getByText('当前内容 ↔ 提案内容')).toBeTruthy()
    const properties = screen.getByRole('region', { name: '基本属性差异' })
    expect(within(properties).getByText('霜弧')).toBeTruthy()
    expect(within(properties).getByText('霜弧·强化')).toBeTruthy()
    const nodes = screen.getByRole('region', { name: '行为节点差异' })
    expect(within(nodes).getByText('节点 · trigger-1')).toBeTruthy()
    expect(within(nodes).getByText('节点 · effect-1')).toBeTruthy()
    const edges = screen.getByRole('region', { name: '连线差异' })
    expect(within(edges).getByText('连线 · edge-1')).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: '接受整张修改' }))
    expect(onAccept).toHaveBeenCalledWith('proposal-update', 'FrostArc')
    await waitFor(() => expect((screen.getByRole('button', { name: '接受整张修改' }) as HTMLButtonElement).disabled).toBe(false))
    expect(screen.queryByText('拒绝后不可恢复')).toBeNull()
  })

  it('节点参数单独变化时展示完整 data 差异', () => {
    const current = cardDocument('FrostArc', '霜弧', {
      nodes: [effectNode('effect-1', 8)],
    })
    const candidate = cardDocument('FrostArc', '霜弧', {
      nodes: [effectNode('effect-1', 12)],
    })
    renderPanel({
      documents: [current],
      proposals: [proposal('proposal-data-change', 'pending', candidate, 'update')],
    })

    fireEvent.click(screen.getByRole('button', { name: /@FrostArc.*修改现有 Card/ }))

    const nodes = screen.getByRole('region', { name: '行为节点差异' })
    expect(within(nodes).getByText(/amount: 8/)).toBeTruthy()
    expect(within(nodes).getByText(/amount: 12/)).toBeTruthy()
    expect(within(nodes).queryByText('行为节点没有变化')).toBeNull()
  })

  it('创建提案保持只读，实时阻止非法或大小写冲突的最终 ID', async () => {
    const onAccept = vi.fn()
    renderPanel({
      documents: [cardDocument('FrostArc', '现有卡')],
      proposals: [proposal('proposal-create', 'pending', cardDocument('NewCard', '新卡'), 'create')],
      onAccept,
    })
    fireEvent.click(screen.getByRole('button', { name: /@NewCard.*创建新 Card/ }))

    expect(screen.getByText('只读新 Card 预览')).toBeTruthy()
    expect(screen.getByText('点击接受前不会加入项目，也不会占用这个 ID。')).toBeTruthy()
    const idInput = screen.getByLabelText('最终 Card ID') as HTMLInputElement
    const accept = screen.getByRole('button', { name: '创建并接受' }) as HTMLButtonElement

    fireEvent.change(idInput, { target: { value: 'frostArc' } })
    expect(screen.getByText('ID 必须为 PascalCase ASCII，且只能包含字母和数字。')).toBeTruthy()
    expect(accept.disabled).toBe(true)

    fireEvent.change(idInput, { target: { value: 'FROSTARC' } })
    expect(screen.getByText('与现有 @FrostArc 冲突（ID 不区分大小写）。')).toBeTruthy()
    expect(accept.disabled).toBe(true)

    fireEvent.change(idInput, { target: { value: 'FinalCard' } })
    expect(accept.disabled).toBe(false)
    expect(onAccept).not.toHaveBeenCalled()
    fireEvent.click(accept)
    await waitFor(() => expect(onAccept).toHaveBeenCalledWith('proposal-create', 'FinalCard'))
  })

  it('拒绝必须二次确认，Escape 只退出确认层，并传递可选结构化原因', async () => {
    const onReject = vi.fn()
    const onOuterEscape = vi.fn()
    render(
      <div onKeyDown={event => { if (event.key === 'Escape') onOuterEscape() }}>
        <CardProposalPanel {...defaultProps({
          documents: [cardDocument('FrostArc', '霜弧')],
          proposals: [proposal('proposal-update', 'pending', cardDocument('FrostArc', '霜弧·强化'), 'update')],
          onReject,
        })} />
      </div>,
    )
    fireEvent.click(screen.getByRole('button', { name: /@FrostArc.*修改现有 Card/ }))
    fireEvent.click(screen.getByRole('button', { name: '拒绝提案' }))

    const confirmation = screen.getByRole('group', { name: '确认拒绝提案' })
    expect(within(confirmation).getByText('拒绝后不可恢复')).toBeTruthy()
    expect(document.activeElement).toBe(within(confirmation).getByRole('button', { name: '返回预览' }))

    fireEvent.keyDown(confirmation, { key: 'Escape' })
    expect(screen.queryByRole('group', { name: '确认拒绝提案' })).toBeNull()
    expect(screen.getByLabelText('@FrostArc 提案预览')).toBeTruthy()
    expect(onOuterEscape).not.toHaveBeenCalled()
    expect(onReject).not.toHaveBeenCalled()
    await waitFor(() => expect(document.activeElement).toBe(screen.getByRole('button', { name: '拒绝提案' })))

    fireEvent.click(screen.getByRole('button', { name: '拒绝提案' }))
    fireEvent.click(screen.getByRole('button', { name: '返回预览' }))
    await waitFor(() => expect(document.activeElement).toBe(screen.getByRole('button', { name: '拒绝提案' })))

    fireEvent.click(screen.getByRole('button', { name: '拒绝提案' }))
    fireEvent.change(screen.getByLabelText('原因（可选）'), { target: { value: 'balance' } })
    const note = screen.getByLabelText('补充说明（可选）') as HTMLTextAreaElement
    expect(note.maxLength).toBe(500)
    fireEvent.change(note, { target: { value: '  费用偏低  ' } })
    fireEvent.click(screen.getByRole('button', { name: '确认永久拒绝' }))

    await waitFor(() => expect(onReject).toHaveBeenCalledWith('proposal-update', {
      code: 'balance',
      note: '费用偏低',
    }))
  })

  it('过期提案仍可查看，并可基于当前内容发起重做', async () => {
    const onRedoFromCurrent = vi.fn()
    const onPreviewUpdate = vi.fn()
    renderPanel({
      documents: [cardDocument('FrostArc', '当前霜弧')],
      proposals: [proposal('proposal-stale', 'stale', cardDocument('FrostArc', '旧提案'), 'update')],
      onPreviewUpdate,
      onRedoFromCurrent,
    })
    fireEvent.click(screen.getByRole('button', { name: /@FrostArc.*修改现有 Card/ }))

    expect(onPreviewUpdate).toHaveBeenCalledWith('proposal-stale', 'FrostArc')
    expect(screen.getByText('此修改已过期')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: '基于当前内容重做' }))
    await waitFor(() => expect(onRedoFromCurrent).toHaveBeenCalledWith('proposal-stale'))
  })

  it('离开预览不触发提案动作，Escape 或收起后把焦点还给提案摘要', async () => {
    const handlers = {
      onAccept: vi.fn(),
      onReject: vi.fn(),
      onRedoFromCurrent: vi.fn(),
    }
    renderPanel({
      documents: [cardDocument('FrostArc', '霜弧')],
      proposals: [proposal('proposal-update', 'pending', cardDocument('FrostArc', '霜弧·强化'), 'update')],
      ...handlers,
    })
    const summary = screen.getByRole('button', { name: /@FrostArc.*修改现有 Card/ })
    fireEvent.click(summary)
    const preview = screen.getByLabelText('@FrostArc 提案预览')
    fireEvent.keyDown(preview, { key: 'Escape' })

    expect(screen.queryByLabelText('@FrostArc 提案预览')).toBeNull()
    expect(summary.getAttribute('aria-expanded')).toBe('false')
    expect(handlers.onAccept).not.toHaveBeenCalled()
    expect(handlers.onReject).not.toHaveBeenCalled()
    expect(handlers.onRedoFromCurrent).not.toHaveBeenCalled()
    await waitFor(() => expect(document.activeElement).toBe(summary))

    fireEvent.click(summary)
    fireEvent.click(screen.getByRole('button', { name: '离开提案预览' }))
    await waitFor(() => expect(document.activeElement).toBe(summary))
  })
})

function renderPanel(overrides: Partial<CardProposalPanelProps> = {}) {
  return render(<CardProposalPanel {...defaultProps(overrides)} />)
}

function defaultProps(overrides: Partial<CardProposalPanelProps> = {}): CardProposalPanelProps {
  return {
    documents: [],
    proposals: [],
    onPreviewUpdate: vi.fn(),
    onAccept: vi.fn(),
    onReject: vi.fn(),
    onRedoFromCurrent: vi.fn(),
    ...overrides,
  }
}

function cardDocument(
  id: string,
  name: string,
  graph: Partial<CardDocument['graph']> = {},
): CardDocument {
  return {
    schemaVersion: 2,
    card: {
      id,
      name,
      cost: 1,
      type: 'Attack',
      rarity: 'Common',
      description: `${name} 的描述`,
      keywords: ['Frost'],
    },
    graph: {
      id: `graph-${id}`,
      entityId: id,
      entityType: 'card',
      version: '0.1.0',
      nodes: graph.nodes ?? [],
      edges: graph.edges ?? [],
      metadata: {
        createdAt: NOW,
        updatedAt: NOW,
      },
    },
    generation: { lastGeneratedFingerprint: null },
  }
}

function triggerNode(id: string, x: number): CardDocument['graph']['nodes'][number] {
  return { id, type: 'trigger', position: { x, y: 10 }, data: { event: 'OnPlay' } }
}

function effectNode(id: string, amount = 8): CardDocument['graph']['nodes'][number] {
  return { id, type: 'effect', position: { x: 180, y: 10 }, data: { kind: 'damage', amount } }
}

function proposal(
  id: string,
  status: ConversationCardProposalStatus,
  candidate: CardDocument,
  operation: 'create' | 'update' = 'update',
): ConversationCardProposal {
  const events: ConversationProposalEvent[] = [{ id: `${id}-proposed`, type: 'proposed', at: NOW }]
  if (status === 'accepted' || status === 'reverted') {
    events.push({
      id: `${id}-accepted`,
      type: 'accepted',
      at: NOW,
      transactionId: `transaction-${id}`,
      finalCardId: candidate.card.id,
    })
  }
  if (status === 'rejected') {
    events.push({ id: `${id}-rejected`, type: 'rejected', at: NOW, feedback: null })
  }
  if (status === 'stale') {
    events.push({ id: `${id}-stale`, type: 'stale', at: NOW, observedRevision: 'new-revision' })
  }
  if (status === 'superseded') {
    events.push({ id: `${id}-superseded`, type: 'superseded', at: NOW, byProposalId: 'newer-proposal' })
  }
  if (status === 'reverted') {
    events.push({
      id: `${id}-reverted`,
      type: 'reverted',
      at: NOW,
      transactionId: `transaction-${id}`,
      document: candidate,
    })
  }
  return {
    id,
    operation,
    targetCardId: candidate.card.id,
    baseRevision: operation === 'update' ? 'base-revision' : null,
    document: candidate,
    status,
    provenance: { turnId: 'turn-1', attemptId: 'attempt-1' },
    projectReferences: [],
    events,
    createdAt: NOW,
    updatedAt: NOW,
  }
}
