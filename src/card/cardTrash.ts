import { parseCardDocumentJson, type CardDocumentParseResult } from './cardDocument'
import { isValidCardId } from './cardValidation'
import { acquireCardIdClaim } from './cardIdClaim'

export interface CardTrashFileEntry {
  name: string
  isDirectory: boolean
  path: string
}
export interface CardTrashFilePort {
  readDirectory(path: string): Promise<CardTrashFileEntry[]>
  readDirectoryResult?(path: string): Promise<
    | { status: 'found'; value: CardTrashFileEntry[] }
    | { status: 'missing' }
    | { status: 'error'; error: string }
  >
  readFile(path: string): Promise<string | null>
  readFileResult?(path: string): Promise<
    | { status: 'found'; value: string }
    | { status: 'missing' }
    | { status: 'error'; error: string }
  >
  mkdir(path: string): Promise<boolean>
  rename(from: string, to: string): Promise<boolean>
  linkNoReplace(from: string, to: string): Promise<{ status: 'linked' | 'exists' | 'failed' }>
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
  | { status: 'restored'; cardId: string; warning?: string }
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

async function readDirectoryState(files: CardTrashFilePort, path: string): Promise<
  | { status: 'found'; value: CardTrashFileEntry[] }
  | { status: 'missing' }
  | { status: 'error'; error: string }
> {
  if (files.readDirectoryResult) {
    try {
      const result = await files.readDirectoryResult(path)
      return result.status === 'error'
        ? { status: 'error', error: result.error }
        : result
    } catch (error) {
      return { status: 'error', error: error instanceof Error ? error.message : String(error) }
    }
  }
  try {
    return { status: 'found', value: await files.readDirectory(path) }
  } catch (error) {
    return isMissingDirectory(error)
      ? { status: 'missing' }
      : { status: 'error', error: error instanceof Error ? error.message : String(error) }
  }
}

async function readFileState(files: CardTrashFilePort, path: string): Promise<
  | { status: 'found'; value: string }
  | { status: 'missing' }
  | { status: 'error'; error: string }
> {
  if (files.readFileResult) {
    try {
      const result = await files.readFileResult(path)
      return result.status === 'error' ? { status: 'error', error: result.error } : result
    } catch (error) {
      return { status: 'error', error: error instanceof Error ? error.message : String(error) }
    }
  }
  try {
    const value = await files.readFile(path)
    return value === null ? { status: 'missing' } : { status: 'found', value }
  } catch (error) {
    return { status: 'error', error: error instanceof Error ? error.message : String(error) }
  }
}

async function restoreStagedFile(
  files: CardTrashFilePort,
  activePath: string,
  stagingPath: string,
  expected: string,
): Promise<boolean> {
  const restored = await files.linkNoReplace(stagingPath, activePath)
    .catch(() => ({ status: 'failed' as const }))
  if (restored.status !== 'linked') return false
  const active = await readFileState(files, activePath)
  if (active.status !== 'found' || active.value !== expected) return false
  await files.remove(stagingPath).catch(() => false)
  return true
}

async function stageActiveFile(
  files: CardTrashFilePort,
  activePath: string,
  stagingPath: string,
  expected: string,
): Promise<boolean> {
  if (!await files.rename(activePath, stagingPath).catch(() => false)) return false
  const staged = await readFileState(files, stagingPath)
  if (staged.status === 'found' && staged.value === expected) return true
  // rename 的线性化点若抓到了外部替换文件，绝不能删除它。仅在活动路径
  // 仍为空时 no-replace 恢复；否则把 staging 留在回收站供人工核对。
  await restoreStagedFile(files, activePath, stagingPath, expected)
  return false
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
 * Card 回收站仓库。删除先用 no-replace hard link 建立完整回收站副本，
 * 严格读回后才先停用 C#、再移除源文档；任意崩溃点都不会留下“源文档
 * 已消失但活动 C# 仍被游戏加载”的状态。
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
      const documentRead = await readFileState(files, sourceDocument)
      if (documentRead.status === 'error') return { status: 'failed', reason: '无法读取 CardDocument，未删除 Card' }
      if (documentRead.status === 'missing') return { status: 'failed', reason: 'CardDocument 不存在，未删除 Card' }
      const document = documentRead.value
      const artifactRead = await readFileState(files, sourceArtifact)
      if (artifactRead.status === 'error') return { status: 'failed', reason: '无法确认 C# 产物，未删除 Card' }
      const artifact = artifactRead.status === 'found' ? artifactRead.value : null

      const trashId = `${cardId}-${suffix()}`
      const trashPath = trashItemPath(trashRoot, trashId)
      const trashDocument = joinPath(trashPath, 'card.json')
      const trashArtifact = joinPath(trashPath, 'artifact.cs')
      const stagingDocument = joinPath(trashPath, 'active-document.staging')
      const stagingArtifact = joinPath(trashPath, 'active-artifact.staging')
      if (!await files.mkdir(trashPath)) return { status: 'failed', reason: '无法创建 Card 回收站目录' }

      const documentLink = await files.linkNoReplace(sourceDocument, trashDocument)
        .catch(() => ({ status: 'failed' as const }))
      if (documentLink.status !== 'linked') {
        return { status: 'failed', reason: '无法原子建立 CardDocument 回收站副本，Card 保持活跃' }
      }

      if (artifact !== null) {
        const artifactLink = await files.linkNoReplace(sourceArtifact, trashArtifact)
          .catch(() => ({ status: 'failed' as const }))
        if (artifactLink.status !== 'linked') {
          return { status: 'failed', reason: '无法原子建立 C# 回收站副本，Card 保持活跃' }
        }
      }

      const copiedDocument = await readFileState(files, trashDocument)
      const copiedArtifact = artifact !== null
        ? await readFileState(files, trashArtifact)
        : { status: 'missing' as const }
      if (copiedDocument.status !== 'found' || copiedDocument.value !== document ||
        (artifact !== null && (copiedArtifact.status !== 'found' || copiedArtifact.value !== artifact))) {
        return { status: 'failed', reason: '回收站副本读回校验失败，Card 保持活跃' }
      }

      // 先把游戏会加载的活动 C# 原子移到本次 staging，再处理源文档。
      // 两者都安全停用前不清理 staging，以便后续失败时 no-replace 补偿恢复。
      let artifactStaged = false
      if (artifact !== null) {
        if (!await stageActiveFile(files, sourceArtifact, stagingArtifact, artifact)) {
          return { status: 'failed', reason: '无法停用活动 C#，回收站副本保留' }
        }
        artifactStaged = true
        const artifactAfterRemove = await readFileState(files, sourceArtifact)
        if (artifactAfterRemove.status !== 'missing') {
          await restoreStagedFile(files, sourceArtifact, stagingArtifact, artifact)
          return { status: 'failed', reason: '活动 C# 删除状态不确定，回收站副本保留，请重新加载项目' }
        }
      }

      if (!await stageActiveFile(files, sourceDocument, stagingDocument, document)) {
        if (artifactStaged && artifact !== null) {
          await restoreStagedFile(files, sourceArtifact, stagingArtifact, artifact)
        }
        return { status: 'failed', reason: '无法移除活动 CardDocument，回收站副本保留，请重新加载项目' }
      }
      const documentAfterRemove = await readFileState(files, sourceDocument)
      if (documentAfterRemove.status !== 'missing') {
        await restoreStagedFile(files, sourceDocument, stagingDocument, document)
        if (artifactStaged && artifact !== null) {
          await restoreStagedFile(files, sourceArtifact, stagingArtifact, artifact)
        }
        return { status: 'failed', reason: 'CardDocument 删除状态不确定，回收站副本保留，请重新加载项目' }
      }

      // 活动文件已全部安全停用，删除在此刻成功。staging 只是额外可恢复副本，
      // 清理失败时保留它，不得重新激活 Card 或把结果降级为半删除。
      await files.remove(stagingDocument).catch(() => false)
      if (artifactStaged) await files.remove(stagingArtifact).catch(() => false)
      return { status: 'deleted', trashId, trashPath }
    },

