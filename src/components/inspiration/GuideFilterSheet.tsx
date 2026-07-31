import { Button } from '../ui/button'
import { Select } from '../ui/select'
import { Sheet } from '../ui/sheet'
import { Switch } from '../ui/switch'
import { TagToggle } from './TagToggle'
import type { GuideFilters } from './guideFilters'
import { DURATION_BANDS, EMPTY_FILTERS, toBand, toggleTag } from './guideFilters'

interface GuideFilterSheetProps {
  open: boolean
  onClose: () => void
  tags: string[]
  authors: string[]
  filters: GuideFilters
  matchCount: number
  onApply: (next: GuideFilters) => void
}

export function GuideFilterSheet({
  open,
  onClose,
  tags,
  authors,
  filters,
  matchCount,
  onApply,
}: GuideFilterSheetProps) {
  const authorOptions = [
    { value: '', label: 'Any author' },
    ...authors.map((author) => ({ value: author, label: author })),
  ]

  return (
    <Sheet open={open} onClose={onClose} title="Filter guides" side="right">
      {/* Every control applies immediately, so the count on the footer button and
          the grid behind the sheet stay in step with each other. */}
      <div className="space-y-7 px-5 py-6">
        <fieldset>
          <legend className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Themes
          </legend>
          <div className="mt-3 flex flex-wrap gap-2">
            {tags.map((tag) => (
              <TagToggle
                key={tag}
                label={tag}
                active={filters.tags.includes(tag)}
                onClick={() => onApply({ ...filters, tags: toggleTag(filters.tags, tag) })}
              />
            ))}
          </div>
          <p className="mt-3 text-xs text-muted-foreground">
            Guides must carry every theme you pick.
          </p>
        </fieldset>

        <Select
          label="Length"
          value={filters.duration}
          onChange={(value) => onApply({ ...filters, duration: toBand(value) })}
          options={DURATION_BANDS}
          className="w-full justify-between"
        />

        <Select
          label="Author"
          value={filters.author}
          onChange={(value) => onApply({ ...filters, author: value })}
          options={authorOptions}
          className="w-full justify-between"
        />

        <Switch
          label="Only guides I have saved"
          checked={filters.savedOnly}
          onChange={(checked) => onApply({ ...filters, savedOnly: checked })}
        />
      </div>

      <div className="sticky bottom-0 flex items-center gap-3 border-t bg-background px-5 py-4">
        <Button variant="outline" onClick={() => onApply(EMPTY_FILTERS)} className="flex-1">
          Reset
        </Button>
        <Button onClick={onClose} className="flex-1 tabular-nums">
          {matchCount === 1 ? 'Show 1 guide' : `Show ${matchCount} guides`}
        </Button>
      </div>
    </Sheet>
  )
}
