interface SuggestedPromptsProps {
  onPick: (prompt: string) => void
  disabled: boolean
}

// The first group is the three worked examples from the project brief; the second proves the
// assistant also answers from the indexed booking conditions.
const GROUPS: { label: string; prompts: string[] }[] = [
  {
    label: 'Plan a trip',
    prompts: [
      'Northern lights trip for a family next winter, not too expensive',
      '7 day walking holiday in Italy with small groups',
      'Somewhere warm in November under 1200 with direct flights',
    ],
  },
  {
    label: 'Ask about booking',
    prompts: [
      'How much deposit do I pay, and when is the balance due?',
      'Is a flight-inclusive holiday still protected if you stop trading?',
    ],
  },
]

export function SuggestedPrompts({ onPick, disabled }: SuggestedPromptsProps) {
  return (
    <div className="mt-8 space-y-5">
      {GROUPS.map((group) => (
        <div key={group.label}>
          <p className="text-xs font-semibold text-muted-foreground">{group.label}</p>
          <div className="mt-2 flex flex-wrap justify-center gap-2">
            {group.prompts.map((prompt) => (
              <button
                key={prompt}
                type="button"
                disabled={disabled}
                onClick={() => onPick(prompt)}
                className="max-w-full cursor-pointer rounded-full border bg-card px-4 py-2 text-left text-[13px] text-muted-foreground transition-colors hover:bg-accent hover:text-foreground disabled:pointer-events-none disabled:opacity-40"
              >
                {prompt}
              </button>
            ))}
          </div>
        </div>
      ))}
    </div>
  )
}
