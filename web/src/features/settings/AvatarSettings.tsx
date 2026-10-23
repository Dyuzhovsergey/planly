import { useEffect, useRef, useState } from 'react'
import { ApiError } from '../../shared/api/client'
import { UserAvatar } from '../../shared/ui/UserAvatar'
import { SuccessNotice } from '../../shared/ui/SuccessNotice'
import type { AuthEnvelope, User } from '../session/types'
import { avatarPresets, presetURL, type AvatarChange } from './avatar'

export function AvatarSettings({ user, onSave, onAuthenticationRequired }: { user: User; onSave: (change: AvatarChange) => Promise<AuthEnvelope>; onAuthenticationRequired: () => void }) {
  const fileInput = useRef<HTMLInputElement>(null)
  const [selection, setSelection] = useState<AvatarChange | null>(null)
  const [preview, setPreview] = useState<string>()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string>()
  const [notice, setNotice] = useState(false)
  useEffect(() => () => { if (preview) URL.revokeObjectURL(preview) }, [preview])
  function choose(value: AvatarChange | null) {
    setPreview(value?.type === 'upload' ? URL.createObjectURL(value.file) : undefined)
    setSelection(value); setError(undefined); setNotice(false)
  }
  async function save(change: AvatarChange) {
    if (busy) return
    setBusy(true); setError(undefined); setNotice(false)
    try { await onSave(change); setSelection(null); setPreview(undefined); setNotice(true) }
    catch (caught: unknown) {
      if (caught instanceof ApiError && caught.status === 401) { onAuthenticationRequired(); return }
      setError(caught instanceof ApiError && [413,415,422].includes(caught.status)
        ? 'Выберите корректный PNG или JPEG до 2 МиБ, не более 4096 пикселей по стороне и 8 млн пикселей.'
        : caught instanceof ApiError && caught.status === 403
          ? 'Сессия безопасности устарела. Обновите страницу.'
          : 'Не удалось обновить фото. Проверьте соединение и повторите попытку. Если ответ потерян, обновите страницу для проверки сохранённого изображения.')
    } finally { setBusy(false) }
  }
  const selectedPreset = selection?.type === 'preset' ? selection.presetId : null
  const source = selectedPreset ? presetURL(selectedPreset) : selection?.type === 'upload' ? preview : user.avatarUrl
  return <section className="planly-card mt-6 space-y-4 p-5 sm:p-6" aria-labelledby="avatar-heading" aria-busy={busy}>
    <h2 id="avatar-heading" className="text-lg font-semibold">Фото профиля</h2>
    <div className="flex items-center gap-4">
      <UserAvatar name={user.displayName || user.username} src={source} className="size-20 text-2xl" />
      <p className="text-sm leading-6 text-[var(--color-muted)]">Загрузите своё фото или выберите готовый аватар. Изображение появится слева от имени.</p>
    </div>
    <fieldset disabled={busy} className="min-w-0 space-y-4">
      <legend className="sr-only">Выбор изображения профиля</legend>
      <div className="grid max-w-sm grid-cols-5 gap-2" role="group" aria-label="Готовые аватары">
        {avatarPresets.map((preset) => <button key={preset.id} type="button" aria-label={preset.label} aria-pressed={selectedPreset === preset.id || (!selection && Boolean(user.avatarUrl?.endsWith(`v=${preset.id}`)))} onClick={() => choose({ type: 'preset', presetId: preset.id })} className="min-h-11 min-w-11 rounded-full border-2 border-transparent p-1 transition-colors hover:bg-[var(--color-surface-muted)] aria-pressed:border-[var(--color-accent-strong)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-focus)]">
          <img className="aspect-square w-full rounded-full object-cover" src={presetURL(preset.id)} alt="" loading="lazy" />
        </button>)}
      </div>
      <div>
        <label htmlFor="avatar-file" className="mb-2 block text-sm font-medium">Загрузить фото</label>
        <div className="planly-input flex min-h-11 min-w-0 flex-wrap items-center gap-3 p-2">
        <button type="button" className="planly-button-secondary min-h-11 shrink-0" onClick={() => fileInput.current?.click()}>Выбрать файл</button>
        <span className="min-w-0 break-all text-sm" role="status" aria-live="polite">{selection?.type === 'upload' ? selection.file.name : 'Файл не выбран'}</span>
        <input ref={fileInput} id="avatar-file" type="file" accept="image/png,image/jpeg" className="sr-only" tabIndex={-1} aria-describedby="avatar-hint" onChange={(event) => {
          const file = event.target.files?.[0]
          event.target.value = ''
          if (!file) return
          if (!['image/png','image/jpeg'].includes(file.type) || file.size > 2 * 1024 * 1024) {
            setError('Выберите PNG или JPEG размером до 2 МиБ.'); setNotice(false); return
          }
          choose({ type: 'upload', file })
        }} />
        </div>
        <p id="avatar-hint" className="mt-2 text-xs leading-5 text-[var(--color-muted)]">PNG/JPEG до 2 МиБ. Не более 4096 пикселей по стороне и 8 млн пикселей. Фото сохраняется в уменьшенном виде без метаданных. Изображения показываются в круге.</p>
      </div>
      <div className="flex flex-wrap gap-3">
        <button type="button" className="planly-button-primary min-h-11" disabled={!selection} onClick={() => { if (selection) void save(selection) }}>{busy ? 'Сохраняем…' : 'Сохранить фото'}</button>
        <button type="button" className="planly-button-secondary min-h-11" disabled={!selection} onClick={() => choose(null)}>Отменить выбор</button>
        <button type="button" className="planly-button-secondary min-h-11" disabled={!user.avatarUrl} onClick={() => void save({ type: 'delete' })}>Удалить фото</button>
      </div>
    </fieldset>
    {error && <p className="planly-error" role="alert">{error}</p>}
    {notice && <SuccessNotice>Фото профиля обновлено.</SuccessNotice>}
    <p className="text-xs text-[var(--color-muted)]">Фото сохраняется отдельно от остальных настроек. Без фото показывается первая буква имени.</p>
  </section>
}
