import { app, BrowserWindow, ipcMain, dialog, shell } from 'electron'
import { join, resolve, isAbsolute, existsSync } from 'path'
import { readdir, stat, readFile, writeFile, mkdir, cp } from 'fs/promises'
import { spawn } from 'child_process'

// 保持窗口全局引用，防止被垃圾回收
let mainWindow: BrowserWindow | null = null

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 900,
    minHeight: 600,
    webPreferences: {
      preload: join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    },
    title: 'Slay the Spire 2 Mod Studio',
    show: false
  })

  // 窗口准备好后显示，避免白屏闪烁
  mainWindow.once('ready-to-show', () => {
    mainWindow?.show()
  })

  // 开发模式下打开DevTools
  if (process.env.NODE_ENV === 'development') {
    mainWindow.webContents.openDevTools()
  }

  // 加载页面
  if (process.env.VITE_DEV_SERVER_URL) {
    mainWindow.loadURL(process.env.VITE_DEV_SERVER_URL)
  } else {
    mainWindow.loadFile(join(__dirname, '../dist/index.html'))
  }

  mainWindow.on('closed', () => {
    mainWindow = null
  })
}

// ============ 路径安全验证 ============

/**
 * 验证路径是否为绝对路径且安全
 */
function isPathSafe(filePath: string): boolean {
  if (!filePath || typeof filePath !== 'string') return false
  // 必须是绝对路径
  if (!isAbsolute(filePath)) return false
  // 禁止路径遍历尝试
  const normalized = resolve(filePath)
  if (normalized.includes('..')) return false
  return true
}

/**
 * 验证目录路径
 */
function isDirPathSafe(dirPath: string): boolean {
  return isPathSafe(dirPath)
}

// ============ IPC 处理器 ============

// 打开文件夹选择对话框
ipcMain.handle('dialog:openDirectory', async () => {
  if (!mainWindow) return null
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ['openDirectory']
  })
  return result.canceled ? null : result.filePaths[0]
})

// 打开文件夹保存对话框(用于创建新项目)
ipcMain.handle('dialog:saveDirectory', async () => {
  if (!mainWindow) return null
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ['createDirectory', 'openDirectory']
  })
  return result.canceled ? null : result.filePaths[0]
})

// 读取目录内容
ipcMain.handle('fs:readDirectory', async (_event, dirPath: string) => {
  if (!isDirPathSafe(dirPath)) {
    console.error('Invalid directory path:', dirPath)
    return []
  }
  try {
    const entries = await readdir(dirPath, { withFileTypes: true })
    return entries.map(entry => ({
      name: entry.name,
      isDirectory: entry.isDirectory(),
      path: join(dirPath, entry.name)
    }))
  } catch (error) {
    console.error('Error reading directory:', error)
    return []
  }
})

// 读取文件内容
ipcMain.handle('fs:readFile', async (_event, filePath: string) => {
  if (!isPathSafe(filePath)) {
    console.error('Invalid file path:', filePath)
    return null
  }
  try {
    const content = await readFile(filePath, 'utf-8')
    return content
  } catch (error) {
    console.error('Error reading file:', error)
    return null
  }
})

// 写入文件
ipcMain.handle('fs:writeFile', async (_event, filePath: string, content: string) => {
  if (!isPathSafe(filePath)) {
    console.error('Invalid file path for write:', filePath)
    return false
  }
  if (typeof content !== 'string') {
    console.error('Content must be a string')
    return false
  }
  try {
    await writeFile(filePath, content, 'utf-8')
    return true
  } catch (error) {
    console.error('Error writing file:', error)
    return false
  }
})

// 获取文件/目录状态
ipcMain.handle('fs:stat', async (_event, filePath: string) => {
  if (!isPathSafe(filePath)) {
    return null
  }
  try {
    const s = await stat(filePath)
    return {
      isDirectory: s.isDirectory(),
      size: s.size,
      modifiedTime: s.mtime.toISOString()
    }
  } catch (error) {
    return null
  }
})

// 创建目录
ipcMain.handle('fs:mkdir', async (_event, dirPath: string) => {
  if (!isDirPathSafe(dirPath)) {
    console.error('Invalid directory path for mkdir:', dirPath)
    return false
  }
  try {
    await mkdir(dirPath, { recursive: true })
    return true
  } catch (error) {
    console.error('Error creating directory:', error)
    return false
  }
})

// 复制目录
ipcMain.handle('fs:copyDirectory', async (_event, src: string, dest: string) => {
  if (!isDirPathSafe(src) || !isDirPathSafe(dest)) {
    console.error('Invalid path for copy:', { src, dest })
    return false
  }
  try {
    await cp(src, dest, { recursive: true })
    return true
  } catch (error) {
    console.error('Error copying directory:', error)
    return false
  }
})

// 获取用户数据目录
ipcMain.handle('app:getUserDataPath', async () => {
  return app.getPath('userData')
})

// 启动游戏
ipcMain.handle('game:launch', async (_event, gamePath: string, modPath: string) => {
  if (!isDirPathSafe(gamePath) || !isDirPathSafe(modPath)) {
    return { success: false, error: '无效的路径' }
  }

  try {
    // 查找可执行文件
    const possibleExecs = [
      join(gamePath, 'Slay the Spire 2.exe'),
      join(gamePath, 'SlayTheSpire2.exe'),
      join(gamePath, 'Slay the Spire 2', 'Slay the Spire 2.exe')
    ]

    let executablePath = ''
    for (const exec of possibleExecs) {
      if (existsSync(exec)) {
        executablePath = exec
        break
      }
    }

    if (!executablePath) {
      // 尝试打开目录让用户手动找到
      await shell.openPath(gamePath)
      return { success: false, error: '未找到游戏可执行文件，请手动找到并运行' }
    }

    // 使用Steam协议或直接启动
    // 对于Steam游戏，最好使用steam://run/
    const isWindows = process.platform === 'win32'
    const isMac = process.platform === 'darwin'

    if (isWindows) {
      // Windows: 直接启动游戏
      spawn(executablePath, [], {
        detached: true,
        stdio: 'ignore',
        cwd: gamePath
      }).unref()

      return { success: true }
    } else if (isMac) {
      // macOS: 使用open命令
      spawn('open', ['-a', executablePath], {
        detached: true,
        stdio: 'ignore'
      }).unref()

      return { success: true }
    } else {
      return { success: false, error: '不支持的平台' }
    }
  } catch (error) {
    console.error('Error launching game:', error)
    return { success: false, error: String(error) }
  }
})

// 在文件管理器中显示路径
ipcMain.handle('shell:showInFolder', async (_event, filePath: string) => {
  if (!isPathSafe(filePath)) {
    return false
  }
  try {
    shell.showItemInFolder(filePath)
    return true
  } catch (error) {
    console.error('Error showing in folder:', error)
    return false
  }
})

// ============ 应用生命周期 ============

app.whenReady().then(createWindow)

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})

app.on('activate', () => {
  if (mainWindow === null) {
    createWindow()
  }
})
