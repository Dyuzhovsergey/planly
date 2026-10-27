export interface ApiProblem {
  type: string
  title: string
  status: number
  code: string
  errors?: Record<string, string[]>
}
