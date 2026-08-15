import { createEmptyGraph } from '../node-editor/graph'
import type { CardDocument } from './cardDocument'
import { isValidCardId } from './cardValidation'
import { parseCardFromCode } from '../utils/cardParser'

export interface LegacyCardImportFileEntry {
  name: string
  isDirectory: boolean
  path: string
}

export interface LegacyCardImportFilePort {
  readDirectory(path: string): Promise<LegacyCardImportFileEntry[]>
  readFile(path: string): Promise<string | null>
}

export interface LegacyCardImportItem {
  fileName: string
  sourcePath: string
  status: 'migrated-draft' | 'conflict' | 'invalid'
  card?: ReturnType<typeof parseCardFromCode>
  document?: CardDocument
  reason?: string
}

const LEGACY_CARDS_DIR = 'scripts/Cards'

function joinPath(...parts: string[]): string {
  return parts
    .map((part, index) => index === 0 ? part.replace(/\/+$/, '') : part.replace(/^\/+|\/+$/g, ''))
    .filter(Boolean)
    .join('/')
}

/**
 * 显式的一次性旧项目迁移入口。
 * 正常 CardDocument repository 不依赖此模块，也不会扫描 scripts/Cards。
 */
export async function importLegacyCards(
  projectPath: string,
  deps: { files: LegacyCardImportFilePort },
): Promise<LegacyCardImportItem[]> {
  const directory = joinPath(projectPath, LEGACY_CARDS_DIR)
  let entries: LegacyCardImportFileEntry[]
  try {
    entries = await deps.files.readDirectory(directory)
  } catch {
    return []
  }

  const seenIds = new Set<string>()
  const files = entries
    .filter(entry => !entry.isDirectory && entry.name.toLowerCase().endsWith('.cs'))
    .sort((a, b) => a.name.localeCompare(b.name))

  const results: LegacyCardImportItem[] = []
  for (const entry of files) {
    const sourcePath = entry.path || joinPath(directory, entry.name)
    const content = await deps.files.readFile(sourcePath).catch(() => null)
    const card = content === null ? null : parseCardFromCode(content)
    if (!card || !isValidCardId(card.id)) {
      results.push({ fileName: entry.name, sourcePath, status: 'invalid', reason: '无法从旧 C# 恢复合法 Card ID/属性' })
      continue
    }

    const key = card.id.toLowerCase()
    if (seenIds.has(key)) {
      results.push({ fileName: entry.name, sourcePath, status: 'conflict', card, reason: `Card ID ${card.id} 与其他旧卡冲突` })
      continue
    }
    seenIds.add(key)

    results.push({
      fileName: entry.name,
      sourcePath,
      status: 'migrated-draft',
      card,
      document: {
        schemaVersion: 2,
        card,
        graph: createEmptyGraph(card.id, 'card'),
        generation: { lastGeneratedFingerprint: null },
      },
    })
  }
  return results
}
