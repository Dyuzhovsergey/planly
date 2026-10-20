interface IconProps {
  className?: string
}

const common = {
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.8,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
  viewBox: '0 0 24 24',
  'aria-hidden': true,
}

export function CalendarIcon({ className = 'size-5' }: IconProps) {
  return (
    <svg {...common} className={className}>
      <path d="M7 3v3M17 3v3M4 9h16M5 5h14a1 1 0 0 1 1 1v14H4V6a1 1 0 0 1 1-1Z" />
    </svg>
  )
}

export function PlusIcon({ className = 'size-5' }: IconProps) {
  return (
    <svg {...common} className={className}>
      <path d="M12 5v14M5 12h14" />
    </svg>
  )
}

export function LogOutIcon({ className = 'size-5' }: IconProps) {
  return (
    <svg {...common} className={className}>
      <path d="M10 5H5v14h5M14 8l4 4-4 4M9 12h9" />
    </svg>
  )
}

export function ClockIcon({ className = 'size-5' }: IconProps) {
  return (
    <svg {...common} className={className}>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7v5l3 2" />
    </svg>
  )
}

export function CheckIcon({ className = 'size-5' }: IconProps) {
  return (
    <svg {...common} className={className}>
      <path d="m5 12 4 4L19 6" />
    </svg>
  )
}
