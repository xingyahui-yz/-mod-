import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../services/FileService', () => ({
  openProjectDirectory: vi.fn(),
  getProjectFiles: vi.fn().mockResolvedValue([]),
  loadModManifest: vi.fn().mockResolvedValue(null),
  readFile: vi.fn().mockResolvedValue(null),
  showInFolder: vi.fn().mockResolvedValue(true),
}))

import * as FileService from '../services/FileService'
import { useProjectStore } from './useProject'

describe('useProjectStore project root', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(FileService.getProjectFiles).mockResolvedValue([])
    vi.mocked(FileService.loadModManifest).mockResolvedValue(null)
    useProjectStore.setState({
      projectRoot: null,
      browsePath: null,
      files: [],
      selectedFile: null,
      fileContent: null,
      modManifest: null,
      loading: false,
      error: null,
    })
  })

  it('目录导航只改变 browsePath，不改变项目根', async () => {
    await useProjectStore.getState().setProjectRoot('/project')
    await useProjectStore.getState().loadDirectory('/project/scripts')

    expect(useProjectStore.getState()).toMatchObject({
      projectRoot: '/project',
      browsePath: '/project/scripts',
    })

    useProjectStore.getState().navigateUp()
    await vi.waitFor(() => expect(useProjectStore.getState().browsePath).toBe('/project'))
    expect(useProjectStore.getState().projectRoot).toBe('/project')
  })

  it('禁止文件浏览器越过 projectRoot', async () => {
    await useProjectStore.getState().setProjectRoot('/project')
    vi.mocked(FileService.getProjectFiles).mockClear()

    await useProjectStore.getState().loadDirectory('/another-project')

    expect(FileService.getProjectFiles).not.toHaveBeenCalled()
    expect(useProjectStore.getState().browsePath).toBe('/project')
    expect(useProjectStore.getState().error).toMatch(/outside/)
  })

  it('showInFolder 始终定位项目根而不是浏览目录', async () => {
    await useProjectStore.getState().setProjectRoot('/project')
    await useProjectStore.getState().loadDirectory('/project/scripts')
    await useProjectStore.getState().showInFolder()

    expect(FileService.showInFolder).toHaveBeenCalledWith('/project')
  })
})
