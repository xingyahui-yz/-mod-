import { useEffect, useMemo, useState } from 'react'
import * as FileService from '../services/FileService'
import { fetchProviderModels, LLM_PROVIDERS, testProviderConnection, type LLMProtocol } from '../services/llm/adapters'
import { createProviderSettings, defaultChatPath, defaultModelsPath, type ProviderApiKey, type ProviderSettings } from '../services/llm/providerSettings'
import { useAIStore } from '../stores/useAIStore'
import { Modal } from './Modal'

interface SettingsModalProps {
  isOpen: boolean
  onClose: () => void
  gamePath: string
  onGamePathChange: (path: string) => void
}

type SettingsSection = 'models' | 'game' | 'about'
type ActionState = { kind: 'idle' | 'busy' | 'success' | 'error'; message: string }

const PROTOCOL_OPTIONS: Array<{ id: LLMProtocol; name: string }> = [
  { id: 'openai-chat', name: 'OpenAI 兼容 Chat Completions' },
  { id: 'openai-responses', name: 'OpenAI Responses' },
  { id: 'anthropic-messages', name: 'Anthropic Messages' },
  { id: 'gemini', name: 'Google Gemini' },
  { id: 'ollama', name: 'Ollama 本地 API' },
]

function defaultKeyPlacement(protocol: LLMProtocol): ProviderSettings['keyPlacement'] {
  if (protocol === 'anthropic-messages') return 'x-api-key'
  if (protocol === 'gemini') return 'query'
  if (protocol === 'ollama') return 'none'
  return 'bearer'
}

function copyProviderSettings(settings: Record<string, ProviderSettings>): Record<string, ProviderSettings> {
  return Object.fromEntries(Object.entries(settings).map(([id, value]) => [id, {
    ...value,
    apiKeys: value.apiKeys.map(key => ({ ...key })),
    models: [...value.models],
  }]))
}

function makeId(prefix: string): string {
  const random = typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID().slice(0, 8)
    : Math.random().toString(36).slice(2, 10)
  return `${prefix}-${Date.now().toString(36)}-${random}`
}

function providerIdFromName(name: string): string {
  const slug = name.normalize('NFKD').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
  return `custom-${slug || 'provider'}-${Date.now().toString(36)}`
}

function parseConfigObject(value: string): boolean {
  if (!value.trim()) return true
  try {
    const parsed: unknown = JSON.parse(value)
    return Boolean(parsed && typeof parsed === 'object' && !Array.isArray(parsed))
  } catch {
    return false
  }
}

function firstAvailableKey(settings: ProviderSettings): ProviderApiKey | undefined {
  return settings.apiKeys.find(key => key.enabled && key.value.trim())
}

