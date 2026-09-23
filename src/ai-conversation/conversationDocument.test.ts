import { describe, expect, it } from 'vitest'
import { cardDocumentRevision } from '../card/cardAiProposal'
import { createConversationDocument, migrateConversationDocument, parseConversationDocument, MAX_ROLLING_SUMMARY_CODE_POINTS, type ConversationDocument } from './conversationDocument'

const diagnostics = { provider: 'qwen', model: 'qwen-turbo', requestId: 'request-1' }

function cardDocument(id: string, references: string[] = []) {
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

function validDocument(): ConversationDocument {
  return {
    ...createConversationDocument('2026-09-01T00:00:00Z'),
    turns: [{
      id: 'turn-1',
      userText: '继续',
      assistantText: null,
      quickReplies: [],
      quickReplySelection: null,
      attachments: [{ cardId: 'card-1', revision: 'rev-1' }],
      contextSnapshot: null,
      attempts: [{
        id: 'attempt-1',
        status: 'failed',
        startedAt: '2026-09-01T00:00:00Z',
        finishedAt: '2026-09-01T00:01:00Z',
        error: '超时',
        failureKind: 'timeout',
        diagnostics,
      }],
      createdAt: '2026-09-01T00:00:00Z',
    }],
  }
}

describe('parseConversationDocument', () => {
  it('接受严格的当前 v4 文档并提供迁移入口', () => {
    const document = validDocument()
    expect(parseConversationDocument(document)).toEqual({ ok: true, document })
    expect(migrateConversationDocument(document)).toEqual({ ok: true, document, migrated: false })
  })

  it.each([
    (document: ConversationDocument) => ({ ...document, unknown: true }),
    (document: ConversationDocument) => ({ ...document, turns: [{ ...document.turns[0], unknown: true }] }),
    (document: ConversationDocument) => ({ ...document, turns: [{ ...document.turns[0], quickReplies: [{ id: 'yes', label: '继续', unknown: true }] }] }),
    (document: ConversationDocument) => ({ ...document, turns: [{ ...document.turns[0], quickReplySelection: { turnId: 'x', replyId: 'x', unknown: true } }] }),
    (document: ConversationDocument) => ({ ...document, turns: [{ ...document.turns[0], attachments: [{ cardId: 'card-1', revision: 'rev-1', unknown: true }] }] }),
    (document: ConversationDocument) => ({ ...document, turns: [{ ...document.turns[0], attempts: [{ ...document.turns[0].attempts[0], unknown: true }] }] }),
    (document: ConversationDocument) => ({ ...document, turns: [{ ...document.turns[0], attempts: [{ ...document.turns[0].attempts[0], diagnostics: { ...diagnostics, unknown: true } }] }] }),
  ])('逐层拒绝未知字段 %#', mutate => {
    expect(parseConversationDocument(mutate(validDocument())).ok).toBe(false)
  })

  it("严格校验 rollingSummary 长度、时间和 completed provenance", () => {
    const current = validDocument()
    const originalTurn = current.turns[0]
    const completedTurn = {
      ...originalTurn,
      assistantText: "已完成",
      attempts: [{ ...originalTurn.attempts[0], status: "completed" as const, error: null, failureKind: null, finishedAt: "2026-09-01T00:02:00Z" }],
    }
    const summary = { throughTurnId: "turn-1", text: "玩家偏好高机动性。", updatedAt: "2026-09-01T00:03:00Z" }
    const valid = { ...current, turns: [completedTurn], rollingSummary: summary }
    expect(parseConversationDocument(valid)).toEqual({ ok: true, document: valid })

    const invalidSummaries = [
      { ...summary, unknown: true },
      (({ updatedAt: _updatedAt, ...missing }) => missing)(summary),
      { ...summary, throughTurnId: "missing" },
      { ...summary, text: "  " },
      { ...summary, text: "x".repeat(MAX_ROLLING_SUMMARY_CODE_POINTS + 1) },
      { ...summary, updatedAt: "not-a-time" },
      { ...summary, updatedAt: "2026-09-01T00:01:00Z" },
    ]
    for (const rollingSummary of invalidSummaries) {
      expect(parseConversationDocument({ ...valid, rollingSummary }).ok).toBe(false)
    }
    expect(parseConversationDocument({ ...current, rollingSummary: summary }).ok).toBe(false)
  })

  it("将严格 v3 文档迁移到 v4 并补充空 summary", () => {
    const current = validDocument()
    const { rollingSummary: _rollingSummary, ...withoutSummary } = current
    const v3 = { ...withoutSummary, schemaVersion: 3 }
    expect(parseConversationDocument(v3).ok).toBe(false)
    expect(migrateConversationDocument(v3)).toEqual({ ok: true, document: current, migrated: true })
    expect(migrateConversationDocument({ ...v3, unknown: true }).ok).toBe(false)
  })


  it('v3 migration 为旧上下文快照补充空 providedCards provenance', () => {
    const current = validDocument()
    const oldSnapshot = {
      directoryTier: 'detailed',
      contextWindowTokens: 32000,
      reservedOutputTokens: 2048,
      reservedExpansionTokens: 4096,
      estimatedInputTokens: 12000,
      estimatedTotalTokens: 18144,
      omittedMessageCount: 0,
      includedTurnIds: ['turn-1'],
    }
    const { rollingSummary: _rollingSummary, ...withoutSummary } = current
    const v3 = {
      ...withoutSummary,
      schemaVersion: 3,
      turns: [{ ...current.turns[0], contextSnapshot: oldSnapshot }],
    }
    const migrated = migrateConversationDocument(v3)
    expect(migrated.ok).toBe(true)
    if (migrated.ok) expect(migrated.document.turns[0].contextSnapshot?.providedCards).toEqual([])
  })

  it("将严格 v2 文档迁移到 v4 并保持解析结果稳定", () => {
    const current = validDocument()
    const { rollingSummary: _rollingSummary, ...currentWithoutSummary } = current
    const v2 = {
      ...currentWithoutSummary,
      schemaVersion: 2,
      turns: current.turns.map(({ contextSnapshot: _snapshot, ...turn }) => turn),
    }
    const migrated = migrateConversationDocument(v2)
    expect(migrated).toEqual({ ok: true, document: current, migrated: true })
    if (migrated.ok) expect(migrateConversationDocument(migrated.document)).toEqual({ ok: true, document: current, migrated: false })

    const malformedV2 = { ...v2, turns: [{ ...v2.turns[0], unknown: true }] }
    expect(migrateConversationDocument(malformedV2).ok).toBe(false)
  })

  it("严格校验 contextSnapshot 字段、数值与 turn ID", () => {
    const document = validDocument()
    const snapshot = {
      directoryTier: "detailed" as const,
      contextWindowTokens: 32000,
      reservedOutputTokens: 2048,
      reservedExpansionTokens: 4096,
      estimatedInputTokens: 12000,
      estimatedTotalTokens: 18144,
      omittedMessageCount: 2,
      includedTurnIds: ["turn-1"],
      providedCards: [],
    }
    const withSnapshot = { ...document, turns: [{ ...document.turns[0], contextSnapshot: snapshot }] }
    expect(parseConversationDocument(withSnapshot)).toEqual({ ok: true, document: withSnapshot })

    const invalidSnapshots = [
      { ...snapshot, unknown: true },
      { ...snapshot, directoryTier: "wide" },
      { ...snapshot, contextWindowTokens: 0 },
      { ...snapshot, estimatedInputTokens: Number.NaN },
      { ...snapshot, reservedOutputTokens: -1 },
      { ...snapshot, includedTurnIds: ["turn-1", "turn-1"] },
      { ...snapshot, estimatedTotalTokens: snapshot.estimatedTotalTokens - 1 },
      { ...snapshot, contextWindowTokens: snapshot.estimatedTotalTokens - 1 },
      { ...snapshot, includedTurnIds: [] },
    ]
    for (const contextSnapshot of invalidSnapshots) {
      expect(parseConversationDocument({ ...document, turns: [{ ...document.turns[0], contextSnapshot }] }).ok).toBe(false)
    }
    const { contextSnapshot: _missing, ...turnWithoutSnapshot } = document.turns[0]
    expect(parseConversationDocument({ ...document, turns: [turnWithoutSnapshot] }).ok).toBe(false)
  })

  it('迁移 bb5f191 的带 projectPath v1 文档', () => {
    const legacy = {
      schemaVersion: 1,
      projectPath: '/legacy-project',
      createdAt: '2026-09-01T00:00:00Z',
      updatedAt: '2026-09-01T00:01:00Z',
      turns: [{
        id: 'turn-1', userText: '继续', assistantText: null, quickReplies: [], attachments: [], createdAt: '2026-09-01T00:00:00Z',
        attempts: [{
          id: 'attempt-1', status: 'failed', startedAt: '2026-09-01T00:00:00Z', finishedAt: '2026-09-01T00:01:00Z',
          error: `apiKey=sk-legacy-secret ${'x'.repeat(600)}`,
        }],
      }],
    }
    const result = migrateConversationDocument(legacy)
    expect(result).toMatchObject({ ok: true, migrated: true })
    if (!result.ok) throw new Error(result.reason)
    expect(result.document).toMatchObject({ schemaVersion: 4, proposals: [], rollingSummary: null })
    expect(result.document).not.toHaveProperty('projectPath')
    expect(result.document.turns[0]).toMatchObject({ quickReplySelection: null, contextSnapshot: null })
    expect(result.document.turns[0].attempts[0]).toMatchObject({ failureKind: 'provider', diagnostics: { provider: 'unknown', model: 'unknown', requestId: 'unknown' } })
    expect(result.document.turns[0].attempts[0].error).not.toContain('sk-legacy-secret')
    expect(result.document.turns[0].attempts[0].error!.length).toBeLessThanOrEqual(500)
  })

  it('把 PR1 严格 v1 文档迁移为 proposals 为空的 v4', () => {
    const current = validDocument()
    const strictV1 = {
      schemaVersion: 1,
      turns: current.turns.map(({ contextSnapshot: _snapshot, ...turn }) => turn),
      createdAt: current.createdAt,
      updatedAt: current.updatedAt,
    }

    expect(migrateConversationDocument(strictV1)).toEqual({
      ok: true,
      migrated: true,
      document: { ...strictV1, schemaVersion: 4, proposals: [], rollingSummary: null, turns: strictV1.turns.map(turn => ({ ...turn, contextSnapshot: null })) },
    })
  })

  it('严格解析提案，并允许 provenance 指向失败后成功的 completed attempt', () => {
    const document = validDocument()
    const completedAttempt = {
      ...document.turns[0].attempts[0],
      id: 'attempt-2',
      status: 'completed' as const,
      error: null,
      failureKind: null,
      finishedAt: '2026-09-01T00:02:00Z',
    }
    const proposal = {
      id: 'proposal-1',
      operation: 'create' as const,
      targetCardId: 'NewCard',
      baseRevision: null,
      document: cardDocument('NewCard'),
      status: 'pending' as const,
      provenance: { turnId: 'turn-1', attemptId: 'attempt-2' },
      projectReferences: [],
      events: [{ id: 'event-1', type: 'proposed' as const, at: '2026-09-01T00:02:00Z' }],
      createdAt: '2026-09-01T00:02:00Z',
      updatedAt: '2026-09-01T00:02:00Z',
    }
    const withProposal: ConversationDocument = {
      ...document,
      turns: [{ ...document.turns[0], assistantText: '已生成提案', attempts: [...document.turns[0].attempts, completedAttempt] }],
      proposals: [proposal],
    }

    expect(parseConversationDocument(withProposal)).toEqual({ ok: true, document: withProposal })
    expect(parseConversationDocument({
      ...withProposal,
      proposals: [{ ...proposal, provenance: { turnId: 'turn-1', attemptId: 'attempt-1' } }],
    })).toMatchObject({ ok: false, reason: '提案 provenance 必须引用同一轮次中已完成的 attempt' })
    expect(parseConversationDocument({
      ...withProposal,
      proposals: [{ ...proposal, provenance: { turnId: 'missing', attemptId: 'attempt-2' } }],
    })).toMatchObject({ ok: false, reason: '提案 provenance 必须引用同一轮次中已完成的 attempt' })
  })

  it('拒绝提案和事件未知字段及跨提案重复 ID', () => {
    const document = validDocument()
    const completedAttempt = {
      ...document.turns[0].attempts[0],
      id: 'attempt-2',
      status: 'completed' as const,
      error: null,
      failureKind: null,
    }
    const proposal = {
      id: 'proposal-1',
      operation: 'create' as const,
      targetCardId: 'NewCard',
      baseRevision: null,
      document: cardDocument('NewCard'),
      status: 'pending' as const,
      provenance: { turnId: 'turn-1', attemptId: 'attempt-2' },
      projectReferences: [],
      events: [{ id: 'event-1', type: 'proposed' as const, at: '2026-09-01T00:02:00Z' }],
      createdAt: '2026-09-01T00:02:00Z',
      updatedAt: '2026-09-01T00:02:00Z',
    }
    const base = {
      ...document,
      turns: [{ ...document.turns[0], assistantText: '完成', attempts: [...document.turns[0].attempts, completedAttempt] }],
      proposals: [proposal],
    }

    expect(parseConversationDocument({ ...base, proposals: [{ ...proposal, unknown: true }] }).ok).toBe(false)
    expect(parseConversationDocument({
      ...base,
      proposals: [{ ...proposal, events: [{ ...proposal.events[0], unknown: true }] }],
    }).ok).toBe(false)
    expect(parseConversationDocument({
      ...base,
      proposals: [proposal, { ...proposal, id: 'proposal-2', targetCardId: 'OtherCard', document: cardDocument('OtherCard') }],
    })).toMatchObject({ ok: false, reason: '提案和事件 ID 必须在文档内全局唯一' })
    expect(parseConversationDocument({
      ...base,
      proposals: [{ ...proposal, id: 'event-1' }],
    })).toMatchObject({ ok: false, reason: '提案和事件 ID 必须在文档内全局唯一' })
  })

  it('拒绝同操作、同目标的多个大小写冲突 pending 提案', () => {
    const document = validDocument()
    const completedAttempt = {
      ...document.turns[0].attempts[0],
      id: 'attempt-2',
      status: 'completed' as const,
      error: null,
      failureKind: null,
    }
    const proposal = {
      id: 'proposal-1',
      operation: 'create' as const,
      targetCardId: 'NewCard',
      baseRevision: null,
      document: cardDocument('NewCard'),
      status: 'pending' as const,
      provenance: { turnId: 'turn-1', attemptId: 'attempt-2' },
      projectReferences: [],
      events: [{ id: 'event-1', type: 'proposed' as const, at: '2026-09-01T00:02:00Z' }],
      createdAt: '2026-09-01T00:02:00Z',
      updatedAt: '2026-09-01T00:02:00Z',
    }
    const second = {
      ...proposal,
      id: 'proposal-2',
      targetCardId: 'NEWCARD',
      document: cardDocument('NEWCARD'),
      events: [{ id: 'event-2', type: 'proposed' as const, at: '2026-09-01T00:03:00Z' }],
      createdAt: '2026-09-01T00:03:00Z',
      updatedAt: '2026-09-01T00:03:00Z',
    }
    const input = {
      ...document,
      turns: [{ ...document.turns[0], assistantText: '已生成提案', attempts: [...document.turns[0].attempts, completedAttempt] }],
      proposals: [proposal, second],
    }

    expect(parseConversationDocument(input)).toMatchObject({
      ok: false,
      reason: '同操作、同目标只能有一个 pending 提案',
    })
  })

  it('accepted update 的最终 Card ID 必须等于原目标 ID', () => {
    const document = validDocument()
    const completedAttempt = {
      ...document.turns[0].attempts[0],
      id: 'attempt-2',
      status: 'completed' as const,
      error: null,
      failureKind: null,
    }
    const input = {
      ...document,
      turns: [{ ...document.turns[0], assistantText: '已生成提案', attempts: [...document.turns[0].attempts, completedAttempt] }],
      proposals: [{
        id: 'proposal-1',
        operation: 'update',
        targetCardId: 'TargetCard',
        baseRevision: 'rev-1',
        document: cardDocument('TargetCard'),
        status: 'accepted',
        provenance: { turnId: 'turn-1', attemptId: 'attempt-2' },
      projectReferences: [],
        events: [
          { id: 'event-1', type: 'proposed', at: '2026-09-01T00:02:00Z' },
          { id: 'event-2', type: 'accepted', at: '2026-09-01T00:03:00Z', transactionId: 'tx-1', finalCardId: 'OtherCard' },
        ],
        createdAt: '2026-09-01T00:02:00Z',
        updatedAt: '2026-09-01T00:03:00Z',
      }],
    }

    expect(parseConversationDocument(input)).toMatchObject({ ok: false, reason: 'Card 提案或事件字段无效' })
  })

  it('重启加载时仍拒绝其他提案引用尚未接受的 create Card', () => {
    const document = validDocument()
    const completedAttempt = {
      ...document.turns[0].attempts[0],
      id: 'attempt-2',
      status: 'completed' as const,
      error: null,
      failureKind: null,
    }
    const proposedAt = '2026-09-01T00:02:00Z'
    const dependentAt = '2026-09-01T00:03:00Z'
    const pendingCreate = {
      id: 'proposal-create',
      operation: 'create' as const,
      targetCardId: 'NewCard',
      baseRevision: null,
      document: cardDocument('NewCard'),
      status: 'pending' as const,
      provenance: { turnId: 'turn-1', attemptId: 'attempt-2' },
      projectReferences: [],
      events: [{ id: 'event-create', type: 'proposed' as const, at: proposedAt }],
      createdAt: proposedAt,
      updatedAt: proposedAt,
    }
    const dependent = {
      id: 'proposal-dependent',
      operation: 'update' as const,
      targetCardId: 'ExistingCard',
      baseRevision: 'rev-existing',
      document: cardDocument('ExistingCard', ['NEWCARD']),
      status: 'pending' as const,
      provenance: { turnId: 'turn-1', attemptId: 'attempt-2' },
      projectReferences: [],
      events: [{ id: 'event-dependent', type: 'proposed' as const, at: dependentAt }],
      createdAt: dependentAt,
      updatedAt: dependentAt,
    }
    const input = {
      ...document,
      turns: [{ ...document.turns[0], assistantText: '已生成提案', attempts: [...document.turns[0].attempts, completedAttempt] }],
      proposals: [pendingCreate, dependent],
    }

    expect(parseConversationDocument(input)).toMatchObject({
      ok: false,
      reason: '提案的项目 Card 引用验证记录无效',
    })
  })

  it('历史建议 ID 不占用命名：拒绝 Foo 后可引用后来真实创建的 Foo', () => {
    const document = validDocument()
    const completedAttempt = {
      ...document.turns[0].attempts[0],
      id: 'attempt-2',
      status: 'completed' as const,
      error: null,
      failureKind: null,
    }
    const create = {
      id: 'proposal-create',
      operation: 'create' as const,
      targetCardId: 'NewCard',
      baseRevision: null,
      document: cardDocument('NewCard'),
      status: 'rejected' as const,
      provenance: { turnId: 'turn-1', attemptId: 'attempt-2' },
      projectReferences: [],
      events: [
        { id: 'event-create', type: 'proposed' as const, at: '2026-09-01T00:02:00Z' },
        { id: 'event-reject', type: 'rejected' as const, at: '2026-09-01T00:02:20Z', feedback: null },
      ],
      createdAt: '2026-09-01T00:02:00Z',
      updatedAt: '2026-09-01T00:02:20Z',
    }
    const dependent = {
      id: 'proposal-dependent',
      operation: 'update' as const,
      targetCardId: 'ExistingCard',
      baseRevision: 'rev-existing',
      document: cardDocument('ExistingCard', ['NewCard']),
      status: 'pending' as const,
      provenance: { turnId: 'turn-1', attemptId: 'attempt-2' },
      projectReferences: [{ cardId: 'NewCard', revision: 'rev-real-new-card' }],
      events: [{ id: 'event-dependent', type: 'proposed' as const, at: '2026-09-01T00:03:00Z' }],
      createdAt: '2026-09-01T00:03:00Z',
      updatedAt: '2026-09-01T00:03:00Z',
    }
    const base = {
      ...document,
      turns: [{ ...document.turns[0], assistantText: '已生成提案', attempts: [...document.turns[0].attempts, completedAttempt] }],
      proposals: [create, dependent],
    }

    expect(parseConversationDocument(base).ok).toBe(true)
  })

  it('严格解析 accepted→committed→reverted→committed→restored WAL，且允许末尾 transition 待恢复', () => {
    const document = validDocument()
    const completedAttempt = {
      ...document.turns[0].attempts[0],
      id: 'attempt-2',
      status: 'completed' as const,
      error: null,
      failureKind: null,
    }
    const baseCard = cardDocument('TargetCard')
    const candidate = { ...cardDocument('TargetCard'), card: { ...cardDocument('TargetCard').card, name: 'Updated' } }
    const proposal = {
      id: 'proposal-wal',
      operation: 'update' as const,
      targetCardId: 'TargetCard',
      baseRevision: cardDocumentRevision(baseCard),
      document: candidate,
      status: 'accepted' as const,
      provenance: { turnId: 'turn-1', attemptId: 'attempt-2' },
      projectReferences: [],
      events: [
        { id: 'event-proposed', type: 'proposed' as const, at: '2026-09-01T00:02:00Z' },
        { id: 'event-accepted', type: 'accepted' as const, at: '2026-09-01T00:03:00Z', transactionId: 'tx-1', finalCardId: 'TargetCard' },
        { id: 'event-accept-committed', type: 'committed' as const, at: '2026-09-01T00:03:01Z', transactionId: 'tx-1', transitionEventId: 'event-accepted' },
        { id: 'event-reverted', type: 'reverted' as const, at: '2026-09-01T00:04:00Z', transactionId: 'tx-1', document: baseCard },
        { id: 'event-revert-committed', type: 'committed' as const, at: '2026-09-01T00:04:01Z', transactionId: 'tx-1', transitionEventId: 'event-reverted' },
        { id: 'event-restored', type: 'restored' as const, at: '2026-09-01T00:05:00Z', transactionId: 'tx-1', document: candidate },
      ],
      createdAt: '2026-09-01T00:02:00Z',
      updatedAt: '2026-09-01T00:05:00Z',
    }
    const input = {
      ...document,
      turns: [{ ...document.turns[0], assistantText: '已生成提案', attempts: [...document.turns[0].attempts, completedAttempt] }],
      proposals: [proposal],
    }

    expect(parseConversationDocument(input)).toEqual({ ok: true, document: input })
  })

  it.each([
    (events: any[]) => events.map(event => event.type === 'committed' && event.id === 'event-accept-committed'
      ? { ...event, transitionEventId: 'event-missing' }
      : event),
    (events: any[]) => events.map(event => event.type === 'committed' && event.id === 'event-accept-committed'
      ? { ...event, transactionId: 'tx-other' }
      : event),
    (events: any[]) => events.filter(event => event.id !== 'event-accept-committed'),
    (events: any[]) => events.map(event => event.type === 'reverted'
      ? { ...event, document: { ...event.document, unknown: true } }
      : event),
    (events: any[]) => events.map(event => event.type === 'reverted'
      ? { ...event, document: cardDocument('OtherCard') }
      : event),
    (events: any[]) => events.map(event => event.type === 'reverted'
      ? { ...event, document: { ...event.document, card: { ...event.document.card, name: 'wrong revision' } } }
      : event),
    (events: any[]) => events.map(event => event.type === 'restored'
      ? { ...event, document: { ...event.document, generation: { lastGeneratedFingerprint: { sourceHash: 's', generatorVersion: 'g', artifactHash: 'a' } } } }
      : event),
  ])('拒绝 committed 引用/事务/顺序错误或 transition 非严格快照 %#', mutateEvents => {
    const document = validDocument()
    const completedAttempt = {
      ...document.turns[0].attempts[0], id: 'attempt-2', status: 'completed' as const, error: null, failureKind: null,
    }
    const baseCard = cardDocument('TargetCard')
    const candidate = { ...cardDocument('TargetCard'), card: { ...cardDocument('TargetCard').card, name: 'Updated' } }
    const events = [
      { id: 'event-proposed', type: 'proposed', at: '2026-09-01T00:02:00Z' },
      { id: 'event-accepted', type: 'accepted', at: '2026-09-01T00:03:00Z', transactionId: 'tx-1', finalCardId: 'TargetCard' },
      { id: 'event-accept-committed', type: 'committed', at: '2026-09-01T00:03:01Z', transactionId: 'tx-1', transitionEventId: 'event-accepted' },
      { id: 'event-reverted', type: 'reverted', at: '2026-09-01T00:04:00Z', transactionId: 'tx-1', document: baseCard },
      { id: 'event-revert-committed', type: 'committed', at: '2026-09-01T00:04:01Z', transactionId: 'tx-1', transitionEventId: 'event-reverted' },
      { id: 'event-restored', type: 'restored', at: '2026-09-01T00:05:00Z', transactionId: 'tx-1', document: candidate },
    ]
    const proposal = {
      id: 'proposal-wal', operation: 'update', targetCardId: 'TargetCard', baseRevision: cardDocumentRevision(baseCard),
      document: candidate, status: 'accepted', provenance: { turnId: 'turn-1', attemptId: 'attempt-2' },
      projectReferences: [],
      events: mutateEvents(events), createdAt: '2026-09-01T00:02:00Z', updatedAt: '2026-09-01T00:05:00Z',
    }
    const input = {
      ...document,
      turns: [{ ...document.turns[0], assistantText: '已生成提案', attempts: [...document.turns[0].attempts, completedAttempt] }],
      proposals: [proposal],
    }

    expect(parseConversationDocument(input).ok).toBe(false)
  })

  it('拒绝时间倒退的提案事件历史', () => {
    const document = validDocument()
    const completedAttempt = {
      ...document.turns[0].attempts[0],
      id: 'attempt-2',
      status: 'completed' as const,
      error: null,
      failureKind: null,
    }
    const input = {
      ...document,
      turns: [{ ...document.turns[0], assistantText: '已生成提案', attempts: [...document.turns[0].attempts, completedAttempt] }],
      proposals: [{
        id: 'proposal-1',
        operation: 'create',
        targetCardId: 'NewCard',
        baseRevision: null,
        document: cardDocument('NewCard'),
        status: 'rejected',
        provenance: { turnId: 'turn-1', attemptId: 'attempt-2' },
      projectReferences: [],
        events: [
          { id: 'event-1', type: 'proposed', at: '2026-09-01T00:03:00Z' },
          { id: 'event-2', type: 'rejected', at: '2026-09-01T00:02:00Z', feedback: null },
        ],
        createdAt: '2026-09-01T00:03:00Z',
        updatedAt: '2026-09-01T00:02:00Z',
      }],
    }

    expect(parseConversationDocument(input)).toMatchObject({ ok: false, reason: 'Card 提案或事件字段无效' })
  })

  it('superseded 只能指向同目标、已存在且不早于旧提案的真实替代提案', () => {
    const document = validDocument()
    const completedAttempt = {
      ...document.turns[0].attempts[0],
      id: 'attempt-2',
      status: 'completed' as const,
      error: null,
      failureKind: null,
    }
    const oldProposal = {
      id: 'proposal-old',
      operation: 'update' as const,
      targetCardId: 'TargetCard',
      baseRevision: 'rev-1',
      document: cardDocument('TargetCard'),
      status: 'superseded' as const,
      provenance: { turnId: 'turn-1', attemptId: 'attempt-2' },
      projectReferences: [],
      events: [
        { id: 'event-old', type: 'proposed' as const, at: '2026-09-01T00:02:00Z' },
        { id: 'event-superseded', type: 'superseded' as const, at: '2026-09-01T00:03:00Z', byProposalId: 'proposal-new' },
      ],
      createdAt: '2026-09-01T00:02:00Z',
      updatedAt: '2026-09-01T00:03:00Z',
    }
    const newProposal = {
      id: 'proposal-new',
      operation: 'update' as const,
      targetCardId: 'TargetCard',
      baseRevision: 'rev-1',
      document: cardDocument('TargetCard'),
      status: 'pending' as const,
      provenance: { turnId: 'turn-1', attemptId: 'attempt-2' },
      projectReferences: [],
      events: [{ id: 'event-new', type: 'proposed' as const, at: '2026-09-01T00:03:00Z' }],
      createdAt: '2026-09-01T00:03:00Z',
      updatedAt: '2026-09-01T00:03:00Z',
    }
    const base = {
      ...document,
      turns: [{ ...document.turns[0], assistantText: '已生成提案', attempts: [...document.turns[0].attempts, completedAttempt] }],
      proposals: [oldProposal, newProposal],
    }

    expect(parseConversationDocument(base).ok).toBe(true)
    const olderReplacement = {
      ...newProposal,
      events: [{ ...newProposal.events[0], at: '2026-09-01T00:01:00Z' }],
      createdAt: '2026-09-01T00:01:00Z',
      updatedAt: '2026-09-01T00:01:00Z',
    }
    expect(parseConversationDocument({ ...base, proposals: [oldProposal, olderReplacement] })).toMatchObject({
      ok: false,
      reason: 'superseded 事件引用无效',
    })
    const futureReplacement = {
      ...newProposal,
      events: [{ ...newProposal.events[0], at: '2026-09-01T00:04:00Z' }],
      createdAt: '2026-09-01T00:04:00Z',
      updatedAt: '2026-09-01T00:04:00Z',
    }
    expect(parseConversationDocument({ ...base, proposals: [oldProposal, futureReplacement] })).toMatchObject({
      ok: false,
      reason: 'superseded 事件引用无效',
    })
    const otherTarget = {
      ...newProposal,
      targetCardId: 'OtherCard',
      document: cardDocument('OtherCard'),
    }
    expect(parseConversationDocument({ ...base, proposals: [oldProposal, otherTarget] })).toMatchObject({
      ok: false,
      reason: 'superseded 事件引用无效',
    })
  })

  it('拒绝 superseded 提案之间的循环引用', () => {
    const document = validDocument()
    const completedAttempt = {
      ...document.turns[0].attempts[0],
      id: 'attempt-2',
      status: 'completed' as const,
      error: null,
      failureKind: null,
    }
    const proposal = (id: string, eventPrefix: string, byProposalId: string) => ({
      id,
      operation: 'update' as const,
      targetCardId: 'TargetCard',
      baseRevision: 'rev-1',
      document: cardDocument('TargetCard'),
      status: 'superseded' as const,
      provenance: { turnId: 'turn-1', attemptId: 'attempt-2' },
      projectReferences: [],
      events: [
        { id: `${eventPrefix}-proposed`, type: 'proposed' as const, at: '2026-09-01T00:02:00Z' },
        { id: `${eventPrefix}-superseded`, type: 'superseded' as const, at: '2026-09-01T00:02:00Z', byProposalId },
      ],
      createdAt: '2026-09-01T00:02:00Z',
      updatedAt: '2026-09-01T00:02:00Z',
    })
    const input = {
      ...document,
      turns: [{ ...document.turns[0], assistantText: '已生成提案', attempts: [...document.turns[0].attempts, completedAttempt] }],
      proposals: [proposal('proposal-a', 'a', 'proposal-b'), proposal('proposal-b', 'b', 'proposal-a')],
    }

    expect(parseConversationDocument(input)).toMatchObject({ ok: false, reason: 'superseded 事件引用形成循环' })
  })

  it('快捷回答只能引用此前回复，且用户文字必须等于 label', () => {
    const first = {
      ...validDocument().turns[0],
      assistantText: '请选择',
      quickReplies: [{ id: 'yes', label: '继续' }],
      attempts: [{ ...validDocument().turns[0].attempts[0], status: 'completed' as const, error: null, failureKind: null }],
    }
    const second = {
      ...validDocument().turns[0],
      id: 'turn-2',
      attempts: [{ ...validDocument().turns[0].attempts[0], id: 'attempt-2' }],
      quickReplySelection: { turnId: 'turn-1', replyId: 'yes' },
    }
    expect(parseConversationDocument({ ...validDocument(), turns: [first, second] }).ok).toBe(true)
    expect(parseConversationDocument({ ...validDocument(), turns: [first, { ...second, userText: '别的文字' }] }).ok).toBe(false)
    expect(parseConversationDocument({ ...validDocument(), turns: [{ ...second, quickReplySelection: { turnId: 'turn-2', replyId: 'yes' } }] }).ok).toBe(false)
  })

  it.each([
    (document: ConversationDocument) => ({ ...document, turns: [{ ...document.turns[0], attempts: [{ ...document.turns[0].attempts[0], status: 'running', finishedAt: null, error: null, failureKind: null }] }, document.turns[0]] }),
    (document: ConversationDocument) => ({ ...document, turns: [{ ...document.turns[0], attempts: [] }] }),
    (document: ConversationDocument) => ({ ...document, turns: [{ ...document.turns[0], attachments: [...document.turns[0].attachments, document.turns[0].attachments[0]] }] }),
    (document: ConversationDocument) => ({ ...document, turns: [document.turns[0], { ...document.turns[0], id: 'turn-2' }] }),
    (document: ConversationDocument) => ({ ...document, turns: [{ ...document.turns[0], failureKind: 'cancelled' }] }),
    (document: ConversationDocument) => ({ ...document, turns: [{ ...document.turns[0], assistantText: '幽灵响应' }] }),
  ])('拒绝全局或状态不变量违规 %#', mutate => {
    expect(parseConversationDocument(mutate(validDocument())).ok).toBe(false)
  })

  it('attempt ID 跨轮次也必须唯一', () => {
    const document = validDocument()
    const second = { ...document.turns[0], id: 'turn-2', quickReplySelection: null }
    expect(parseConversationDocument({ ...document, turns: [document.turns[0], second] }).ok).toBe(false)
  })

  it.each([
    { status: 'cancelled', failureKind: 'provider' },
    { status: 'failed', failureKind: 'cancelled' },
    { status: 'interrupted', failureKind: 'provider' },
    { status: 'completed', failureKind: 'provider', error: null },
  ])('拒绝 status/failureKind 非法组合 %#', patch => {
    const document = validDocument()
    const attempt = { ...document.turns[0].attempts[0], ...patch }
    const assistantText = patch.status === 'completed' ? '完成' : null
    expect(parseConversationDocument({ ...document, turns: [{ ...document.turns[0], assistantText, attempts: [attempt] }] }).ok).toBe(false)
  })
})
