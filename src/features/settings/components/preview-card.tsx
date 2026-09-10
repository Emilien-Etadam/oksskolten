import type { ReactNode } from 'react'

interface PreviewCardProps {
  selected: boolean
  onClick: () => void
  label: string
  sizeClass?: string
  className?: string
  disabled?: boolean
  children: ReactNode
}

export function PreviewCard({
  selected,
  onClick,
  label,
  sizeClass = 'w-full h-24',
  className,
  disabled,
  children,
}: PreviewCardProps) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={`group flex flex-col items-center gap-1.5 select-none${className ? ` ${className}` : ''}${disabled ? ' opacity-40 cursor-not-allowed' : ''}`}
    >
      <div className={`${sizeClass} rounded-xl overflow-hidden border-2 transition-[border-color] ${
        selected ? 'border-accent' : 'card-selector'
      }`}>
        {children}
      </div>
      <span className={`text-xs ${selected ? 'text-accent font-medium' : 'text-muted'}`}>
        {label}
      </span>
    </button>
  )
}
