import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { LLM_PROVIDERS } from '../services/llm/providerCatalog'
import { createProviderSettings } from '../services/llm/providerSettings'
import { useAIStore } from '../stores/useAIStore'
import { SettingsModal } from './SettingsModal'

describe('SettingsModal 模型服务配置', () => {
  beforeEach(() => {
    const current = useAIStore.getState().providerSettings
    const defaults = LLM_PROVIDERS.map(provider => createProviderSettings(provider.id))
    const builtInIds = new Set(defaults.map(settings => settings.id))
    const customIds = Object.keys(current).filter(id => !builtInIds.has(id))
    useAIStore.getState().saveProviderSettings(defaults, customIds, 'minimax')
    localStorage.clear()
    useAIStore.getState().setApiKey('existing-key')
  })

  it('显示密码字段、当前模型与独立供应商配置，并将修改保存到 Store', () => {
    const onClose = vi.fn()
    const onGamePathChange = vi.fn()
    render(<SettingsModal isOpen onClose={onClose} gamePath="/games/sts2" onGamePathChange={onGamePathChange} />)

    const apiKey = screen.getByLabelText('主密钥 API Key') as HTMLInputElement
    expect(apiKey.type).toBe('password')
    expect(apiKey.value).toBe('existing-key')
    expect((screen.getByLabelText('当前聊天模型') as HTMLSelectElement).value).toBe('MiniMax-Text-01')

    fireEvent.click(screen.getByRole('button', { name: /通义千问/ }))
    fireEvent.change(screen.getByLabelText('主密钥 API Key'), { target: { value: '  next-key  ' } })
    fireEvent.click(screen.getByRole('button', { name: '保存设置' }))

    expect(useAIStore.getState()).toMatchObject({
      provider: 'qwen',
      apiKey: 'next-key',
      isConfigured: true,
      providerSettings: { qwen: { selectedModel: 'qwen-turbo', apiKeys: [{ value: 'next-key' }] } },
    })
    expect(onGamePathChange).toHaveBeenCalledWith('/games/sts2')
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('取消不会提交服务商或 API Key 草稿', () => {
    render(<SettingsModal isOpen onClose={vi.fn()} gamePath="" onGamePathChange={vi.fn()} />)

    fireEvent.click(screen.getByRole('button', { name: /文心一言/ }))
    fireEvent.change(screen.getByLabelText('主密钥 API Key'), { target: { value: 'discarded-key' } })
    fireEvent.click(screen.getByRole('button', { name: '取消' }))

    expect(useAIStore.getState()).toMatchObject({ provider: 'minimax', apiKey: 'existing-key', isConfigured: true })
  })

  it('切换服务商时保留各自密钥草稿', () => {
    render(<SettingsModal isOpen onClose={vi.fn()} gamePath="" onGamePathChange={vi.fn()} />)

    fireEvent.click(screen.getByRole('button', { name: /通义千问/ }))
    fireEvent.change(screen.getByLabelText('主密钥 API Key'), { target: { value: 'qwen-draft' } })
    fireEvent.click(screen.getByRole('button', { name: /MiniMax/ }))
    expect((screen.getByLabelText('主密钥 API Key') as HTMLInputElement).value).toBe('existing-key')
    fireEvent.click(screen.getByRole('button', { name: /通义千问/ }))
    expect((screen.getByLabelText('主密钥 API Key') as HTMLInputElement).value).toBe('qwen-draft')
  })

  it('支持英文逗号批量添加 API Key', () => {
    render(<SettingsModal isOpen onClose={vi.fn()} gamePath="" onGamePathChange={vi.fn()} />)

    fireEvent.change(screen.getByLabelText('快速添加 API Key'), { target: { value: 'backup-one, backup-two' } })
    fireEvent.click(screen.getByRole('button', { name: '批量添加' }))
    expect(screen.getByLabelText('快速添加 API Key')).toHaveProperty('value', '')
    expect(screen.getByLabelText('密钥 2 API Key')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: '保存设置' }))

    expect(useAIStore.getState().providerSettings.minimax.apiKeys.map(key => key.value)).toEqual([
      'existing-key', 'backup-one', 'backup-two',
    ])
  })

  it('添加自定义服务商并配置兼容协议', () => {
    render(<SettingsModal isOpen onClose={vi.fn()} gamePath="" onGamePathChange={vi.fn()} />)

    fireEvent.click(screen.getByRole('button', { name: /添加自定义服务商/ }))
    fireEvent.change(screen.getByLabelText('服务商名称'), { target: { value: '团队网关' } })
    fireEvent.change(screen.getByLabelText('API 地址'), { target: { value: 'http://localhost:9000/v1' } })
    fireEvent.click(screen.getByRole('button', { name: '创建服务商' }))
    fireEvent.change(screen.getByLabelText('主密钥 API Key'), { target: { value: 'team-key' } })
    fireEvent.change(screen.getByLabelText('手动添加模型 ID'), { target: { value: 'team-chat' } })
    fireEvent.click(screen.getByRole('button', { name: '添加模型' }))
    fireEvent.click(screen.getByRole('button', { name: '保存设置' }))

    const custom = Object.values(useAIStore.getState().providerSettings).find(item => item.name === '团队网关')
    expect(custom).toMatchObject({ baseUrl: 'http://localhost:9000/v1', selectedModel: 'team-chat', apiKeys: [{ value: 'team-key' }] })
    expect(useAIStore.getState().provider).toBe(custom?.id)
  })
})
