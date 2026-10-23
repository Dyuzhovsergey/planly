export interface BirthdayInput {
  name: string
  month: number
  day: number
  birthYear: number | null
  note: string
}

export interface Birthday extends BirthdayInput {
  id: string
  createdAt: string
  updatedAt: string
}

export interface BirthdayOccurrence {
  birthdayId: string
  name: string
  date: string
  age: number | null
}

export interface BirthdayRange { from: string; to: string }
