import { CURRENT_CONVERSATION_SCHEMA_VERSION, createConversationDocument, migrateConversationDocument, parseConversationDocument, type ConversationDocument } from './conversationDocument'
import { createConversationPerformanceTracker, type ConversationPerformanceMetrics } from './conversationPerformance'

export type ConversationFileRead<T> =
  | { status: 'found'; value: T }
  | { status: 'missing' }
  | { status: 'error'; error: string }

export interface ConversationFilePort {
  readFile(path: string): Promise<ConversationFileRead<string>>
  readDirectory(path: string): Promise<ConversationFileRead<readonly string[]>>
  writeFile(path: string, content: string): Promise<boolean>
  rename(from: string, to: string): Promise<boolean>
  linkNoReplace(from: string, to: string): Promise<{ status: 'linked' | 'exists' | 'failed' }>
  mkdir(path: string): Promise<boolean>
  remove(path: string): Promise<boolean>
}

export type ConversationSaveResult =
  | { ok: true; warning?: string }
  | { ok: false; error: string; certainty: 'unchanged' | 'uncertain' }

export type ConversationLoadResult =
  | { status: 'missing'; warning?: string }
  | { status: 'loaded'; document: ConversationDocument; warning?: string }
  | { status: 'quarantined'; reason: string; path: string; warning?: string }
  | { status: 'failed'; reason: string; path: string }

export interface ConversationArchiveSummary {
  archiveId: string
  createdAt: string
  updatedAt: string
  turnCount: number
  bytes: number
}

export type ConversationArchiveListResult =
  | { ok: true; archives: readonly ConversationArchiveSummary[] }
  | { ok: false; error: string }

export type ConversationArchiveReadResult =
  | { ok: true; archiveId: string; document: ConversationDocument; rawJson: string }
  | { ok: false; error: string }

export type ConversationArchiveAndResetResult =
  | { ok: true; archiveId: string }
  | { ok: false; error: string; certainty: 'unchanged' | 'uncertain' }

export interface ConversationQuarantineSummary {
  quarantineId: string
  reason: string
  schemaVersion: number | null
  bytes: number
  recoverable: boolean
}

export type ConversationQuarantineListResult =
  | { ok: true; quarantines: readonly ConversationQuarantineSummary[] }
  | { ok: false; error: string }

export type ConversationQuarantineReadResult =
  | { ok: true; quarantineId: string; reason: string; schemaVersion: number | null; recoverable: boolean; migrated: boolean; document: ConversationDocument | null; rawJson: string }
  | { ok: false; error: string }

export type ConversationQuarantineRestoreResult =
  | { ok: true; quarantineId: string; document: ConversationDocument; migrated: boolean }
  | { ok: false; error: string; certainty: 'unchanged' | 'uncertain' }

export interface ConversationRepository {
  getPerformanceMetrics?(): ConversationPerformanceMetrics
  load(projectPath: string): Promise<ConversationLoadResult>
  save(projectPath: string, document: ConversationDocument): Promise<ConversationSaveResult>
  archiveAndReset(projectPath: string, document: ConversationDocument, resetAt: string): Promise<ConversationArchiveAndResetResult>
  listArchives(projectPath: string): Promise<ConversationArchiveListResult>
  readArchive(projectPath: string, archiveId: string): Promise<ConversationArchiveReadResult>
  listQuarantines(projectPath: string): Promise<ConversationQuarantineListResult>
  readQuarantine(projectPath: string, quarantineId: string): Promise<ConversationQuarantineReadResult>
  restoreQuarantine(projectPath: string, quarantineId: string): Promise<ConversationQuarantineRestoreResult>
}

const directory = (projectPath: string) => `${projectPath}/.modstudio/ai`
const activePath = (projectPath: string) => `${directory(projectPath)}/conversation.json`
const archivesDirectory = (projectPath: string) => `${directory(projectPath)}/archives`

