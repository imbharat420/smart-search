import type {
  AnalyticsOverview,
  Audience,
  Climate,
  Departure,
  Destination,
  Facet,
  FacetValue,
  ItineraryDay,
  ParsedQuery,
  SearchFilters,
  SearchResponse,
  SearchResult,
  TimelinePoint,
  TopQuery,
  Trip,
  TripDetail,
  ZeroResultQuery,
} from '../types'
import { money, monthName } from '../lib/format'
import { PROMOTIONS } from './admin'
import { POLICIES } from './policies'

// The offline catalogue plus a genuine TS port of the backend's query understanding
// (backend/app/nlq.py) and retrieval (backend/app/rag.py). src/lib/api.ts falls back to
// this whenever the API is unreachable, so the fallback has to behave like the real thing:
// same parsing, same filter precedence, same facet counts, same response shape.

// Photo ids are lifted from docs/reference/src/routes/*.tsx so every image is one we know
// resolves. Reuse across trips is deliberate.
const PHOTOS = {
  aurora: '1531366936337-7c912a4589a7',
  iceland: '1490650404312-a2175773bbf5',
  amalfi: '1533106497176-45ae19e68ba2',
  positano: '1516483638261-f4dbaf036963',
  alps: '1527668752968-14dc70a27c95',
  rockies: '1609825488888-3a766db05542',
  patagonia: '1531794223682-8ea491fb2fef',
  newZealand: '1469521669194-babb45599def',
  bali: '1537996194471-e657df975ab4',
  morocco: '1489493585363-d69421e0edd3',
  islands: '1613395877344-13d4a8e0d49e',
  kyoto: '1493976040374-85c8e12f0c0e',
  india: '1548013146-72479768bada',
  redRock: '1518803194621-27188ba362c9',
  openRoad: '1488646953014-85cb44e25828',
}

const img = (id: string): string => `https://images.unsplash.com/photo-${id}?w=800&q=80`

const shots = (...ids: string[]): string[] => ids.map(img)

export const DESTINATIONS: Destination[] = [
  {
    id: 'dest-01',
    slug: 'tromso',
    name: 'Tromsø',
    country: 'Norway',
    region: 'Arctic Norway',
    lat: 69.6492,
    lng: 18.9553,
    imageUrl: img(PHOTOS.aurora),
  },
  {
    id: 'dest-02',
    slug: 'reykjavik',
    name: 'Reykjavík',
    country: 'Iceland',
    region: 'South Iceland',
    lat: 64.1466,
    lng: -21.9426,
    imageUrl: img(PHOTOS.iceland),
  },
  {
    id: 'dest-03',
    slug: 'rovaniemi',
    name: 'Rovaniemi',
    country: 'Finland',
    region: 'Finnish Lapland',
    lat: 66.5039,
    lng: 25.7294,
    imageUrl: img(PHOTOS.aurora),
  },
  {
    id: 'dest-04',
    slug: 'abisko',
    name: 'Abisko',
    country: 'Sweden',
    region: 'Swedish Lapland',
    lat: 68.3494,
    lng: 18.8306,
    imageUrl: img(PHOTOS.aurora),
  },
  {
    id: 'dest-05',
    slug: 'amalfi',
    name: 'Amalfi',
    country: 'Italy',
    region: 'Campania',
    lat: 40.634,
    lng: 14.6027,
    imageUrl: img(PHOTOS.amalfi),
  },
  {
    id: 'dest-06',
    slug: 'siena',
    name: 'Siena',
    country: 'Italy',
    region: 'Tuscany',
    lat: 43.3188,
    lng: 11.3308,
    imageUrl: img(PHOTOS.positano),
  },
  {
    id: 'dest-07',
    slug: 'ortisei',
    name: 'Ortisei',
    country: 'Italy',
    region: 'Dolomites',
    lat: 46.5766,
    lng: 11.6719,
    imageUrl: img(PHOTOS.alps),
  },
  {
    id: 'dest-08',
    slug: 'grindelwald',
    name: 'Grindelwald',
    country: 'Switzerland',
    region: 'Bernese Oberland',
    lat: 46.6244,
    lng: 8.0414,
    imageUrl: img(PHOTOS.alps),
  },
  {
    id: 'dest-09',
    slug: 'agadir',
    name: 'Agadir',
    country: 'Morocco',
    region: 'Atlantic Coast',
    lat: 30.4278,
    lng: -9.5981,
    imageUrl: img(PHOTOS.morocco),
  },
  {
    id: 'dest-10',
    slug: 'marrakech',
    name: 'Marrakech',
    country: 'Morocco',
    region: 'Atlas & Sahara',
    lat: 31.6295,
    lng: -7.9811,
    imageUrl: img(PHOTOS.morocco),
  },
  {
    id: 'dest-11',
    slug: 'tenerife',
    name: 'Puerto de la Cruz',
    country: 'Spain',
    region: 'Canary Islands',
    lat: 28.4136,
    lng: -16.5448,
    imageUrl: img(PHOTOS.islands),
  },
  {
    id: 'dest-12',
    slug: 'funchal',
    name: 'Funchal',
    country: 'Portugal',
    region: 'Madeira',
    lat: 32.6669,
    lng: -16.9241,
    imageUrl: img(PHOTOS.positano),
  },
  {
    id: 'dest-13',
    slug: 'sagres',
    name: 'Sagres',
    country: 'Portugal',
    region: 'Algarve',
    lat: 37.0097,
    lng: -8.9407,
    imageUrl: img(PHOTOS.islands),
  },
  {
    id: 'dest-14',
    slug: 'stone-town',
    name: 'Stone Town',
    country: 'Tanzania',
    region: 'Zanzibar',
    lat: -6.1659,
    lng: 39.2026,
    imageUrl: img(PHOTOS.bali),
  },
  {
    id: 'dest-15',
    slug: 'ubud',
    name: 'Ubud',
    country: 'Indonesia',
    region: 'Bali',
    lat: -8.5069,
    lng: 115.2625,
    imageUrl: img(PHOTOS.bali),
  },
  {
    id: 'dest-16',
    slug: 'kyoto',
    name: 'Kyoto',
    country: 'Japan',
    region: 'Kansai',
    lat: 35.0116,
    lng: 135.7681,
    imageUrl: img(PHOTOS.kyoto),
  },
  {
    id: 'dest-17',
    slug: 'kochi',
    name: 'Kochi',
    country: 'India',
    region: 'Kerala',
    lat: 9.9312,
    lng: 76.2673,
    imageUrl: img(PHOTOS.india),
  },
  {
    id: 'dest-18',
    slug: 'jaipur',
    name: 'Jaipur',
    country: 'India',
    region: 'Rajasthan',
    lat: 26.9124,
    lng: 75.7873,
    imageUrl: img(PHOTOS.india),
  },
  {
    id: 'dest-19',
    slug: 'santorini',
    name: 'Santorini',
    country: 'Greece',
    region: 'Cyclades',
    lat: 36.3932,
    lng: 25.4615,
    imageUrl: img(PHOTOS.islands),
  },
  {
    id: 'dest-20',
    slug: 'el-chalten',
    name: 'El Chaltén',
    country: 'Argentina',
    region: 'Patagonia',
    lat: -49.3315,
    lng: -72.8863,
    imageUrl: img(PHOTOS.patagonia),
  },
  {
    id: 'dest-21',
    slug: 'queenstown',
    name: 'Queenstown',
    country: 'New Zealand',
    region: 'Otago',
    lat: -45.0312,
    lng: 168.6626,
    imageUrl: img(PHOTOS.newZealand),
  },
  {
    id: 'dest-22',
    slug: 'banff',
    name: 'Banff',
    country: 'Canada',
    region: 'Alberta',
    lat: 51.1784,
    lng: -115.5708,
    imageUrl: img(PHOTOS.rockies),
  },
  {
    id: 'dest-23',
    slug: 'moab',
    name: 'Moab',
    country: 'United States',
    region: 'Utah',
    lat: 38.5733,
    lng: -109.5498,
    imageUrl: img(PHOTOS.redRock),
  },
]

const DESTINATION_BY_SLUG = new Map(DESTINATIONS.map((d) => [d.slug, d]))

function place(slug: string): Destination {
  const found = DESTINATION_BY_SLUG.get(slug)
  if (!found) throw new Error(`unknown destination slug: ${slug}`)
  return found
}

// The facet vocabularies double as the parser's keyword tables, so the two can never
// drift apart the way a separate synonym list would.
const THEME_HINTS: Record<string, string[]> = {
  'Northern Lights': ['northern lights', 'aurora', 'polar lights', 'nordlys'],
  'Walking & hiking': ['walking', 'walk', 'hiking', 'hike', 'trekking', 'trek', 'rambling'],
  Beach: ['beach', 'coast', 'seaside', 'sand', 'island hopping'],
  'City break': ['city break', 'city', 'weekend away'],
  Wildlife: ['wildlife', 'safari', 'whale', 'tiger', 'birdwatching', 'game drive'],
  Culture: ['culture', 'cultural', 'temple', 'history', 'historic', 'museum', 'ruins'],
  'Food & wine': ['food', 'foodie', 'wine', 'culinary', 'cookery', 'gastronomy'],
  'Winter sun': ['winter sun', 'somewhere warm', 'sunshine', 'escape the winter'],
  'Rail journeys': ['rail', 'train', 'sleeper'],
  'Ski & snow': ['ski', 'snowboard', 'piste', 'powder'],
  Wellness: ['wellness', 'spa', 'yoga', 'retreat'],
  'Self-drive': ['self drive', 'self-drive', 'road trip', 'fly drive', 'hire car', 'driving'],
}

const ACTIVITY_HINTS: Record<string, string[]> = {
  Walking: ['walking', 'walk', 'hiking', 'hike', 'trek', 'ramble'],
  Diving: ['diving', 'dive', 'scuba', 'padi'],
  Skiing: ['ski', 'piste', 'powder', 'snowboard'],
  'Food tour': ['food tour', 'street food', 'foodie', 'food'],
  'Wine tasting': ['wine', 'vineyard', 'winery', 'tasting'],
  'Cooking class': ['cooking', 'cookery', 'cook'],
  'Dog sledding': ['husky', 'huskies', 'dog sled', 'sledding', 'sledge'],
  'Wildlife watching': ['wildlife', 'whale', 'tiger', 'safari', 'game drive'],
  Snorkelling: ['snorkel', 'reef'],
  Kayaking: ['kayak', 'canoe', 'paddle'],
  Cycling: ['cycling', 'cycle', 'bike'],
  'Hot springs': ['hot spring', 'thermal', 'lagoon'],
  Photography: ['photography', 'photo'],
  'Rail travel': ['rail', 'train', 'sleeper'],
}

const AUDIENCE_HINTS: Record<Audience, string[]> = {
  Family: ['family', 'families', 'kids', 'children', 'school holiday', 'half term'],
  Couples: ['couple', 'honeymoon', 'romantic', 'anniversary', 'two of us'],
  Solo: ['solo', 'on my own', 'by myself', 'alone', 'single traveller'],
  'Small groups': ['small group', 'small-group', 'like-minded', 'guided group'],
  Adventure: ['adventure', 'adventurous', 'adrenaline', 'active'],
}

