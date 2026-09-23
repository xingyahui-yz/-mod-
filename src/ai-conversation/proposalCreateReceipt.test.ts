import { describe, expect, it } from 'vitest'
import {
  createProposalCreateReceiptRepository,
  type ProposalCreateReceipt,
  type ProposalCreateReceiptFilePort,
} from './proposalCreateReceipt'

class MemoryReceiptFiles implements ProposalCreateReceiptFilePort {
  readonly files = new Map<string, string>()
  failReadFor = new Set<string>()
  corruptPublishedRead = false

  async readFile(path: string) {
    if (this.failReadFor.has(path)) return { status: 'error' as const, error: 'EACCES' }
    const value = this.files.get(path)
    if (value === undefined) return { status: 'missing' as const }
    if (this.corruptPublishedRead && path.endsWith('.json')) return { status: 'found' as const, value: '{}' }
    return { status: 'found' as const, value }
  }

  async writeFile(path: string, content: string) {
    this.files.set(path, content)
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
    this.files.delete(path)
    return true
  }

  async mkdir() { return true }
}

describe('Card 创建 receipt repository', () => {
  it('以 no-replace 发布严格最小 receipt，并在读回等值后才报告成功', async () => {
    const files = new MemoryReceiptFiles()
    const repository = createProposalCreateReceiptRepository(files, () => 'unique')
    const receipt = exampleReceipt()

    await expect(repository.save('/mods/a', receipt)).resolves.toEqual({ ok: true })
    await expect(repository.load('/mods/a', receipt.transactionId)).resolves.toEqual({
      status: 'found',
      receipt,
    })
    const saved = [...files.files.entries()].find(([path]) => path.endsWith('.json'))
    expect(JSON.parse(saved![1])).toEqual(receipt)
    expect(Object.keys(JSON.parse(saved![1])).sort()).toEqual([
      'documentRevision', 'finalCardId', 'proposalId', 'schemaVersion', 'transactionId',
    ])
    expect([...files.files.keys()].some(path => path.includes('.tmp-'))).toBe(false)
  })

  it('发布后的 receipt 读回不一致时报告 uncertain', async () => {
    const files = new MemoryReceiptFiles()
    const repository = createProposalCreateReceiptRepository(files, () => 'unique')
    files.corruptPublishedRead = true

    await expect(repository.save('/mods/a', exampleReceipt())).resolves.toEqual({
      ok: false,
      error: '创建 receipt 发布后读回等值校验失败',
      certainty: 'uncertain',
    })
  })

  it('文件端口在 receipt 保存期间抛错时也返回 uncertain 而不泄漏异常', async () => {
    const files = new MemoryReceiptFiles()
    files.writeFile = async () => { throw new Error('disk unavailable') }
    const repository = createProposalCreateReceiptRepository(files, () => 'unique')

    await expect(repository.save('/mods/a', exampleReceipt())).resolves.toEqual({
      ok: false,
      error: '创建 receipt 保存异常：disk unavailable',
      certainty: 'uncertain',
    })
  })

  it('拒绝未知字段、错误事务身份或无法读取的 receipt', async () => {
    const files = new MemoryReceiptFiles()
    const repository = createProposalCreateReceiptRepository(files, () => 'unique')
    const receipt = exampleReceipt()
    await expect(repository.save('/mods/a', receipt)).resolves.toEqual({ ok: true })
    const path = [...files.files.keys()].find(candidate => candidate.endsWith('.json'))!
    files.files.set(path, JSON.stringify({ ...receipt, rawProviderResponse: 'secret' }))
    await expect(repository.load('/mods/a', receipt.transactionId)).resolves.toMatchObject({
      status: 'error',
      error: '创建 receipt 格式无效',
    })
    files.failReadFor.add(path)
    await expect(repository.load('/mods/a', receipt.transactionId)).resolves.toEqual({
      status: 'error',
      error: 'EACCES',
    })
  })
})

function exampleReceipt(): ProposalCreateReceipt {
  return {
    schemaVersion: 1,
    proposalId: 'proposal-1',
    transactionId: 'transaction-1',
    finalCardId: 'FinalCard',
    documentRevision: 'revision-1',
  }
}
