// ============ 基础类型 ============
export interface FileEntry {
  name: string
  isDirectory: boolean
  path: string
}

export interface FileStat {
  isDirectory: boolean
  size: number
  modifiedTime: string
}

export interface CardData {
  name: string
  cost: number
  type: 'Attack' | 'Skill' | 'Power'
  rarity: 'Common' | 'Uncommon' | 'Rare'
  description: string
  keywords: string[]
  imagePath?: string
}

// ============ Relic ============
// 节点编辑器 v0.4：表单数据 + 节点图共用
export type RelicTier = 'Common' | 'Uncommon' | 'Rare' | 'Boss' | 'Shop'
export type RelicRarity = 'Starter' | 'Common' | 'Uncommon' | 'Rare' | 'Boss' | 'Shop'

export interface RelicData {
  id: string                 // 文件名 ID，如 'burning_blood'
  name: string               // 显示名
  description: string
  tier: RelicTier            // 颜色/分级
  rarity: RelicRarity        // 掉落稀有度
  /** 触发器节点的 data.event 列表，用于 codegen 派发 */
  triggers: string[]
  /** 节点图（由节点编辑器产出） */
  graph?: import('../node-editor/types').NodeGraph
}

export interface ModManifest {
  id: string
  name: string
  version: string
  authors: string[]
  description: string
  dependencies: string[]
}

// ============ 任务类型 ============
export type TaskStatus = 'pending' | 'in_progress' | 'completed' | 'skipped'

export interface Task {
  id: string
  title: string
  description: string
  status: TaskStatus
  action?: () => void
}

export interface TaskStep {
  id: string
  title: string
  description: string
  targetUI?: string
  completedCondition?: () => boolean
}

// 预设的任务步骤
export const TUTORIAL_STEPS: TaskStep[] = [
  {
    id: 'create-project',
    title: '创建或打开项目',
    description: '首先创建一个新项目或打开已有的Mod项目文件夹',
    targetUI: 'header'
  },
  {
    id: 'create-card',
    title: '创建第一张卡牌',
    description: '点击「新建卡牌」按钮，创建你的第一张卡牌',
    targetUI: 'card-editor'
  },
  {
    id: 'edit-card',
    title: '编辑卡牌属性',
    description: '填写卡牌名称、选择类型、设置费用和描述',
    targetUI: 'card-properties'
  },
  {
    id: 'preview-card',
    title: '预览卡牌',
    description: '查看右侧的卡牌预览效果',
    targetUI: 'card-preview'
  },
  {
    id: 'save-card',
    title: '保存卡牌',
    description: '点击「保存到项目」将卡牌代码写入文件',
    targetUI: 'form-actions'
  },
  {
    id: 'test-card',
    title: '测试卡牌',
    description: '启动游戏测试你的卡牌是否正常工作',
    targetUI: 'game-launcher'
  }
]

// 卡牌类型选项（用于教程）
export const CARD_TYPES = [
  { value: 'Attack', label: '攻击牌', icon: '⚔️', description: '对敌人造成伤害' },
  { value: 'Skill', label: '技能牌', icon: '🛡️', description: '获得防御或特殊效果' },
  { value: 'Power', label: '力量牌', icon: '✨', description: '获得永久强化' }
] as const

// 稀有度选项
export const RARITIES = [
  { value: 'Common', label: '普通', color: '#888' },
  { value: 'Uncommon', label: '优秀', color: '#4ade80' },
  { value: 'Rare', label: '稀有', color: '#a855f7' }
] as const

// 预设关键词
export const COMMON_KEYWORDS = [
  'Fire', 'Ice', 'Lightning', 'Poison', 'Heal',
  'Block', 'Strength', 'Weak', 'Vulnerable', 'Artifact'
]
