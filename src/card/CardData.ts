/**
 * 兼容旧导入路径的 re-export。
 * CardData 的唯一权威定义位于 src/types/index.ts；此文件不再声明第二份模型。
 */
export type { CardData } from '../types'
export { createDefaultCard } from '../types'
