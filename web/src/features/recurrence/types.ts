import type { TaskSchedule } from '../tasks/types'
import type { EventSchedule } from '../events/types'
export type Kind = 'task' | 'event'
export type Schedule = TaskSchedule | EventSchedule
export const weekDays = ['monday','tuesday','wednesday','thursday','friday','saturday','sunday'] as const
export type WeekDay = typeof weekDays[number]
export interface Rule { frequency: 'daily' | 'weekly' | 'monthly' | 'yearly'; interval: number; weekDays?: WeekDay[]; timeZone?: string; end: { type: 'never' } | { type: 'until'; date: string } | { type: 'count'; count: number } }
export interface Content { title: string; description: string; location?: string; link?: string; schedule: Schedule }
export interface Definition extends Content { recurrence: Rule }
export interface Series extends Definition { kind: Kind; id: string; revision: number; createdAt: string; updatedAt: string }
export interface Occurrence extends Content { kind: Kind; seriesId: string; occurrenceDate: string; seriesRevision: number; isException: boolean; completedAt?: string | null }
export type Patch = Partial<Definition> & { completed?: boolean }
export const occurrenceID = (value: Occurrence) => `occurrence:${value.kind}:${value.seriesId}:${value.occurrenceDate}`
