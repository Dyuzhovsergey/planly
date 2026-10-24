import { changeField } from '../../shared/ui/date-time-testing'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { useState } from 'react'
import { afterEach, expect, it, vi } from 'vitest'
import { RepeatPicker } from './RepeatPicker'
import { ruleDraft, type RuleDraft } from './rule'
import { TaskCreateForm } from '../tasks/TaskCreateForm'
import { EventDialog } from '../events/EventDialog'
import type { Rule } from './types'

afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.restoreAllMocks() })
function Harness({ initial }: { initial?: Rule }) {
  const [rule, setRule] = useState<RuleDraft>(() => ruleDraft('Europe/Moscow', initial))
  const [enabled, setEnabled] = useState(Boolean(initial))
  const [anchor, setAnchor] = useState('2026-10-26')
  return <><label>Дата якоря<input value={anchor} onChange={e => setAnchor(e.target.value)} /></label>
    <RepeatPicker value={rule} onChange={setRule} enabled={enabled} onEnabledChange={setEnabled} timed={false} anchor={anchor} />
    <output>{JSON.stringify({ enabled, rule })}</output></>
}

it('defaults to no repeat and keeps common presets compact, following the weekly anchor', () => {
  render(<Harness />)
  expect(screen.getByLabelText('Повтор')).toHaveValue('none')
  expect(screen.queryByLabelText('Раз в')).not.toBeInTheDocument()
  fireEvent.change(screen.getByLabelText('Повтор'), { target: { value: 'weekly' } })
  expect(screen.getByRole('status')).toHaveTextContent('monday')
  fireEvent.change(screen.getByLabelText('Дата якоря'), { target: { value: '2026-10-27' } })
  expect(screen.getByRole('status')).toHaveTextContent('tuesday')
  fireEvent.change(screen.getByLabelText('Повтор'), { target: { value: 'none' } })
  expect(screen.getByRole('status')).toHaveTextContent('"enabled":false')
})

it('applies custom choices only on Done and keeps the parent value on Cancel and Escape', () => {
  render(<Harness />)
  fireEvent.change(screen.getByLabelText('Повтор'), { target: { value: 'custom' } })
  fireEvent.change(screen.getByLabelText('Раз в'), { target: { value: '2' } })
  fireEvent.click(screen.getByRole('button', { name: 'Отмена' }))
  expect(screen.getByLabelText('Повтор')).toHaveValue('none')
  fireEvent.change(screen.getByLabelText('Повтор'), { target: { value: 'custom' } })
  fireEvent.change(screen.getByLabelText('Период'), { target: { value: 'weekly' } })
  fireEvent.click(screen.getByLabelText('Чт'))
  fireEvent.change(screen.getByLabelText('Раз в'), { target: { value: '2' } })
  fireEvent.click(screen.getByLabelText('После количества повторений'))
  fireEvent.change(screen.getByLabelText('Количество повторений'), { target: { value: '5' } })
  fireEvent.click(screen.getByRole('button', { name: 'Готово' }))
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  expect(screen.getByRole('status')).toHaveTextContent('"interval":"2"')
  expect(screen.getByRole('status')).toHaveTextContent('"end":"count"')
  expect(screen.getByLabelText('Повтор')).toHaveValue('custom')
  fireEvent.click(screen.getByRole('button', { name: 'Настроить повтор…' }))
  fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' })
  expect(screen.getByRole('status')).toHaveTextContent('"count":"5"')
})

it('loads existing monthly/yearly custom rules without silently replacing their interval or ending', () => {
  render(<Harness initial={{ frequency: 'yearly', interval: 2, end: { type: 'until', date: '2030-10-26' } }} />)
  expect(screen.getByLabelText('Повтор')).toHaveValue('custom')
  fireEvent.click(screen.getByRole('button', { name: 'Настроить повтор…' }))
  expect(screen.getByLabelText('Период')).toHaveValue('yearly')
  expect(screen.getByLabelText('Раз в')).toHaveValue(2)
  expect(screen.getByLabelText('Дата окончания')).toHaveTextContent('26 октября 2030 г., весь день')
  fireEvent.click(screen.getByLabelText('После количества повторений'))
  fireEvent.change(screen.getByLabelText('Количество повторений'), { target: { value: '0' } })
  fireEvent.click(screen.getByRole('button', { name: 'Готово' }))
  expect(screen.getByRole('dialog')).toBeInTheDocument()
  expect(screen.getByLabelText('Количество повторений')).toHaveAttribute('aria-invalid', 'true')
})

it.each(['monthly', 'yearly'])('creates a %s Task series directly from its preset without opening custom settings', async frequency => {
  const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ id: 'series', revision: 1 }), { status: 201 }))
  vi.stubGlobal('fetch', fetchMock)
  const saved = vi.fn()
  render(<TaskCreateForm csrfToken="csrf" timeZone="Europe/Moscow" onAuthenticationRequired={vi.fn()} onTaskCreated={vi.fn()} onSeriesCreated={saved} />)
  fireEvent.change(screen.getByLabelText('Название'), { target: { value: 'Платёж' } })
  fireEvent.click(screen.getByRole('radio', { name: 'Весь день' }))
  changeField(screen.getByLabelText('Дата'), { target: { value: '2026-01-31' } })
  fireEvent.change(screen.getByLabelText('Повтор'), { target: { value: frequency } })
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: 'Создать серию задач' }))
  await waitFor(() => expect(saved).toHaveBeenCalledOnce())
  expect(fetchMock.mock.calls[0][0]).toBe('/api/v1/task-series')
  expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toMatchObject({ schedule: { date: '2026-01-31' }, recurrence: { frequency, interval: 1, end: { type: 'never' } } })
})

it('keeps the Event form open when Escape closes custom settings and preserves its date/content', () => {
  const close = vi.fn()
  render(<EventDialog timeZone="Europe/Moscow" initialDate="2026-10-26" csrfToken="csrf" fallbackFocusRef={{ current: null }} onAuthenticationRequired={vi.fn()} onClose={close} onSaved={vi.fn()} onDeleted={vi.fn()} onSeriesCreated={vi.fn()} />)
  fireEvent.change(screen.getByLabelText('Название'), { target: { value: 'Мой черновик' } })
  fireEvent.change(screen.getByLabelText('Повтор'), { target: { value: 'custom' } })
  const dialogs = screen.getAllByRole('dialog')
  expect(dialogs).toHaveLength(2)
  fireEvent.keyDown(dialogs[1], { key: 'Escape' })
  expect(close).not.toHaveBeenCalled()
  expect(screen.getAllByRole('dialog')).toHaveLength(1)
  expect(screen.getByLabelText('Название')).toHaveValue('Мой черновик')
  expect(screen.getByLabelText('Повтор')).toHaveValue('none')
  fireEvent.change(screen.getByLabelText('Повтор'), { target: { value: 'custom' } })
  const custom = screen.getAllByRole('dialog')[1]
  fireEvent.change(within(custom).getByLabelText('Период'), { target: { value: 'yearly' } })
  fireEvent.click(within(custom).getByRole('button', { name: 'Готово' }))
  expect(screen.getByLabelText('Повтор')).toHaveValue('custom')
  expect(close).not.toHaveBeenCalled()
})
