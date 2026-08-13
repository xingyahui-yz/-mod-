import { CardDocument, CURRENT_CARD_SCHEMA_VERSION, parseCardDocument } from './cardDocument'

export type UnknownCardDocument = Record<string, unknown>

export type MigrationResult =
  | { status: 'current'; document: CardDocument }
  | { status: 'migrated'; document: CardDocument; fromVersion: number; toVersion: number }
  | { status: 'read-only'; reason: 'future-schema' | 'unknown-kind'; raw: unknown }
  | { status: 'invalid'; reason: string; raw: unknown }

function cloneInput(input: UnknownCardDocument): UnknownCardDocument {
  return JSON.parse(JSON.stringify(input)) as UnknownCardDocument
}

/** v1 → v2：把 generation 状态纳入同一份 CardDocument。 */
export function migrateV1ToV2(input: UnknownCardDocument): UnknownCardDocument {
  const output = cloneInput(input)
  output.schemaVersion = 2
  if (!output.generation || typeof output.generation !== 'object') {
    output.generation = { lastGeneratedFingerprint: null }
  }
  return output
}

/** 严格逐版本迁移；每次迁移后都回到当前 parser 做最终结构校验。 */
export function migrateCardDocument(input: unknown): MigrationResult {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    return { status: 'invalid', reason: 'CardDocument 必须是对象', raw: input }
  }
  const original = input as UnknownCardDocument
  if (typeof original.schemaVersion !== 'number' || !Number.isInteger(original.schemaVersion)) {
    return { status: 'invalid', reason: 'schemaVersion 必须是整数', raw: input }
  }
  if (original.schemaVersion === CURRENT_CARD_SCHEMA_VERSION) {
    const parsed = parseCardDocument(input)
    if (parsed.status === 'editable') return { status: 'current', document: parsed.document }
    if (parsed.status === 'read-only') return { status: 'read-only', reason: parsed.reason, raw: parsed.raw }
    return { status: 'invalid', reason: parsed.status === 'invalid' ? parsed.reason : '当前 schema 仍需迁移', raw: input }
  }
  if (original.schemaVersion > CURRENT_CARD_SCHEMA_VERSION) {
    return { status: 'read-only', reason: 'future-schema', raw: input }
  }

  let migrated = cloneInput(original)
  const fromVersion = original.schemaVersion
  while (typeof migrated.schemaVersion === 'number' && migrated.schemaVersion < CURRENT_CARD_SCHEMA_VERSION) {
    if (migrated.schemaVersion !== 1) {
      return { status: 'invalid', reason: `不支持从 schema v${migrated.schemaVersion} 跳级迁移`, raw: input }
    }
    migrated = migrateV1ToV2(migrated)
  }

  const parsed = parseCardDocument(migrated)
  if (parsed.status === 'read-only') {
    return { status: 'read-only', reason: parsed.reason, raw: parsed.raw }
  }
  if (parsed.status !== 'editable') return { status: 'invalid', reason: '迁移结果无效', raw: input }
  return {
    status: 'migrated',
    document: parsed.document,
    fromVersion,
    toVersion: CURRENT_CARD_SCHEMA_VERSION,
  }
}
