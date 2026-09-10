import { createLocalStorageHook } from './create-local-storage-hook'

export type DateMode = 'relative' | 'absolute'

const useHook = createLocalStorageHook<DateMode>('date-mode', 'relative', ['relative', 'absolute'])

export function useDateMode() {
  const [dateMode, setDateMode] = useHook()
  return { dateMode, setDateMode }
}
