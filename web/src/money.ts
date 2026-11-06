// Shows whole cents as dollars, for example 1050 -> "10.50". No floating point math.
export function formatCents(cents: number): string {
  const whole = Math.floor(cents / 100)
  const rest = String(cents % 100).padStart(2, '0')
  return `${whole}.${rest}`
}

// Turns text like "12.5" into whole cents (1250). Returns null for anything that is not a
// positive amount with at most 2 decimals.
export function parseAmountToCents(input: string): number | null {
  const match = /^(\d{1,9})(?:\.(\d{1,2}))?$/.exec(input.trim())
  if (match === null) return null
  const whole = Number(match[1] ?? '0')
  const fraction = Number((match[2] ?? '').padEnd(2, '0'))
  const cents = whole * 100 + fraction
  return cents > 0 ? cents : null
}
