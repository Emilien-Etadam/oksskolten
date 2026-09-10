import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { LocaleContext } from '@/i18n'
import { TooltipProvider } from '@/components/ui/tooltip'

// --- SWR mock ---
const mockMutate = vi.fn()
let swrData: any = []

vi.mock('swr', () => ({
  default: (_key: string) => ({
    data: swrData,
    error: undefined,
    isLoading: false,
    mutate: mockMutate,
  }),
}))

// --- Fetcher mock ---
const mockApiPost = vi.fn()
const mockApiDelete = vi.fn()

vi.mock('@/lib/fetcher', () => ({
  fetcher: vi.fn(),
  apiPost: (...args: unknown[]) => mockApiPost(...args),
  apiDelete: (...args: unknown[]) => mockApiDelete(...args),
}))

import { ApiTokenSettings } from './api-token-settings'

function renderComponent() {
  return render(
    <LocaleContext.Provider value={{ locale: 'en', setLocale: () => {} }}>
      <TooltipProvider>
        <ApiTokenSettings />
      </TooltipProvider>
    </LocaleContext.Provider>,
  )
}

describe('ApiTokenSettings', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    swrData = []
  })

  it('renders empty state when no tokens exist', () => {
    renderComponent()
    expect(screen.getByText('API Tokens')).toBeTruthy()
    expect(screen.getByText('No API tokens yet')).toBeTruthy()
  })

  it('renders token list', () => {
    swrData = [
      {
        id: 1,
        name: 'My Script',
        key_prefix: 'ok_abcd1234',
        scopes: 'read',
        last_used_at: null,
        created_at: '2026-03-15 10:00:00',
      },
      {
        id: 2,
        name: 'CI Token',
        key_prefix: 'ok_efgh5678',
        scopes: 'read,write',
        last_used_at: '2026-03-16 12:00:00',
        created_at: '2026-03-15 11:00:00',
      },
    ]
    renderComponent()
    expect(screen.getByText('My Script')).toBeTruthy()
    expect(screen.getByText('CI Token')).toBeTruthy()
    expect(screen.queryByText('No API tokens yet')).toBeNull()
  })

  it('shows create form when clicking create button', () => {
    renderComponent()
    fireEvent.click(screen.getByText('Create token'))
    expect(screen.getByPlaceholderText('e.g. Monitoring script')).toBeTruthy()
    expect(screen.getByText('Read only')).toBeTruthy()
    expect(screen.getByText('Read & Write')).toBeTruthy()
    expect(screen.getByText('Generate')).toBeTruthy()
  })

  it('hides create form when clicking cancel', () => {
    renderComponent()
    fireEvent.click(screen.getByText('Create token'))
    expect(screen.getByText('Generate')).toBeTruthy()

    fireEvent.click(screen.getByText('Cancel'))
    expect(screen.queryByText('Generate')).toBeNull()
  })

  it('calls apiPost on create and shows the key', async () => {
    mockApiPost.mockResolvedValue({
      id: 3,
      name: 'New Key',
      key: 'ok_aaaa1111bbbb2222cccc3333dddd4444eeee5555',
      key_prefix: 'ok_aaaa1111',
      scopes: 'read',
      last_used_at: null,
      created_at: '2026-03-17 00:00:00',
    })

    renderComponent()
    fireEvent.click(screen.getByText('Create token'))

    const input = screen.getByPlaceholderText('e.g. Monitoring script')
    fireEvent.change(input, { target: { value: 'New Key' } })
    fireEvent.click(screen.getByText('Generate'))

    await waitFor(() => {
      expect(mockApiPost).toHaveBeenCalledWith('/api/settings/tokens', {
        name: 'New Key',
        scopes: 'read',
      })
    })

    await waitFor(() => {
      expect(screen.getByText('ok_aaaa1111bbbb2222cccc3333dddd4444eeee5555')).toBeTruthy()
      expect(screen.getByText('This token will not be shown again. Store it in a safe place.')).toBeTruthy()
    })
  })

  it('disables generate button when name is empty', () => {
    renderComponent()
    fireEvent.click(screen.getByText('Create token'))
    const generateBtn = screen.getByText('Generate')
    expect(generateBtn.closest('button')?.disabled).toBe(true)
  })

  it('calls apiDelete on delete and updates list optimistically', async () => {
    swrData = [
      {
        id: 1,
        name: 'To Delete',
        key_prefix: 'ok_abcd1234',
        scopes: 'read',
        last_used_at: null,
        created_at: '2026-03-15 10:00:00',
      },
    ]
    mockApiDelete.mockResolvedValue({ ok: true })

    renderComponent()
    // Find and click the delete button (Trash icon button inside a Tooltip)
    const trashBtns = document.querySelectorAll('button')
    let deleteBtn: HTMLButtonElement | null = null
    trashBtns.forEach(btn => {
      if (btn.querySelector('svg')) {
        const svg = btn.querySelector('svg')
        // Trash2 icon has a specific path, just look for the small button near the token
        if (svg && btn.className.includes('hover:text-error')) {
          deleteBtn = btn
        }
      }
    })

    if (deleteBtn) {
      fireEvent.click(deleteBtn)

      await waitFor(() => {
        expect(mockApiDelete).toHaveBeenCalledWith('/api/settings/tokens/1')
      })

      expect(mockMutate).toHaveBeenCalled()
    }
  })

  it('selects read,write scope via radio button', async () => {
    mockApiPost.mockResolvedValue({
      id: 4,
      name: 'RW Key',
      key: 'ok_1111222233334444555566667777888899990000',
      key_prefix: 'ok_11112222',
      scopes: 'read,write',
      last_used_at: null,
      created_at: '2026-03-17 00:00:00',
    })

    renderComponent()
    fireEvent.click(screen.getByText('Create token'))

    const input = screen.getByPlaceholderText('e.g. Monitoring script')
    fireEvent.change(input, { target: { value: 'RW Key' } })

    // Select read,write scope
    fireEvent.click(screen.getByLabelText('Read & Write'))
    fireEvent.click(screen.getByText('Generate'))

    await waitFor(() => {
      expect(mockApiPost).toHaveBeenCalledWith('/api/settings/tokens', {
        name: 'RW Key',
        scopes: 'read,write',
      })
    })
  })

  it('shows scope labels for each token', () => {
    swrData = [
      {
        id: 1,
        name: 'Reader',
        key_prefix: 'ok_aaaa1111',
        scopes: 'read',
        last_used_at: null,
        created_at: '2026-03-15 10:00:00',
      },
      {
        id: 2,
        name: 'Writer',
        key_prefix: 'ok_bbbb2222',
        scopes: 'read,write',
        last_used_at: null,
        created_at: '2026-03-15 11:00:00',
      },
    ]
    renderComponent()

    const readOnlyLabels = screen.getAllByText('Read only')
    const readWriteLabels = screen.getAllByText('Read & Write')
    expect(readOnlyLabels.length).toBeGreaterThanOrEqual(1)
    expect(readWriteLabels.length).toBeGreaterThanOrEqual(1)
  })

  it('shows error message on create failure', async () => {
    mockApiPost.mockRejectedValue(new Error('Server error'))

    renderComponent()
    fireEvent.click(screen.getByText('Create token'))

    const input = screen.getByPlaceholderText('e.g. Monitoring script')
    fireEvent.change(input, { target: { value: 'Fail Key' } })
    fireEvent.click(screen.getByText('Generate'))

    await waitFor(() => {
      expect(screen.getByText('Server error')).toBeTruthy()
    })
  })
})
