import { useState, useEffect, useRef, useCallback, useMemo, type ReactNode } from 'react'
import { useLocation } from 'react-router-dom'
import useSWR, { mutate as globalMutate } from 'swr'
import { useChat } from '../../hooks/use-chat'
import { fetcher } from '../../lib/fetcher'
import { useI18n, isMessageKey } from '../../lib/i18n'
import { ChatPanel } from './chat-panel'
import { ChatInputArea } from './chat-input-area'

interface ChatNewConversationProps {
  /** Conversation list, rendered below the input while no conversation is active */
  children: ReactNode
}

/**
 * New-conversation composer for the /chat tab.
 * Shows the prompt input and suggestion chips above the conversation list;
 * sending a message streams the new conversation in place.
 */
export function ChatNewConversation({ children }: ChatNewConversationProps) {
  const { t } = useI18n()
  const location = useLocation()
  const chatState = useChat()
  const { messages, streaming, sendMessage, reset } = chatState

  const [input, setInput] = useState('')

  // Re-navigating to /chat (sidebar, command palette) while a new conversation
  // is open returns to the list. The router location stays "/chat" in that case
  // (the URL below is swapped with replaceState), so only the key changes.
  const locationKeyRef = useRef(location.key)
  useEffect(() => {
    if (location.key !== locationKeyRef.current) {
      locationKeyRef.current = location.key
      reset()
    }
  }, [location.key, reset])

  const handleConversationCreated = useCallback((id: string) => {
    // replaceState instead of navigate: a real navigation would remount the
    // page and drop the still-streaming response
    window.history.replaceState(null, '', `/chat/${id}`)
    void globalMutate('/api/chat/conversations')
  }, [])

  // Suggestion chips — dynamic from API, fallback to static
  const { data: suggestionsData } = useSWR<{ suggestions: Array<{ key: string; params?: Record<string, string | number> }> }>(
    '/api/chat/suggestions',
    fetcher,
    { revalidateOnFocus: false, dedupingInterval: 60000 },
  )
  const suggestions = useMemo(() =>
    suggestionsData?.suggestions?.map(s => {
      const params = s.params ? Object.fromEntries(Object.entries(s.params).map(([k, v]) => [k, String(v)])) : undefined
      return { text: isMessageKey(s.key) ? t(s.key, params) : s.key, key: s.key }
    }) ?? [
      { text: t('chat.suggestion.home.recommend'), key: 'recommend' },
      { text: t('chat.suggestion.home.unread'), key: 'unread' },
      { text: t('chat.suggestion.home.trending'), key: 'trending' },
      { text: t('chat.suggestion.home.surprise'), key: 'surprise' },
      { text: t('chat.suggestion.home.digest'), key: 'digest' },
    ],
  [suggestionsData, t])

  const handleSend = () => {
    if (!input.trim() || streaming) return
    void sendMessage(input.trim())
    setInput('')
  }

  // A message was sent — show the conversation in place of the list
  if (messages.length > 0 || streaming) {
    return (
      <div className="h-[calc(100dvh-var(--header-height))]">
        <ChatPanel variant="full" chatState={chatState} onConversationCreated={handleConversationCreated} />
      </div>
    )
  }

  return (
    <div className="pt-2">
      <ChatInputArea
        variant="full"
        input={input}
        streaming={streaming}
        onInputChange={setInput}
        onSend={handleSend}
      />
      <div className="max-w-2xl mx-auto px-4 pb-1 flex flex-wrap justify-center gap-2">
        {suggestions.map((s) => (
          <button
            key={s.key}
            onClick={() => { void sendMessage(s.text, { suggestionKey: s.key }) }}
            className="px-3 py-1.5 rounded-full border border-border text-sm text-muted hover:text-text hover:border-text transition-colors select-none"
          >
            {s.text}
          </button>
        ))}
      </div>
      {children}
    </div>
  )
}
