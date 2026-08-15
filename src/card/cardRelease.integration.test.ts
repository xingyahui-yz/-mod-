import { mkdtemp, readFile, readdir, rename, rm, mkdir, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { tmpdir } from 'node:os'
import { afterEach, describe, expect, it } from 'vitest'
import { appendNode, connect, createEmptyGraph } from '../node-editor/graph'
import type { CardDocument } from './cardDocument'
import { createCardDocumentRepository } from './cardRepository'
import { generateCardArtifact } from './cardGeneration'
import { createCardTrashRepository } from './cardTrash'
import { buildPreflightEntries, evaluateCardPreflight } from './cardPreflight'

const projects: string[] = []

function realFiles() {
  return {
    async readDirectory(path: string) {
      const entries = await readdir(path, { withFileTypes: true })
      return entries.map(entry => ({ name: entry.name, isDirectory: entry.isDirectory(), path: join(path, entry.name) }))
    },
    async readFile(path: string) {
      try { return await readFile(path, 'utf8') } catch { return null }
    },
    async mkdir(path: string) { try { await mkdir(path, { recursive: true }); return true } catch { return false } },
    async writeFile(path: string, content: string) {
      try { await mkdir(dirname(path), { recursive: true }); await writeFile(path, content, 'utf8'); return true } catch { return false }
    },
    async rename(from: string, to: string) { try { await mkdir(dirname(to), { recursive: true }); await rename(from, to); return true } catch { return false } },
    async remove(path: string) { try { await rm(path, { recursive: true, force: true }); return true } catch { return false } },
  }
}

function makeDocument(): CardDocument {
  let graph = createEmptyGraph('ReleaseCard', 'card')
  const trigger = appendNode(graph, 'trigger', { x: 0, y: 0 }, { event: 'onPlay' })
  graph = trigger.graph
  const effect = appendNode(graph, 'effect', { x: 100, y: 0 }, { kind: 'exhaustSelf' })
  const linked = connect(effect.graph, { nodeId: trigger.node.id, port: 'out' }, { nodeId: effect.node.id, port: 'in' })
  if (!linked.ok) throw new Error(linked.reason)
  return {
    schemaVersion: 2,
    card: { id: 'ReleaseCard', name: 'Release Card', cost: 1, type: 'Attack', rarity: 'Common', description: 'Exhaust.', keywords: [] },
    graph: linked.graph,
    generation: { lastGeneratedFingerprint: null },
  }
}

describe('v0.9 real filesystem release flow', () => {
  afterEach(async () => {
    await Promise.all(projects.splice(0).map(path => rm(path, { recursive: true, force: true })))
  })

  it('save → reload → generate → external-modification preflight → trash delete/restore', async () => {
    const project = await mkdtemp(join(tmpdir(), 'mod-studio-v09-'))
    projects.push(project)
    const files = realFiles()
    const repository = createCardDocumentRepository({ files })
    const document = makeDocument()

    expect((await repository.save(project, document)).ok).toBe(true)
    const loaded = await repository.load(project)
    expect(loaded[0]?.result.status).toBe('editable')
    const generated = await generateCardArtifact(project, document, {
      files,
      saveDocument: async next => (await repository.save(project, next)).ok,
    })
    expect(generated.status).toBe('generated')

    const artifactPath = join(project, 'scripts/Cards/ReleaseCard.cs')
    await writeFile(artifactPath, 'external edit', 'utf8')
    const afterExternal = await repository.load(project)
    const artifacts = new Map([['ReleaseCard', await files.readFile(artifactPath)]])
    const entries = buildPreflightEntries(afterExternal, artifacts)
    const preflight = evaluateCardPreflight(entries)
    expect(preflight.ok).toBe(false)
    expect(preflight.blocking[0]?.status).toBe('externally-modified')

    const trash = createCardTrashRepository({ files, idSuffix: () => 'release' })
    expect((await trash.delete(project, 'ReleaseCard')).status).toBe('deleted')
    expect(await files.readFile(artifactPath)).toBeNull()
    expect((await trash.restore(project, 'ReleaseCard-release')).status).toBe('restored')
    expect(await files.readFile(artifactPath)).toBe('external edit')
  })
})
