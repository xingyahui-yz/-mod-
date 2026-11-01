import { contextBridge, ipcRenderer } from 'electron'

// 定义API类型
export interface FileEntry {
  name: string
  isDirectory: boolean
  path: string
}

export interface FileStat {
  isDirectory: boolean
  size: number
  modifiedTime: string
}

export type FileReadErrorCode = 'invalid-path' | 'permission-denied' | 'io'
export type FileReadResult<T> =
  | { status: 'found'; value: T }
  | { status: 'missing' }
  | { status: 'error'; code: FileReadErrorCode; error: string }

// 暴露给渲染进程的API
const electronAPI = {
  // 打开文件夹选择对话框
  openDirectory: (): Promise<string | null> =>
    ipcRenderer.invoke('dialog:openDirectory'),

  // 打开文件夹保存对话框(用于创建新项目)
  saveDirectory: (): Promise<string | null> =>
    ipcRenderer.invoke('dialog:saveDirectory'),

  // 读取目录内容
  readDirectory: (dirPath: string): Promise<FileEntry[]> =>
    ipcRenderer.invoke('fs:readDirectory', dirPath),

  readDirectoryResult: (dirPath: string): Promise<FileReadResult<FileEntry[]>> =>
    ipcRenderer.invoke('fs:readDirectoryResult', dirPath),

  // 读取文件内容
  readFile: (filePath: string): Promise<string | null> =>
    ipcRenderer.invoke('fs:readFile', filePath),

  readFileResult: (filePath: string): Promise<FileReadResult<string>> =>
    ipcRenderer.invoke('fs:readFileResult', filePath),

  // 写入文件
  writeFile: (filePath: string, content: string): Promise<boolean> =>
    ipcRenderer.invoke('fs:writeFile', filePath, content),

  // CardDocument repository 的原子替换/临时文件清理
  rename: (from: string, to: string): Promise<boolean> =>
    ipcRenderer.invoke('fs:rename', from, to),

  linkNoReplace: (from: string, to: string): Promise<{ status: 'linked' | 'exists' | 'failed' }> =>
    ipcRenderer.invoke('fs:linkNoReplace', from, to),

  remove: (filePath: string): Promise<boolean> =>
    ipcRenderer.invoke('fs:remove', filePath),

  // 获取文件状态
  stat: (filePath: string): Promise<FileStat | null> =>
    ipcRenderer.invoke('fs:stat', filePath),

  // 创建目录
  mkdir: (dirPath: string): Promise<boolean> =>
    ipcRenderer.invoke('fs:mkdir', dirPath),

  // 复制目录
  copyDirectory: (src: string, dest: string): Promise<boolean> =>
    ipcRenderer.invoke('fs:copyDirectory', src, dest),

  // 获取用户数据目录
  getUserDataPath: (): Promise<string> =>
    ipcRenderer.invoke('app:getUserDataPath'),

  // 通用 Mod 管理器：管理游戏目录中的已安装 Mod
  listMods: (gamePath: string): Promise<{ ok: boolean; mods?: Array<{ id: string; folderName: string; name: string; version: string; author: string; description: string; enabled: boolean }>; error?: string }> =>
    ipcRenderer.invoke('mods:list', gamePath),
  installMod: (gamePath: string): Promise<{ success: boolean; cancelled?: boolean; error?: string }> =>
    ipcRenderer.invoke('mods:install', gamePath),
  setModEnabled: (gamePath: string, folderName: string, enabled: boolean): Promise<{ success: boolean; error?: string }> =>
    ipcRenderer.invoke('mods:setEnabled', gamePath, folderName, enabled),
  uninstallMod: (gamePath: string, folderName: string): Promise<{ success: boolean; error?: string }> =>
    ipcRenderer.invoke('mods:uninstall', gamePath, folderName),
  openModsFolder: (gamePath: string): Promise<boolean> =>
    ipcRenderer.invoke('mods:openFolder', gamePath),

  // 启动游戏
  launchGame: (gamePath: string, modPath: string): Promise<{ success: boolean; error?: string }> =>
    ipcRenderer.invoke('game:launch', gamePath, modPath),

  // 在文件管理器中显示
  showInFolder: (filePath: string): Promise<boolean> =>
    ipcRenderer.invoke('shell:showInFolder', filePath)
}

contextBridge.exposeInMainWorld('electronAPI', electronAPI)

// 声明全局类型
declare global {
  interface Window {
    electronAPI: typeof electronAPI
  }
}
