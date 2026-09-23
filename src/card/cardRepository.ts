import {
  parseCardDocument,
  serializeCardDocument,
  type CardDocument,
  type CardDocumentParseResult,
} from './cardDocument'
import { migrateCardDocument } from './cardMigrations'
import { parseCardDocumentJson } from './cardDocument'
import { isValidCardId } from './cardValidation'
import type { FileService } from '../services/FileService'
import { acquireCardIdClaim, recoverCardIdClaims } from './cardIdClaim'

export interface CardDocumentFileEntry {
  name: string
  isDirectory: boolean
  path: string
}

/** Card repository 所需的最小文件能力；不包含 C# parser。 */
export interface CardDocumentFilePort {
  readDirectory(path: string): Promise<CardDocumentFileEntry[]>
  readDirectoryResult?(path: string): Promise<
    | { status: 'found'; value: CardDocumentFileEntry[] }
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
  writeFile(path: string, content: string): Promise<boolean>
  rename(from: string, to: string): Promise<boolean>
  linkNoReplace(from: string, to: string): Promise<{ status: 'linked' | 'exists' | 'failed' }>
  remove(path: string): Promise<boolean>
}

export interface CardDocumentLoadEntry {
  fileName: string
  path: string
  result: CardDocumentParseResult
}

export type CardDocumentSaveResult =
  | { ok: true; path: string }
  | { ok: false; error: string; certainty?: 'unchanged' | 'uncertain' }

export type CardDocumentMigrationSaveResult =
  | { status: 'migrated'; path: string; backupPath: string }
  | { status: 'read-only' | 'invalid'; reason: string }
  | { status: 'failed'; reason: string }

export interface CardDocumentRepository {
  load(projectPath: string): Promise<CardDocumentLoadEntry[]>
  save(projectPath: string, document: CardDocument): Promise<CardDocumentSaveResult>
  create(projectPath: string, document: CardDocument): Promise<CardDocumentSaveResult>
  migrateAndSave(projectPath: string, fileName: string): Promise<CardDocumentMigrationSaveResult>
}

/** 将现有 FileService 接到 repository，不改变旧的 C# load/save 方法。 */
export function createCardDocumentRepositoryFromFileService(
  service: Pick<FileService, 'getProjectFiles' | 'readDirectoryResult' | 'readFile' | 'readFileResult' | 'createDirectory' | 'writeFile' | 'renameFile' | 'linkFileNoReplace' | 'removeFile'>,
): CardDocumentRepository {
  return createCardDocumentRepository({
    files: {
      readDirectory: path => service.getProjectFiles(path),
      readDirectoryResult: path => service.readDirectoryResult(path),
      readFile: path => service.readFile(path),
      readFileResult: path => service.readFileResult(path),
      mkdir: path => service.createDirectory(path),
      writeFile: (path, content) => service.writeFile(path, content),
      rename: (from, to) => service.renameFile(from, to),
      linkNoReplace: (from, to) => service.linkFileNoReplace(from, to),
      remove: path => service.removeFile(path),
    },
  })
}

const CARDS_DIR = '.modstudio/cards'

function joinPath(...parts: string[]): string {
  return parts
    .map((part, index) => index === 0 ? part.replace(/\/+$/, '') : part.replace(/^\/+|\/+$/g, ''))
    .filter(Boolean)
    .join('/')
}

function temporaryPath(target: string, id: string): string {
  return `${target}.tmp-${id}-${Math.random().toString(36).slice(2)}`
}

function saveStagingPath(target: string, id: string): string {
  return `${target}.save-staging-${id}-${Math.random().toString(36).slice(2)}`
}

function savePublishedPath(target: string, id: string): string {
  return `${target}.save-published-${id}-${Math.random().toString(36).slice(2)}`
}

async function readDirectoryState(files: CardDocumentFilePort, path: string): Promise<
  | { status: 'found'; value: CardDocumentFileEntry[] }
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
    const message = error instanceof Error ? error.message : String(error)
    return message.includes('ENOENT') || message.includes('not found') || message.includes('不存在')
      ? { status: 'missing' }
      : { status: 'error', error: message }
  }
}

async function readFileState(files: CardDocumentFilePort, path: string): Promise<
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

function matchingCardEntries(
  entries: readonly CardDocumentFileEntry[],
  cardId: string,
): CardDocumentFileEntry[] {
  const expected = `${cardId}.json`.toLowerCase()
  return entries.filter(entry => !entry.isDirectory && entry.name.toLowerCase() === expected)
}