const CLIMATE_HINTS: Record<Climate, string[]> = {
  warm: ['warm', 'warmer', 'hot', 'sunny', 'sunshine', 'tropical', 'winter sun', 'somewhere warm'],
  mild: ['mild', 'temperate', 'not too hot', 'shoulder season'],
  cold: ['cold', 'snow', 'snowy', 'arctic', 'freezing', 'icy', 'polar'],
}

const CLIMATE_LABELS: Record<string, string> = {
  warm: 'Warm',
  mild: 'Mild',
  cold: 'Cold & snowy',
}

export const THEMES: string[] = Object.keys(THEME_HINTS)
export const ACTIVITIES: string[] = Object.keys(ACTIVITY_HINTS)
export const AUDIENCES: Audience[] = ['Family', 'Couples', 'Solo', 'Small groups', 'Adventure']

export const TRIPS: Trip[] = [
  // ---- Aurora and the Arctic -------------------------------------------
  {
    id: 'trip-01',
    slug: 'tromso-aurora-week-for-families',
    title: 'Tromsø Aurora Week for Families',
    summary:
      'Five Arctic nights built around the northern lights, with husky sledding and a reindeer camp to fill the short days.',
    description:
      'You stay in one hotel in the centre of Tromsø for the whole trip, so there is no packing and repacking with tired children. Three evenings are set aside for guided aurora chases by minibus, which means your guide can drive inland to find clear sky rather than hoping the coast behaves. Daytimes are gentle: a husky farm, the cable car above the city, and an afternoon with a Sami reindeer herder. Thermal suits and boots are included for everyone down to age four.',
    destination: place('tromso'),
    themes: ['Northern Lights', 'Wildlife'],
    activities: ['Dog sledding', 'Wildlife watching', 'Photography'],
    audience: ['Family', 'Couples'],
    durationDays: 5,
    priceFrom: 1145,
    currency: 'GBP',
    rating: 4.8,
    reviewCount: 412,
    climate: 'cold',
    months: [11, 12, 1, 2, 3],
    directFlights: true,
    groupSizeMax: 18,
    available: true,
    imageUrl: img(PHOTOS.aurora),
    gallery: shots(PHOTOS.aurora, PHOTOS.iceland, PHOTOS.openRoad),
    supplier: 'Arctic Trails AS',
    sources: ['cms', 'supplier-atlas', 'enrichment'],
    pinned: true,
    badges: ['Family favourite', 'Thermal kit included'],
  },
  {
    id: 'trip-02',
    slug: 'rovaniemi-lapland-family-christmas',
    title: 'Rovaniemi Lapland Family Christmas Break',
    summary:
      'Four nights on the Arctic Circle with Father Christmas, a husky safari sized for children and a glass-roofed cabin to finish.',
    description:
      'Rovaniemi is the easiest introduction to Lapland: the airport is fifteen minutes from town and everything else is walkable. Three nights are in a central hotel and the fourth in a glass-roofed cabin out at Ranua, where the aurora forecast is checked for you before bed. Days cover the Santa Claus Village, a short husky safari and a reindeer sleigh ride through the forest.',
    destination: place('rovaniemi'),
    themes: ['Northern Lights', 'Wildlife'],
    activities: ['Dog sledding', 'Wildlife watching'],
    audience: ['Family'],
    durationDays: 4,
    priceFrom: 995,
    currency: 'GBP',
    rating: 4.7,
    reviewCount: 288,
    climate: 'cold',
    months: [11, 12, 1],
    directFlights: true,
    groupSizeMax: 24,
    available: true,
    imageUrl: img(PHOTOS.aurora),
    gallery: shots(PHOTOS.aurora, PHOTOS.rockies, PHOTOS.iceland),
    supplier: 'Nordic Escapes',
    sources: ['cms', 'supplier-atlas'],
    badges: ['Best for under-tens'],
  },
  {
    id: 'trip-03',
    slug: 'reykjavik-aurora-city-break',
    title: 'Reykjavík Aurora City Break',
    summary:
      'Three nights, two guided aurora hunts and a slow morning in the Sky Lagoon to recover.',
    description:
      'Short, cheap and better value than it looks: Reykjavík is under three hours from the UK and the aurora season runs from September to March. Two evenings are reserved for guided hunts by coach, and if both are clouded out you travel again free on any later date in the same season. Days are yours for the old harbour, the Hallgrímskirkja tower and the thermal pools.',
    destination: place('reykjavik'),
    themes: ['Northern Lights', 'City break'],
    activities: ['Hot springs', 'Photography'],
    audience: ['Family', 'Couples', 'Solo'],
    durationDays: 3,
    priceFrom: 549,
    currency: 'GBP',
    rating: 4.4,
    reviewCount: 1036,
    climate: 'cold',
    months: [9, 10, 11, 12, 1, 2, 3],
    directFlights: true,
    groupSizeMax: 30,
    available: true,
    imageUrl: img(PHOTOS.iceland),
    gallery: shots(PHOTOS.iceland, PHOTOS.aurora, PHOTOS.openRoad),
    supplier: 'Nordic Escapes',
    sources: ['cms', 'supplier-atlas'],
    badges: ['Free repeat hunt'],
  },
  {
    id: 'trip-04',
    slug: 'iceland-northern-lights-golden-circle',
    title: 'Iceland Northern Lights & Golden Circle',
    summary:
      'Geysers and waterfalls by day, dark-sky stops and aurora forecasts by night, all in a small minibus.',
    description:
      'Five nights in south-west Iceland with a driver-guide who knows which farm tracks lead away from the light. You see Þingvellir, Geysir and Gullfoss, walk behind Seljalandsfoss and finish on the black sand at Reynisfjara. Two of the nights are at a countryside hotel chosen for its dark horizon rather than its bar.',
    destination: place('reykjavik'),
    themes: ['Northern Lights', 'Culture'],
    activities: ['Hot springs', 'Walking', 'Photography'],
    audience: ['Family', 'Couples', 'Small groups'],
    durationDays: 5,
    priceFrom: 985,
    currency: 'GBP',
    rating: 4.6,
    reviewCount: 742,
    climate: 'cold',
    months: [10, 11, 12, 1, 2, 3],
    directFlights: true,
    groupSizeMax: 16,
    available: true,
    imageUrl: img(PHOTOS.iceland),
    gallery: shots(PHOTOS.iceland, PHOTOS.aurora, PHOTOS.rockies),
    supplier: 'Nordic Escapes',
    sources: ['cms', 'supplier-atlas', 'enrichment'],
  },
  {
    id: 'trip-05',
    slug: 'abisko-aurora-sky-camp',
    title: 'Abisko Aurora Sky Camp',
    summary:
      'Five nights in the driest aurora spot in Europe, with two trips up to the Aurora Sky Station.',
    description:
      'Abisko sits in a rain shadow, which is why photographers keep coming back: the sky here is clear far more often than on the Norwegian coast. You take the chairlift to the Aurora Sky Station twice, sleep in a cabin at the edge of the national park and spend days on snowshoes or behind a dog team. The group is capped at twelve so the photography guidance is genuinely hands-on.',
    destination: place('abisko'),
    themes: ['Northern Lights', 'Walking & hiking'],
    activities: ['Dog sledding', 'Photography', 'Walking'],
    audience: ['Family', 'Small groups', 'Adventure'],
    durationDays: 5,
    priceFrom: 1180,
    currency: 'GBP',
    rating: 4.5,
    reviewCount: 196,
    climate: 'cold',
    months: [12, 1, 2, 3],
    directFlights: false,
    groupSizeMax: 12,
    available: true,
    imageUrl: img(PHOTOS.aurora),
    gallery: shots(PHOTOS.aurora, PHOTOS.alps, PHOTOS.iceland),
    supplier: 'Arctic Trails AS',
    sources: ['supplier-atlas', 'enrichment'],
  },
  {
    id: 'trip-06',
    slug: 'tromso-aurora-whale-voyage',
    title: 'Tromsø Aurora & Whale Watching Voyage',
    summary:
      'Six nights on a twenty-four-berth ship following the herring, and the whales that follow it, under the lights.',
    description:
      'An ice-strengthened hull, a small saloon and a route decided each morning by the captain and the weather. Humpbacks and orca feed on the herring shoals in Kvænangen through November and December, and you watch them from your own deck rather than from a crowded day boat. Evenings are spent outside with the ship lights off, hoping.',
    destination: place('tromso'),
    themes: ['Northern Lights', 'Wildlife'],
    activities: ['Wildlife watching', 'Photography', 'Kayaking'],
    audience: ['Couples', 'Small groups'],
    durationDays: 6,
    priceFrom: 1690,
    currency: 'GBP',
    rating: 4.9,
    reviewCount: 318,
    climate: 'cold',
    months: [11, 12, 1],
    directFlights: true,
    groupSizeMax: 14,
    available: true,
    imageUrl: img(PHOTOS.aurora),
    gallery: shots(PHOTOS.aurora, PHOTOS.openRoad, PHOTOS.rockies),
    supplier: 'Arctic Trails AS',
    sources: ['cms', 'enrichment'],
    badges: ['Small ship', '24 berths'],
  },
  {
    id: 'trip-07',
    slug: 'iceland-ring-road-winter-self-drive',
    title: 'Iceland Ring Road Winter Self-Drive',
    summary:
      'Eight days, one 4x4 and the whole Ring Road, with hotels booked ahead and the driving days kept short.',
    description:
      'A self-drive built for the shoulder season, when the ice caves open and the coach tours have thinned out. Each day is 150 to 250 kilometres, short enough that you are parked before dark and can watch the sky from the hotel car park. The 4x4 comes with winter tyres, unlimited mileage and a phone number that answers at three in the morning.',
    destination: place('reykjavik'),
    themes: ['Self-drive', 'Northern Lights'],
    activities: ['Walking', 'Hot springs', 'Photography'],
    audience: ['Couples', 'Solo'],
    durationDays: 8,
    priceFrom: 1780,
    currency: 'GBP',
    rating: 4.7,
    reviewCount: 504,
    climate: 'cold',
    months: [9, 10, 11, 3, 4],
    directFlights: true,
    groupSizeMax: 4,
    available: true,
    imageUrl: img(PHOTOS.iceland),
    gallery: shots(PHOTOS.iceland, PHOTOS.openRoad, PHOTOS.aurora),
    supplier: 'TravelIQ Direct',
    sources: ['cms', 'supplier-atlas'],
  },
  {
    id: 'trip-08',
    slug: 'rovaniemi-husky-wilderness-week',
    title: 'Rovaniemi Husky & Reindeer Wilderness Week',
    summary:
      'A week learning to drive your own team of six dogs, sleeping in wilderness cabins deep in the Finnish forest.',
    description:
      'Not a sleigh ride. You take a team of six dogs and are responsible for them for five days: feeding, harnessing and camping alongside them. Nights are in heated log cabins with a wood stove and no wifi, and two days are spent on cross-country skis to give your arms a rest. Sold out for this winter, so departures shown are for the following season.',
    destination: place('rovaniemi'),
    themes: ['Northern Lights', 'Wildlife'],
    activities: ['Dog sledding', 'Wildlife watching', 'Skiing'],
    audience: ['Family', 'Adventure'],
    durationDays: 7,
    priceFrom: 1640,
    currency: 'GBP',
    rating: 4.6,
    reviewCount: 154,
    climate: 'cold',
    months: [12, 1, 2, 3],
    directFlights: false,
    groupSizeMax: 12,
    available: false,
    imageUrl: img(PHOTOS.aurora),
    gallery: shots(PHOTOS.aurora, PHOTOS.alps, PHOTOS.rockies),
    supplier: 'Arctic Trails AS',
    sources: ['supplier-atlas'],
  },

  // ---- Walking in Europe -----------------------------------------------
  {
    id: 'trip-09',
    slug: 'amalfi-path-of-the-gods-walking-week',
    title: 'Amalfi Coast: Path of the Gods Walking Week',
    summary:
      'Seven days on the Sentiero degli Dei and the old mule paths above Positano, with your bags moved for you.',
    description:
      'The Path of the Gods is the headline, but the quieter walks either side of it are why people come back: the Valle delle Ferriere, the lemon terraces above Minori, the steps down into Atrani. You walk with a guide in a group of no more than fourteen and stay in two family-run hotels. Bags travel by road, so you carry a daypack and nothing else.',
    destination: place('amalfi'),
    themes: ['Walking & hiking', 'Food & wine'],
    activities: ['Walking', 'Food tour'],
    audience: ['Small groups', 'Couples'],
    durationDays: 7,
    priceFrom: 1340,
    currency: 'GBP',
    rating: 4.8,
    reviewCount: 486,
    climate: 'mild',
    months: [4, 5, 6, 9, 10],
    directFlights: true,
    groupSizeMax: 14,
    available: true,
    imageUrl: img(PHOTOS.amalfi),
    gallery: shots(PHOTOS.amalfi, PHOTOS.positano, PHOTOS.islands),
    supplier: 'Sentiero Collective',
    sources: ['cms', 'supplier-atlas', 'enrichment'],
    pinned: true,
    badges: ['Guided', 'Bags moved daily'],
  },
  {
    id: 'trip-10',
    slug: 'tuscany-siena-to-montalcino',
    title: 'Tuscany Slow Trails: Siena to Montalcino',
    summary:
      'A week on foot through the Crete Senesi, finishing with Brunello tastings in Montalcino.',
    description:
      'Six walking days of eight to sixteen kilometres, linking Siena, Buonconvento and Montalcino along white gravel roads and the old pilgrim route. Two afternoons are given over to a cookery lesson and a Brunello estate visit. You stay in three agriturismi and eat where the owners eat.',
    destination: place('siena'),
    themes: ['Walking & hiking', 'Food & wine'],
    activities: ['Walking', 'Wine tasting', 'Cooking class'],
    audience: ['Small groups', 'Couples'],
    durationDays: 7,
    priceFrom: 1285,
    currency: 'GBP',
    rating: 4.7,
    reviewCount: 362,
    climate: 'mild',
    months: [4, 5, 6, 9, 10],
    directFlights: true,
    groupSizeMax: 12,
    available: true,
    imageUrl: img(PHOTOS.positano),
    gallery: shots(PHOTOS.positano, PHOTOS.amalfi, PHOTOS.islands),
    supplier: 'Sentiero Collective',
    sources: ['cms', 'enrichment'],
  },
  {
    id: 'trip-11',
    slug: 'dolomites-high-meadows-walk',
    title: 'Dolomites High Meadows Walk',
    summary:
      'Seven days on the meadows above Ortisei, with two nights in rifugi and the Sassolungo in the window.',
    description:
      'A proper mountain week without technical ground: cable cars lift you to the start of each day and the walking is on well-marked paths between 2,000 and 2,400 metres. Two nights in mountain refuges mean dinner at seven and alpenglow afterwards. The group is capped at twelve and led by a UIMLA international mountain leader.',
    destination: place('ortisei'),
    themes: ['Walking & hiking'],
    activities: ['Walking', 'Photography'],
    audience: ['Small groups', 'Adventure'],
    durationDays: 7,
    priceFrom: 1420,
    currency: 'GBP',
    rating: 4.9,
    reviewCount: 218,
    climate: 'mild',
    months: [6, 7, 8, 9],
    directFlights: false,
    groupSizeMax: 12,
    available: true,
    imageUrl: img(PHOTOS.alps),
    gallery: shots(PHOTOS.alps, PHOTOS.rockies, PHOTOS.patagonia),
    supplier: 'Alpine Foot Travel',
    sources: ['cms', 'supplier-atlas'],
    badges: ['Two nights in rifugi'],
  },
  {
    id: 'trip-12',
    slug: 'tuscan-wine-villages-walk',
    title: 'Tuscan Wine Villages Walk',
    summary:
      'Six gentler days between the Chianti villages, with a vineyard lunch on all but one of them.',
    description:
      'Shorter walks than our Siena to Montalcino week — four to five hours a day at most — for people who would rather linger over lunch than push on. You stay in Greve in Chianti throughout and walk out and back on the old estate tracks. Two tastings and the Panzano market are included.',
    destination: place('siena'),
    themes: ['Walking & hiking', 'Food & wine'],
    activities: ['Walking', 'Wine tasting'],
    audience: ['Small groups', 'Couples', 'Solo'],
    durationDays: 6,
    priceFrom: 1090,
    currency: 'GBP',
    rating: 4.5,
    reviewCount: 174,
    climate: 'mild',
    months: [4, 5, 9, 10],
    directFlights: true,
    groupSizeMax: 14,
    available: true,
    imageUrl: img(PHOTOS.positano),
    gallery: shots(PHOTOS.positano, PHOTOS.amalfi, PHOTOS.alps),
    supplier: 'Sentiero Collective',
    sources: ['cms'],
  },
  {
    id: 'trip-13',
    slug: 'positano-cliffside-steps-short-break',
    title: 'Positano Cliffside Steps Short Break',
    summary:
      'A long weekend of lemon groves, 1,700 steps and a boat to Nerano for lunch.',
    description:
      'Four days from one hotel in Positano, with two guided walks and a day on the water. The walking is steep rather than long, and the boat day gives your legs a rest. Best in May, June, September and October, when the coast road is bearable.',
    destination: place('amalfi'),
    themes: ['Walking & hiking', 'Beach'],
    activities: ['Walking', 'Food tour'],
    audience: ['Couples', 'Solo'],
    durationDays: 4,
    priceFrom: 780,
    currency: 'GBP',
    rating: 4.3,
    reviewCount: 298,
    climate: 'mild',
    months: [4, 5, 6, 9, 10],
    directFlights: true,
    groupSizeMax: 16,
    available: true,
    imageUrl: img(PHOTOS.positano),
    gallery: shots(PHOTOS.positano, PHOTOS.amalfi, PHOTOS.islands),
    supplier: 'Sentiero Collective',
    sources: ['cms', 'supplier-atlas'],
  },
  {
    id: 'trip-14',
    slug: 'bernese-oberland-walks-and-rail',
    title: 'Bernese Oberland Alpine Walks & Rail',
    summary:
      'Eight days pairing the Jungfrau rack railways with day walks from Grindelwald and car-free Wengen.',
    description:
      'A regional rail pass covers every train and lift, so you decide over breakfast how high to go and how far to walk. The highlights are the Eiger Trail under the north face, the Schynige Platte ridge and the little train up to Kleine Scheidegg. Two nights are in Wengen, which is quiet once the day trippers leave.',
    destination: place('grindelwald'),
    themes: ['Walking & hiking', 'Rail journeys'],
    activities: ['Walking', 'Rail travel'],
    audience: ['Small groups', 'Family', 'Couples'],
    durationDays: 8,
    priceFrom: 1875,
    currency: 'GBP',
    rating: 4.8,
    reviewCount: 402,
    climate: 'mild',
    months: [6, 7, 8, 9],
    directFlights: false,
    groupSizeMax: 14,
    available: true,
    imageUrl: img(PHOTOS.alps),
    gallery: shots(PHOTOS.alps, PHOTOS.rockies, PHOTOS.openRoad),
    supplier: 'Alpine Foot Travel',
    sources: ['cms', 'enrichment'],
    badges: ['Rail pass included'],
  },

  // ---- Winter sun and warm water ---------------------------------------
  {
    id: 'trip-15',
    slug: 'agadir-atlantic-winter-sun',
    title: 'Agadir Atlantic Winter Sun',
    summary: 'A week of reliable Atlantic sunshine, a six-mile beach and a souk that still sells to locals.',
    description:
      'Agadir gets around eight hours of winter sunshine a day and direct flights from four UK airports, which is why it stays busy from October to April. You are in a garden hotel ten minutes on foot from the beach, half board, with an optional day in the Paradise Valley gorges. This is not a cultural trip; it is for the sun.',
    destination: place('agadir'),
    themes: ['Winter sun', 'Beach'],
    activities: ['Walking', 'Food tour'],
    audience: ['Family', 'Couples'],
    durationDays: 7,
    priceFrom: 489,
    currency: 'GBP',
    rating: 4.1,
    reviewCount: 1284,
    climate: 'warm',
    months: [1, 2, 3, 4, 10, 11, 12],
    directFlights: true,
    groupSizeMax: 40,
    available: true,
    imageUrl: img(PHOTOS.morocco),
    gallery: shots(PHOTOS.morocco, PHOTOS.islands, PHOTOS.openRoad),
    supplier: 'Isla Sol Holidays',
    sources: ['supplier-atlas'],
    badges: ['Half board included'],
  },
  {
    id: 'trip-16',
    slug: 'marrakech-souks-and-atlas-foothills',
    title: 'Marrakech Souks & Atlas Foothills',
    summary: 'Five days split between a six-room riad in the medina and the Berber villages of the Ourika valley.',
    description:
      'Two nights in a riad off the Rue Riad Zitoun, a guided walk through the souks with someone who will stop you buying badly, and a cookery afternoon in a private house. You then move up to a kasbah in the Atlas foothills for two nights of easy walking between villages. Add a night in the Agafay desert if you want the silence.',
    destination: place('marrakech'),
    themes: ['Culture', 'Winter sun'],
    activities: ['Food tour', 'Walking', 'Cooking class'],
    audience: ['Couples', 'Solo', 'Small groups'],
    durationDays: 5,
    priceFrom: 745,
    currency: 'GBP',
    rating: 4.6,
    reviewCount: 932,
    climate: 'warm',
    months: [1, 2, 3, 4, 5, 9, 10, 11, 12],
    directFlights: true,
    groupSizeMax: 16,
    available: true,
    imageUrl: img(PHOTOS.morocco),
    gallery: shots(PHOTOS.morocco, PHOTOS.redRock, PHOTOS.india),
    supplier: 'Atlas & Sur',
    sources: ['cms', 'supplier-atlas', 'enrichment'],
  },
  {
    id: 'trip-17',
    slug: 'tenerife-winter-sun-teide-trails',
    title: 'Tenerife Winter Sun & Teide Trails',
    summary: 'Winter sun on the green north of the island, with three walking days on Teide and in the Anaga forest.',
    description:
      'Puerto de la Cruz is the older, greener side of Tenerife: bougainvillea, a working banana coast and a proper town square. Three days are spent walking — the Teide crater rim, the Masca gorge and the Anaga laurel cloud forest — and the rest is yours. Departures run every week of the year and the January weather is genuinely reliable.',
    destination: place('tenerife'),
    themes: ['Winter sun', 'Walking & hiking'],
    activities: ['Walking', 'Photography'],
    audience: ['Family', 'Couples', 'Solo'],
    durationDays: 7,
    priceFrom: 649,
    currency: 'GBP',
    rating: 4.4,
    reviewCount: 2140,
    climate: 'warm',
    months: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12],
    directFlights: true,
    groupSizeMax: 30,
    available: true,
    imageUrl: img(PHOTOS.islands),
    gallery: shots(PHOTOS.islands, PHOTOS.positano, PHOTOS.alps),
    supplier: 'Isla Sol Holidays',
    sources: ['cms', 'supplier-atlas'],
    badges: ['Weekly departures'],
  },
  {
    id: 'trip-18',
    slug: 'madeira-levada-walks-and-wine',
    title: 'Madeira Levada Walks & Wine',
    summary: 'Seven days on the levada channels above Funchal, ending with a tasting older than you are.',
    description:
      'The levadas are irrigation channels with flat maintenance paths beside them, which is why Madeira suits walkers who do not want to climb all day. You walk on five of the seven days, including the Caldeirão Verde and the Rabaçal 25 Fontes, and stay in one hotel in Funchal throughout. The last afternoon is a tasting of three Madeiras, one of them from the 1970s.',
    destination: place('funchal'),
    themes: ['Walking & hiking', 'Food & wine', 'Winter sun'],
    activities: ['Walking', 'Wine tasting'],
    audience: ['Couples', 'Small groups', 'Solo'],
    durationDays: 7,
    priceFrom: 860,
    currency: 'GBP',
    rating: 4.7,
    reviewCount: 876,
    climate: 'warm',
    months: [1, 2, 3, 4, 5, 9, 10, 11, 12],
    directFlights: true,
    groupSizeMax: 14,
    available: true,
    imageUrl: img(PHOTOS.positano),
    gallery: shots(PHOTOS.positano, PHOTOS.islands, PHOTOS.amalfi),
    supplier: 'Isla Sol Holidays',
    sources: ['cms', 'enrichment'],
  },
  {
    id: 'trip-19',
    slug: 'algarve-coast-and-cliff-walks',
    title: 'Algarve Coast & Cliff Walks',
    summary: 'A week of cliff-top walking on the Rota Vicentina, out of season and largely alone.',
    description:
      'The western Algarve between Sagres and Carrapateira empties out from October, and November still gives you twenty degrees and eight hours of light. The walking is superb: sandstone cliffs, storks nesting on sea stacks and a beach at the end of most days. You stay in two small hotels and walk five days of twelve to eighteen kilometres.',
    destination: place('sagres'),
    themes: ['Winter sun', 'Beach', 'Walking & hiking'],
    activities: ['Walking', 'Photography'],
    audience: ['Couples', 'Small groups', 'Family'],
    durationDays: 7,
    priceFrom: 575,
    currency: 'GBP',
    rating: 4.5,
    reviewCount: 641,
    climate: 'warm',
    months: [3, 4, 5, 6, 9, 10, 11],
    directFlights: true,
    groupSizeMax: 16,
    available: true,
    imageUrl: img(PHOTOS.islands),
    gallery: shots(PHOTOS.islands, PHOTOS.positano, PHOTOS.openRoad),
    supplier: 'Isla Sol Holidays',
    sources: ['cms', 'supplier-atlas'],
  },
  {
    id: 'trip-20',
    slug: 'zanzibar-spice-coast-and-reef',
    title: 'Zanzibar Spice Coast & Reef',
    summary: 'Ten days between the alleys of Stone Town and a beach hotel on the Mnemba channel.',
    description:
      'Three nights in a merchant house in Stone Town, a spice farm morning and a dhow out to the sandbank, then a week on the east coast where the reef is a five-minute boat ride away. PADI courses run from the hotel and non-divers snorkel the same sites. October to February gives the clearest water.',
    destination: place('stone-town'),
    themes: ['Beach', 'Wellness', 'Culture'],
    activities: ['Diving', 'Snorkelling', 'Food tour'],
    audience: ['Couples', 'Family'],
    durationDays: 10,
    priceFrom: 2240,
    currency: 'GBP',
    rating: 4.6,
    reviewCount: 318,
    climate: 'warm',
    months: [1, 2, 6, 7, 8, 9, 10, 11, 12],
    directFlights: false,
    groupSizeMax: 16,
    available: true,
    imageUrl: img(PHOTOS.bali),
    gallery: shots(PHOTOS.bali, PHOTOS.islands, PHOTOS.india),
    supplier: 'Meridian Long Haul',
    sources: ['supplier-atlas', 'enrichment'],
  },
  {
    id: 'trip-21',
    slug: 'bali-ubud-rice-terraces-and-wellness',
    title: 'Bali: Ubud Rice Terraces & Wellness',
    summary: 'Eleven days of rice terraces, temple mornings and two nights snorkelling off Nusa Lembongan.',
    description:
      'Ubud first, in a compound above the Petanu river, with sunrise walks through the Tegallalang terraces and a Balinese cookery day. You then cross to Nusa Lembongan for snorkelling with manta rays before finishing on the quieter west coast. Yoga and treatments are included but never compulsory.',
    destination: place('ubud'),
    themes: ['Wellness', 'Culture', 'Beach'],
    activities: ['Walking', 'Cooking class', 'Snorkelling'],
    audience: ['Couples', 'Solo'],
    durationDays: 11,
    priceFrom: 1895,
    currency: 'GBP',
    rating: 4.5,
    reviewCount: 1102,
    climate: 'warm',
    months: [4, 5, 6, 7, 8, 9, 10],
    directFlights: false,
    groupSizeMax: 12,
    available: true,
    imageUrl: img(PHOTOS.bali),
    gallery: shots(PHOTOS.bali, PHOTOS.kyoto, PHOTOS.islands),
    supplier: 'Meridian Long Haul',
    sources: ['cms', 'supplier-atlas'],
  },

  // ---- Culture, rail and islands ---------------------------------------
  {
    id: 'trip-22',
    slug: 'kyoto-temples-gardens-ryokan-nights',
    title: 'Kyoto Temples, Gardens & Ryokan Nights',
    summary: 'Nine days in Kyoto and Kanazawa with two ryokan nights and every rail leg included.',
    description:
      'Kyoto rewards slowness, so this itinerary gives you six nights there rather than three: Fushimi Inari before the crowds, the moss garden at Saihō-ji by written application, and a tea ceremony in a private machiya. Two nights are in a Kanazawa ryokan with a kaiseki dinner and a garden older than the city walls. Autumn 2026 is sold out; spring 2027 opens for sale in September.',
    destination: place('kyoto'),
    themes: ['Culture', 'Rail journeys', 'Food & wine'],
    activities: ['Walking', 'Rail travel', 'Food tour'],
    audience: ['Couples', 'Solo', 'Small groups'],
    durationDays: 9,
    priceFrom: 2680,
    currency: 'GBP',
    rating: 4.9,
    reviewCount: 264,
    climate: 'mild',
    months: [3, 4, 5, 10, 11],
    directFlights: true,
    groupSizeMax: 12,
    available: false,
    imageUrl: img(PHOTOS.kyoto),
    gallery: shots(PHOTOS.kyoto, PHOTOS.bali, PHOTOS.openRoad),
    supplier: 'Kōyō Rail Journeys',
    sources: ['cms', 'enrichment'],
    badges: ['All rail included'],
  },
  {
    id: 'trip-23',
    slug: 'kerala-backwaters-and-spice-hills',
    title: 'Kerala Backwaters & Spice Hills',
    summary: 'Ten days from Fort Kochi up to the tea hills and down to your own houseboat on the Vembanad.',
    description:
      'Two nights in Fort Kochi for the Chinese fishing nets and a kathakali performance, then up to Munnar where the tea estates start at 1,600 metres and the walking is cool. You come down to Alleppey for a night on a private houseboat with a cook aboard, and finish on the beach at Marari. October to March is the dry season.',
    destination: place('kochi'),
    themes: ['Culture', 'Wellness', 'Wildlife'],
    activities: ['Walking', 'Food tour', 'Cooking class'],
    audience: ['Couples', 'Family', 'Small groups'],
    durationDays: 10,
    priceFrom: 1760,
    currency: 'GBP',
    rating: 4.7,
    reviewCount: 388,
    climate: 'warm',
    months: [1, 2, 3, 10, 11, 12],
    directFlights: false,
    groupSizeMax: 14,
    available: true,
    imageUrl: img(PHOTOS.india),
    gallery: shots(PHOTOS.india, PHOTOS.bali, PHOTOS.kyoto),
    supplier: 'Deccan Odyssey Travel',
    sources: ['cms', 'enrichment'],
  },
  {
    id: 'trip-24',
    slug: 'rajasthan-cities-of-colour-by-rail',
    title: 'Rajasthan: Cities of Colour by Rail',
    summary: 'Twelve days from Delhi to Udaipur entirely by train, with two nights under canvas in the Thar desert.',
    description:
      'Every long leg is by train — chair car by day, first-class sleeper twice — which is the honest way to see Rajasthan and much kinder than the road. Jaipur, Bikaner, Jaisalmer, Jodhpur and Udaipur, with a camel night near Khuri and an early morning at the Taj on the way through Agra. Hotels are heritage havelis rather than chains.',
    destination: place('jaipur'),
    themes: ['Culture', 'Rail journeys'],
    activities: ['Rail travel', 'Walking', 'Food tour'],
    audience: ['Couples', 'Solo', 'Small groups'],
    durationDays: 12,
    priceFrom: 1540,
    currency: 'GBP',
    rating: 4.6,
    reviewCount: 512,
    climate: 'warm',
    months: [1, 2, 3, 10, 11, 12],
    directFlights: false,
    groupSizeMax: 16,
    available: true,
    imageUrl: img(PHOTOS.india),
    gallery: shots(PHOTOS.india, PHOTOS.morocco, PHOTOS.kyoto),
    supplier: 'Deccan Odyssey Travel',
    sources: ['cms', 'supplier-atlas', 'enrichment'],
    badges: ['No internal flights'],
  },
  {
    id: 'trip-25',
    slug: 'cyclades-island-hopping-by-ferry',
    title: 'Cyclades Island Hopping by Ferry',
    summary: 'Ten days and four islands — Naxos, Amorgos, Koufonisia and Santorini — on the public ferries.',
    description:
      'Ferry-hopping done properly: a fixed room on each island and pre-booked deck tickets, but no coach and no group. Naxos for the beaches and the mountain villages, Amorgos for the cliff monastery, Koufonisia because almost nobody goes, then two nights in Oia to finish. Late May and September are the sweet spots.',
    destination: place('santorini'),
    themes: ['Beach', 'Culture', 'Walking & hiking'],
    activities: ['Walking', 'Snorkelling', 'Food tour'],
    audience: ['Couples', 'Solo'],
    durationDays: 10,
    priceFrom: 1560,
    currency: 'GBP',
    rating: 4.5,
    reviewCount: 447,
    climate: 'warm',
    months: [5, 6, 7, 8, 9, 10],
    directFlights: true,
    groupSizeMax: 4,
    available: true,
    imageUrl: img(PHOTOS.islands),
    gallery: shots(PHOTOS.islands, PHOTOS.amalfi, PHOTOS.positano),
    supplier: 'Aegean Ferry Co',
    sources: ['cms', 'supplier-atlas'],
  },
  {
    id: 'trip-26',
    slug: 'santorini-caldera-days',
    title: 'Santorini Caldera Days',
    summary: 'Five nights on the caldera rim with a catamaran day and the Fira to Oia path at dawn.',
    description:
      'A short, comfortable break in a cave hotel above Imerovigli with a plunge pool and the whole caldera in front of it. One day is on a catamaran round the hot springs and Red Beach; the rest is yours. Walk the ten kilometres from Fira to Oia early, because by ten in the morning it belongs to the cruise ships.',
    destination: place('santorini'),
    themes: ['Beach', 'City break'],
    activities: ['Walking', 'Snorkelling'],
    audience: ['Couples'],
    durationDays: 5,
    priceFrom: 1220,
    currency: 'GBP',
    rating: 3.9,
    reviewCount: 214,
    climate: 'warm',
    months: [4, 5, 6, 9, 10],
    directFlights: true,
    groupSizeMax: 2,
    available: true,
    imageUrl: img(PHOTOS.islands),
    gallery: shots(PHOTOS.islands, PHOTOS.amalfi, PHOTOS.positano),
    supplier: 'Aegean Ferry Co',
    sources: ['supplier-atlas'],
  },

  // ---- Long-haul walking, wildlife and self-drive ----------------------
  {
    id: 'trip-27',
    slug: 'patagonia-fitz-roy-and-ice-fields',
    title: 'Patagonia: Fitz Roy & Ice Fields Trek',
    summary: 'Fourteen days trekking out of El Chaltén, finishing with crampons on the Perito Moreno glacier.',
    description:
      'Six trekking days from El Chaltén — Laguna de los Tres, Laguna Torre and the first half of the Huemul circuit — then across to El Calafate for the ice field and a guided walk on the glacier itself. Wind is the defining fact of this trip, and days are reordered around it rather than fought. Twelve travellers, one guide per six.',
    destination: place('el-chalten'),
    themes: ['Walking & hiking'],
    activities: ['Walking', 'Kayaking', 'Photography'],
    audience: ['Small groups', 'Adventure', 'Solo'],
    durationDays: 14,
    priceFrom: 3690,
    currency: 'GBP',
    rating: 4.8,
    reviewCount: 176,
    climate: 'mild',
    months: [1, 2, 3, 10, 11, 12],
    directFlights: false,
    groupSizeMax: 12,
    available: true,
    imageUrl: img(PHOTOS.patagonia),
    gallery: shots(PHOTOS.patagonia, PHOTOS.newZealand, PHOTOS.alps),
    supplier: 'Austral Trekking',
    sources: ['cms', 'supplier-atlas', 'enrichment'],
    badges: ['One guide per six'],
  },
  {
    id: 'trip-28',
    slug: 'new-zealand-south-island-grand-tour',
    title: 'New Zealand South Island Grand Tour',
    summary: 'Sixteen days Christchurch to Queenstown by car, with the TranzAlpine one way and three Great Walk day sections.',
    description:
      'A self-drive with the driving days held to four hours, the TranzAlpine railway included westbound and the car dropped at the other end. Franz Josef, Wanaka, Milford Sound by boat, and a day section each of the Routeburn, Kepler and Abel Tasman tracks. February and March are the settled months.',
    destination: place('queenstown'),
    themes: ['Self-drive', 'Walking & hiking', 'Rail journeys'],
    activities: ['Walking', 'Rail travel', 'Kayaking'],
    audience: ['Couples', 'Family'],
    durationDays: 16,
    priceFrom: 4200,
    currency: 'GBP',
    rating: 4.7,
    reviewCount: 209,
    climate: 'mild',
    months: [1, 2, 3, 10, 11, 12],
    directFlights: false,
    groupSizeMax: 4,
    available: true,
    imageUrl: img(PHOTOS.newZealand),
    gallery: shots(PHOTOS.newZealand, PHOTOS.patagonia, PHOTOS.openRoad),
    supplier: 'Kiwi Roads',
    sources: ['cms', 'supplier-atlas'],
  },
  {
    id: 'trip-29',
    slug: 'queenstown-lakes-and-fiordland-walks',
    title: 'Queenstown Lakes & Fiordland Walks',
    summary: 'Nine days of guided day walks from one lakeside base, plus two nights in Te Anau for Milford.',
    description:
      'Day walks that use boats and shuttles to reach trailheads you cannot drive to: Routeburn Flats, the Ben Lomond saddle and a full day on the Milford Track from Sandfly Point. Evenings are back in a lakeside hotel with a bath and a kitchen that stays open late. Six hours of walking a day, comfortable rather than punishing.',
    destination: place('queenstown'),
    themes: ['Walking & hiking'],
    activities: ['Walking', 'Kayaking'],
    audience: ['Small groups', 'Couples', 'Adventure'],
    durationDays: 9,
    priceFrom: 2890,
    currency: 'GBP',
    rating: 4.6,
    reviewCount: 143,
    climate: 'mild',
    months: [1, 2, 3, 11, 12],
    directFlights: false,
    groupSizeMax: 12,
    available: true,
    imageUrl: img(PHOTOS.newZealand),
    gallery: shots(PHOTOS.newZealand, PHOTOS.alps, PHOTOS.patagonia),
    supplier: 'Kiwi Roads',
    sources: ['supplier-atlas', 'enrichment'],
  },
  {
    id: 'trip-30',
    slug: 'banff-powder-week',
    title: 'Banff Powder Week',
    summary: 'Seven days on the Big Three lift pass, with an instructor for the first two mornings.',
    description:
      'A ski week in Banff town rather than a purpose-built resort, which means restaurants that stay open and a free bus to Sunshine, Norquay and Lake Louise. Two mornings with a local instructor to find the tree runs, and a rest-day option of the Johnston Canyon icewalk. January and February hold the driest snow.',
    destination: place('banff'),
    themes: ['Ski & snow'],
    activities: ['Skiing', 'Walking'],
    audience: ['Family', 'Couples', 'Adventure'],
    durationDays: 7,
    priceFrom: 1780,
    currency: 'GBP',
    rating: 4.5,
    reviewCount: 356,
    climate: 'cold',
    months: [1, 2, 3, 4, 12],
    directFlights: false,
    groupSizeMax: 20,
    available: true,
    imageUrl: img(PHOTOS.rockies),
    gallery: shots(PHOTOS.rockies, PHOTOS.alps, PHOTOS.aurora),
    supplier: 'Rockies Wildlife Co',
    sources: ['cms', 'supplier-atlas'],
    badges: ['Lift pass included'],
  },
  {
    id: 'trip-31',
    slug: 'canadian-rockies-wildlife-and-lakes',
    title: 'Canadian Rockies Wildlife & Lakes',
    summary: 'Nine days between Banff and Jasper with a naturalist, on the Icefields Parkway before the coaches.',
    description:
      'Dawn starts for bears, elk and bighorn sheep with a guide who counts them for Parks Canada, canoes on Moraine Lake and a day walk up to Wilcox Pass. One night in Jasper is given to the dark-sky preserve. Waiting list only for 2027: the parks cap our permits at eight departures a year.',
    destination: place('banff'),
    themes: ['Wildlife', 'Walking & hiking'],
    activities: ['Wildlife watching', 'Walking', 'Kayaking', 'Photography'],
    audience: ['Small groups', 'Family'],
    durationDays: 9,
    priceFrom: 2340,
    currency: 'GBP',
    rating: 4.8,
    reviewCount: 231,
    climate: 'mild',
    months: [6, 7, 8, 9],
    directFlights: false,
    groupSizeMax: 12,
    available: false,
    imageUrl: img(PHOTOS.rockies),
    gallery: shots(PHOTOS.rockies, PHOTOS.newZealand, PHOTOS.patagonia),
    supplier: 'Rockies Wildlife Co',
    sources: ['cms', 'enrichment'],
  },
  {
    id: 'trip-32',
    slug: 'utah-canyon-country-self-drive',
    title: 'Utah Canyon Country Self-Drive',
    summary: 'Ten days and 1,100 miles round Moab, Bryce and Zion, with the permit lotteries entered on your behalf.',
    description:
      'The classic loop driven anticlockwise so you reach Zion mid-week rather than at the weekend. We enter the Angels Landing lottery and apply for the Subway permit for you, and tell you honestly whether they came through. Two nights in Moab cover Arches at sunrise and an afternoon on a jeep trail.',
    destination: place('moab'),
    themes: ['Self-drive', 'Walking & hiking'],
    activities: ['Walking', 'Cycling', 'Photography'],
    audience: ['Couples', 'Family', 'Adventure'],
    durationDays: 10,
    priceFrom: 2150,
    currency: 'GBP',
    rating: 4.4,
    reviewCount: 267,
    climate: 'warm',
    months: [4, 5, 9, 10],
    directFlights: false,
    groupSizeMax: 4,
    available: true,
    imageUrl: img(PHOTOS.redRock),
    gallery: shots(PHOTOS.redRock, PHOTOS.openRoad, PHOTOS.morocco),
    supplier: 'Canyon Country Tours',
    sources: ['supplier-atlas', 'enrichment'],
  },
  {
    id: 'trip-33',
    slug: 'ranthambore-tiger-safari-and-jaipur',
    title: 'Ranthambore Tiger Safari & Jaipur',
    summary: 'Eight days with six game drives in Ranthambore, bookended by two nights in a Jaipur haveli.',
    description:
      'Six drives is the number that matters: tigers are seen on roughly half of them, and anyone promising more is selling you something. Zones are allocated by the forest department, so we book across mornings and afternoons to spread the odds. Jaipur first for Amber and the Hawa Mahal, then the train down to Sawai Madhopur.',
    destination: place('jaipur'),
    themes: ['Wildlife', 'Culture'],
    activities: ['Wildlife watching', 'Rail travel', 'Photography'],
    audience: ['Family', 'Couples', 'Small groups'],
    durationDays: 8,
    priceFrom: 1640,
    currency: 'GBP',
    rating: 4.6,
    reviewCount: 298,
    climate: 'warm',
    months: [1, 2, 3, 4, 10, 11, 12],
    directFlights: false,
    groupSizeMax: 12,
    available: true,
    imageUrl: img(PHOTOS.india),
    gallery: shots(PHOTOS.india, PHOTOS.redRock, PHOTOS.morocco),
    supplier: 'Deccan Odyssey Travel',
    sources: ['cms', 'supplier-atlas', 'enrichment'],
    badges: ['Six game drives'],
  },
]

