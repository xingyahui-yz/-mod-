/**
 * 关于弹窗
 */
import { Modal } from './Modal'

interface AboutModalProps {
  isOpen: boolean
  onClose: () => void
}

export function AboutModal({ isOpen, onClose }: AboutModalProps) {
  return (
    <Modal isOpen={isOpen} onClose={onClose} title="关于 Mod Studio" width={480}>
      <div className="about-body">
        <div className="about-hero">
          <div className="logo">🎮</div>
          <h3>Slay the Spire 2 Mod Studio</h3>
          <p className="version">v0.1.0 MVP</p>
        </div>

        <p className="description">
          一个简洁的杀戮尖塔2 Mod开发工具，让零基础用户也能轻松创建自己的卡牌。
        </p>

        <div className="features">
          <h4>✨ 主要功能</h4>
          <ul>
            <li>🃏 可视化卡牌编辑器</li>
            <li>🤖 AI智能生成卡牌</li>
            <li>📚 内置教程和任务引导</li>
            <li>🚀 一键启动游戏测试</li>
            <li>🎨 暗/亮主题切换</li>
          </ul>
        </div>

        <div className="tech-stack">
          <h4>🛠️ 技术栈</h4>
          <div className="tech-tags">
            <span className="tech-tag">Electron</span>
            <span className="tech-tag">React</span>
            <span className="tech-tag">TypeScript</span>
            <span className="tech-tag">Zustand</span>
            <span className="tech-tag">Mustache</span>
            <span className="tech-tag">Vitest</span>
          </div>
        </div>

        <div className="footer-note">
          <p>基于 <a href="https://sts2.wiki/" target="_blank" rel="noopener">STS2 Wiki</a> 和 <a href="https://github.com/BAKAOLC/STS2-RitsuLib" target="_blank" rel="noopener">RitsuLib</a></p>
        </div>
      </div>

      <style>{`
        .about-body {
          padding: 24px;
        }

        .about-hero {
          text-align: center;
          margin-bottom: 24px;
        }

        .logo {
          font-size: 48px;
          margin-bottom: 8px;
        }

        .about-hero h3 {
          font-size: 18px;
          margin-bottom: 4px;
        }

        .version {
          font-size: 12px;
          color: var(--text-secondary);
        }

        .description {
          text-align: center;
          color: var(--text-secondary);
          margin-bottom: 24px;
          line-height: 1.6;
        }

        .features, .tech-stack {
          margin-bottom: 20px;
        }

        .features h4, .tech-stack h4 {
          font-size: 14px;
          font-weight: 600;
          margin-bottom: 12px;
          color: var(--accent);
        }

        .features ul {
          list-style: none;
          padding: 0;
        }

        .features li {
          padding: 4px 0;
          font-size: 13px;
          color: var(--text-secondary);
        }

        .tech-tags {
          display: flex;
          flex-wrap: wrap;
          gap: 6px;
        }

        .tech-tag {
          background: var(--bg-tertiary);
          padding: 4px 10px;
          border-radius: 12px;
          font-size: 11px;
          color: var(--text-primary);
        }

        .footer-note {
          text-align: center;
          padding-top: 16px;
          border-top: 1px solid var(--border);
        }

        .footer-note p {
          font-size: 12px;
          color: var(--text-secondary);
        }

        .footer-note a {
          color: var(--accent);
          text-decoration: none;
        }

        .footer-note a:hover {
          text-decoration: underline;
        }
      `}</style>
    </Modal>
  )
}