import { describe, expect, it } from 'vitest'

import { matchesTaskSearch } from './task-search'

const task = { title: 'Позвонить врачу', description: 'Уточнить кабинет [12]' }

describe('matchesTaskSearch', () => {
  it('matches title and description ignoring case and outer whitespace', () => {
    expect(matchesTaskSearch(task, '  ВРАЧУ ')).toBe(true)
    expect(matchesTaskSearch(task, 'КАБИНЕТ')).toBe(true)
    expect(matchesTaskSearch(task, 'нет совпадений')).toBe(false)
  })

  it('treats an empty query as no filter and searches literal characters', () => {
    expect(matchesTaskSearch(task, '  ')).toBe(true)
    expect(matchesTaskSearch(task, '[12]')).toBe(true)
    expect(matchesTaskSearch(task, '.*')).toBe(false)
  })

  it('normalizes equivalent Unicode text and keeps fields separate', () => {
    expect(matchesTaskSearch({ title: 'Cafe\u0301', description: '' }, 'CAFÉ')).toBe(true)
    expect(matchesTaskSearch(task, 'врачу Уточнить')).toBe(false)
  })
})
