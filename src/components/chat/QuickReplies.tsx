import { SkipForward } from 'lucide-react'
import type { PlanSlot, QuickReply, QuickReplyGroup } from '../../types'
import { cn } from '../../lib/utils'

interface QuickRepliesProps {
  group: QuickReplyGroup
  onPick: (reply: QuickReply) => void
  disabled?: boolean
  answered?: boolean
}

// Reads a slot into prose for the skip button's accessible name. Keyed off PlanSlot so a
// seventh parameter in types.ts fails the build here rather than shipping a nameless chip.
const SLOT_QUESTIONS: Record<PlanSlot, string> = {
  duration: 'trip length',
  budget: 'budget',
  region: 'region',
  holidayType: 'holiday type',
  pace: 'pace',
  groupSize: 'group size',
}

// Deliberately not ui/chip.tsx: that is a static display chip with a remove affordance
// (a <span> plus an X), which is the wrong element and the wrong affordance for an answer
// you tap. This is the pill from SuggestedPrompts.tsx instead, so the assistant screen
// speaks one chip language whether it is offering prompts or answers.
const PILL =
  'max-w-full cursor-pointer rounded-full border px-4 py-2 text-left text-[13px] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)] disabled:pointer-events-none disabled:opacity-40'

export function QuickReplies({ group, onPick, disabled, answered }: QuickRepliesProps) {
  const spent = answered ?? false

  function pick(reply: QuickReply) {
    // A spent group keeps its click handler wired but inert, because it is no longer
    // `disabled` — see the aria-disabled note below.
    if (spent || disabled) return
    onPick(reply)
  }

  // Once answered the chips stay on screen, greyed: a question that vanishes once tapped
  // makes the transcript lie about what the assistant offered at the time. They read as
  // spent through aria-disabled rather than the real `disabled` attribute so a screen
  // reader still announces them when reviewing the thread, and drop out of the tab order
  // so an old turn is not a pile of dead tab stops.
  const spentProps = spent ? { 'aria-disabled': true as const, tabIndex: -1 } : {}
  const terseSkip = group.skip.label.trim().split(/\s+/).length < 2
  // `options` is `Field(default_factory=list)` on the wire, so an option-less group is a shape the
  // backend can legally send: the skip alone is still a complete answer, but the row and the
  // hairline that sets it apart from the options must not be drawn around nothing.
  const hasOptions = group.options.length > 0

  return (
    <div
      role="group"
      aria-label={group.prompt}
      // Spent recedes through the surface and the token, never through opacity: muted-foreground
      // composited at 60% over --panel measures ~2.7:1, under the 4.5 floor in
      // docs/design-system.md §7, and an old turn nobody can read defeats the whole reason the
      // chips stay mounted.
      className={cn('rounded-2xl border bg-panel px-4 py-3', spent && 'bg-transparent')}
    >
      <p className={cn('text-[13px] font-semibold', spent && 'text-muted-foreground')}>
        {group.prompt}
      </p>

      {hasOptions && (
        <div className="mt-2.5 flex flex-wrap gap-1.5">
          {group.options.map((option) => (
            <button
              key={option.label}
              type="button"
              disabled={disabled}
              onClick={() => pick(option)}
              {...spentProps}
              className={cn(
                PILL,
                'text-muted-foreground',
                // A spent chip drops the raised fill, the hover and the pointer cursor: it is no
                // longer something you tap, so it should not keep claiming to be.
                spent ? 'cursor-default' : 'bg-card hover:bg-accent hover:text-foreground',
              )}
            >
              {option.label}
            </button>
          ))}
        </div>
      )}

      {/* The hairline is the point: a skip is a complete answer, but it is not one of the
          choices, so the layout should not line it up beside them. */}
      <div className={cn(hasOptions ? 'mt-3 border-t pt-3' : 'mt-2.5')}>
        <button
          type="button"
          disabled={disabled}
          onClick={() => pick(group.skip)}
          {...spentProps}
          // "Surprise me!" says what tapping does; a bare "Skip" does not, so only the
          // terse case gets a name that spells out which question is being skipped.
          // The `?? 'current'` is for a slot the backend adds before types.ts catches up: a vague
          // name still says what the button does, whereas "the undefined question" does not.
          aria-label={
            terseSkip
              ? `${group.skip.label} the ${SLOT_QUESTIONS[group.slot] ?? 'current'} question`
              : undefined
          }
          className={cn(
            PILL,
            'inline-flex items-center gap-1.5 border-transparent text-muted-foreground',
            spent ? 'cursor-default' : 'hover:bg-accent hover:text-foreground',
          )}
        >
          <SkipForward className="size-3.5 shrink-0" />
          {group.skip.label}
        </button>
      </div>
    </div>
  )
}
