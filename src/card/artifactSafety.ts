import type { CardDocument } from './cardDocument'
import {
  computeArtifactHash,
  computeGenerationSourceHash,
  GENERATOR_VERSION,
} from './fingerprint'

/**
 * 生成产物与当前 CardDocument 的关系。
 *
 * `externally-modified` 和 `untracked` 都是破坏性覆盖保护的阻断状态：
 * 前者表示上次生成后磁盘内容被改过，后者表示磁盘上存在一个没有由
 * 当前 CardDocument 记录的旧/手工 C#。两者都不能被重新生成静默覆盖。
 */
export type ArtifactSyncStatus =
  | 'missing'
  | 'in-sync'
  | 'stale-generation'
  | 'externally-modified'
  | 'untracked'

export interface ArtifactInspection {
  status: ArtifactSyncStatus
  actualHash: string | null
  expectedHash: string | null
}

export function inspectCardArtifact(
  document: CardDocument,
  artifact: string | null,
): ArtifactInspection {
  if (artifact === null) {
    return { status: 'missing', actualHash: null, expectedHash: document.generation.lastGeneratedFingerprint?.artifactHash ?? null }
  }

  const actualHash = computeArtifactHash(artifact)
  const fingerprint = document.generation.lastGeneratedFingerprint
  if (!fingerprint) {
    return { status: 'untracked', actualHash, expectedHash: null }
  }
  if (actualHash !== fingerprint.artifactHash) {
    return { status: 'externally-modified', actualHash, expectedHash: fingerprint.artifactHash }
  }

  const currentSourceHash = computeGenerationSourceHash(document)
  if (fingerprint.generatorVersion !== GENERATOR_VERSION || fingerprint.sourceHash !== currentSourceHash) {
    return { status: 'stale-generation', actualHash, expectedHash: fingerprint.artifactHash }
  }
  return { status: 'in-sync', actualHash, expectedHash: fingerprint.artifactHash }
}

export function isArtifactOverwriteBlocked(status: ArtifactSyncStatus): boolean {
  return status === 'externally-modified' || status === 'untracked'
}
