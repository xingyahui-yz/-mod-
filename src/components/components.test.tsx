/**
 * 组件级测试 - 覆盖架构审查 v5 遗留问题修复:
 * 1. Modal 无障碍 (role/aria/Escape)
 * 2. CardSearch 受控化 + CardEditor 状态镜像修复 (useMemo + originalIndex)
 * 3. Toast 统一样式 (不再被 .save-message 覆盖)
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, screen, fireEvent, within, act, waitFor } from '@testing-library/react'
import { Modal } from './Modal'
import { CardSearch } from './CardSearch'
import { Toast } from './Toast'
import { CardEditor } from './CardEditor'
import { cardCatalogActions, getCardCatalogView } from '../card/cardCatalog'
import { createEmptyGraph } from '../node-editor/graph'
import * as FileService from '../services/FileService'
import { installFileService } from '../services/FileService'
import { CardData } from '../types'
import { serializeCardDocument, type CardDocument } from '../card/cardDocument'
import { createCardProposal } from '../card/cardAiProposal'
import { acquireCardPersistenceBarrier } from '../card/cardPersistenceBarrier'
import { clearCardPersistenceFailures } from '../card/cardPersistenceBarrier'
import { flushProjectCardChanges } from '../card/cardPersistenceCoordinator'

// 重置 Card store；Card 文档而非 localStorage 承担持久化
beforeEach(() => {
  localStorage.clear()
  cardCatalogActions.clear()
})

const loadCards = (cards: CardData[]) => cardCatalogActions.loadDocuments(cards.map(card => ({
  schemaVersion: 2,
  card,
  graph: createEmptyGraph(card.id, 'card'),
  generation: { lastGeneratedFingerprint: null },
})))

describe('Modal 无障碍', () => {
  it('渲染 role="dialog" / aria-modal / aria-labelledby', () => {
    render(
      <Modal isOpen onClose={() => {}} title="测试标题">
        <p>内容</p>
      </Modal>
    )

    const dialog = screen.getByRole('dialog')
    expect(dialog.getAttribute('aria-modal')).toBe('true')

    const labelledby = dialog.getAttribute('aria-labelledby')
    expect(labelledby).toBeTruthy()
    expect(document.getElementById(labelledby!)?.textContent).toBe('测试标题')
  })

  it('按 Escape 关闭', () => {
    const onClose = vi.fn()
    render(
      <Modal isOpen onClose={onClose} title="测试">
        <p>内容</p>
      </Modal>
    )

    fireEvent.keyDown(window, { key: 'Escape' })
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('点击遮罩关闭，点击内容区不关闭', () => {
    const onClose = vi.fn()
    render(
      <Modal isOpen onClose={onClose} title="测试">
        <p>内容</p>
      </Modal>
    )

    fireEvent.click(screen.getByText('内容'))
    expect(onClose).not.toHaveBeenCalled()

    fireEvent.click(screen.getByRole('dialog').parentElement!)
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('关闭状态不渲染', () => {
    const { container } = render(
      <Modal isOpen={false} onClose={() => {}} title="测试">
        <p>内容</p>
      </Modal>
    )
    expect(container.innerHTML).toBe('')
  })

  it('onClose 引用变化时 Escape 仍能调用最新的回调', () => {
    const first = vi.fn()
    const second = vi.fn()

    const { rerender } = render(
      <Modal isOpen onClose={first} title="测试">x</Modal>
    )
    fireEvent.keyDown(window, { key: 'Escape' })
    expect(first).toHaveBeenCalledTimes(1)

    // 模拟父组件传入新的回调（每次渲染都是新箭头函数的常见场景）
    rerender(<Modal isOpen onClose={second} title="测试">x</Modal>)
    fireEvent.keyDown(window, { key: 'Escape' })
    expect(second).toHaveBeenCalledTimes(1)
    // 第一个不应再被调用（已解除绑定）
    expect(first).toHaveBeenCalledTimes(1)
  })

  it('自定义宽度生效', () => {
    render(<Modal isOpen onClose={() => {}} title="测试" width={600}>x</Modal>)
    const dialog = screen.getByRole('dialog') as HTMLElement
    expect(dialog.style.width).toBe('600px')
  })

  it('字符串宽度也支持', () => {
    render(<Modal isOpen onClose={() => {}} title="测试" width="80%">x</Modal>)
    const dialog = screen.getByRole('dialog') as HTMLElement
    expect(dialog.style.width).toBe('80%')
  })

  it('关闭按钮可点击触发 onClose', () => {
    const onClose = vi.fn()
    render(<Modal isOpen onClose={onClose} title="测试">x</Modal>)
    fireEvent.click(screen.getByRole('button', { name: '×' }))
    expect(onClose).toHaveBeenCalledTimes(1)
  })
})

describe('CardSearch 受控组件', () => {
  const props = {
    searchTerm: '',
    typeFilter: 'all' as const,
    filteredCount: 2,
    totalCount: 4,
    onSearchTermChange: vi.fn(),
    onTypeFilterChange: vi.fn()
  }

  it('输入触发 onSearchTermChange', () => {
    render(<CardSearch {...props} />)
    fireEvent.change(screen.getByPlaceholderText('搜索卡牌名称、描述或关键词...'), {
      target: { value: '火' }
    })
    expect(props.onSearchTermChange).toHaveBeenCalledWith('火')
  })

  it('清空按钮触发 onSearchTermChange("")', () => {
    render(<CardSearch {...props} searchTerm="火" />)
    fireEvent.click(screen.getByRole('button', { name: '×' }))
    expect(props.onSearchTermChange).toHaveBeenCalledWith('')
  })

  it('类型筛选按钮触发 onTypeFilterChange', () => {
    render(<CardSearch {...props} />)
    fireEvent.click(screen.getByRole('button', { name: /攻击/ }))
    expect(props.onTypeFilterChange).toHaveBeenCalledWith('Attack')
  })

  it('显示过滤计数', () => {
    render(<CardSearch {...props} />)
    expect(screen.getByText('2 / 4 张卡牌')).toBeTruthy()
  })
})

describe('Toast 统一样式', () => {
  it('使用默认 toast 样式类（不再被 save-message 覆盖）', () => {
    render(<Toast message={{ type: 'success', text: '已保存' }} />)
    const toast = screen.getByText('已保存')
    expect(toast.className).toBe('toast success')
    expect(toast.className).not.toContain('save-message')
  })
})

describe('CardEditor 过滤 + 原始索引', () => {
  const seedCards: CardData[] = [
    { id: 'Fireball', name: '火球', cost: 1, type: 'Attack', rarity: 'Common', description: '造成6点伤害', keywords: ['Fire'] },
    { id: 'Shield', name: '护盾', cost: 1, type: 'Skill', rarity: 'Common', description: '获得5点格挡', keywords: ['Block'] },
    { id: 'Frost', name: '寒冰', cost: 2, type: 'Attack', rarity: 'Common', description: '造成4点伤害', keywords: ['Ice'] }
  ]

  // 卡牌列表容器（「火球」也会出现在预览区，需限定查询范围）
  const cardList = (container: HTMLElement) =>
    within(container.querySelector('.card-list') as HTMLElement)

  const renderEditor = () => render(<CardEditor projectPath={null} />)

  it('按类型过滤 + 在过滤结果中删除使用正确的原始索引', () => {
    loadCards(seedCards)
    const { container } = renderEditor()
    const list = cardList(container)

    // 初始显示全部3张
    expect(list.getByText('火球')).toBeTruthy()
    expect(list.getByText('寒冰')).toBeTruthy()
    expect(list.getByText('护盾')).toBeTruthy()

    // 过滤为攻击卡
    fireEvent.click(screen.getByRole('button', { name: /攻击/ }))
    expect(screen.getByText('2 / 3 张卡牌')).toBeTruthy()
    expect(list.queryByText('护盾')).toBeNull()

    // 删除过滤列表中的「寒冰」(原始索引2)
    const iceItem = list.getByText('寒冰').closest('.card-item')! as HTMLElement
    fireEvent.click(within(iceItem).getByRole('button', { name: '×' }))

    // 切回全部：护盾保留，寒冰被删
    fireEvent.click(screen.getByRole('button', { name: '全部' }))
    expect(list.getByText('火球')).toBeTruthy()
    expect(list.getByText('护盾')).toBeTruthy()
    expect(list.queryByText('寒冰')).toBeNull()
  })

  it('在过滤结果中选择卡牌选中正确的原始索引', () => {
    loadCards(seedCards)
    const { container } = renderEditor()

    // 按名称搜索「寒冰」
    fireEvent.change(screen.getByPlaceholderText('搜索卡牌名称、描述或关键词...'), {
      target: { value: '寒' }
    })
    expect(screen.getByText('1 / 3 张卡牌')).toBeTruthy()

    // 选中「寒冰」→ 编辑面板应显示寒冰(原始索引2)
    fireEvent.click(cardList(container).getByText('寒冰'))
    expect((screen.getByDisplayValue('寒冰') as HTMLInputElement).value).toBe('寒冰')
    expect(getCardCatalogView().selectedCardIndex).toBe(2)
  })

  it('新建 Card 先确认不可变 ID，再进入编辑器', () => {
    loadCards([seedCards[0]])
    renderEditor()
    fireEvent.click(screen.getByRole('button', { name: '+ 新建卡牌' }))
    expect(screen.getByTestId('card-id-dialog')).toBeTruthy()
    fireEvent.change(screen.getByTestId('new-card-id-input'), { target: { value: 'Fireball' } })
    fireEvent.click(screen.getByRole('button', { name: '确认创建' }))
    expect(screen.getByText(/Card ID Fireball 已存在/)).toBeTruthy()
    fireEvent.change(screen.getByTestId('new-card-id-input'), { target: { value: 'NewCard' } })
    fireEvent.click(screen.getByRole('button', { name: '确认创建' }))
    expect(getCardCatalogView().selectedCardId).toBe('NewCard')
  })

  it('Card 属性编辑与撤销/重做共享同一历史', () => {
    loadCards(seedCards)
    renderEditor()
    fireEvent.change(screen.getByDisplayValue('火球'), { target: { value: '新火球' } })
    expect(screen.getByDisplayValue('新火球')).toBeTruthy()
    fireEvent.click(screen.getByTitle('撤销 Card 编辑'))
    expect(screen.getByDisplayValue('火球')).toBeTruthy()
    fireEvent.click(screen.getByTitle('重做 Card 编辑'))
    expect(screen.getByDisplayValue('新火球')).toBeTruthy()
  })

  it('连续文本输入只重置自动保存窗口，到期仅写入最终草稿一次', async () => {
    const alpha = cardDocument(seedCards[0])
    const writeFile = vi.fn(async (_path: string, _content: string) => true)
    installFileService({ api: createCardEditorApi({
      readDirectory: vi.fn(async (path: string) => path === '/A/.modstudio/cards'
        ? [{ name: 'Fireball.json', path: '/A/.modstudio/cards/Fireball.json', isDirectory: false }]
        : []),
      readFile: vi.fn(async (path: string) => path.endsWith('/Fireball.json')
        ? serializeCardDocument(alpha)
        : null),
      writeFile,
    }) })
    render(<CardEditor projectPath="/A" />)
    const input = await screen.findByDisplayValue('火球')

    fireEvent.change(input, { target: { value: '火' } })
    fireEvent.change(input, { target: { value: '火球改' } })
    fireEvent.change(input, { target: { value: '最终草稿' } })
    expect(writeFile).not.toHaveBeenCalled()

    await act(async () => { await new Promise(resolve => setTimeout(resolve, 600)) })
    expect(writeFile).toHaveBeenCalledTimes(1)
    expect(vi.mocked(writeFile).mock.calls[0]?.[1]).toContain('最终草稿')
  })

  it('现有 CardEditor 原位显示 Card 行为图并写回同一 CardDocument', () => {
    loadCards(seedCards)
    renderEditor()
    expect(screen.getByTestId('card-node-editor')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: '+ onPlay' }))
    expect(screen.getByTestId('node-graph-canvas').querySelectorAll('[data-testid^="node-box-"]')).toHaveLength(1)
    expect(getCardCatalogView().currentDocument?.graph.nodes[0].data.event).toBe('onPlay')
  })

  it('搜索 + 类型过滤组合', () => {
    loadCards(seedCards)
    renderEditor()

    fireEvent.change(screen.getByPlaceholderText('搜索卡牌名称、描述或关键词...'), {
      target: { value: '火' }
    })
    fireEvent.click(screen.getByRole('button', { name: /技能/ }))

    // 「火球」是攻击卡 → 组合过滤后为空
    expect(screen.getByText('0 / 3 张卡牌')).toBeTruthy()
  })

  it('loadExistingCards 失败时显示 Toast 错误', async () => {
    // 通过 installFileService 注入拒绝响应的 API (v0.8-2 factory seam)
    const mockApi: FileService.ElectronAPI = {
      openDirectory: vi.fn(), saveDirectory: vi.fn(),
      readDirectory: vi.fn().mockRejectedValue(new Error('EACCES: permission denied')),
      readFile: vi.fn(), writeFile: vi.fn(), mkdir: vi.fn(),
      copyDirectory: vi.fn(), getUserDataPath: vi.fn(),
      launchGame: vi.fn(), showInFolder: vi.fn()
    }
    installFileService({ api: mockApi })

    await act(async () => {
      render(<CardEditor projectPath="/bad/path" />)
    })

    const toast = await screen.findByText(/加载卡牌失败/, {}, { timeout: 1000 })
    expect(toast).toBeTruthy()
    expect(toast.className).toContain('error')
  })

  it('loadExistingCards 成功但无卡牌时不显示 Toast', async () => {
    const mockApi: FileService.ElectronAPI = {
      openDirectory: vi.fn(), saveDirectory: vi.fn(),
      readDirectory: vi.fn().mockResolvedValue([]),
      readFile: vi.fn(), writeFile: vi.fn(), mkdir: vi.fn(),
      copyDirectory: vi.fn(), getUserDataPath: vi.fn(),
      launchGame: vi.fn(), showInFolder: vi.fn()
    }
    installFileService({ api: mockApi })

    await act(async () => {
      render(<CardEditor projectPath="/empty" />)
    })

    // 给 useEffect 充分时间；不应出现错误 toast
    await new Promise(r => setTimeout(r, 50))
    expect(screen.queryByText(/加载卡牌失败/)).toBeNull()
  })

  it('空项目中新建 Card 会作为未持久化草稿自动保存', async () => {
    const writeFile = vi.fn(async (_path: string, _content: string) => true)
    installFileService({ api: createCardEditorApi({
      readDirectory: vi.fn(async () => []),
      writeFile,
    }) })

    render(<CardEditor projectPath="/A" />)
    fireEvent.click(await screen.findByRole('button', { name: '创建第一张卡牌' }))
    fireEvent.change(screen.getByTestId('new-card-id-input'), { target: { value: 'NewCard' } })
    fireEvent.click(screen.getByRole('button', { name: '确认创建' }))
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 600)) })

    expect(writeFile).toHaveBeenCalledTimes(1)
    expect(vi.mocked(writeFile).mock.calls[0]?.[0]).toMatch(/NewCard\.json\.tmp-/)
  })

  it('新 Card 首次落盘完成前不发布到 Catalog，成功后只占用一次 ID', async () => {
    const firstWrite = deferred<boolean>()
    let created = false
    const writeFile = vi.fn()
      .mockImplementationOnce(() => firstWrite.promise)
      .mockResolvedValue(true)
    const linkNoReplace = vi.fn(async (_source: string, target: string) => {
      if (target.endsWith('/NewCard.json')) created = true
      return { status: 'linked' as const }
    })
    installFileService({ api: createCardEditorApi({
      readDirectory: vi.fn(async (path: string) => created && path === '/A/.modstudio/cards'
        ? [{ name: 'NewCard.json', path: '/A/.modstudio/cards/NewCard.json', isDirectory: false }]
        : []),
      writeFile,
      linkNoReplace,
    }) })

    render(<CardEditor projectPath="/A" />)
    fireEvent.click(await screen.findByRole('button', { name: '创建第一张卡牌' }))
    fireEvent.change(screen.getByTestId('new-card-id-input'), { target: { value: 'NewCard' } })
    fireEvent.click(screen.getByRole('button', { name: '确认创建' }))
    await waitFor(() => expect(writeFile).toHaveBeenCalledTimes(1), { timeout: 1000 })
    expect(getCardCatalogView().documents).toHaveLength(0)
    expect(writeFile).toHaveBeenCalledTimes(1)

    await act(async () => { firstWrite.resolve(true); await Promise.resolve() })
    expect(await screen.findByDisplayValue('My Card')).toBeTruthy()
    expect(writeFile).toHaveBeenCalledTimes(1)
    expect(linkNoReplace.mock.calls.filter(call => call[1].endsWith('/NewCard.json'))).toHaveLength(1)
  })

  it('批量导入的每张 Card 都先原子占用 ID 并落盘，不只保存最后选择项', async () => {
    const writeFile = vi.fn(async (_path: string, _content: string) => true)
    const linkNoReplace = vi.fn(async (_source: string, _target: string) => ({ status: 'linked' as const }))
    const api = createCardEditorApi({
      readDirectory: vi.fn(async () => []),
      writeFile,
      linkNoReplace,
    })
    installFileService({ api })
    const rendered = render(<CardEditor projectPath="/A" />)
    await screen.findByRole('button', { name: '创建第一张卡牌' })
    const imported = new File([JSON.stringify([seedCards[0], seedCards[1]])], 'cards.json', {
      type: 'application/json',
    })
    Object.defineProperty(imported, 'text', {
      value: async () => JSON.stringify([seedCards[0], seedCards[1]]),
    })

    fireEvent.change(rendered.container.querySelector('input[type="file"]')!, {
      target: { files: [imported] },
    })
    await waitFor(() => expect(getCardCatalogView().documents).toHaveLength(2))
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 600)) })

    expect(writeFile).toHaveBeenCalledTimes(2)
    expect(linkNoReplace).toHaveBeenCalledTimes(4)
    expect(linkNoReplace.mock.calls.map(call => call[1])).toEqual(expect.arrayContaining([
      '/A/.modstudio/cards/.id-claims/fireball.claim',
      '/A/.modstudio/cards/Fireball.json',
      '/A/.modstudio/cards/.id-claims/shield.claim',
      '/A/.modstudio/cards/Shield.json',
    ]))
  })

  it('导入等待磁盘占用期间会 reservation 同 ID，手工创建不能发布分叉草稿', async () => {
    const firstWrite = deferred<boolean>()
    const writeFile = vi.fn(() => firstWrite.promise)
    installFileService({ api: createCardEditorApi({
      readDirectory: vi.fn(async () => []),
      writeFile,
    }) })
    const rendered = render(<CardEditor projectPath="/A" />)
    await screen.findByRole('button', { name: '创建第一张卡牌' })
    const imported = new File([JSON.stringify([seedCards[0]])], 'cards.json', { type: 'application/json' })
    Object.defineProperty(imported, 'text', { value: async () => JSON.stringify([seedCards[0]]) })
    fireEvent.change(rendered.container.querySelector('input[type="file"]')!, {
      target: { files: [imported] },
    })
    await waitFor(() => expect(writeFile).toHaveBeenCalledTimes(1))

    fireEvent.click(screen.getByRole('button', { name: '+ 新建卡牌' }))
    fireEvent.change(screen.getByTestId('new-card-id-input'), { target: { value: 'Fireball' } })
    fireEvent.click(screen.getByRole('button', { name: '确认创建' }))
    expect(await screen.findByText(/Card ID Fireball 正在被其他创建操作占用/)).toBeTruthy()
    expect(getCardCatalogView().documents).toHaveLength(0)

    await act(async () => { firstWrite.resolve(true); await Promise.resolve() })
    await waitFor(() => expect(getCardCatalogView().documents).toHaveLength(1))
    expect(getCardCatalogView().documents[0].card.name).toBe('火球')
  })

  it('项目 A 的迟到加载不会覆盖已经切换到的项目 B', async () => {
    const projectA = deferred<FileService.FileEntry[]>()
    const alpha = cardDocument(seedCards[0])
    const beta = cardDocument(seedCards[1])
    const readDirectory = vi.fn((path: string): Promise<FileService.FileEntry[]> => {
      if (path === '/A/.modstudio/cards') return projectA.promise
      if (path === '/B/.modstudio/cards') return Promise.resolve([{ name: 'Shield.json', path: '/B/.modstudio/cards/Shield.json', isDirectory: false }])
      return Promise.resolve([])
    })
    const mockApi = createCardEditorApi({
      readDirectory,
      readFile: vi.fn(async (path: string) => path.includes('/Shield.json')
        ? serializeCardDocument(beta)
        : serializeCardDocument(alpha)),
    })
    installFileService({ api: mockApi })

    const editor = render(<CardEditor projectPath="/A" />)
    await waitFor(() => expect(readDirectory).toHaveBeenCalledWith('/A/.modstudio/cards'))
    editor.rerender(<CardEditor projectPath="/B" />)
    expect((await screen.findAllByText('护盾')).length).toBeGreaterThan(0)

    await act(async () => {
      projectA.resolve([{ name: 'Fireball.json', path: '/A/.modstudio/cards/Fireball.json', isDirectory: false }])
      await Promise.resolve()
    })
    expect(getCardCatalogView().sourceProjectRoot).toBe('/B')
    expect(getCardCatalogView().currentCard?.id).toBe('Shield')
    expect(screen.queryByText('火球')).toBeNull()
  })

  it('项目切换只把 A 的待保存 Card 写回 A，不会写入 B', async () => {
    const alpha = cardDocument(seedCards[0])
    const writeFile = vi.fn(async (_path: string, _content: string) => true)
    const mockApi = createCardEditorApi({
      readDirectory: vi.fn(async (path: string) => path === '/A/.modstudio/cards'
        ? [{ name: 'Fireball.json', path: '/A/.modstudio/cards/Fireball.json', isDirectory: false }]
        : []),
      readFile: vi.fn(async (path: string) => path.includes('/Fireball.json') ? serializeCardDocument(alpha) : null),
      writeFile,
    })
    installFileService({ api: mockApi })

    const editor = render(<CardEditor projectPath="/A" />)
    const input = await screen.findByDisplayValue('火球')
    fireEvent.change(input, { target: { value: '未保存火球' } })
    editor.rerender(<CardEditor projectPath="/B" />)

    await waitFor(() => expect(writeFile).toHaveBeenCalled())
    const writtenPaths = writeFile.mock.calls.map(call => call[0])
    expect(writtenPaths.some(path => path.startsWith('/A/.modstudio/cards/Fireball.json.tmp-'))).toBe(true)
    expect(writtenPaths.some(path => path.startsWith('/B/'))).toBe(false)
    expect(getCardCatalogView().sourceProjectRoot).toBe('/B')
  })

  it('AI 提案接管 Card 持久化时取消通用 autosave，不会写回旧草稿或重复写候选', async () => {
    const alpha = cardDocument(seedCards[0])
    const writeFile = vi.fn(async (_path: string, _content: string) => true)
    const mockApi = createCardEditorApi({
      readDirectory: vi.fn(async (path: string) => path === '/A/.modstudio/cards'
        ? [{ name: 'Fireball.json', path: '/A/.modstudio/cards/Fireball.json', isDirectory: false }]
        : []),
      readFile: vi.fn(async (path: string) => path.includes('/Fireball.json')
        ? serializeCardDocument(alpha)
        : null),
      writeFile,
    })
    installFileService({ api: mockApi })

    render(<CardEditor projectPath="/A" />)
    const input = await screen.findByDisplayValue('火球')
    fireEvent.change(input, { target: { value: '尚未保存的手工草稿' } })
    const edited = getCardCatalogView().currentDocument!
    const proposal = createCardProposal(edited, {
      ...edited,
      card: { ...edited.card, name: 'AI 候选内容' },
    })
    expect(proposal.status).toBe('ready')

    await act(async () => {
      if (proposal.status === 'ready') {
        cardCatalogActions.applyProposal(proposal.proposal, {
          provenance: {
            kind: 'ai-proposal',
            proposalId: 'proposal-autosave-order',
            transactionId: 'transaction-autosave-order',
          },
        })
      }
      await new Promise(resolve => setTimeout(resolve, 600))
    })

    expect(screen.getByDisplayValue('AI 候选内容')).toBeTruthy()
    expect(writeFile).not.toHaveBeenCalled()
  })

  it('history WAL barrier 完成前不让后继手工编辑抢先自动保存', async () => {
    const alpha = cardDocument(seedCards[0])
    const writeFile = vi.fn(async (_path: string, _content: string) => true)
    const mockApi = createCardEditorApi({
      readDirectory: vi.fn(async (path: string) => path === '/A/.modstudio/cards'
        ? [{ name: 'Fireball.json', path: '/A/.modstudio/cards/Fireball.json', isDirectory: false }]
        : []),
      readFile: vi.fn(async (path: string) => path.includes('/Fireball.json')
        ? serializeCardDocument(alpha)
        : null),
      writeFile,
    })
    installFileService({ api: mockApi })

    render(<CardEditor projectPath="/A" />)
    const input = await screen.findByDisplayValue('火球')
    let lease!: ReturnType<typeof acquireCardPersistenceBarrier>
    act(() => { lease = acquireCardPersistenceBarrier('/A', 'Fireball') })
    fireEvent.change(input, { target: { value: 'WAL 后继草稿' } })

    await act(async () => { await new Promise(resolve => setTimeout(resolve, 600)) })
    expect(writeFile).not.toHaveBeenCalled()
    act(() => { cardCatalogActions.selectCard(null) })

    await act(async () => {
      lease.release()
      await Promise.resolve()
    })
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 600)) })
    expect(writeFile).toHaveBeenCalledTimes(1)
    expect(vi.mocked(writeFile).mock.calls[0]?.[1]).toContain('WAL 后继草稿')
  })

  it('项目切换 flush 会等待非当前 Card 的 barrier 后继草稿落盘', async () => {
    const alpha = cardDocument(seedCards[0])
    const writeFile = vi.fn(async (_path: string, _content: string) => true)
    installFileService({ api: createCardEditorApi({
      readDirectory: vi.fn(async (path: string) => path === '/A/.modstudio/cards'
        ? [{ name: 'Fireball.json', path: '/A/.modstudio/cards/Fireball.json', isDirectory: false }]
        : []),
      readFile: vi.fn(async (path: string) => path.includes('/Fireball.json')
        ? serializeCardDocument(alpha)
        : null),
      writeFile,
    }) })

    render(<CardEditor projectPath="/A" />)
    const input = await screen.findByDisplayValue('火球')
    const lease = acquireCardPersistenceBarrier('/A', 'Fireball')
    fireEvent.change(input, { target: { value: '切换前必须保存' } })
    act(() => { cardCatalogActions.selectCard(null) })

    let settled = false
    const flushing = flushProjectCardChanges('/A').then(result => {
      settled = true
      return result
    })
    await Promise.resolve()
    expect(settled).toBe(false)

    act(() => lease.release())
    await expect(flushing).resolves.toEqual({ ok: true })
    expect(writeFile).toHaveBeenCalledTimes(1)
    expect(vi.mocked(writeFile).mock.calls[0]?.[1]).toContain('切换前必须保存')
  })

  it('项目切换 flush 写入期间的新编辑也会在离开前保存', async () => {
    const alpha = cardDocument(seedCards[0])
    const firstWrite = deferred<boolean>()
    const writeFile = vi.fn()
      .mockImplementationOnce(() => firstWrite.promise)
      .mockResolvedValue(true)
    installFileService({ api: createCardEditorApi({
      readDirectory: vi.fn(async (path: string) => path === '/A/.modstudio/cards'
        ? [{ name: 'Fireball.json', path: '/A/.modstudio/cards/Fireball.json', isDirectory: false }]
        : []),
      readFile: vi.fn(async (path: string) => path.includes('/Fireball.json')
        ? serializeCardDocument(alpha)
        : null),
      writeFile,
    }) })

    render(<CardEditor projectPath="/A" />)
    const input = await screen.findByDisplayValue('火球')
    fireEvent.change(input, { target: { value: '切换首稿' } })
    const flushing = flushProjectCardChanges('/A')
    await waitFor(() => expect(writeFile).toHaveBeenCalledTimes(1))

    fireEvent.change(screen.getByDisplayValue('切换首稿'), { target: { value: '切换前最终稿' } })
    firstWrite.resolve(true)

    await expect(flushing).resolves.toEqual({ ok: true })
    expect(writeFile).toHaveBeenCalledTimes(2)
    expect(vi.mocked(writeFile).mock.calls[1]?.[1]).toContain('切换前最终稿')
  })

  it('history WAL 失败后保持 Card 保存阻断，后继编辑不会伪装成已保存', async () => {
    const alpha = cardDocument(seedCards[0])
    const writeFile = vi.fn(async (_path: string, _content: string) => true)
    installFileService({ api: createCardEditorApi({
      readDirectory: vi.fn(async (path: string) => path === '/A/.modstudio/cards'
        ? [{ name: 'Fireball.json', path: '/A/.modstudio/cards/Fireball.json', isDirectory: false }]
        : []),
      readFile: vi.fn(async (path: string) => path.endsWith('/Fireball.json')
        ? serializeCardDocument(alpha)
        : null),
      writeFile,
    }) })

    try {
      render(<CardEditor projectPath="/A" />)
      const input = await screen.findByDisplayValue('火球')
      const lease = acquireCardPersistenceBarrier('/A', 'Fireball')
      fireEvent.change(input, { target: { value: '不能落盘的事务状态' } })
      act(() => lease.release('failed'))
      await act(async () => { await new Promise(resolve => setTimeout(resolve, 600)) })

      expect(writeFile).not.toHaveBeenCalled()
      expect(screen.getByText('自动保存失败')).toBeTruthy()
      fireEvent.change(screen.getByDisplayValue('不能落盘的事务状态'), { target: { value: '仍然阻断' } })
      await act(async () => { await new Promise(resolve => setTimeout(resolve, 600)) })
      expect(writeFile).not.toHaveBeenCalled()
    } finally {
      clearCardPersistenceFailures('/A')
    }
  })

  it('非当前 Card 的持久化事务进行中也会阻止批量生成', async () => {
    const alpha = cardDocument(seedCards[0])
    const beta = cardDocument(seedCards[1])
    installFileService({ api: createCardEditorApi({
      readDirectory: vi.fn(async (path: string) => path === '/A/.modstudio/cards'
        ? [
            { name: 'Fireball.json', path: '/A/.modstudio/cards/Fireball.json', isDirectory: false },
            { name: 'Shield.json', path: '/A/.modstudio/cards/Shield.json', isDirectory: false },
          ]
        : []),
      readFile: vi.fn(async (path: string) => {
        if (path === '/A/.modstudio/cards/Fireball.json') return serializeCardDocument(alpha)
        if (path === '/A/.modstudio/cards/Shield.json') return serializeCardDocument(beta)
        return null
      }),
    }) })
    const generateCardBatch = vi.spyOn(FileService, 'generateCardBatch')
    let lease: ReturnType<typeof acquireCardPersistenceBarrier> | null = null

    try {
      const rendered = render(<CardEditor projectPath="/A" />)
      const shield = await screen.findByText('护盾', { selector: '.card-name' })
      fireEvent.click(within(shield.closest('.card-item') as HTMLElement).getByText('护盾'))
      expect(getCardCatalogView().selectedCardId).toBe('Shield')

      act(() => { lease = acquireCardPersistenceBarrier('/A', 'Fireball') })
      const batchButton = within(rendered.container).getByTitle('逐张生成当前项目中的 Card')
      expect((batchButton as HTMLButtonElement).disabled).toBe(false)
      fireEvent.click(batchButton)

      expect(await screen.findByText('仍有 Card 事务正在持久化，批量生成已暂停')).toBeTruthy()
      expect(generateCardBatch).not.toHaveBeenCalled()
    } finally {
      if (lease) act(() => { lease?.release() })
      generateCardBatch.mockRestore()
    }
  })

  it('history WAL barrier 释放后选中 Card 的延迟草稿只保存一次', async () => {
    const alpha = cardDocument(seedCards[0])
    const writeFile = vi.fn(async (_path: string, _content: string) => true)
    installFileService({ api: createCardEditorApi({
      readDirectory: vi.fn(async (path: string) => path === '/A/.modstudio/cards'
        ? [{ name: 'Fireball.json', path: '/A/.modstudio/cards/Fireball.json', isDirectory: false }]
        : []),
      readFile: vi.fn(async (path: string) => path.includes('/Fireball.json')
        ? serializeCardDocument(alpha)
        : null),
      writeFile,
    }) })

    render(<CardEditor projectPath="/A" />)
    const input = await screen.findByDisplayValue('火球')
    let lease!: ReturnType<typeof acquireCardPersistenceBarrier>
    act(() => { lease = acquireCardPersistenceBarrier('/A', 'Fireball') })
    fireEvent.change(input, { target: { value: '只写一次' } })
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 600)) })

    await act(async () => { lease.release(); await Promise.resolve() })
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 600)) })
    expect(writeFile).toHaveBeenCalledTimes(1)
    expect(vi.mocked(writeFile).mock.calls[0]?.[1]).toContain('只写一次')
  })

  it('延迟保存写入期间再次编辑会继续追赶最新 Card 草稿', async () => {
    const alpha = cardDocument(seedCards[0])
    const firstWrite = deferred<boolean>()
    const writeFile = vi.fn()
      .mockImplementationOnce(() => firstWrite.promise)
      .mockResolvedValue(true)
    installFileService({ api: createCardEditorApi({
      readDirectory: vi.fn(async (path: string) => path === '/A/.modstudio/cards'
        ? [{ name: 'Fireball.json', path: '/A/.modstudio/cards/Fireball.json', isDirectory: false }]
        : []),
      readFile: vi.fn(async (path: string) => path.includes('/Fireball.json')
        ? serializeCardDocument(alpha)
        : null),
      writeFile,
    }) })

    render(<CardEditor projectPath="/A" />)
    const input = await screen.findByDisplayValue('火球')
    let lease!: ReturnType<typeof acquireCardPersistenceBarrier>
    act(() => { lease = acquireCardPersistenceBarrier('/A', 'Fireball') })
    fireEvent.change(input, { target: { value: '首个延迟草稿' } })
    act(() => { lease.release() })
    await waitFor(() => expect(writeFile).toHaveBeenCalledTimes(1))

    fireEvent.change(screen.getByDisplayValue('首个延迟草稿'), { target: { value: '写入期间的新草稿' } })
    await act(async () => { firstWrite.resolve(true); await Promise.resolve() })
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 600)) })

    expect(writeFile).toHaveBeenCalledTimes(2)
    expect(vi.mocked(writeFile).mock.calls[1]?.[1]).toContain('写入期间的新草稿')
  })

  it('rapid undo/redo 的中间提案快照不会让未来同内容手工编辑跳过保存', async () => {
    const alpha = cardDocument(seedCards[0])
    const writeFile = vi.fn(async (_path: string, _content: string) => true)
    installFileService({ api: createCardEditorApi({
      readDirectory: vi.fn(async (path: string) => path === '/A/.modstudio/cards'
        ? [{ name: 'Fireball.json', path: '/A/.modstudio/cards/Fireball.json', isDirectory: false }]
        : []),
      readFile: vi.fn(async (path: string) => path.includes('/Fireball.json')
        ? serializeCardDocument(alpha)
        : null),
      writeFile,
    }) })

    render(<CardEditor projectPath="/A" />)
    await screen.findByDisplayValue('火球')
    const proposal = createCardProposal(alpha, {
      ...alpha,
      card: { ...alpha.card, name: 'AI 火球' },
    })
    if (proposal.status !== 'ready') throw new Error('测试提案无效')
    act(() => cardCatalogActions.applyProposal(proposal.proposal, {
      provenance: { kind: 'ai-proposal', proposalId: 'proposal-rapid', transactionId: 'proposal-rapid' },
    }))

    let lease!: ReturnType<typeof acquireCardPersistenceBarrier>
    act(() => {
      lease = acquireCardPersistenceBarrier('/A', 'Fireball')
      cardCatalogActions.undo()
      cardCatalogActions.redo()
    })
    await act(async () => { lease.release(); await Promise.resolve() })

    fireEvent.change(screen.getByDisplayValue('AI 火球'), { target: { value: '火球' } })
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 600)) })
    expect(writeFile).toHaveBeenCalledTimes(1)
    expect(vi.mocked(writeFile).mock.calls[0]?.[1]).toContain('"name": "火球"')
  })

  it('项目 A 的迟到删除不会移除项目 B 中同 ID 的 Card', async () => {
    const alpha = cardDocument(seedCards[0])
    const beta = cardDocument({ ...seedCards[0], name: 'B 项目火球' })
    const delayedWrite = deferred<boolean>()
    const writeFile = vi.fn((path: string) => path.startsWith('/A/') ? delayedWrite.promise : Promise.resolve(true))
    const readDirectory = vi.fn(async (path: string): Promise<FileService.FileEntry[]> => {
      if (path === '/A/.modstudio/cards') {
        return [{ name: 'Fireball.json', path: '/A/.modstudio/cards/Fireball.json', isDirectory: false }]
      }
      if (path === '/B/.modstudio/cards') {
        return [{ name: 'Fireball.json', path: '/B/.modstudio/cards/Fireball.json', isDirectory: false }]
      }
      return []
    })
    const mockApi = createCardEditorApi({
      readDirectory,
      readFile: vi.fn(async (path: string) => {
        if (path === '/A/.modstudio/cards/Fireball.json') return serializeCardDocument(alpha)
        if (path === '/B/.modstudio/cards/Fireball.json') return serializeCardDocument(beta)
        return null
      }),
      writeFile,
    })
    installFileService({ api: mockApi })

    const editor = render(<CardEditor projectPath="/A" />)
    const aName = await screen.findByText('火球', { selector: '.card-name' })
    fireEvent.click(within(aName.closest('.card-item') as HTMLElement).getByRole('button', { name: '×' }))
    await waitFor(() => expect(writeFile).toHaveBeenCalled())

    editor.rerender(<CardEditor projectPath="/B" />)
    expect(await screen.findByText('B 项目火球', { selector: '.card-name' })).toBeTruthy()
    await act(async () => {
      delayedWrite.resolve(true)
      await Promise.resolve()
    })

    await waitFor(() => {
      expect(getCardCatalogView().sourceProjectRoot).toBe('/B')
      expect(getCardCatalogView().currentCard?.name).toBe('B 项目火球')
    })
    expect(mockApi.rename).toHaveBeenCalledWith(expect.stringMatching(/^\/A\//), '/A/.modstudio/cards/Fireball.json')
    expect(mockApi.rename).not.toHaveBeenCalledWith(
      '/A/.modstudio/cards/Fireball.json',
      expect.stringContaining('/.modstudio/trash/'),
    )
  })
})

function cardDocument(card: CardData): CardDocument {
  return {
    schemaVersion: 2,
    card,
    graph: createEmptyGraph(card.id, 'card'),
    generation: { lastGeneratedFingerprint: null },
  }
}

function createCardEditorApi(overrides: Partial<FileService.ElectronAPI> = {}): FileService.ElectronAPI {
  return {
    openDirectory: vi.fn(),
    saveDirectory: vi.fn(),
    readDirectory: vi.fn(async () => []),
    readFile: vi.fn(async () => null),
    writeFile: vi.fn(async () => true),
    mkdir: vi.fn(async () => true),
    rename: vi.fn(async () => true),
    linkNoReplace: vi.fn(async () => ({ status: 'linked' as const })),
    remove: vi.fn(async () => true),
    copyDirectory: vi.fn(),
    getUserDataPath: vi.fn(),
    launchGame: vi.fn(),
    showInFolder: vi.fn(),
    ...overrides,
  }
}

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>(next => { resolve = next })
  return { promise, resolve }
}
