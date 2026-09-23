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
    showInFolder: (filePath: string) => Promise<boolean>
  }
}
