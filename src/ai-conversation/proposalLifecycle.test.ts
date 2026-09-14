import { describe, expect, it } from 'vitest'
import { cardDocumentRevision } from '../card/cardAiProposal'
import type { ConversationCardProposalInput } from './conversationResponse'
import {
  acceptConversationCardProposal,
  markConversationProposalTransitionCommitted,
  markConversationCardProposalReverted,
  pendingProposalCardTransition,
  recordConversationCardProposalBatch,
  rejectConversationCardProposal,
  restoreConversationCardProposalAfterRedo,
} from './proposalLifecycle'

function document(id: string, references: string[] = []) {
  return {
    schemaVersion: 2 as const,
    card: { id, name: id, cost: 1, type: 'Attack' as const, rarity: 'Common' as const, description: '', keywords: [] },
    graph: {
      id: `graph-${id}`,
      entityId: id,
      entityType: 'card' as const,
      version: '0.1.0',
      nodes: references.map((cardId, index) => ({
        id: `effect-${index}`,
        type: 'effect' as const,
        position: { x: index, y: 0 },
        data: { kind: 'addCardToHand', cardId },
      })),
      edges: [],
      metadata: { createdAt: '2026-09-01T00:00:00Z', updatedAt: '2026-09-01T00:00:00Z' },
    },
    generation: { lastGeneratedFingerprint: null },
  }
}

function ids(...values: string[]) {
  let index = 0
  return () => values[index++] ?? `generated-${index}`
}

const source = { turnId: 'turn-1', attemptId: 'attempt-1' }

