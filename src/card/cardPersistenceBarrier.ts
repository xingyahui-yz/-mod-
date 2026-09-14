type BarrierListener = () => void

interface BarrierEntry {
  count: number
  listeners: Set<BarrierListener>
}

export interface CardPersistenceBarrierLease {
  release(): void
}

const barriersByProject = new Map<string, Map<string, BarrierEntry>>()

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
    entry = { count: 0, listeners: new Set() }
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
  entry.count += 1
  if (!wasBlocked) notify(entry)

  let released = false
  return {
    release() {
      if (released) return
      released = true
      entry.count -= 1
      if (entry.count === 0) notify(entry)
      removeUnusedEntry(projectRoot, cardId, entry)
    },
  }
}

/** React useSyncExternalStore 可直接把这个布尔值作为稳定 snapshot。 */
export function isCardPersistenceBlocked(projectRoot: string, cardId: string): boolean {
  return (findEntry(projectRoot, cardId)?.count ?? 0) > 0
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
