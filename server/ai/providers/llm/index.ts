import type { LLMMessageParams, LLMProvider } from './provider.js'
import { toWellFormedText } from '../../../lib/text.js'
import { anthropicProvider } from './anthropic.js'
import { geminiProvider } from './gemini.js'
import { openaiProvider } from './openai.js'
import { claudeCodeProvider } from './claude-code.js'
import { ollamaProvider } from './ollama.js'
import { vllmProvider } from './vllm.js'

const providers = new Map<string, LLMProvider>()

providers.set('anthropic', anthropicProvider)
providers.set('gemini', geminiProvider)
providers.set('openai', openaiProvider)
providers.set('claude-code', claudeCodeProvider)
providers.set('ollama', ollamaProvider)
providers.set('vllm', vllmProvider)

// Lone surrogates (e.g. a half emoji) are invalid Unicode and get rejected by some LLM APIs
function sanitizeParams(params: LLMMessageParams): LLMMessageParams {
  return {
    ...params,
    messages: params.messages.map(m => ({ ...m, content: toWellFormedText(m.content) })),
    systemInstruction: params.systemInstruction === undefined ? undefined : toWellFormedText(params.systemInstruction),
  }
}

function withWellFormedText(provider: LLMProvider): LLMProvider {
  return {
    ...provider,
    createMessage: params => provider.createMessage(sanitizeParams(params)),
    streamMessage: (params, onText) => provider.streamMessage(sanitizeParams(params), onText),
  }
}

export function getProvider(name: string): LLMProvider {
  const provider = providers.get(name)
  if (!provider) throw new Error(`Unknown LLM provider: ${name}`)
  return withWellFormedText(provider)
}
