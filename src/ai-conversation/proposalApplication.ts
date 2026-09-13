import {
  cardCatalogActions,
  getCardCatalogView,
  type CardCatalogEvent,
  type CatalogError,
} from '../card/cardCatalog'
import { cardDocumentRevision, type CardProposal } from '../card/cardAiProposal'
import type { CardDocument } from '../card/cardDocument'
import type { GraphNode } from '../node-editor/types'
import type { ProposalCardCommit, ProposalCardCommitResult } from './projectConversation'
import {
  pendingProposalCardTransition,
  type ConversationCardProposal,
} from './proposalLifecycle'
import * as FileService from '../services/FileService'

export type ProposalCardPersistenceResult =
  | { ok: true }
  | { ok: false; error: string; certainty: 'unchanged' | 'uncertain' }

export interface ProposalCardPersistencePort {
  saveCardDocument(projectRoot: string, document: CardDocument): Promise<{ ok: true } | { ok: false; error: string }>
  removeCardDocument(projectRoot: string, cardId: string): Promise<boolean>
  inspectCardDocument(projectRoot: string, cardId: string): Promise<
    | { status: 'missing' }
    | { status: 'found'; document: CardDocument }
    | { status: 'occupied'; error: string }
  >
  hasTrashedCardDocument(projectRoot: string, cardId: string): Promise<boolean>
}

export interface ProposalCardApplication {
  commit(input: ProposalCardCommit): Promise<ProposalCardPersistenceResult>
  reconcile(proposal: ConversationCardProposal): Promise<ProposalCardPersistenceResult>
  persistHistoryCard(event: CardCatalogEvent, document: CardDocument): Promise<ProposalCardPersistenceResult>
}

/**
 * 把对话提案与 CardCatalog 之间的跨文件协议留在 application 层。
 * CardCatalog 仍只管理内存；这里在目录 mutation 之前完成 CardDocument 原子保存。
 */
export function createProposalCardApplication(
  projectRoot: string,
  files: ProposalCardPersistencePort = defaultProposalCardPersistencePort,
): ProposalCardApplication {
  return {
    async commit(input) {
      const result = await persistProposalToCardCatalog(projectRoot, input, files)
      return result
    },

    reconcile: proposal => reconcilePendingProposalTransition(projectRoot, proposal, files),

    async persistHistoryCard(event, document) {
      if (event.sourceProjectRoot !== projectRoot) {
        return uncertain('Card 历史事件属于其他项目，已停止持久化')
      }
      if (document.card.id !== event.cardId) {
        return uncertain('Card 历史事件与当前文档不一致，已停止持久化')
      }
      const beforeSave = getCardCatalogView()
      const current = beforeSave.sourceProjectRoot === projectRoot
        ? beforeSave.documents.find(candidate => candidate.card.id === event.cardId)
        : undefined
      if (!current || cardDocumentRevision(current) !== cardDocumentRevision(document)) {
        // 用户已经在这个 undo/redo 之后继续编辑；旧 transition 不得覆盖真实项目状态。
        return { ok: true }
      }
      const saved = await saveCard(files, projectRoot, document)
      if (!saved.ok) return saved
      const afterSave = getCardCatalogView()
      const latest = afterSave.sourceProjectRoot === projectRoot
        ? afterSave.documents.find(candidate => candidate.card.id === event.cardId)
        : undefined
      if (!latest || cardDocumentRevision(latest) === cardDocumentRevision(document)) return { ok: true }
      const restored = await saveCard(files, projectRoot, latest)
      return restored.ok
        ? { ok: true }
        : uncertain('Card 历史保存期间出现后继编辑，且无法恢复最新磁盘状态')
    },
  }
}

const defaultProposalCardPersistencePort: ProposalCardPersistencePort = {
  saveCardDocument: (projectRoot, document) => FileService.saveCardDocument(projectRoot, document),
  removeCardDocument: (projectRoot, cardId) =>
    FileService.removeFile(`${projectRoot}/.modstudio/cards/${cardId}.json`),
  async inspectCardDocument(projectRoot, cardId) {
    try {
      const entries = await FileService.loadCardDocuments(projectRoot)
      const entry = entries.find(candidate =>
        candidate.fileName.toLowerCase() === `${cardId}.json`.toLowerCase(),
      )
      if (!entry) return { status: 'missing' }
      return entry.result.status === 'editable'
        ? { status: 'found', document: entry.result.document }
        : { status: 'occupied', error: `目标文件 ${entry.fileName} 已存在但不可编辑` }
    } catch (error) {
      return {
        status: 'occupied',
        error: `无法确认目标 CardDocument 是否存在：${error instanceof Error ? error.message : String(error)}`,
      }
    }
  },
  async hasTrashedCardDocument(projectRoot, cardId) {
    try {
      const normalized = cardId.toLowerCase()
      const entries = await FileService.listCardTrash(projectRoot)
      return entries.some(entry => {
        if (entry.result.status === 'editable') {
          return entry.result.document.card.id.toLowerCase() === normalized
        }
        return entry.trashId.toLowerCase().startsWith(`${normalized}-`)
      })
    } catch {
      // 无法确认回收站时按“已占用”处理，恢复路径绝不能覆盖或复活文件。
      return true
    }
  },
}

