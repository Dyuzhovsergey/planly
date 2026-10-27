import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { TaskBoard } from './TaskBoard'
import type { Task } from './types'

const task: Task = {
  id: 'tile-id', title: 'Задача для переноса', description: 'Описание плитки',
  schedule: { type: 'allDay', date: '2026-10-26' }, completed: false, completedAt: null,
  createdAt: '', updatedAt: '',
}
afterEach(cleanup)
function setup(options: { pendingTaskID?: string; statusFilter?: 'all' | 'active' } = {}) {
  const move = vi.fn(), edit = vi.fn(), remove = vi.fn()
  render(<TaskBoard tasks={[task]} statusFilter={options.statusFilter ?? 'all'} timeZone="Europe/Moscow" csrfToken="csrf"
    pendingTaskID={options.pendingTaskID ?? null} onAuthenticationRequired={vi.fn()} onEditTask={edit}
    onMoveTask={move} onTaskUpdated={vi.fn()} onDeleteTask={remove} />)
  let value = ''
  const dataTransfer = { effectAllowed: 'none', dropEffect: 'none', setData: (_type: string, next: string) => { value = next }, getData: () => value, setDragImage: vi.fn() }
  const tile = screen.getByText(task.title).closest('li')!
  return { tile, dataTransfer, move, edit, remove }
}

it.each(['title', 'description', 'date', 'action'])('starts the same tile drag from its %s without activating actions', area => {
  const { tile, dataTransfer, move, edit, remove } = setup()
  const source = area === 'title' ? screen.getByText(task.title)
    : area === 'description' ? screen.getByText(task.description)
      : area === 'date' ? tile.querySelector('.mt-3 span')!
        : screen.getByRole('button', { name: `Удалить задачу ${task.title}` })
  expect(tile).toHaveAttribute('draggable', 'true')
  fireEvent.dragStart(source, { dataTransfer })
  expect(dataTransfer.setDragImage).toHaveBeenCalledOnce()
  expect((dataTransfer.setDragImage.mock.calls[0][0] as HTMLElement).textContent).toBe(task.title)
  const completed = screen.getByRole('region', { name: 'Завершённые' })
  fireEvent.dragOver(completed, { dataTransfer })
  fireEvent.drop(completed, { dataTransfer })
  fireEvent.click(source)
  expect(move).toHaveBeenCalledExactlyOnceWith(task, true)
  expect(edit).not.toHaveBeenCalled()
  expect(remove).not.toHaveBeenCalled()
})

it('keeps ordinary pointer and keyboard actions available after a cancelled drag', () => {
  const { tile, dataTransfer, move, edit, remove } = setup()
  const title = screen.getByRole('button', { name: `Открыть редактирование задачи ${task.title}` })
  fireEvent.click(title)
  expect(edit).toHaveBeenCalledOnce()
  fireEvent.dragStart(tile, { dataTransfer })
  fireEvent.dragEnd(tile)
  fireEvent.click(title)
  expect(edit).toHaveBeenCalledOnce()
  fireEvent.pointerDown(title)
  fireEvent.click(title)
  expect(edit).toHaveBeenCalledTimes(2)
  const deletion = screen.getByRole('button', { name: `Удалить задачу ${task.title}` })
  fireEvent.keyDown(deletion, { key: 'Enter' })
  fireEvent.click(deletion)
  expect(remove).toHaveBeenCalledExactlyOnceWith(task)
  expect(move).not.toHaveBeenCalled()
})

it.each([{ pendingTaskID: task.id }, { statusFilter: 'active' as const }])('disables tile dragging when a move is unavailable: %j', options => {
  const { tile, dataTransfer, move } = setup(options)
  expect(tile).toHaveAttribute('draggable', 'false')
  fireEvent.dragStart(tile, { dataTransfer })
  expect(dataTransfer.getData()).toBe('')
  expect(move).not.toHaveBeenCalled()
})

it('accepts a drop in the opposite column body and clears its highlight when leaving', () => {
  const { tile, dataTransfer, move } = setup()
  const completed = screen.getByRole('region', { name: 'Завершённые' })
  fireEvent.dragStart(tile, { dataTransfer })
  fireEvent.dragOver(completed, { dataTransfer })
  expect(completed).toHaveClass('planly-task-column--over')
  fireEvent.dragLeave(completed, { relatedTarget: document.body })
  expect(completed).not.toHaveClass('planly-task-column--over')
  fireEvent.dragOver(completed, { dataTransfer })
  fireEvent.drop(completed.querySelector('ul')!, { dataTransfer })
  expect(move).toHaveBeenCalledExactlyOnceWith(task, true)
  expect(completed).not.toHaveClass('planly-task-column--over')
})