// Queries we know return good results — used for the empty state and as the top-up when a
// search returns nothing.
export const SUGGESTED_QUERIES = [
  'northern lights trip for a family next winter, not too expensive',
  '7 day walking holiday in italy with small groups',
  'somewhere warm in november under 1200 direct flights',
  'wildlife trip for a family with direct flights',
]

const MONTH_NAMES = [
  'january',
  'february',
  'march',
  'april',
  'may',
  'june',
  'july',
  'august',
  'september',
  'october',
  'november',
  'december',
]

const MONTHS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]

// Seasons keep their own month order so a chip reads 'November – March' rather than 'January – December'.
const SEASONS: Record<string, number[]> = {
  winter: [11, 12, 1, 2, 3],
  spring: [3, 4, 5],
  summer: [6, 7, 8],
  autumn: [9, 10, 11],
  fall: [9, 10, 11],
}

const DURATION_RE = /\b(\d{1,2})\s*[- ]?\s*(day|days|night|nights|week|weeks)\b/
const MAX_PRICE_RE =
  /(?:under|below|less than|no more than|max(?:imum)?(?: of)?|up to|budget of|around)\s*£?\s*(\d[\d,]*)/
const BARE_PRICE_RE = /£\s*(\d[\d,]*)/
const GROUP_SIZE_RE = /\b(?:group of|party of|there (?:are|will be)|we are)\s*(\d{1,2})\b/
const DIRECT_RE = /(^|[^a-z])(direct|non-?stop|no connections?)([^a-z]|$)/
const VAGUE_BUDGET_RE = /\b(cheap|budget|affordable|inexpensive|good value|not too expensive)\b/

