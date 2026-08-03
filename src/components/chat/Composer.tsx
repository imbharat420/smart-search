import { useEffect, useRef } from 'react'
import { ArrowUp, Loader2, MapPin, Mic } from 'lucide-react'
import { toast } from 'sonner'

interface ComposerProps {
  value: string
  onChange: (value: string) => void
  onSend: () => void
  onNearMe: () => void
  busy: boolean
}

const ICON_BUTTON =
  'flex h-10 w-10 shrink-0 cursor-pointer items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-accent hover:text-foreground'

export function Composer({ value, onChange, onSend, onNearMe, busy }: ComposerProps) {
  const field = useRef<HTMLTextAreaElement>(null)

  // Grows with the text up to about four lines, then scrolls inside the pill.
  useEffect(() => {
    const element = field.current
    if (!element) return
    element.style.height = 'auto'
    element.style.height = `${Math.min(element.scrollHeight, 132)}px`
  }, [value])

  return (
    <form
      onSubmit={(event) => {
        event.preventDefault()
        onSend()
      }}
      className="mx-auto flex w-full max-w-2xl items-end gap-1 rounded-3xl border bg-card px-2.5 py-2 shadow-sm transition-shadow focus-within:ring-2 focus-within:ring-[var(--ring)]"
    >
      <textarea
        ref={field}
        rows={1}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        onKeyDown={(event) => {
          if (event.key !== 'Enter' || event.shiftKey) return
          event.preventDefault()
          onSend()
        }}
        placeholder="Ask for a trip, or about deposits, baggage and ATOL cover"
        aria-label="Message the TravelIQ assistant"
        className="max-h-[132px] min-w-0 flex-1 resize-none bg-transparent px-2 py-2.5 text-[15px] leading-relaxed outline-none placeholder:text-muted-foreground"
      />

      <button
        type="button"
        title="Voice input (not implemented)"
        aria-label="Voice input (not implemented)"
        onClick={() =>
          toast.info('Voice input is not part of this POC', {
            description:
              'Nothing is recording. Wiring the Web Speech API into this composer is the fix.',
          })
        }
        className={ICON_BUTTON}
      >
        <Mic className="h-4 w-4" />
      </button>

      <button
        type="button"
        title="Find places near me"
        aria-label="Find places near me"
        onClick={onNearMe}
        disabled={busy}
        className={ICON_BUTTON}
      >
        <MapPin className="h-4 w-4" />
      </button>

      <button
        type="submit"
        disabled={busy || value.trim().length === 0}
        aria-label={busy ? 'Waiting for the assistant' : 'Send message'}
        className="flex h-10 w-10 shrink-0 cursor-pointer items-center justify-center rounded-full bg-ink text-background transition-opacity hover:opacity-90 disabled:pointer-events-none disabled:opacity-30"
      >
        {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <ArrowUp className="h-4 w-4" />}
      </button>
    </form>
  )
}