export function createConversationRepository(
  files: ConversationFilePort,
  now: () => number = Date.now,
  createId: () => string = () => crypto.randomUUID(),
): ConversationRepository {
  let transaction = Promise.resolve()
  const performanceTracker = createConversationPerformanceTracker()

  const runExclusive = <T>(operation: () => Promise<T>): Promise<T> => {
    const result = transaction.then(operation, operation)
    transaction = result.then(() => undefined, () => undefined)
    return result
  }

  const uniqueSibling = (path: string, kind: 'tmp' | 'backup' | 'quarantine' | 'quarantine-future') =>
    `${path}.${kind}-${now()}-${safeId(createId())}`

  const saveInternal = async (
    projectPath: string,
    document: ConversationDocument,
    retainBackup = false,
    onSerialized?: (content: string) => void,
  ): Promise<ConversationSaveResult> => {
    const parsed = parseConversationDocument(document)
    if (!parsed.ok) return unchanged(parsed.reason)
    if (!await files.mkdir(directory(projectPath))) return unchanged('无法创建对话目录')

    const path = activePath(projectPath)
    const temporary = uniqueSibling(path, 'tmp')
    const backup = uniqueSibling(path, 'backup')
    const content = JSON.stringify(document, null, 2)
    onSerialized?.(content)
    if (!await files.writeFile(temporary, content)) {
      const cleaned = await files.remove(temporary)
      return unchanged(cleaned ? '无法写入临时文件' : '无法写入临时文件，且临时文件清理失败')
    }

    const previous = await files.readFile(path)
    if (previous.status === 'error') {
      await files.remove(temporary)
      return unchanged(`无法读取现有对话文档：${previous.error}`)
    }
    const previousContent = previous.status === 'found' ? previous.value : null
    if (previousContent !== null && !await files.rename(path, backup)) {
      await files.remove(temporary)
      const certainty = await verifyOriginalState(files, path, backup, previousContent)
      return { ok: false, error: '无法备份现有对话文档', certainty }
    }

    if (!await files.rename(temporary, path)) {
      await files.remove(temporary)
      const rolledBack = await rollback(files, path, backup, previousContent)
      return {
        ok: false,
        error: rolledBack ? '无法原子替换对话文档，已保持旧状态' : '无法原子替换对话文档，且旧状态无法确认',
        certainty: rolledBack ? 'unchanged' : 'uncertain',
      }
    }

    const readBack = await files.readFile(path)
    const readBackDocument = readBack.status === 'found' ? parseSavedDocument(readBack.value) : null
    if (!readBackDocument || !documentsEqual(readBackDocument, document)) {
      const rolledBack = await rollback(files, path, backup, previousContent)
      return {
        ok: false,
        error: rolledBack ? '保存后读回等值校验失败，已恢复旧状态' : '保存后读回等值校验失败，且旧状态无法确认',
        certainty: rolledBack ? 'unchanged' : 'uncertain',
      }
    }

    if (previousContent !== null && !retainBackup && !await files.remove(backup)) {
      return { ok: true, warning: `新文档已保存，但备份清理失败：${backup}` }
    }
    return { ok: true }
  }

  const readQuarantineInternal = async (projectPath: string, quarantineId: string): Promise<ConversationQuarantineReadResult> => {
    if (!isSafeQuarantineId(quarantineId)) return { ok: false, error: '隔离文档 ID 无效' }
    const result = await files.readFile(directory(projectPath) + '/' + quarantineId)
    if (result.status === 'error') return { ok: false, error: '无法读取隔离文档：' + result.error }
    if (result.status === 'missing') return { ok: false, error: '隔离文档不存在' }
    const parsed = parseRawDocument(result.value)
    const schemaVersion = readSchemaVersion(result.value)
    return {
      ok: true, quarantineId, reason: parsed.ok ? (parsed.migrated ? '支持的旧版本，可迁移恢复' : '文档有效') : parsed.reason,
      schemaVersion, recoverable: parsed.ok, migrated: parsed.ok && parsed.migrated,
      document: parsed.ok ? parsed.document : null, rawJson: result.value,
    }
  }
  const readArchiveInternal = async (projectPath: string, archiveId: string): Promise<ConversationArchiveReadResult> => {
    if (!isSafeArchiveId(archiveId)) return { ok: false, error: '归档 ID 无效' }
    const result = await files.readFile(`${archivesDirectory(projectPath)}/${archiveId}.json`)
    if (result.status === 'error') return { ok: false, error: `无法读取归档：${result.error}` }
    if (result.status === 'missing') return { ok: false, error: '归档不存在' }
    const document = parseSavedDocument(result.value)
    if (!document) return { ok: false, error: '归档文档无效或 schema 未知' }
    return { ok: true, archiveId, document, rawJson: result.value }
  }

  return {
    getPerformanceMetrics: () => performanceTracker.snapshot(),
    load(projectPath) {
      const startedAt = performance.now()
      let loadedRawContent: string | null = null
      return runExclusive(async (): Promise<ConversationLoadResult> => {
        const path = activePath(projectPath)
        const listing = await files.readDirectory(directory(projectPath))
        if (listing.status === 'error') return { status: 'failed', reason: listing.error, path }
        const entries = listing.status === 'found' ? listing.value.map(entry => normalizeEntry(projectPath, entry)) : []
        const cleanupWarning = await cleanupStaleTemps(files, entries)
        const backups = entries.filter(entry => fileName(entry).startsWith('conversation.json.backup-')).sort().reverse()
        const quarantines = entries.filter(entry => fileName(entry).startsWith('conversation.json.quarantine-')).sort().reverse()
        const futureQuarantines = entries.filter(entry => fileName(entry).startsWith('conversation.json.quarantine-future-')).sort().reverse()

        const active = await files.readFile(path)
        if (active.status === 'error') return { status: 'failed', reason: active.error, path }
        if (active.status === 'found') {
          const parsed = parseRawDocument(active.value)
          if (parsed.ok) {
            loadedRawContent = active.value
            if (parsed.migrated) {
              const saved = await saveInternal(projectPath, parsed.document, true)
              if (!saved.ok) return { status: 'failed', reason: `迁移后的对话文档保存失败：${saved.error}`, path }
              return { status: 'loaded', document: parsed.document, warning: joinWarnings(cleanupWarning, saved.warning) }
            }
            return { status: 'loaded', document: parsed.document, warning: cleanupWarning }
          }

          const quarantinePath = uniqueSibling(path, parsed.canRestoreBackup ? 'quarantine' : 'quarantine-future')
          if (!await files.rename(path, quarantinePath)) {
            return { status: 'quarantined', reason: `${parsed.reason}；隔离失败`, path, warning: cleanupWarning }
          }
          // 未来版本可能包含当前程序无法理解但仍然完整的数据。它必须保持隔离，
          // 不能用旧 backup 自动降级后继续写入，从而掩盖或覆盖较新的历史。
          if (!parsed.canRestoreBackup) {
            return { status: 'quarantined', reason: parsed.reason, path: quarantinePath, warning: cleanupWarning }
          }
          const restored = await restoreLatestValidBackup(files, path, backups)
          if (restored.status === 'restored') {
            if (restored.migrated) {
              const saved = await saveInternal(projectPath, restored.document, true)
              if (!saved.ok) return { status: 'failed', reason: `备份恢复后迁移保存失败：${saved.error}`, path }
              loadedRawContent = restored.rawContent
              return {
                status: 'loaded',
                document: restored.document,
                warning: joinWarnings(cleanupWarning, `损坏活动文档已隔离到 ${quarantinePath}`, saved.warning),
              }
            }
            loadedRawContent = restored.rawContent
            return {
              status: 'loaded',
              document: restored.document,
              warning: joinWarnings(cleanupWarning, `损坏活动文档已隔离到 ${quarantinePath}`),
            }
          }
          if (restored.status === 'error') return { status: 'failed', reason: restored.error, path }
          return { status: 'quarantined', reason: parsed.reason, path: quarantinePath, warning: cleanupWarning }
        }

        if (futureQuarantines.length > 0) {
          return { status: 'quarantined', reason: '发现未知未来 schema 的隔离对话文档', path: futureQuarantines[0], warning: cleanupWarning }
        }
        const restored = await restoreLatestValidBackup(files, path, backups)
        if (restored.status === 'restored') {
          if (restored.migrated) {
            const saved = await saveInternal(projectPath, restored.document, true)
            if (!saved.ok) return { status: 'failed', reason: `备份恢复后迁移保存失败：${saved.error}`, path }
            loadedRawContent = restored.rawContent
            return { status: 'loaded', document: restored.document, warning: joinWarnings(cleanupWarning, '已从崩溃备份恢复对话', saved.warning) }
          }
          loadedRawContent = restored.rawContent
          return { status: 'loaded', document: restored.document, warning: joinWarnings(cleanupWarning, '已从崩溃备份恢复对话') }
        }
        if (restored.status === 'error') return { status: 'failed', reason: restored.error, path }
        if (quarantines.length > 0) {
          return { status: 'quarantined', reason: '发现先前隔离的对话文档', path: quarantines[0], warning: cleanupWarning }
        }
        return { status: 'missing', warning: cleanupWarning }
      }).catch(error => ({ status: 'failed' as const, reason: errorMessage(error), path: activePath(projectPath) }))
        .then(result => {
          const elapsedMs = performance.now() - startedAt
          if (result.status === 'loaded' && loadedRawContent !== null) {
            performanceTracker.record('load', elapsedMs, utf8ByteLength(loadedRawContent), messageCount(result.document))
          }
          return result
        })
    },

    save(projectPath, document) {
      const startedAt = performance.now()
      let serializedContent: string | null = null
      return runExclusive(async () => {
        try {
          return await saveInternal(projectPath, document, false, content => { serializedContent = content })
        } catch (error) {
          return { ok: false as const, error: errorMessage(error), certainty: 'uncertain' as const }
        }
      }).then(result => {
        const elapsedMs = performance.now() - startedAt
        if (serializedContent !== null) {
          performanceTracker.record('save', elapsedMs, utf8ByteLength(serializedContent), messageCount(document))
        }
        return result
      })
    },

    archiveAndReset(projectPath, document, resetAt) {
      return runExclusive(async () => {
        try {
          const parsed = parseConversationDocument(document)
          if (!parsed.ok) return { ok: false as const, error: parsed.reason, certainty: 'unchanged' as const }
          if (!Number.isFinite(Date.parse(resetAt))) return { ok: false as const, error: '重置时间无效', certainty: 'unchanged' as const }
          const archiveDir = archivesDirectory(projectPath)
          if (!await files.mkdir(archiveDir)) return { ok: false as const, error: '无法创建归档目录', certainty: 'unchanged' as const }
          const archiveId = await allocateArchiveId(files, archiveDir, createId)
          if (!archiveId) return { ok: false as const, error: '无法分配唯一归档 ID', certainty: 'unchanged' as const }
          const archivePath = `${archiveDir}/${archiveId}.json`
          const temporary = `${archivePath}.tmp-${now()}-${safeId(createId())}`
          const content = JSON.stringify(document, null, 2)
          if (!await files.writeFile(temporary, content)) {
            const cleaned = await files.remove(temporary)
            return { ok: false as const, error: cleaned ? '无法写入归档临时文件' : '无法写入归档临时文件，且清理失败', certainty: 'unchanged' as const }
          }
          const staged = await files.readFile(temporary)
          if (staged.status !== 'found') {
            await files.remove(temporary)
            return { ok: false as const, error: '归档临时文件读回校验失败', certainty: 'unchanged' as const }
          }
          const stagedDocument = parseSavedDocument(staged.value)
          if (staged.status !== 'found' || !stagedDocument || staged.value !== content || !documentsEqual(stagedDocument, document)) {
            await files.remove(temporary)
            return { ok: false as const, error: '归档临时文件读回校验失败', certainty: 'unchanged' as const }
          }
          if (!await files.rename(temporary, archivePath)) {
            await files.remove(temporary)
            return { ok: false as const, error: '无法原子发布归档文件', certainty: 'unchanged' as const }
          }
          const published = await files.readFile(archivePath)
          const publishedDocument = published.status === 'found' ? parseSavedDocument(published.value) : null
          if (published.status !== 'found' || !publishedDocument || published.value !== content || !documentsEqual(publishedDocument, document)) {
            return { ok: false as const, error: '归档发布后读回校验失败，活动对话未重置', certainty: 'unchanged' as const }
          }
          const reset = await saveInternal(projectPath, createConversationDocument(new Date(resetAt).toISOString()))
          if (!reset.ok) return { ok: false as const, error: `归档已保留，但活动对话重置失败：${reset.error}`, certainty: reset.certainty }
          return { ok: true as const, archiveId }
        } catch (error) {
          return { ok: false as const, error: errorMessage(error), certainty: 'uncertain' as const }
        }
      })
    },

    listArchives(projectPath) {
      return runExclusive(async () => {
        try {
          const listing = await files.readDirectory(archivesDirectory(projectPath))
          if (listing.status === 'error') return { ok: false as const, error: listing.error }
          if (listing.status === 'missing') return { ok: true as const, archives: [] }
          const archives: ConversationArchiveSummary[] = []
          for (const entry of listing.value) {
            const name = fileName(entry)
            if (!name.endsWith('.json')) continue
            const archiveId = name.slice(0, -'.json'.length)
            if (!isSafeArchiveId(archiveId)) continue
            const content = await files.readFile(`${archivesDirectory(projectPath)}/${name}`)
            if (content.status === 'error') return { ok: false as const, error: `无法读取归档 ${archiveId}：${content.error}` }
            if (content.status !== 'found') continue
            const document = parseSavedDocument(content.value)
            if (!document) continue
            archives.push({ archiveId, createdAt: document.createdAt, updatedAt: document.updatedAt, turnCount: document.turns.length, bytes: new TextEncoder().encode(content.value).byteLength })
          }
          archives.sort((left, right) => right.createdAt.localeCompare(left.createdAt) || left.archiveId.localeCompare(right.archiveId))
          return { ok: true as const, archives }
        } catch (error) {
          return { ok: false as const, error: errorMessage(error) }
        }
      })
    },

    readArchive(projectPath, archiveId) {
      return runExclusive(async () => {
        try { return await readArchiveInternal(projectPath, archiveId) }
        catch (error) { return { ok: false as const, error: errorMessage(error) } }
      })
    },

    listQuarantines(projectPath) {
      return runExclusive(async () => {
        try {
          const listing = await files.readDirectory(directory(projectPath))
          if (listing.status === 'error') return { ok: false as const, error: listing.error }
          if (listing.status === 'missing') return { ok: true as const, quarantines: [] }
          const quarantines: ConversationQuarantineSummary[] = []
          for (const entry of listing.value) {
            const quarantineId = fileName(entry)
            if (!isSafeQuarantineId(quarantineId)) continue
            const result = await readQuarantineInternal(projectPath, quarantineId)
            if (!result.ok) return { ok: false as const, error: result.error }
            quarantines.push({ quarantineId, reason: result.reason, schemaVersion: result.schemaVersion, bytes: new TextEncoder().encode(result.rawJson).byteLength, recoverable: result.recoverable })
          }
          quarantines.sort((left, right) => left.quarantineId.localeCompare(right.quarantineId))
          return { ok: true as const, quarantines }
        } catch (error) { return { ok: false as const, error: errorMessage(error) } }
      })
    },

    readQuarantine(projectPath, quarantineId) {
      return runExclusive(async () => {
        try { return await readQuarantineInternal(projectPath, quarantineId) }
        catch (error) { return { ok: false as const, error: errorMessage(error) } }
      })
    },

    restoreQuarantine(projectPath, quarantineId) {
      return runExclusive(async () => {
        try {
          if (!isSafeQuarantineId(quarantineId)) return { ok: false as const, error: '隔离文档 ID 无效', certainty: 'unchanged' as const }
          const path = activePath(projectPath)
          const active = await files.readFile(path)
          if (active.status === 'found') return { ok: false as const, error: '活动对话已存在，拒绝覆盖', certainty: 'unchanged' as const }
          if (active.status === 'error') return { ok: false as const, error: '无法确认活动对话状态：' + active.error, certainty: 'uncertain' as const }
          const quarantine = await readQuarantineInternal(projectPath, quarantineId)
          if (!quarantine.ok) return { ok: false as const, error: quarantine.error, certainty: 'unchanged' as const }
          if (!quarantine.recoverable || !quarantine.document) return { ok: false as const, error: '隔离文档不可恢复：' + quarantine.reason, certainty: 'unchanged' as const }
          const saved = await saveIfMissing(files, path, quarantine.document, uniqueSibling(path, 'tmp'))
          if (!saved.ok) return { ok: false as const, error: saved.error, certainty: saved.certainty }
          return { ok: true as const, quarantineId, document: quarantine.document, migrated: quarantine.migrated }
        } catch (error) { return { ok: false as const, error: errorMessage(error), certainty: 'uncertain' as const } }
      })
    },
  }
}

