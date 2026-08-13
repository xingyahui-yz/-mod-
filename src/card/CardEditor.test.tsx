/**
 * CardEditor 端到端测试 - 节点编辑器 v0.9 Step 4
 *
 * 走法 1: 顶部表单横排 + 下部节点画布 + 折叠预览
 * 覆盖：
 *  - 默认表单值
 *  - 修改字段同步到 codegen
 *  - 加 trigger / effect 节点
 *  - 生成代码 (codegen + Mustache 模板)
 *  - 折叠预览交互
 *  - 节点图过滤 (Step 2): Card palette 只看到 Card kinds
 */
import { describe, it, expect } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { CardEditor } from './CardEditor'

describe('CardEditor 端到端 (v0.9 Step 4 — 走法 1)', () => {
  it('渲染顶部表单横排 + 下部画布 + 折叠预览 (走法 1 标志)', () => {
    render(<CardEditor />)
    expect(screen.getByTestId('card-form-row')).toBeTruthy()
    expect(screen.getByTestId('card-graph')).toBeTruthy()
    expect(screen.getByTestId('card-preview-fold')).toBeTruthy()
    // 预览默认折叠, body 不渲染
    expect(screen.queryByTestId('card-preview-body')).toBeNull()
  })

  it('默认 CardData：id=MyCard, cost=1, type=Attack', () => {
    render(<CardEditor />)
    expect((screen.getByTestId('card-id') as HTMLInputElement).value).toBe('MyCard')
    expect((screen.getByTestId('card-name') as HTMLInputElement).value).toBe('My Card')
    expect((screen.getByTestId('card-cost') as HTMLInputElement).value).toBe('1')
    expect((screen.getByTestId('card-type') as HTMLSelectElement).value).toBe('Attack')
    expect((screen.getByTestId('card-rarity') as HTMLSelectElement).value).toBe('Common')
  })

  it('initialCard 覆盖默认值', () => {
    render(
      <CardEditor
        initialCard={{
          id: 'strike',
          name: 'Strike',
          cost: 1,
          type: 'Attack',
          rarity: 'Common',
          description: 'Deal 6 damage.',
          keywords: ['Damage'],
        }}
      />
    )
    expect((screen.getByTestId('card-id') as HTMLInputElement).value).toBe('strike')
    expect((screen.getByTestId('card-name') as HTMLInputElement).value).toBe('Strike')
    expect((screen.getByTestId('card-description') as HTMLInputElement).value).toBe('Deal 6 damage.')
    expect((screen.getByTestId('card-keywords') as HTMLInputElement).value).toBe('Damage')
  })

  it('Card palette 只看到 4 个 Card trigger (不含 Relic trigger)', () => {
    render(<CardEditor />)
    expect(screen.getByTestId('card-add-trigger-onPlay')).toBeTruthy()
    expect(screen.getByTestId('card-add-trigger-onSelfDraw')).toBeTruthy()
    expect(screen.getByTestId('card-add-trigger-onSelfExhaust')).toBeTruthy()
    expect(screen.getByTestId('card-add-trigger-onSelfDiscard')).toBeTruthy()
    // 4 个 trigger 全在
    const triggerButtons = screen.getAllByTestId(/^card-add-trigger-/)
    expect(triggerButtons).toHaveLength(4)
    // Relic trigger 不应出现
    expect(screen.queryByTestId('card-add-trigger-onCombatStart')).toBeNull()
    expect(screen.queryByTestId('card-add-trigger-onCardPlayed')).toBeNull()
  })

  it('Card palette 看到 4 个 Card effect + 1 通用 (drawCards, ADR §决策 §6 复用现有 Relic 版)', () => {
    render(<CardEditor />)
    // Card 专属
    expect(screen.getByTestId('card-add-effect-exhaustSelf')).toBeTruthy()
    expect(screen.getByTestId('card-add-effect-discardSelf')).toBeTruthy()
    expect(screen.getByTestId('card-add-effect-addCardToHand')).toBeTruthy()
    expect(screen.getByTestId('card-add-effect-addCardToDeck')).toBeTruthy()
    // 通用 (entity 缺省): drawCards
    expect(screen.getByTestId('card-add-effect-drawCards')).toBeTruthy()
    // 4 Card + 1 通用 = 5
    const effectButtons = screen.getAllByTestId(/^card-add-effect-/)
    expect(effectButtons).toHaveLength(5)
    // Relic 专属 (gainBuff/loseHp/gainGold) 不应出现
    expect(screen.queryByTestId('card-add-effect-gainBuff')).toBeNull()
    expect(screen.queryByTestId('card-add-effect-loseHp')).toBeNull()
    expect(screen.queryByTestId('card-add-effect-gainGold')).toBeNull()
  })

  it('空图 + 点生成 → textarea 包含 CardComponent 骨架', () => {
    render(<CardEditor initialCard={{ id: 'my_card', name: 'My Card' }} />)
    fireEvent.click(screen.getByTestId('card-generate-code'))
    const code = (screen.getByTestId('card-code') as HTMLTextAreaElement).value
    expect(code).toContain('public class MyCard : CardComponent')
    expect(code).toContain('namespace MyMod.Cards')
    // 预览展开
    expect(screen.getByTestId('card-preview-body')).toBeTruthy()
  })

  it('点生成后预览自动展开', () => {
    render(<CardEditor />)
    // 折叠
    expect(screen.queryByTestId('card-preview-body')).toBeNull()
    fireEvent.click(screen.getByTestId('card-generate-code'))
    // 自动展开
    expect(screen.getByTestId('card-preview-body')).toBeTruthy()
  })

  it('折叠预览切换：点击 toggle 展开 / 折叠 body', () => {
    render(<CardEditor />)
    // 默认折叠
    expect(screen.queryByTestId('card-preview-body')).toBeNull()
    fireEvent.click(screen.getByTestId('card-preview-toggle'))
    // 展开
    expect(screen.getByTestId('card-preview-body')).toBeTruthy()
    fireEvent.click(screen.getByTestId('card-preview-toggle'))
    // 折叠回
    expect(screen.queryByTestId('card-preview-body')).toBeNull()
  })

  it('加 trigger(onPlay) + effect(exhaustSelf) → 画布有 2 节点 + 生成代码包含 OnPlay + Exhaust()', () => {
    render(<CardEditor initialCard={{ id: 'demo', name: 'Demo' }} />)

    fireEvent.click(screen.getByTestId('card-add-trigger-onPlay'))
    fireEvent.click(screen.getByTestId('card-add-effect-exhaustSelf'))

    // 画布有 2 节点
    const canvas = screen.getByTestId('node-graph-canvas')
    expect(canvas.querySelectorAll('[data-testid^="node-box-"]')).toHaveLength(2)

    // 生成代码
    fireEvent.click(screen.getByTestId('card-generate-code'))
    const code = (screen.getByTestId('card-code') as HTMLTextAreaElement).value
    expect(code).toContain('public class Demo : CardComponent')
    expect(code).toContain('public override void OnPlay()')
    // 没有连线时, 触发器方法体为空, exhaustSelf() 不会进方法体
    expect(code).not.toContain('Exhaust();')
  })

  it('完整流水线 (UI 连线)：trigger→effect → 生成代码含 Exhaust();', () => {
    render(<CardEditor initialCard={{ id: 'demo', name: 'Demo' }} />)
    fireEvent.click(screen.getByTestId('card-add-trigger-onPlay'))
    fireEvent.click(screen.getByTestId('card-add-effect-exhaustSelf'))

    // UI 连线: 点 trigger.out → 点 effect.in
    const canvas = screen.getByTestId('node-graph-canvas')
    const triggerNode = canvas.querySelectorAll('[data-testid^="node-box-"]')[0]
    const effectNode = canvas.querySelectorAll('[data-testid^="node-box-"]')[1]
    const triggerId = triggerNode.getAttribute('data-testid')!.replace('node-box-', '')
    const effectId = effectNode.getAttribute('data-testid')!.replace('node-box-', '')
    const outPort = canvas.querySelector(`[data-testid="port-${triggerId}-out"]`) as HTMLElement
    const inPort = canvas.querySelector(`[data-testid="port-${effectId}-in"]`) as HTMLElement
    fireEvent.click(outPort)
    fireEvent.click(inPort)

    fireEvent.click(screen.getByTestId('card-generate-code'))
    const code = (screen.getByTestId('card-code') as HTMLTextAreaElement).value
    expect(code).toContain('public override void OnPlay()')
    expect(code).toContain('Exhaust();')
  })

  it('addCardToHand 节点 + 连线 → 生成代码含 AddCardToHand', () => {
    render(<CardEditor initialCard={{ id: 'demo', name: 'Demo' }} />)
    fireEvent.click(screen.getByTestId('card-add-trigger-onPlay'))
    fireEvent.click(screen.getByTestId('card-add-effect-addCardToHand'))

    // 默认 cardId=MyCard
    const canvas = screen.getByTestId('node-graph-canvas')
    const triggerNode = canvas.querySelectorAll('[data-testid^="node-box-"]')[0]
    const effectNode = canvas.querySelectorAll('[data-testid^="node-box-"]')[1]
    const triggerId = triggerNode.getAttribute('data-testid')!.replace('node-box-', '')
    const effectId = effectNode.getAttribute('data-testid')!.replace('node-box-', '')
    fireEvent.click(canvas.querySelector(`[data-testid="port-${triggerId}-out"]`) as HTMLElement)
    fireEvent.click(canvas.querySelector(`[data-testid="port-${effectId}-in"]`) as HTMLElement)

    fireEvent.click(screen.getByTestId('card-generate-code'))
    const code = (screen.getByTestId('card-code') as HTMLTextAreaElement).value
    expect(code).toContain('AddCardToHand("MyCard");')
  })

  it('关键词列表：逗号分隔字符串 → 多个 Keywords.Add 行', () => {
    render(
      <CardEditor
        initialCard={{
          id: 'fireball',
          name: 'Fireball',
          keywords: ['Fire', 'Damage'],
        }}
      />
    )
    fireEvent.click(screen.getByTestId('card-generate-code'))
    const code = (screen.getByTestId('card-code') as HTMLTextAreaElement).value
    expect(code).toContain('Keywords.Add("Fire");')
    expect(code).toContain('Keywords.Add("Damage");')
  })

})
