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

export function TasksIcon({ className = 'size-5' }: IconProps) {
  return (
    <svg {...common} className={className}>
      <path d="M9 6h11M9 12h11M9 18h11M4 6h.01M4 12h.01M4 18h.01" />
    </svg>
  )
}

export function ChevronLeftIcon({ className = 'size-5' }: IconProps) {
  return (
    <svg {...common} className={className}>
      <path d="m14 6-6 6 6 6" />
    </svg>
  )
}

export function ChevronRightIcon({ className = 'size-5' }: IconProps) {
  return (
    <svg {...common} className={className}>
      <path d="m10 6 6 6-6 6" />
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

export function ReopenIcon({ className = 'size-5' }: IconProps) {
  return (
    <svg {...common} className={className}>
      <path d="M4 9V4m0 0h5M4 4l4 4a7 7 0 1 1-2 7" />
    </svg>
  )
}

export function TrashIcon({ className = 'size-5' }: IconProps) {
  return (
    <svg {...common} className={className}>
      <path d="M4 7h16M9 7V4h6v3M7 7l1 13h8l1-13M10 11v5M14 11v5" />
    </svg>
  )
}

export function PencilIcon({ className = 'size-5' }: IconProps) {
  return (
    <svg {...common} className={className}>
      <path d="m4 20 4.2-1 10.4-10.4a2.1 2.1 0 0 0-3-3L5.2 16 4 20ZM13.8 7.2l3 3" />
    </svg>
  )
}

export function DragHandleIcon({ className = 'size-5' }: IconProps) {
  return (
    <svg {...common} className={className}>
      <circle cx="8" cy="7" r="1" fill="currentColor" stroke="none" />
      <circle cx="16" cy="7" r="1" fill="currentColor" stroke="none" />
      <circle cx="8" cy="12" r="1" fill="currentColor" stroke="none" />
      <circle cx="16" cy="12" r="1" fill="currentColor" stroke="none" />
      <circle cx="8" cy="17" r="1" fill="currentColor" stroke="none" />
      <circle cx="16" cy="17" r="1" fill="currentColor" stroke="none" />
    </svg>
  )
}

export function EventIcon({ className = 'size-5' }: IconProps) {
  return <svg {...common} className={className}><rect x="3" y="5" width="18" height="16" rx="3" /><path d="M7 3v4m10-4v4M3 10h18m-9 3v3l2 1" /></svg>
}

export function BirthdayIcon({ className = 'size-5' }: IconProps) {
  return <svg {...common} className={className}><path d="M4 12h16v8H4zM3 8h18v4H3zM12 8v12M12 8H8a3 3 0 1 1 3-3l1 3Zm0 0h4a3 3 0 1 0-3-3l-1 3Z" /></svg>
}

export function SettingsIcon({ className = 'size-5' }: IconProps) {
  return <svg {...common} className={className}><path d="m9 3-1 3-3 1v4l2 1-1 3 3 3 3-1 2 2 3-2v-3l3-2-1-4-3-1-1-3Z" /><circle cx="12" cy="11" r="3" /></svg>
}

export function NotesIcon({className='size-5'}:IconProps) {return <svg {...common} className={className}><path d="M5 3h14v18H5zM8 7h8M8 11h8M8 15h5"/></svg>}
