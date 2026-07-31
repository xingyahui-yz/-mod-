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

  // 读取文件内容
  readFile: (filePath: string): Promise<string | null> =>
    ipcRenderer.invoke('fs:readFile', filePath),

  // 写入文件
  writeFile: (filePath: string, content: string): Promise<boolean> =>
    ipcRenderer.invoke('fs:writeFile', filePath, content),

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
