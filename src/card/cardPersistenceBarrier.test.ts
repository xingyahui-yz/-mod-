import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  acquireCardPersistenceBarrier,
  isCardPersistenceBlocked,
  subscribeCardPersistenceBarrier,
  waitForCardPersistenceBarrier,
  type CardPersistenceBarrierLease,
} from './cardPersistenceBarrier'

describe('Card persistence barrier', () => {
  const leases: CardPersistenceBarrierLease[] = []

  afterEach(() => {
    for (const lease of leases) lease.release()
    leases.length = 0
  })

  const acquire = (projectRoot: string, cardId: string) => {
    const lease = acquireCardPersistenceBarrier(projectRoot, cardId)
    leases.push(lease)
    return lease
  }

  it('嵌套事务只在首个获取和最后释放时改变阻塞边界', () => {
    const listener = vi.fn()
    const unsubscribe = subscribeCardPersistenceBarrier('/mods/a', 'CardA', listener)

    const first = acquire('/mods/a', 'CardA')
    const second = acquire('/mods/a', 'carda')
    expect(isCardPersistenceBlocked('/mods/a', 'CARDA')).toBe(true)
    expect(listener).toHaveBeenCalledTimes(1)

    first.release()
    expect(isCardPersistenceBlocked('/mods/a', 'CardA')).toBe(true)
    expect(listener).toHaveBeenCalledTimes(1)

    second.release()
    expect(isCardPersistenceBlocked('/mods/a', 'CardA')).toBe(false)
    expect(listener).toHaveBeenCalledTimes(2)
    unsubscribe()
  })

  it('不同项目或 Card 的 lease 互不阻塞', () => {
    acquire('/mods/a', 'CardA')

    expect(isCardPersistenceBlocked('/mods/a', 'CardA')).toBe(true)
    expect(isCardPersistenceBlocked('/mods/a', 'CardB')).toBe(false)
    expect(isCardPersistenceBlocked('/mods/b', 'CardA')).toBe(false)
  })

  it('release 幂等且异常观察者不影响其他观察者', () => {
    const healthy = vi.fn()
    const unsubscribeThrowing = subscribeCardPersistenceBarrier('/mods/a', 'CardA', () => {
      throw new Error('listener failed')
    })
    const unsubscribeHealthy = subscribeCardPersistenceBarrier('/mods/a', 'CardA', healthy)
    const lease = acquire('/mods/a', 'CardA')

    lease.release()
    lease.release()

    expect(isCardPersistenceBlocked('/mods/a', 'CardA')).toBe(false)
    expect(healthy).toHaveBeenCalledTimes(2)
    unsubscribeThrowing()
    unsubscribeHealthy()
  })

  it('等待者只在最后一个 lease 释放后继续', async () => {
    const first = acquire('/mods/a', 'CardA')
    const second = acquire('/mods/a', 'carda')
    let resumed = false
    const waiting = waitForCardPersistenceBarrier('/mods/a', 'CardA').then(() => { resumed = true })

    first.release()
    await Promise.resolve()
    expect(resumed).toBe(false)

    second.release()
    await waiting
    expect(resumed).toBe(true)
  })
})
