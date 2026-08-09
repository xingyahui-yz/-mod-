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
import { CardData } from '../types'
import { parseCardFromCode } from '../utils/cardParser'
import { generateCardCode } from '../utils/codeGenerator'
import { toPascalCase } from '../utils/stringUtils'

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
  createDirectory(dirPath: string): Promise<boolean>
  showInFolder(filePath: string): Promise<boolean>
  loadModManifest(projectPath: string): Promise<ModManifest | null>
  saveModManifest(projectPath: string, manifest: ModManifest): Promise<boolean>
  loadCardsFromProject(projectPath: string): Promise<CardData[]>
  saveCardToProject(
    projectPath: string,
    card: CardData,
    namespace?: string
  ): Promise<{ success: boolean; fileName?: string; error?: string }>
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
 *   await svc.loadCardsFromProject('/proj')
 */
export function createFileService(deps: { api: ElectronAPI }): FileService {
  const { api } = deps

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

    // ============ 卡牌操作 ============
    async loadCardsFromProject(projectPath) {
      const cardsDir = `${projectPath}/${CARDS_DIR}`
      const cards: CardData[] = []

      let entries: FileEntry[]
      try {
        entries = await api.readDirectory(cardsDir)
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err)
        if (
          message.includes('ENOENT') ||
          message.includes('not found') ||
          message.includes('不存在')
        ) {
          return []
        }
        throw err
      }

      for (const entry of entries) {
        if (!entry.isDirectory && entry.name.endsWith('.cs')) {
          const content = await api.readFile(entry.path)
          if (content) {
            const card = parseCardFromCode(content)
            if (card) {
              cards.push(card)
            }
          }
        }
      }

      return cards
    },

    async saveCardToProject(projectPath, card, namespace = 'MyMod.Cards') {
      try {
        const className =
          toPascalCase(card.name.replace(/[^a-zA-Z0-9]/g, '')) || 'MyCard'
        const fileName = `${className}.cs`
        const filePath = `${projectPath}/${CARDS_DIR}/${fileName}`

        await api.mkdir(`${projectPath}/${CARDS_DIR}`)

        const code = generateCardCode(card, namespace)
        const success = await api.writeFile(filePath, code)

        if (success) {
          return { success: true, fileName }
        } else {
          return { success: false, error: '写入文件失败' }
        }
      } catch (err) {
        return { success: false, error: String(err) }
      }
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
export const createDirectory = (dirPath: string) =>
  getDefaultService().createDirectory(dirPath)
export const showInFolder = (filePath: string) =>
  getDefaultService().showInFolder(filePath)
export const loadModManifest = (projectPath: string) =>
  getDefaultService().loadModManifest(projectPath)
export const saveModManifest = (projectPath: string, manifest: ModManifest) =>
  getDefaultService().saveModManifest(projectPath, manifest)
export const loadCardsFromProject = (projectPath: string) =>
  getDefaultService().loadCardsFromProject(projectPath)
export const saveCardToProject = (
  projectPath: string,
  card: CardData,
  namespace: string = 'MyMod.Cards'
) =>
  getDefaultService().saveCardToProject(projectPath, card, namespace)
export const launchGame = (gamePath: string, modPath: string) =>
  getDefaultService().launchGame(gamePath, modPath)
