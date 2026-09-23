import { link, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { createProposalCreateReceiptRepository, type ProposalCreateReceiptFilePort } from './proposalCreateReceipt'

const projects: string[] = []

describe('Card 创建 receipt 真实文件系统', () => {
  afterEach(async () => {
    await Promise.all(projects.splice(0).map(path => rm(path, { recursive: true, force: true })))
  })

  it('原子发布后可由新 repository 实例恢复同一事务身份', async () => {
    const project = await mkdtemp(join(tmpdir(), 'mod-studio-create-receipt-'))
    projects.push(project)
    const files = realFiles()
    const receipt = {
      schemaVersion: 1 as const,
      proposalId: 'proposal-release',
      transactionId: 'transaction-release',
      finalCardId: 'ReleaseCard',
      documentRevision: 'revision-release',
    }

    const writer = createProposalCreateReceiptRepository(files, () => 'write')
    await expect(writer.save(project, receipt)).resolves.toEqual({ ok: true })

    const afterRestart = createProposalCreateReceiptRepository(files, () => 'restart')
    await expect(afterRestart.load(project, receipt.transactionId)).resolves.toEqual({
      status: 'found',
      receipt,
    })
  })
})

function realFiles(): ProposalCreateReceiptFilePort {
  return {
    async readFile(path) {
      try {
        return { status: 'found', value: await readFile(path, 'utf8') }
      } catch (error) {
        return error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT'
          ? { status: 'missing' }
          : { status: 'error', error: error instanceof Error ? error.message : String(error) }
      }
    },
    async writeFile(path, content) {
      try {
        await mkdir(dirname(path), { recursive: true })
        await writeFile(path, content, 'utf8')
        return true
      } catch {
        return false
      }
    },
    async linkNoReplace(from, to) {
      try {
        await link(from, to)
        return { status: 'linked' }
      } catch (error) {
        return error && typeof error === 'object' && 'code' in error && error.code === 'EEXIST'
          ? { status: 'exists' }
          : { status: 'failed' }
      }
    },
    async remove(path) {
      try {
        await rm(path, { force: true })
        return true
      } catch {
        return false
      }
    },
    async mkdir(path) {
      try {
        await mkdir(path, { recursive: true })
        return true
      } catch {
        return false
      }
    },
  }
}
