import { ArrowUpRight, Heart, MapPin } from 'lucide-react'
import { Link } from 'react-router-dom'
import { toast } from 'sonner'
import type { Guide } from '../../types'
import { Badge } from '../ui/badge'
import { Card, CardBody, CardMedia } from '../ui/card'
import { cn } from '../../lib/utils'

interface GuideCardProps {
  guide: Guide
  saved: boolean
  onToggleSave: () => void
}

export function GuideCard({ guide, saved, onToggleSave }: GuideCardProps) {
  const save = () => {
    onToggleSave()
    toast.success(saved ? 'Removed from your collection' : 'Saved to your collection', {
      description: guide.title,
    })
  }

  return (
    <Card className="relative">
      <CardMedia
        src={guide.imageUrl}
        alt={guide.title}
        aspect="4/3"
        badge={
          <Badge className="bg-background/90 text-foreground tabular-nums backdrop-blur">
            {guide.days} days
          </Badge>
        }
      />
      <button
        type="button"
        onClick={save}
        aria-pressed={saved}
        aria-label={saved ? `Remove ${guide.title} from saved` : `Save ${guide.title}`}
        className="absolute right-3 top-3 flex h-10 w-10 cursor-pointer items-center justify-center rounded-full bg-background/90 text-foreground backdrop-blur transition-colors hover:bg-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)]"
      >
        <Heart
          className={cn(
            'h-4 w-4',
            saved && 'fill-[var(--primary-strong)] text-[var(--primary-strong)]',
          )}
        />
      </button>

      <CardBody>
        <h3 className="line-clamp-2 font-semibold leading-snug">{guide.title}</h3>
        <p className="flex items-center gap-1.5 text-sm text-muted-foreground">
          <MapPin className="h-3.5 w-3.5 shrink-0" />
          <span className="truncate">{guide.location}</span>
        </p>
        <div className="mt-auto flex items-center justify-between gap-2 border-t pt-3">
          <span className="flex min-w-0 items-center gap-2">
            <span
              aria-hidden="true"
              className="h-6 w-6 shrink-0 rounded-full bg-gradient-to-br from-primary to-[var(--periwinkle)]"
            />
            <span className="truncate text-xs text-muted-foreground">{guide.author}</span>
          </span>
          {/* There is no guide reader in the POC, so the card's action hands the
              guide's title to the search screen; a /guide/:slug route is the fix. */}
          <Link
            to={`/search?q=${encodeURIComponent(guide.title)}`}
            aria-label={`Turn "${guide.title}" into a search`}
            className="inline-flex h-8 shrink-0 items-center gap-1 rounded-full bg-accent px-3 text-xs font-semibold text-accent-foreground transition-colors hover:bg-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)] focus-visible:ring-offset-2"
          >
            Turn into a search
            <ArrowUpRight className="h-3.5 w-3.5" />
          </Link>
        </div>
      </CardBody>
    </Card>
  )
}
