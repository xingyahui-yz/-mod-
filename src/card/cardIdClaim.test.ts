import { describe, expect, it } from 'vitest'
import {
  acquireCardIdClaim,
  recoverCardIdClaims,
  type CardIdClaimFileEntry,
  type CardIdClaimFilePort,
} from './cardIdClaim'

class MemoryClaimFiles implements CardIdClaimFilePort {
  files = new Map<string, string>()
  failRename: ((from: string, to: string) => boolean) | null = null
  failRemove: ((path: string) => boolean) | null = null

  async readDirectory(path: string): Promise<CardIdClaimFileEntry[]> {
    const prefix = `${path}/`
    return [...this.files.keys()]
      .filter(file => file.startsWith(prefix) && !file.slice(prefix.length).includes('/'))
      .map(pathname => ({
        name: pathname.slice(prefix.length),
        path: pathname,
        isDirectory: false,
      }))
  }

  async readFile(path: string) {
    return this.files.get(path) ?? null
  }

  async mkdir() { return true }

  async writeFile(path: string, content: string) {
    this.files.set(path, content)
    return true
  }

  async rename(from: string, to: string) {
    if (this.failRename?.(from, to)) return false
    const content = this.files.get(from)
    if (content === undefined) return false
    this.files.delete(from)
    this.files.set(to, content)
    return true
  }

  async linkNoReplace(from: string, to: string) {
    if (this.files.has(to)) return { status: 'exists' as const }
    const content = this.files.get(from)
    if (content === undefined) return { status: 'failed' as const }
    this.files.set(to, content)
    return { status: 'linked' as const }
  }

  async remove(path: string) {
    if (this.failRemove?.(path)) return false
    this.files.delete(path)
    return true
  }
}

const cardsRoot = '/project/.modstudio/cards'
const source = `${cardsRoot}/Fireball.json.tmp-source`

describe('Card ID claim', () => {
  it('新 session 会回收可解析的 prior-session claim 后重新占用', async () => {
    const files = new MemoryClaimFiles()
    files.files.set(source, 'pending document')
    const previous = await acquireCardIdClaim(files, cardsRoot, 'Fireball', source, {
      sessionId: 'previous-session',
      operationId: 'previous-operation',
    })
    expect(previous.status).toBe('acquired')

    const recovery = await recoverCardIdClaims(files, cardsRoot, {
      sessionId: 'current-session',
    })
    expect(recovery).toEqual({ status: 'recovered', count: 1 })

    const current = await acquireCardIdClaim(files, cardsRoot, 'Fireball', source, {
      sessionId: 'current-session',
      operationId: 'current-operation',
    })
    expect(current.status).toBe('acquired')
  })

  it('同 session 的 active owner 不会被启动恢复或另一个 operation 偷走', async () => {
    const files = new MemoryClaimFiles()
    files.files.set(source, 'pending document')
    const active = await acquireCardIdClaim(files, cardsRoot, 'Fireball', source, {
      sessionId: 'current-session',
      operationId: 'active-operation',
    })
    expect(active.status).toBe('acquired')

    await expect(recoverCardIdClaims(files, cardsRoot, {
      sessionId: 'current-session',
    })).resolves.toEqual({ status: 'recovered', count: 0 })
    await expect(acquireCardIdClaim(files, cardsRoot, 'Fireball', source, {
      sessionId: 'current-session',
      operationId: 'competing-operation',
    })).resolves.toEqual({ status: 'occupied' })
  })

  it('未知或损坏 claim 会 fail closed 而不是被启动恢复删除', async () => {
    const files = new MemoryClaimFiles()
    const claim = `${cardsRoot}/.id-claims/fireball.claim`
    files.files.set(claim, '{broken')

    const recovery = await recoverCardIdClaims(files, cardsRoot, {
      sessionId: 'current-session',
    })

    expect(recovery).toMatchObject({ status: 'failed' })
    expect(files.files.get(claim)).toBe('{broken')
  })

  it('release 无法原子移出 owner claim 时返回 uncertain，后续可安全回收 inactive owner', async () => {
    const files = new MemoryClaimFiles()
    const claim = `${cardsRoot}/.id-claims/fireball.claim`
    files.files.set(source, 'pending document')
    const acquired = await acquireCardIdClaim(files, cardsRoot, 'Fireball', source, {
      sessionId: 'current-session',
      operationId: 'failed-release',
    })
    if (acquired.status !== 'acquired') throw new Error('claim should be acquired')
    files.failRename = from => from === claim

    await expect(acquired.release()).resolves.toMatchObject({
      status: 'failed',
      certainty: 'uncertain',
    })
    expect(files.files.has(claim)).toBe(true)

    files.failRename = null
    await expect(recoverCardIdClaims(files, cardsRoot, {
      sessionId: 'current-session',
    })).resolves.toEqual({ status: 'recovered', count: 1 })
    expect(files.files.has(claim)).toBe(false)
  })

  it('release 后清理 tombstone 失败会显式返回 uncertain，但不再占用 ID', async () => {
    const files = new MemoryClaimFiles()
    files.files.set(source, 'pending document')
    const acquired = await acquireCardIdClaim(files, cardsRoot, 'Fireball', source, {
      sessionId: 'current-session',
      operationId: 'cleanup-failure',
    })
    if (acquired.status !== 'acquired') throw new Error('claim should be acquired')
    files.failRemove = path => path.includes('.claim-released-')

    await expect(acquired.release()).resolves.toMatchObject({
      status: 'failed',
      certainty: 'uncertain',
    })

    const next = await acquireCardIdClaim(files, cardsRoot, 'Fireball', source, {
      sessionId: 'current-session',
      operationId: 'after-cleanup-failure',
    })
    expect(next.status).toBe('acquired')
  })
  it("claim 原子发布返回前启动恢复不会回收仍在获取中的 owner", async () => {
    const files = new MemoryClaimFiles()
    files.files.set(source, "pending document")
    let signalLinked!: () => void
    let finishLink!: () => void
    const linked = new Promise<void>(resolve => { signalLinked = resolve })
    const continueLink = new Promise<void>(resolve => { finishLink = resolve })
    const originalLink = files.linkNoReplace.bind(files)
    files.linkNoReplace = async (from, to) => {
      const result = await originalLink(from, to)
      if (to.endsWith("/fireball.claim")) {
        signalLinked()
        await continueLink
      }
      return result
    }

    const acquiring = acquireCardIdClaim(files, cardsRoot, "Fireball", source, {
      sessionId: "current-session",
      operationId: "in-flight-operation",
    })
    await linked
    await expect(recoverCardIdClaims(files, cardsRoot, {
      sessionId: "current-session",
    })).resolves.toEqual({ status: "recovered", count: 0 })
    finishLink()
    const acquired = await acquiring
    expect(acquired.status).toBe("acquired")
    if (acquired.status === "acquired") await acquired.release()
  })
})
