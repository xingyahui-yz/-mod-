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
import { reserveCardId } from '../card/cardIdReservation'

export type ProposalCardPersistenceResult =
  | { ok: true }
  | { ok: false; error: string; certainty: 'unchanged' | 'uncertain' }

export interface ProposalCardPersistencePort {
  saveCardDocument(projectRoot: string, document: CardDocument): Promise<
    { ok: true } | { ok: false; error: string; certainty?: 'unchanged' | 'uncertain' }
  >
  createCardDocument(projectRoot: string, document: CardDocument): Promise<
    { ok: true } | { ok: false; error: string; certainty?: 'unchanged' | 'uncertain' }
  >
  inspectCardDocument(projectRoot: string, cardId: string): Promise<
    | { status: 'missing' }
    | { status: 'found'; document: CardDocument }
    | { status: 'occupied'; error: string }
  >
  listTrashedCardDocuments?(projectRoot: string, cardId: string): Promise<readonly CardDocument[]>
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
      // 调用方用 Card persistence barrier 把后继 autosave 延后到 committed 之后。
      // 这里必须且只能落盘当前事件捕获的快照；若提前写入 later snapshot，
      // rapid undo→redo 会在 redo WAL 尚未建立时留下不可恢复的磁盘状态。
      return saveCard(files, projectRoot, document)
    },
  }
}

const defaultProposalCardPersistencePort: ProposalCardPersistencePort = {
  saveCardDocument: (projectRoot, document) => FileService.saveCardDocument(projectRoot, document),
  createCardDocument: (projectRoot, document) => FileService.createCardDocument(projectRoot, document),
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
  async listTrashedCardDocuments(projectRoot, cardId) {
    const entries = await FileService.listCardTrash(projectRoot)
    return entries.flatMap(entry => entry.result.status === 'editable' &&
      entry.result.document.card.id.toLowerCase() === cardId.toLowerCase()
      ? [entry.result.document]
      : [])
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
  const reservation = input.proposal.operation === 'create'
    ? reserveCardId(projectRoot, input.finalCardId.trim())
    : null
  if (input.proposal.operation === 'create' && !reservation) {
    return unchanged(`Card ID ${input.finalCardId.trim()} 正在被其他创建操作占用`)
  }
  try {
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
      if (target.status === 'found') {
        return unchanged(`Card ID ${finalCardId} 的磁盘文档已存在，未覆盖`)
      }
    }
    const saved = input.proposal.operation === 'create'
      ? await createCard(files, projectRoot, next)
      : await saveCard(files, projectRoot, next)
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
      if (!restoreDocument && input.proposal.operation === 'create') {
        // 创建文件已成为 accepted WAL 的恢复事实。不能按路径删除它，因为
        // 外部进程可能已替换同名文件；保留并要求重载进行内容核对。
        return uncertain('Card 创建期间目录状态已变化，需重新加载核对已创建文件')
      }
      const restored = restoreDocument ? (await saveCard(files, projectRoot, restoreDocument)).ok : true
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
    if (!restoreDocument && input.proposal.operation === 'create') {
      return uncertain(`Card 已落盘但目录应用失败（${applied.error}），需重新加载恢复`)
    }
    const rolledBack = restoreDocument ? (await saveCard(files, projectRoot, restoreDocument)).ok : true
    if (!rolledBack) {
      return uncertain(`Card 已写入但目录应用失败（${applied.error}），磁盘回滚也失败，状态不确定`)
    }
    return unchanged(`Card 目录应用失败，磁盘已恢复：${applied.error}`)
  } finally {
    reservation?.release()
  }
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

  let activeCreateAlreadyMatches = false
  if (proposal.operation === 'create' && current === undefined) {
    const active = await inspectCard(files, projectRoot, finalCardId)
    if (active.status === 'occupied') {
      return uncertain(`Card ID ${finalCardId} 已被不可编辑文件占用，未覆盖`)
    }
    if (active.status === 'found') {
      if (!sameDocument(active.document, desired)) {
        return uncertain(`Card ID ${finalCardId} 已被其他 CardDocument 占用，未覆盖`)
      }
      activeCreateAlreadyMatches = true
    }
    if (!activeCreateAlreadyMatches && files.listTrashedCardDocuments) {
      let trashed: readonly CardDocument[]
      try {
        trashed = await files.listTrashedCardDocuments(projectRoot, finalCardId)
      } catch (error) {
        return uncertain(`无法确认 Card ${finalCardId} 的回收站状态：${error instanceof Error ? error.message : String(error)}`)
      }
      // accepted WAL 之后若同一候选已在回收站，说明项目
      // 实际状态已删除它。只匹配完整内容，避免历史同 ID
      // 回收站条目阻止一份新的建议。
      if (trashed.some(document => sameDocument(document, desired))) return { ok: true }
    }
  }

  const canRecover = current === undefined
    ? transition.allowMissing
    : transition.previousRevision !== null && cardDocumentRevision(current) === transition.previousRevision
  if (!canRecover) {
    // Card 在 WAL 写入后又被用户修改或删除。实际项目状态优先，不能用旧日志覆盖。
    return { ok: true }
  }

  const saved = proposal.operation === 'create' && current === undefined && !activeCreateAlreadyMatches
    ? await createCard(files, projectRoot, desired)
    : activeCreateAlreadyMatches
      ? { ok: true as const }
      : await saveCard(files, projectRoot, desired)
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
    if (!latestDocument) {
      // create 已落盘后不能凭路径删除：外部进程可能已经替换同名文件。
      // 保留 WAL 与候选文件，重载时通过内容核对恢复，比误删用户文件安全。
      return uncertain('恢复 Card transition 期间目录状态变化，需重新加载核对已创建文件')
    }
    const restored = (await saveCard(files, projectRoot, latestDocument)).ok
    return restored ? { ok: true } : uncertain('恢复 Card transition 期间项目状态变化，且无法恢复最新磁盘状态')
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

  if (!latestDocument) {
    return uncertain(`Card transition 已落盘但目录应用失败，需重新加载恢复：${catalogErrorMessage(loaded.error)}`)
  }
  const rolledBack = (await saveCard(files, projectRoot, latestDocument)).ok
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
      : result.certainty === 'uncertain'
        ? uncertain(`CardDocument 保存失败：${result.error}`)
        : unchanged(`CardDocument 保存失败：${result.error}`)
  } catch (error) {
    return uncertain(`CardDocument 保存异常：${error instanceof Error ? error.message : String(error)}`)
  }
}

async function createCard(
  files: ProposalCardPersistencePort,
  projectRoot: string,
  document: CardDocument,
): Promise<ProposalCardPersistenceResult> {
  try {
    const result = await files.createCardDocument(projectRoot, document)
    return result.ok
      ? { ok: true }
      : result.certainty === 'uncertain'
        ? uncertain(`CardDocument 创建失败：${result.error}`)
        : unchanged(`CardDocument 创建失败：${result.error}`)
  } catch (error) {
    return uncertain(`CardDocument 创建异常：${error instanceof Error ? error.message : String(error)}`)
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