    async list(projectPath) {
      const trashRoot = joinPath(projectPath, TRASH_DIR)
      const directory = await readDirectoryState(files, trashRoot)
      if (directory.status === 'missing') return []
      if (directory.status === 'error') throw new Error(directory.error)
      const entries = directory.value

      const folders = entries.filter(entry => entry.isDirectory).sort((a, b) => a.name.localeCompare(b.name))
      const result: CardTrashEntry[] = []
      for (const folder of folders) {
        const folderPath = folder.path || trashItemPath(trashRoot, folder.name)
        const documentPath = joinPath(folderPath, 'card.json')
        const artifactPath = joinPath(folderPath, 'artifact.cs')
        const documentRead = await readFileState(files, documentPath)
        if (documentRead.status === 'error') throw new Error(documentRead.error)
        if (documentRead.status === 'missing') continue
        const raw = documentRead.value
        const parsed = parseCardDocumentJson(raw)
        const artifactRead = await readFileState(files, artifactPath)
        if (artifactRead.status === 'error') throw new Error(artifactRead.error)
        const artifact = artifactRead.status === 'found' ? artifactRead.value : null
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
      const trashDocumentRead = await readFileState(files, trashDocument)
      if (trashDocumentRead.status === 'error') return { status: 'failed', reason: '无法读取回收站 CardDocument' }
      if (trashDocumentRead.status === 'missing') return { status: 'failed', reason: '回收站 CardDocument 不存在' }
      const raw = trashDocumentRead.value

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
      const trashArtifactRead = await readFileState(files, trashArtifact)
      if (trashArtifactRead.status === 'error') return { status: 'failed', reason: '无法确认回收站 C# 产物' }
      const artifact = trashArtifactRead.status === 'found' ? trashArtifactRead.value : null
      if (!await files.mkdir(cardsRoot)) return { status: 'failed', reason: '无法创建 CardDocument 目录' }
      if (artifact !== null && !await files.mkdir(artifactRoot)) return { status: 'failed', reason: '无法创建 C# 目录' }

      const claim = await acquireCardIdClaim(files, cardsRoot, cardId, trashDocument)
      if (claim.status !== 'acquired') {
        return claim.status === 'occupied'
          ? { status: 'conflict', cardId, reason: '活动目录正在占用同 ID Card，恢复不会自动改名' }
          : { status: 'failed', reason: '无法原子占用 Card ID，回收站内容保留' }
      }
      try {
        // 目录检查必须位于归一化 claim 内，才能同时排斥大小写变体的创建/恢复。
        const activeDirectory = await readDirectoryState(files, cardsRoot)
        const artifactDirectory = await readDirectoryState(files, artifactRoot)
        if (activeDirectory.status === 'error' || artifactDirectory.status === 'error') {
          return { status: 'failed', reason: '无法确认活动 Card 目录，回收站内容保留' }
        }
        const activeEntries = activeDirectory.status === 'found' ? activeDirectory.value : []
        const artifactEntries = artifactDirectory.status === 'found' ? artifactDirectory.value : []
        const hasDocumentConflict = activeEntries.some(entry => !entry.isDirectory &&
          entry.name.toLowerCase() === `${cardId}.json`.toLowerCase())
        const hasArtifactConflict = artifactEntries.some(entry => !entry.isDirectory &&
          entry.name.toLowerCase() === `${cardId}.cs`.toLowerCase())
        if (hasDocumentConflict || hasArtifactConflict) {
          return { status: 'conflict', cardId, reason: '活动目录已有同 ID Card，恢复不会自动改名' }
        }

        const documentLink = await files.linkNoReplace(trashDocument, targetDocument)
          .catch(() => ({ status: 'failed' as const }))
        if (documentLink.status === 'exists') {
          return { status: 'conflict', cardId, reason: '活动目录已有同 ID Card，恢复不会自动改名' }
        }
        if (documentLink.status !== 'linked') {
          return { status: 'failed', reason: '无法原子占用 Card ID，回收站内容保留' }
        }
        if (artifact !== null) {
          const artifactLink = await files.linkNoReplace(trashArtifact, targetArtifact)
            .catch(() => ({ status: 'failed' as const }))
          if (artifactLink.status !== 'linked') {
            return {
              status: 'restored',
              cardId,
              warning: artifactLink.status === 'exists'
                ? 'CardDocument 已恢复；同名 C# 产物未覆盖，回收站副本已保留'
                : 'CardDocument 已恢复；C# 产物恢复失败，回收站副本已保留',
            }
          }
        }

        const activeDocumentRead = await readFileState(files, targetDocument)
        const activeArtifactRead = artifact !== null
          ? await readFileState(files, targetArtifact)
          : { status: 'missing' as const }
        if (activeDocumentRead.status !== 'found' || activeDocumentRead.value !== raw ||
          (artifact !== null && (activeArtifactRead.status !== 'found' || activeArtifactRead.value !== artifact))) {
          return {
            status: 'restored',
            cardId,
            warning: 'Card 文件已恢复但无法完成读回校验；回收站副本已保留，请核对活动目录',
          }
        }
        // link 成功后再解除回收站目录项；若清理失败，活动 Card 已完整，保留的
        // hard-link 副本不会造成数据丢失，后续列表会以冲突方式保持可见。
        await files.remove(trashDocument).catch(() => false)
        if (artifact !== null) await files.remove(trashArtifact).catch(() => false)
        return { status: 'restored', cardId }
      } finally {
        await claim.release()
      }
    },
  }
}
