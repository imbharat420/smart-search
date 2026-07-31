import { useEffect } from 'react'
import type { TripDetail } from '../../types'

// Product/TouristTrip JSON-LD for the trip page — the structured data the overview document
// asks for. Like the title in lib/meta.ts it is written on mount, so crawlers that do not run
// JS see nothing until the prerender step in docs/scope-and-limitations.md lands.

function buildJsonLd(detail: TripDetail): Record<string, unknown> {
  const { trip, itinerary, departures } = detail
  const prices = departures.map((departure) => departure.price)

  return {
    '@context': 'https://schema.org',
    '@type': ['Product', 'TouristTrip'],
    name: trip.title,
    description: trip.summary,
    sku: trip.slug,
    url: window.location.href,
    image: [trip.imageUrl, ...trip.gallery],
    brand: { '@type': 'Organization', name: trip.supplier },
    touristType: trip.audience,
    itinerary: {
      '@type': 'ItemList',
      numberOfItems: itinerary.length,
      itemListElement: itinerary.map((day) => ({
        '@type': 'ListItem',
        position: day.day,
        name: day.title,
      })),
    },
    offers: {
      '@type': 'AggregateOffer',
      priceCurrency: trip.currency,
      lowPrice: prices.length > 0 ? Math.min(...prices) : trip.priceFrom,
      highPrice: prices.length > 0 ? Math.max(...prices) : trip.priceFrom,
      offerCount: departures.length,
      availability: trip.available ? 'https://schema.org/InStock' : 'https://schema.org/SoldOut',
    },
    aggregateRating: {
      '@type': 'AggregateRating',
      ratingValue: trip.rating,
      reviewCount: trip.reviewCount,
      bestRating: 5,
    },
  }
}

export function useTripStructuredData(detail: TripDetail | null): void {
  useEffect(() => {
    if (!detail) return

    const script = document.createElement('script')
    script.type = 'application/ld+json'
    script.text = JSON.stringify(buildJsonLd(detail))
    document.head.appendChild(script)

    return () => script.remove()
  }, [detail])
}
