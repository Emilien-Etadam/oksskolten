import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { LocaleContext } from '../../lib/i18n'
import { FeedAiFilterDialog } from './feed-ai-filter-dialog'

function renderDialog(props: Partial<Parameters<typeof FeedAiFilterDialog>[0]> = {}) {
  const onSave = props.onSave ?? vi.fn()
  const onOpenChange = props.onOpenChange ?? vi.fn()
  render(
    <LocaleContext.Provider value={{ locale: 'en', setLocale: vi.fn() }}>
      <FeedAiFilterDialog
        feedName="r/selfhosted"
        value={null}
        open
        onOpenChange={onOpenChange}
        onSave={onSave}
        {...props}
      />
    </LocaleContext.Provider>,
  )
  return { onSave, onOpenChange }
}

describe('FeedAiFilterDialog', () => {
  it('names the feed it filters', () => {
    renderDialog()
    expect(screen.getByText(/r\/selfhosted/)).toBeTruthy()
  })

  it('prefills the existing criterion', () => {
    renderDialog({ value: 'Only home automation' })
    expect((screen.getByRole('textbox') as HTMLTextAreaElement).value).toBe('Only home automation')
  })

  it('saves the trimmed criterion and closes', async () => {
    const { onSave, onOpenChange } = renderDialog()

    fireEvent.change(screen.getByRole('textbox'), { target: { value: '  self-hosting only  ' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }))

    await waitFor(() => expect(onSave).toHaveBeenCalledWith('self-hosting only'))
    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false))
  })

  it('saves null when the criterion is cleared, disabling the filter', async () => {
    const { onSave } = renderDialog({ value: 'something' })

    fireEvent.change(screen.getByRole('textbox'), { target: { value: '   ' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }))

    await waitFor(() => expect(onSave).toHaveBeenCalledWith(null))
  })

  it('closes without saving on cancel', () => {
    const { onSave, onOpenChange } = renderDialog()

    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(onSave).not.toHaveBeenCalled()
    expect(onOpenChange).toHaveBeenCalledWith(false)
  })
})
