import type { Message } from './types.js'
import { runAnthropicTurn } from './adapter-anthropic.js'
import { toWellFormedDeep, toWellFormedText } from '../../lib/text.js'

export type ChatSSEEvent =
  | { type: 'text_delta'; text: string }
  | { type: 'thinking_start' }
  | { type: 'thinking_end' }
  | { type: 'tool_use_start'; name: string; tool_use_id: string }
  | { type: 'tool_use_end'; name: string; tool_use_id: string }
  | { type: 'done'; usage: { input_tokens: number; output_tokens: number }; elapsed_ms?: number; model?: string }
  | { type: 'error'; error: string }

export interface RunChatTurnResult {
  allMessages: Message[]
  usage: { input_tokens: number; output_tokens: number }
}

export interface ChatTurnParams {
  messages: Message[]
  system: string
  model: string
  timeZone?: string
  onEvent: (event: ChatSSEEvent) => void
}

export async function runChatTurn(provider: string, rawParams: ChatTurnParams): Promise<RunChatTurnResult> {
  // Lone surrogates (e.g. a half emoji) are invalid Unicode and get rejected by some LLM APIs
  const params: ChatTurnParams = {
    ...rawParams,
    system: toWellFormedText(rawParams.system),
    messages: toWellFormedDeep(rawParams.messages),
  }
  if (provider === 'claude-code') {
    const { runClaudeCodeTurn } = await import('./adapter-claude-code.js')
    return runClaudeCodeTurn(params)
  }
  if (provider === 'ollama') {
    const { runOpenAITurn } = await import('./adapter-openai.js')
    const { getOllamaClient } = await import('../providers/llm/ollama.js')
    return runOpenAITurn(params, getOllamaClient())
  }
  if (provider === 'vllm') {
    const { runOpenAITurn } = await import('./adapter-openai.js')
    const { getVllmClient } = await import('../providers/llm/vllm.js')
    return runOpenAITurn(params, getVllmClient())
  }
  if (provider === 'openai') {
    const { runOpenAITurn } = await import('./adapter-openai.js')
    return runOpenAITurn(params)
  }
  if (provider === 'gemini') {
    const { runGeminiTurn } = await import('./adapter-gemini.js')
    return runGeminiTurn(params)
  }
  return runAnthropicTurn(params)
}
