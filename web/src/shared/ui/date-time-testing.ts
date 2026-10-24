import { fireEvent, within } from '@testing-library/react'

// Exercise the same visible controls used by a person, including the optional
// manual date entry. Other ordinary form fields still use their native change.
export function changeField(element: HTMLElement, event: { target: { value: string } }) {
  if (!element.classList.contains('planly-inline-picker')) return fireEvent.change(element, event)
  const field = within(element)
  const expand = field.queryByRole('button', { name: 'Выбрать другую дату' })
  if (expand) fireEvent.click(expand)
  const [date, time] = event.target.value.split('T')
  fireEvent.change(field.getByLabelText('Дата вручную'), { target: { value: date } })
  if (time !== undefined) fireEvent.change(field.getByLabelText('Точное время'), { target: { value: time } })
}
