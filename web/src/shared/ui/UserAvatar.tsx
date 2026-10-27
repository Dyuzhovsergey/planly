import { useState } from 'react'

export function UserAvatar({ name, src, className = 'size-9' }: { name: string; src?: string; className?: string }) {
  const [failedURL, setFailedURL] = useState<string>()
  return <span aria-hidden="true" className={`grid shrink-0 place-items-center overflow-hidden rounded-full bg-[var(--color-surface-muted)] text-[var(--color-accent-strong)] ${className}`}>
    {src && src !== failedURL ? <img className="size-full object-cover" src={src} alt="" onError={() => setFailedURL(src)} /> : Array.from(name)[0]?.toLocaleUpperCase('ru')}
  </span>
}
