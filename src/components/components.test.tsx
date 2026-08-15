/**
 * 组件级测试 - 覆盖架构审查 v5 遗留问题修复:
 * 1. Modal 无障碍 (role/aria/Escape)
 * 2. CardSearch 受控化 + CardEditor 状态镜像修复 (useMemo + originalIndex)
 * 3. Toast 统一样式 (不再被 .save-message 覆盖)
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, screen, fireEvent, within, act } from '@testing-library/react'
import { Modal } from './Modal'
import { CardSearch } from './CardSearch'
import { Toast } from './Toast'
import { CardEditor } from './CardEditor'
import { useCardStore } from '../stores/useCardStore'
import * as FileService from '../services/FileService'
import { installFileService } from '../services/FileService'
import { CardData } from '../types'

// 重置 Card store；Card 文档而非 localStorage 承担持久化
beforeEach(() => {
  localStorage.clear()
  useCardStore.setState({
    cards: [],
    currentCard: null,
    selectedCardId: null,
    selectedCardIndex: null
  })
})

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
    useCardStore.getState().loadCards(seedCards)
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
    useCardStore.getState().loadCards(seedCards)
    const { container } = renderEditor()

    // 按名称搜索「寒冰」
    fireEvent.change(screen.getByPlaceholderText('搜索卡牌名称、描述或关键词...'), {
      target: { value: '寒' }
    })
    expect(screen.getByText('1 / 3 张卡牌')).toBeTruthy()

    // 选中「寒冰」→ 编辑面板应显示寒冰(原始索引2)
    fireEvent.click(cardList(container).getByText('寒冰'))
    expect((screen.getByDisplayValue('寒冰') as HTMLInputElement).value).toBe('寒冰')
    expect(useCardStore.getState().selectedCardIndex).toBe(2)
  })

  it('搜索 + 类型过滤组合', () => {
    useCardStore.getState().loadCards(seedCards)
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
})
