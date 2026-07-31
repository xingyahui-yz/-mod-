/**
 * LLM适配器注册表
 */
import { BaseLLMAdapter } from './base'
import { HTTPAdapter } from './httpAdapter'

export type LLMProvider = 'minimax' | 'qwen' | 'ernie' | 'chatglm'

export interface LLMProviderInfo {
  id: LLMProvider
  name: string
  description: string
  website: string
}

export const LLM_PROVIDERS: LLMProviderInfo[] = [
  {
    id: 'minimax',
    name: 'MiniMax',
    description: '国产大模型，支持中文',
    website: 'https://www.minimax.chat/'
  },
  {
    id: 'qwen',
    name: '通义千问',
    description: '阿里云大模型',
    website: 'https://qwen.ai/'
  },
  {
    id: 'ernie',
    name: '文心一言',
    description: '百度大模型',
    website: 'https://yiyan.baidu.com/'
  },
  {
    id: 'chatglm',
    name: 'ChatGLM',
    description: '智谱AI大模型',
    website: 'https://www.zhipuai.cn/'
  }
]

/**
 * 创建适配器实例
 */
export function createAdapter(provider: LLMProvider, apiKey: string): BaseLLMAdapter {
  return new HTTPAdapter(provider, { apiKey })
}

export { BaseLLMAdapter } from './base'
export type { LLMResponse, CardGenerationResult, LLMConfig } from './base'
export { HTTPAdapter } from './httpAdapter'