// A vague budget still has to become a number. £1,200 is the ceiling the analytics panel
// shows for these phrasings, so that is what the heuristic uses.
const VAGUE_BUDGET_CEILING = 1200

// Spelled out rather than done with a Unicode range, because the only accents that matter
// are the ones actually in this catalogue and an invisible character class reads like a bug.
const ACCENT_PAIRS: [string, string][] = [
  ['ø', 'o'],
  ['å', 'a'],
  ['æ', 'ae'],
  ['á', 'a'],
  ['ā', 'a'],
  ['é', 'e'],
  ['è', 'e'],
  ['í', 'i'],
  ['ó', 'o'],
  ['ô', 'o'],
  ['õ', 'o'],
  ['ō', 'o'],
  ['ü', 'u'],
  ['ç', 'c'],
  ['ñ', 'n'],
  ['þ', 'th'],
  ['ð', 'd'],
]

// Lower-cased and unaccented, so 'tromso' finds Tromsø and 'reykjavik' finds Reykjavík.
function fold(value: string): string {
  let out = value.toLowerCase()
  for (const [from, to] of ACCENT_PAIRS) {
    if (out.includes(from)) out = out.split(from).join(to)
  }
  return out
}

// Prefix match, so 'walk' also catches 'walking' but 'ski' never matches 'Helsinki'.
function startsWord(text: string, phrase: string): boolean {
  return new RegExp(`(^|[^a-z0-9])${phrase}`).test(text)
}

