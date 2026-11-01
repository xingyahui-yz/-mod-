/// <reference types="vite/client" />

interface Window {
  electronAPI: {
    openDirectory: () => Promise<string | null>
    saveDirectory: () => Promise<string | null>
    readDirectory: (dirPath: string) => Promise<import('./types').FileEntry[]>
    readDirectoryResult: (dirPath: string) => Promise<import('./services/FileService').FileReadResult<import('./types').FileEntry[]>>
    readFile: (filePath: string) => Promise<string | null>
    readFileResult: (filePath: string) => Promise<import('./services/FileService').FileReadResult<string>>
    writeFile: (filePath: string, content: string) => Promise<boolean>
    rename: (from: string, to: string) => Promise<boolean>
    linkNoReplace: (from: string, to: string) => Promise<{ status: 'linked' | 'exists' | 'failed' }>
    remove: (filePath: string) => Promise<boolean>
    stat: (filePath: string) => Promise<import('./types').FileStat | null>
    mkdir: (dirPath: string) => Promise<boolean>
    copyDirectory: (src: string, dest: string) => Promise<boolean>
    getUserDataPath: () => Promise<string>
    launchGame: (gamePath: string, modPath: string) => Promise<{ success: boolean; error?: string }>
    listMods: (gamePath: string) => Promise<{ ok: boolean; mods?: Array<{ id: string; folderName: string; name: string; version: string; author: string; description: string; enabled: boolean }>; error?: string }>
    installMod: (gamePath: string) => Promise<{ success: boolean; cancelled?: boolean; error?: string }>
    setModEnabled: (gamePath: string, folderName: string, enabled: boolean) => Promise<{ success: boolean; error?: string }>
    uninstallMod: (gamePath: string, folderName: string) => Promise<{ success: boolean; error?: string }>
    openModsFolder: (gamePath: string) => Promise<boolean>
    showInFolder: (filePath: string) => Promise<boolean>
  }
}
