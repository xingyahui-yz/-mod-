import { describe, expect, it } from 'vitest'
import { createEmptyGraph } from '../node-editor/graph'
import { CURRENT_CARD_SCHEMA_VERSION, parseCardDocument, parseCardDocumentJson, serializeCardDocument, type CardDocument } from './cardDocument'
import { migrateCardDocument, migrateV1ToV2 } from './cardMigrations'

function makeDocument(overrides: Partial<CardDocument> = {}): CardDocument {
  return {
    schemaVersion: CURRENT_CARD_SCHEMA_VERSION,
    card: { id: 'Fireball', name: '火球术', cost: 1, type: 'Attack', rarity: 'Common', description: '造成伤害', keywords: ['Fire'] },
    graph: createEmptyGraph('Fireball', 'card'),
    generation: { lastGeneratedFingerprint: null },
    ...overrides,
  }
}

describe('CardDocument parser', () => {
  it('当前版本 round-trip 保留 Card 与 graph', () => {
    const document = makeDocument()
    const parsed = parseCardDocumentJson(serializeCardDocument(document))
    expect(parsed.status).toBe('editable')
    if (parsed.status === 'editable') expect(parsed.document).toEqual(document)
  })

  it('缺字段、错误类型和无效节点引用按单 Card 失败', () => {
    expect(parseCardDocument({ schemaVersion: 2 }).status).toBe('invalid')
    expect(parseCardDocument({ ...makeDocument(), schemaVersion: '2' }).status).toBe('invalid')
    const document = makeDocument()
    document.graph.edges = [{ id: 'edge', from: { nodeId: 'missing', port: 'out' }, to: { nodeId: 'also-missing', port: 'in' } }]
    expect(parseCardDocument(document).status).toBe('invalid')
  })

  it('未来 schema 进入只读恢复并保留原始字段', () => {
    const raw = { ...makeDocument(), schemaVersion: 99, futureField: { keep: true } }
    expect(parseCardDocument(raw)).toMatchObject({ status: 'read-only', reason: 'future-schema', raw })
  })

  it('未知 kind 进入只读恢复并保留原始字段', () => {
    const raw = makeDocument()
    raw.graph.nodes = [{ id: 'unknown', type: 'effect', position: { x: 0, y: 0 }, data: { kind: 'applyBuffToEventTarget', arbitrary: true } }]
    const result = parseCardDocument(raw)
    expect(result.status).toBe('read-only')
    if (result.status === 'read-only') {
      expect(result.reason).toBe('unknown-kind')
      expect(result.raw).toBe(raw)
      expect(result.unknownKinds).toContain('effect:applyBuffToEventTarget')
    }
  })

  it('JSON 损坏不影响其他 Card 的独立解析', () => {
    expect(parseCardDocumentJson('{broken').status).toBe('invalid')
    expect(parseCardDocument(makeDocument()).status).toBe('editable')
  })
})

describe('CardDocument migrations', () => {
  it('v1 逐步迁移到 v2 并补 generation', () => {
    const v1 = { ...makeDocument(), schemaVersion: 1 } as Record<string, unknown>
    delete v1.generation
    const result = migrateCardDocument(v1)
    expect(result.status).toBe('migrated')
    if (result.status === 'migrated') expect(result.document.generation.lastGeneratedFingerprint).toBeNull()
  })

  it('迁移函数不修改输入，重复执行稳定', () => {
    const input = { ...makeDocument(), schemaVersion: 1 }
    const snapshot = JSON.parse(JSON.stringify(input))
    expect(migrateV1ToV2(input)).toEqual(migrateV1ToV2(input))
    expect(input).toEqual(snapshot)
  })

  it('跳级版本和迁移后非法结构拒绝', () => {
    expect(migrateCardDocument({ ...makeDocument(), schemaVersion: 0 }).status).toBe('invalid')
    expect(migrateCardDocument({ ...makeDocument(), schemaVersion: 1, card: { ...makeDocument().card, id: 'bad_id' } }).status).toBe('invalid')
  })
})
