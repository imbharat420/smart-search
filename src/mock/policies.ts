// Booking conditions the assistant can ground answers in and cite. In the real
// backend these live alongside trips in the retrieval index; here they are plain
// text the mock chat can quote verbatim.

export interface PolicyDoc {
  id: string
  label: string
  keywords: string[]
  summary: string
  body: string
}

export const POLICIES: PolicyDoc[] = [
  {
    id: 'policy-booking',
    label: 'Booking & Payment',
    keywords: [
      'book',
      'booking',
      'deposit',
      'pay',
      'payment',
      'balance',
      'confirm',
      'confirmation',
      'hold',
      'instalment',
    ],
    summary:
      'A £150 per person deposit confirms your place; the balance is due 70 days before departure.',
    body: 'A deposit of £150 per person confirms your booking and locks the price of your trip. The balance is due 70 days before departure, and for bookings made inside that window the full amount is payable at the time of booking. We accept UK debit and credit cards and bank transfer; card payments carry no surcharge. Your confirmation invoice and ATOL Certificate are issued by email within 24 hours, and a monthly instalment plan is available on trips over £1,200 when you book more than four months ahead.',
  },
  {
    id: 'policy-cancellation',
    label: 'Cancellation & Amendments',
    keywords: [
      'cancel',
      'cancellation',
      'refund',
      'amend',
      'amendment',
      'change',
      'change dates',
      'postpone',
      'move my booking',
      'transfer',
    ],
    summary:
      'Free date changes up to 70 days before departure; a sliding cancellation scale applies after that.',
    body: 'You can move your departure date once free of charge up to 70 days before travel, subject to availability on the new date and any difference in trip price. Cancellations are charged on a sliding scale: loss of deposit more than 70 days out, 50 per cent of the trip price between 69 and 43 days, 75 per cent between 42 and 15 days, and 100 per cent inside 14 days. Name changes cost £35 per person plus any airline fee. If we have to change your itinerary significantly you may accept the change, move to another trip, or cancel for a full refund.',
  },
  {
    id: 'policy-baggage',
    label: 'Baggage & Equipment',
    keywords: [
      'baggage',
      'bag',
      'bags',
      'luggage',
      'suitcase',
      'hold bag',
      'hand luggage',
      'carry on',
      'weight',
      'allowance',
      'equipment',
      'skis',
    ],
    summary:
      'One 23kg hold bag and one 10kg cabin bag included on flight-inclusive trips; walking and ski kit carried free.',
    body: 'Flight-inclusive trips include one hold bag up to 23kg and one cabin bag up to 10kg per person; the exact dimensions are set by the operating airline and shown on your e-ticket. Walking poles must travel in the hold. Skis, snowboards and dive kit are carried free of charge on our winter and diving trips when declared at least 14 days before departure, otherwise airline sports-equipment fees apply. On walking itineraries your main bag is transferred between hotels by road, so you only ever carry a daypack. Baggage allowances on internal flights and on rail sectors can be lower and are listed in your final travel documents.',
  },
  {
    id: 'policy-atol',
    label: 'ATOL & Financial Protection',
    keywords: [
      'atol',
      'abta',
      'protected',
      'protection',
      'financially protected',
      'bonded',
      'insolvency',
      'safe',
      'trust account',
      'package travel',
    ],
    summary:
      'Flight-inclusive holidays are ATOL protected; flight-free trips are bonded under the Package Travel Regulations.',
    body: 'Every flight-inclusive holiday we sell is financially protected by the Civil Aviation Authority under our ATOL licence, and you receive an ATOL Certificate with your confirmation listing exactly what is protected. If we cease trading before you travel you are refunded, and if it happens while you are away you are repatriated at no cost to you. Trips sold without flights are protected under the Package Travel and Linked Travel Arrangements Regulations 2018 through a bonded client trust account, so your money is held separately until you return. Travel insurance is not included and is a condition of booking on our walking, trekking and winter trips.',
  },
]
