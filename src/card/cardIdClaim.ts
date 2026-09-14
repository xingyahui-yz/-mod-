export interface CardIdClaimFilePort {
  mkdir(path: string): Promise<boolean>
  linkNoReplace(from: string, to: string): Promise<{ status: 'linked' | 'exists' | 'failed' }>
  remove(path: string): Promise<boolean>
}

export type CardIdClaimResult =
  | { status: 'acquired'; release(): Promise<void> }
  | { status: 'occupied' | 'failed' }

function joinPath(...parts: string[]): string {
  return parts
    .map((part, index) => index === 0 ? part.replace(/\/+$/, '') : part.replace(/^\/+|\/+$/g, ''))
    .filter(Boolean)
    .join('/')
}

/**
 * 在大小写敏感文件系统上也用同一个小写路径串行化 Card ID 占用。
 * claim 由待发布文件的 hard link 构成，不包含额外内容；正式目标建立后
 * 才释放。若进程在中途退出，遗留 claim 会安全地阻止重用 ID，而不会覆盖
 * 任何用户文件。
 */
export async function acquireCardIdClaim(
  files: CardIdClaimFilePort,
  cardsRoot: string,
  cardId: string,
  sourcePath: string,
): Promise<CardIdClaimResult> {
  const claimsRoot = joinPath(cardsRoot, '.id-claims')
  if (!await files.mkdir(claimsRoot)) return { status: 'failed' }

  const claimPath = joinPath(claimsRoot, `${cardId.toLowerCase()}.claim`)
  const linked = await files.linkNoReplace(sourcePath, claimPath)
    .catch(() => ({ status: 'failed' as const }))
  if (linked.status !== 'linked') return { status: linked.status === 'exists' ? 'occupied' : 'failed' }

  let released = false
  return {
    status: 'acquired',
    async release() {
      if (released) return
      released = true
      await files.remove(claimPath).catch(() => false)
    },
  }
}
