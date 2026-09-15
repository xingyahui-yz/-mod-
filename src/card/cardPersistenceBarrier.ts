type BarrierListener = () => void

interface BarrierEntry {
  count: number
  listeners: Set<BarrierListener>
  failed: boolean
}

export interface CardPersistenceBarrierLease {
  release(outcome?: 'persisted' | 'failed'): void
}

const barriersByProject = new Map<string, Map<string, BarrierEntry>>()
const failedPersistenceKeys = new Set<string>()

function persistenceKey(projectRoot: string, cardId: string): string {
  return `${projectRoot}\0${normalizedCardId(cardId)}`
}

function normalizedCardId(cardId: string): string {
  return cardId.toLowerCase()
}

function findEntry(projectRoot: string, cardId: string): BarrierEntry | undefined {
  return barriersByProject.get(projectRoot)?.get(normalizedCardId(cardId))
}

function entryFor(projectRoot: string, cardId: string): BarrierEntry {
  const normalizedId = normalizedCardId(cardId)
  let projectEntries = barriersByProject.get(projectRoot)
  if (!projectEntries) {
    projectEntries = new Map()
    barriersByProject.set(projectRoot, projectEntries)
  }
  let entry = projectEntries.get(normalizedId)
  if (!entry) {
    entry = { count: 0, listeners: new Set(), failed: false }
    projectEntries.set(normalizedId, entry)
  }
  return entry
}

function removeUnusedEntry(projectRoot: string, cardId: string, entry: BarrierEntry): void {
  if (entry.count > 0 || entry.listeners.size > 0) return
  const projectEntries = barriersByProject.get(projectRoot)
  projectEntries?.delete(normalizedCardId(cardId))
  if (projectEntries?.size === 0) barriersByProject.delete(projectRoot)
}

function notify(entry: BarrierEntry): void {
  for (const listener of [...entry.listeners]) {
    try {
      listener()
    } catch {
      // 一个观察者失败不能阻止其他 Card 持久化观察者收到边界变化。
    }
  }
}

/**
 * 在跨文件 Card 事务开始时同步获取 lease。相同项目、相同 Card 的嵌套
 * lease 共享一个 barrier；只有最后一个 lease 释放时，后继写入才可继续。
 */
export function acquireCardPersistenceBarrier(
  projectRoot: string,
  cardId: string,
): CardPersistenceBarrierLease {
  const entry = entryFor(projectRoot, cardId)
  const wasBlocked = entry.count > 0
  if (!wasBlocked) entry.failed = false
  entry.count += 1
  if (!wasBlocked) notify(entry)

  let released = false
  return {
    release(outcome = 'persisted') {
      if (released) return
      released = true
      if (outcome === 'failed') entry.failed = true
      entry.count -= 1
      if (entry.count === 0) {
        const key = persistenceKey(projectRoot, cardId)
        if (entry.failed) failedPersistenceKeys.add(key)
        else failedPersistenceKeys.delete(key)
        notify(entry)
      }
      removeUnusedEntry(projectRoot, cardId, entry)
    },
  }
}

/** React useSyncExternalStore 可直接把这个布尔值作为稳定 snapshot。 */
export function isCardPersistenceBlocked(projectRoot: string, cardId: string): boolean {
  return (findEntry(projectRoot, cardId)?.count ?? 0) > 0
}

/** 最近一次跨文件事务失败后保持为 true，直到项目成功重载。 */
export function hasCardPersistenceFailure(projectRoot: string, cardId: string): boolean {
  return failedPersistenceKeys.has(persistenceKey(projectRoot, cardId))
}

export function clearCardPersistenceFailures(projectRoot: string): void {
  const prefix = `${projectRoot}\0`
  for (const key of failedPersistenceKeys) {
    if (key.startsWith(prefix)) failedPersistenceKeys.delete(key)
  }
}

/** 只在 barrier 的可写/阻塞边界变化时通知，不暴露内部计数。 */
export function subscribeCardPersistenceBarrier(
  projectRoot: string,
  cardId: string,
  listener: BarrierListener,
): () => void {
  const entry = entryFor(projectRoot, cardId)
  entry.listeners.add(listener)
  return () => {
    entry.listeners.delete(listener)
    removeUnusedEntry(projectRoot, cardId, entry)
  }
}

/** 在最后一个跨文件事务 lease 释放后继续；已可写时立即完成。 */
export function waitForCardPersistenceBarrier(
  projectRoot: string,
  cardId: string,
): Promise<boolean> {
  if (!isCardPersistenceBlocked(projectRoot, cardId)) {
    return Promise.resolve(!hasCardPersistenceFailure(projectRoot, cardId))
  }
  const entry = findEntry(projectRoot, cardId)!
  return new Promise(resolve => {
    const unsubscribe = subscribeCardPersistenceBarrier(projectRoot, cardId, () => {
      if (isCardPersistenceBlocked(projectRoot, cardId)) return
      unsubscribe()
      resolve(!entry.failed)
    })
  })
}
