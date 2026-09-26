import { useEffect, useState } from 'react'
import { Modal } from '../components/Modal'

const STEPS = [
  {
    title: '填写遗物资料',
    description: '先给遗物设置内部 ID、显示名称和效果描述。Tier 表示遗物分级，Rarity 表示掉落稀有度。',
    details: ['ID 用于代码和文件识别，建议使用英文与下划线。', '显示名和描述会作为游戏内展示内容。'],
  },
  {
    title: '选择触发时机',
    description: '点击「触发器」下的按钮，在画布上添加触发节点。它决定遗物在什么时候开始执行效果。',
    details: ['onCombatStart：战斗开始时', 'onTurnStart：回合开始时', 'onCardPlayed：打出卡牌时'],
  },
  {
    title: '添加遗物效果',
    description: '点击「效果」下的按钮添加效果节点。节点会带有可用的默认参数。',
    details: ['gainBuff：获得 Buff；loseHp：失去生命', 'gainGold：获得金币；drawCards：抽牌'],
  },
  {
    title: '连接并整理节点',
    description: '先点触发节点右侧的输出圆点，再点效果节点左侧的输入圆点，就能连成执行流程。',
    details: ['拖动节点可调整位置；点节点右上角的 × 可删除节点。', '点击连线可移除连线；撤销和重做按钮可恢复操作。'],
  },
  {
    title: '生成代码',
    description: '点击「生成代码」，在右侧查看生成的 C# 代码。',
    details: ['检查代码和节点连接是否符合预期。', '当前按钮生成代码预览；复制右侧内容后，可放入 Mod 项目。'],
  },
]

interface RelicTutorialProps {
  isOpen: boolean
  onClose: () => void
}

export function RelicTutorial({ isOpen, onClose }: RelicTutorialProps) {
  const [currentStep, setCurrentStep] = useState(0)

  useEffect(() => {
    if (isOpen) setCurrentStep(0)
  }, [isOpen])

  const step = STEPS[currentStep]
  const isFirstStep = currentStep === 0
  const isLastStep = currentStep === STEPS.length - 1

  const handleNext = () => {
    if (isLastStep) {
      onClose()
      return
    }
    setCurrentStep(index => index + 1)
  }

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="遗物编辑器教程" width={560}>
      <div className="relic-tutorial-content" data-testid="relic-tutorial">
        <div className="relic-tutorial-progress" aria-label={`第 ${currentStep + 1} 步，共 ${STEPS.length} 步`}>
          {STEPS.map((item, index) => (
            <span
              key={item.title}
              className={index === currentStep ? 'active' : index < currentStep ? 'done' : ''}
            />
          ))}
          <span className="relic-tutorial-counter">{currentStep + 1} / {STEPS.length}</span>
        </div>

        <section className="relic-tutorial-step" aria-live="polite">
          <h3>{step.title}</h3>
          <p>{step.description}</p>
          <ul>
            {step.details.map(detail => <li key={detail}>{detail}</li>)}
          </ul>
        </section>

        <div className="relic-tutorial-actions">
          <button
            type="button"
            className="relic-tutorial-secondary"
            onClick={() => setCurrentStep(index => Math.max(0, index - 1))}
            disabled={isFirstStep}
          >
            ← 上一步
          </button>
          <button type="button" onClick={handleNext}>
            {isLastStep ? '完成教程' : '下一步 →'}
          </button>
        </div>
      </div>
    </Modal>
  )
}
