import { parseCardDocumentJson, type CardDocumentParseResult } from './cardDocument'
import { isValidCardId } from './cardValidation'

export interface CardTrashFileEntry {
  name: string
  isDirectory: boolean
  path: string
}
export interface CardTrashFilePort {
  readDirectory(path: string): Promise<CardTrashFileEntry[]>
  readFile(path: string): Promise<string | null>
  mkdir(path: string): Promise<boolean>
  rename(from: string, to: string): Promise<boolean>
  remove(path: string): Promise<boolean>
}

export interface CardTrashEntry {
  trashId: string
  path: string
  documentPath: string
  artifactPath: string | null
  result: CardDocumentParseResult
}

export type CardTrashDeleteResult =
  | { status: 'deleted'; trashId: string; trashPath: string }
  | { status: 'failed'; reason: string }

export type CardTrashRestoreResult =
  | { status: 'restored'; cardId: string }
  | { status: 'conflict'; cardId: string; reason: string }
  | { status: 'failed'; reason: string }

export interface CardTrashRepository {
  delete(projectPath: string, cardId: string): Promise<CardTrashDeleteResult>
  list(projectPath: string): Promise<CardTrashEntry[]>
  restore(projectPath: string, trashId: string): Promise<CardTrashRestoreResult>
}

const CARDS_DIR = '.modstudio/cards'
const TRASH_DIR = '.modstudio/trash/cards'
const ARTIFACTS_DIR = 'scripts/Cards'

function joinPath(...parts: string[]): string {
  return parts
    .map((part, index) => index === 0 ? part.replace(/\/+$/, '') : part.replace(/^\/+|\/+$/g, ''))
    .filter(Boolean)
    .join('/')
}

function isMissingDirectory(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error)
  return message.includes('ENOENT') || message.includes('not found') || message.includes('不存在')
}

function cardIdFromRaw(value: unknown): string | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const card = (value as Record<string, unknown>).card
  if (!card || typeof card !== 'object' || Array.isArray(card)) return null
  const id = (card as Record<string, unknown>).id
  return typeof id === 'string' && isValidCardId(id) ? id : null
}

function trashItemPath(trashRoot: string, trashId: string): string {
  return joinPath(trashRoot, trashId)
}

/**
 * Card 回收站仓库。删除和恢复都只移动文件，不重写文档内容；任何后续
 * 步骤失败都会尝试把已经移动的文件补偿回原位置。
 */
