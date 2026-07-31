/**
 * 卡牌搜索/过滤组件（受控组件）
 * 搜索条件和过滤逻辑由 CardEditor 持有，本组件只负责展示和回调，
 * 避免通过 useEffect 向父组件回推 filteredCards 造成状态镜像
 */
import { CardData } from '../types'

interface CardSearchProps {
  searchTerm: string
  typeFilter: 'all' | CardData['type']
  filteredCount: number
  totalCount: number
  onSearchTermChange: (term: string) => void
  onTypeFilterChange: (type: 'all' | CardData['type']) => void
}

export function CardSearch({
  searchTerm,
  typeFilter,
  filteredCount,
  totalCount,
  onSearchTermChange,
  onTypeFilterChange
}: CardSearchProps) {
  return (
    <div className="card-search">
      <div className="search-input-wrapper">
        <span className="search-icon">🔍</span>
        <input
          type="text"
          value={searchTerm}
          onChange={(e) => onSearchTermChange(e.target.value)}
          placeholder="搜索卡牌名称、描述或关键词..."
          className="search-input"
        />
        {searchTerm && (
          <button className="clear-search" onClick={() => onSearchTermChange('')}>
            ×
          </button>
        )}
      </div>

      <div className="type-filters">
        <button
          className={`type-filter ${typeFilter === 'all' ? 'active' : ''}`}
          onClick={() => onTypeFilterChange('all')}
        >
          全部
        </button>
        <button
          className={`type-filter attack ${typeFilter === 'Attack' ? 'active' : ''}`}
          onClick={() => onTypeFilterChange('Attack')}
        >
          ⚔️ 攻击
        </button>
        <button
          className={`type-filter skill ${typeFilter === 'Skill' ? 'active' : ''}`}
          onClick={() => onTypeFilterChange('Skill')}
        >
          🛡️ 技能
        </button>
        <button
          className={`type-filter power ${typeFilter === 'Power' ? 'active' : ''}`}
          onClick={() => onTypeFilterChange('Power')}
        >
          ✨ 力量
        </button>
      </div>

      <div className="result-count">
        {filteredCount} / {totalCount} 张卡牌
      </div>

      <style>{`
        .card-search {
          padding: 12px;
          border-bottom: 1px solid var(--border);
          background: var(--bg-secondary);
        }

        .search-input-wrapper {
          position: relative;
          margin-bottom: 8px;
        }

        .search-icon {
          position: absolute;
          left: 10px;
          top: 50%;
          transform: translateY(-50%);
          font-size: 12px;
          opacity: 0.6;
        }

        .search-input {
          padding-left: 30px !important;
          padding-right: 30px !important;
          font-size: 13px;
        }

        .clear-search {
          position: absolute;
          right: 6px;
          top: 50%;
          transform: translateY(-50%);
          background: transparent;
          padding: 2px 6px;
          font-size: 16px;
          line-height: 1;
          min-width: auto;
          color: var(--text-secondary);
        }

        .type-filters {
          display: flex;
          gap: 4px;
          margin-bottom: 8px;
        }

        .type-filter {
          flex: 1;
          padding: 4px 8px;
          font-size: 11px;
          background: var(--bg-tertiary);
          color: var(--text-secondary);
          border: 1px solid transparent;
        }

        .type-filter:hover {
          opacity: 0.8;
        }

        .type-filter.active {
          border-color: var(--accent);
          color: var(--text-primary);
        }

        .type-filter.attack.active {
          background: rgba(233, 69, 96, 0.2);
        }

        .type-filter.skill.active {
          background: rgba(74, 222, 128, 0.2);
        }

        .type-filter.power.active {
          background: rgba(168, 85, 247, 0.2);
        }

        .result-count {
          font-size: 11px;
          color: var(--text-secondary);
          text-align: center;
        }
      `}</style>
    </div>
  )
}
