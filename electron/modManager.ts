import { dialog, ipcMain, shell } from 'electron'
import { basename, join, resolve, sep } from 'path'
import { lstat, stat, mkdir, readdir, readFile, rename, cp, rm } from 'fs/promises'
import { isAbsolute } from 'path'

type ModInfo = { id: string; folderName: string; name: string; version: string; author: string; description: string; enabled: boolean }
const validRoot = async (path: string) => isAbsolute(path) && (await stat(path).then(value => value.isDirectory()).catch(() => false))
function child(root: string, name: string): string | null {
  if (!name || name === '.' || name === '..' || basename(name) !== name || name.includes('/') || name.includes(String.fromCharCode(92)) || Array.from(name).some(character => character.charCodeAt(0) < 32 || '<>:"|?*'.includes(character))) return null
  const path = resolve(root, name)
  return path.startsWith(`${resolve(root)}${sep}`) ? path : null
}
async function metadata(folder: string, enabled: boolean): Promise<ModInfo> {
  const folderName = basename(folder)
  const fallback: ModInfo = { id: folderName, folderName, name: folderName, version: '未知', author: '未知', description: '', enabled }
  try {
    const files = await readdir(folder)
    const candidates = ['mod_manifest.json', 'mod.json', 'manifest.json', 'ModTheSpire.json', ...files.filter(file => file.toLowerCase().endsWith('.json') && /(mod|manifest)/i.test(file))]
    for (const file of Array.from(new Set(candidates))) {
      const path = child(folder, file)
      if (!path || !file.toLowerCase().endsWith('.json')) continue
      try {
        const value: unknown = JSON.parse(await readFile(path, 'utf8'))
        if (!value || typeof value !== 'object' || Array.isArray(value)) continue
        const item = value as Record<string, unknown>
        const authors = Array.isArray(item.authors) ? item.authors.filter((author): author is string => typeof author === 'string') : []
        return { ...fallback,
          id: typeof item.id === 'string' ? item.id : typeof item.pck_name === 'string' ? item.pck_name : folderName,
          name: typeof item.name === 'string' ? item.name : folderName,
          version: typeof item.version === 'string' ? item.version : '未知',
          author: authors.join(', ') || (typeof item.author === 'string' ? item.author : '未知'),
          description: typeof item.description === 'string' ? item.description : '',
        }
      } catch { /* try another root manifest */ }
    }
  } catch { /* keep folder-name fallback */ }
  return fallback
}
async function hasInstallManifest(folder: string): Promise<boolean> {
  try {
    const files = (await readdir(folder)).filter(file => file.toLowerCase().endsWith('.json'))
    const candidates = files.filter(file => ['mod_manifest.json', 'mod.json', 'manifest.json', 'modthespire.json'].includes(file.toLowerCase()) || /(mod|manifest)/i.test(file))
    for (const file of candidates) {
      const path = child(folder, file)
      if (!path) continue
      try {
        const value: unknown = JSON.parse(await readFile(path, 'utf8'))
        if (!value || typeof value !== 'object' || Array.isArray(value)) continue
        const item = value as Record<string, unknown>
        const hasId = ['id', 'pck_name', 'mod_id', 'modId'].some(key => typeof item[key] === 'string' && Boolean((item[key] as string).trim()))
        const hasName = typeof item.name === 'string' && Boolean(item.name.trim())
        if (hasId && hasName && files.some(file => /\.(dll|pck)$/i.test(file))) return true
      } catch { /* inspect the next manifest candidate */ }
    }
  } catch { /* picker result may have changed */ }
  return false
}

async function scan(gamePath: string) {
  if (!await validRoot(gamePath)) return { ok: false as const, error: '游戏目录无效或不可读取' }
  const records: ModInfo[] = []
  for (const [root, enabled] of [[join(gamePath, 'mods'), true], [join(gamePath, '.modstudio-disabled-mods'), false]] as const) {
    let entries
    try { entries = await readdir(root, { withFileTypes: true }) }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') continue
      return { ok: false as const, error: '无法读取 Mods 目录，请检查游戏目录权限' }
    }
    for (const entry of entries) {
      if (!entry.isDirectory() || entry.isSymbolicLink()) continue
      const folder = child(root, entry.name)
      if (folder) records.push(await metadata(folder, enabled))
    }
  }
  return { ok: true as const, mods: records.sort((a, b) => a.name.localeCompare(b.name)) }
}

