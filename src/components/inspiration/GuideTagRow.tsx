import { TagToggle } from './TagToggle'

interface GuideTagRowProps {
  tags: string[]
  active: string[]
  counts: Map<string, number>
  onToggle: (tag: string) => void
  onClear: () => void
}

export function GuideTagRow({ tags, active, counts, onToggle, onClear }: GuideTagRowProps) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <TagToggle label="All themes" active={active.length === 0} onClick={onClear} />
      {tags.map((tag) => (
        <TagToggle
          key={tag}
          label={tag}
          active={active.includes(tag)}
          count={counts.get(tag) ?? 0}
          onClick={() => onToggle(tag)}
        />
      ))}
    </div>
  )
}
