import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { SegmentedControl } from './SegmentedControl'

afterEach(cleanup)

describe('SegmentedControl', () => {
  it('keeps the selection controlled and follows externally restored state', () => {
    const onValueChange = vi.fn()
    const options = [{ value: 'active', label: 'Активные' }, { value: 'completed', label: 'Завершённые' }]
    const { rerender } = render(<SegmentedControl value="active" options={options} onValueChange={onValueChange} label="Фильтр" />)
    const group = screen.getByRole('group', { name: 'Фильтр' })
    fireEvent.click(within(group).getByRole('button', { name: 'Завершённые' }))
    expect(onValueChange).toHaveBeenCalledExactlyOnceWith('completed')
    expect(within(group).getByRole('button', { name: 'Активные' })).toHaveAttribute('aria-pressed', 'true')

    rerender(<SegmentedControl value="completed" options={options} onValueChange={onValueChange} label="Фильтр" />)
    expect(within(group).getByRole('button', { name: 'Завершённые' })).toHaveAttribute('aria-pressed', 'true')
    expect(within(group).getByRole('button', { name: 'Активные' })).toHaveAttribute('aria-pressed', 'false')
    fireEvent.click(within(group).getByRole('button', { name: 'Завершённые' }))
    expect(onValueChange).toHaveBeenCalledTimes(1)
  })
})