export function registerModManagerHandlers() {
  ipcMain.handle('mods:list', (_event, gamePath: string) => scan(gamePath))
  ipcMain.handle('mods:install', async (_event, gamePath: string) => {
    if (!await validRoot(gamePath)) return { success: false, error: '游戏目录无效或不可读取' }
    const result = await dialog.showOpenDialog({ properties: ['openDirectory'] })
    if (result.canceled || !result.filePaths[0]) return { success: false, cancelled: true }
    const source = resolve(result.filePaths[0])
    const selectedStat = await lstat(source).catch(() => null)
    if (!selectedStat?.isDirectory() || selectedStat.isSymbolicLink() || source === resolve(gamePath)) return { success: false, error: '所选 Mod 目录无效' }
    const folderName = basename(source)
    const destination = child(join(gamePath, 'mods'), folderName)
    const disabledDestination = child(join(gamePath, '.modstudio-disabled-mods'), folderName)
    if (!destination || !disabledDestination) return { success: false, error: 'Mod 目录名无效' }
    if (!await hasInstallManifest(source)) return { success: false, error: '所选目录不是已构建的 Mod 包（需要 Mod ID/名称清单及根目录 .dll 或 .pck 文件）' }
    const staging = join(gamePath, `.modstudio-install-${process.pid}-${Date.now()}`)
    let destinationCreated = false
    try {
      await mkdir(join(gamePath, 'mods'), { recursive: true })
      const exists = await Promise.all([destination, disabledDestination].map(path => lstat(path).then(() => true).catch(() => false)))
      if (exists.some(Boolean)) return { success: false, error: '已存在同名 Mod，未覆盖现有文件' }
      await cp(source, staging, { recursive: true, errorOnExist: true, force: false, filter: async path => !(await lstat(path)).isSymbolicLink() })
      await mkdir(destination)
      destinationCreated = true
      await cp(staging, destination, { recursive: true, errorOnExist: true, force: false })
      await rm(staging, { recursive: true, force: true })
      return { success: true }
    } catch {
      await rm(staging, { recursive: true, force: true }).catch(() => undefined)
      if (destinationCreated) await rm(destination, { recursive: true, force: true }).catch(() => undefined)
      return { success: false, error: '安装未完成，请检查所选目录和游戏目录权限' }
    }
  })
  ipcMain.handle('mods:setEnabled', async (_event, gamePath: string, folderName: string, enabled: boolean) => {
    if (!await validRoot(gamePath)) return { success: false, error: '游戏目录无效或不可读取' }
    const activeRoot = join(gamePath, 'mods')
    const disabledRoot = join(gamePath, '.modstudio-disabled-mods')
    const from = child(enabled ? disabledRoot : activeRoot, folderName)
    const to = child(enabled ? activeRoot : disabledRoot, folderName)
    if (!from || !to) return { success: false, error: 'Mod 目录名无效' }
    try {
      const stat = await lstat(from)
      if (!stat.isDirectory() || stat.isSymbolicLink()) return { success: false, error: 'Mod 不在预期目录中' }
      await mkdir(enabled ? activeRoot : disabledRoot, { recursive: true })
      await rename(from, to)
      return { success: true }
    } catch (error) {
      return { success: false, error: (error as NodeJS.ErrnoException).code === 'EEXIST' ? '目标位置已有同名 Mod' : '操作失败，请刷新后重试并检查目录权限' }
    }
  })
  ipcMain.handle('mods:uninstall', async (_event, gamePath: string, folderName: string) => {
    if (!await validRoot(gamePath)) return { success: false, error: '游戏目录无效或不可读取' }
    const active = child(join(gamePath, 'mods'), folderName)
    const disabled = child(join(gamePath, '.modstudio-disabled-mods'), folderName)
    if (!active || !disabled) return { success: false, error: 'Mod 目录名无效' }
    try {
      const source = await lstat(active).then(() => active).catch(() => disabled)
      const stat = await lstat(source)
      if (!stat.isDirectory() || stat.isSymbolicLink()) return { success: false, error: 'Mod 不在预期目录中' }
      const trash = join(gamePath, '.modstudio-removed-mods')
      await mkdir(trash, { recursive: true })
      const destination = child(trash, `${Date.now()}-${folderName}`)
      if (!destination) return { success: false, error: '回收目录名无效' }
      await rename(source, destination)
      return { success: true }
    } catch { return { success: false, error: '卸载失败，请刷新后重试并检查目录权限' } }
  })
  ipcMain.handle('mods:openFolder', async (_event, gamePath: string) => {
    if (!await validRoot(gamePath)) return false
    const folder = join(gamePath, 'mods')
    await mkdir(folder, { recursive: true }).catch(() => undefined)
    return shell.openPath(folder).then(error => !error)
  })
}
