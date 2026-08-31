import { parseConversationDocument, type ConversationDocumentV1, type ConversationDocumentParseResult } from './conversationDocument'

export interface ConversationFilePort {
  readFile(path: string): Promise<string | null>
  writeFile(path: string, content: string): Promise<boolean>
  rename(from: string, to: string): Promise<boolean>
  mkdir(path: string): Promise<boolean>
  remove(path: string): Promise<boolean>
}

export type ConversationLoadResult =
  | { status: 'missing' }
  | { status: 'loaded'; document: ConversationDocumentV1 }
  | { status: 'quarantined'; reason: string; path: string }

export interface ConversationRepository {
  load(projectPath: string): Promise<ConversationLoadResult>
  save(projectPath: string, document: ConversationDocumentV1): Promise<{ ok: true } | { ok: false; error: string }>
}

const directory = (projectPath: string) => `${projectPath}/.modstudio/ai`
const activePath = (projectPath: string) => `${directory(projectPath)}/conversation.json`

export function createConversationRepository(files: ConversationFilePort, now: () => number = Date.now): ConversationRepository {
  return {
    async load(projectPath) {
      const path = activePath(projectPath)
      const content = await files.readFile(path)
      if (content === null) return { status: 'missing' }
      let parsed: ConversationDocumentParseResult
      try {
        parsed = parseConversationDocument(JSON.parse(content))
      } catch {
        parsed = { ok: false, reason: 'JSON 损坏', raw: content }
      }
      if (parsed.ok) return { status: 'loaded', document: parsed.document }
      const quarantinePath = `${path}.quarantine-${now()}`
      if (!await files.rename(path, quarantinePath)) return { status: 'quarantined', reason: `${parsed.reason}；隔离失败`, path }
      return { status: 'quarantined', reason: parsed.reason, path: quarantinePath }
    },

    async save(projectPath, document) {
      const parsed = parseConversationDocument(document)
      if (!parsed.ok || document.projectPath !== projectPath) return { ok: false, error: parsed.ok ? '项目路径不匹配' : parsed.reason }
      if (!await files.mkdir(directory(projectPath))) return { ok: false, error: '无法创建对话目录' }
      const path = activePath(projectPath)
      const temporary = `${path}.tmp`
      const content = JSON.stringify(document, null, 2)
      if (!await files.writeFile(temporary, content)) return { ok: false, error: '无法写入临时文件' }
      if (!await files.rename(temporary, path)) {
        await files.remove(temporary)
        return { ok: false, error: '无法原子替换对话文档' }
      }
      const readBack = await files.readFile(path)
      try {
        if (readBack === null || !parseConversationDocument(JSON.parse(readBack)).ok) return { ok: false, error: '保存后读回校验失败' }
      } catch {
        return { ok: false, error: '保存后读回校验失败' }
      }
      return { ok: true }
    },
  }
}