describe('Card proposal lifecycle', () => {
  it('逐 Card 登记一批 create/update，并仅把 revision 不匹配的修改标为 stale', () => {
    const drafts: ConversationCardProposalInput[] = [
      { operation: 'update', targetCardId: 'CardA', baseRevision: 'rev-a', document: document('CardA') },
      { operation: 'update', targetCardId: 'CardB', baseRevision: 'old-b', document: document('CardB') },
      { operation: 'create', document: document('SuggestedCard') },
    ]
    const result = recordConversationCardProposalBatch([], drafts, {
      source,
      at: '2026-09-01T00:00:00Z',
      currentCardRevisions: new Map([['CardA', 'rev-a'], ['CardB', 'rev-b']]),
      createId: ids('proposal-a', 'event-a', 'proposal-b', 'event-b', 'proposal-c', 'event-c'),
    })

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.value.map(proposal => [proposal.id, proposal.targetCardId, proposal.status])).toEqual([
      ['proposal-a', 'CardA', 'pending'],
      ['proposal-b', 'CardB', 'stale'],
      ['proposal-c', 'SuggestedCard', 'pending'],
    ])
    expect(result.value[0]).toMatchObject({
      provenance: source,
      createdAt: '2026-09-01T00:00:00Z',
      updatedAt: '2026-09-01T00:00:00Z',
      events: [{ id: 'event-a', type: 'proposed', at: '2026-09-01T00:00:00Z' }],
    })
    expect(result.value[1].events).toHaveLength(2)
    expect(result.value[1].events[1]).toMatchObject({ type: 'stale', observedRevision: 'rev-b' })
  })

  it('原子拒绝引用本批或历史中尚未接受的新 Card', () => {
    const first = recordConversationCardProposalBatch([], [{ operation: 'create', document: document('PendingNew') }], {
      source,
      at: '2026-09-01T00:00:00Z',
      currentCardRevisions: new Map(),
      createId: ids('proposal-old', 'event-old'),
    })
    if (!first.ok) throw new Error(first.error)

    const currentBatch = recordConversationCardProposalBatch(first.value, [
      { operation: 'create', document: document('AnotherNew') },
      { operation: 'update', targetCardId: 'Existing', baseRevision: 'rev', document: document('Existing', ['AnotherNew']) },
    ], {
      source: { turnId: 'turn-2', attemptId: 'attempt-2' },
      at: '2026-09-02T00:00:00Z',
      currentCardRevisions: new Map([['Existing', 'rev']]),
      createId: ids('proposal-new', 'event-new', 'proposal-update', 'event-update'),
    })
    expect(currentBatch).toEqual({ ok: false, error: 'unaccepted-card-reference' })
    expect(first.value[0].status).toBe('pending')

    const historical = recordConversationCardProposalBatch(first.value, [
      { operation: 'update', targetCardId: 'Existing', baseRevision: 'rev', document: document('Existing', ['PendingNew']) },
    ], {
      source: { turnId: 'turn-2', attemptId: 'attempt-2' },
      at: '2026-09-02T00:00:00Z',
      currentCardRevisions: new Map([['Existing', 'rev']]),
      createId: ids('proposal-update', 'event-update'),
    })
    expect(historical).toEqual({ ok: false, error: 'unaccepted-card-reference' })
  })

  it('pending 建议 ID 不遮蔽项目中后来出现的同名真实 Card', () => {
    const first = recordConversationCardProposalBatch([], [
      { operation: 'create', document: document('Foo') },
    ], {
      source,
      at: '2026-09-01T00:00:00Z',
      currentCardRevisions: new Map(),
      createId: ids('proposal-foo', 'event-foo'),
    })
    if (!first.ok) throw new Error(first.error)

    const next = recordConversationCardProposalBatch(first.value, [{
      operation: 'update',
      targetCardId: 'Existing',
      baseRevision: 'rev-existing',
      document: document('Existing', ['Foo']),
    }], {
      source: { turnId: 'turn-2', attemptId: 'attempt-2' },
      at: '2026-09-02T00:00:00Z',
      currentCardRevisions: new Map([
        ['Existing', 'rev-existing'],
        ['Foo', 'rev-real-foo'],
      ]),
      createId: ids('proposal-update', 'event-update'),
    })

    expect(next.ok).toBe(true)
    if (!next.ok) return
    expect(next.value.at(-1)?.projectReferences).toEqual([
      { cardId: 'Foo', revision: 'rev-real-foo' },
    ])
  })

  it('把已存在项目 Card 的跨 Card 引用及 revision 写入可重载验证记录', () => {
    const result = recordConversationCardProposalBatch([], [{
      operation: 'update',
      targetCardId: 'CardA',
      baseRevision: 'rev-a',
      document: document('CardA', ['CardB', 'CardB']),
    }], {
      source,
      at: '2026-09-01T00:00:00Z',
      currentCardRevisions: new Map([['CardA', 'rev-a'], ['CardB', 'rev-b']]),
      createId: ids('proposal-a', 'event-a'),
    })

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.value[0].projectReferences).toEqual([{ cardId: 'CardB', revision: 'rev-b' }])
  })

  it('同目标的新 pending 只取代旧 pending，不影响其他 Card 或 terminal 提案', () => {
    const first = recordConversationCardProposalBatch([], [
      { operation: 'update', targetCardId: 'CardA', baseRevision: 'rev-a', document: document('CardA') },
      { operation: 'update', targetCardId: 'CardB', baseRevision: 'rev-b', document: document('CardB') },
    ], {
      source,
      at: '2026-09-01T00:00:00Z',
      currentCardRevisions: new Map([['CardA', 'rev-a'], ['CardB', 'rev-b']]),
      createId: ids('old-a', 'event-old-a', 'old-b', 'event-old-b'),
    })
    if (!first.ok) throw new Error(first.error)
    const rejected = rejectConversationCardProposal(first.value[1], {
      at: '2026-09-01T01:00:00Z',
      eventId: 'reject-b',
      feedback: null,
    })
    if (!rejected.ok) throw new Error(rejected.error)

    const next = recordConversationCardProposalBatch([first.value[0], rejected.value], [
      { operation: 'update', targetCardId: 'CardA', baseRevision: 'rev-a', document: document('CardA') },
      { operation: 'update', targetCardId: 'CardB', baseRevision: 'rev-b', document: document('CardB') },
    ], {
      source: { turnId: 'turn-2', attemptId: 'attempt-2' },
      at: '2026-09-02T00:00:00Z',
      currentCardRevisions: new Map([['CardA', 'rev-a'], ['CardB', 'rev-b']]),
      createId: ids('new-a', 'event-new-a', 'new-b', 'event-new-b', 'supersede-a'),
    })

    expect(next.ok).toBe(true)
    if (!next.ok) return
    expect(next.value.map(proposal => [proposal.id, proposal.status])).toEqual([
      ['old-a', 'superseded'],
      ['old-b', 'rejected'],
      ['new-a', 'pending'],
      ['new-b', 'pending'],
    ])
    expect(next.value[0].events.at(-1)).toMatchObject({ type: 'superseded', byProposalId: 'new-a' })
  })

  it('新一轮提交时同步把已被用户编辑的旧 pending 修改标为 stale', () => {
    const first = recordConversationCardProposalBatch([], [
      { operation: 'update', targetCardId: 'CardA', baseRevision: 'rev-a', document: document('CardA') },
      { operation: 'update', targetCardId: 'CardB', baseRevision: 'rev-b', document: document('CardB') },
    ], {
      source,
      at: '2026-09-01T00:00:00Z',
      currentCardRevisions: new Map([['CardA', 'rev-a'], ['CardB', 'rev-b']]),
      createId: ids('old-a', 'proposed-a', 'old-b', 'proposed-b'),
    })
    if (!first.ok) throw new Error(first.error)

    const next = recordConversationCardProposalBatch(first.value, [], {
      source: { turnId: 'turn-2', attemptId: 'attempt-2' },
      at: '2026-09-02T00:00:00Z',
      currentCardRevisions: new Map([['CardA', 'rev-a-changed'], ['CardB', 'rev-b']]),
      createId: ids('stale-a'),
    })

    expect(next.ok).toBe(true)
    if (!next.ok) return
    expect(next.value.map(proposal => proposal.status)).toEqual(['stale', 'pending'])
    expect(next.value[0].events.at(-1)).toMatchObject({ type: 'stale', observedRevision: 'rev-a-changed' })
  })

  it('原子拒绝同一批中重复目标的多个候选', () => {
    const result = recordConversationCardProposalBatch([], [
      { operation: 'update', targetCardId: 'CardA', baseRevision: 'rev-a', document: document('CardA') },
      { operation: 'update', targetCardId: 'carda', baseRevision: 'rev-a', document: document('carda') },
    ], {
      source,
      at: '2026-09-01T00:00:00Z',
      currentCardRevisions: new Map([['CardA', 'rev-a']]),
      createId: ids('unused'),
    })
    expect(result).toEqual({ ok: false, error: 'invalid-proposal' })
  })

  it('拒绝是不可恢复终态，并永久保存可选结构化原因', () => {
    const proposal = pendingCreate()
    const rejected = rejectConversationCardProposal(proposal, {
      at: '2026-09-02T00:00:00Z',
      eventId: 'event-reject',
      feedback: { code: 'wrong-direction', note: '不要改变卡牌费用' },
    })
    expect(rejected.ok).toBe(true)
    if (!rejected.ok) return
    expect(rejected.value).toMatchObject({
      status: 'rejected',
      events: [
        { type: 'proposed' },
        { type: 'rejected', feedback: { code: 'wrong-direction', note: '不要改变卡牌费用' } },
      ],
    })
    expect(acceptConversationCardProposal(rejected.value, {
      at: '2026-09-03T00:00:00Z', eventId: 'accept', transactionId: 'tx', finalCardId: 'SuggestedCard',
      currentCardRevisions: new Map(),
    })).toEqual({ ok: false, error: 'proposal-not-pending' })
  })

  it('create 只在接受时校验并占用最终 ID，大小写冲突不会自动改名', () => {
    const proposal = pendingCreate()
    expect(acceptConversationCardProposal(proposal, {
      at: '2026-09-02T00:00:00Z', eventId: 'accept', transactionId: 'tx', finalCardId: 'bad_id',
      currentCardRevisions: new Map(),
    })).toEqual({ ok: false, error: 'invalid-card-id' })
    expect(acceptConversationCardProposal(proposal, {
      at: '2026-09-02T00:00:00Z', eventId: 'accept', transactionId: 'tx', finalCardId: 'NewCard',
      currentCardRevisions: new Map([['newcard', 'revision']]),
    })).toEqual({ ok: false, error: 'duplicate-card-id' })
    expect(proposal.status).toBe('pending')
  })

  it('用 committed 作为 Card transition WAL 的兑现标记，并按顺序恢复未完成 transition', () => {
    const base = document('CardA')
    const candidate = {
      ...document('CardA'),
      card: { ...document('CardA').card, name: 'Card A updated' },
    }
    const pending = pendingUpdate(base, candidate)
    const accepted = acceptConversationCardProposal(pending, {
      at: '2026-09-02T00:00:00Z', eventId: 'accept', transactionId: 'tx-1', finalCardId: 'CardA',
      currentCardRevisions: new Map([['CardA', cardDocumentRevision(base)]]),
    })
    if (!accepted.ok) throw new Error(accepted.error)

    expect(pendingProposalCardTransition(accepted.value)).toEqual({
      eventId: 'accept',
      transactionId: 'tx-1',
      desiredDocument: candidate,
      previousRevision: cardDocumentRevision(base),
      allowMissing: false,
    })
    expect(markConversationCardProposalReverted(accepted.value, {
      at: '2026-09-03T00:00:00Z', eventId: 'undo-too-early', transactionId: 'tx-1', document: base,
    })).toEqual({ ok: false, error: 'transition-not-committed' })

    const acceptedCommitted = markConversationProposalTransitionCommitted(accepted.value, {
      at: '2026-09-02T00:00:01Z', eventId: 'accept-committed', transitionEventId: 'accept', transactionId: 'tx-1',
    })
    if (!acceptedCommitted.ok) throw new Error(acceptedCommitted.error)
    expect(acceptedCommitted.value.status).toBe('accepted')
    expect(pendingProposalCardTransition(acceptedCommitted.value)).toBeNull()

    const reverted = markConversationCardProposalReverted(acceptedCommitted.value, {
      at: '2026-09-03T00:00:00Z', eventId: 'undo', transactionId: 'tx-1', document: base,
    })
    if (!reverted.ok) throw new Error(reverted.error)
    expect(reverted.value.status).toBe('reverted')
    expect(pendingProposalCardTransition(reverted.value)).toEqual({
      eventId: 'undo',
      transactionId: 'tx-1',
      desiredDocument: base,
      previousRevision: cardDocumentRevision(candidate),
      allowMissing: false,
    })

    const revertedCommitted = markConversationProposalTransitionCommitted(reverted.value, {
      at: '2026-09-03T00:00:01Z', eventId: 'undo-committed', transitionEventId: 'undo', transactionId: 'tx-1',
    })
    if (!revertedCommitted.ok) throw new Error(revertedCommitted.error)
    const restored = restoreConversationCardProposalAfterRedo(revertedCommitted.value, {
      at: '2026-09-04T00:00:00Z', eventId: 'redo', transactionId: 'tx-1', document: candidate,
    })
    expect(restored.ok).toBe(true)
    if (!restored.ok) return
    expect(restored.value.status).toBe('accepted')
    expect(restored.value.events.at(-1)).toEqual({
      id: 'redo', type: 'restored', at: '2026-09-04T00:00:00Z', transactionId: 'tx-1', document: candidate,
    })
    expect(pendingProposalCardTransition(restored.value)).toEqual({
      eventId: 'redo',
      transactionId: 'tx-1',
      desiredDocument: candidate,
      previousRevision: cardDocumentRevision(base),
      allowMissing: false,
    })
  })

  it('create accepted 的 WAL 保留候选 ID，由 application 层 rekey', () => {
    const accepted = acceptConversationCardProposal(pendingCreate(), {
      at: '2026-09-02T00:00:00Z', eventId: 'accept', transactionId: 'tx-create', finalCardId: 'FinalCard',
      currentCardRevisions: new Map(),
    })
    if (!accepted.ok) throw new Error(accepted.error)

    expect(pendingProposalCardTransition(accepted.value)).toEqual({
      eventId: 'accept',
      transactionId: 'tx-create',
      desiredDocument: document('SuggestedCard'),
      previousRevision: null,
      allowMissing: true,
    })
  })

  it('undo/redo 必须携带目标 Card 的严格快照和正确 revision', () => {
    const base = document('CardA')
    const candidate = { ...document('CardA'), card: { ...document('CardA').card, name: 'Updated' } }
    const accepted = acceptConversationCardProposal(pendingUpdate(base, candidate), {
      at: '2026-09-02T00:00:00Z', eventId: 'accept', transactionId: 'tx-1', finalCardId: 'CardA',
      currentCardRevisions: new Map([['CardA', cardDocumentRevision(base)]]),
    })
    if (!accepted.ok) throw new Error(accepted.error)
    const committed = markConversationProposalTransitionCommitted(accepted.value, {
      at: '2026-09-02T00:00:01Z', eventId: 'commit', transitionEventId: 'accept', transactionId: 'tx-1',
    })
    if (!committed.ok) throw new Error(committed.error)

    expect(markConversationCardProposalReverted(committed.value, {
      at: '2026-09-03T00:00:00Z', eventId: 'bad-revision', transactionId: 'tx-1', document: candidate,
    })).toEqual({ ok: false, error: 'invalid-proposal' })
    expect(markConversationCardProposalReverted(committed.value, {
      at: '2026-09-03T00:00:00Z', eventId: 'bad-generation', transactionId: 'tx-1',
      document: {
        ...base,
        generation: { lastGeneratedFingerprint: { sourceHash: 's', generatorVersion: 'g', artifactHash: 'a' } },
      },
    })).toEqual({ ok: false, error: 'invalid-proposal' })
  })
})

function pendingCreate() {
  const result = recordConversationCardProposalBatch([], [{ operation: 'create', document: document('SuggestedCard') }], {
    source,
    at: '2026-09-01T00:00:00Z',
    currentCardRevisions: new Map(),
    createId: ids('proposal-create', 'event-create'),
  })
  if (!result.ok) throw new Error(result.error)
  return result.value[0]
}

function pendingUpdate(base: ReturnType<typeof document>, candidate: ReturnType<typeof document>) {
  const result = recordConversationCardProposalBatch([], [{
    operation: 'update',
    targetCardId: base.card.id,
    baseRevision: cardDocumentRevision(base),
    document: candidate,
  }], {
    source,
    at: '2026-09-01T00:00:00Z',
    currentCardRevisions: new Map([[base.card.id, cardDocumentRevision(base)]]),
    createId: ids('proposal-update', 'event-proposed'),
  })
  if (!result.ok) throw new Error(result.error)
  return result.value[0]
}
