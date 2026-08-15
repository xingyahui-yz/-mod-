import type { CardDocument } from './cardDocument'
import { generateCardDocumentCode } from './codegen'
import { computeArtifactHash, computeGenerationSourceHash, GENERATOR_VERSION } from './fingerprint'

export interface CardGenerationFilePort {
  mkdir(path: string): Promise<boolean>
  writeFile(path: string, content: string): Promise<boolean>
  rename(from: string, to: string): Promise<boolean>
  remove(path: string): Promise<boolean>
  readFile(path: string): Promise<string | null>
}

export type CardGenerationResult =
  | { status: 'generated'; path: string; document: CardDocument }
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