type ParsedRaw =
  | { ok: true; document: ConversationDocument; migrated: boolean }
  | { ok: false; reason: string; canRestoreBackup: boolean }


async function saveIfMissing(
  files: ConversationFilePort,
  target: string,
  document: ConversationDocument,
  temporary: string,
): Promise<ConversationSaveResult> {
  const content = JSON.stringify(document, null, 2)
  if (!await files.writeFile(temporary, content)) {
    const cleaned = await files.remove(temporary)
    return unchanged(cleaned ? '无法写入恢复临时文件' : '无法写入恢复临时文件，且清理失败')
  }
  const staged = await files.readFile(temporary)
  if (staged.status !== 'found') {
    await files.remove(temporary)
    return unchanged('恢复临时文档读回校验失败')
  }
  const stagedDocument = parseSavedDocument(staged.value)
  if (!stagedDocument || staged.value !== content || !documentsEqual(stagedDocument, document)) {
    await files.remove(temporary)
    return unchanged('恢复临时文档读回校验失败')
  }
  const published = await files.linkNoReplace(temporary, target)
  if (published.status === 'exists') {
    await files.remove(temporary)
    return unchanged('活动对话已存在，拒绝覆盖')
  }
  if (published.status !== 'linked') {
    await files.remove(temporary)
    return { ok: false, error: '无法以 no-replace 方式发布恢复文档', certainty: 'uncertain' }
  }
  const restored = await files.readFile(target)
  const restoredDocument = restored.status === 'found' ? parseSavedDocument(restored.value) : null
  if (restored.status !== 'found' || !restoredDocument || restored.value !== content || !documentsEqual(restoredDocument, document)) {
    await files.remove(temporary)
    return { ok: false, error: '恢复后活动文档读回校验失败', certainty: 'uncertain' }
  }
  const cleaned = await files.remove(temporary)
  return cleaned ? { ok: true } : { ok: true, warning: '活动对话已恢复，但临时文件清理失败' }
}