export function SettingsModal({ isOpen, onClose, gamePath, onGamePathChange }: SettingsModalProps) {
  const selectedProvider = useAIStore(state => state.provider)
  const providerSettings = useAIStore(state => state.providerSettings)
  const saveProviderSettings = useAIStore(state => state.saveProviderSettings)
  const [section, setSection] = useState<SettingsSection>('models')
  const [localPath, setLocalPath] = useState(gamePath)
  const [activeProviderId, setActiveProviderId] = useState(selectedProvider)
  const [draftProviders, setDraftProviders] = useState<Record<string, ProviderSettings>>(() => copyProviderSettings(providerSettings))
  const [removedProviderIds, setRemovedProviderIds] = useState<string[]>([])
  const [providerSearch, setProviderSearch] = useState('')
  const [showNewProvider, setShowNewProvider] = useState(false)
  const [newProviderName, setNewProviderName] = useState('')
  const [newProviderUrl, setNewProviderUrl] = useState('')
  const [newProviderProtocol, setNewProviderProtocol] = useState<LLMProtocol>('openai-chat')
  const [quickKeyInput, setQuickKeyInput] = useState('')
  const [manualModelInput, setManualModelInput] = useState('')
  const [visibleKeyIds, setVisibleKeyIds] = useState<Record<string, boolean>>({})
  const [testKeyId, setTestKeyId] = useState('')
  const [discoveredModels, setDiscoveredModels] = useState<string[]>([])
  const [actionState, setActionState] = useState<ActionState>({ kind: 'idle', message: '' })

  useEffect(() => {
    if (!isOpen) return
    setSection('models')
    setLocalPath(gamePath)
    setActiveProviderId(selectedProvider)
    setDraftProviders(copyProviderSettings(providerSettings))
    setRemovedProviderIds([])
    setProviderSearch('')
    setShowNewProvider(false)
    setQuickKeyInput('')
    setManualModelInput('')
    setVisibleKeyIds({})
    setTestKeyId('')
    setDiscoveredModels([])
    setActionState({ kind: 'idle', message: '' })
  }, [gamePath, isOpen, providerSettings, selectedProvider])

  const providers = useMemo(
    () => Object.values(draftProviders).filter(settings => !removedProviderIds.includes(settings.id)),
    [draftProviders, removedProviderIds],
  )
  const visibleProviders = useMemo(() => {
    const query = providerSearch.trim().toLocaleLowerCase()
    if (!query) return providers
    return providers.filter(item => `${item.name} ${item.id}`.toLocaleLowerCase().includes(query))
  }, [providerSearch, providers])
  const activeProvider = draftProviders[activeProviderId]
  const isCustomProvider = !LLM_PROVIDERS.some(item => item.id === activeProviderId)
  const usableKey = activeProvider ? firstAvailableKey(activeProvider) : undefined
  const testKey = activeProvider?.apiKeys.find(key => key.id === testKeyId) ?? usableKey
  const activeDiscoveredModels = discoveredModels

  const updateActiveProvider = (patch: Partial<ProviderSettings>) => {
    setDraftProviders(current => {
      const existing = current[activeProviderId] ?? createProviderSettings(activeProviderId)
      const resetsUnsupportedAuth = Boolean(existing.unavailableReason && ('baseUrl' in patch || 'protocol' in patch || 'keyPlacement' in patch))
      const protocol = patch.protocol ?? existing.protocol
      return { ...current, [activeProviderId]: {
        ...existing,
        ...patch,
        ...(resetsUnsupportedAuth ? {
          unavailableReason: undefined,
          enabled: true,
          requiresApiKey: true,
          keyPlacement: patch.keyPlacement ?? defaultKeyPlacement(protocol),
        } : {}),
      } }
    })
    setActionState({ kind: 'idle', message: '' })
  }

  const selectProvider = (id: string) => {
    setActiveProviderId(id)
    setShowNewProvider(false)
    setTestKeyId('')
    setDiscoveredModels([])
    setActionState({ kind: 'idle', message: '' })
  }

  const handleCreateProvider = () => {
    const name = newProviderName.trim()
    if (!name) {
      setActionState({ kind: 'error', message: '请填写服务商名称' })
      return
    }
    const id = providerIdFromName(name)
    const settings = createProviderSettings(id)
    settings.name = name
    settings.baseUrl = newProviderUrl.trim()
    settings.protocol = newProviderProtocol
    settings.chatPath = defaultChatPath(newProviderProtocol)
    settings.modelsPath = defaultModelsPath(newProviderProtocol)
    settings.keyPlacement = defaultKeyPlacement(newProviderProtocol)
    settings.requiresApiKey = settings.keyPlacement !== 'none'
    setDraftProviders(current => ({ ...current, [id]: settings }))
    setActiveProviderId(id)
    setShowNewProvider(false)
    setNewProviderName('')
    setNewProviderUrl('')
    setRemovedProviderIds(current => current.filter(item => item !== id))
    setTestKeyId('')
    setActionState({ kind: 'idle', message: '' })
  }

  const handleRemoveProvider = () => {
    if (!isCustomProvider) return
    setRemovedProviderIds(current => [...new Set([...current, activeProviderId])])
    const next = providers.find(item => item.id !== activeProviderId)
    setActiveProviderId(next?.id ?? 'minimax')
    setActionState({ kind: 'idle', message: '' })
  }

  const handleAddKey = () => {
    if (!activeProvider) return
    const values = quickKeyInput.split(',').map(value => value.trim()).filter(Boolean)
    if (!values.length) {
      const key = { id: makeId('key'), label: `密钥 ${activeProvider.apiKeys.length + 1}`, value: '', enabled: true }
      updateActiveProvider({ apiKeys: [...activeProvider.apiKeys, key] })
      setVisibleKeyIds(current => ({ ...current, [key.id]: true }))
      return
    }
    const added = values.map((value, index) => ({
      id: makeId('key'),
      label: `密钥 ${activeProvider.apiKeys.length + index + 1}`,
      value,
      enabled: true,
    }))
    updateActiveProvider({ apiKeys: [...activeProvider.apiKeys, ...added] })
    setQuickKeyInput('')
    setTestKeyId(added[0]?.id ?? '')
  }

  const updateKey = (keyId: string, patch: Partial<ProviderApiKey>) => {
    if (!activeProvider) return
    updateActiveProvider({ apiKeys: activeProvider.apiKeys.map(key => key.id === keyId ? { ...key, ...patch } : key) })
  }

  const handleAddModel = (modelId: string) => {
    if (!activeProvider) return
    const value = modelId.trim()
    if (!value) return
    const models = activeProvider.models.includes(value) ? activeProvider.models : [...activeProvider.models, value]
    updateActiveProvider({ models, selectedModel: activeProvider.selectedModel || value })
    setManualModelInput('')
    setActionState({ kind: 'success', message: `已添加模型 ${value}` })
  }

  const handleFetchModels = async () => {
    if (!activeProvider) return
    const keyValue = testKey?.value ?? ''
    setActionState({ kind: 'busy', message: '正在获取模型列表…' })
    try {
      const models = await fetchProviderModels(activeProvider, keyValue)
      setDiscoveredModels(models.map(model => model.id))
      setActionState({ kind: 'success', message: `获取到 ${models.length} 个模型。选择要加入本机模型列表的项目。` })
    } catch (error) {
      setActionState({ kind: 'error', message: error instanceof Error ? error.message : '获取模型列表失败' })
    }
  }

  const handleTestConnection = async () => {
    if (!activeProvider) return
    if (!activeProvider.selectedModel.trim()) {
      setActionState({ kind: 'error', message: '先添加并选择一个模型，再测试连接' })
      return
    }
    if (activeProvider.requiresApiKey && !testKey?.value.trim()) {
      setActionState({ kind: 'error', message: '先选择一个有内容的 API Key' })
      return
    }
    setActionState({ kind: 'busy', message: `正在测试 ${activeProvider.selectedModel}…` })
    try {
      const result = await testProviderConnection(activeProvider, testKey?.value ?? '', activeProvider.selectedModel)
      setActionState(result.success
        ? { kind: 'success', message: `连接成功：${activeProvider.selectedModel}` }
        : { kind: 'error', message: result.error ?? '连接失败' })
    } catch (error) {
      setActionState({ kind: 'error', message: error instanceof Error ? error.message : '连接失败' })
    }
  }

  const handleCopyKey = async (key: ProviderApiKey) => {
    try {
      await navigator.clipboard.writeText(key.value)
      setActionState({ kind: 'success', message: `已复制「${key.label}」` })
    } catch {
      setActionState({ kind: 'error', message: '无法访问剪贴板，请检查应用权限' })
    }
  }

  const handleBrowse = async () => {
    const path = await FileService.openProjectDirectory()
    if (path) setLocalPath(path)
  }

  const handleSave = () => {
    for (const settings of Object.values(draftProviders)) {
      if (removedProviderIds.includes(settings.id)) continue
      if (!parseConfigObject(settings.extraHeadersJson) || !parseConfigObject(settings.extraQueryJson) || !parseConfigObject(settings.extraBodyJson)) {
        setSection('models')
        setActiveProviderId(settings.id)
        setActionState({ kind: 'error', message: '高级设置中的请求头、查询参数和请求体必须是 JSON 对象' })
        return
      }
    }
    const nextProvider = removedProviderIds.includes(activeProviderId) ? selectedProvider : activeProviderId
    saveProviderSettings(Object.values(draftProviders), removedProviderIds, nextProvider)
    onGamePathChange(localPath)
    onClose()
  }

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="⚙️ 设置" width={1120}>
      <div className="settings-layout settings-layout-expanded">
        <nav className="settings-navigation" aria-label="设置分类">
          <p className="settings-navigation-label">偏好设置</p>
          <button className={section === 'models' ? 'active' : ''} aria-current={section === 'models' ? 'page' : undefined} onClick={() => setSection('models')}>
            <span aria-hidden="true">✦</span> 模型服务
          </button>
          <button className={section === 'game' ? 'active' : ''} aria-current={section === 'game' ? 'page' : undefined} onClick={() => setSection('game')}>
            <span aria-hidden="true">🎮</span> 游戏路径
          </button>
          <button className={section === 'about' ? 'active' : ''} aria-current={section === 'about' ? 'page' : undefined} onClick={() => setSection('about')}>
            <span aria-hidden="true">ⓘ</span> 关于
          </button>
          <div className="settings-navigation-note">
            <span className="settings-note-mark" aria-hidden="true">MS</span>
            <span>Mod Studio<br />本机设置</span>
          </div>
        </nav>

        <div className="settings-content settings-content-expanded">
          {section === 'models' && (
            <section className="provider-page provider-page-expanded" aria-label="模型服务设置">
              <nav className="provider-list provider-list-expanded" aria-label="模型供应商">
                <div className="provider-list-heading">
                  <strong>模型服务商</strong>
                  <span>{providers.length}</span>
                </div>
                <input
                  className="provider-search"
                  aria-label="搜索服务商"
                  value={providerSearch}
                  onChange={event => setProviderSearch(event.target.value)}
                  placeholder="搜索服务商"
                />
                <button className="provider-add-button" onClick={() => setShowNewProvider(value => !value)}>
                  <span aria-hidden="true">＋</span> 添加自定义服务商
                </button>
                <div className="provider-options-scroll">
                  {visibleProviders.map(item => {
                    const hasKey = firstAvailableKey(item)
                    const selected = activeProviderId === item.id && !showNewProvider
                    return (
                      <button
                        key={item.id}
                        className={`provider-option ${selected ? 'active' : ''} ${!item.enabled ? 'is-disabled' : ''}`}
                        aria-pressed={selected}
                        onClick={() => selectProvider(item.id)}
                      >
                        <span className={`provider-avatar provider-${item.id}`} aria-hidden="true">{item.name.slice(0, 1)}</span>
                        <span className="provider-option-copy">
                          <strong>{item.name}</strong>
                          <small>{!item.enabled ? '未启用' : !item.requiresApiKey ? '无需密钥' : hasKey ? '已配置密钥' : '待配置密钥'}</small>
                        </span>
                        <span className={`provider-status-dot ${item.enabled && (hasKey || !item.requiresApiKey) ? 'is-ready' : ''}`} aria-hidden="true" />
                      </button>
                    )
                  })}
                  {visibleProviders.length === 0 && <p className="provider-empty-results">没有匹配的服务商</p>}
                </div>
              </nav>

              <div className="provider-details provider-details-expanded">
                {showNewProvider ? (
                  <section className="provider-create-form" aria-labelledby="provider-create-title">
                    <span className="settings-page-kicker">兼容 OpenAI / Anthropic / Gemini / Ollama API</span>
                    <h3 id="provider-create-title">添加自定义服务商</h3>
                    <p>用于 Cherry Studio 列表之外的 API 网关或本地服务。填写协议和 API 地址后，可拉取模型或手动添加模型 ID。</p>
                    <label htmlFor="new-provider-name">服务商名称</label>
                    <input id="new-provider-name" value={newProviderName} onChange={event => setNewProviderName(event.target.value)} placeholder="例如：公司模型网关" />
                    <label htmlFor="new-provider-url">API 地址</label>
                    <input id="new-provider-url" value={newProviderUrl} onChange={event => setNewProviderUrl(event.target.value)} placeholder="https://api.example.com/v1" />
                    <label htmlFor="new-provider-protocol">API 协议</label>
                    <select id="new-provider-protocol" value={newProviderProtocol} onChange={event => setNewProviderProtocol(event.target.value as LLMProtocol)}>
                      {PROTOCOL_OPTIONS.map(option => <option key={option.id} value={option.id}>{option.name}</option>)}
                    </select>
                    <button className="save-btn provider-create-submit" onClick={handleCreateProvider}>创建服务商</button>
                  </section>
                ) : activeProvider ? (
                  <>
                    <header className="provider-details-header provider-details-header-expanded">
                      <span className={`provider-avatar provider-avatar-large provider-${activeProvider.id}`} aria-hidden="true">{activeProvider.name.slice(0, 1)}</span>
                      <div className="provider-details-title">
                        <span>模型服务商</span>
                        {isCustomProvider ? (
                          <input aria-label="服务商名称" className="provider-name-input" value={activeProvider.name} onChange={event => updateActiveProvider({ name: event.target.value })} />
                        ) : <h3>{activeProvider.name}</h3>}
                        <p>{activeProvider.unavailableReason ?? LLM_PROVIDERS.find(item => item.id === activeProvider.id)?.description ?? '自定义 API 服务'}</p>
                      </div>
                      <label className="provider-enabled-control">
                        <input type="checkbox" checked={activeProvider.enabled} onChange={event => updateActiveProvider({ enabled: event.target.checked })} />
                        <span>启用服务商</span>
                      </label>
                    </header>

                    <div className="provider-config-grid">
                      <label className="provider-config-field provider-url-field" htmlFor="provider-base-url">
                        <span>API 地址</span>
                        <input id="provider-base-url" value={activeProvider.baseUrl} onChange={event => updateActiveProvider({ baseUrl: event.target.value })} placeholder="https://api.example.com/v1" autoComplete="off" spellCheck={false} />
                        <small>通常填写服务根地址；完整接口地址可直接填入高级设置的请求路径。</small>
                      </label>
                      <label className="provider-config-field" htmlFor="provider-protocol">
                        <span>API 协议</span>
                        <select
                          id="provider-protocol"
                          value={activeProvider.protocol}
                          onChange={event => {
                            const protocol = event.target.value as LLMProtocol
                            updateActiveProvider({ protocol, keyPlacement: defaultKeyPlacement(protocol), chatPath: defaultChatPath(protocol), modelsPath: defaultModelsPath(protocol) })
                          }}
                        >
                          {PROTOCOL_OPTIONS.map(option => <option key={option.id} value={option.id}>{option.name}</option>)}
                        </select>
                      </label>
                      <label className="provider-config-field" htmlFor="provider-current-model">
                        <span>当前聊天模型</span>
                        <select id="provider-current-model" value={activeProvider.selectedModel} onChange={event => updateActiveProvider({ selectedModel: event.target.value })}>
                          <option value="">请选择模型</option>
                          {activeProvider.models.map(model => <option key={model} value={model}>{model}</option>)}
                        </select>
                      </label>
                    </div>

                    <section className="provider-api-keys" aria-labelledby="provider-keys-title">
                      <div className="provider-section-heading">
                        <div><h4 id="provider-keys-title">API Key 管理</h4><p>同一服务商可添加多个密钥，启用的密钥会按列表顺序轮换使用。</p></div>
                        <span>{activeProvider.apiKeys.filter(key => key.enabled && key.value.trim()).length} 个可用密钥</span>
                      </div>
                      {activeProvider.requiresApiKey && activeProvider.apiKeys.length === 0 && <p className="settings-inline-warning">此服务商需要 API Key 才能连接。</p>}
                      <div className="provider-key-list">
                        {activeProvider.apiKeys.map((key, index) => (
                          <div className="provider-key-row" key={key.id}>
                            <input aria-label={`密钥 ${index + 1} 标签`} className="provider-key-label" value={key.label} onChange={event => updateKey(key.id, { label: event.target.value })} placeholder={`密钥 ${index + 1}`} />
                            <input
                              aria-label={`${key.label || `密钥 ${index + 1}`} API Key`}
                              className="provider-key-value"
                              type={visibleKeyIds[key.id] ? 'text' : 'password'}
                              value={key.value}
                              onChange={event => updateKey(key.id, { value: event.target.value })}
                              placeholder={activeProvider.requiresApiKey ? '粘贴 API Key / Token' : '该服务商可不填写 Key'}
                              autoComplete="off"
                              spellCheck={false}
                            />
                            <button type="button" className="key-action-btn" aria-label={visibleKeyIds[key.id] ? '隐藏 API Key' : '显示 API Key'} onClick={() => setVisibleKeyIds(current => ({ ...current, [key.id]: !current[key.id] }))}>{visibleKeyIds[key.id] ? '隐藏' : '显示'}</button>
                            <label className="key-enabled-toggle" title="启用或停用这个密钥">
                              <input aria-label={`${key.label || `密钥 ${index + 1}`} 启用`} type="checkbox" checked={key.enabled} onChange={event => updateKey(key.id, { enabled: event.target.checked })} />
                              <span>启用</span>
                            </label>
                            <button type="button" className="key-action-btn" aria-label={`复制 ${key.label} API Key`} disabled={!key.value} onClick={() => void handleCopyKey(key)}>复制</button>
                            <button type="button" className="key-action-btn key-delete-btn" aria-label={`删除 ${key.label} API Key`} onClick={() => updateActiveProvider({ apiKeys: activeProvider.apiKeys.filter(item => item.id !== key.id) })}>删除</button>
                          </div>
                        ))}
                        {activeProvider.apiKeys.length === 0 && <p className="provider-empty-keys">还没有添加密钥。</p>}
                      </div>
                      <div className="provider-key-add-row">
                        <input aria-label="快速添加 API Key" value={quickKeyInput} onChange={event => setQuickKeyInput(event.target.value)} placeholder="粘贴一个密钥；多个密钥用英文逗号分隔" autoComplete="off" spellCheck={false} />
                        <button type="button" className="secondary-btn" onClick={handleAddKey}>{quickKeyInput.trim() ? '批量添加' : '添加单个密钥'}</button>
                      </div>
                    </section>

                    <section className="provider-model-manager" aria-labelledby="provider-model-title">
                      <div className="provider-section-heading">
                        <div><h4 id="provider-model-title">模型列表</h4><p>服务商只显示已添加的模型；模型 ID 保持原样用于 API 请求。</p></div>
                        <button type="button" className="secondary-btn provider-fetch-models" disabled={actionState.kind === 'busy'} onClick={() => void handleFetchModels()}>获取模型列表</button>
                      </div>
                      <div className="model-add-row">
                        <input aria-label="手动添加模型 ID" value={manualModelInput} onChange={event => setManualModelInput(event.target.value)} onKeyDown={event => { if (event.key === 'Enter') handleAddModel(manualModelInput) }} placeholder="手动输入模型 ID，例如 deepseek-chat" />
                        <button type="button" className="secondary-btn" onClick={() => handleAddModel(manualModelInput)}>添加模型</button>
                      </div>
                      {activeDiscoveredModels.length > 0 && (
                        <div className="discovered-model-list" aria-label="获取到的模型">
                          {activeDiscoveredModels.map(model => (
                            <button type="button" key={model} disabled={activeProvider.models.includes(model)} onClick={() => handleAddModel(model)}>
                              <span>{model}</span><span>{activeProvider.models.includes(model) ? '已添加' : '＋ 添加'}</span>
                            </button>
                          ))}
                        </div>
                      )}
                      <div className="configured-model-list">
                        {activeProvider.models.map(model => (
                          <div className={`configured-model-row ${activeProvider.selectedModel === model ? 'is-default' : ''}`} key={model}>
                            <button type="button" className="configured-model-select" onClick={() => updateActiveProvider({ selectedModel: model })}>
                              <span className="model-select-indicator" aria-hidden="true">{activeProvider.selectedModel === model ? '●' : '○'}</span>
                              <span>{model}</span>
                              {activeProvider.selectedModel === model && <small>当前模型</small>}
                            </button>
                            <button type="button" className="model-remove-btn" aria-label={`移除模型 ${model}`} onClick={() => {
                              const models = activeProvider.models.filter(item => item !== model)
                              updateActiveProvider({ models, selectedModel: activeProvider.selectedModel === model ? models[0] ?? '' : activeProvider.selectedModel })
                            }}>移除</button>
                          </div>
                        ))}
                        {activeProvider.models.length === 0 && <p className="provider-empty-models">获取模型列表，或手动添加模型 ID。</p>}
                      </div>
                    </section>

                    <section className="provider-test-panel" aria-label="连通性检查">
                      <div className="provider-test-selects">
                        <label htmlFor="test-api-key">检测密钥</label>
                        <select id="test-api-key" value={testKey?.id ?? ''} onChange={event => setTestKeyId(event.target.value)}>
                          {!activeProvider.apiKeys.length && <option value="">不使用 API Key</option>}
                          {activeProvider.apiKeys.map((key, index) => <option key={key.id} value={key.id}>{key.label || `密钥 ${index + 1}`}{key.enabled ? '' : '（已停用）'}</option>)}
                        </select>
                      </div>
                      <button type="button" className="test-provider-btn" disabled={actionState.kind === 'busy'} onClick={() => void handleTestConnection()}>检测连接</button>
                      {isCustomProvider && <button type="button" className="key-delete-btn provider-remove-btn" onClick={handleRemoveProvider}>删除此服务商</button>}
                      {actionState.message && <p className={`provider-action-message is-${actionState.kind}`} role={actionState.kind === 'error' ? 'alert' : 'status'}>{actionState.message}</p>}
                    </section>

                    <details className="provider-advanced-settings">
                      <summary>API 设置（高级）</summary>
                      <div className="advanced-api-grid">
                        <label className="provider-config-field" htmlFor="provider-chat-path"><span>聊天请求路径</span><input id="provider-chat-path" value={activeProvider.chatPath} onChange={event => updateActiveProvider({ chatPath: event.target.value })} placeholder="/chat/completions" /></label>
                        <label className="provider-config-field" htmlFor="provider-models-path"><span>模型列表路径</span><input id="provider-models-path" value={activeProvider.modelsPath} onChange={event => updateActiveProvider({ modelsPath: event.target.value })} placeholder="/models" /></label>
                        <label className="provider-config-field" htmlFor="provider-key-placement"><span>密钥发送方式</span><select id="provider-key-placement" value={activeProvider.keyPlacement} onChange={event => updateActiveProvider({ keyPlacement: event.target.value as ProviderSettings['keyPlacement'] })}>
                          <option value="bearer">Authorization: Bearer</option><option value="api-key">api-key 请求头</option><option value="x-api-key">x-api-key 请求头</option><option value="query">URL 查询参数</option><option value="none">无密钥</option>
                        </select></label>
                        {activeProvider.keyPlacement === 'query' && <label className="provider-config-field" htmlFor="provider-key-query"><span>密钥查询参数名</span><input id="provider-key-query" value={activeProvider.apiKeyQueryParam} onChange={event => updateActiveProvider({ apiKeyQueryParam: event.target.value })} placeholder="key" /></label>}
                        <label className="provider-config-field" htmlFor="provider-temperature"><span>Temperature</span><input id="provider-temperature" type="number" min="0" max="2" step="0.1" value={activeProvider.temperature} onChange={event => updateActiveProvider({ temperature: Number(event.target.value) })} /></label>
                        <label className="provider-config-field" htmlFor="provider-top-p"><span>Top P</span><input id="provider-top-p" type="number" min="0" max="1" step="0.05" value={activeProvider.topP} onChange={event => updateActiveProvider({ topP: Number(event.target.value) })} /></label>
                        <label className="provider-config-field" htmlFor="provider-max-tokens"><span>最大输出 Token</span><input id="provider-max-tokens" type="number" min="1" step="256" value={activeProvider.maxTokens} onChange={event => updateActiveProvider({ maxTokens: Number(event.target.value) })} /></label>
                        <label className="provider-thinking-control"><input type="checkbox" checked={activeProvider.enableThinking} onChange={event => updateActiveProvider({ enableThinking: event.target.checked })} /> 发送思考模式参数</label>
                        <label className="provider-config-field advanced-json-field" htmlFor="provider-extra-headers"><span>额外请求头（JSON）</span><textarea id="provider-extra-headers" value={activeProvider.extraHeadersJson} onChange={event => updateActiveProvider({ extraHeadersJson: event.target.value })} placeholder={'{\n  "X-Custom-Header": "value"\n}'} /></label>
                        <label className="provider-config-field advanced-json-field" htmlFor="provider-extra-query"><span>额外查询参数（JSON）</span><textarea id="provider-extra-query" value={activeProvider.extraQueryJson} onChange={event => updateActiveProvider({ extraQueryJson: event.target.value })} placeholder={'{\n  "api-version": "2025-01-01-preview"\n}'} /></label>
                        <label className="provider-config-field advanced-json-field" htmlFor="provider-extra-body"><span>额外请求体参数（JSON）</span><textarea id="provider-extra-body" value={activeProvider.extraBodyJson} onChange={event => updateActiveProvider({ extraBodyJson: event.target.value })} placeholder={'{\n  "service_tier": "priority"\n}'} /></label>
                      </div>
                      <p className="settings-help-text">若服务商要求直接请求完整 URL，可将 API 地址末尾加上 #，聊天请求会按填写地址直连；模型列表路径仍可单独配置。</p>
                    </details>
                  </>
                ) : <p className="provider-empty-results">请从左侧选择服务商。</p>}
              </div>
            </section>
          )}

          {section === 'game' && (
            <section className="settings-single-page" aria-labelledby="game-settings-title">
              <span className="settings-page-kicker">运行与测试</span>
              <h3 id="game-settings-title">游戏路径</h3>
              <p>设置《杀戮尖塔 2》的安装目录，用于从 Mod Studio 启动游戏测试 Mod。</p>
              <label htmlFor="game-path">安装目录</label>
              <div className="path-input">
                <input id="game-path" type="text" value={localPath} onChange={event => setLocalPath(event.target.value)} placeholder="选择 Slay the Spire 2 安装目录" />
                <button type="button" className="secondary-btn" onClick={() => void handleBrowse()}>浏览</button>
              </div>
            </section>
          )}

          {section === 'about' && (
            <section className="settings-single-page" aria-labelledby="about-settings-title">
              <span className="settings-page-kicker">MOD STUDIO</span>
              <h3 id="about-settings-title">关于 Mod Studio</h3>
              <p>面向 Slay the Spire 2 的 Mod 创作工具，支持卡牌、遗物、项目文件和 AI 协作。</p>
              <div className="about-version-card"><span className="settings-note-mark" aria-hidden="true">MS</span><div><strong>Mod Studio</strong><span>版本 0.10 · Creator Studio</span></div></div>
            </section>
          )}
        </div>
      </div>

      <div className="settings-footer">
        <button type="button" className="cancel-btn" onClick={onClose}>取消</button>
        <button type="button" className="save-btn" onClick={handleSave}>保存设置</button>
      </div>
    </Modal>
  )
}
