import { useState } from 'react'
import { useTaskStore } from '../stores/useTaskStore'

interface TutorialStep {
  title: string
  content: string
  highlight?: string  // CSS selector to highlight
}

const TUTORIAL_CONTENT: TutorialStep[] = [
  {
    title: '欢迎使用 Mod Studio！',
    content: '这是一个简单易用的杀戮尖塔2 Mod制作工具。即使你从未写过代码，也能创建自己的卡牌！'
  },
  {
    title: '什么是卡牌Mod？',
    content: '杀戮尖塔2中，卡牌是战斗的核心。每个角色有一套独特的卡牌，你可以添加新的卡牌来改变游戏玩法。',
    highlight: '.card-preview'
  },
  {
    title: '卡牌的属性',
    content: '每张卡牌都有以下属性：\n• 名称：卡牌的名字\n• 费用：打出卡牌需要消耗的能量\n• 类型：攻击（伤害）、技能（防御）、力量（强化）\n• 稀有度：普通、优秀、稀有\n• 描述：卡牌的效果说明',
    highlight: '.card-properties'
  },
  {
    title: '创建你的第一张卡牌',
    content: '点击左侧的「+ 新建卡牌」按钮，开始创建你的第一张卡牌！',
    highlight: '.editor-header'
  },
  {
    title: '编辑卡牌属性',
    content: '在右侧面板中填写卡牌信息。你可以：\n• 输入卡牌名称\n• 选择卡牌类型\n• 设置能量费用\n• 编写效果描述',
    highlight: '.form-section'
  },
  {
    title: '保存卡牌',
    content: '完成编辑后，点击「保存到项目」按钮。工具会自动生成C#代码并保存到你的Mod项目中。',
    highlight: '.form-actions'
  },
  {
    title: '测试你的卡牌',
    content: '保存后，你可以启动游戏来测试卡牌效果。工具会帮你打开游戏并加载你的Mod！',
    highlight: '.game-launcher'
  },
  {
    title: '任务引导',
    content: '现在开始任务模式！我们会一步步引导你完成第一张卡牌的创建。按下「开始任务」按钮开始吧！',
  }
]

interface TutorialProps {
  onComplete: () => void
}

export function Tutorial({ onComplete }: TutorialProps) {
  const [currentStep, setCurrentStep] = useState(0)
  const { startTasks } = useTaskStore()

  const step = TUTORIAL_CONTENT[currentStep]
  const isLastStep = currentStep === TUTORIAL_CONTENT.length - 1
  const isFirstStep = currentStep === 0

  const handleNext = () => {
    if (isLastStep) {
      startTasks()
      onComplete()
    } else {
      setCurrentStep(prev => prev + 1)
    }
  }

  const handlePrev = () => {
    if (!isFirstStep) {
      setCurrentStep(prev => prev - 1)
    }
  }

  const handleSkip = () => {
    startTasks()
    onComplete()
  }

  return (
    <div className="tutorial-overlay">
      <div className="tutorial-backdrop" />

      <div className="tutorial-card">
        <div className="tutorial-progress">
          {TUTORIAL_CONTENT.map((_, index) => (
            <div
              key={index}
              className={`progress-dot ${index === currentStep ? 'active' : ''} ${index < currentStep ? 'done' : ''}`}
            />
          ))}
        </div>

        <div className="tutorial-content">
          <h2>{step.title}</h2>
          <div className="tutorial-text">
            {step.content.split('\n').map((line, i) => (
              <p key={i}>{line}</p>
            ))}
          </div>
        </div>

        <div className="tutorial-actions">
          {!isFirstStep && (
            <button className="prev-btn" onClick={handlePrev}>
              ← 上一步
            </button>
          )}

          <button className="skip-btn" onClick={handleSkip}>
            跳过教程
          </button>

          <button className="next-btn" onClick={handleNext}>
            {isLastStep ? '开始任务 →' : '下一步 →'}
          </button>
        </div>

        <div className="tutorial-counter">
          {currentStep + 1} / {TUTORIAL_CONTENT.length}
        </div>
      </div>

      <style>{`
        .tutorial-overlay {
          position: fixed;
          top: 0;
          left: 0;
          right: 0;
          bottom: 0;
          display: flex;
          align-items: center;
          justify-content: center;
          z-index: 1000;
        }

        .tutorial-backdrop {
          position: absolute;
          top: 0;
          left: 0;
          right: 0;
          bottom: 0;
          background: rgba(0, 0, 0, 0.7);
        }

        .tutorial-card {
          position: relative;
          width: 480px;
          max-width: 90vw;
          background: var(--bg-secondary);
          border-radius: 12px;
          border: 1px solid var(--border);
          box-shadow: 0 8px 40px rgba(0, 0, 0, 0.5);
          overflow: hidden;
        }

        .tutorial-progress {
          display: flex;
          justify-content: center;
          gap: 6px;
          padding: 16px;
          background: var(--bg-tertiary);
        }

        .progress-dot {
          width: 8px;
          height: 8px;
          border-radius: 50%;
          background: var(--border);
          transition: all 0.2s;
        }

        .progress-dot.active {
          background: var(--accent);
          transform: scale(1.2);
        }

        .progress-dot.done {
          background: #4ade80;
        }

        .tutorial-content {
          padding: 24px;
        }

        .tutorial-content h2 {
          font-size: 18px;
          font-weight: 600;
          margin: 0 0 16px 0;
          color: var(--accent);
        }

        .tutorial-text {
          font-size: 14px;
          line-height: 1.7;
          color: var(--text-secondary);
        }

        .tutorial-text p {
          margin: 0 0 8px 0;
        }

        .tutorial-text p:last-child {
          margin-bottom: 0;
        }

        .tutorial-actions {
          display: flex;
          justify-content: center;
          gap: 12px;
          padding: 16px 24px 24px;
          border-top: 1px solid var(--border);
        }

        .prev-btn, .skip-btn, .next-btn {
          padding: 10px 20px;
          border-radius: 6px;
          font-size: 14px;
          font-weight: 500;
        }

        .prev-btn {
          background: var(--bg-tertiary);
          color: var(--text-primary);
        }

        .skip-btn {
          background: transparent;
          color: var(--text-secondary);
        }

        .skip-btn:hover {
          color: var(--text-primary);
        }

        .next-btn {
          background: var(--accent);
          color: white;
        }

        .tutorial-counter {
          position: absolute;
          bottom: 20px;
          right: 24px;
          font-size: 12px;
          color: var(--text-secondary);
        }
      `}</style>
    </div>
  )
}
