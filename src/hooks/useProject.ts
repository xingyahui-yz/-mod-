import { create } from 'zustand'
import { FileEntry, ModManifest } from '../types'
import * as FileService from '../services/FileService'

export interface ProjectState {
  /** 当前打开项目的稳定根目录。Card、AI、生成与 manifest 必须使用此路径。 */
  projectRoot: string | null
  /** 文件浏览器当前显示的目录；在同一项目内导航时只改变此字段。 */
  browsePath: string | null
  files: FileEntry[]
  selectedFile: string | null
  fileContent: string | null
  modManifest: ModManifest | null
  loading: boolean
  error: string | null

  setProjectRoot: (path: string) => Promise<void>
  loadDirectory: (dirPath: string) => Promise<void>
  loadFile: (filePath: string) => Promise<void>
  clearSelection: () => void
  loadModManifest: (projectRoot?: string) => Promise<void>
  navigateUp: () => void
  showInFolder: () => Promise<void>
}

function trimTrailingSeparators(path: string): string {
  if (/^[A-Za-z]:[\\/]$/.test(path)) return path
  return path.replace(/[\\/]+$/, '') || path
}

function canonicalPath(path: string): string {
  const normalized = path.replace(/\\/g, '/').replace(/\/$/, '')
  return /^[A-Za-z]:/.test(normalized) ? normalized.toLowerCase() : normalized
}

function isInsideProject(path: string, projectRoot: string): boolean {
  const candidate = canonicalPath(path)
  const root = canonicalPath(projectRoot)
  return candidate === root || candidate.startsWith(`${root}/`)
}

function parentDirectory(path: string): string | null {
  const canonical = canonicalPath(path)
  const separator = canonical.lastIndexOf('/')
  if (separator < 0) return null
  if (separator === 0) return '/'
  return canonical.slice(0, separator)
}

export const useProjectStore = create<ProjectState>((set, get) => {
  let directoryRequest = 0

  const setProjectRoot = async (path: string) => {
    const projectRoot = trimTrailingSeparators(path)
    set({
      projectRoot,
      browsePath: projectRoot,
      files: [],
      selectedFile: null,
      fileContent: null,
      modManifest: null,
      error: null,
    })
    await get().loadDirectory(projectRoot)
    await get().loadModManifest(projectRoot)
  }

  return {
    projectRoot: null,
    browsePath: null,
    files: [],
    selectedFile: null,
    fileContent: null,
    modManifest: null,
    loading: false,
    error: null,

    setProjectRoot,

    loadDirectory: async (dirPath: string) => {
      const { projectRoot } = get()
      if (projectRoot && !isInsideProject(dirPath, projectRoot)) {
        set({ error: 'Cannot browse outside the project root' })
        return
      }
      const requestId = ++directoryRequest
      set({ loading: true, error: null })
      try {
        const entries = await FileService.getProjectFiles(dirPath)
        if (requestId === directoryRequest && get().projectRoot === projectRoot) {
          set({ files: entries, browsePath: trimTrailingSeparators(dirPath) })
        }
      } catch {
        if (requestId === directoryRequest) set({ error: 'Failed to load directory' })
      } finally {
        if (requestId === directoryRequest) set({ loading: false })
      }
    },

    loadModManifest: async (requestedRoot?: string) => {
      const projectRoot = requestedRoot ?? get().projectRoot
      if (!projectRoot) return
      const manifest = await FileService.loadModManifest(projectRoot)
      // 丢弃切换项目之前启动的迟到读取。
      if (get().projectRoot === projectRoot) set({ modManifest: manifest })
    },

    loadFile: async (filePath: string) => {
      const { projectRoot } = get()
      if (projectRoot && !isInsideProject(filePath, projectRoot)) {
        set({ error: 'Cannot open a file outside the project root' })
        return
      }
      const content = await FileService.readFile(filePath)
      if (get().projectRoot === projectRoot) set({ selectedFile: filePath, fileContent: content })
    },

    clearSelection: () => set({ selectedFile: null, fileContent: null }),

    navigateUp: () => {
      const { projectRoot, browsePath } = get()
      if (!projectRoot || !browsePath || canonicalPath(projectRoot) === canonicalPath(browsePath)) return
      const parentPath = parentDirectory(browsePath)
      if (parentPath && isInsideProject(parentPath, projectRoot)) void get().loadDirectory(parentPath)
    },

    showInFolder: async () => {
      const { projectRoot } = get()
      if (projectRoot) await FileService.showInFolder(projectRoot)
    },
  }
})
