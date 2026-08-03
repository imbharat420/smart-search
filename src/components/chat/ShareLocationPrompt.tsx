import { useState } from 'react'
import { LocateFixed } from 'lucide-react'
import { toast } from 'sonner'
import type { Coords } from '../../lib/geo'
import { Button } from '../ui/button'

interface ShareLocationPromptProps {
  onShare: (origin: Coords) => void
}

export function ShareLocationPrompt({ onShare }: ShareLocationPromptProps) {
  const [locating, setLocating] = useState(false)

  function share() {
    if (!navigator.geolocation) {
      toast.error('This browser will not share a location', {
        description: 'Type an area or landmark instead.',
      })
      return
    }
    setLocating(true)
    navigator.geolocation.getCurrentPosition(
      (position) => {
        setLocating(false)
        onShare({ lat: position.coords.latitude, lng: position.coords.longitude })
      },
      (error) => {
        setLocating(false)
        toast.error(
          error.code === error.PERMISSION_DENIED
            ? 'Location permission denied'
            : 'Could not read your location',
          { description: 'Type an area or landmark instead.' },
        )
      },
      { timeout: 8000, maximumAge: 300000 },
    )
  }

  return (
    <Button variant="brand" size="sm" onClick={share} disabled={locating} className="w-fit">
      <LocateFixed />
      {locating ? 'Locating…' : 'Share current location'}
    </Button>
  )
}
