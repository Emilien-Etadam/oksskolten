import { useState, useEffect } from 'react'
import { DEFAULT_KEY_BINDINGS, type KeyBindings } from '../use-keyboard-navigation'

const STORAGE_KEY = 'keybindings'

const PRINTABLE_RE = /^[!-~]$/

function isValidKeybindings(value: unknown): value is KeyBindings {
  if (typeof value !== 'object' || value === null) return false
  const obj = value as Record<string, unknown>
  return (
    typeof obj.next === 'string' && PRINTABLE_RE.test(obj.next) &&
    typeof obj.prev === 'string' && PRINTABLE_RE.test(obj.prev) &&
    typeof obj.bookmark === 'string' && PRINTABLE_RE.test(obj.bookmark) &&
    typeof obj.openExternal === 'string' && PRINTABLE_RE.test(obj.openExternal)
  )
}

function getStored(): KeyBindings {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return DEFAULT_KEY_BINDINGS
    const parsed = JSON.parse(raw)
    return isValidKeybindings(parsed) ? parsed : DEFAULT_KEY_BINDINGS
  } catch {
    return DEFAULT_KEY_BINDINGS
  }
}

export function useKeybindingsSetting() {
  const [keybindings, setKeybindingsState] = useState<KeyBindings>(getStored)

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(keybindings))
  }, [keybindings])

  return { keybindings, setKeybindings: setKeybindingsState }
}