async function allocateArchiveId(files: ConversationFilePort, archiveDir: string, createId: () => string): Promise<string | null> {
  for (let attempt = 0; attempt < 10; attempt += 1) {
    const base = safeId(createId())
    const candidate = attempt === 0 ? base : `${base}-${attempt}`
    if (!isSafeArchiveId(candidate)) continue
    const existing = await files.readFile(`${archiveDir}/${candidate}.json`)
    if (existing.status === 'missing') return candidate
    if (existing.status === 'error') return null
  }
  return null
}

function parseRawDocument(content: string): ParsedRaw {
  let raw: unknown
  try {
    raw = JSON.parse(content)
  } catch {
    return { ok: false, reason: 'JSON 损坏', canRestoreBackup: true }
  }
  const migrated = migrateConversationDocument(raw)
  if (migrated.ok) return migrated
  const schemaVersion = raw && typeof raw === 'object' && !Array.isArray(raw)
    ? (raw as Record<string, unknown>).schemaVersion
    : undefined
  return {
    ok: false,
    reason: migrated.reason,
    canRestoreBackup: schemaVersion === undefined || (typeof schemaVersion === 'number' && Number.isSafeInteger(schemaVersion) && schemaVersion >= 1 && schemaVersion <= CURRENT_CONVERSATION_SCHEMA_VERSION),
  }
}

