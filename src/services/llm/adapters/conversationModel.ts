import type { ConversationModel, ConversationRequest } from '../../../ai-conversation/projectConversation'
import { buildConversationSummaryInput, parseConversationIntentSummaryText, type ConversationSummaryGenerationRequest } from '../../../ai-conversation/conversationSummary'
import { buildPreparedConversationPrompt, isConversationPromptPrepared, prepareConversationPrompt, type ConversationPreparationOptions } from '../conversationPreparation'
import { sanitizeProviderError, type BaseLLMAdapter } from './base'

type ConversationCapableAdapter = Pick<BaseLLMAdapter, 'generate' | 'diagnostics'>

/** 将现有 provider adapter 接到项目级多轮对话 seam，不复制请求状态机。 */
export function createConversationModel(
  adapter: ConversationCapableAdapter,
  preparationOptions?: ConversationPreparationOptions,
): ConversationModel {
  return {
    diagnostics: () => adapter.diagnostics(),
    prepare: request => prepareConversationPrompt(request, preparationOptions),
    async summarize(request: ConversationSummaryGenerationRequest) {
      const response = await adapter.generate(buildConversationSummaryInput(request.previousSummary, request.turns), { signal: request.signal })
      if (!response.success || response.content === undefined) {
        return { success: false as const, error: sanitizeProviderError(response.error ?? '摘要请求失败'), kind: response.errorType ?? 'provider' }
      }
      const parsed = parseConversationIntentSummaryText(response.content)
      return parsed.ok ? { success: true as const, text: parsed.text } : { success: false as const, error: parsed.error, kind: 'provider' as const }
    },
    async respond(request: ConversationRequest) {
      const prepared = isConversationPromptPrepared(request)
        ? { ok: true as const, turns: request.turns, promptContext: request }
        : prepareConversationPrompt(request, preparationOptions)
      const diagnostics = adapter.diagnostics()
      if (!prepared.ok) {
        return { success: false as const, error: prepared.error, kind: 'invalid-response' as const, diagnostics }
      }
      const response = await adapter.generate(buildPreparedConversationPrompt(prepared.turns, prepared.promptContext), { signal: request.signal })
      const actualDiagnostics = adapter.diagnostics()
      if (!response.success || response.content === undefined) {
        return {
          success: false as const,
          error: sanitizeProviderError(response.error ?? '模型请求失败'),
          kind: response.errorType ?? 'provider',
          diagnostics: actualDiagnostics,
        }
      }
      return { success: true as const, content: response.content, diagnostics: actualDiagnostics }
    },
  }
}
