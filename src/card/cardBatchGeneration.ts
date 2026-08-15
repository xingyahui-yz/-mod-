import type { CardDocument } from './cardDocument'
import { validateCardGraph } from './cardSemantics'
import {
  generateCardArtifact,
  type CardGenerationFilePort,
  type CardGenerationResult,
} from './cardGeneration'

export type BatchGenerationInput =
  | { status: 'editable'; document: CardDocument }
  | { status: 'read-only' | 'migration-required' | 'invalid'; cardId: string; reason: string }

export type BatchGenerationItem =
  | { cardId: string; status: 'generated'; path: string; document: CardDocument }
  | { cardId: string; status: 'skipped'; reason: string }
  | { cardId: string; status: 'failed'; reason: string }

export interface BatchGenerationReport {
  items: BatchGenerationItem[]
  counts: { generated: number; skipped: number; failed: number }
}
export interface BatchGenerationOptions {
  files: CardGenerationFilePort
  saveDocument: (document: CardDocument) => Promise<boolean>
  namespace?: string
  allowExternalOverwrite?: boolean
  backupExternalArtifact?: (path: string, content: string) => Promise<boolean>
}

/**
 * 项目级尽力生成：每张 Card 独立执行和持久化，草稿/只读项跳过，
 * 单张失败不会阻止后续 Card。
 */
export async function generateCardBatch(
  projectPath: string,
  inputs: BatchGenerationInput[],
  options: BatchGenerationOptions,
): Promise<BatchGenerationReport> {
  const items: BatchGenerationItem[] = []
  for (const input of inputs) {
    if (input.status !== 'editable') {
      items.push({ cardId: input.cardId, status: 'skipped', reason: input.reason })
      continue
    }

    const semantic = validateCardGraph(input.document.graph, input.document.card.id)
    if (!semantic.ok) {
      items.push({
        cardId: input.document.card.id,
        status: 'skipped',
        reason: semantic.issues.map(issue => issue.message).join('；'),
      })
      continue
    }

    let result: CardGenerationResult
    try {
      result = await generateCardArtifact(projectPath, input.document, options)
    } catch (error) {
      items.push({
        cardId: input.document.card.id,
        status: 'failed',
        reason: error instanceof Error ? error.message : String(error),
      })
      continue
    }
    if (result.status === 'generated') {
      items.push({ cardId: input.document.card.id, status: 'generated', path: result.path, document: result.document })
    } else if (result.status === 'blocked') {
      items.push({ cardId: input.document.card.id, status: 'failed', reason: result.reason })
    } else {
      items.push({ cardId: input.document.card.id, status: 'failed', reason: result.reason })
    }
  }

  return {
    items,
    counts: {
      generated: items.filter(item => item.status === 'generated').length,
      skipped: items.filter(item => item.status === 'skipped').length,
      failed: items.filter(item => item.status === 'failed').length,
    },
  }
}
