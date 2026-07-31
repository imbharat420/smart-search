// Display formatting. TravelIQ prices are GBP per person, dates are en-GB.
// Render the output of money()/pct() with `tabular-nums` so figures line up in
// tables and cards.

export function money(n: number, currency = 'GBP'): string {
  const fractionDigits = Number.isInteger(n) ? 0 : 2
  return new Intl.NumberFormat('en-GB', {
    style: 'currency',
    currency,
    minimumFractionDigits: fractionDigits,
    maximumFractionDigits: fractionDigits,
  }).format(n)
}

export function nights(days: number): string {
  const count = Math.max(1, days - 1)
  return `${count} ${count === 1 ? 'night' : 'nights'}`
}

export function monthName(m: number): string {
  // Day 15 keeps the month stable whatever the timezone offset.
  return new Date(Date.UTC(2026, m - 1, 15)).toLocaleDateString('en-GB', { month: 'long' })
}

export function shortDate(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })
}

export function pct(n: number): string {
  // One decimal only when the figure is small enough for it to matter (4.3% vs 42%).
  return `${Math.round(n * 1000) / 10}%`
}
