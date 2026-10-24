import { useState } from 'react'
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { DateTimeField } from './DateTimeField'
import { changeField } from './date-time-testing'
import { TaskCreateForm } from '../../features/tasks/TaskCreateForm'

afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.useRealTimers(); vi.unstubAllGlobals() })
function Field({ initial = '2026-10-24T14:37', zone = 'Europe/Moscow', timed = true, disabled = false, change = vi.fn() } = {}) {
  const [value, setValue] = useState(initial)
  const [withTime, setWithTime] = useState(timed)
  return <><DateTimeField id="date" label="Расписание" value={value}
    timed={withTime} disabled={disabled} timeZone={zone}
    onChange={next => { setValue(next); change(next) }}
    onModeChange={(mode, next) => { setWithTime(mode); setValue(next); change(next) }} /><output data-testid="value">{value}</output></>
}

describe('inline DateTimeField', () => {
  it('shows the complete component immediately without another modal or a date-time text field', () => {
    render(<Field />)
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Выбрать другую дату' })).toBeInTheDocument()
    expect(screen.getByRole('group', { name: 'Часы' })).toBeInTheDocument()
    expect(screen.getByRole('group', { name: 'Минуты' })).toBeInTheDocument()
    expect(screen.getByLabelText('Точное время')).toHaveValue('14:37')
    expect(screen.getByLabelText('Расписание')).toHaveTextContent('24 октября 2026 г., 14:37')
    expect(screen.queryByRole('button', { name: 'Готово' })).not.toBeInTheDocument()
  })
  it('updates the parent form draft directly through visible manual controls', () => {
    const change = vi.fn(); render(<Field change={change} />)
    changeField(screen.getByLabelText('Расписание'), { target: { value: '2026-10-25T08:07' } })
    expect(change).toHaveBeenLastCalledWith('2026-10-25T08:07')
    expect(screen.getByTestId('value')).toHaveTextContent('2026-10-25T08:07')
  })
  it('uses the account time zone for Today across midnight and year boundaries', () => {
    vi.useFakeTimers(); vi.setSystemTime(new Date('2026-12-31T12:30:00Z'))
    render(<Field initial="" zone="Pacific/Kiritimati" />)
    fireEvent.click(screen.getByRole('button', { name: /суббота, 2 января 2027/ }))
    expect(screen.getByTestId('value')).toHaveTextContent('2027-01-02T09:00')
  })
  it('navigates December/January and selects February 29 without UTC conversion', () => {
    render(<Field initial="2027-12-31" timed={false} />)
    fireEvent.click(screen.getByRole('button', { name: 'Выбрать другую дату' }))
    fireEvent.click(screen.getByRole('button', { name: 'Следующий месяц' }))
    expect(screen.getByText(/январь 2028/)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Следующий месяц' }))
    fireEvent.click(screen.getByRole('button', { name: /вторник, 29 февраля 2028/ }))
    expect(screen.getByTestId('value')).toHaveTextContent('2028-02-29')
  })
  it('keeps minute precision and supports wheel keyboard/scroll and invalid exact input', () => {
    vi.useFakeTimers(); render(<Field />)
    const hours = screen.getByRole('group', { name: 'Часы' })
    fireEvent.keyDown(hours, { key: 'ArrowDown' })
    expect(screen.getByLabelText('Точное время')).toHaveValue('15:37')
    const minutes = screen.getByRole('group', { name: 'Минуты' })
    minutes.scrollTop = 43 * 44; fireEvent.scroll(minutes)
    expect(screen.getByLabelText('Точное время')).toHaveValue('15:43')
    act(() => vi.advanceTimersByTime(150))
    fireEvent.change(screen.getByLabelText('Точное время'), { target: { value: '25:99' } })
    expect(screen.getByRole('alert')).toHaveTextContent('00:00 до 23:59')
    fireEvent.change(screen.getByLabelText('Точное время'), { target: { value: '00:07' } })
    expect(screen.getByTestId('value')).toHaveTextContent('2026-10-24T00:07')
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })
  it('switches all-day mode directly and restores time mode', () => {
    render(<Field />)
    fireEvent.click(screen.getByRole('button', { name: 'Весь день' }))
    expect(screen.queryByLabelText('Точное время')).not.toBeInTheDocument()
    expect(screen.getByTestId('value')).toHaveTextContent('2026-10-24')
    fireEvent.click(screen.getByRole('button', { name: 'Весь день' }))
    expect(screen.getByTestId('value')).toHaveTextContent('2026-10-24T09:00')
  })
  it('disables every input when busy and handles an invalid time zone', () => {
    const view = render(<Field disabled />)
    expect(screen.getByRole('button', { name: 'Выбрать другую дату' })).toBeDisabled()
    expect(screen.getByLabelText('Точное время')).toBeDisabled()
    view.rerender(<Field zone="invalid-zone" />)
    expect(screen.getByText(/Укажите корректную часовую зону/)).toBeInTheDocument()
  })
  it('does not silently select a day when a blank form opens', () => {
    render(<Field initial="" />)
    expect(screen.getByTestId('value')).toBeEmptyDOMElement()
    expect(screen.getByText('Выберите день')).toBeInTheDocument()
    expect(screen.getAllByRole('button', { pressed: true })).toHaveLength(2)
  })
  it('integrates with task creation and retains DST validation and title draft', () => {
    render(<TaskCreateForm timeZone="Europe/Berlin" csrfToken="csrf" onTaskCreated={vi.fn()} onAuthenticationRequired={vi.fn()} />)
    fireEvent.change(screen.getByLabelText('Название'), { target: { value: 'Встреча' } })
    changeField(screen.getByRole('group', { name: 'Дата и время' }), { target: { value: '2026-03-29T02:30' } })
    fireEvent.click(screen.getByRole('button', { name: 'Создать задачу' }))
    expect(screen.getByText('Укажите корректные дату и время.')).toBeInTheDocument()
    expect(screen.getByLabelText('Название')).toHaveValue('Встреча')
    const picker = within(screen.getByRole('group', { name: 'Дата и время' }))
    fireEvent.click(picker.getByRole('button', { name: 'Весь день' }))
    expect(screen.getByLabelText('Дата')).toHaveTextContent('29 марта 2026 г., весь день')
    expect(screen.getByRole('radio', { name: 'Весь день' })).toBeChecked()
  })
})
