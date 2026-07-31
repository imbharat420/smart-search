// Timestamps in the control panel are only ever read as "how fresh is this?", so
// they collapse to a relative phrase and fall back to a plain date after a week.

import { shortDate } from '../../lib/format'

export function sinceLabel(iso?: string): string {
  if (!iso) return 'never'

  const then = new Date(iso).getTime()
  if (Number.isNaN(then)) return iso

  const minutes = Math.max(0, Math.round((Date.now() - then) / 60_000))
  if (minutes < 1) return 'just now'
  if (minutes === 1) return '1 minute ago'
  if (minutes < 60) return `${minutes} minutes ago`

  const hours = Math.round(minutes / 60)
  if (hours === 1) return '1 hour ago'
  if (hours < 24) return `${hours} hours ago`

  const days = Math.round(hours / 24)
  if (days === 1) return 'yesterday'
  if (days < 7) return `${days} days ago`

  return shortDate(iso)
}
