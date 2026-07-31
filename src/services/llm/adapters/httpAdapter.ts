/**
 * HTTP LLM适配器
 * 统一的适配器，支持多个LLM提供商
 */
import { BaseLLMAdapter, LLMResponse, LLMConfig } from './base'

export interface ProviderConfig {
  name: string
  baseUrl: string
  model: string
  headers?: Record<string, string>
}

// 预设的提供商配置
export const PROVIDER_CONFIGS: Record<string, ProviderConfig> = {
  minimax: {
    name: 'MiniMax',
    baseUrl: 'https://api.minimax.chat/v1',
    model: 'MiniMax-Text-01'
  },
  qwen: {
    name: '通义千问',
    baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
    model: 'qwen-turbo'
  },
  ernie: {
    name: '文心一言',
    baseUrl: 'https://qianfan.baidubce.com/v2/chat/completions',
    model: 'ernie-4.0-8k-latest'
  },
  chatglm: {
    name: 'ChatGLM',
    baseUrl: 'https://open.bigmodel.cn/api/paas/v4',
    model: 'glm-4-flash'
  }
}

export class HTTPAdapter extends BaseLLMAdapter {
  private providerConfig: ProviderConfig

  constructor(provider: string, config: LLMConfig) {
    super(config)
    this.providerConfig = PROVIDER_CONFIGS[provider] || PROVIDER_CONFIGS.minimax
  }

  getModelName(): string {
    return this.providerConfig.name
  }

  async generate(prompt: string): Promise<LLMResponse> {
    const url = `${this.providerConfig.baseUrl}/chat/completions`

    try {
      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${this.config.apiKey}`,
        ...this.providerConfig.headers
      }

      const body: Record<string, any> = {
        model: this.providerConfig.model,
        messages: [
          {
            role: 'user',
            content: prompt
          }
        ],
        temperature: 0.7,
        max_tokens: 2048
      }

      const response = await fetch(url, {
        method: 'POST',
        headers,
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(30000) // 30秒超时
      })

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}))
        return {
          success: false,
          error: errorData.error?.message || `API错误: ${response.status}`
        }
      }

      const data = await response.json()

      if (data.choices && data.choices[0]?.message?.content) {
        return {
          success: true,
          content: data.choices[0].message.content
        }
      }

      return {
        success: false,
        error: '无效的响应格式'
      }
    } catch (err) {
      if (err instanceof Error && err.name === 'TimeoutError') {
        return {
          success: false,
          error: '请求超时，请检查网络连接'
        }
      }
      return {
        success: false,
        error: `请求失败: ${err}`
      }
    }
  }
}
