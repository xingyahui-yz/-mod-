import { act, render, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { ConversationDocumentV1 } from './conversationDocument'
import type { ConversationRepository, ConversationSaveResult } from './conversationRepository'
import { ProjectConversation, type ConversationModel } from './projectConversation'
import {
  ProjectConversationProvider,
  useProjectConversationActions,
  type ProjectConversationActions,
} from './ProjectConversationContext'

const NOW = '2026-09-03T05:00:00.000Z'

describe('ProjectConversationProvider 项目切换守卫', () => {
  it('发送预保存尚未完成时也阻止未确认的项目切换', async () => {
    const firstSave = deferred<ConversationSaveResult>()
    const repository = repositoryWithSaves([firstSave.promise, Promise.resolve({ ok: true })])
    const model = successModel('完成')
    const actions = renderActions(repository, model)
    await waitFor(() => expect(repository.load).toHaveBeenCalledTimes(1))

    let send!: ReturnType<ProjectConversationActions['send']>
    act(() => { send = actions.current.send('开始') })
    await waitFor(() => expect(repository.save).toHaveBeenCalledTimes(1))

    const confirmSwitch = vi.fn(() => false)
    await expect(actions.current.prepareForProjectSwitch(confirmSwitch)).resolves.toBe(false)
    expect(confirmSwitch).toHaveBeenCalledTimes(1)
    expect(actions.current.isRunning()).toBe(true)

    firstSave.resolve({ ok: true })
    await act(async () => { await send })
  })

  it('确认切换会串行等待预保存、持久化取消，并屏蔽迟到响应', async () => {
    const firstSave = deferred<ConversationSaveResult>()
    const repository = repositoryWithSaves([firstSave.promise, Promise.resolve({ ok: true })])
    const response = deferred<{ success: true; content: string }>()
    const model: ConversationModel = { respond: vi.fn(() => response.promise) }
    const actions = renderActions(repository, model)
    await waitFor(() => expect(repository.load).toHaveBeenCalledTimes(1))

    let send!: ReturnType<ProjectConversationActions['send']>
    act(() => { send = actions.current.send('开始') })
    await waitFor(() => expect(repository.save).toHaveBeenCalledTimes(1))
    const prepare = actions.current.prepareForProjectSwitch(() => true)

    firstSave.resolve({ ok: true })
    await expect(prepare).resolves.toBe(true)
    expect(repository.current?.turns.at(-1)?.attempts.at(-1)?.status).toBe('cancelled')

    response.resolve({ success: true, content: responseText('迟到回复') })
    await expect(send).resolves.toMatchObject({ ok: false, code: 'cancelled' })
    expect(repository.current?.turns.at(-1)?.assistantText).toBeNull()
  })

  it('取消状态保存失败时拒绝项目切换', async () => {
    const repository = repositoryWithSaves([
      Promise.resolve({ ok: true }),
      Promise.resolve({ ok: false, error: 'EACCES', certainty: 'unchanged' }),
    ])
    const response = deferred<{ success: true; content: string }>()
    const model: ConversationModel = { respond: vi.fn(() => response.promise) }
    const actions = renderActions(repository, model)
    await waitFor(() => expect(repository.load).toHaveBeenCalledTimes(1))

    let send!: ReturnType<ProjectConversationActions['send']>
    act(() => { send = actions.current.send('开始') })
    await waitFor(() => expect(model.respond).toHaveBeenCalledTimes(1))

    await expect(actions.current.prepareForProjectSwitch(() => true)).resolves.toBe(false)
    response.resolve({ success: true, content: responseText('迟到回复') })
    await expect(send).resolves.toMatchObject({ ok: false, code: 'cancelled' })
  })
})

function renderActions(repository: TestRepository, model: ConversationModel) {
  const actions: { current: ProjectConversationActions } = {} as { current: ProjectConversationActions }
  const conversation = new ProjectConversation('/mods/a', repository, model, () => new Date(NOW), sequentialIds())
  render(
    <ProjectConversationProvider projectRoot="/mods/a" createConversation={() => conversation}>
      <ActionProbe onRender={value => { actions.current = value }} />
    </ProjectConversationProvider>,
  )
  return actions
}

function ActionProbe({ onRender }: { onRender: (actions: ProjectConversationActions) => void }) {
  onRender(useProjectConversationActions())
  return null
}

type TestRepository = ConversationRepository & { current: ConversationDocumentV1 | null }

function repositoryWithSaves(saves: Array<Promise<ConversationSaveResult>>): TestRepository {
  let current: ConversationDocumentV1 | null = null
  let saveIndex = 0
  return {
    get current() { return current },
    load: vi.fn(async () => ({ status: 'missing' as const })),
    save: vi.fn(async (_projectRoot, document) => {
      const result = await (saves[saveIndex++] ?? Promise.resolve({ ok: true as const }))
      if (result.ok) current = structuredClone(document)
      return result
    }),
  }
}

function successModel(text: string): ConversationModel {
  return { respond: vi.fn(async () => ({ success: true as const, content: responseText(text) })) }
}

function responseText(text: string): string {
  return JSON.stringify({ schemaVersion: 1, text, quickReplies: [], proposals: [] })
}

function sequentialIds() {
  let value = 1
  return () => `id-${value++}`
}

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>(next => { resolve = next })
  return { promise, resolve }
}
