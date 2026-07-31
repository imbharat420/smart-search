import { Cpu, Sparkles, WifiOff } from 'lucide-react'
import { cn } from '../../lib/utils'
import { Skeleton } from '../ui/skeleton'

interface ModelPillProps {
  provider: string | null
  live: boolean
  loading: boolean
}

export function ModelPill({ provider, live, loading }: ModelPillProps) {
  if (loading) return <Skeleton className="h-8 w-44" />

  const state = !live
    ? {
        icon: <WifiOff />,
        label: 'Canned demo replies',
        title:
          'The TravelIQ backend is unreachable, so answers come from the seeded catalogue in the browser.',
        tinted: false,
      }
    : provider
      ? {
          icon: <Sparkles />,
          label: `Answered by ${provider}`,
          title: 'The primary provider in the backend chain, as reported by /health.',
          tinted: true,
        }
      : {
          icon: <Cpu />,
          label: 'No model key — canned replies',
          title: 'Add a provider key to backend/.env to enable live, grounded answers.',
          tinted: false,
        }

  return (
    <span
      title={state.title}
      className={cn(
        'inline-flex h-8 max-w-[16rem] items-center gap-1.5 rounded-full px-3 text-xs font-medium [&_svg]:size-3.5 [&_svg]:shrink-0',
        state.tinted ? 'bg-accent text-foreground' : 'border bg-card text-muted-foreground',
      )}
    >
      {state.icon}
      <span className="truncate">{state.label}</span>
    </span>
  )
}
