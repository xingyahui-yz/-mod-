import { describe, expect, it, vi, afterEach } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { GameLauncher } from './GameLauncher'
import * as FileService from '../services/FileService'

describe('GameLauncher Card preflight gate', () => {
  afterEach(() => { vi.restoreAllMocks() })

  it('预检阻止时不调用 launchGame，并展示阻断原因', async () => {
    const preflight = vi.spyOn(FileService, 'preflightCardProject').mockResolvedValue({
      ok: false,
      items: [{ cardId: 'Fireball', status: 'externally-modified', reason: '外部修改' }],
      blocking: [{ cardId: 'Fireball', status: 'externally-modified', reason: '外部修改' }],
    })
    const launch = vi.spyOn(FileService, 'launchGame').mockResolvedValue({ success: true })
    render(<GameLauncher gamePath="/game" projectPath="/project" />)
    fireEvent.click(screen.getByRole('button', { name: /启动游戏测试/ }))
    await waitFor(() => expect(preflight).toHaveBeenCalledWith('/project'))
    expect(launch).not.toHaveBeenCalled()
    expect(await screen.findByText(/测试预检未通过/)).toBeTruthy()
  })

  it('预检通过后才调用 launchGame', async () => {
    vi.spyOn(FileService, 'preflightCardProject').mockResolvedValue({ ok: true, items: [], blocking: [] })
    const launch = vi.spyOn(FileService, 'launchGame').mockResolvedValue({ success: true })
    render(<GameLauncher gamePath="/game" projectPath="/project" />)
    fireEvent.click(screen.getByRole('button', { name: /启动游戏测试/ }))
    await waitFor(() => expect(launch).toHaveBeenCalledWith('/game', '/project'))
    expect(await screen.findByText(/游戏已启动/)).toBeTruthy()
  })
})
