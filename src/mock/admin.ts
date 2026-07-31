import type {
  AdminConfig,
  DataSource,
  MergeCandidate,
  Promotion,
  Synonym,
} from '../types'

// Control-panel fixtures. Timestamps are relative to now so the source-health
// panel reads sensibly whenever the POC is demonstrated.

const hoursAgo = (h: number): string => new Date(Date.now() - h * 3_600_000).toISOString()

const daysFromNow = (d: number): string =>
  new Date(Date.now() + d * 86_400_000).toISOString().slice(0, 10)

export const ADMIN_CONFIG: AdminConfig = {
  searchableFields: [
    { field: 'title', weight: 1, enabled: true },
    { field: 'destination', weight: 0.9, enabled: true },
    { field: 'themes', weight: 0.85, enabled: true },
    { field: 'activities', weight: 0.75, enabled: true },
    { field: 'summary', weight: 0.6, enabled: true },
    { field: 'description', weight: 0.4, enabled: true },
    { field: 'badges', weight: 0.3, enabled: false },
    { field: 'supplier', weight: 0.2, enabled: false },
  ],
  enabledFilters: [
    'destination',
    'theme',
    'activity',
    'month',
    'maxPrice',
    'climate',
    'directOnly',
    'availableOnly',
    'audience',
  ],
  resultsPerPage: 12,
  fallbackToLexical: true,
}

export const SYNONYMS: Synonym[] = [
  {
    id: 'syn-01',
    term: 'northern lights',
    alternatives: ['aurora', 'aurora borealis', 'polar lights', 'nordlys'],
    market: 'en-GB',
  },
  {
    id: 'syn-02',
    term: 'walking',
    alternatives: ['hiking', 'trekking', 'rambling', 'hillwalking'],
    market: 'en-GB',
  },
  {
    id: 'syn-03',
    term: 'winter sun',
    alternatives: ['somewhere warm', 'sunshine break', 'escape the winter'],
    market: 'en-GB',
  },
  {
    id: 'syn-04',
    term: 'self-drive',
    alternatives: ['road trip', 'fly-drive', 'hire car tour'],
    market: 'en-GB',
  },
  {
    id: 'syn-05',
    term: 'family',
    alternatives: ['with kids', 'with children', 'school holidays', 'half term'],
    market: 'en-GB',
  },
  {
    id: 'syn-06',
    term: 'wildlife',
    alternatives: ['safari', 'whale watching', 'birdwatching', 'animal spotting'],
    market: 'en-GB',
  },
]

export const PROMOTIONS: Promotion[] = [
  {
    id: 'promo-01',
    tripId: 'trip-01',
    tripTitle: 'Tromsø Aurora Week for Families',
    kind: 'pin',
    weight: 100,
    startsAt: daysFromNow(-9),
    endsAt: daysFromNow(52),
  },
  {
    id: 'promo-02',
    tripId: 'trip-09',
    tripTitle: 'Amalfi Coast: Path of the Gods Walking Week',
    kind: 'pin',
    weight: 90,
    startsAt: daysFromNow(-2),
    endsAt: daysFromNow(28),
  },
  {
    id: 'promo-03',
    tripId: 'trip-24',
    tripTitle: 'Rajasthan: Cities of Colour by Rail',
    kind: 'boost',
    weight: 25,
  },
  {
    id: 'promo-04',
    tripId: 'trip-26',
    tripTitle: 'Santorini Caldera Days',
    kind: 'hide',
    weight: 0,
    startsAt: daysFromNow(-16),
  },
]

export const SOURCES: DataSource[] = [
  {
    id: 'src-01',
    key: 'cms',
    label: 'TravelIQ CMS',
    kind: 'cms',
    status: 'healthy',
    lastSyncAt: hoursAgo(0.4),
    recordCount: 33,
    fieldPriority: ['title', 'summary', 'description', 'imageUrl', 'gallery', 'themes'],
  },
  {
    id: 'src-02',
    key: 'supplier-atlas',
    label: 'Atlas supplier feed',
    kind: 'supplier',
    status: 'syncing',
    lastSyncAt: hoursAgo(0.05),
    recordCount: 1284,
    fieldPriority: ['priceFrom', 'months', 'available', 'groupSizeMax', 'directFlights'],
  },
  {
    id: 'src-03',
    key: 'supplier-meridian',
    label: 'Meridian long-haul feed',
    kind: 'supplier',
    status: 'stale',
    lastSyncAt: hoursAgo(61),
    recordCount: 412,
    fieldPriority: ['priceFrom', 'months', 'available'],
  },
  {
    id: 'src-04',
    key: 'enrichment',
    label: 'Reviews & ratings enrichment',
    kind: 'enrichment',
    status: 'error',
    lastSyncAt: hoursAgo(19),
    recordCount: 0,
    fieldPriority: ['rating', 'reviewCount', 'badges'],
  },
]

export const REVIEW_QUEUE: MergeCandidate[] = [
  {
    id: 'merge-01',
    leftTitle: 'Tromsø Aurora Week for Families',
    rightTitle: 'Tromso Northern Lights Family Week (5 nights)',
    leftSource: 'cms',
    rightSource: 'supplier-atlas',
    score: 0.82,
    reasons: [
      'Title trigram similarity 0.79',
      'Same destination: Tromsø, Norway',
      'Duration differs by 1 day (5 vs 6)',
      'Price within 4% (£1,145 vs £1,189)',
    ],
    status: 'pending',
  },
  {
    id: 'merge-02',
    leftTitle: 'Amalfi Coast: Path of the Gods Walking Week',
    rightTitle: 'Sentiero degli Dei Walking Holiday',
    leftSource: 'cms',
    rightSource: 'supplier-meridian',
    score: 0.71,
    reasons: [
      'Title trigram similarity 0.31 — matched via synonym "path of the gods"',
      'Same destination and duration (7 days)',
      'Supplier reference AMA-POG-7 matches CMS external id',
    ],
    status: 'pending',
  },
  {
    id: 'merge-03',
    leftTitle: 'Kerala Backwaters & Spice Hills',
    rightTitle: 'Kerala Backwaters and Tea Country',
    leftSource: 'cms',
    rightSource: 'supplier-meridian',
    score: 0.68,
    reasons: [
      'Title trigram similarity 0.66',
      'Same destination: Kochi, India',
      'Duration differs by 2 days (10 vs 12)',
      'Itinerary overlap 6 of 10 stops',
    ],
    status: 'pending',
  },
  {
    id: 'merge-04',
    leftTitle: 'Banff Powder Week',
    rightTitle: 'Banff & Sunshine Village Ski Week',
    leftSource: 'cms',
    rightSource: 'supplier-atlas',
    score: 0.63,
    reasons: [
      'Title trigram similarity 0.42',
      'Same destination and month set',
      'Different accommodation grade — may be two genuine products',
    ],
    status: 'pending',
  },
  {
    id: 'merge-05',
    leftTitle: 'Tenerife Winter Sun & Teide Trails',
    rightTitle: 'Canary Islands Winter Sunshine, Tenerife',
    leftSource: 'cms',
    rightSource: 'supplier-atlas',
    score: 0.9,
    reasons: [
      'Title trigram similarity 0.74',
      'Identical destination, duration and departure months',
      'Auto-merged above the 0.86 threshold — listed here for audit only',
    ],
    status: 'approved',
  },
]