// Whole-word match for hints that are common substrings — 'hot' would otherwise match 'hotel'.
function wholeWord(text: string, phrase: string): boolean {
  return new RegExp(`(^|[^a-z0-9])${phrase}([^a-z0-9]|$)`).test(text)
}

function matchVocabulary<T extends string>(text: string, hints: Record<T, string[]>): T[] {
  const keys = Object.keys(hints) as T[]
  return keys.filter((key) => hints[key].some((hint) => startsWord(text, hint)))
}

function readMonths(text: string): number[] {
  const found: number[] = []
  const add = (month: number): void => {
    if (!found.includes(month)) found.push(month)
  }
  // 'may' is a month and also a verb; the backend's LLM path resolves that, the heuristic
  // accepts the occasional false positive.
  MONTH_NAMES.forEach((name, i) => {
    if (wholeWord(text, name) || wholeWord(text, name.slice(0, 3))) add(i + 1)
  })
  for (const [season, months] of Object.entries(SEASONS)) {
    if (wholeWord(text, season)) months.forEach(add)
  }
  return found
}

function readDuration(text: string): number | undefined {
  const match = DURATION_RE.exec(text)
  if (match) {
    const count = Number(match[1])
    if (count < 1 || count > 40) return undefined
    if (match[2].startsWith('week')) return count * 7
    if (match[2].startsWith('night')) return count + 1
    return count
  }
  if (wholeWord(text, 'long weekend')) return 4
  if (wholeWord(text, 'weekend')) return 3
  return undefined
}

