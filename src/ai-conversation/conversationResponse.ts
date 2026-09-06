export interface ConversationQuickReply {
  id: string
  label: string
}

export interface ConversationResponseV1 {
  schemaVersion: 1
  text: string
  quickReplies: ConversationQuickReply[]
  proposals: []
}

export type ConversationResponseParseResult =
  | { ok: true; value: ConversationResponseV1 }
  | { ok: false; error: string }

const EXACT_KEYS = ['proposals', 'quickReplies', 'schemaVersion', 'text']

export function parseConversationResponse(input: unknown): ConversationResponseParseResult {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    return { ok: false, error: '响应必须是 JSON 对象' }
  }
  const value = input as Record<string, unknown>
  const keys = Object.keys(value).sort()
  if (keys.length !== EXACT_KEYS.length || keys.some((key, index) => key !== EXACT_KEYS[index])) {
    return { ok: false, error: '响应包含缺失或未知字段' }
  }
  if (value.schemaVersion !== 1) return { ok: false, error: '不支持的响应版本' }
  if (typeof value.text !== 'string') return { ok: false, error: 'text 必须是字符串' }
  if (!Array.isArray(value.quickReplies) || value.quickReplies.length > 4) {
    return { ok: false, error: 'quickReplies 必须包含 0 到 4 项' }
  }
  const ids = new Set<string>()
  const quickReplies: ConversationQuickReply[] = []
  for (const candidate of value.quickReplies) {
    if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) {
      return { ok: false, error: 'quick reply 格式无效' }
    }
    const reply = candidate as Record<string, unknown>
    const replyKeys = Object.keys(reply).sort()
    if (replyKeys.length !== 2 || replyKeys[0] !== 'id' || replyKeys[1] !== 'label') {
      return { ok: false, error: 'quick reply 包含缺失或未知字段' }
    }
    if (typeof reply.id !== 'string' || !reply.id.trim() || typeof reply.label !== 'string' || !reply.label.trim()) {
      return { ok: false, error: 'quick reply 的 id 和 label 不能为空' }
    }
    const id = reply.id.trim()
    const label = reply.label.trim()
    if (ids.has(id)) return { ok: false, error: 'quick reply ID 必须唯一' }
    ids.add(id)
    quickReplies.push({ id, label })
  }
  if (!Array.isArray(value.proposals) || value.proposals.length !== 0) {
    return { ok: false, error: '当前版本尚不接受 Card 提案' }
  }
  const text = value.text.trim()
  if (!text && quickReplies.length === 0) return { ok: false, error: '回复正文和快捷回答不能同时为空' }
  return { ok: true, value: { schemaVersion: 1, text, quickReplies, proposals: [] } }
}

export function parseConversationResponseText(content: string): ConversationResponseParseResult {
  try {
    const fenced = content.trim().match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i)
    return parseConversationResponse(JSON.parse(fenced ? fenced[1] : content))
  } catch {
    return { ok: false, error: '模型没有返回有效 JSON' }
  }
}
