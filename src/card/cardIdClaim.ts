export interface CardIdClaimFileEntry {
  name: string
  isDirectory: boolean
  path: string
}

export interface CardIdClaimFilePort {
  readDirectory(path: string): Promise<CardIdClaimFileEntry[]>
  readFile(path: string): Promise<string | null>
  mkdir(path: string): Promise<boolean>
  writeFile(path: string, content: string): Promise<boolean>
  rename(from: string, to: string): Promise<boolean>
  linkNoReplace(from: string, to: string): Promise<{ status: 'linked' | 'exists' | 'failed' }>
  remove(path: string): Promise<boolean>
}

export interface CardIdClaimOptions {
  sessionId?: string
  operationId?: string
}

export type CardIdClaimReleaseResult =
  | { status: 'released' }
  | { status: 'failed'; error: string; certainty: 'uncertain' }

export type CardIdClaimResult =
  | { status: 'acquired'; release(): Promise<CardIdClaimReleaseResult> }
  | { status: 'occupied' | 'failed' }

export type CardIdClaimRecoveryResult =
  | { status: 'recovered'; count: number }
  | { status: 'failed'; error: string; certainty: 'uncertain' }

interface CardIdClaimRecord {
  kind: 'mod-studio-card-id-claim'
  version: 1
  normalizedCardId: string
  sessionId: string
  operationId: string
}

const CLAIM_KIND = 'mod-studio-card-id-claim'
const CLAIM_VERSION = 1

