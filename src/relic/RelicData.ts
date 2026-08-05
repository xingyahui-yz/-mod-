// ============ Relic 数据类型（v0.5.2 从 src/types/index.ts 抽出）============
// v0.5.2 之前：RelicData 与 CardData / ModManifest / Task 等共享 types/index.ts
// v0.5.2 决定：relic 概念独立成 src/relic/ 模块，RelicData 落此处
// dead fields `triggers: string[]` 和 `graph?: NodeGraph` 在 v0.5.2 part 1 删除：
//   - triggers: codegen 读 graph.nodes[].data.event，从未读 relic.triggers
//   - graph?: useNodeGraph 自管 graph 状态，从未写回 relic.graph
//   - CONTEXT.md 5.1 表明节点图存 .modstudio/nodes/{id}.json，不在 RelicData 里

export type RelicTier = 'Common' | 'Uncommon' | 'Rare' | 'Boss' | 'Shop'
export type RelicRarity = 'Starter' | 'Common' | 'Uncommon' | 'Rare' | 'Boss' | 'Shop'

export interface RelicData {
  id: string                 // 文件名 ID，如 'burning_blood'
  name: string               // 显示名
  description: string
  tier: RelicTier            // 颜色/分级
  rarity: RelicRarity        // 掉落稀有度
}
