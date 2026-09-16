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
import { acquireCardIdClaim } from './cardIdClaim'

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
  | { ok: false; error: string }

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

export function createCardDocumentRepository(deps: { files: CardDocumentFilePort }): CardDocumentRepository {
  const { files } = deps

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
      const entries = directory.value

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
      const claim = await acquireCardIdClaim(files, cardsPath, document.card.id, temp)
      if (claim.status !== 'acquired') {
        await files.remove(temp).catch(() => false)
        return { ok: false, error: claim.status === 'occupied'
          ? 'Card ID 正被其他写入占用'
          : '无法原子占用 Card ID' }
      }
      try {
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
        if (!await files.rename(temp, target)) {
          return { ok: false, error: '无法原子替换 CardDocument' }
        }
        return { ok: true, path: target }
      } finally {
        await claim.release()
        await files.remove(temp).catch(() => false)
      }
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
      const claim = await acquireCardIdClaim(files, cardsPath, document.card.id, temp)
      if (claim.status !== 'acquired') {
        await files.remove(temp).catch(() => false)
        return claim.status === 'occupied'
          ? { ok: false, error: 'Card ID 已被占用（大小写不敏感）' }
          : { ok: false, error: '无法原子占用 Card ID' }
      }
      try {
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
      } finally {
        await claim.release()
        await files.remove(temp).catch(() => false)
      }
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
