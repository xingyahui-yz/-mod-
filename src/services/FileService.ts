/**
 * FileService - 封装所有Electron文件操作
 * 提供深层的、可测试的接口
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

// 获取API实例（默认使用window.electronAPI）
let api: ElectronAPI = (typeof window !== 'undefined' && (window as any).electronAPI) || {
  async openDirectory() { return null },
  async saveDirectory() { return null },
  async readDirectory() { return [] },
  async readFile() { return null },
  async writeFile() { return false },
  async mkdir() { return false },
  async copyDirectory() { return false },
  async getUserDataPath() { return '' },
  async launchGame() { return { success: false, error: 'Not available' } },
  async showInFolder() { return false }
}

export function setApi(newApi: ElectronAPI) {
  api = newApi
}

// ============ 项目操作 ============

export async function openProjectDirectory(): Promise<string | null> {
  return api.openDirectory()
}

export async function selectSaveDirectory(): Promise<string | null> {
  return api.saveDirectory()
}

export async function getProjectFiles(dirPath: string): Promise<FileEntry[]> {
  const entries = await api.readDirectory(dirPath)
  entries.sort((a, b) => {
    if (a.isDirectory && !b.isDirectory) return -1
    if (!a.isDirectory && b.isDirectory) return 1
    return a.name.localeCompare(b.name)
  })
  return entries
}

export async function readFile(filePath: string): Promise<string | null> {
  return api.readFile(filePath)
}

export async function writeFile(filePath: string, content: string): Promise<boolean> {
  return api.writeFile(filePath, content)
}

export async function createDirectory(dirPath: string): Promise<boolean> {
  return api.mkdir(dirPath)
}

export async function showInFolder(filePath: string): Promise<boolean> {
  return api.showInFolder(filePath)
}

// ============ Mod Manifest 操作 ============

const MANIFEST_NAMES = ['mod_manifest.json', 'ModTheSpire.json', 'mod.json']

export async function loadModManifest(projectPath: string): Promise<ModManifest | null> {
  for (const name of MANIFEST_NAMES) {
    const manifestPath = `${projectPath}/${name}`
    const content = await api.readFile(manifestPath)
    if (content) {
      try {
        return JSON.parse(content)
      } catch {
        // continue
      }
    }
  }
  return null
}

export async function saveModManifest(projectPath: string, manifest: ModManifest): Promise<boolean> {
  const manifestPath = `${projectPath}/mod_manifest.json`
  return api.writeFile(manifestPath, JSON.stringify(manifest, null, 2))
}

// ============ 卡牌操作 ============

const CARDS_DIR = 'scripts/Cards'

export async function loadCardsFromProject(projectPath: string): Promise<CardData[]> {
  const cardsDir = `${projectPath}/${CARDS_DIR}`
  const cards: CardData[] = []

  let entries: FileEntry[]
  try {
    entries = await api.readDirectory(cardsDir)
  } catch (err) {
    // 目录不存在是正常情况（新项目），返回空数组
    // 但其他错误（权限、IO 错误）应当向上抛，由调用方决定如何处理
    const message = err instanceof Error ? err.message : String(err)
    if (message.includes('ENOENT') || message.includes('not found') || message.includes('不存在')) {
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
}

export async function saveCardToProject(
  projectPath: string,
  card: CardData,
  namespace: string = 'MyMod.Cards'
): Promise<{ success: boolean; fileName?: string; error?: string }> {
  try {
    const className = toPascalCase(card.name.replace(/[^a-zA-Z0-9]/g, '')) || 'MyCard'
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
}


// ============ 游戏启动 ============

export async function launchGame(gamePath: string, modPath: string): Promise<{ success: boolean; error?: string }> {
  return api.launchGame(gamePath, modPath)
}