function token(prefix: string): string {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`
}

const defaultSessionId = token('session')

/** 当前 renderer session 内仍在执行的 owner；用于避免 load/recovery 偷走本进程活锁。 */
const activeOwners = new Map<string, Map<string, number>>()

function markActiveOwner(claimPath: string, serialized: string): void {
  const owners = activeOwners.get(claimPath) ?? new Map<string, number>()
  owners.set(serialized, (owners.get(serialized) ?? 0) + 1)
  activeOwners.set(claimPath, owners)
}

function unmarkActiveOwner(claimPath: string, serialized: string): void {
  const owners = activeOwners.get(claimPath)
  if (!owners) return
  const count = owners.get(serialized) ?? 0
  if (count <= 1) owners.delete(serialized)
  else owners.set(serialized, count - 1)
  if (owners.size === 0) activeOwners.delete(claimPath)
}

function joinPath(...parts: string[]): string {
  return parts
    .map((part, index) => index === 0 ? part.replace(/\/+$/, '') : part.replace(/^\/+|\/+$/g, ''))
    .filter(Boolean)
    .join('/')
}

function isOwnerToken(value: string): boolean {
  return value.length > 0 && value.length <= 160 && /^[A-Za-z0-9_-]+$/.test(value)
}

function serializeClaim(record: CardIdClaimRecord): string {
  return JSON.stringify(record)
}

function parseClaim(raw: string): CardIdClaimRecord | null {
  let value: unknown
  try {
    value = JSON.parse(raw)
  } catch {
    return null
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const record = value as Record<string, unknown>
  const keys = Object.keys(record).sort()
  if (keys.join('\0') !== ['kind', 'normalizedCardId', 'operationId', 'sessionId', 'version'].sort().join('\0')) {
    return null
  }
  if (record.kind !== CLAIM_KIND || record.version !== CLAIM_VERSION ||
    typeof record.normalizedCardId !== 'string' || !/^[a-z0-9_-]+$/.test(record.normalizedCardId) ||
    typeof record.sessionId !== 'string' || !isOwnerToken(record.sessionId) ||
    typeof record.operationId !== 'string' || !isOwnerToken(record.operationId)) {
    return null
  }
  return {
    kind: CLAIM_KIND,
    version: CLAIM_VERSION,
    normalizedCardId: record.normalizedCardId,
    sessionId: record.sessionId,
    operationId: record.operationId,
  }
}

function claimsRoot(cardsRoot: string): string {
  return joinPath(cardsRoot, '.id-claims')
}

function claimPathFor(root: string, normalizedCardId: string): string {
  return joinPath(root, `${normalizedCardId}.claim`)
}

async function safeRead(files: CardIdClaimFilePort, path: string): Promise<
  | { status: 'found'; value: string }
  | { status: 'missing' }
  | { status: 'failed' }
> {
  try {
    const value = await files.readFile(path)
    return value === null ? { status: 'missing' } : { status: 'found', value }
  } catch {
    return { status: 'failed' }
  }
}

async function restoreMovedClaim(
  files: CardIdClaimFilePort,
  movedPath: string,
  claimPath: string,
  expected: string,
): Promise<boolean> {
  const restored = await files.linkNoReplace(movedPath, claimPath)
    .catch(() => ({ status: 'failed' as const }))
  if (restored.status !== 'linked') return false
  const readBack = await safeRead(files, claimPath)
  if (readBack.status !== 'found' || readBack.value !== expected) return false
  await files.remove(movedPath).catch(() => false)
  return true
}

async function recoverClaimPath(
  files: CardIdClaimFilePort,
  claimPath: string,
  expectedNormalizedCardId: string,
  sessionId: string,
): Promise<'absent' | 'active' | 'recovered' | 'failed'> {
  const current = await safeRead(files, claimPath)
  if (current.status === 'missing') return 'absent'
  if (current.status === 'failed') return 'failed'
  const record = parseClaim(current.value)
  if (!record || record.normalizedCardId !== expectedNormalizedCardId) return 'failed'

  const serialized = serializeClaim(record)
  if (record.sessionId === sessionId && (activeOwners.get(claimPath)?.get(serialized) ?? 0) > 0) {
    return 'active'
  }

  // Electron main 持有 single-instance lock，因此另一 session 的合法 owner
  // 必然来自已经终止的进程。同 session 但不在 activeOwners 中则是 release
  // 中断后的遗留。先把固定 claim 原子移到 owner 专属恢复路径；读回不一致时
  // 立即 no-replace 复原并 fail closed，绝不删除未知或竞争者记录。
  const recoveryPath = `${claimPath}-recovered-${sessionId}-${token('operation')}`
  if (!await files.rename(claimPath, recoveryPath).catch(() => false)) return 'failed'
  const moved = await safeRead(files, recoveryPath)
  if (moved.status !== 'found' || moved.value !== current.value) {
    if (moved.status === 'found') await restoreMovedClaim(files, recoveryPath, claimPath, moved.value)
    return 'failed'
  }
  if (!await files.remove(recoveryPath).catch(() => false)) return 'failed'
  unmarkActiveOwner(claimPath, serialized)
  return 'recovered'
}

/**
 * 回收 prior-session 或当前 session 已不再 active 的合法 owner claim。
 * 未知 schema、损坏 JSON、Card ID 不匹配及任意读写不确定性都 fail closed。
 */
export async function recoverCardIdClaims(
  files: CardIdClaimFilePort,
  cardsRoot: string,
  options: Pick<CardIdClaimOptions, 'sessionId'> = {},
): Promise<CardIdClaimRecoveryResult> {
  const root = claimsRoot(cardsRoot)
  const sessionId = options.sessionId ?? defaultSessionId
  if (!isOwnerToken(sessionId)) {
    return { status: 'failed', error: 'Card ID claim session 无效', certainty: 'uncertain' }
  }

  let entries: CardIdClaimFileEntry[]
  try {
    entries = await files.readDirectory(root)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    if (message.includes('ENOENT') || message.includes('not found') || message.includes('不存在')) {
      return { status: 'recovered', count: 0 }
    }
    return { status: 'failed', error: '无法扫描 Card ID claim', certainty: 'uncertain' }
  }

  let count = 0
  for (const entry of entries) {
    if (entry.isDirectory || !entry.name.endsWith('.claim')) continue
    const normalizedCardId = entry.name.slice(0, -'.claim'.length)
    if (!/^[a-z0-9_-]+$/.test(normalizedCardId)) {
      return { status: 'failed', error: '发现未知 Card ID claim', certainty: 'uncertain' }
    }
    const path = entry.path || claimPathFor(root, normalizedCardId)
    const recovered = await recoverClaimPath(files, path, normalizedCardId, sessionId)
    if (recovered === 'failed') {
      return { status: 'failed', error: `无法安全回收 Card ID claim：${normalizedCardId}`, certainty: 'uncertain' }
    }
    if (recovered === 'recovered') count += 1
  }
  return { status: 'recovered', count }
}

/**
 * 用小写固定路径串行化逻辑 Card ID。固定 claim 本身是严格的 owner JSON，
 * 包含 session 与 operation；发布源文件不再兼任锁记录。正常 release 先验证
 * owner，再原子移出阻塞路径，因此后续 tombstone 清理失败不会误删继任 owner。
 */
export async function acquireCardIdClaim(
  files: CardIdClaimFilePort,
  cardsRoot: string,
  cardId: string,
  _sourcePath: string,
  options: CardIdClaimOptions = {},
): Promise<CardIdClaimResult> {
  const root = claimsRoot(cardsRoot)
  if (!await files.mkdir(root)) return { status: 'failed' }

  const normalizedCardId = cardId.toLowerCase()
  const sessionId = options.sessionId ?? defaultSessionId
  const operationId = options.operationId ?? token('operation')
  if (!/^[a-z0-9_-]+$/.test(normalizedCardId) ||
    !isOwnerToken(sessionId) || !isOwnerToken(operationId)) {
    return { status: 'failed' }
  }

  const claimPath = claimPathFor(root, normalizedCardId)
  const recovered = await recoverClaimPath(files, claimPath, normalizedCardId, sessionId)
  if (recovered === 'active') return { status: 'occupied' }
  if (recovered === 'failed') return { status: 'failed' }

  const record: CardIdClaimRecord = {
    kind: CLAIM_KIND,
    version: CLAIM_VERSION,
    normalizedCardId,
    sessionId,
    operationId,
  }
  const serialized = serializeClaim(record)
  const ownerPath = `${claimPath}-owner-${sessionId}-${operationId}-${token('record')}`
  if (!await files.writeFile(ownerPath, serialized)) return { status: 'failed' }
  const ownerReadBack = await safeRead(files, ownerPath)
  if (ownerReadBack.status !== 'found' || ownerReadBack.value !== serialized) {
    await files.remove(ownerPath).catch(() => false)
    return { status: 'failed' }
  }

  markActiveOwner(claimPath, serialized)
  const linked = await files.linkNoReplace(ownerPath, claimPath)
    .catch(() => ({ status: 'failed' as const }))
  if (linked.status !== 'linked') {
    unmarkActiveOwner(claimPath, serialized)
    await files.remove(ownerPath).catch(() => false)
    return { status: linked.status === 'exists' ? 'occupied' : 'failed' }
  }
  const claimReadBack = await safeRead(files, claimPath)
  if (claimReadBack.status !== 'found' || claimReadBack.value !== serialized) {
    // acquire 不返回 handle，调用方不会继续使用该 ID；允许后续 acquire 重读
    // 并安全回收此可能发布的 claim，避免 renderer 内永久卡死。
    unmarkActiveOwner(claimPath, serialized)
    await files.remove(ownerPath).catch(() => false)
    return { status: 'failed' }
  }

  let releasePromise: Promise<CardIdClaimReleaseResult> | null = null
  return {
    status: 'acquired',
    release() {
      if (releasePromise) return releasePromise
      releasePromise = (async (): Promise<CardIdClaimReleaseResult> => {
        try {
          const current = await safeRead(files, claimPath)
          if (current.status !== 'found' || current.value !== serialized) {
            return {
              status: 'failed',
              error: 'Card ID claim owner 校验失败',
              certainty: 'uncertain',
            }
          }

          const releasedPath = `${claimPath}-released-${sessionId}-${operationId}-${token('cleanup')}`
          if (!await files.rename(claimPath, releasedPath).catch(() => false)) {
            return {
              status: 'failed',
              error: '无法原子释放 Card ID claim',
              certainty: 'uncertain',
            }
          }
          const moved = await safeRead(files, releasedPath)
          if (moved.status !== 'found' || moved.value !== serialized) {
            if (moved.status === 'found') await restoreMovedClaim(files, releasedPath, claimPath, moved.value)
            return {
              status: 'failed',
              error: 'Card ID claim 释放读回校验失败',
              certainty: 'uncertain',
            }
          }
          const releasedRemoved = await files.remove(releasedPath).catch(() => false)
          const ownerRemoved = await files.remove(ownerPath).catch(() => false)
          if (!releasedRemoved || !ownerRemoved) {
            return {
              status: 'failed',
              error: 'Card ID claim 已解除但清理失败',
              certainty: 'uncertain',
            }
          }
          return { status: 'released' }
        } finally {
          unmarkActiveOwner(claimPath, serialized)
        }
      })()
      return releasePromise
    },
  }
}
