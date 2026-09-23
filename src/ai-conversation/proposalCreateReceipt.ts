import { isValidCardId } from '../card/cardValidation'

export interface ProposalCreateReceipt {
  schemaVersion: 1
  proposalId: string
  transactionId: string
  finalCardId: string
  documentRevision: string
}

export type ProposalCreateReceiptLoadResult =
  | { status: 'missing' }
  | { status: 'found'; receipt: ProposalCreateReceipt }
  | { status: 'error'; error: string }

export type ProposalCreateReceiptSaveResult =
  | { ok: true }
  | { ok: false; error: string; certainty: 'unchanged' | 'uncertain' }

export interface ProposalCreateReceiptFilePort {
  readFile(path: string): Promise<
    | { status: 'missing' }
    | { status: 'found'; value: string }
    | { status: 'error'; error: string }
  >
  writeFile(path: string, content: string): Promise<boolean>
  linkNoReplace(from: string, to: string): Promise<{ status: 'linked' | 'exists' | 'failed' }>
  remove(path: string): Promise<boolean>
  mkdir(path: string): Promise<boolean>
}

export interface ProposalCreateReceiptRepository {
  load(projectRoot: string, transactionId: string): Promise<ProposalCreateReceiptLoadResult>
  save(projectRoot: string, receipt: ProposalCreateReceipt): Promise<ProposalCreateReceiptSaveResult>
}

const receiptDirectory = (projectRoot: string) => `${projectRoot}/.modstudio/ai/card-create-receipts`

export function createProposalCreateReceiptRepository(
  files: ProposalCreateReceiptFilePort,
  createId: () => string = () => crypto.randomUUID(),
): ProposalCreateReceiptRepository {
  const load = async (
    projectRoot: string,
    transactionId: string,
  ): Promise<ProposalCreateReceiptLoadResult> => {
    const read = await readReceiptFile(files, receiptPath(projectRoot, transactionId))
    if (read.status !== 'found') return read
    const receipt = parseReceiptJson(read.value)
    return receipt && receipt.transactionId === transactionId
      ? { status: 'found', receipt }
      : { status: 'error', error: '创建 receipt 格式无效' }
  }

  return {
    load,

    async save(projectRoot, receipt) {
      try {
        if (!parseProposalCreateReceipt(receipt)) {
          return { ok: false, error: '创建 receipt 格式无效', certainty: 'unchanged' }
        }
        const directory = receiptDirectory(projectRoot)
        if (!await files.mkdir(directory)) {
          return { ok: false, error: '无法创建 receipt 目录', certainty: 'unchanged' }
        }
        const target = receiptPath(projectRoot, receipt.transactionId)
        const existing = await load(projectRoot, receipt.transactionId)
        if (existing.status === 'error') {
          return { ok: false, error: existing.error, certainty: 'uncertain' }
        }
        if (existing.status === 'found') {
          return sameReceipt(existing.receipt, receipt)
            ? { ok: true }
            : { ok: false, error: '同一事务已有不同的创建 receipt', certainty: 'uncertain' }
        }

        const temporary = `${target}.tmp-${safeComponent(createId())}`
        const content = JSON.stringify(receipt, null, 2)
        if (!await files.writeFile(temporary, content)) {
          await files.remove(temporary)
          return { ok: false, error: '无法写入创建 receipt 临时文件', certainty: 'unchanged' }
        }
        const temporaryRead = await readReceiptFile(files, temporary)
        if (temporaryRead.status !== 'found' || temporaryRead.value !== content) {
          await files.remove(temporary)
          return { ok: false, error: '创建 receipt 临时文件读回校验失败', certainty: 'unchanged' }
        }

        const published = await files.linkNoReplace(temporary, target)
        if (published.status === 'exists') {
          await files.remove(temporary)
          const raced = await load(projectRoot, receipt.transactionId)
          return raced.status === 'found' && sameReceipt(raced.receipt, receipt)
            ? { ok: true }
            : { ok: false, error: '创建 receipt 被不同内容并发占用', certainty: 'uncertain' }
        }
        if (published.status !== 'linked') {
          await files.remove(temporary)
          return { ok: false, error: '无法原子发布创建 receipt', certainty: 'uncertain' }
        }

        const readBack = await load(projectRoot, receipt.transactionId)
        await files.remove(temporary)
        return readBack.status === 'found' && sameReceipt(readBack.receipt, receipt)
          ? { ok: true }
          : { ok: false, error: '创建 receipt 发布后读回等值校验失败', certainty: 'uncertain' }
      } catch (error) {
        return {
          ok: false,
          error: `创建 receipt 保存异常：${error instanceof Error ? error.message : String(error)}`,
          certainty: 'uncertain',
        }
      }
    },
  }
}

function parseReceiptJson(content: string): ProposalCreateReceipt | null {
  try {
    return parseProposalCreateReceipt(JSON.parse(content))
  } catch {
    return null
  }
}

export function parseProposalCreateReceipt(value: unknown): ProposalCreateReceipt | null {
  if (!isRecord(value) || !hasExactKeys(value, [
    'documentRevision', 'finalCardId', 'proposalId', 'schemaVersion', 'transactionId',
  ]) || value.schemaVersion !== 1 || !isNonEmptyString(value.proposalId) ||
    !isNonEmptyString(value.transactionId) || !isValidCardId(value.finalCardId) ||
    !isNonEmptyString(value.documentRevision)) return null
  return value as unknown as ProposalCreateReceipt
}

async function readReceiptFile(
  files: ProposalCreateReceiptFilePort,
  path: string,
): Promise<{ status: 'missing' } | { status: 'found'; value: string } | { status: 'error'; error: string }> {
  try {
    return await files.readFile(path)
  } catch (error) {
    return { status: 'error', error: error instanceof Error ? error.message : String(error) }
  }
}

function receiptPath(projectRoot: string, transactionId: string): string {
  const readable = safeComponent(transactionId).slice(0, 64) || 'transaction'
  return `${receiptDirectory(projectRoot)}/${readable}-${stableHash(transactionId)}.json`
}

function safeComponent(value: string): string {
  return value.replace(/[^a-zA-Z0-9_-]/g, '-')
}

function stableHash(value: string): string {
  let hash = 0x811c9dc5
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index)
    hash = Math.imul(hash, 0x01000193)
  }
  return (hash >>> 0).toString(16).padStart(8, '0')
}

function sameReceipt(left: ProposalCreateReceipt, right: ProposalCreateReceipt): boolean {
  return left.schemaVersion === right.schemaVersion &&
    left.proposalId === right.proposalId &&
    left.transactionId === right.transactionId &&
    left.finalCardId === right.finalCardId &&
    left.documentRevision === right.documentRevision
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function hasExactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  const actual = Object.keys(value).sort()
  const expected = [...keys].sort()
  return actual.length === expected.length && actual.every((key, index) => key === expected[index])
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0
}