function readMaxPrice(text: string): number | undefined {
  const phrase = MAX_PRICE_RE.exec(text) ?? BARE_PRICE_RE.exec(text)
  if (phrase) {
    const amount = Number(phrase[1].replace(/,/g, ''))
    if (amount >= 100) return amount
  }
  if (VAGUE_BUDGET_RE.test(text)) return VAGUE_BUDGET_CEILING
  return undefined
}

// Most specific first: a place name beats a region, which beats a country, so 'italy'
// widens to every Italian trip while 'tromso' stays put.
function readDestination(text: string): string | undefined {
  for (const key of ['name', 'region', 'country'] as const) {
    const hit = DESTINATIONS.find((d) => startsWord(text, fold(d[key])))
    if (hit) return hit[key]
  }
  return undefined
}

export function localParse(query: string): ParsedQuery {
  const text = fold(query)
  const parsed: ParsedQuery = { source: 'heuristic', confidence: 0 }

  const months = readMonths(text)
  if (months.length > 0) parsed.months = months

  const durationDays = readDuration(text)
  if (durationDays !== undefined) parsed.durationDays = durationDays

  const maxPrice = readMaxPrice(text)
  if (maxPrice !== undefined) parsed.maxPrice = maxPrice

  const themes = matchVocabulary(text, THEME_HINTS)
  if (themes.length > 0) parsed.themes = themes

  const activities = matchVocabulary(text, ACTIVITY_HINTS)
  if (activities.length > 0) parsed.activities = activities

  const audience = matchVocabulary(text, AUDIENCE_HINTS)
  if (audience.length > 0) parsed.audience = audience

  const climate = (Object.keys(CLIMATE_HINTS) as Climate[]).find((key) =>
    CLIMATE_HINTS[key].some((hint) => wholeWord(text, hint)),
  )
  if (climate) parsed.climate = climate

  const destination = readDestination(text)
  if (destination) parsed.destination = destination

  if (DIRECT_RE.test(text)) parsed.directFlights = true

  const groupSize = GROUP_SIZE_RE.exec(text)
  if (groupSize) parsed.groupSizeMax = Number(groupSize[1])

  const extracted = [
    parsed.destination,
    parsed.months,
    parsed.durationDays,
    parsed.maxPrice,
    parsed.themes,
    parsed.activities,
    parsed.audience,
    parsed.climate,
    parsed.groupSizeMax,
    parsed.directFlights,
  ].filter((value) => value !== undefined).length

  parsed.confidence = extracted === 0 ? 0.2 : Math.min(0.9, 0.34 + extracted * 0.11)
  return parsed
}

const STOP_WORDS = new Set([
  'and', 'any', 'are', 'about', 'all', 'around', 'best', 'break', 'breaks', 'can', 'day', 'days',
  'find', 'for', 'from', 'good', 'holiday', 'holidays', 'into', 'like', 'looking', 'need', 'near',
  'next', 'night', 'nights', 'not', 'our', 'over', 'please', 'really', 'show', 'some', 'somewhere',
  'that', 'the', 'their', 'there', 'this', 'too', 'trip', 'trips', 'under', 'very', 'want', 'was',
  'week', 'weeks', 'with', 'without', 'would', 'you',
])

function tokenise(query: string): string[] {
  return fold(query)
    .split(/[^a-z0-9]+/)
    .filter((token) => token.length > 2 && !STOP_WORDS.has(token))
}

interface Effective {
  destination?: string
  themes: string[]
  activities: string[]
  audience: string[]
  months: number[]
  maxPrice?: number
  minDuration?: number
  maxDuration?: number
  climate?: Climate
  directOnly: boolean
  availableOnly: boolean
}

// An explicit UI filter always wins over one the parser inferred — same precedence as the
// search router applies on the backend.
function mergeFilters(parsed: ParsedQuery, filters?: SearchFilters): Effective {
  const stated = filters ?? {}
  const effective: Effective = {
    destination: stated.destination ?? parsed.destination,
    themes: stated.theme ? [stated.theme] : (parsed.themes ?? []),
    activities: stated.activity ? [stated.activity] : (parsed.activities ?? []),
    audience: stated.audience ? [stated.audience] : (parsed.audience ?? []),
    months: stated.month ? [stated.month] : (parsed.months ?? []),
    maxPrice: stated.maxPrice ?? parsed.maxPrice,
    minDuration: stated.minDuration,
    maxDuration: stated.maxDuration,
    climate: stated.climate ?? parsed.climate,
    directOnly: stated.directOnly ?? parsed.directFlights ?? false,
    availableOnly: stated.availableOnly ?? false,
  }
  // A stated trip length is a preference, not a contract: one day either side still answers
  // 'a 7 day walking holiday'.
  if (parsed.durationDays !== undefined && stated.minDuration === undefined && stated.maxDuration === undefined) {
    effective.minDuration = parsed.durationDays - 1
    effective.maxDuration = parsed.durationDays + 1
  }
  return effective
}

function destinationMatches(trip: Trip, needle: string): boolean {
  const target = fold(needle)
  const { name, region, country, slug } = trip.destination
  return [name, region, country, slug].some((value) => fold(value).includes(target))
}

function matches(trip: Trip, f: Effective): boolean {
  if (f.destination && !destinationMatches(trip, f.destination)) return false
  if (f.themes.length > 0 && !f.themes.some((theme) => trip.themes.includes(theme))) return false
  if (f.activities.length > 0 && !f.activities.some((a) => trip.activities.includes(a))) return false
  if (f.audience.length > 0 && !f.audience.some((a) => trip.audience.includes(a as Audience))) return false
  if (f.months.length > 0 && !f.months.some((month) => trip.months.includes(month))) return false
  if (f.maxPrice !== undefined && trip.priceFrom > f.maxPrice) return false
  if (f.minDuration !== undefined && trip.durationDays < f.minDuration) return false
  if (f.maxDuration !== undefined && trip.durationDays > f.maxDuration) return false
  if (f.climate && trip.climate !== f.climate) return false
  if (f.directOnly && !trip.directFlights) return false
  if (f.availableOnly && !trip.available) return false
  return true
}

