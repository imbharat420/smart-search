import { usePageMeta } from '../lib/meta'
import { SiteFooter } from '../components/layout/SiteFooter'
import { FeaturedIn } from '../components/landing/FeaturedIn'
import { Hero } from '../components/landing/Hero'
import { HowItWorks } from '../components/landing/HowItWorks'
import { PocCoverage } from '../components/landing/PocCoverage'
import { PopularItineraries } from '../components/landing/PopularItineraries'

export function Landing() {
  usePageMeta(
    'TravelIQ — search the way travellers talk',
    'TravelIQ turns one traveller sentence into precise filters: destination, month, duration, budget, party and climate. Built for travel and hospitality brands, with keyword search as the fallback.',
  )

  return (
    <div className="min-h-screen bg-panel">
      <Hero />
      <HowItWorks />
      <PopularItineraries />
      <FeaturedIn />
      <PocCoverage />
      <SiteFooter />
    </div>
  )
}
