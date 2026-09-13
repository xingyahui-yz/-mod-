import { act, fireEvent, render, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import App from './App'
import { installFileService, type ElectronAPI } from './services/FileService'
import { useProjectStore } from './hooks/useProject'
import { cardCatalogActions, getCardCatalogView } from './card/cardCatalog'
import { createEmptyGraph } from './node-editor/graph'

const mocks = vi.hoisted(() => ({ prepareForProjectSwitch: vi.fn(async () => true) }))

vi.mock('./ai-conversation/ProjectConversationContext', () => ({
  ProjectConversationProvider: ({ children }: { children: React.ReactNode }) => children,
  usePrepareForProjectSwitch: () => mocks.prepareForProjectSwitch,
}))

vi.mock('./ai-conversation/ProjectConversationDrawer', () => ({
  ProjectConversationDrawer: ({ onOpenCard }: { onOpenCard?: (cardId: string) => void }) => (
    <aside aria-label="测试项目 AI 抽屉">
      <button type="button" onClick={() => onOpenCard?.('CardB')}>预览 CardB 提案</button>
    </aside>
  ),
}))

vi.mock('./components/CardEditor', () => ({ CardEditor: () => <div>Card Editor</div> }))

describe('App 项目切换接线', () => {
  let openDirectory = vi.fn(async (): Promise<string | null> => null)

  beforeEach(async () => {
    cardCatalogActions.clear()
    openDirectory.mockReset()
    openDirectory.mockResolvedValue('/mods/b')
    installFileService({ api: electronApi(openDirectory) })
    mocks.prepareForProjectSwitch.mockReset()
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
    await act(async () => { await useProjectStore.getState().setProjectRoot('/mods/a') })
  })

  it('只有切换守卫成功后才把新目录设为 projectRoot', async () => {
    mocks.prepareForProjectSwitch.mockResolvedValueOnce(false).mockResolvedValueOnce(true)
    const { container } = render(<App />)
    const open = container.querySelector('.header button:last-child') as HTMLButtonElement

    fireEvent.click(open)
    await waitFor(() => expect(mocks.prepareForProjectSwitch).toHaveBeenCalledTimes(1))
    expect(useProjectStore.getState().projectRoot).toBe('/mods/a')

    fireEvent.click(open)
    await waitFor(() => expect(useProjectStore.getState().projectRoot).toBe('/mods/b'))
    expect(mocks.prepareForProjectSwitch).toHaveBeenCalledTimes(2)
    expect(openDirectory).toHaveBeenCalledTimes(2)
  })

  it('移除旧 AI 标签并持续挂载项目 AI 抽屉', () => {
    const { queryByText, getByRole } = render(<App />)

    expect(queryByText(/AI生成（旧版）/)).toBeNull()
    expect(getByRole('complementary', { name: '测试项目 AI 抽屉' })).toBeTruthy()
  })

  it('从项目对话预览 Card 时切到卡牌编辑器并确保选择目标', () => {
    cardCatalogActions.loadDocuments([
      cardDocument('CardA'),
      cardDocument('CardB'),
    ], '/mods/a')
    const { getByRole, getByText } = render(<App />)
    fireEvent.click(getByRole('button', { name: '📁 文件浏览' }))
    expect((getByText('Card Editor').closest('.editor-area') as HTMLElement).style.display).toBe('none')

    fireEvent.click(getByRole('button', { name: '预览 CardB 提案' }))

    expect(getCardCatalogView().selectedCardId).toBe('CardB')
    expect((getByText('Card Editor').closest('.editor-area') as HTMLElement).style.display).not.toBe('none')
  })
})

function cardDocument(id: string) {
  return {
    schemaVersion: 2 as const,
    card: {
      id,
      name: id,
      cost: 1,
      type: 'Attack' as const,
      rarity: 'Common' as const,
      description: id,
      keywords: [],
    },
    graph: createEmptyGraph(id, 'card'),
    generation: { lastGeneratedFingerprint: null },
  }
}

function electronApi(openDirectory: ElectronAPI['openDirectory']): ElectronAPI {
  return {
    openDirectory,
    saveDirectory: vi.fn(async () => null),
    readDirectory: vi.fn(async () => []),
    readFile: vi.fn(async () => null),
    writeFile: vi.fn(async () => true),
    mkdir: vi.fn(async () => true),
    rename: vi.fn(async () => true),
    remove: vi.fn(async () => true),
    copyDirectory: vi.fn(async () => true),
    getUserDataPath: vi.fn(async () => '/tmp'),
    launchGame: vi.fn(async () => ({ success: true })),
    showInFolder: vi.fn(async () => true),
  }
}
