"""Smart Search demo catalog + policy documents for the travel website.

This mirrors the frontend mock (src/mock/catalog.ts, src/mock/policies.ts) so the
real backend is grounded in exactly the same data the UI was designed against.
In a production system this would come from your travel booking DB + a policy CMS.
"""

CATEGORIES = [
    "City Breaks",
    "Beach Destinations",
    "Adventure Tours",
    "Hotels & Resorts",
    "Travel Gear",
]


def _img(pid: str) -> str:
    # Stable per-id image, identical to the frontend mock.
    return f"https://picsum.photos/seed/{pid}/400/300"


# Each product is a plain dict; schemas.Product validates/serialises it.
_RAW_PRODUCTS = [
    # ---- City Breaks -----------------------------------------------------
    ("p1", "Paris Romantic Weekend Package",
     "Enjoy a 3-day romantic getaway in the heart of Paris. Includes 4-star hotel accommodation, daily breakfast, and a Seine river cruise.",
     499, "City Breaks", 4.8, True),
    ("p2", "Tokyo Explorer Pass",
     "5-day pass covering top Tokyo attractions, bullet train transfers, and a guided tour of historic Asakusa.",
     320, "City Breaks", 4.6, True),
    ("p3", "New York City Break (4 Days)",
     "Flight and 4-star hotel package for the ultimate NYC experience. Visit Times Square, Central Park, and the Statue of Liberty.",
     850, "City Breaks", 4.7, True),
    ("p4", "Rome Historical City Tour",
     "Skip-the-line tickets to the Colosseum and Vatican, plus 3 nights in a boutique Italian hotel.",
     450, "City Breaks", 4.5, True),
    ("p5", "Swiss Alps Scenic Train Pass",
     "5-day rail pass for unlimited travel on Switzerland's most picturesque mountain routes, including the Glacier Express.",
     320, "City Breaks", 4.8, True),

    # ---- Beach Destinations ----------------------------------------------
    ("p6", "Maldives Overwater Bungalow (5 Nights)",
     "Luxury 5-night stay in a private overwater villa with direct lagoon access, breakfast included.",
     1200, "Beach Destinations", 4.9, True),
    ("p7", "Bali Surf & Sun Retreat",
     "7-day stay in a tropical boutique resort including daily yoga and airport transfers.",
     650, "Beach Destinations", 4.7, True),
    ("p8", "Hawaii Island Hopping Package",
     "10-day trip covering Oahu and Maui with inter-island flights and rental car included.",
     1400, "Beach Destinations", 4.6, True),
    ("p9", "Cancun All-Inclusive Resort (7 Nights)",
     "Unlimited food, drinks, and water sports at a premium beachfront resort in Cancun.",
     980, "Beach Destinations", 4.5, False),

    # ---- Adventure Tours -------------------------------------------------
    ("p10", "Machu Picchu 4-Day Trek",
     "Guided hike along the Inca Trail to Machu Picchu. Includes camping gear, meals, and entrance tickets.",
     780, "Adventure Tours", 4.9, True),
    ("p11", "Serengeti Safari Adventure",
     "6-day luxury safari in Tanzania exploring the Serengeti and Ngorongoro Crater. All-inclusive package.",
     2400, "Adventure Tours", 4.8, True),
    ("p12", "Norway Fjords Kayaking Expedition",
     "5-day guided kayaking tour through the dramatic fjords of Norway, including all equipment and wilderness camping.",
     1100, "Adventure Tours", 4.7, True),
    ("p13", "Patagonia Hiking Holiday",
     "8-day trekking tour through Torres del Paine. Spectacular mountain views and expert local guides.",
     1450, "Adventure Tours", 4.6, True),
    ("p14", "Great Barrier Reef Diving Trip",
     "Full-day scuba diving adventure to the Outer Great Barrier Reef, including all equipment and lunch.",
     220, "Adventure Tours", 4.7, True),

    # ---- Hotels & Resorts ------------------------------------------------
    ("p15", "The Grand Plaza Hotel, London",
     "Luxury 5-star hotel in central London offering world-class dining and a full-service spa.",
     280, "Hotels & Resorts", 4.8, True),
    ("p16", "Oceanview Boutique Inn, Santorini",
     "Cliffside rooms with private balconies overlooking the Aegean Sea. Free breakfast and WiFi.",
     220, "Hotels & Resorts", 4.7, True),
    ("p17", "Dubai Marina Skyline Apartment",
     "Modern 2-bedroom apartment with stunning marina views, gym, and pool access. Perfect for families.",
     180, "Hotels & Resorts", 4.5, True),
    ("p18", "Aspen Mountain Ski Lodge",
     "Cozy ski-in/ski-out lodge with fireplace, complimentary hot breakfast, and equipment storage.",
     310, "Hotels & Resorts", 4.6, True),

    # ---- Travel Gear -----------------------------------------------------
    ("p19", "Global Travel Adapter with USB-C",
     "Universal adapter compatible with outlets in over 150 countries, featuring fast-charging USB-C ports.",
     35, "Travel Gear", 4.6, True),
    ("p20", "Anti-Theft Travel Backpack 30L",
     "Secure, slash-proof backpack with hidden compartments, RFID blocking, and a built-in USB charging port.",
     65, "Travel Gear", 4.7, True),
    ("p21", "Neck Pillow & Eye Mask Set",
     "Memory foam neck pillow with breathable cover, paired with a blackout eye mask for comfortable long-haul flights.",
     28, "Travel Gear", 4.4, True),
    ("p22", "Compact Travel Toiletry Bag",
     "Hanging toiletry bag with multiple compartments and a leak-proof design to keep your essentials organized.",
     24, "Travel Gear", 4.5, True),
    ("p23", "Lightweight Packing Cubes (Set of 4)",
     "Durable, water-resistant packing cubes to maximize luggage space and keep clothes neatly separated.",
     22, "Travel Gear", 4.8, True),
    ("p24", "Foldable 20L Daypack",
     "Ultralight packable daypack that folds into its own pocket. Perfect for day trips and excursions.",
     19, "Travel Gear", 4.5, False),
]

