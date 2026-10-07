/**
 * Built-in provider directory. It stores public provider metadata and API defaults;
 * requests are implemented by Mod Studio's own protocol adapters.
 */
export type LLMProtocol = 'openai-chat' | 'openai-responses' | 'anthropic-messages' | 'gemini' | 'ollama'
export type ApiKeyPlacement = 'bearer' | 'api-key' | 'x-api-key' | 'query' | 'none'

export interface LLMProviderInfo {
  id: string
  name: string
  baseUrl: string
  protocol: LLMProtocol
  keyPlacement: ApiKeyPlacement
  requiresApiKey: boolean
  website: string
  description: string
  defaultModel?: string
  unavailableReason?: string
}

export const LLM_PROVIDERS: LLMProviderInfo[] = [
  { id: "minimax", name: "MiniMax", baseUrl: "https://api.minimax.chat/v1", protocol: "openai-chat", keyPlacement: "bearer", requiresApiKey: true, website: "https://platform.minimaxi.com/", description: "MiniMax 对话模型", defaultModel: "MiniMax-Text-01" },
  { id: "qwen", name: "通义千问", baseUrl: "https://dashscope.aliyuncs.com/compatible-mode/v1", protocol: "openai-chat", keyPlacement: "bearer", requiresApiKey: true, website: "https://qwen.ai/", description: "阿里云百炼 OpenAI 兼容 API", defaultModel: "qwen-turbo" },
  { id: "ernie", name: "文心一言", baseUrl: "https://qianfan.baidubce.com/v2", protocol: "openai-chat", keyPlacement: "bearer", requiresApiKey: true, website: "https://cloud.baidu.com/", description: "百度千帆 OpenAI 兼容 API", defaultModel: "ernie-4.0-8k-latest" },
  { id: "chatglm", name: "ChatGLM", baseUrl: "https://open.bigmodel.cn/api/paas/v4", protocol: "openai-chat", keyPlacement: "bearer", requiresApiKey: true, website: "https://open.bigmodel.cn/", description: "智谱 OpenAI 兼容 API", defaultModel: "glm-4-flash" },
  { id: "cherryin", name: "CherryIN", baseUrl: "https://open.cherryin.net", protocol: "openai-chat", keyPlacement: "bearer", requiresApiKey: true, website: "https://open.cherryin.ai", description: "CherryIN - AI model provider" },
  { id: "silicon", name: "Silicon", baseUrl: "https://api.siliconflow.cn/v1", protocol: "openai-chat", keyPlacement: "bearer", requiresApiKey: true, website: "https://www.siliconflow.cn", description: "Silicon - AI model provider" },
  { id: "aihubmix", name: "AiHubMix", baseUrl: "https://aihubmix.com/v1", protocol: "openai-chat", keyPlacement: "bearer", requiresApiKey: true, website: "https://aihubmix.com", description: "AiHubMix - AI model provider" },
  { id: "ovms", name: "OpenVINO Model Server", baseUrl: "http://localhost:8000/v3/", protocol: "openai-chat", keyPlacement: "bearer", requiresApiKey: false, website: "https://www.intel.com/content/www/us/en/developer/tools/openvino-toolkit/overview.html", description: "OpenVINO Model Server - AI model provider" },
  { id: "ocoolai", name: "ocoolAI", baseUrl: "https://api.ocoolai.com", protocol: "openai-chat", keyPlacement: "bearer", requiresApiKey: true, website: "https://one.ocoolai.com/", description: "ocoolAI - AI model provider" },
  { id: "zhipu", name: "ZhiPu", baseUrl: "https://open.bigmodel.cn/api/paas/v4/", protocol: "openai-chat", keyPlacement: "bearer", requiresApiKey: true, website: "https://open.bigmodel.cn/", description: "ZhiPu - AI model provider" },
  { id: "deepseek", name: "deepseek", baseUrl: "https://api.deepseek.com", protocol: "openai-chat", keyPlacement: "bearer", requiresApiKey: true, website: "https://deepseek.com/", description: "deepseek - AI model provider" },
  { id: "alayanew", name: "AlayaNew", baseUrl: "https://deepseek.alayanew.com", protocol: "openai-chat", keyPlacement: "bearer", requiresApiKey: true, website: "https://www.alayanew.com/", description: "AlayaNew - AI model provider" },
  { id: "dmxapi", name: "DMXAPI", baseUrl: "https://www.dmxapi.cn", protocol: "openai-chat", keyPlacement: "bearer", requiresApiKey: true, website: "https://www.dmxapi.cn/", description: "DMXAPI - AI model provider" },
  { id: "aionly", name: "AIOnly", baseUrl: "https://api.aiionly.com", protocol: "openai-chat", keyPlacement: "bearer", requiresApiKey: true, website: "https://www.aiionly.com", description: "AIOnly - AI model provider" },
  { id: "burncloud", name: "BurnCloud", baseUrl: "https://ai.burncloud.com", protocol: "openai-chat", keyPlacement: "bearer", requiresApiKey: true, website: "https://ai.burncloud.com/", description: "BurnCloud - AI model provider" },
  { id: "302ai", name: "302.AI", baseUrl: "https://api.302.ai", protocol: "openai-chat", keyPlacement: "bearer", requiresApiKey: true, website: "https://302.ai", description: "302.AI - AI model provider" },
  { id: "lanyun", name: "LANYUN", baseUrl: "https://maas-api.lanyun.net", protocol: "openai-chat", keyPlacement: "bearer", requiresApiKey: true, website: "https://maas.lanyun.net", description: "LANYUN - AI model provider" },
  { id: "ph8", name: "PH8", baseUrl: "https://ph8.co", protocol: "openai-chat", keyPlacement: "bearer", requiresApiKey: true, website: "https://ph8.co", description: "PH8 - AI model provider" },
  { id: "sophnet", name: "SophNet", baseUrl: "https://www.sophnet.com/api/open-apis/v1", protocol: "openai-chat", keyPlacement: "bearer", requiresApiKey: true, website: "https://sophnet.com", description: "SophNet - AI model provider" },
  { id: "ppio", name: "PPIO", baseUrl: "https://api.ppinfra.com/v3/openai/", protocol: "openai-chat", keyPlacement: "bearer", requiresApiKey: true, website: "https://ppio.com/", description: "PPIO - AI model provider" },
  { id: "qiniu", name: "Qiniu", baseUrl: "https://api.qnaigc.com", protocol: "openai-chat", keyPlacement: "bearer", requiresApiKey: true, website: "https://qiniu.com", description: "Qiniu - AI model provider" },
  { id: "openrouter", name: "OpenRouter", baseUrl: "https://openrouter.ai/api/v1/", protocol: "openai-chat", keyPlacement: "bearer", requiresApiKey: true, website: "https://openrouter.ai/", description: "OpenRouter - AI model provider" },
  { id: "ollama", name: "Ollama", baseUrl: "http://localhost:11434", protocol: "ollama", keyPlacement: "none", requiresApiKey: false, website: "https://ollama.com/", description: "Ollama - AI model provider" },
  { id: "radeon-cloud", name: "AMD GPU Cloud", baseUrl: "https://developer.amd.com.cn/radeon/v1", protocol: "openai-chat", keyPlacement: "bearer", requiresApiKey: true, website: "https://developer.amd.com.cn/radeon/", description: "AMD GPU Cloud - AI model provider" },
  { id: "tokendance", name: "TokenDance", baseUrl: "https://tokendance.space/gateway", protocol: "openai-chat", keyPlacement: "bearer", requiresApiKey: true, website: "https://tokendance.space", description: "TokenDance - AI model provider" },
  { id: "new-api", name: "New API", baseUrl: "http://localhost:3000/v1", protocol: "openai-chat", keyPlacement: "bearer", requiresApiKey: true, website: "https://docs.newapi.pro/", description: "New API - AI model provider" },
  { id: "lmstudio", name: "LM Studio", baseUrl: "http://localhost:1234", protocol: "openai-chat", keyPlacement: "bearer", requiresApiKey: false, website: "https://lmstudio.ai/", description: "LM Studio - AI model provider" },
  { id: "anthropic", name: "Anthropic", baseUrl: "https://api.anthropic.com", protocol: "anthropic-messages", keyPlacement: "x-api-key", requiresApiKey: true, website: "https://anthropic.com/", description: "Anthropic - AI model provider" },
  { id: "claude-code", name: "Claude Code", baseUrl: "https://api.anthropic.com", protocol: "anthropic-messages", keyPlacement: "x-api-key", requiresApiKey: false, unavailableReason: "OAuth / CLI 登录，当前 API Key 模式无法直连", website: "https://www.anthropic.com/claude-code", description: "Claude Code - AI model provider" },
  { id: "openai-codex", name: "OpenAI Codex", baseUrl: "https://chatgpt.com/backend-api/codex", protocol: "openai-chat", keyPlacement: "bearer", requiresApiKey: false, unavailableReason: "OAuth / CLI 登录，当前 API Key 模式无法直连", website: "https://openai.com/codex", description: "OpenAI Codex - AI model provider" },
  { id: "grok-cli", name: "Grok CLI", baseUrl: "https://cli-chat-proxy.grok.com/v1", protocol: "openai-chat", keyPlacement: "bearer", requiresApiKey: false, unavailableReason: "OAuth / CLI 登录，当前 API Key 模式无法直连", website: "https://x.ai", description: "Grok CLI - AI model provider" },
  { id: "omlx", name: "oMLX", baseUrl: "http://localhost:8000", protocol: "openai-chat", keyPlacement: "bearer", requiresApiKey: false, website: "https://omlx.ai", description: "oMLX - AI model provider" },
  { id: "openai", name: "OpenAI", baseUrl: "https://api.openai.com", protocol: "openai-responses", keyPlacement: "bearer", requiresApiKey: true, website: "https://openai.com/", description: "OpenAI - AI model provider" },
  { id: "opencode", name: "OpenCode Go", baseUrl: "https://opencode.ai/zen/go/v1", protocol: "openai-chat", keyPlacement: "bearer", requiresApiKey: true, website: "https://opencode.ai", description: "OpenCode Go - AI model provider" },
  { id: "azure-openai", name: "Azure OpenAI", baseUrl: "", protocol: "openai-chat", keyPlacement: "api-key", requiresApiKey: true, website: "https://azure.microsoft.com/en-us/products/ai-services/openai-service", description: "Azure OpenAI - AI model provider" },
  { id: "gemini", name: "Gemini", baseUrl: "https://generativelanguage.googleapis.com", protocol: "gemini", keyPlacement: "query", requiresApiKey: true, website: "https://gemini.google.com/", description: "Gemini - AI model provider" },
  { id: "vertexai", name: "VertexAI", baseUrl: "", protocol: "gemini", keyPlacement: "query", requiresApiKey: true, unavailableReason: "需配置 Vertex 项目/区域端点和 API 凭据；当前没有专用 IAM 适配器", website: "https://cloud.google.com/vertex-ai", description: "VertexAI - AI model provider" },
  { id: "copilot", name: "Github Copilot", baseUrl: "https://api.githubcopilot.com/", protocol: "openai-chat", keyPlacement: "bearer", requiresApiKey: true, unavailableReason: "需配置 Copilot 兼容 Token 和服务商要求的请求头", website: "https://github.com/features/copilot", description: "Github Copilot - AI model provider" },
  { id: "moonshot", name: "Moonshot AI", baseUrl: "https://api.moonshot.cn", protocol: "openai-chat", keyPlacement: "bearer", requiresApiKey: true, website: "https://www.moonshot.cn/", description: "Moonshot AI - AI model provider" },
  { id: "moonshot-global", name: "Moonshot", baseUrl: "https://api.moonshot.ai", protocol: "openai-chat", keyPlacement: "bearer", requiresApiKey: true, website: "https://www.moonshot.ai/", description: "Moonshot - AI model provider" },
  { id: "baichuan", name: "BAICHUAN AI", baseUrl: "https://api.baichuan-ai.com", protocol: "openai-chat", keyPlacement: "bearer", requiresApiKey: true, website: "https://www.baichuan-ai.com/", description: "BAICHUAN AI - AI model provider" },
  { id: "dashscope", name: "Bailian", baseUrl: "https://dashscope.aliyuncs.com/compatible-mode/v1/", protocol: "openai-chat", keyPlacement: "bearer", requiresApiKey: true, website: "https://www.aliyun.com/product/bailian", description: "Bailian - AI model provider" },
  { id: "stepfun", name: "StepFun", baseUrl: "https://api.stepfun.com", protocol: "openai-chat", keyPlacement: "bearer", requiresApiKey: true, website: "https://platform.stepfun.com/", description: "StepFun - AI model provider" },
  { id: "doubao", name: "doubao", baseUrl: "https://ark.cn-beijing.volces.com/api/v3/", protocol: "openai-chat", keyPlacement: "bearer", requiresApiKey: true, website: "https://console.volcengine.com/ark/", description: "doubao - AI model provider" },
  { id: "groq", name: "Groq", baseUrl: "https://api.groq.com/openai", protocol: "openai-chat", keyPlacement: "bearer", requiresApiKey: true, website: "https://groq.com/", description: "Groq - AI model provider" },
  { id: "together", name: "Together", baseUrl: "https://api.together.ai", protocol: "openai-chat", keyPlacement: "bearer", requiresApiKey: true, website: "https://www.together.ai", description: "Together - AI model provider" },
  { id: "fireworks", name: "Fireworks", baseUrl: "https://api.fireworks.ai/inference", protocol: "openai-chat", keyPlacement: "bearer", requiresApiKey: true, website: "https://fireworks.ai/", description: "Fireworks - AI model provider" },
  { id: "nvidia", name: "nvidia", baseUrl: "https://integrate.api.nvidia.com", protocol: "openai-chat", keyPlacement: "bearer", requiresApiKey: true, website: "https://build.nvidia.com/explore/discover", description: "nvidia - AI model provider" },
  { id: "grok", name: "Grok", baseUrl: "https://api.x.ai/v1", protocol: "openai-responses", keyPlacement: "bearer", requiresApiKey: true, website: "https://x.ai/", description: "Grok - AI model provider" },
  { id: "mistral", name: "Mistral", baseUrl: "https://api.mistral.ai", protocol: "openai-chat", keyPlacement: "bearer", requiresApiKey: true, website: "https://mistral.ai", description: "Mistral - AI model provider" },
  { id: "jina", name: "Jina", baseUrl: "https://api.jina.ai", protocol: "openai-chat", keyPlacement: "bearer", requiresApiKey: true, website: "https://jina.ai", description: "Jina - AI model provider" },
  { id: "perplexity", name: "Perplexity", baseUrl: "https://api.perplexity.ai/", protocol: "openai-chat", keyPlacement: "bearer", requiresApiKey: true, website: "https://perplexity.ai/", description: "Perplexity - AI model provider" },
  { id: "modelscope", name: "ModelScope", baseUrl: "https://api-inference.modelscope.cn/v1/", protocol: "openai-chat", keyPlacement: "bearer", requiresApiKey: true, website: "https://modelscope.cn", description: "ModelScope - AI model provider" },
  { id: "xirang", name: "Xirang", baseUrl: "https://wishub-x1.ctyun.cn", protocol: "openai-chat", keyPlacement: "bearer", requiresApiKey: true, website: "https://www.ctyun.cn", description: "Xirang - AI model provider" },
  { id: "tokenhub", name: "TokenHub", baseUrl: "https://tokenhub.tencentmaas.com/v1", protocol: "openai-chat", keyPlacement: "bearer", requiresApiKey: true, website: "https://cloud.tencent.com/product/tokenhub", description: "TokenHub - AI model provider" },
  { id: "baidu-cloud", name: "Baidu Cloud", baseUrl: "https://qianfan.baidubce.com/v2/", protocol: "openai-chat", keyPlacement: "bearer", requiresApiKey: true, website: "https://cloud.baidu.com/", description: "Baidu Cloud - AI model provider" },
  { id: "gpustack", name: "GPUStack", baseUrl: "", protocol: "openai-chat", keyPlacement: "bearer", requiresApiKey: false, website: "https://gpustack.ai/", description: "GPUStack - AI model provider" },
  { id: "voyageai", name: "VoyageAI", baseUrl: "https://api.voyageai.com", protocol: "openai-chat", keyPlacement: "bearer", requiresApiKey: true, website: "https://www.voyageai.com/", description: "VoyageAI - AI model provider" },
  { id: "aws-bedrock", name: "AWS Bedrock", baseUrl: "", protocol: "anthropic-messages", keyPlacement: "bearer", requiresApiKey: true, unavailableReason: "需配置 Bedrock 区域 API 地址和对应请求路径/协议", website: "https://aws.amazon.com/bedrock/", description: "AWS Bedrock - AI model provider" },
  { id: "poe", name: "Poe", baseUrl: "https://api.poe.com/v1/", protocol: "openai-chat", keyPlacement: "bearer", requiresApiKey: true, website: "https://poe.com/", description: "Poe - AI model provider" },
  { id: "longcat", name: "LongCat", baseUrl: "https://api.longcat.chat/openai", protocol: "openai-chat", keyPlacement: "bearer", requiresApiKey: true, website: "https://longcat.chat", description: "LongCat - AI model provider" },
  { id: "huggingface", name: "Hugging Face", baseUrl: "https://router.huggingface.co/v1/", protocol: "openai-chat", keyPlacement: "bearer", requiresApiKey: true, website: "https://huggingface.co/", description: "Hugging Face - AI model provider" },
  { id: "gateway", name: "Vercel AI Gateway", baseUrl: "https://ai-gateway.vercel.sh/v1/ai", protocol: "openai-chat", keyPlacement: "bearer", requiresApiKey: true, website: "https://vercel.com/ai-gateway", description: "Vercel AI Gateway - AI model provider" },
  { id: "cerebras", name: "Cerebras AI", baseUrl: "https://api.cerebras.ai/v1", protocol: "openai-chat", keyPlacement: "bearer", requiresApiKey: true, website: "https://www.cerebras.ai", description: "Cerebras AI - AI model provider" },
  { id: "mimo", name: "Xiaomi MiMo", baseUrl: "https://api.xiaomimimo.com", protocol: "openai-chat", keyPlacement: "bearer", requiresApiKey: true, website: "https://mimo.mi.com/", description: "Xiaomi MiMo - AI model provider" },
  { id: "zai", name: "zai", baseUrl: "https://api.z.ai/api/paas/v4/", protocol: "openai-chat", keyPlacement: "bearer", requiresApiKey: true, website: "https://z.ai", description: "zai - AI model provider" },
  { id: "minimax-global", name: "minimax-global", baseUrl: "https://api.minimax.io/v1/", protocol: "openai-chat", keyPlacement: "bearer", requiresApiKey: true, website: "https://platform.minimax.io/", description: "minimax-global - AI model provider" },
]

export function getProviderPreset(id: string): LLMProviderInfo | undefined {
  return LLM_PROVIDERS.find(provider => provider.id === id)
}
