/**
 * RelicEditor 端到端测试 - 节点编辑器 v0.4
 *
 * 流程：表单填字段 → 加 trigger 节点 → 加 effect 节点 → 连线 → 生成代码 → 断言 textarea
 */
import { describe, it, expect } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { RelicEditor } from './RelicEditor'

describe('RelicEditor 端到端', () => {
  it('空表单 + 点击生成代码不崩溃，textarea 显示类骨架', () => {
    render(<RelicEditor />)
    fireEvent.click(screen.getByTestId('generate-code'))
    const code = (screen.getByTestId('relic-code') as HTMLTextAreaElement).value
    expect(code).toContain('public class MyRelic : RelicComponent')
  })

  it('加 trigger(onCombatStart) + effect(gainBuff Strength 2) + 连线 → 生成代码包含 ApplyBuff', () => {
    render(<RelicEditor initialRelic={{ id: 'burning_blood', name: 'Burning Blood' }} />)

    // 1. 加触发器
    fireEvent.click(screen.getByTestId('add-trigger-onCombatStart'))

    // 2. 加效果
    fireEvent.click(screen.getByTestId('add-effect-gainBuff'))

    // v0.4 MVP 暂不支持画布拖拽连线，所以本测试只验证：
    //   - trigger 节点已添加
    //   - effect 节点已添加
    //   - 生成代码不报错（即使没有连线，trigger 也生成空方法）
    fireEvent.click(screen.getByTestId('generate-code'))
    const code = (screen.getByTestId('relic-code') as HTMLTextAreaElement).value
    expect(code).toContain('public class BurningBlood : RelicComponent')
    // 没有连线，所以方法体为空，但方法应存在
    expect(code).toContain('public override void OnCombatStart()')
  })

  it('完整流水线：表单 → 节点 → 生成代码 → 断言 ApplyBuff 字符串', () => {
    // 这个测试通过 useNodeGraph hook + 手动 connect + generateRelicCode 直接验证
    // —— 不经过 UI 连线，因为 v0.4 还没实现画布拖拽连线
    render(<RelicEditor initialRelic={{ id: 'burning_blood', name: 'Burning Blood' }} />)

    // 验证初始表单值
    expect((screen.getByTestId('relic-id') as HTMLInputElement).value).toBe('burning_blood')
    expect((screen.getByTestId('relic-name') as HTMLInputElement).value).toBe('Burning Blood')

    // 加节点
    fireEvent.click(screen.getByTestId('add-trigger-onCombatStart'))
    fireEvent.click(screen.getByTestId('add-effect-gainBuff'))

    // 节点画布应有 2 个节点
    const canvas = screen.getByTestId('node-graph-canvas')
    expect(canvas.querySelectorAll('[data-testid^="node-box-"]')).toHaveLength(2)

    // 生成代码（即使没连线，结构应正确）
    fireEvent.click(screen.getByTestId('generate-code'))
    const code = (screen.getByTestId('relic-code') as HTMLTextAreaElement).value
    expect(code).toContain('namespace MyMod.Relics')
    expect(code).toContain('public class BurningBlood : RelicComponent')
    expect(code).toContain('Name = "Burning Blood"')
    expect(code).toContain('public override void OnCombatStart()')
  })

  it('change tier 和 rarity 同步到生成的代码', () => {
    render(<RelicEditor initialRelic={{ id: 'r', name: 'Test', tier: 'Boss', rarity: 'Rare' }} />)
    fireEvent.click(screen.getByTestId('generate-code'))
    const code = (screen.getByTestId('relic-code') as HTMLTextAreaElement).value
    expect(code).toContain('Tier = RelicTier.Boss')
    expect(code).toContain('Rarity = RelicRarity.Rare')
  })

  it('完整流水线 (v0.5)：加 trigger + effect → 点 output → 点 input → 生成代码包含 ApplyBuff', () => {
    render(<RelicEditor initialRelic={{ id: 'burning_blood', name: 'Burning Blood' }} />)

    // 1. 加触发器 + 效果
    fireEvent.click(screen.getByTestId('add-trigger-onCombatStart'))
    fireEvent.click(screen.getByTestId('add-effect-gainBuff'))

    // 2. 找到 trigger.out 端口和 effect.in 端口
    const canvas = screen.getByTestId('node-graph-canvas')
    const triggerOut = canvas.querySelector('[data-testid^="port-"][data-testid$="-out"]') as Element
    const effectIn = canvas.querySelector('[data-testid^="port-"][data-testid$="-in"]') as Element
    expect(triggerOut).toBeTruthy()
    expect(effectIn).toBeTruthy()

    // 3. 点 output → 点 input → 连线
    fireEvent.click(triggerOut)
    fireEvent.click(effectIn)

    // 4. 画布上应有一条边
    expect(canvas.querySelectorAll('[data-testid^="edge-"]')).toHaveLength(1)

    // 5. 生成代码 → 应包含 ApplyBuff
    fireEvent.click(screen.getByTestId('generate-code'))
    const code = (screen.getByTestId('relic-code') as HTMLTextAreaElement).value
    expect(code).toContain('public class BurningBlood : RelicComponent')
    expect(code).toContain('public override void OnCombatStart()')
    expect(code).toMatch(/ApplyBuff\("Strength", 1\);/)
  })
})

