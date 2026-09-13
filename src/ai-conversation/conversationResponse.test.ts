import { describe, expect, it } from 'vitest'
import { parseConversationResponse } from './conversationResponse'

function cardDocument(id = 'Fireball') {
  return {
    schemaVersion: 2,
    card: {
      id,
      name: id,
      cost: 1,
      type: 'Attack',
      rarity: 'Common',
      description: '造成伤害',
      keywords: ['Fire'],
    },
    graph: {
      id: `graph-${id}`,
      entityId: id,
      entityType: 'card',
      version: '0.1.0',
      nodes: [],
      edges: [],
      metadata: {
        createdAt: '2026-09-01T00:00:00Z',
        updatedAt: '2026-09-01T00:00:00Z',
      },
    },
    generation: { lastGeneratedFingerprint: null },
  }
}

describe('parseConversationResponse', () => {
  it('接受正文、零提案和快捷回答', () => {
    const result = parseConversationResponse({ schemaVersion: 1, text: '你好', quickReplies: [{ id: 'yes', label: '继续' }], proposals: [] })
    expect(result.ok).toBe(true)
  })

  it('规范化快捷回答 ID 和文字，保证按钮草稿可直接发送', () => {
    const result = parseConversationResponse({
      schemaVersion: 1,
      text: '  请选择  ',
      quickReplies: [{ id: '  continue  ', label: '  继续  ' }],
      proposals: [],
    })
    expect(result).toEqual({
      ok: true,
      value: {
        schemaVersion: 1,
        text: '请选择',
        quickReplies: [{ id: 'continue', label: '继续' }],
        proposals: [],
      },
    })
  })

  it('一轮原子接收零到多个完整 create/update Card 提案', () => {
    const create = { operation: 'create', document: cardDocument('SuggestedCard') }
    const update = {
      operation: 'update',
      targetCardId: 'Fireball',
      baseRevision: 'rev-fireball-1',
      document: { ...cardDocument('Fireball'), card: { ...cardDocument('Fireball').card, cost: 2 } },
    }

    expect(parseConversationResponse({
      schemaVersion: 1,
      text: '这里有两个互不依赖的方案',
      quickReplies: [],
      proposals: [create, update],
    })).toEqual({
      ok: true,
      value: {
        schemaVersion: 1,
        text: '这里有两个互不依赖的方案',
        quickReplies: [],
        proposals: [create, update],
      },
    })
  })

  it.each([
    { operation: 'delete', targetCardId: 'Fireball' },
    { operation: 'create', document: cardDocument(), extra: true },
    { operation: 'update', targetCardId: 'Fireball', baseRevision: 'rev', document: { ...cardDocument(), extra: true } },
    { operation: 'update', targetCardId: 'Fireball', baseRevision: 'rev', document: { ...cardDocument(), card: { ...cardDocument().card, extra: true } } },
    { operation: 'update', targetCardId: 'Fireball', baseRevision: 'rev', document: { ...cardDocument(), generation: { lastGeneratedFingerprint: { sourceHash: 'x', generatorVersion: 'x', artifactHash: 'x' } } } },
    { operation: 'update', targetCardId: 'OtherCard', baseRevision: 'rev', document: cardDocument('Fireball') },
  ])('拒绝 delete、未知字段、生成指纹和目标不一致的提案 %#', proposal => {
    expect(parseConversationResponse({ schemaVersion: 1, text: 'x', quickReplies: [], proposals: [proposal] }).ok).toBe(false)
  })

  it('按 kind registry 的现有 Card node.data schema 接受严格节点', () => {
    const base = cardDocument('StrictCard')
    const document = {
      ...base,
      graph: {
        ...base.graph,
        nodes: [
          { id: 'trigger', type: 'trigger', position: { x: 0, y: 0 }, data: { event: 'onPlay' } },
          { id: 'draw', type: 'effect', position: { x: 10, y: 0 }, data: { kind: 'drawCards', amount: 2 } },
          { id: 'add', type: 'effect', position: { x: 20, y: 0 }, data: { kind: 'addCardToHand', cardId: 'OtherCard' } },
        ],
      },
    }

    expect(parseConversationResponse({
      schemaVersion: 1,
      text: 'x',
      quickReplies: [],
      proposals: [{ operation: 'create', document }],
    }).ok).toBe(true)
  })

  it.each([
    { id: 'trigger-extra', type: 'trigger', position: { x: 0, y: 0 }, data: { event: 'onPlay', extra: true } },
    { id: 'effect-extra', type: 'effect', position: { x: 0, y: 0 }, data: { kind: 'exhaustSelf', amount: 1 } },
    { id: 'wrong-type', type: 'effect', position: { x: 0, y: 0 }, data: { kind: 'drawCards', amount: '2' } },
    { id: 'nan-data', type: 'effect', position: { x: 0, y: 0 }, data: { kind: 'drawCards', amount: Number.NaN } },
    { id: 'nan-position', type: 'effect', position: { x: Number.NaN, y: 0 }, data: { kind: 'exhaustSelf' } },
  ])('拒绝 node.data 未知字段、错误类型或 NaN %#', node => {
    const base = cardDocument('StrictCard')
    const document = { ...base, graph: { ...base.graph, nodes: [node] } }
    expect(parseConversationResponse({
      schemaVersion: 1,
      text: 'x',
      quickReplies: [],
      proposals: [{ operation: 'create', document }],
    }).ok).toBe(false)
  })

  it.each([
    { schemaVersion: 1, text: '', quickReplies: [], proposals: [] },
    { schemaVersion: 1, text: 'x', quickReplies: [], proposals: [], extra: true },
    { schemaVersion: 1, text: 'x', quickReplies: [{ id: 'a', label: 'A' }, { id: 'a', label: 'B' }], proposals: [] },
    { schemaVersion: 1, text: 'x', quickReplies: [], proposals: [{}] },
  ])('原子拒绝非法信封 %#', value => expect(parseConversationResponse(value).ok).toBe(false))
})
