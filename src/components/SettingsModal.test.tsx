import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useAIStore } from '../stores/useAIStore'
import { SettingsModal } from './SettingsModal'

describe('SettingsModal AI 配置', () => {
  beforeEach(() => {
    localStorage.clear()
    useAIStore.getState().setProvider('minimax')
    useAIStore.getState().setApiKey('existing-key')
  })

  it('以密码输入显示当前配置，并在保存时同步到 AI Store', () => {
    const onClose = vi.fn()
    const onGamePathChange = vi.fn()
    render(
      <SettingsModal
        isOpen
        onClose={onClose}
        gamePath="/games/sts2"
        onGamePathChange={onGamePathChange}
      />,
    )

    const provider = screen.getByLabelText('模型供应商') as HTMLSelectElement
    const apiKey = screen.getByLabelText('API Key') as HTMLInputElement
    expect(provider.value).toBe('minimax')
    expect(apiKey.type).toBe('password')
    expect(apiKey.value).toBe('existing-key')

    fireEvent.change(provider, { target: { value: 'qwen' } })
    fireEvent.change(apiKey, { target: { value: '  next-key  ' } })
    fireEvent.click(screen.getByRole('button', { name: '保存' }))

    expect(useAIStore.getState()).toMatchObject({
      provider: 'qwen',
      apiKey: 'next-key',
      isConfigured: true,
    })
    expect(onGamePathChange).toHaveBeenCalledWith('/games/sts2')
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('取消不会提交供应商或 API Key 草稿', () => {
    render(
      <SettingsModal
        isOpen
        onClose={vi.fn()}
        gamePath=""
        onGamePathChange={vi.fn()}
      />,
    )

    fireEvent.change(screen.getByLabelText('模型供应商'), { target: { value: 'ernie' } })
    fireEvent.change(screen.getByLabelText('API Key'), { target: { value: 'discarded-key' } })
    fireEvent.click(screen.getByRole('button', { name: '取消' }))

    expect(useAIStore.getState()).toMatchObject({
      provider: 'minimax',
      apiKey: 'existing-key',
      isConfigured: true,
    })
  })
})