// Pin and boost rules from the admin panel. The backend also honours 'hide'; the offline
// fallback deliberately does not, so a demo never loses a trip with no explanation on screen.
const BOOSTS = new Map(PROMOTIONS.filter((p) => p.kind === 'boost').map((p) => [p.tripId, p.weight]))

const FIELD_WEIGHTS: [(trip: Trip) => string, number][] = [
  [(trip) => trip.title, 0.34],
  [(trip) => `${trip.destination.name} ${trip.destination.region} ${trip.destination.country}`, 0.24],
  [(trip) => trip.themes.join(' '), 0.18],
  [(trip) => trip.audience.join(' '), 0.16],
  [(trip) => trip.activities.join(' '), 0.14],
  [(trip) => `${trip.summary} ${trip.description}`, 0.06],
]

function textScore(trip: Trip, tokens: string[]): { score: number; hits: string[] } {
  if (tokens.length === 0) return { score: 0, hits: [] }
  const fields = FIELD_WEIGHTS.map(([read, weight]) => [fold(read(trip)), weight] as const)
  let total = 0
  const hits: string[] = []
  for (const token of tokens) {
    let best = 0
    for (const [text, weight] of fields) {
      if (text.includes(token)) best = Math.max(best, weight)
    }
    total += best
    if (best >= 0.16) hits.push(token)
  }
  return { score: total / tokens.length, hits }
}

const round2 = (value: number): number => Math.round(value * 100) / 100

function monthRangeLabel(months: number[]): string {
  if (months.length === 1) return `month: ${monthName(months[0])}`
  return `months: ${monthName(months[0])} – ${monthName(months[months.length - 1])}`
}

function scoreTrip(trip: Trip, tokens: string[], f: Effective, parsed: ParsedQuery): SearchResult {
  const matchedOn: string[] = []
  let reasons = 0

  if (f.destination && destinationMatches(trip, f.destination)) {
    matchedOn.push(`destination: ${f.destination}`)
    reasons += 0.14
  }
  const theme = f.themes.find((value) => trip.themes.includes(value))
  if (theme) {
    matchedOn.push(`theme: ${theme}`)
    reasons += 0.12
  }
  const activity = f.activities.find((value) => trip.activities.includes(value))
  if (activity) {
    matchedOn.push(`activity: ${activity}`)
    reasons += 0.08
  }
  const who = f.audience.find((value) => trip.audience.includes(value as Audience))
  if (who) {
    matchedOn.push(`audience: ${who}`)
    reasons += 0.1
  }
  if (f.months.length > 0 && f.months.some((month) => trip.months.includes(month))) {
    matchedOn.push(monthRangeLabel(f.months))
    reasons += 0.08
  }
  if (f.maxPrice !== undefined) {
    matchedOn.push(`price: under ${money(f.maxPrice)}`)
    reasons += 0.06
  }
  if (parsed.durationDays !== undefined) {
    matchedOn.push(`duration: ${trip.durationDays} days`)
    reasons += 0.08
  }
  if (f.climate) {
    matchedOn.push(`climate: ${CLIMATE_LABELS[f.climate].toLowerCase()}`)
    reasons += 0.06
  }
  if (f.directOnly && trip.directFlights) {
    matchedOn.push('flights: direct')
    reasons += 0.05
  }

  // With no query and no inferred filters there is nothing to be relevant to, so we report
  // the rating and let the sort surface the best-reviewed trips.
  if (tokens.length === 0 && matchedOn.length === 0) {
    return { trip, score: round2(trip.rating / 5), matchedOn }
  }

  const text = textScore(trip, tokens)
  for (const hit of text.hits.slice(0, 2)) matchedOn.push(`keyword: ${hit}`)

  const boost = (BOOSTS.get(trip.id) ?? 0) / 400
  const score = 0.28 + text.score * 0.9 + reasons + (trip.rating - 4.2) * 0.04 + boost
  return { trip, score: round2(Math.min(0.99, score)), matchedOn: matchedOn.slice(0, 5) }
}

function tally(trips: Trip[], values: string[], has: (trip: Trip, value: string) => boolean): FacetValue[] {
  return values
    .map((value) => ({ value, label: value, count: trips.filter((trip) => has(trip, value)).length }))
    .filter((facet) => facet.count > 0)
}

// Counted over the filtered set, which means a selected facet's own counts collapse to the
// selection. Production would count each facet against everything except itself.
function buildFacets(trips: Trip[]): Facet[] {
  const places = new Map<string, FacetValue>()
  for (const trip of trips) {
    const { slug, name, country } = trip.destination
    const entry = places.get(slug) ?? { value: slug, label: `${name}, ${country}`, count: 0 }
    entry.count += 1
    places.set(slug, entry)
  }

  return [
    {
      key: 'destination',
      label: 'Destination',
      values: [...places.values()].sort((a, b) => b.count - a.count || a.label.localeCompare(b.label)),
    },
    { key: 'theme', label: 'Theme', values: tally(trips, THEMES, (t, v) => t.themes.includes(v)) },
    { key: 'activity', label: 'Activity', values: tally(trips, ACTIVITIES, (t, v) => t.activities.includes(v)) },
    {
      key: 'audience',
      label: 'Travelling as',
      values: tally(trips, AUDIENCES, (t, v) => t.audience.includes(v as Audience)),
    },
    {
      key: 'climate',
      label: 'Climate',
      values: tally(trips, ['warm', 'mild', 'cold'], (t, v) => t.climate === v).map((facet) => ({
        ...facet,
        label: CLIMATE_LABELS[facet.value],
      })),
    },
    {
      key: 'month',
      label: 'Departure month',
      values: MONTHS.map((month) => ({
        value: String(month),
        label: monthName(month),
        count: trips.filter((trip) => trip.months.includes(month)).length,
      })).filter((facet) => facet.count > 0),
    },
  ]
}

function sortResults(results: SearchResult[], sort: string): void {
  const byRelevance = (a: SearchResult, b: SearchResult): number =>
    Number(b.trip.pinned ?? false) - Number(a.trip.pinned ?? false) ||
    b.score - a.score ||
    b.trip.rating - a.trip.rating
  switch (sort) {
    case 'price-asc':
      results.sort((a, b) => a.trip.priceFrom - b.trip.priceFrom || byRelevance(a, b))
      break
    case 'price-desc':
      results.sort((a, b) => b.trip.priceFrom - a.trip.priceFrom || byRelevance(a, b))
      break
    case 'rating':
      results.sort((a, b) => b.trip.rating - a.trip.rating || b.trip.reviewCount - a.trip.reviewCount)
      break
    case 'duration':
      results.sort((a, b) => a.trip.durationDays - b.trip.durationDays || byRelevance(a, b))
      break
    default:
      results.sort(byRelevance)
  }
}

const PRICE_PHRASE_RE =
  /(?:under|below|less than|no more than|max(?:imum)?(?: of)?|up to|budget of|around)\s*£?\s*\d[\d,]*/gi
const BUDGET_WORD_RE = /\b(?:cheap|budget|affordable|inexpensive|good value|not too expensive)\b/gi
const DIRECT_PHRASE_RE = /\b(?:with\s+)?(?:direct|non-?stop)\s*(?:flights?)?\b/gi
const SEASON_WORD_RE = /\b(?:next\s+)?(?:winter|spring|summer|autumn|fall)\b/gi
const MONTH_WORD_RE = new RegExp(
  `\\b(?:${MONTH_NAMES.map((name) => `${name}|${name.slice(0, 3)}`).join('|')})\\b`,
  'gi',
)

function tidy(value: string): string {
  return value
    .replace(/\s{2,}/g, ' ')
    .replace(/\s+,/g, ',')
    .replace(/[\s,]*\b(?:in|during|for|next)\b\s*$/i, '')
    .trim()
}

// Zero results is almost always one constraint too many, so each suggestion is the same
// sentence with a single constraint loosened, topped up with queries we know return trips.
function relaxations(query: string, f: Effective): string[] {
  const stem = query.trim()
  const out: string[] = []
  if (stem && f.maxPrice !== undefined) {
    out.push(tidy(`${stem.replace(PRICE_PHRASE_RE, '').replace(BUDGET_WORD_RE, '')} under ${f.maxPrice + 600}`))
  }
  if (stem && f.months.length > 0) {
    out.push(tidy(stem.replace(MONTH_WORD_RE, '').replace(SEASON_WORD_RE, '')))
  }
  if (stem && f.directOnly) out.push(tidy(stem.replace(DIRECT_PHRASE_RE, '')))
  for (const suggestion of SUGGESTED_QUERIES) {
    if (out.length >= 4) break
    if (!out.includes(suggestion)) out.push(suggestion)
  }
  return out.filter((suggestion) => suggestion.length > 4).slice(0, 4)
}

let searchCounter = 0

export function localSearch(body: {
  query: string
  filters?: SearchFilters
  page?: number
  pageSize?: number
  sort?: string
}): SearchResponse {
  const started = performance.now()
  const query = (body.query ?? '').trim()
  const parsed = localParse(query)
  const effective = mergeFilters(parsed, body.filters)
  const filtered = TRIPS.filter((trip) => matches(trip, effective))
  const tokens = tokenise(query)
  const ranked = filtered.map((trip) => scoreTrip(trip, tokens, effective, parsed))
  sortResults(ranked, body.sort ?? 'relevance')

  const page = Math.max(1, body.page ?? 1)
  const pageSize = Math.max(1, body.pageSize ?? 12)
  const from = (page - 1) * pageSize
  searchCounter += 1

  const response: SearchResponse = {
    searchId: `local-${Date.now().toString(36)}-${searchCounter}`,
    results: ranked.slice(from, from + pageSize),
    total: ranked.length,
    page,
    pageSize,
    facets: buildFacets(filtered),
    parsed,
    tookMs: Math.max(1, Math.round(performance.now() - started)),
    mode: 'lexical',
  }
  if (ranked.length === 0) response.suggestions = relaxations(query, effective)
  return response
}

export function localSuggest(prefix: string, limit = 6): string[] {
  const needle = fold(prefix).trim()
  if (needle.length < 2) return SUGGESTED_QUERIES.slice(0, limit)
  const pool = [
    ...DESTINATIONS.map((d) => `${d.name}, ${d.country}`),
    ...THEMES,
    ...TRIPS.map((trip) => trip.title),
    ...SUGGESTED_QUERIES,
  ]
  const out: string[] = []
  for (const candidate of pool) {
    if (out.length >= limit) break
    if (fold(candidate).includes(needle) && !out.includes(candidate)) out.push(candidate)
  }
  return out
}