/**
 * 接受创建提案前才执行 rekey。预览阶段始终持有 AI 给出的候选 ID，
 * 因此不会提前占用 CardCatalog 中的正式 ID。
 */
export function rekeyCreatedCardDocument(
  document: CardDocument,
  finalCardId: string,
): CardDocument {
  const proposedCardId = document.card.id
  return {
    ...document,
    card: { ...document.card, id: finalCardId },
    graph: {
      ...document.graph,
      id: `graph-${finalCardId}`,
      entityId: finalCardId,
      nodes: document.graph.nodes.map(node => rekeySelfReference(node, proposedCardId, finalCardId)),
    },
    // AI 提案被接受后仍需显式生成产物，不能继承任何候选指纹。
    generation: { lastGeneratedFingerprint: null },
  }
}

/** ProjectConversation 的 commit callback：只通过 CardCatalog 的公开动作改权威状态。 */
export function applyProposalToCardCatalog(
  projectRoot: string,
  input: ProposalCardCommit,
): ProposalCardCommitResult {
  const catalog = getCardCatalogView()
  if (catalog.sourceProjectRoot !== projectRoot) {
    return {
      ok: false,
      error: '当前 Card 目录不属于此项目，请重新打开项目后再接受提案',
      certainty: 'unchanged',
    }
  }

  const provenance = {
    kind: 'ai-proposal' as const,
    proposalId: input.proposal.id,
    transactionId: input.transactionId,
  }
  if (input.proposal.operation === 'create') {
    const document = rekeyCreatedCardDocument(input.proposal.document, input.finalCardId.trim())
    const result = cardCatalogActions.createCardDocument(document, { provenance })
    return result.ok
      ? { ok: true }
      : { ok: false, error: catalogErrorMessage(result.error), certainty: 'unchanged' }
  }

  const selected = cardCatalogActions.selectCard(input.proposal.targetCardId)
  if (!selected.ok) return { ok: false, error: catalogErrorMessage(selected.error), certainty: 'unchanged' }
  const proposal: CardProposal = {
    cardId: input.proposal.targetCardId,
    baseRevision: input.proposal.baseRevision!,
    document: input.proposal.document,
  }
  const result = cardCatalogActions.applyProposal(proposal, { provenance })
  return result.ok
    ? { ok: true }
    : { ok: false, error: catalogErrorMessage(result.error), certainty: 'unchanged' }
}

/**
 * 持久化优先的提案提交。若保存后 Catalog 因竞态拒绝应用，会尽力恢复磁盘；
 * 恢复失败返回 uncertain，调用方必须阻止继续操作/项目切换。
 */
