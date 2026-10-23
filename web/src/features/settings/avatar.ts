export const avatarPresets = [
  { id: 'preset-1', label: 'Зелёный фон, очки' },
  { id: 'preset-2', label: 'Сиреневый фон, борода' },
  { id: 'preset-3', label: 'Розовый фон, длинные волосы' },
  { id: 'preset-4', label: 'Розовый фон, кудри' },
  { id: 'preset-5', label: 'Фиолетовый фон, очки' },
] as const
export type AvatarChange = { type: 'preset'; presetId: string } | { type: 'upload'; file: File } | { type: 'delete' }
export const presetURL = (id: string) => `/api/v1/me/avatar/presets/${id}`
