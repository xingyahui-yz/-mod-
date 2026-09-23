export type ProjectCardFlushResult =
  | { ok: true }
  | { ok: false; error: string }

type ProjectCardFlusher = () => Promise<ProjectCardFlushResult>

const flushersByProject = new Map<string, Set<ProjectCardFlusher>>()

/** 注册 Card 编辑界面的项目级 flush。项目切换守卫只依赖这一窄接口。 */
export function registerProjectCardFlusher(
  projectRoot: string,
  flusher: ProjectCardFlusher,
): () => void {
  let flushers = flushersByProject.get(projectRoot)
  if (!flushers) {
    flushers = new Set()
    flushersByProject.set(projectRoot, flushers)
  }
  flushers.add(flusher)
  return () => {
    flushers?.delete(flusher)
    if (flushers?.size === 0) flushersByProject.delete(projectRoot)
  }
}

/** 在切换项目之前保存全部 Card 草稿，并把任一失败提升为切换阻断。 */
export async function flushProjectCardChanges(projectRoot: string): Promise<ProjectCardFlushResult> {
  const flushers = [...(flushersByProject.get(projectRoot) ?? [])]
  for (const flush of flushers) {
    try {
      const result = await flush()
      if (!result.ok) return result
    } catch (error) {
      return { ok: false, error: `Card 草稿保存失败：${error instanceof Error ? error.message : String(error)}` }
    }
  }
  return { ok: true }
}
