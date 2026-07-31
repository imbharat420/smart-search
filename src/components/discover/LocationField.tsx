import { LocateFixed, MapPin } from 'lucide-react'
import { Button } from '../ui/button'
import { SearchField } from '../ui/input'

interface LocationFieldProps {
  value: string
  onChange: (value: string) => void
  locating: boolean
  onNearMe: () => void
}

export function LocationField({ value, onChange, locating, onNearMe }: LocationFieldProps) {
  return (
    <div className="space-y-2">
      <SearchField
        value={value}
        onChange={onChange}
        aria-label="Location"
        placeholder="Town, city or neighbourhood"
        icon={<MapPin />}
        className="pr-2"
        trailing={
          <Button variant="outline" size="sm" onClick={onNearMe} disabled={locating}>
            <LocateFixed />
            {locating ? 'Locating' : 'Near me'}
          </Button>
        }
      />
      <p className="text-xs text-muted-foreground">
        Matches the place index by name, type or area — try Jaipur, Amer or hotel. Turning a typed
        address into coordinates needs a geocoding provider, which is a production integration.
      </p>
    </div>
  )
}