export function createCardTrashRepository(
  deps: { files: CardTrashFilePort; idSuffix?: () => string },
): CardTrashRepository {
  const { files } = deps
  const suffix = deps.idSuffix ?? (() => String(Date.now()))

  return {
    async delete(projectPath, cardId) {
      if (!isValidCardId(cardId)) return { status: 'failed', reason: 'Card ID 不合法，无法删除' }

      const cardsRoot = joinPath(projectPath, CARDS_DIR)
      const artifactRoot = joinPath(projectPath, ARTIFACTS_DIR)
      const trashRoot = joinPath(projectPath, TRASH_DIR)
      const sourceDocument = joinPath(cardsRoot, `${cardId}.json`)
      const sourceArtifact = joinPath(artifactRoot, `${cardId}.cs`)
      const document = await files.readFile(sourceDocument).catch(() => null)
      if (document === null) return { status: 'failed', reason: 'CardDocument 不存在，未删除 Card' }
      const artifact = await files.readFile(sourceArtifact).catch(() => null)

      const trashId = `${cardId}-${suffix()}`
      const trashPath = trashItemPath(trashRoot, trashId)
      const trashDocument = joinPath(trashPath, 'card.json')
      const trashArtifact = joinPath(trashPath, 'artifact.cs')
      if (!await files.mkdir(trashPath)) return { status: 'failed', reason: '无法创建 Card 回收站目录' }

      if (!await files.rename(sourceDocument, trashDocument)) {
        await files.remove(trashPath).catch(() => false)
        return { status: 'failed', reason: '无法暂存 CardDocument，Card 保持活跃' }
      }

      let artifactMoved = false
      if (artifact !== null) {
        artifactMoved = await files.rename(sourceArtifact, trashArtifact)
        if (!artifactMoved) {
          await files.rename(trashDocument, sourceDocument).catch(() => false)
          return { status: 'failed', reason: '无法暂存 C# 产物，Card 已补偿恢复' }
        }
      }

      // 删除只有在活动目录确认不再有任何可加载文件后才生效。
      const activeDocument = await files.readFile(sourceDocument).catch(() => null)
      const activeArtifact = artifactMoved ? await files.readFile(sourceArtifact).catch(() => null) : null
      if (activeDocument !== null || activeArtifact !== null) {
        if (artifactMoved) await files.rename(trashArtifact, sourceArtifact).catch(() => false)
        await files.rename(trashDocument, sourceDocument).catch(() => false)
        return { status: 'failed', reason: '活动目录仍存在 Card 文件，已补偿恢复' }
      }
      return { status: 'deleted', trashId, trashPath }
    },

    async list(projectPath) {
      const trashRoot = joinPath(projectPath, TRASH_DIR)
      let entries: CardTrashFileEntry[]
      try {
        entries = await files.readDirectory(trashRoot)
      } catch (error) {
        if (isMissingDirectory(error)) return []
        throw error
      }

      const folders = entries.filter(entry => entry.isDirectory).sort((a, b) => a.name.localeCompare(b.name))
      const result: CardTrashEntry[] = []
      for (const folder of folders) {
        const folderPath = folder.path || trashItemPath(trashRoot, folder.name)
        const documentPath = joinPath(folderPath, 'card.json')
        const artifactPath = joinPath(folderPath, 'artifact.cs')
        const raw = await files.readFile(documentPath).catch(() => null)
        if (raw === null) continue
        const parsed = parseCardDocumentJson(raw)
        const artifact = await files.readFile(artifactPath).catch(() => null)
        result.push({
          trashId: folder.name,
          path: folderPath,
          documentPath,
          artifactPath: artifact === null ? null : artifactPath,
          result: parsed,
        })
      }
      return result
    },

    async restore(projectPath, trashId) {
      if (!trashId || trashId.includes('/') || trashId.includes('\\')) {
        return { status: 'failed', reason: '无效的回收站条目' }
      }
      const trashRoot = joinPath(projectPath, TRASH_DIR)
      const trashPath = trashItemPath(trashRoot, trashId)
      const trashDocument = joinPath(trashPath, 'card.json')
      const trashArtifact = joinPath(trashPath, 'artifact.cs')
      const raw = await files.readFile(trashDocument).catch(() => null)
      if (raw === null) return { status: 'failed', reason: '回收站 CardDocument 不存在' }

      let parsedRaw: unknown
      try {
        parsedRaw = JSON.parse(raw)
      } catch {
        return { status: 'failed', reason: '回收站 CardDocument JSON 损坏' }
      }
      const cardId = cardIdFromRaw(parsedRaw)
      if (!cardId) return { status: 'failed', reason: '回收站 Card ID 无效，未移动文件' }

      const cardsRoot = joinPath(projectPath, CARDS_DIR)
      const artifactRoot = joinPath(projectPath, ARTIFACTS_DIR)
      const targetDocument = joinPath(cardsRoot, `${cardId}.json`)
      const targetArtifact = joinPath(artifactRoot, `${cardId}.cs`)
      const activeEntries = await files.readDirectory(cardsRoot).catch(() => [] as CardTrashFileEntry[])
      const hasDocumentConflict = activeEntries.some(entry => !entry.isDirectory && entry.name.toLowerCase() === `${cardId}.json`.toLowerCase())
      const artifactEntries = await files.readDirectory(artifactRoot).catch(() => [] as CardTrashFileEntry[])
      const hasArtifactConflict = artifactEntries.some(entry => !entry.isDirectory && entry.name.toLowerCase() === `${cardId}.cs`.toLowerCase())
      if (hasDocumentConflict || hasArtifactConflict) {
        return { status: 'conflict', cardId, reason: '活动目录已有同 ID Card，恢复不会自动改名' }
      }

      const artifact = await files.readFile(trashArtifact).catch(() => null)
      if (!await files.mkdir(cardsRoot)) return { status: 'failed', reason: '无法创建 CardDocument 目录' }
      if (artifact !== null && !await files.mkdir(artifactRoot)) return { status: 'failed', reason: '无法创建 C# 目录' }

      if (!await files.rename(trashDocument, targetDocument)) {
        return { status: 'failed', reason: '无法恢复 CardDocument，回收站内容保留' }
      }
      if (artifact !== null && !await files.rename(trashArtifact, targetArtifact)) {
        await files.rename(targetDocument, trashDocument).catch(() => false)
        return { status: 'failed', reason: '无法恢复 C# 产物，Card 已补偿回收站' }
      }

      const activeDocument = await files.readFile(targetDocument).catch(() => null)
      const activeArtifact = artifact !== null ? await files.readFile(targetArtifact).catch(() => null) : null
      if (activeDocument === null || (artifact !== null && activeArtifact === null)) {
        if (artifact !== null && activeArtifact !== null) await files.rename(targetArtifact, trashArtifact).catch(() => false)
        await files.rename(targetDocument, trashDocument).catch(() => false)
        return { status: 'failed', reason: '恢复后活动文件校验失败，已补偿回收站' }
      }
      return { status: 'restored', cardId }
    },
  }
}