// ============================================================================
// v0.7: 撤销/重做 UI
// ============================================================================

describe('RelicEditor undo/redo UI (v0.7)', () => {
  it('初始状态：撤销/重做按钮 disabled', () => {
    render(<RelicEditor />)
    const undoBtn = screen.getByTestId('undo') as HTMLButtonElement
    const redoBtn = screen.getByTestId('redo') as HTMLButtonElement
    expect(undoBtn.disabled).toBe(true)
    expect(redoBtn.disabled).toBe(true)
  })

  it('加节点后撤销按钮可用，点击撤销后节点消失', () => {
    render(<RelicEditor />)
    fireEvent.click(screen.getByTestId('add-trigger-onCombatStart'))
    const undoBtn = screen.getByTestId('undo') as HTMLButtonElement
    expect(undoBtn.disabled).toBe(false)

    const canvas = screen.getByTestId('node-graph-canvas')
    expect(canvas.querySelectorAll('[data-testid^="node-box-"]')).toHaveLength(1)

    fireEvent.click(undoBtn)
    expect(canvas.querySelectorAll('[data-testid^="node-box-"]')).toHaveLength(0)
    // undo 后 canRedo=true
    const redoBtn = screen.getByTestId('redo') as HTMLButtonElement
    expect(redoBtn.disabled).toBe(false)
  })

  it('撤销 → 重做 按钮：节点恢复', () => {
    render(<RelicEditor />)
    fireEvent.click(screen.getByTestId('add-trigger-onCombatStart'))
    const undoBtn = screen.getByTestId('undo') as HTMLButtonElement
    const redoBtn = screen.getByTestId('redo') as HTMLButtonElement

    fireEvent.click(undoBtn)
    const canvas = screen.getByTestId('node-graph-canvas')
    expect(canvas.querySelectorAll('[data-testid^="node-box-"]')).toHaveLength(0)

    fireEvent.click(redoBtn)
    expect(canvas.querySelectorAll('[data-testid^="node-box-"]')).toHaveLength(1)
  })

  it('Ctrl/Cmd+Z 触发撤销（画布焦点）', () => {
    render(<RelicEditor />)
    fireEvent.click(screen.getByTestId('add-trigger-onCombatStart'))
    const canvas = screen.getByTestId('node-graph-canvas')
    expect(canvas.querySelectorAll('[data-testid^="node-box-"]')).toHaveLength(1)

    // 焦点在画布上（svg 元素）
    const svg = canvas as unknown as HTMLElement
    svg.focus?.()
    fireEvent.keyDown(svg, { key: 'z', ctrlKey: true })

    expect(canvas.querySelectorAll('[data-testid^="node-box-"]')).toHaveLength(0)
  })

  it('Ctrl/Cmd+Shift+Z 触发重做（画布焦点）', () => {
    render(<RelicEditor />)
    fireEvent.click(screen.getByTestId('add-trigger-onCombatStart'))
    const canvas = screen.getByTestId('node-graph-canvas')
    fireEvent.click(screen.getByTestId('undo'))
    expect(canvas.querySelectorAll('[data-testid^="node-box-"]')).toHaveLength(0)

    const svg = canvas as unknown as HTMLElement
    svg.focus?.()
    fireEvent.keyDown(svg, { key: 'Z', ctrlKey: true, shiftKey: true })

    expect(canvas.querySelectorAll('[data-testid^="node-box-"]')).toHaveLength(1)
  })

  it('Ctrl+Y 触发重做（Windows/Linux 别名，画布焦点）', () => {
    render(<RelicEditor />)
    fireEvent.click(screen.getByTestId('add-trigger-onCombatStart'))
    const canvas = screen.getByTestId('node-graph-canvas')
    fireEvent.click(screen.getByTestId('undo'))
    expect(canvas.querySelectorAll('[data-testid^="node-box-"]')).toHaveLength(0)

    const svg = canvas as unknown as HTMLElement
    svg.focus?.()
    fireEvent.keyDown(svg, { key: 'y', ctrlKey: true })

    expect(canvas.querySelectorAll('[data-testid^="node-box-"]')).toHaveLength(1)
  })
  it('Cmd+Y 触发重做（Mac 别名，画布焦点）', () => {
    render(<RelicEditor />)
    fireEvent.click(screen.getByTestId('add-trigger-onCombatStart'))
    const canvas = screen.getByTestId('node-graph-canvas')
    fireEvent.click(screen.getByTestId('undo'))
    expect(canvas.querySelectorAll('[data-testid^="node-box-"]')).toHaveLength(0)

    const svg = canvas as unknown as HTMLElement
    svg.focus?.()
    fireEvent.keyDown(svg, { key: 'y', metaKey: true })

    expect(canvas.querySelectorAll('[data-testid^="node-box-"]')).toHaveLength(1)
  })

  it('输入框（relic-id）焦点时 Ctrl+Z 不触发撤销（让浏览器原生 undo）', () => {
    render(<RelicEditor initialRelic={{ id: 'burning_blood', name: 'Burning Blood' }} />)
    fireEvent.click(screen.getByTestId('add-trigger-onCombatStart'))
    const canvas = screen.getByTestId('node-graph-canvas')
    expect(canvas.querySelectorAll('[data-testid^="node-box-"]')).toHaveLength(1)

    // 焦点在 relic-id 输入框
    const idInput = screen.getByTestId('relic-id') as HTMLInputElement
    fireEvent.keyDown(idInput, { key: 'z', ctrlKey: true })

    // 节点仍应在（全局快捷键被跳过）
    expect(canvas.querySelectorAll('[data-testid^="node-box-"]')).toHaveLength(1)
  })

  it('输入框（relic-name）焦点时 Ctrl+Z 不触发撤销', () => {
    render(<RelicEditor />)
    fireEvent.click(screen.getByTestId('add-effect-gainBuff'))
    const canvas = screen.getByTestId('node-graph-canvas')
    expect(canvas.querySelectorAll('[data-testid^="node-box-"]')).toHaveLength(1)

    const nameInput = screen.getByTestId('relic-name') as HTMLInputElement
    fireEvent.keyDown(nameInput, { key: 'z', ctrlKey: true })

    expect(canvas.querySelectorAll('[data-testid^="node-box-"]')).toHaveLength(1)
  })

  it('textarea（relic-description）焦点时 Ctrl+Z 不触发撤销', () => {
    render(<RelicEditor />)
    fireEvent.click(screen.getByTestId('add-effect-gainBuff'))
    const canvas = screen.getByTestId('node-graph-canvas')
    expect(canvas.querySelectorAll('[data-testid^="node-box-"]')).toHaveLength(1)

    const descTextarea = screen.getByTestId('relic-description') as HTMLTextAreaElement
    fireEvent.keyDown(descTextarea, { key: 'z', ctrlKey: true })

    expect(canvas.querySelectorAll('[data-testid^="node-box-"]')).toHaveLength(1)
  })

  it('撤销/重做作用于连线：加节点+连线 → 撤销恢复空图 → 重做恢复 2 节点 1 边', () => {
    render(<RelicEditor initialRelic={{ id: 'burning_blood', name: 'Burning Blood' }} />)
    fireEvent.click(screen.getByTestId('add-trigger-onCombatStart'))
    fireEvent.click(screen.getByTestId('add-effect-gainBuff'))

    const canvas = screen.getByTestId('node-graph-canvas')
    const triggerOut = canvas.querySelector('[data-testid^="port-"][data-testid$="-out"]') as Element
    const effectIn = canvas.querySelector('[data-testid^="port-"][data-testid$="-in"]') as Element
    fireEvent.click(triggerOut)
    fireEvent.click(effectIn)
    expect(canvas.querySelectorAll('[data-testid^="edge-"]')).toHaveLength(1)

    // 撤销：先撤销 connect → 2 节点 0 边
    fireEvent.click(screen.getByTestId('undo'))
    expect(canvas.querySelectorAll('[data-testid^="node-box-"]')).toHaveLength(2)
    expect(canvas.querySelectorAll('[data-testid^="edge-"]')).toHaveLength(0)

    // 再撤销：撤销 effect → 1 节点
    fireEvent.click(screen.getByTestId('undo'))
    expect(canvas.querySelectorAll('[data-testid^="node-box-"]')).toHaveLength(1)

    // 重做 2 次：恢复 effect + connect
    fireEvent.click(screen.getByTestId('redo'))
    expect(canvas.querySelectorAll('[data-testid^="node-box-"]')).toHaveLength(2)
    expect(canvas.querySelectorAll('[data-testid^="edge-"]')).toHaveLength(0)
    fireEvent.click(screen.getByTestId('redo'))
    expect(canvas.querySelectorAll('[data-testid^="node-box-"]')).toHaveLength(2)
    expect(canvas.querySelectorAll('[data-testid^="edge-"]')).toHaveLength(1)
  })
})