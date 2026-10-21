import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { PlanlyLogo } from './PlanlyLogo'

describe('PlanlyLogo', () => {
  it('renders the visible brand name and an optional tagline', () => {
    const { container } = render(<PlanlyLogo showTagline />)

    expect(screen.getByText('Planly')).toBeInTheDocument()
    expect(screen.getByText('Ваш день в порядке')).toBeInTheDocument()
    expect(container.querySelector('img')).toHaveAttribute('src', '/planly-logo.svg')
    expect(container.querySelector('img')).toHaveAttribute('alt', '')
  })
})
