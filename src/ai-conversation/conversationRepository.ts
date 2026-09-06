import { migrateConversationDocument, parseConversationDocument, type ConversationDocumentV1 } from './conversationDocument'

export type ConversationFileRead<T> =
  | { status: 'found'; value: T }
  | { status: 'missing' }
  | { status: 'error'; error: string }

export interface ConversationFilePort {
  readFile(path: string): Promise<ConversationFileRead<string>>
  readDirectory(path: string): Promise<ConversationFileRead<readonly string[]>>
  writeFile(path: string, content: string): Promise<boolean>
  rename(from: string, to: string): Promise<boolean>
  mkdir(path: string): Promise<boolean>
  remove(path: string): Promise<boolean>
}

export type ConversationSaveResult =
  | { ok: true; warning?: string }
  | { ok: false; error: string; certainty: 'unchanged' | 'uncertain' }

export type ConversationLoadResult =
  | { status: 'missing'; warning?: string }
  | { status: 'loaded'; document: ConversationDocumentV1; warning?: string }
  | { status: 'quarantined'; reason: string; path: string; warning?: string }
  | { status: 'failed'; reason: string; path: string }

export interface ConversationRepository {
  load(projectPath: string): Promise<ConversationLoadResult>
  save(projectPath: string, document: ConversationDocumentV1): Promise<ConversationSaveResult>
}

const directory = (projectPath: string) => `${projectPath}/.modstudio/ai`
const activePath = (projectPath: string) => `${directory(projectPath)}/conversation.json`

export function createConversationRepository(
  files: ConversationFilePort,
  now: () => number = Date.now,
  createId: () => string = () => crypto.randomUUID(),
): ConversationRepository {
  let transaction = Promise.resolve()

  const runExclusive = <T>(operation: () => Promise<T>): Promise<T> => {
    const result = transaction.then(operation, operation)
    transaction = result.then(() => undefined, () => undefined)
    return result
  }

  const uniqueSibling = (path: string, kind: 'tmp' | 'backup' | 'quarantine' | 'quarantine-future') =>
    `${path}.${kind}-${now()}-${safeId(createId())}`

  const saveInternal = async (
    projectPath: string,
    document: ConversationDocumentV1,
    retainBackup = false,
  ): Promise<ConversationSaveResult> => {
    const parsed = parseConversationDocument(document)
    if (!parsed.ok) return unchanged(parsed.reason)
    if (!await files.mkdir(directory(projectPath))) return unchanged('无法创建对话目录')

    const path = activePath(projectPath)
    const temporary = uniqueSibling(path, 'tmp')
    const backup = uniqueSibling(path, 'backup')
    const content = JSON.stringify(document, null, 2)
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

  return {
    load(projectPath) {
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
              return {
                status: 'loaded',
                document: restored.document,
                warning: joinWarnings(cleanupWarning, `损坏活动文档已隔离到 ${quarantinePath}`, saved.warning),
              }
            }
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
            return { status: 'loaded', document: restored.document, warning: joinWarnings(cleanupWarning, '已从崩溃备份恢复对话', saved.warning) }
          }
          return { status: 'loaded', document: restored.document, warning: joinWarnings(cleanupWarning, '已从崩溃备份恢复对话') }
        }
        if (restored.status === 'error') return { status: 'failed', reason: restored.error, path }
        if (quarantines.length > 0) {
          return { status: 'quarantined', reason: '发现先前隔离的对话文档', path: quarantines[0], warning: cleanupWarning }
        }
        return { status: 'missing', warning: cleanupWarning }
      }).catch(error => ({ status: 'failed' as const, reason: errorMessage(error), path: activePath(projectPath) }))
    },

    save(projectPath, document) {
      return runExclusive(async () => {
        try {
          return await saveInternal(projectPath, document)
        } catch (error) {
          return { ok: false as const, error: errorMessage(error), certainty: 'uncertain' as const }
        }
      })
    },
  }
}

type ParsedRaw =
  | { ok: true; document: ConversationDocumentV1; migrated: boolean }
  | { ok: false; reason: string; canRestoreBackup: boolean }

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
    canRestoreBackup: schemaVersion === undefined || schemaVersion === 1,
  }
}

function parseSavedDocument(content: string): ConversationDocumentV1 | null {
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
  | { status: 'restored'; document: ConversationDocumentV1; migrated: boolean }
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
    return { status: 'restored', document: parsed.document, migrated: parsed.migrated }
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

function documentsEqual(left: ConversationDocumentV1, right: ConversationDocumentV1): boolean {
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
