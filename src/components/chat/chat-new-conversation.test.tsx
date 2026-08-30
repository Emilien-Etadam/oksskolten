import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { MemoryRouter, useNavigate } from 'react-router-dom'
import { LocaleContext } from '../../lib/i18n'
import { ChatNewConversation } from './chat-new-conversation'

let mockChatState: {
  messages: Array<{ role: string; text: string }>
  conversationId: string | null
  streaming: boolean
  thinking: boolean
  activeTool: null
  error: null
  sendMessage: ReturnType<typeof vi.fn>
  loadConversation: ReturnType<typeof vi.fn>
  reset: ReturnType<typeof vi.fn>
}

vi.mock('../../hooks/use-chat', () => ({
  useChat: () => mockChatState,
}))

vi.mock('./chat-panel', () => ({
  ChatPanel: ({ onConversationCreated }: { onConversationCreated?: (id: string) => void }) => (
    <div data-testid="chat-panel">
      <button onClick={() => onConversationCreated?.('conv-new')}>simulate-created</button>
    </div>
  ),
}))

const mockMutate = vi.fn()
vi.mock('swr', () => ({
  default: () => ({ data: undefined }),
  mutate: (...args: unknown[]) => mockMutate(...args),
}))

function NavigateProbe() {
  const navigate = useNavigate()
  return <button onClick={() => { void navigate('/chat') }}>renav</button>
}

function renderComposer() {
  return render(
    <LocaleContext.Provider value={{ locale: 'en', setLocale: vi.fn() }}>
      <MemoryRouter initialEntries={['/chat']}>
        <ChatNewConversation>
          <div data-testid="conversation-list" />
        </ChatNewConversation>
        <NavigateProbe />
      </MemoryRouter>
    </LocaleContext.Provider>,
  )
}

describe('ChatNewConversation', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockChatState = {
      messages: [],
      conversationId: null,
      streaming: false,
      thinking: false,
      activeTool: null,
      error: null,
      sendMessage: vi.fn(),
      loadConversation: vi.fn(),
      reset: vi.fn(),
    }
  })

  it('renders the input, suggestion chips, and the list when idle', () => {
    renderComposer()
    expect(screen.getByPlaceholderText('Ask anything about your articles...')).toBeTruthy()
    expect(screen.getByText('What should I read today?')).toBeTruthy()
    expect(screen.getByTestId('conversation-list')).toBeTruthy()
    expect(screen.queryByTestId('chat-panel')).toBeNull()
  })

  it('sends the trimmed input on Enter and clears it', () => {
    renderComposer()
    const textarea = screen.getByPlaceholderText('Ask anything about your articles...')
    fireEvent.change(textarea, { target: { value: '  hello  ' } })
    fireEvent.keyDown(textarea, { key: 'Enter' })
    expect(mockChatState.sendMessage).toHaveBeenCalledWith('hello')
    expect((textarea as HTMLTextAreaElement).value).toBe('')
  })

  it('sends a suggestion with its key when a chip is clicked', () => {
    renderComposer()
    fireEvent.click(screen.getByText('What should I read today?'))
    expect(mockChatState.sendMessage).toHaveBeenCalledWith(
      'What should I read today?',
      { suggestionKey: 'recommend' },
    )
  })

  it('shows the conversation instead of the list once a message exists', () => {
    mockChatState.messages = [{ role: 'user', text: 'hi' }]
    renderComposer()
    expect(screen.getByTestId('chat-panel')).toBeTruthy()
    expect(screen.queryByTestId('conversation-list')).toBeNull()
    expect(screen.queryByPlaceholderText('Ask anything about your articles...')).toBeNull()
  })

  it('resets the chat when the user re-navigates to /chat', () => {
    renderComposer()
    expect(mockChatState.reset).not.toHaveBeenCalled()
    fireEvent.click(screen.getByText('renav'))
    expect(mockChatState.reset).toHaveBeenCalledTimes(1)
  })

  it('swaps the URL and refreshes the list when a conversation is created', () => {
    mockChatState.messages = [{ role: 'user', text: 'hi' }]
    renderComposer()
    fireEvent.click(screen.getByText('simulate-created'))
    expect(window.location.pathname).toBe('/chat/conv-new')
    expect(mockMutate).toHaveBeenCalledWith('/api/chat/conversations')
  })
})
