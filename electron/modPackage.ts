import { readdir, readFile } from 'fs/promises'
import { join } from 'path'

export async function readModManifest(folder: string): Promise<Record<string, unknown> | null> {
  try {
    const files = await readdir(folder)
    const preferred = ['mod_manifest.json', 'mod.json', 'manifest.json', 'modthespire.json']
    const jsonFiles = files.filter(file => file.toLowerCase().endsWith('.json'))
    const candidates = [...preferred.filter(file => jsonFiles.some(entry => entry.toLowerCase() === file)),
      ...jsonFiles.filter(file => !preferred.includes(file.toLowerCase()))]

    for (const file of candidates) {
      try {
        const value: unknown = JSON.parse(await readFile(join(folder, file), 'utf8'))
        if (!value || typeof value !== 'object' || Array.isArray(value)) continue
        const item = value as Record<string, unknown>
        const hasId = ['id', 'pck_name', 'mod_id', 'modId'].some(key => typeof item[key] === 'string' && Boolean((item[key] as string).trim()))
        const hasName = typeof item.name === 'string' && Boolean(item.name.trim())
        if (hasId && hasName) return item
      } catch { /* inspect the next root JSON file */ }
    }
  } catch { /* folder may be inaccessible or no longer exist */ }
  return null
}

export async function hasInstallManifest(folder: string): Promise<boolean> {
  try {
    const files = await readdir(folder)
    if (!files.some(file => /\.(dll|pck)$/i.test(file))) return false
    return (await readModManifest(folder)) !== null
  } catch {
    return false
  }
}