// One plan per activity, so an itinerary is assembled from what the trip actually does rather
// than from generic filler. {place} is the destination name.
const DAY_PLANS: Record<string, { title: string; detail: string }> = {
  Walking: {
    title: 'On foot above {place}',
    detail:
      'Five to six hours on marked paths with a packed lunch at the top, and your bags moved ahead to tonight\'s hotel.',
  },
  Diving: {
    title: 'Two dives off {place}',
    detail:
      'A morning boat to the reef for two guided dives with tanks and weights included. Snorkellers take the same boat.',
  },
  Skiing: {
    title: 'First tracks from {place}',
    detail:
      'Lifts open at half past eight. The group meets an instructor for the first two hours, then splits by ability for the rest of the day.',
  },
  'Food tour': {
    title: 'Eating your way through {place}',
    detail:
      'Six stops with a local guide, from the market stalls to a back-street kitchen that does one dish very well.',
  },
  'Wine tasting': {
    title: 'Cellars and a long lunch',
    detail: 'Two estates near {place}, six wines between them, and lunch under the pergola at the second.',
  },
  'Cooking class': {
    title: 'Cookery afternoon',
    detail: 'Shop the market in {place} in the morning, then cook and eat four courses in a family kitchen.',
  },
  'Dog sledding': {
    title: 'Driving your own team',
    detail:
      'A briefing at the kennels outside {place}, then three hours on the trail with six dogs and a musher riding behind you.',
  },
  'Wildlife watching': {
    title: 'Dawn wildlife drive',
    detail: 'An early start with a naturalist while the light is low and the animals are still moving.',
  },
  Snorkelling: {
    title: 'Reef and sandbank',
    detail: 'A boat out to the shallow reef with masks and fins, then an hour on a sandbank that vanishes at high tide.',
  },
  Kayaking: {
    title: 'Paddling out from {place}',
    detail: 'A half day on flat water with a guide, close enough to the shore to land whenever you like.',
  },
  Cycling: {
    title: 'Back roads by bike',
    detail: 'Forty easy kilometres on quiet lanes out of {place}, with a van behind for anyone who has had enough.',
  },
  'Hot springs': {
    title: 'An afternoon in the water',
    detail: 'Three hours at the thermal pools, which is the correct way to spend a day with cloud on the mountain.',
  },
  Photography: {
    title: 'Shooting the blue hour',
    detail: 'Out before dawn with a guide who knows where the light lands. Tripods and spare batteries provided.',
  },
  'Rail travel': {
    title: 'By train to the next stop',
    detail: 'A reserved seat and three hours of window, with lunch bought from the platform at {place}.',
  },
}

const FILLER_DAYS: { title: string; detail: string }[] = [
  {
    title: 'A day at your own pace',
    detail: 'Nothing is booked. Your guide will offer three options over breakfast and arrange whichever you fancy.',
  },
  {
    title: 'Market morning, empty afternoon',
    detail: 'A slow wander around {place} and an afternoon that is deliberately left blank.',
  },
  {
    title: 'The quiet corner of {place}',
    detail: 'A short transfer to the side of the region the day trips never reach, and lunch where the buses do not stop.',
  },
]

function buildItinerary(trip: Trip): ItineraryDay[] {
  const swap = (text: string): string => text.replace(/\{place\}/g, trip.destination.name)
  const plans = trip.activities.map((activity) => DAY_PLANS[activity]).filter((plan) => plan !== undefined)
  const days: ItineraryDay[] = [
    {
      day: 1,
      title: `Arrive in ${trip.destination.name}`,
      detail: 'Transfer from the airport, a walk to get your bearings and dinner together at eight.',
    },
  ]
  for (let day = 2; day < trip.durationDays; day += 1) {
    const index = day - 2
    const plan = index < plans.length ? plans[index] : FILLER_DAYS[(index - plans.length) % FILLER_DAYS.length]
    days.push({ day, title: swap(plan.title), detail: swap(plan.detail) })
  }
  days.push({
    day: trip.durationDays,
    title: `Fly home from ${trip.destination.name}`,
    detail: 'Breakfast, bags stored if your flight is late, and a transfer timed to the check-in desk rather than to the clock.',
  })
  return days
}

const PEAK_MONTHS = new Set([7, 8, 12])
const SEAT_PATTERN = [4, 9, 6, 14, 11, 16]

const isoDate = (year: number, month: number, day: number): string =>
  `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`

// Walks forward from today rather than shipping fixed dates, so the departures table never
// shows a trip that has already gone.
function nextDepartures(trip: Trip): Departure[] {
  const out: Departure[] = []
  const cursor = new Date()
  cursor.setDate(1)
  for (let step = 0; step < 30 && out.length < 6; step += 1) {
    cursor.setMonth(cursor.getMonth() + 1)
    const month = cursor.getMonth() + 1
    if (!trip.months.includes(month)) continue
    const uplift =
      out.length === 0 ? 0 : Math.round((trip.priceFrom * (PEAK_MONTHS.has(month) ? 0.18 : 0.06)) / 5) * 5
    out.push({
      id: `${trip.id}-dep-${out.length + 1}`,
      date: isoDate(cursor.getFullYear(), month, 9),
      price: trip.priceFrom + uplift,
      seatsLeft: Math.min(trip.groupSizeMax, SEAT_PATTERN[out.length]),
      direct: trip.directFlights,
    })
  }
  return out
}

function similarTo(trip: Trip): Trip[] {
  return TRIPS.filter((other) => other.id !== trip.id)
    .map((other) => ({
      other,
      shared:
        other.themes.filter((theme) => trip.themes.includes(theme)).length * 2 +
        other.activities.filter((activity) => trip.activities.includes(activity)).length +
        (other.destination.country === trip.destination.country ? 3 : 0),
    }))
    .filter((entry) => entry.shared > 0)
    .sort((a, b) => b.shared - a.shared || b.other.rating - a.other.rating)
    .slice(0, 3)
    .map((entry) => entry.other)
}

function includedIn(trip: Trip): string[] {
  const included = [
    trip.directFlights
      ? 'Return direct flights from London and selected regional airports'
      : 'Return flights from London with one connection',
    `${trip.durationDays - 1} nights of accommodation with breakfast`,
    'Airport transfers on arrival and departure',
  ]
  if (trip.audience.includes('Small groups')) {
    included.push(`Guide throughout, group capped at ${trip.groupSizeMax}`)
  }
  if (trip.activities.includes('Walking')) included.push('Route notes, 1:25,000 maps and daily bag transfers')
  if (trip.activities.includes('Skiing')) included.push('Six-day lift pass and two mornings of instruction')
  if (trip.activities.includes('Dog sledding')) included.push('Thermal suit, boots and mittens in every size')
  if (trip.activities.includes('Diving')) included.push('Two guided dives a day with tanks and weights')
  if (trip.themes.includes('Northern Lights')) {
    included.push('Guided aurora hunts, repeated free if the sky closes in')
  }
  if (trip.themes.includes('Rail journeys')) included.push('All rail tickets, reserved and second class')
  included.push('ATOL protection and a 24-hour UK duty phone')
  return included
}

export function localTrip(slug: string): TripDetail | undefined {
  const trip = TRIPS.find((candidate) => candidate.slug === slug)
  if (!trip) return undefined
  return {
    trip,
    itinerary: buildItinerary(trip),
    departures: nextDepartures(trip),
    similar: similarTo(trip),
    included: includedIn(trip),
    policyIds: POLICIES.map((policy) => policy.id),
  }
}

const TOP_QUERIES: TopQuery[] = [
  { query: 'northern lights trip for a family next winter', searches: 1284, ctr: 0.58, conversion: 0.061 },
  { query: 'somewhere warm in november under 1200 direct flights', searches: 962, ctr: 0.51, conversion: 0.048 },
  { query: '7 day walking holiday in italy with small groups', searches: 744, ctr: 0.63, conversion: 0.072 },
  { query: 'iceland', searches: 690, ctr: 0.44, conversion: 0.031 },
  { query: 'half term family trip', searches: 604, ctr: 0.39, conversion: 0.026 },
  { query: 'walking holiday', searches: 588, ctr: 0.46, conversion: 0.034 },
  { query: 'winter sun direct flights', searches: 512, ctr: 0.49, conversion: 0.041 },
  { query: 'aurora photography small group', searches: 341, ctr: 0.66, conversion: 0.079 },
]

const hoursAgo = (hours: number): string => new Date(Date.now() - hours * 3_600_000).toISOString()

// Each of these names a real gap rather than a typo, which is the point of the report:
// accessibility copy, regional departures and cruise inventory are all missing.
const ZERO_RESULT_QUERIES: ZeroResultQuery[] = [
  { query: 'northern lights in august', searches: 214, lastSeen: hoursAgo(3) },
  { query: 'all inclusive maldives under 500', searches: 186, lastSeen: hoursAgo(9) },
  { query: 'wheelchair accessible walking holiday', searches: 163, lastSeen: hoursAgo(14) },
  { query: 'sleeper train to marrakech', searches: 148, lastSeen: hoursAgo(26) },
  { query: 'trips departing from belfast', searches: 131, lastSeen: hoursAgo(38) },
  { query: 'northern lights cruise from southampton', searches: 96, lastSeen: hoursAgo(52) },
]

function buildTimeline(days: number): TimelinePoint[] {
  const points: TimelinePoint[] = []
  const start = new Date()
  start.setHours(12, 0, 0, 0)
  start.setDate(start.getDate() - (days - 1))
  for (let i = 0; i < days; i += 1) {
    const day = new Date(start)
    day.setDate(start.getDate() + i)
    const weekend = day.getDay() === 0 || day.getDay() === 6
    // A gentle upward trend with a weekly rhythm: enough shape for the chart to be worth reading.
    const searches = Math.round((470 + i * 6 + Math.sin(i / 3.2) * 58) * (weekend ? 0.78 : 1))
    const clicks = Math.round(searches * (weekend ? 0.44 : 0.48))
    points.push({
      date: isoDate(day.getFullYear(), day.getMonth() + 1, day.getDate()),
      searches,
      clicks,
      bookings: Math.round(clicks * 0.082),
    })
  }
  return points
}

// The KPI tiles are derived from the timeline rather than typed in, so the numbers on the
// analytics tab always agree with the chart above them.
export function localAnalytics(): AnalyticsOverview {
  const timeline = buildTimeline(30)
  const searches = timeline.reduce((sum, point) => sum + point.searches, 0)
  const clicks = timeline.reduce((sum, point) => sum + point.clicks, 0)
  const bookings = timeline.reduce((sum, point) => sum + point.bookings, 0)
  const zeroResultSearches = ZERO_RESULT_QUERIES.reduce((sum, entry) => sum + entry.searches, 0)
  const rate = (value: number): number => Math.round((value / searches) * 1000) / 1000

  return {
    totalSearches: searches,
    zeroResultRate: rate(zeroResultSearches),
    clickThroughRate: rate(clicks),
    conversionRate: rate(bookings),
    topQueries: TOP_QUERIES,
    zeroResults: ZERO_RESULT_QUERIES,
    timeline,
  }
}