export async function persistProposalToCardCatalog(
  projectRoot: string,
  input: ProposalCardCommit,
  files: ProposalCardPersistencePort,
): Promise<ProposalCardPersistenceResult> {
  const catalog = getCardCatalogView()
  if (catalog.sourceProjectRoot !== projectRoot) {
    return unchanged('当前 Card 目录不属于此项目，请重新打开项目后再接受提案')
  }

  const before = input.proposal.operation === 'update'
    ? catalog.documents.find(document => document.card.id === input.proposal.targetCardId) ?? null
    : null
  if (input.proposal.operation === 'update' && !before) {
    return unchanged('目标 Card 不存在，请刷新提案状态')
  }
  if (before && cardDocumentRevision(before) !== input.proposal.baseRevision) {
    return unchanged('目标 Card 已变化，此提案已过期')
  }

  const finalCardId = input.finalCardId.trim()
  const next = input.proposal.operation === 'create'
    ? rekeyCreatedCardDocument(input.proposal.document, finalCardId)
    : input.proposal.document
  if (input.proposal.operation === 'create') {
    const target = await inspectCard(files, projectRoot, finalCardId)
    if (target.status === 'occupied') return unchanged(target.error)
    if (target.status === 'found' && !sameDocument(target.document, next)) {
      return unchanged(`Card ID ${finalCardId} 的磁盘文档已存在，未覆盖`)
    }
  }
  const saved = await saveCard(files, projectRoot, next)
  if (!saved.ok) return saved

  // 文件写入会让出事件循环。期间 CardEditor 仍可能提交编辑或删除 Card；
  // 此时不能用最初捕获的 base 回滚，否则会覆盖用户刚完成的修改。
  const latestCatalog = getCardCatalogView()
  const latest = latestCatalog.sourceProjectRoot === projectRoot
    ? latestCatalog.documents.find(document =>
        document.card.id.toLowerCase() === finalCardId.toLowerCase(),
      )
    : undefined
  const catalogChangedWhileSaving = latestCatalog.sourceProjectRoot !== projectRoot ||
    (input.proposal.operation === 'update'
      ? !latest || cardDocumentRevision(latest) !== input.proposal.baseRevision
      : Boolean(latest))
  if (catalogChangedWhileSaving) {
    const restoreDocument = latestCatalog.sourceProjectRoot === projectRoot ? latest : before
    const restored = restoreDocument
      ? (await saveCard(files, projectRoot, restoreDocument)).ok
      : await removeCard(files, projectRoot, finalCardId)
    if (!restored) {
      return uncertain('Card 保存期间项目状态已变化，且无法恢复最新磁盘状态')
    }
    return unchanged('Card 保存期间项目状态已变化，请刷新提案后重试')
  }

  const applied = applyProposalToCardCatalog(projectRoot, input)
  if (applied.ok) return { ok: true }

  const current = getCardCatalogView()
  const currentDocument = current.sourceProjectRoot === projectRoot
    ? current.documents.find(document =>
        document.card.id.toLowerCase() === finalCardId.toLowerCase(),
      )
    : undefined
  const restoreDocument = current.sourceProjectRoot === projectRoot ? currentDocument : before
  const rolledBack = restoreDocument
    ? (await saveCard(files, projectRoot, restoreDocument)).ok
    : await removeCard(files, projectRoot, finalCardId)
  if (!rolledBack) {
    return uncertain(`Card 已写入但目录应用失败（${applied.error}），磁盘回滚也失败，状态不确定`)
  }
  return unchanged(`Card 目录应用失败，磁盘已恢复：${applied.error}`)
}

/**
 * 恢复最后一个没有 committed 标记的 Card transition。WAL 的目标快照来自
 * accepted/reverted/restored 事件；如果 Card 已产生合法后继或被删除，以实际项目
 * 状态为准，不回放旧 transition。
 */
export async function reconcilePendingProposalTransition(
  projectRoot: string,
  proposal: ConversationCardProposal,
  files: ProposalCardPersistencePort,
): Promise<ProposalCardPersistenceResult> {
  const transition = pendingProposalCardTransition(proposal)
  if (!transition) return { ok: true }
  const accepted = [...proposal.events].reverse().find(event => event.type === 'accepted')
  if (!accepted || accepted.type !== 'accepted') {
    return uncertain(`提案 ${proposal.id} 缺少 accepted 事务记录`)
  }
  const catalog = getCardCatalogView()
  if (catalog.sourceProjectRoot !== projectRoot) {
    return uncertain('Card 目录尚未加载到对话所属项目')
  }

  const finalCardId = accepted.finalCardId
  const desired = proposal.operation === 'create' && transition.previousRevision === null
    ? rekeyCreatedCardDocument(transition.desiredDocument, finalCardId)
    : transition.desiredDocument
  const current = catalog.documents.find(document =>
    document.card.id.toLowerCase() === finalCardId.toLowerCase(),
  )
  if (current && cardDocumentRevision(current) === cardDocumentRevision(desired)) return { ok: true }

  if (proposal.operation === 'create' && current === undefined) {
    const active = await inspectCard(files, projectRoot, finalCardId)
    if (active.status === 'occupied') return { ok: true }
    if (active.status === 'found') {
      if (!sameDocument(active.document, desired)) return { ok: true }
    } else if (await hasTrashedCard(files, projectRoot, finalCardId)) {
      return { ok: true }
    }
  }

  const canRecover = current === undefined
    ? transition.allowMissing
    : transition.previousRevision !== null && cardDocumentRevision(current) === transition.previousRevision
  if (!canRecover) {
    // Card 在 WAL 写入后又被用户修改或删除。实际项目状态优先，不能用旧日志覆盖。
    return { ok: true }
  }

  const saved = await saveCard(files, projectRoot, desired)
  if (!saved.ok) return saved

  const latest = getCardCatalogView()
  if (latest.sourceProjectRoot !== projectRoot) {
    return uncertain('恢复 Card transition 时项目已切换')
  }
  const latestDocument = latest.documents.find(document =>
    document.card.id.toLowerCase() === finalCardId.toLowerCase(),
  )
  const stillRecoverable = latestDocument === undefined
    ? transition.allowMissing
    : transition.previousRevision !== null && cardDocumentRevision(latestDocument) === transition.previousRevision
  if (!stillRecoverable) {
    const restored = latestDocument
      ? (await saveCard(files, projectRoot, latestDocument)).ok
      : await removeCard(files, projectRoot, finalCardId)
    return restored
      ? { ok: true }
      : uncertain('恢复 Card transition 期间项目状态变化，且无法恢复最新磁盘状态')
  }

  const documents = latestDocument
    ? latest.documents.map(document => document.card.id === latestDocument.card.id ? desired : document)
    : [...latest.documents, desired]
  const selectedCardId = latest.selectedCardId
  const loaded = cardCatalogActions.loadDocuments(documents, projectRoot)
  if (loaded.ok) {
    if (selectedCardId && documents.some(document => document.card.id === selectedCardId)) {
      cardCatalogActions.selectCard(selectedCardId)
    }
    return { ok: true }
  }

  const rolledBack = latestDocument
    ? (await saveCard(files, projectRoot, latestDocument)).ok
    : await removeCard(files, projectRoot, finalCardId)
  return rolledBack
    ? unchanged(`Card transition 已回滚：${catalogErrorMessage(loaded.error)}`)
    : uncertain(`Card transition 目录应用失败且磁盘回滚失败：${catalogErrorMessage(loaded.error)}`)
}


