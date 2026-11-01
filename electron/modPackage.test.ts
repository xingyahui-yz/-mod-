import { mkdtemp, mkdir, rm, writeFile } from 'fs/promises'
import { join } from 'path'
import { afterEach, describe, expect, it } from 'vitest'
import { hasInstallManifest } from './modPackage'

describe('STS2 Mod package validation', () => {
  let root: string | undefined

  afterEach(async () => {
    if (root) await rm(root, { recursive: true, force: true })
    root = undefined
  })

  it('accepts a game-style manifest named after the Mod ID', async () => {
    root = await mkdtemp(join(process.cwd(), '.tmp-mod-package-baselib-'))
    const mod = join(root, 'BaseLib')
    await mkdir(mod)
    await writeFile(join(mod, 'BaseLib.json'), JSON.stringify({ id: 'BaseLib', name: 'BaseLib', has_dll: true, has_pck: true }))
    await writeFile(join(mod, 'BaseLib.dll'), 'test assembly')
    await writeFile(join(mod, 'BaseLib.pck'), 'test assets')

    await expect(hasInstallManifest(mod)).resolves.toBe(true)
  })

  it('rejects folders without a manifest or built artifact', async () => {
    root = await mkdtemp(join(process.cwd(), '.tmp-mod-package-invalid-'))
    await writeFile(join(root, 'settings.json'), JSON.stringify({ theme: 'dark' }))
    await expect(hasInstallManifest(root)).resolves.toBe(false)
    await writeFile(join(root, 'Only.dll'), 'test assembly')
    await expect(hasInstallManifest(root)).resolves.toBe(false)
  })
})
