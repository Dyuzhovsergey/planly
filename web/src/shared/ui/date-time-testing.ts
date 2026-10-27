import { fireEvent, within } from '@testing-library/react'

// Exercise the same visible controls used by a person, including the optional
// manual date entry and Kinetics comboboxes. Text fields use native change.
export function changeField(element: HTMLElement, event: { target: { value: string } }) {
  if (element.getAttribute('role') === 'combobox' && element.tagName === 'BUTTON') {
    fireEvent.click(element)
    const list = document.getElementById(element.getAttribute('aria-controls') ?? '')
    const option = list && Array.from(list.querySelectorAll<HTMLElement>('[role="option"]')).find(node => node.dataset.value === event.target.value)
    if (!option) throw new Error(`Missing option: ${event.target.value}`)
    return fireEvent.click(option)
  }
  if (!element.classList.contains('planly-inline-picker')) return fireEvent.change(element, event)
  const field = within(element)
  const expand = field.queryByRole('button', { name: 'Выбрать другую дату' })
  if (expand) fireEvent.click(expand)
  const [date, time] = event.target.value.split('T')
  fireEvent.change(field.getByLabelText('Дата вручную'), { target: { value: date } })
  if (time !== undefined) fireEvent.change(field.getByLabelText('Точное время'), { target: { value: time } })
}