function messageCount(document: ConversationDocument): number {
  return document.turns.reduce((count, turn) => count + 1 + (turn.assistantText === null ? 0 : 1), 0)
}

function utf8ByteLength(value: string): number {
  let bytes = 0
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index)
    if (code <= 0x7f) bytes += 1
    else if (code <= 0x7ff) bytes += 2
    else if (code >= 0xd800 && code <= 0xdbff && index + 1 < value.length && value.charCodeAt(index + 1) >= 0xdc00 && value.charCodeAt(index + 1) <= 0xdfff) {
      bytes += 4
      index += 1
    } else bytes += 3
  }
  return bytes
}

function parseSavedDocument(content: string): ConversationDocument | null {
  try {
    const parsed = parseConversationDocument(JSON.parse(content))
    return parsed.ok ? parsed.document : null
  } catch {
    return null
  }
}

async function restoreLatestValidBackup(
  files: ConversationFilePort,
  active: string,
  backups: readonly string[],
): Promise<
  | { status: 'none' }
  | { status: 'error'; error: string }
  | { status: 'restored'; document: ConversationDocument; migrated: boolean; rawContent: string }
> {
  for (const backup of backups) {
    const content = await files.readFile(backup)
    if (content.status === 'error') return { status: 'error', error: `无法读取备份 ${backup}：${content.error}` }
    if (content.status === 'missing') continue
    const parsed = parseRawDocument(content.value)
    if (!parsed.ok) continue
    if (!await files.rename(backup, active)) return { status: 'error', error: `无法恢复备份 ${backup}` }
    const verified = await files.readFile(active)
    if (verified.status !== 'found' || verified.value !== content.value) return { status: 'error', error: `备份恢复后读回校验失败：${backup}` }
    return { status: 'restored', document: parsed.document, migrated: parsed.migrated, rawContent: content.value }
  }
  return { status: 'none' }
}

