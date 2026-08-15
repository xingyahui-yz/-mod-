/**
 * FileService - 封装所有Electron文件操作
 * 提供深层的、可测试的接口
 *
 * v0.8-2 Candidate 2 — factory seam:
 *   createFileService({ api }) 返回一个 service 对象, 闭包捕获 api.
 *   测试自己创建 service, 不再走 `setApi` 改模块级 `let api`.
 *   产线单例: `installFileService({ api })` 在 main.tsx 调一次.
 *   兼容: 旧的 `import * as FileService from '...'` 调用方式仍可用 —
 *   模块层把每个方法绑定到一个 lazy 创建的 default service.
 */
import { createCardDocumentRepository, type CardDocumentLoadEntry, type CardDocumentSaveResult, type CardDocumentMigrationSaveResult } from '../card/cardRepository'
import type { CardDocument } from '../card/cardDocument'
import { createCardTrashRepository, type CardTrashDeleteResult, type CardTrashEntry, type CardTrashRestoreResult } from '../card/cardTrash'
import { buildPreflightEntries, evaluateCardPreflight, type CardPreflightOptions, type CardPreflightReport } from '../card/cardPreflight'
import { generateCardArtifact as writeCardArtifact, type CardGenerationResult } from '../card/cardGeneration'
import { generateCardBatch as runCardBatch, type BatchGenerationReport } from '../card/cardBatchGeneration'

export interface FileEntry {
  name: string
  isDirectory: boolean
  path: string
}

export interface ModManifest {
  id: string
  name: string
  version: string
  authors: string[]
  description: string
  dependencies: string[]
}

// 注入的API接口（用于测试）
export interface ElectronAPI {
  openDirectory: () => Promise<string | null>
  saveDirectory: () => Promise<string | null>
  readDirectory: (dirPath: string) => Promise<FileEntry[]>
  readFile: (filePath: string) => Promise<string | null>
  writeFile: (filePath: string, content: string) => Promise<boolean>
  /** 原子替换所需的最小文件原语（旧测试/适配器可暂不提供）。 */
  rename?: (from: string, to: string) => Promise<boolean>
  remove?: (filePath: string) => Promise<boolean>
  mkdir: (dirPath: string) => Promise<boolean>
  copyDirectory: (src: string, dest: string) => Promise<boolean>
  getUserDataPath: () => Promise<string>
  launchGame: (gamePath: string, modPath: string) => Promise<{ success: boolean; error?: string }>
  showInFolder: (filePath: string) => Promise<boolean>
}

// Service 对象 — 所有文件相关方法的类型集合
export interface FileService {
  openProjectDirectory(): Promise<string | null>
  selectSaveDirectory(): Promise<string | null>
  getProjectFiles(dirPath: string): Promise<FileEntry[]>
  readFile(filePath: string): Promise<string | null>
  writeFile(filePath: string, content: string): Promise<boolean>
  renameFile(from: string, to: string): Promise<boolean>
  removeFile(filePath: string): Promise<boolean>
  createDirectory(dirPath: string): Promise<boolean>
  showInFolder(filePath: string): Promise<boolean>
  loadModManifest(projectPath: string): Promise<ModManifest | null>
  saveModManifest(projectPath: string, manifest: ModManifest): Promise<boolean>
  loadCardDocuments(projectPath: string): Promise<CardDocumentLoadEntry[]>
  saveCardDocument(projectPath: string, document: CardDocument): Promise<CardDocumentSaveResult>
  migrateCardDocument(projectPath: string, fileName: string): Promise<CardDocumentMigrationSaveResult>
  deleteCardToTrash(projectPath: string, cardId: string): Promise<CardTrashDeleteResult>
  listCardTrash(projectPath: string): Promise<CardTrashEntry[]>
  restoreCardFromTrash(projectPath: string, trashId: string): Promise<CardTrashRestoreResult>
  preflightCardProject(projectPath: string, options?: CardPreflightOptions): Promise<CardPreflightReport>
  backupCardArtifact(projectPath: string, cardId: string): Promise<{ ok: true; path: string } | { ok: false; error: string }>
  generateCardArtifact(projectPath: string, document: CardDocument, options?: { allowExternalOverwrite?: boolean }): Promise<CardGenerationResult>
  generateCardBatch(projectPath: string): Promise<BatchGenerationReport>
  launchGame(
    gamePath: string,
    modPath: string
  ): Promise<{ success: boolean; error?: string }>
}