PRODUCTS = [
    {
        "id": pid,
        "title": title,
        "description": desc,
        "price": price,
        "category": category,
        "rating": rating,
        "inStock": in_stock,
        "imageUrl": _img(pid),
    }
    for (pid, title, desc, price, category, rating, in_stock) in _RAW_PRODUCTS
]


# Policy documents the chat can retrieve and cite.
POLICIES = [
    {
        "id": "policy-cancellations",
        "label": "Cancellation & Refund Policy",
        "keywords": ["cancel", "cancellation", "refund", "refunds", "change", "reschedule", "modify"],
        "summary": "Free cancellation within 48 hours of booking. Refunds take 5–7 business days to process.",
        "body": "You can cancel or modify your booking free of charge within 48 hours of making the reservation. After this period, cancellation fees may apply depending on the travel provider. Once a cancellation is approved, refunds are issued to the original payment method within 5–7 business days. Flight tickets are subject to airline-specific cancellation policies.",
    },
    {
        "id": "policy-booking",
        "label": "Booking & Confirmation Policy",
        "keywords": ["book", "booking", "confirm", "confirmation", "tickets", "voucher", "itinerary", "e-ticket"],
        "summary": "Instant confirmation for most hotels and tours; flights may take up to 24 hours.",
        "body": "Most hotel and tour bookings receive instant confirmation via email. Flight bookings may take up to 24 hours to confirm, depending on the airline. You will receive a final e-ticket and travel voucher 24 hours before your departure. Ensure all passenger details match the passports or IDs exactly, as changes may incur fees.",
    },
    {
        "id": "policy-insurance",
        "label": "Travel Insurance & Support",
        "keywords": ["insurance", "medical", "emergency", "support", "help", "assistance", "cover", "lost luggage"],
        "summary": "We highly recommend comprehensive travel insurance. 24/7 emergency support available worldwide.",
        "body": "While travel insurance is not mandatory for all bookings, we strongly recommend purchasing a comprehensive policy covering trip cancellations, medical emergencies, and lost luggage. We partner with leading insurers to offer coverage at checkout. For any in-trip emergencies, our 24/7 global support team is available via phone or live chat to assist you with rebookings and local resources.",
    },
]