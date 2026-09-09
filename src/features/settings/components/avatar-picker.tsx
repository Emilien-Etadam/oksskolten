import { useState, useRef, useEffect } from 'react'
import { RefreshCw } from 'lucide-react'
import { minidenticon } from 'minidenticons'

interface AvatarProps {
  seed: string | null
  name: string
  sizeClass?: string
  textClass?: string
}

export function Avatar({ seed, name, sizeClass = 'w-9 h-9', textClass = 'text-sm' }: AvatarProps) {
  const initial = (name || '?')[0].toUpperCase()

  if (seed) {
    const svg = minidenticon(seed)
    return (
      <span
        className={`${sizeClass} rounded-full bg-bg-avatar flex items-center justify-center shrink-0 select-none overflow-hidden [&>svg]:block [&>svg]:w-full [&>svg]:h-full`}
        dangerouslySetInnerHTML={{ __html: svg }}
      />
    )
  }

  return (
    <span className={`${sizeClass} rounded-full bg-bg-avatar flex items-center justify-center ${textClass} font-semibold text-muted shrink-0 select-none`}>
      {initial}
    </span>
  )
}

interface AvatarPickerProps {
  name: string
  currentSeed: string | null
  onSelect: (seed: string | null) => void
  sizeClass?: string
  textClass?: string
}

export function AvatarPicker({ name, currentSeed, onSelect, sizeClass = 'w-9 h-9', textClass = 'text-sm' }: AvatarPickerProps) {
  const [open, setOpen] = useState(false)
  const [offset, setOffset] = useState(0)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    function handleClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    function handleKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', handleClick)
    document.addEventListener('keydown', handleKey)
    return () => {
      document.removeEventListener('mousedown', handleClick)
      document.removeEventListener('keydown', handleKey)
    }
  }, [open])

  const candidates = Array.from({ length: 8 }, (_, i) => `${name}-${offset + i}`)

  return (
    <div ref={ref} className="relative select-none flex items-center">
      <button
        type="button"
        onClick={() => setOpen(prev => !prev)}
        className="relative group rounded-full"
      >
        <Avatar seed={currentSeed} name={name} sizeClass={sizeClass} textClass={textClass} />
        <span className="absolute inset-0 rounded-full bg-black/0 group-hover:bg-black/40 backdrop-blur-none group-hover:backdrop-blur-[1px] transition-all flex items-center justify-center opacity-0 group-hover:opacity-100">
          <RefreshCw size={16} className="text-white" />
        </span>
      </button>

      {open && (
        <div className="absolute left-0 top-full mt-2 bg-bg-card border border-border rounded-xl shadow-lg p-2 z-50">
          <div className="grid grid-cols-4 gap-1.5" style={{ width: '180px' }}>
            {/* Clear option: initial letter avatar */}
            <button
              type="button"
              onClick={() => { onSelect(null); setOpen(false) }}
              className={`w-10 h-10 rounded-lg flex items-center justify-center transition-colors hover:bg-hover ${
                currentSeed === null ? 'ring-2 ring-accent' : ''
              }`}
            >
              <Avatar seed={null} name={name} sizeClass="w-8 h-8" textClass="text-xs" />
            </button>

            {/* Identicon candidates */}
            {candidates.map(seed => (
              <button
                key={seed}
                type="button"
                onClick={() => { onSelect(seed); setOpen(false) }}
                className={`w-10 h-10 rounded-lg flex items-center justify-center transition-colors hover:bg-hover ${
                  currentSeed === seed ? 'ring-2 ring-accent' : ''
                }`}
              >
                <Avatar seed={seed} name={name} sizeClass="w-8 h-8" />
              </button>
            ))}

            {/* Refresh button */}
            <button
              type="button"
              onClick={() => setOffset(prev => prev + 8)}
              className="w-10 h-10 rounded-lg flex items-center justify-center text-muted hover:bg-hover hover:text-text transition-colors"
            >
              <RefreshCw size={16} />
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