const MANIFEST_NAMES = ['mod_manifest.json', 'ModTheSpire.json', 'mod.json']
const CARDS_DIR = 'scripts/Cards'

/**
 * 工厂: 创建一个 FileService, 闭包捕获 api. 测试用:
 *   const svc = createFileService({ api: myMockApi })
 *   await svc.loadCardDocuments('/proj')
 */
export function createFileService(deps: { api: ElectronAPI }): FileService {
  const { api } = deps
  const cardDocumentRepository = createCardDocumentRepository({
    files: {
      readDirectory: path => api.readDirectory(path),
      readFile: path => api.readFile(path),
      mkdir: path => api.mkdir(path),
      writeFile: (path, content) => api.writeFile(path, content),
      rename: (from, to) => api.rename ? api.rename(from, to) : Promise.resolve(false),
      remove: path => api.remove ? api.remove(path) : Promise.resolve(false),
    },
  })
  const cardTrashRepository = createCardTrashRepository({
    files: {
      readDirectory: path => api.readDirectory(path),
      readFile: path => api.readFile(path),
      mkdir: path => api.mkdir(path),
      rename: (from, to) => api.rename ? api.rename(from, to) : Promise.resolve(false),
      remove: path => api.remove ? api.remove(path) : Promise.resolve(false),
    },
  })

  return {
    // ============ 项目操作 ============
    async openProjectDirectory() {
      return api.openDirectory()
    },

    async selectSaveDirectory() {
      return api.saveDirectory()
    },

    async getProjectFiles(dirPath) {
      const entries = await api.readDirectory(dirPath)
      entries.sort((a, b) => {
        if (a.isDirectory && !b.isDirectory) return -1
        if (!a.isDirectory && b.isDirectory) return 1
        return a.name.localeCompare(b.name)
      })
      return entries
    },

    readFile: (filePath) => api.readFile(filePath),

    writeFile: (filePath, content) => api.writeFile(filePath, content),

    renameFile: (from, to) => api.rename ? api.rename(from, to) : Promise.resolve(false),

    removeFile: (filePath) => api.remove ? api.remove(filePath) : Promise.resolve(false),

    createDirectory: (dirPath) => api.mkdir(dirPath),

    showInFolder: (filePath) => api.showInFolder(filePath),

    // ============ Mod Manifest 操作 ============
    async loadModManifest(projectPath) {
      for (const name of MANIFEST_NAMES) {
        const manifestPath = `${projectPath}/${name}`
        const content = await api.readFile(manifestPath)
        if (content) {
          try {
            return JSON.parse(content)
          } catch {
            // continue to next name
          }
        }
      }
      return null
    },

    async saveModManifest(projectPath, manifest) {
      const manifestPath = `${projectPath}/mod_manifest.json`
      return api.writeFile(manifestPath, JSON.stringify(manifest, null, 2))
    },

    loadCardDocuments: (projectPath) => cardDocumentRepository.load(projectPath),

    saveCardDocument: (projectPath, document) => cardDocumentRepository.save(projectPath, document),

    migrateCardDocument: (projectPath, fileName) => cardDocumentRepository.migrateAndSave(projectPath, fileName),

    deleteCardToTrash: (projectPath, cardId) => cardTrashRepository.delete(projectPath, cardId),

    listCardTrash: (projectPath) => cardTrashRepository.list(projectPath),

    restoreCardFromTrash: (projectPath, trashId) => cardTrashRepository.restore(projectPath, trashId),

    async preflightCardProject(projectPath, options = {}) {
      const loaded = await cardDocumentRepository.load(projectPath)
      const artifacts = new Map<string, string | null>()
      const knownIds = new Set<string>()
      for (const entry of loaded) {
        const cardId = entry.result.status === 'editable'
          ? entry.result.document.card.id
          : entry.result.raw && typeof entry.result.raw === 'object' && !Array.isArray(entry.result.raw)
            ? (() => {
                const card = (entry.result.raw as Record<string, unknown>).card
                return card && typeof card === 'object' && !Array.isArray(card) && typeof (card as Record<string, unknown>).id === 'string'
                  ? (card as Record<string, unknown>).id as string
                  : entry.fileName.replace(/\.json$/i, '')
              })()
            : entry.fileName.replace(/\.json$/i, '')
        knownIds.add(cardId.toLowerCase())
        artifacts.set(cardId, await api.readFile(`${projectPath}/${CARDS_DIR}/${cardId}.cs`))
      }
      const artifactEntries = await api.readDirectory(`${projectPath}/${CARDS_DIR}`).catch(() => [] as FileEntry[])
      const entries = buildPreflightEntries(loaded, artifacts)
      for (const artifactEntry of artifactEntries) {
        if (artifactEntry.isDirectory || !artifactEntry.name.toLowerCase().endsWith('.cs')) continue
        const cardId = artifactEntry.name.replace(/\.cs$/i, '')
        if (!knownIds.has(cardId.toLowerCase())) {
          entries.push({ cardId, loadStatus: 'untracked-artifact', artifact: await api.readFile(artifactEntry.path || `${projectPath}/${CARDS_DIR}/${artifactEntry.name}`) })
        }
      }
      return evaluateCardPreflight(entries, options)
    },

    async backupCardArtifact(projectPath, cardId) {
      const source = `${projectPath}/${CARDS_DIR}/${cardId}.cs`
      const content = await api.readFile(source)
      if (content === null) return { ok: false, error: 'C# 产物不存在，无法备份' }
      const backup = `${source}.external-${Date.now()}.bak`
      return await api.writeFile(backup, content)
        ? { ok: true, path: backup }
        : { ok: false, error: '无法写入外部 C# 备份' }
    },

    async generateCardArtifact(projectPath, document, options = {}) {
      return writeCardArtifact(projectPath, document, {
        files: {
          mkdir: path => api.mkdir(path),
          writeFile: (path, content) => api.writeFile(path, content),
          rename: (from, to) => api.rename ? api.rename(from, to) : Promise.resolve(false),
          remove: path => api.remove ? api.remove(path) : Promise.resolve(false),
          readFile: path => api.readFile(path),
        },
        saveDocument: async next => (await cardDocumentRepository.save(projectPath, next)).ok,
        allowExternalOverwrite: options.allowExternalOverwrite,
        backupExternalArtifact: options.allowExternalOverwrite
          ? async (path, content) => api.writeFile(`${path}.external-${Date.now()}.bak`, content)
          : undefined,
      })
    },

    async generateCardBatch(projectPath) {
      const loaded = await cardDocumentRepository.load(projectPath)
      const inputs = loaded.map(entry => {
        if (entry.result.status === 'editable') {
          return { status: 'editable' as const, document: entry.result.document }
        }
        const raw = entry.result.raw
        const rawCard = raw && typeof raw === 'object' && !Array.isArray(raw)
          ? (raw as Record<string, unknown>).card
          : null
        const cardId = rawCard && typeof rawCard === 'object' && !Array.isArray(rawCard) && typeof (rawCard as Record<string, unknown>).id === 'string'
          ? (rawCard as Record<string, unknown>).id as string
          : entry.fileName.replace(/\.json$/i, '')
        return {
          status: entry.result.status as 'read-only' | 'migration-required' | 'invalid',
          cardId,
          reason: entry.result.status === 'invalid' ? entry.result.reason : 'CardDocument 不是当前可编辑 schema',
        }
      })
      return runCardBatch(projectPath, inputs, {
        files: {
          mkdir: path => api.mkdir(path),
          writeFile: (path, content) => api.writeFile(path, content),
          rename: (from, to) => api.rename ? api.rename(from, to) : Promise.resolve(false),
          remove: path => api.remove ? api.remove(path) : Promise.resolve(false),
          readFile: path => api.readFile(path),
        },
        saveDocument: async next => (await cardDocumentRepository.save(projectPath, next)).ok,
        backupExternalArtifact: async (path, content) => api.writeFile(`${path}.external-${Date.now()}.bak`, content),
      })
    },

    // ============ 游戏启动 ============
    launchGame: (gamePath, modPath) => api.launchGame(gamePath, modPath),
  }
}

