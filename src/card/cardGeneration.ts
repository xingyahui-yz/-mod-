import type { CardDocument } from './cardDocument'
import { generateCardDocumentCode } from './codegen'
import { computeArtifactHash, computeGenerationSourceHash, GENERATOR_VERSION } from './fingerprint'
import { inspectCardArtifact, isArtifactOverwriteBlocked } from './artifactSafety'

export interface CardGenerationFilePort {
  mkdir(path: string): Promise<boolean>
  writeFile(path: string, content: string): Promise<boolean>
  rename(from: string, to: string): Promise<boolean>
  remove(path: string): Promise<boolean>
  readFile(path: string): Promise<string | null>
}

export type CardGenerationResult =
  | { status: 'generated'; path: string; document: CardDocument }
  | { status: 'blocked'; path: string; reason: 'external-modification' | 'untracked-artifact' }
  | { status: 'failed'; reason: string }

function joinPath(...parts: string[]): string {
  return parts
    .map((part, index) => index === 0 ? part.replace(/\/+$/, '') : part.replace(/^\/+|\/+$/g, ''))
    .filter(Boolean)
    .join('/')
}

function tempPath(target: string, id: string): string {
  return `${target}.tmp-${id}-${Math.random().toString(36).slice(2)}`
}

/** 显式生成 C#，成功读回后才把同步指纹写入 CardDocument。 */
export async function generateCardArtifact(
  projectPath: string,
  document: CardDocument,
  deps: {
    files: CardGenerationFilePort
    saveDocument: (document: CardDocument) => Promise<boolean>
    namespace?: string
    /** 覆盖外部/未跟踪产物前必须由调用方明确确认。 */
    allowExternalOverwrite?: boolean
    /** 确认前先备份或导出当前磁盘版本；返回 false 时保持原产物不变。 */
    backupExternalArtifact?: (path: string, content: string) => Promise<boolean>
  },
): Promise<CardGenerationResult> {
  let code: string
  try {
    code = generateCardDocumentCode(document, deps.namespace ?? 'MyMod.Cards')
  } catch (error) {
    return { status: 'failed', reason: error instanceof Error ? error.message : String(error) }
  }

  const directory = joinPath(projectPath, 'scripts/Cards')
  const target = joinPath(directory, `${document.card.id}.cs`)
  const temp = tempPath(target, document.card.id)

  // 生成前先检查活动 C#。缺少产物是正常首次生成；已有产物若外部变化
  // 或没有同步指纹，必须先经过显式备份/导出确认，不能静默覆盖。
  const existingArtifact = await deps.files.readFile(target)
  if (existingArtifact !== null) {
    const inspection = inspectCardArtifact(document, existingArtifact)
    if (isArtifactOverwriteBlocked(inspection.status)) {
      if (!deps.allowExternalOverwrite) {
        return {
          status: 'blocked',
          path: target,
          reason: inspection.status === 'externally-modified' ? 'external-modification' : 'untracked-artifact',
        }
      }
      if (!deps.backupExternalArtifact) {
        return { status: 'failed', reason: '覆盖外部 C# 前必须先备份或导出' }
      }
      if (!await deps.backupExternalArtifact(target, existingArtifact)) {
        return { status: 'failed', reason: '外部 C# 备份失败，未覆盖原产物' }
      }
    }
  }

  if (!await deps.files.mkdir(directory)) return { status: 'failed', reason: '无法创建 C# 输出目录' }
  if (!await deps.files.writeFile(temp, code)) {
    await deps.files.remove(temp).catch(() => false)
    return { status: 'failed', reason: '无法写入 C# 临时文件' }
  }
  if (!await deps.files.rename(temp, target)) {
    await deps.files.remove(temp).catch(() => false)
    return { status: 'failed', reason: '无法原子替换 C# 产物' }
  }

  const artifact = await deps.files.readFile(target)
  if (artifact === null) return { status: 'failed', reason: 'C# 产物读回失败，CardDocument 指纹未更新' }
  const nextDocument: CardDocument = {
    ...document,
    generation: {
      lastGeneratedFingerprint: {
        sourceHash: computeGenerationSourceHash(document),
        generatorVersion: GENERATOR_VERSION,
        artifactHash: computeArtifactHash(artifact),
      },
    },
  }
  if (!await deps.saveDocument(nextDocument)) {
    return { status: 'failed', reason: 'C# 已生成，但 CardDocument 指纹写回失败' }
  }
  return { status: 'generated', path: target, document: nextDocument }
}
