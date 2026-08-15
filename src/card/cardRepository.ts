import {
  parseCardDocument,
  parseCardDocumentJson,
  serializeCardDocument,
  type CardDocument,
  type CardDocumentParseResult,
} from './cardDocument'
import { isValidCardId } from './cardValidation'
import type { FileService } from '../services/FileService'

export interface CardDocumentFileEntry {
  name: string
  isDirectory: boolean
  path: string
}

/** Card repository 所需的最小文件能力；不包含 C# parser。 */
export interface CardDocumentFilePort {
  readDirectory(path: string): Promise<CardDocumentFileEntry[]>
  readFile(path: string): Promise<string | null>
  mkdir(path: string): Promise<boolean>
  writeFile(path: string, content: string): Promise<boolean>
  rename(from: string, to: string): Promise<boolean>
  remove(path: string): Promise<boolean>
}

export interface CardDocumentLoadEntry {
  fileName: string
  path: string
  result: CardDocumentParseResult
}

export type CardDocumentSaveResult =
  | { ok: true; path: string }
  | { ok: false; error: string }

export interface CardDocumentRepository {
  load(projectPath: string): Promise<CardDocumentLoadEntry[]>
  save(projectPath: string, document: CardDocument): Promise<CardDocumentSaveResult>
}

/** 将现有 FileService 接到 repository，不改变旧的 C# load/save 方法。 */
export function createCardDocumentRepositoryFromFileService(
  service: Pick<FileService, 'getProjectFiles' | 'readFile' | 'createDirectory' | 'writeFile' | 'renameFile' | 'removeFile'>,
): CardDocumentRepository {
  return createCardDocumentRepository({
    files: {
      readDirectory: path => service.getProjectFiles(path),
      readFile: path => service.readFile(path),
      mkdir: path => service.createDirectory(path),
      writeFile: (path, content) => service.writeFile(path, content),
      rename: (from, to) => service.renameFile(from, to),
      remove: path => service.removeFile(path),
    },
  })
}

const CARDS_DIR = '.modstudio/cards'

function joinPath(...parts: string[]): string {
  return parts
    .map((part, index) => index === 0 ? part.replace(/\/+$/, '') : part.replace(/^\/+|\/+$/g, ''))
    .filter(Boolean)
    .join('/')
}

function temporaryPath(target: string, id: string): string {
  return `${target}.tmp-${id}-${Math.random().toString(36).slice(2)}`
}

export function createCardDocumentRepository(deps: { files: CardDocumentFilePort }): CardDocumentRepository {
  const { files } = deps

  return {
    async load(projectPath) {
      const cardsPath = joinPath(projectPath, CARDS_DIR)
      let entries: CardDocumentFileEntry[]
      try {
        entries = await files.readDirectory(cardsPath)
      } catch {
        return []
      }

      const cardEntries = entries
        .filter(entry => !entry.isDirectory && entry.name.toLowerCase().endsWith('.json'))
        .sort((a, b) => a.name.localeCompare(b.name))

      return Promise.all(cardEntries.map(async entry => {
        const path = entry.path || joinPath(cardsPath, entry.name)
        const content = await files.readFile(path).catch(() => null)
        const result = content === null
          ? { status: 'invalid' as const, reason: '无法读取 CardDocument', raw: null }
          : parseCardDocumentJson(content)
        return { fileName: entry.name, path, result }
      }))
    },

    async save(projectPath, document) {
      if (!isValidCardId(document.card.id)) {
        return { ok: false, error: 'Card ID 不合法，无法保存' }
      }
      const parsed = parseCardDocument(document)
      if (parsed.status !== 'editable') {
        return { ok: false, error: parsed.status === 'invalid' ? parsed.reason : 'CardDocument 不是可编辑状态' }
      }

      const cardsPath = joinPath(projectPath, CARDS_DIR)
      const target = joinPath(cardsPath, `${document.card.id}.json`)
      const temp = temporaryPath(target, document.card.id)
      if (!await files.mkdir(cardsPath)) {
        return { ok: false, error: '无法创建 CardDocument 目录' }
      }

      const cleanup = async () => {
        await files.remove(temp).catch(() => false)
      }
      if (!await files.writeFile(temp, serializeCardDocument(document))) {
        await cleanup()
        return { ok: false, error: '无法写入临时 CardDocument' }
      }
      if (!await files.rename(temp, target)) {
        await cleanup()
        return { ok: false, error: '无法原子替换 CardDocument' }
      }
      return { ok: true, path: target }
    },
  }
}
