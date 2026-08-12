/**
 * Relic kinds — v0.9 起 re-export from shared/kinds.ts
 *
 * 历史：v0.5.2 把 TRIGGER_DISPATCH / EFFECT_DISPATCH 从 codegen.ts 归一到 kinds.ts
 * v0.9 (ADR-0006) 把 kinds.ts 进一步提到 src/shared/kinds.ts 跨实体共享
 *
 * 此文件保留为薄壳 re-export 以保持向后兼容（codegen.ts / RelicEditor.tsx / kinds.test.ts
 * 都从 './kinds' 导入）
 */
export {
  TRIGGER_KINDS,
  EFFECT_KINDS,
  SUPPORTED_TRIGGERS,
  SUPPORTED_EFFECTS,
  // 类型别名（向后兼容）：原 RelicTriggerKind / RelicEffectKind 现在统一叫 TriggerKind / EffectKind
  type TriggerKind as RelicTriggerKind,
  type EffectKind as RelicEffectKind,
} from '../shared/kinds'