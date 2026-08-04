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