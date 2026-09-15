export interface CardIdReservation {
  release(): void
}

const reservations = new Set<string>()

function reservationKey(projectRoot: string, cardId: string): string {
  return `${projectRoot}\0${cardId.toLowerCase()}`
}

/**
 * 同一 renderer 内创建入口的同步 reservation。磁盘层仍由 lowercase
 * claim 防外部竞争；这里防止导入、手工创建与 AI 接受在 await 期间重入。
 */
export function reserveCardId(projectRoot: string, cardId: string): CardIdReservation | null {
  const key = reservationKey(projectRoot, cardId)
  if (reservations.has(key)) return null
  reservations.add(key)
  let released = false
  return {
    release() {
      if (released) return
      released = true
      reservations.delete(key)
    },
  }
}