async function cleanupStaleTemps(files: ConversationFilePort, entries: readonly string[]): Promise<string | undefined> {
  const stale = entries.filter(entry => fileName(entry).startsWith('conversation.json.tmp-'))
  const failed: string[] = []
  for (const path of stale) {
    if (!await files.remove(path)) failed.push(path)
  }
  return failed.length > 0 ? `以下临时文件清理失败：${failed.join('、')}` : undefined
}

async function rollback(
  files: ConversationFilePort,
  active: string,
  backup: string,
  previousContent: string | null,
): Promise<boolean> {
  const current = await files.readFile(active)
  if (current.status === 'error') return false
  if (previousContent !== null && current.status === 'found' && current.value === previousContent) {
    return true
  }
  if (current.status === 'found' && !await files.remove(active)) return false
  if (previousContent === null) {
    const verified = await files.readFile(active)
    return verified.status === 'missing'
  }
  if (!await files.rename(backup, active)) return false
  const verified = await files.readFile(active)
  return verified.status === 'found' && verified.value === previousContent
}

async function verifyOriginalState(
  files: ConversationFilePort,
  active: string,
  backup: string,
  previousContent: string,
): Promise<'unchanged' | 'uncertain'> {
  const [activeResult, backupResult] = await Promise.all([files.readFile(active), files.readFile(backup)])
  return activeResult.status === 'found' && activeResult.value === previousContent && backupResult.status === 'missing'
    ? 'unchanged'
    : 'uncertain'
}

