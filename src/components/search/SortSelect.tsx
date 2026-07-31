import { Select } from '../ui/select'

export const SORT_OPTIONS = [
  { value: 'relevance', label: 'Best match' },
  { value: 'price-asc', label: 'Price: low to high' },
  { value: 'price-desc', label: 'Price: high to low' },
  { value: 'rating', label: 'Traveller rating' },
  { value: 'duration', label: 'Shortest trip' },
]

export function sortLabel(value: string): string {
  return SORT_OPTIONS.find((option) => option.value === value)?.label ?? SORT_OPTIONS[0].label
}

interface SortSelectProps {
  value: string
  onChange: (value: string) => void
}

export function SortSelect({ value, onChange }: SortSelectProps) {
  return <Select label="Sort" value={value} onChange={onChange} options={SORT_OPTIONS} />
}