export function createCardDocumentRepository(deps: {
  files: CardDocumentFilePort
  claimSessionId?: string
  claimOperationId?: () => string
}): CardDocumentRepository {
  const { files } = deps
  const claimOperationId = deps.claimOperationId ?? (() =>
    `operation-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`)

  const restoreStagedFile = async (
    staging: string,
    target: string,
    expected: string,
  ): Promise<boolean> => {
    const restored = await files.linkNoReplace(staging, target)
      .catch(() => ({ status: 'failed' as const }))
    if (restored.status !== 'linked') return false
    const readBack = await readFileState(files, target)
    if (readBack.status !== 'found' || readBack.value !== expected) return false
    await files.remove(staging).catch(() => false)
    return true
  }

  const recoverInterruptedSaveStaging = async (
    cardsPath: string,
    entries: readonly CardDocumentFileEntry[],
  ): Promise<boolean> => {
    const groups = new Map<string, { targetName: string; staging: CardDocumentFileEntry[] }>()
    for (const entry of entries) {
      if (entry.isDirectory) continue
      const marker = entry.name.toLowerCase().indexOf('.json.save-staging-')
      if (marker < 0) continue
      const targetName = entry.name.slice(0, marker + '.json'.length)
      const cardId = targetName.slice(0, -'.json'.length)
      if (!isValidCardId(cardId)) continue
      const key = targetName.toLowerCase()
      const group = groups.get(key) ?? { targetName, staging: [] }
      group.staging.push(entry)
      groups.set(key, group)
    }

    let needsRescan = false
    for (const [targetKey, group] of groups) {
      const activeEntries = entries.filter(entry =>
        !entry.isDirectory && entry.name.toLowerCase() === targetKey)
      if (activeEntries.length > 1) {
        throw new Error('CardDocument 保存恢复发现活动文件大小写冲突，已停止加载')
      }
      if (activeEntries.length === 1) {
        const activeEntry = activeEntries[0]
        const activePath = activeEntry.path || joinPath(cardsPath, activeEntry.name)
        const activeBefore = await readFileState(files, activePath)
        const activeParsed = activeBefore.status === 'found'
          ? parseCardDocumentJson(activeBefore.value)
          : null
        const expectedId = group.targetName.slice(0, -'.json'.length)
        if (activeBefore.status !== 'found' || activeParsed?.status !== 'editable' ||
          activeParsed.document.card.id.toLowerCase() !== expectedId.toLowerCase()) {
          throw new Error('活动 CardDocument 无法证明已发布，已保留 save staging 并停止加载')
        }

        // target 已存在且严格验证为同 ID 可编辑文档，说明 linkNoReplace 已越过
        // 发布线性化点。此时 staging 是旧版本而非恢复源；先原子改名为 load
        // 永不恢复的 published residue，再读回并复核活动文件仍未变化。
        for (const stagingEntry of group.staging) {
          const staging = stagingEntry.path || joinPath(cardsPath, stagingEntry.name)
          const staged = await readFileState(files, staging)
          if (staged.status !== 'found') {
            throw new Error('无法读取 CardDocument save staging，已停止加载')
          }
          const publishedResidue = savePublishedPath(activePath, expectedId)
          if (!await files.rename(staging, publishedResidue).catch(() => false)) {
            throw new Error('无法封存已发布 CardDocument 的旧版本，已停止加载')
          }
          const residueReadBack = await readFileState(files, publishedResidue)
          const activeAfter = await readFileState(files, activePath)
          if (residueReadBack.status !== 'found' || residueReadBack.value !== staged.value ||
            activeAfter.status !== 'found' || activeAfter.value !== activeBefore.value) {
            throw new Error('CardDocument 发布恢复终检失败，已停止加载')
          }
          // published residue 即使清理失败也不会再进入恢复路径。
          await files.remove(publishedResidue).catch(() => false)
          needsRescan = true
        }
        continue
      }
      if (group.staging.length !== 1) {
        throw new Error(`CardDocument 保存恢复存在 ${group.staging.length} 份候选，已停止加载`)
      }
      const stagingEntry = group.staging[0]
      const staging = stagingEntry.path || joinPath(cardsPath, stagingEntry.name)
      const target = joinPath(cardsPath, group.targetName)
      const raw = await readFileState(files, staging)
      if (raw.status !== 'found') {
        throw new Error(raw.status === 'error'
          ? `无法读取 CardDocument 保存恢复副本：${raw.error}`
          : 'CardDocument 保存恢复副本已消失')
      }
      const parsed = parseCardDocumentJson(raw.value)
      const expectedId = group.targetName.slice(0, -'.json'.length)
      if (parsed.status !== 'editable' || parsed.document.card.id.toLowerCase() !== expectedId.toLowerCase()) {
        throw new Error('CardDocument 保存恢复副本无效，已保真停止加载')
      }
      const restored = await files.linkNoReplace(staging, target)
        .catch(() => ({ status: 'failed' as const }))
      if (restored.status === 'failed') {
        throw new Error('无法恢复中断的 CardDocument 保存')
      }
      needsRescan = true
      if (restored.status === 'linked') {
        const readBack = await readFileState(files, target)
        if (readBack.status !== 'found' || readBack.value !== raw.value) {
          throw new Error('CardDocument 保存恢复读回校验失败')
        }
        await files.remove(staging).catch(() => false)
      }
    }
    return needsRescan
  }

  const atomicWrite = async (target: string, content: string, id: string): Promise<boolean> => {
    const temp = temporaryPath(target, id)
    if (!await files.writeFile(temp, content)) {
      await files.remove(temp).catch(() => false)
      return false
    }
    if (!await files.rename(temp, target)) {
      await files.remove(temp).catch(() => false)
      return false
    }
    return true
  }

  const validateDocument = (document: CardDocument): string | null => {
    if (!isValidCardId(document.card.id)) return 'Card ID 不合法，无法保存'
    const parsed = parseCardDocument(document)
    if (parsed.status !== 'editable') {
      return parsed.status === 'invalid' ? parsed.reason : 'CardDocument 不是可编辑状态'
    }
    return null
  }

  return {
    async load(projectPath) {
      const cardsPath = joinPath(projectPath, CARDS_DIR)
      const directory = await readDirectoryState(files, cardsPath)
      if (directory.status === 'missing') return []
      if (directory.status === 'error') throw new Error(directory.error)
      const claimRecovery = await recoverCardIdClaims(files, cardsPath, {
        sessionId: deps.claimSessionId,
      })
      if (claimRecovery.status === 'failed') throw new Error(claimRecovery.error)
      let entries = directory.value
      if (await recoverInterruptedSaveStaging(cardsPath, entries)) {
        const refreshed = await readDirectoryState(files, cardsPath)
        if (refreshed.status !== 'found') {
          throw new Error(refreshed.status === 'error'
            ? refreshed.error
            : 'CardDocument 保存恢复后目录消失')
        }
        entries = refreshed.value
      }

      const cardEntries = entries
        .filter(entry => !entry.isDirectory && entry.name.toLowerCase().endsWith('.json'))
        .sort((a, b) => a.name.localeCompare(b.name))

      return Promise.all(cardEntries.map(async entry => {
        const path = entry.path || joinPath(cardsPath, entry.name)
        const content = await readFileState(files, path)
        if (content.status === 'error') throw new Error(content.error)
        const result = content.status === 'missing'
          ? { status: 'invalid' as const, reason: 'CardDocument 在目录扫描后消失', raw: null }
          : parseCardDocumentJson(content.value)
        return { fileName: entry.name, path, result }
      }))
    },

    async save(projectPath, document) {
      const invalid = validateDocument(document)
      if (invalid) return { ok: false, error: invalid }

      const cardsPath = joinPath(projectPath, CARDS_DIR)
      if (!await files.mkdir(cardsPath)) {
        return { ok: false, error: '无法创建 CardDocument 目录' }
      }

      // save 只能更新已经由本项目加载的唯一活动文件，不能退化成 create。
      // 在写临时文件之前记录旧内容；持有 lowercase claim 后再次验证，避免
      // 并发 create 或外部编辑在 rename 时被静默覆盖。
      const initialDirectory = await readDirectoryState(files, cardsPath)
      if (initialDirectory.status !== 'found') {
        return { ok: false, error: initialDirectory.status === 'error' ? initialDirectory.error : 'CardDocument 不存在，不能覆盖保存' }
      }
      const initialMatches = matchingCardEntries(initialDirectory.value, document.card.id)
      if (initialMatches.length !== 1) {
        return { ok: false, error: initialMatches.length === 0
          ? 'CardDocument 不存在，不能覆盖保存'
          : 'Card ID 存在大小写冲突，不能覆盖保存' }
      }
      const target = initialMatches[0].path || joinPath(cardsPath, initialMatches[0].name)
      const initialContent = await readFileState(files, target)
      if (initialContent.status !== 'found') {
        return { ok: false, error: initialContent.status === 'error' ? initialContent.error : 'CardDocument 不存在，不能覆盖保存' }
      }

      const content = serializeCardDocument(document)
      const temp = temporaryPath(target, document.card.id)
      if (!await files.writeFile(temp, content)) {
        await files.remove(temp).catch(() => false)
        return { ok: false, error: '无法写入 CardDocument 临时文件' }
      }
      const claim = await acquireCardIdClaim(files, cardsPath, document.card.id, temp, {
        sessionId: deps.claimSessionId,
        operationId: claimOperationId(),
      })
      if (claim.status !== 'acquired') {
        await files.remove(temp).catch(() => false)
        return { ok: false, error: claim.status === 'occupied'
          ? 'Card ID 正被其他写入占用'
          : '无法原子占用 Card ID' }
      }
      let operationResult: CardDocumentSaveResult
      try {
        operationResult = await (async (): Promise<CardDocumentSaveResult> => {
        const currentDirectory = await readDirectoryState(files, cardsPath)
        if (currentDirectory.status !== 'found') {
          return { ok: false, error: currentDirectory.status === 'error' ? currentDirectory.error : 'CardDocument 保存前已消失' }
        }
        const currentMatches = matchingCardEntries(currentDirectory.value, document.card.id)
        const currentTarget = currentMatches.length === 1
          ? currentMatches[0].path || joinPath(cardsPath, currentMatches[0].name)
          : null
        if (currentTarget !== target) {
          return { ok: false, error: 'CardDocument 保存期间目录已变化，未覆盖' }
        }
        const currentContent = await readFileState(files, target)
        if (currentContent.status !== 'found' || currentContent.value !== initialContent.value) {
          return { ok: false, error: currentContent.status === 'error'
            ? currentContent.error
            : 'CardDocument 保存期间被外部修改，未覆盖' }
        }
        // 直接 rename(temp, target) 会在最后一次读取与 rename 之间
        // 静默覆盖外部编辑器的原子替换。先把当前目标移到唯一
        // staging，校验它确实是先前观察到的版本，再用
        // linkNoReplace 发布新版本；任何竞争者都只会让发布失败。
        const staging = saveStagingPath(target, document.card.id)
        if (!await files.rename(target, staging)) {
          return { ok: false, error: '无法安全隔离旧 CardDocument，未覆盖保存' }
        }
        const staged = await readFileState(files, staging)
        if (staged.status !== 'found') {
          const restored = await restoreStagedFile(staging, target, initialContent.value)
          return restored
            ? { ok: false, error: 'CardDocument 保存前校验失败，已恢复原文件' }
            : {
                ok: false,
                error: 'CardDocument 保存前校验失败且恢复结果不确定，请重新加载项目',
                certainty: 'uncertain',
              }
        }
        if (staged.value !== initialContent.value) {
          const restored = await restoreStagedFile(staging, target, staged.value)
          return restored
            ? { ok: false, error: 'CardDocument 保存期间被外部修改，未覆盖' }
            : {
                ok: false,
                error: 'CardDocument 保存期间被外修改且恢复结果不确定，请重新加载项目',
                certainty: 'uncertain',
              }
        }
        const published = await files.linkNoReplace(temp, target)
          .catch(() => ({ status: 'failed' as const }))
        if (published.status !== 'linked') {
          const restored = await restoreStagedFile(staging, target, staged.value)
          return restored
            ? { ok: false, error: '无法发布新 CardDocument，已恢复原文件' }
            : {
                ok: false,
                error: '无法发布新 CardDocument 且恢复结果不确定，请重新加载项目',
                certainty: 'uncertain',
              }
        }
        // 发布成功后先把“发布前可恢复副本”转成“发布后旧版本残留”。load 只会
        // 恢复前者；即使随后清理失败，用户之后删除活动 Card 也不会让旧版本复活。
        const publishedResidue = savePublishedPath(target, document.card.id)
        if (!await files.rename(staging, publishedResidue).catch(() => false)) {
          const removed = await files.remove(staging).catch(() => false)
          return removed
            ? { ok: true, path: target }
            : {
                ok: false,
                error: 'CardDocument 已发布但无法封存旧版本，请重新加载项目',
                certainty: 'uncertain',
              }
        }
        await files.remove(publishedResidue).catch(() => false)
        return { ok: true, path: target }
        })()
      } catch (error) {
        await claim.release()
        await files.remove(temp).catch(() => false)
        throw error
      }
      const released = await claim.release()
      await files.remove(temp).catch(() => false)
      if (released.status === 'failed') {
        return {
          ok: false,
          error: `${operationResult.ok ? 'CardDocument 已保存；' : ''}${released.error}，请重新加载项目`,
          certainty: 'uncertain',
        }
      }
      return operationResult
    },

    async create(projectPath, document) {
      const invalid = validateDocument(document)
      if (invalid) return { ok: false, error: invalid }

      const cardsPath = joinPath(projectPath, CARDS_DIR)
      if (!await files.mkdir(cardsPath)) {
        return { ok: false, error: '无法创建 CardDocument 目录' }
      }
      const initialDirectory = await readDirectoryState(files, cardsPath)
      const occupied = initialDirectory.status !== 'found' || initialDirectory.value.some(entry =>
        !entry.isDirectory && entry.name.toLowerCase() === `${document.card.id}.json`.toLowerCase())
      if (occupied) return { ok: false, error: 'Card ID 已被占用（大小写不敏感）' }

      const target = joinPath(cardsPath, `${document.card.id}.json`)
      const temp = temporaryPath(target, document.card.id)
      if (!await files.writeFile(temp, serializeCardDocument(document))) {
        await files.remove(temp).catch(() => false)
        return { ok: false, error: '无法写入 CardDocument 临时文件' }
      }
      const claim = await acquireCardIdClaim(files, cardsPath, document.card.id, temp, {
        sessionId: deps.claimSessionId,
        operationId: claimOperationId(),
      })
      if (claim.status !== 'acquired') {
        await files.remove(temp).catch(() => false)
        return claim.status === 'occupied'
          ? { ok: false, error: 'Card ID 已被占用（大小写不敏感）' }
          : { ok: false, error: '无法原子占用 Card ID' }
      }
      let operationResult: CardDocumentSaveResult
      try {
        operationResult = await (async (): Promise<CardDocumentSaveResult> => {
        // 第一次扫描与 claim 之间可能已有竞争者完成创建；持有归一化
        // claim 后必须再扫一次，才能把大小写不同的目标也纳入原子边界。
        const directoryAfterClaim = await readDirectoryState(files, cardsPath)
        const occupiedAfterClaim = directoryAfterClaim.status !== 'found' ||
          directoryAfterClaim.value.some(entry => !entry.isDirectory &&
            entry.name.toLowerCase() === `${document.card.id}.json`.toLowerCase())
        if (occupiedAfterClaim) {
          return { ok: false, error: 'Card ID 已被占用（大小写不敏感）' }
        }

        const linked = await files.linkNoReplace(temp, target)
          .catch(() => ({ status: 'failed' as const }))
        if (linked.status === 'exists') {
          return { ok: false, error: 'Card ID 已被占用（大小写不敏感）' }
        }
        if (linked.status !== 'linked') {
          return { ok: false, error: '无法原子占用 Card ID' }
        }
        return { ok: true, path: target }
        })()
      } catch (error) {
        await claim.release()
        await files.remove(temp).catch(() => false)
        throw error
      }
      const released = await claim.release()
      await files.remove(temp).catch(() => false)
      if (released.status === 'failed') {
        return {
          ok: false,
          error: `${operationResult.ok ? 'CardDocument 已创建；' : ''}${released.error}，请重新加载项目`,
          certainty: 'uncertain',
        }
      }
      return operationResult
    },

    async migrateAndSave(projectPath, fileName) {
      const cardsPath = joinPath(projectPath, CARDS_DIR)
      const target = joinPath(cardsPath, fileName)
      const raw = await files.readFile(target).catch(() => null)
      if (raw === null) return { status: 'failed', reason: '无法读取待迁移 CardDocument' }

      let input: unknown
      try {
        input = JSON.parse(raw)
      } catch {
        return { status: 'invalid', reason: 'JSON 损坏，未写回原文件' }
      }
      const migration = migrateCardDocument(input)
      if (migration.status === 'read-only') return { status: 'read-only', reason: migration.reason }
      if (migration.status === 'invalid') return { status: 'invalid', reason: migration.reason }
      if (migration.status === 'current') return { status: 'invalid', reason: 'CardDocument 已是当前 schema' }

      if (!isValidCardId(migration.document.card.id) || `${migration.document.card.id}.json` !== fileName) {
        return { status: 'invalid', reason: '迁移后的 Card ID 与文件名不一致，未写回原文件' }
      }
      const backupPath = `${target}.v${migration.fromVersion}.bak`
      if (!await files.writeFile(backupPath, raw)) {
        return { status: 'failed', reason: '无法备份原 CardDocument，未写回原文件' }
      }
      if (!await atomicWrite(target, serializeCardDocument(migration.document), migration.document.card.id)) {
        return { status: 'failed', reason: '备份已创建，但无法原子写回迁移结果' }
      }
      return { status: 'migrated', path: target, backupPath }
    },
  }
}