function documentsEqual(left: ConversationDocument, right: ConversationDocument): boolean {
  return canonicalJson(left) === canonicalJson(right)
}

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`
  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>
    return `{${Object.keys(record).sort().map(key => `${JSON.stringify(key)}:${canonicalJson(record[key])}`).join(',')}}`
  }
  return JSON.stringify(value)
}

function normalizeEntry(projectPath: string, entry: string): string {
  return entry.includes('/') || entry.includes('\\') ? entry : `${directory(projectPath)}/${entry}`
}

function fileName(path: string): string {
  return path.split(/[\\/]/).pop() ?? path
}

function isSafeArchiveId(value: string): boolean {
  return /^[a-zA-Z0-9_-]{1,100}$/.test(value) && value !== '.' && value !== '..'
}

function isSafeQuarantineId(value: string): boolean {
  return /^conversation\.json\.quarantine(?:-future)?-[0-9]+-[a-zA-Z0-9_-]{1,100}$/.test(value)
}

function readSchemaVersion(content: string): number | null {
  try {
    const raw: unknown = JSON.parse(content)
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null
    const version = (raw as Record<string, unknown>).schemaVersion
    return typeof version === 'number' && Number.isSafeInteger(version) ? version : null
  } catch { return null }
}

function safeId(value: string): string {
  const safe = value.replace(/[^a-zA-Z0-9_-]/g, '-').slice(0, 100)
  return safe || 'unknown'
}

function unchanged(error: string): ConversationSaveResult {
  return { ok: false, error, certainty: 'unchanged' }
}

function joinWarnings(...warnings: Array<string | undefined>): string | undefined {
  const present = warnings.filter((warning): warning is string => Boolean(warning))
  return present.length > 0 ? present.join('；') : undefined
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
