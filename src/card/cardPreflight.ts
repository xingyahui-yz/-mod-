import type { CardDocument } from './cardDocument'
import { inspectCardArtifact, type ArtifactSyncStatus } from './artifactSafety'
import type { CardDocumentLoadEntry } from './cardRepository'

export type CardPreflightStatus =
  | 'ready'
  | 'stale-allowed'
  | 'draft'
  | 'missing-artifact'
  | 'stale-generation'
  | 'externally-modified'
  | 'untracked-artifact'
  | 'read-only'
  | 'invalid'

export interface CardPreflightItem {
  cardId: string
  status: CardPreflightStatus
  reason: string
}

export interface CardPreflightReport {
  ok: boolean
  items: CardPreflightItem[]
  blocking: CardPreflightItem[]
}

export interface CardPreflightOptions {
  /** 明确排除尚未生成过 C# 的草稿；默认不排除。 */
  excludedDraftIds?: Iterable<string>
  /** 明确允许本次测试使用上次仍可信但已过期的 C#。 */
  allowStaleGeneratedIds?: Iterable<string>
}

function rawCardId(raw: unknown): string | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null
  const card = (raw as Record<string, unknown>).card
  if (!card || typeof card !== 'object' || Array.isArray(card)) return null
  return typeof (card as Record<string, unknown>).id === 'string' ? (card as Record<string, unknown>).id as string : null
}

function itemFromInspection(cardId: string, status: ArtifactSyncStatus): CardPreflightItem {
  switch (status) {
    case 'missing': return { cardId, status: 'missing-artifact', reason: 'Card 有生成记录但活动 C# 缺失' }
    case 'in-sync': return { cardId, status: 'ready', reason: 'C# 与当前 CardDocument 同步' }
    case 'stale-generation': return { cardId, status, reason: '生成器版本或 Card 语义已变化，C# 不是当前版本' }
    case 'externally-modified': return { cardId, status, reason: '上次生成后 C# 被外部修改' }
    case 'untracked': return { cardId, status: 'untracked-artifact', reason: '活动 C# 没有对应的生成指纹' }
  }
}

/** 纯决策函数，启动游戏不会隐式生成或修改任何文件。 */
export function evaluateCardPreflight(
  entries: Array<{ cardId: string; document?: CardDocument; loadStatus: 'editable' | 'read-only' | 'invalid' | 'untracked-artifact'; artifact: string | null }>,
  options: CardPreflightOptions = {},
): CardPreflightReport {
  const excluded = new Set(options.excludedDraftIds ?? [])
  const allowStale = new Set(options.allowStaleGeneratedIds ?? [])
  const items: CardPreflightItem[] = []
  for (const entry of entries) {
    if (entry.loadStatus === 'read-only') {
      items.push({ cardId: entry.cardId, status: 'read-only', reason: 'CardDocument 只读恢复，不会作为可编辑源数据加载' })
      continue
    }
    if (entry.loadStatus === 'untracked-artifact') {
      items.push({ cardId: entry.cardId, status: 'untracked-artifact', reason: '活动 C# 没有对应的 CardDocument' })
      continue
    }
    if (entry.loadStatus === 'invalid' || !entry.document) {
      items.push({ cardId: entry.cardId, status: 'invalid', reason: 'CardDocument 无法解析' })
      continue
    }
    const inspection = inspectCardArtifact(entry.document, entry.artifact)
    if (inspection.status === 'missing' && !entry.document.generation.lastGeneratedFingerprint) {
      items.push(excluded.has(entry.cardId)
        ? { cardId: entry.cardId, status: 'draft', reason: '未生成过 C#，本次测试已明确排除' }
        : { cardId: entry.cardId, status: 'draft', reason: 'Card 草稿尚未生成 C#，请先生成或明确排除' })
      continue
    }
    if (inspection.status === 'stale-generation' && allowStale.has(entry.cardId)) {
      items.push({ cardId: entry.cardId, status: 'stale-allowed', reason: '本次测试明确选择使用上次生成版本' })
      continue
    }
    items.push(itemFromInspection(entry.cardId, inspection.status))
  }
  const blocking = items.filter(item => !['ready', 'stale-allowed', 'draft'].includes(item.status))
  // 未明确排除的 draft 也阻止启动；已排除的 draft 保留在报告中供 UI 展示。
  for (const item of items) {
    if (item.status === 'draft' && !item.reason.includes('已明确排除')) blocking.push(item)
  }
  return { ok: blocking.length === 0, items, blocking }
}

export function buildPreflightEntries(
  loaded: CardDocumentLoadEntry[],
  artifacts: Map<string, string | null>,
): Array<{ cardId: string; document?: CardDocument; loadStatus: 'editable' | 'read-only' | 'invalid' | 'untracked-artifact'; artifact: string | null }> {
  return loaded.map(entry => {
    const cardId = entry.result.status === 'editable'
      ? entry.result.document.card.id
      : rawCardId(entry.result.raw) ?? entry.fileName.replace(/\.json$/i, '')
    return {
      cardId,
      document: entry.result.status === 'editable' ? entry.result.document : undefined,
      loadStatus: entry.result.status === 'editable' ? 'editable' : entry.result.status === 'read-only' ? 'read-only' : 'invalid',
      artifact: artifacts.get(cardId) ?? null,
    }
  })
}