// ============ 默认 production wiring ============

const noOpApi: ElectronAPI = {
  async openDirectory() { return null },
  async saveDirectory() { return null },
  async readDirectory() { return [] },
  async readFile() { return null },
  async writeFile() { return false },
  async rename() { return false },
  async remove() { return false },
  async mkdir() { return false },
  async copyDirectory() { return false },
  async getUserDataPath() { return '' },
  async launchGame() { return { success: false, error: 'Not available' } },
  async showInFolder() { return false },
}

function autoDetectApi(): ElectronAPI {
  if (typeof window !== 'undefined' && (window as any).electronAPI) {
    return (window as any).electronAPI
  }
  return noOpApi
}

let _service: FileService | null = null

/**
 * 产线入口. main.tsx 调用一次:
 *   installFileService({ api: window.electronAPI })
 * 之后所有 `import * as FileService from '...'` 都路由到此 service.
 *
 * 测试里不要调这个 — 测试应直接 createFileService({ api: mockApi }) 拿独立实例.
 */
export function installFileService(deps: { api: ElectronAPI }): void {
  _service = createFileService(deps)
}

function getDefaultService(): FileService {
  if (!_service) {
    _service = createFileService({ api: autoDetectApi() })
  }
  return _service
}

// ============ 兼容旧 import * as FileService ============
// 这些 re-export 让现有调用方式 `FileService.foo()` / `FileService.bar()` 不变.
// 它们路由到 getDefaultService() 拿当前 default service (产线单例).
// 测试若想隔离, 直接用 createFileService({ api: mockApi }) 而非走这里.