export function catalogErrorMessage(error: CatalogError): string {
  switch (error) {
    case 'invalid-card-id': return 'Card ID 必须使用 PascalCase ASCII，且创建后不可修改'
    case 'duplicate-card-id': return 'Card ID 已被占用（大小写不敏感），请换一个 ID'
    case 'invalid-document': return '提案中的 Card 文档或行为图无效'
    case 'card-not-found': return '目标 Card 不存在，请刷新提案状态'
    case 'stale-proposal': return '目标 Card 已变化，此提案已过期'
    case 'no-selection': return '当前没有选中的 Card'
    case 'stale-generation': return '生成结果基于旧版本 Card，已拒绝写入'
  }
}

function rekeySelfReference(node: GraphNode, proposedCardId: string, finalCardId: string): GraphNode {
  const kind = node.data.kind
  const referencedCardId = node.data.cardId
  if ((kind !== 'addCardToHand' && kind !== 'addCardToDeck') ||
    typeof referencedCardId !== 'string' ||
    referencedCardId.toLowerCase() !== proposedCardId.toLowerCase()) return node
  return { ...node, data: { ...node.data, cardId: finalCardId } }
}

async function saveCard(
  files: ProposalCardPersistencePort,
  projectRoot: string,
  document: CardDocument,
): Promise<ProposalCardPersistenceResult> {
  try {
    const result = await files.saveCardDocument(projectRoot, document)
    return result.ok
      ? { ok: true }
      : unchanged(`CardDocument 保存失败：${result.error}`)
  } catch (error) {
    return uncertain(`CardDocument 保存异常：${error instanceof Error ? error.message : String(error)}`)
  }
}

async function removeCard(
  files: ProposalCardPersistencePort,
  projectRoot: string,
  cardId: string,
): Promise<boolean> {
  try {
    return await files.removeCardDocument(projectRoot, cardId)
  } catch {
    return false
  }
}

async function inspectCard(
  files: ProposalCardPersistencePort,
  projectRoot: string,
  cardId: string,
): ReturnType<ProposalCardPersistencePort['inspectCardDocument']> {
  try {
    return await files.inspectCardDocument(projectRoot, cardId)
  } catch (error) {
    return {
      status: 'occupied',
      error: `无法确认目标 CardDocument 是否存在：${error instanceof Error ? error.message : String(error)}`,
    }
  }
}

async function hasTrashedCard(
  files: ProposalCardPersistencePort,
  projectRoot: string,
  cardId: string,
): Promise<boolean> {
  try {
    return await files.hasTrashedCardDocument(projectRoot, cardId)
  } catch {
    return true
  }
}

function sameDocument(left: CardDocument, right: CardDocument): boolean {
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

function unchanged(error: string): Extract<ProposalCardPersistenceResult, { ok: false }> {
  return { ok: false, error, certainty: 'unchanged' }
}

function uncertain(error: string): Extract<ProposalCardPersistenceResult, { ok: false }> {
  return { ok: false, error, certainty: 'uncertain' }
}
