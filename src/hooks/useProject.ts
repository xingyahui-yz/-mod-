import { create } from 'zustand'
import { FileEntry, ModManifest } from '../types'
import * as FileService from '../services/FileService'

interface ProjectState {
  projectPath: string | null
  files: FileEntry[]
  selectedFile: string | null
  fileContent: string | null
  modManifest: ModManifest | null
  loading: boolean
  error: string | null

  // Actions
  openProject: () => Promise<void>
  loadDirectory: (dirPath: string) => Promise<void>
  loadFile: (filePath: string) => Promise<void>
  clearSelection: () => void
  setProjectPath: (path: string) => Promise<void>
  loadModManifest: (projectPath: string) => Promise<void>
  navigateUp: () => void
  showInFolder: () => Promise<void>
}

export const useProjectStore = create<ProjectState>((set, get) => ({
  projectPath: null,
  files: [],
  selectedFile: null,
  fileContent: null,
  modManifest: null,
  loading: false,
  error: null,

  openProject: async () => {
    const path = await FileService.openProjectDirectory()
    if (path) {
      await get().setProjectPath(path)
    }
  },

  setProjectPath: async (path: string) => {
    set({ projectPath: path, files: [], selectedFile: null, fileContent: null, modManifest: null })
    await get().loadDirectory(path)
    await get().loadModManifest(path)
  },

  loadDirectory: async (dirPath: string) => {
    set({ loading: true, error: null })
    try {
      const entries = await FileService.getProjectFiles(dirPath)
      set({ files: entries })
    } catch (error) {
      set({ error: 'Failed to load directory' })
    } finally {
      set({ loading: false })
    }
  },

  loadModManifest: async (projectPath: string) => {
    const manifest = await FileService.loadModManifest(projectPath)
    set({ modManifest: manifest })
  },

  loadFile: async (filePath: string) => {
    const content = await FileService.readFile(filePath)
    set({ selectedFile: filePath, fileContent: content })
  },

  clearSelection: () => {
    set({ selectedFile: null, fileContent: null })
  },

  navigateUp: () => {
    const { projectPath } = get()
    if (!projectPath) return
    const parts = projectPath.split(/[/\\]/)
    parts.pop()
    const parentPath = parts.join('/')
    if (parentPath) {
      get().setProjectPath(parentPath)
    }
  },

  showInFolder: async () => {
    const { projectPath } = get()
    if (projectPath) {
      await FileService.showInFolder(projectPath)
    }
  }
}))