export const openProjectDirectory = () =>
  getDefaultService().openProjectDirectory()
export const selectSaveDirectory = () =>
  getDefaultService().selectSaveDirectory()
export const getProjectFiles = (dirPath: string) =>
  getDefaultService().getProjectFiles(dirPath)
export const readFile = (filePath: string) =>
  getDefaultService().readFile(filePath)
export const writeFile = (filePath: string, content: string) =>
  getDefaultService().writeFile(filePath, content)
export const renameFile = (from: string, to: string) =>
  getDefaultService().renameFile(from, to)
export const removeFile = (filePath: string) =>
  getDefaultService().removeFile(filePath)
export const createDirectory = (dirPath: string) =>
  getDefaultService().createDirectory(dirPath)
export const showInFolder = (filePath: string) =>
  getDefaultService().showInFolder(filePath)
export const loadModManifest = (projectPath: string) =>
  getDefaultService().loadModManifest(projectPath)
export const saveModManifest = (projectPath: string, manifest: ModManifest) =>
  getDefaultService().saveModManifest(projectPath, manifest)
export const loadCardDocuments = (projectPath: string) =>
  getDefaultService().loadCardDocuments(projectPath)
export const saveCardDocument = (projectPath: string, document: CardDocument) =>
  getDefaultService().saveCardDocument(projectPath, document)

export const migrateCardDocument = (projectPath: string, fileName: string) =>
  getDefaultService().migrateCardDocument(projectPath, fileName)

export const deleteCardToTrash = (projectPath: string, cardId: string) =>
  getDefaultService().deleteCardToTrash(projectPath, cardId)

export const listCardTrash = (projectPath: string) =>
  getDefaultService().listCardTrash(projectPath)

export const restoreCardFromTrash = (projectPath: string, trashId: string) =>
  getDefaultService().restoreCardFromTrash(projectPath, trashId)

export const preflightCardProject = (projectPath: string, options?: CardPreflightOptions) =>
  getDefaultService().preflightCardProject(projectPath, options)

export const generateCardArtifact = (
  projectPath: string,
  document: CardDocument,
  options?: { allowExternalOverwrite?: boolean },
) => getDefaultService().generateCardArtifact(projectPath, document, options)

export const generateCardBatch = (projectPath: string) =>
  getDefaultService().generateCardBatch(projectPath)

export const backupCardArtifact = (projectPath: string, cardId: string) =>
  getDefaultService().backupCardArtifact(projectPath, cardId)
export const launchGame = (gamePath: string, modPath: string) =>
  getDefaultService().launchGame(gamePath, modPath)
