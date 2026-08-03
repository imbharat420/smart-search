# Design system — TravelIQ Search Engine POC

This describes the design system **as built**, not as wished for. Every token, class and prop below
was read out of `src/index.css`, `src/components/ui/*`, `src/components/layout/*` and `src/pages/*`.
Where the implementation falls short of the intent it says so and names the fix.

- Tokens: [`src/index.css`](../src/index.css)
- Primitives: [`src/components/ui/`](../src/components/ui)
- Shell: [`src/components/layout/`](../src/components/layout)
- Screens and their regions: [`wireframes.md`](./wireframes.md)

---

## 1. Provenance

The visual language is taken from the supplied reference application in `docs/reference/`:

| Reference file | What TravelIQ takes from it |
| --- | --- |
| `src/styles.css` | the token *structure* — the `--radius` scale, the surface / ink / brand / state / sidebar token names, the `@theme inline` bridge. None of the values survive: the palette was replaced after the main build, and §2 documents what is there now |
| `src/routes/landing.tsx` | the brand-fill hero band (TravelIQ uses it at full strength — §2.5), 4/3 hero image at `rounded-3xl`, how-it-works numbered cards, "as featured in" strip, footer |
| `src/routes/index.tsx` | the assistant split: conversation left, discovery rails right on `--panel` |
| `src/routes/discover.tsx` | list-left / map-right two-column layout, category rails, radius control |
| `src/routes/inspiration.tsx` | three-up guide gallery, search field plus filter button, tag row |
| `src/components/Sidebar.tsx` | the 64px icon rail: `w-16`, `h-10 w-10` targets, `rounded-lg`, `bg-sidebar-accent` for the active item |

**Nothing here invents a new look.** The brief allowed refinement of colour, typography, spacing and
polish only. These are the deliberate deltas, and they are the only ones:

1. **A new five-colour palette.** The reference's warm-yellow oklch set is gone. TravelIQ is built
   from a five-colour brief — platinum, soft periwinkle, periwinkle, tea green and lime cream, with
   lime cream as the brand — and every one of the five is used at full strength somewhere. §2 names
   each value and the job it does. This is the largest delta and the one that reshaped everything
   below: a saturated yellow behaves nothing like a pale lime, so where the reference had to knock
   its brand back to `/70` for a hero band, TravelIQ can use it neat.
2. **Three derived shades, because light tints cannot carry text.** Lime cream is 1.4:1 on white and
   periwinkle 2.1:1. Neither is type and neither is a hairline. `--lime-ink`, `--periwinkle-ink` and
   `--ink` are the same hues pushed to AA, and they are what makes a two-hue system legible rather
   than decorative.
3. **One colour added — `--destructive`.** Nothing in five light green and violet tints reads as a
   failure, and red cannot be derived from any of them. The other three state tokens (`--success`,
   `--warning`, and the `--ring` the reference already had) are drawn from the palette itself.
4. **Ink as the primary CTA.** The reference styles its main action `bg-foreground text-background`
   inline in each route. TravelIQ names that colour `--ink` and makes it `Button variant="primary"`,
   so a dark pill is the default action everywhere and the brand fill is the secondary action. A lime
   pill on the lime hero band has no contrast, which is why the landing hero pairs a dark pill with a
   bordered white one.
5. **One type family with a tuned scale.** The reference already loads Plus Jakarta Sans; TravelIQ
   keeps exactly that one family and no second face. Display weight drops from the reference's
   `font-black` (900, which the loaded font does not ship) to `font-extrabold` (800, which it does),
   and the step from page title to section heading is widened so a page has one clear focal point.
6. **`--panel` promoted to a layout token.** The reference used its off-white as a page background on
   landing only. TravelIQ mixes lime cream to about 6% and uses it as the second surface throughout:
   the Search, Inspiration and Admin pages sit on `bg-panel` and their cards on `bg-card`, which is
   what makes a dense results grid read as cards rather than as a wall.

---

## 2. Tokens

All tokens are declared in `:root` in `src/index.css` and exposed to Tailwind through
`@theme inline`, so `bg-panel`, `text-muted-foreground` and `border-border` all resolve to the
variables below. **Never write a hex value in `src/**`.** If a colour is missing, add a token.

### 2.1 The five given colours

The brief supplies five and only five. Each is declared under its own name in `:root` so the source
palette is legible in the file rather than buried inside derived values, and each is used at full
strength somewhere.

| Name | Hex | Declared as | The job it does |
| --- | --- | --- | --- |
| Platinum | `#ebebeb` | `--platinum` | every hairline in the product — `--border`, `--input`, `--sidebar-border`. One grey, one weight, no second tone |
| Soft periwinkle | `#9287e2` | `--soft-periwinkle` | `--ring` (the focus indicator) and `--warning`. The most saturated colour in the set, so it is the one that can carry attention |
| Periwinkle | `#a8adf0` | `--periwinkle` | the state wash: `--sidebar-accent` `#eceefb` is this at 30%, and the guide-author avatar gradient uses it neat |
| Tea green | `#d0f0a8` | `--tea-green` | `--secondary`, and `--accent` `#e8f7d3` is this at 45% on white — the hover fill and every soft callout |
| Lime cream | `#c8e98a` | `--lime-cream` | **the brand.** `--primary`: the hero band, brand badges, the logo tile, the active tab underline, the switch track, the relevance pill, the facet checkbox, filter count bubbles |

Note where the tinting happens. `--accent`, `--sidebar-accent` and `--panel` are pre-mixed hex
values, not `/45` opacity utilities. Mixing in the token means anything sitting on those surfaces has
a known colour behind it rather than whatever the stacking context happens to be, which is what makes
the figures in §7 measurable instead of approximate.

### 2.2 The three derived shades, and why they exist

A palette of light tints cannot carry text. Lime cream is 1.4:1 on white, tea green 1.3:1, periwinkle
2.1:1 — unreadable as type and invisible as a 1px rule. So three shades are derived: the same two
hues pushed down until they clear AA, plus the near-black.

| Token | Hex | On white | Used for |
| --- | --- | --- | --- |
| `--lime-ink` | `#5c7d2a` | 4.6:1 | exported as `--primary-strong`. The brand as ink: star fills, saved hearts, the slider's filled track, the syncing status dot, the Discover rail underline, the selected gallery thumbnail |
| `--periwinkle-ink` | `#5f52b8` | 5.3:1 | the periwinkle equivalent, for a periwinkle-hued mark or label. **Declared, not yet consumed** — nothing in `src/**` reads it today. It stays because the moment a state needs to be text rather than a fill, the alternative is a one-off hex |
| `--ink` | `#191823` | 17.6:1 | `--foreground`, `--card-foreground`, `--popover-foreground`, and the dark CTA fill behind `Button variant="primary"`. An indigo-black rather than a neutral one, so it belongs to the periwinkle family instead of sitting outside the palette |

`--muted-foreground` `#5a5a68` (6.8:1 on white) is the fourth derived value and the one every
secondary line uses. It is a desaturated periwinkle-grey for the same reason `--ink` is indigo: a
neutral grey next to these two hues reads as a different system leaking through.

### 2.3 The one added colour

| Token | Hex | Why |
| --- | --- | --- |
| `--destructive` | `#c2415a` | Nothing in a set of pale green and violet signals failure, and red cannot be derived from any of the five. Red is also the only colour a user reads instantly as "this is broken", so approximating it with periwinkle would cost real comprehension. It is pulled towards the palette's cool cast — a raspberry rather than a pure red — so it sits with the rest of the system |

It appears in exactly three places, all of them a real failure: `SourceHealth`'s failing-feed dot,
`ReviewQueue`'s weak-confidence band, and `Badge` / `Chip` `tone="danger"` (which `PromotionBoard`
uses for a hidden trip). It is not a hover state and not "needs attention" — `--warning` covers that.

### 2.4 The two-hue rule

Two hues carry the whole interface, and each one means one thing.

| Hue | Means | Tokens |
| --- | --- | --- |
| **Lime** — lime cream, tea green, lime ink | brand, action, positive outcome | `--primary`, `--primary-strong`, `--secondary`, `--accent`, `--success` |
| **Periwinkle** — periwinkle, soft periwinkle, indigo-black | state, inference, focus | `--ring`, `--warning`, `--sidebar-accent`, `--ink`, `--muted-foreground` |

That split is why `--success` `#4f7a3a` is a green from the lime family rather than a stock green, and
why the **Keyword fallback** pill on Search is periwinkle rather than amber: the fallback is not a
warning, it is a statement about which retrieval layer answered — a piece of state. When a new colour
seems necessary, decide which of the two columns it belongs in first. If the answer is neither, it is
either `--destructive` or it does not exist.

### 2.5 Brand is a fill, never text and never a hairline

`--primary` is a light tint. At 1.4:1 on white it cannot be type and cannot be a 1px rule — a lime
hairline on a white card is invisible at arm's length. So:

- **Fill it.** `bg-primary` with ink over it: the hero band, `Badge tone="brand"`, the 36px logo tile,
  the tab underline, the switch track, the "Understood by AI" pill, the booking-confirmation tick.
- **Never `text-primary`, and never `border-primary` as a visible edge.** The one border use is the
  facet checkbox, which sets `border-primary bg-primary` together — the border is only squaring the
  corner of a fill.
- **The escape hatch is `--primary-strong`.** When the brand has to be a mark rather than a field — a
  star, a heart, a filled slider track, a 2px section underline — use `--primary-strong`
  (`--lime-ink`, 4.6:1). Same hue, legible weight, identity unchanged.
- Because lime cream is light, it *can* be a full-strength large-area background: the landing hero is
  plain `bg-primary` with `--foreground` type over it. This is the one place TravelIQ is less
  cautious than the reference, whose saturated yellow had to be knocked back to `/70`. The remaining
  opacity use is the popular-itineraries band at `bg-primary/20`, which needs to read as a quieter
  second band on the same page.

`--primary-foreground` `#23300f` (10.3:1 on lime cream) is the only label colour allowed on
`--primary`, and `--secondary-foreground` and `--accent-foreground` are the same value for the same
reason.

### 2.6 Every token, in one table

| Token | Hex | Utility | Use |
| --- | --- | --- | --- |
| `--background` | `#ffffff` | `bg-background` | the page beneath everything |
| `--panel` | `#f7f8f2` | `bg-panel` | lime cream at ~6%. The second surface: Search, Inspiration and Admin sit on it, plus the assistant's discovery column, the landing ground, and the note block in the booking confirmation |
| `--card` | `#ffffff` | `bg-card` | anything raised off `--panel`: cards, rails, tables, the footer, the sheet |
| `--accent` | `#e8f7d3` | `bg-accent` | tea green at 45%. Hover fill, tinted callouts, image placeholder, the 404 badge, the empty-state icon disc, the traveller's own chat bubble |
| `--muted` | `#f4f4f7` | `bg-muted` | a neutral inert fill. Declared; `--accent` covers the cases in practice |
| `--border` | `#ebebeb` | `border`, `bg-border` | platinum. Every hairline, and the skeleton fill. The base layer sets `* { border-color: var(--border) }`, so a bare `border` class is this token |
| `--input` | `#ebebeb` | — | the same value, declared for the field border. Unreferenced today; §7's second known gap is why that matters |
| `--popover`, `--popover-foreground` | `#ffffff`, `#191823` | — | declared for parity with the reference. The one floating surface in the product — `SearchBar`'s suggestion list — uses `bg-card` |
| `--card-foreground` | `#191823` | — | declared; components write `text-foreground` |
| `--foreground` | `#191823` | `text-foreground` | all primary text |
| `--muted-foreground` | `#5a5a68` | `text-muted-foreground` | secondary text, meta lines, facet counts, placeholders, inactive icons |
| `--ink` | `#191823` | `bg-ink` | the dark CTA fill. Same value as `--foreground` on purpose — one is a text role, one is a fill role, and they may diverge later |
| `--primary` | `#c8e98a` | `bg-primary` | brand fills, per §2.5 |
| `--primary-foreground` | `#23300f` | `text-primary-foreground` | the only label colour on `--primary`, `--secondary` and `--accent` |
| `--primary-strong` | `#5c7d2a` | `text-[var(--primary-strong)]` | brand as a mark: stars, hearts, filled tracks, rail underlines |
| `--secondary` | `#d0f0a8` | `bg-secondary` | tea green neat, for a third fill weight. Declared, unused today |
| `--success` | `#4f7a3a` | `bg-[var(--success)]` | availability dots, healthy feed, "likely the same trip" merge band, the synonym test's pass icon |
| `--warning` | `#9287e2` | `bg-[var(--warning)]` | soft periwinkle. Keyword-fallback pill, "Demo data" badge, stale feed, over-target KPI, mid-confidence merge band |
| `--destructive` | `#c2415a` | `bg-destructive` | per §2.3 |
| `--ring` | `#9287e2` | `ring-[var(--ring)]` | the focus indicator — 3.1:1 on white, see §7 |
| `--sidebar` | `#ffffff` | `bg-sidebar` | the 64px rail |
| `--sidebar-foreground` | `#5a5a68` | `text-sidebar-foreground` | inactive rail and bottom-tab icons |
| `--sidebar-accent` | `#eceefb` | `bg-sidebar-accent` | periwinkle at 30%. The active and hovered navigation item |
| `--sidebar-border` | `#ebebeb` | — | rail edge |

`--success`, `--warning` and `--destructive` appear as **tinted fills with ink labels**
(`bg-[var(--success)]/15 text-foreground`) or as non-text indicators — dots, bar fills, icons. Each
carries a `-foreground` partner for the solid case, and the three are not the same value:
`--success-foreground` and `--destructive-foreground` are white, which clears AA on both fills at
5.0:1, while `--warning-foreground` is the near-black `#1b1636`, because soft periwinkle is light
enough that white on it measures only 3.1:1. All three stay unreferenced today, because a tinted fill
reads calmer in a dense table than a row of solid colour chips; the numbers are in §7 so that a
future solid state chip is a choice rather than a mistake.

**The no-hex rule now holds everywhere.** `src/components/discover/MapPanel.tsx` used to set
`PIN_HEX = 'ffb400'` because the old Static Images API took the pin colour as a URL parameter, and a
URL cannot carry a CSS variable. Now that the map is a real Mapbox GL instance, pins are DOM elements
(`mapboxgl.Marker({ element })`) styled the same way as everything else — `var(--primary-strong)`
(`--lime-ink`) for place pins, `var(--periwinkle-ink)` for the device-location marker — so a palette
change reaches the map for free, with no line left that a palette change has to touch by hand.

### 2.7 Radii

`--radius: 0.9rem` (14.4px) with the reference's derived scale. Tailwind's `rounded-*` utilities are
remapped to these, so `rounded-2xl` is 22.4px here, not Tailwind's default 16px.

| Utility | Value | Use |
| --- | --- | --- |
| `rounded-lg` | 14.4px | rail icon buttons, logo tile, facet rows |
| `rounded-xl` | 18.4px | skeleton blocks standing in for headings |
| `rounded-2xl` | 22.4px | **every card, panel, rail, table container, empty state, callout** |
| `rounded-3xl` | 26.4px | hero and gallery images, the bottom sheet's top corners |
| `rounded-full` | pill | **every control**: buttons, inputs, selects, chips, badges, sliders, switches |

The whole system is two shapes: pills for things you operate, 22px cards for things you read.

---

## 3. Type scale

One family, self-declared in `index.html` via a Google Fonts `<link>`, weights 400/500/600/700/800:

```
--font-display: 'Plus Jakarta Sans', ui-sans-serif, system-ui, 'Segoe UI', Roboto, sans-serif
```

`--font-sans` aliases it so Tailwind's `font-sans` is the same face. There is no second family and no
monospace face; figures use `tabular-nums` instead.

| Role | Classes | Size | Where |
| --- | --- | --- | --- |
| Hero | `text-5xl md:text-7xl font-extrabold tracking-tight leading-[0.95]` | 48 → 72px | landing hero only |
| Assistant greeting | `text-4xl md:text-5xl font-bold tracking-tight` | 36 → 48px | the empty conversation |
| Page title | `text-3xl md:text-4xl font-extrabold tracking-tight` | 30 → 36px | one per screen: Search, Discover, Inspiration, Admin, 404 |
| Landing section | `text-3xl md:text-4xl font-extrabold tracking-tight` | 30 → 36px | how-it-works, popular itineraries |
| Section | `text-xl font-bold tracking-tight` | 20px | admin sections, "About this trip", "Featured guides", zero-result heading |
| Card title | `font-semibold leading-snug` | 16px | result cards, guide cards, source rows, itinerary days |
| Eyebrow / rail heading | `text-xs font-semibold uppercase tracking-wide text-muted-foreground` | 12px | facet group headings, "Control panel", zero-result group labels |
| Body | `text-[15px]` | 15px | the default paragraph; `leading-relaxed` once past three lines |
| Body small | `text-sm` | 14px | dense panels, admin forms, footer links |
| Meta | `text-xs text-muted-foreground` | 12px | counts, timing, provenance, hints |
| Micro | `text-[11px]` / `text-[10px]` | 11 / 10px | "from" label above a price; bottom tab labels only |
| Price | `text-lg font-bold leading-none tabular-nums` | 18px | result card and booking panel |

Rules:

- **`text-[15px]` is the body size, not `text-base`.** 16px at this x-height reads heavy in a
  three-column grid; 15px is the reference's effective body size.
- **One `font-extrabold` element per viewport height.** A page title and a landing section heading
  never share a fold.
- **`tabular-nums` on every figure** — prices, counts, durations, percentages, dates, KPI values,
  chart tooltips, pagination numbers. Without it a facet count column visibly jitters as it updates.
- `tracking-tight` on everything 20px and up; never on body or meta.
- `text-wrap: balance` is applied to `h1`–`h3` globally in `index.css`, so headings do not need
  manual line breaks except where the hero wants a deliberate one.

---

## 4. Component inventory

Thirteen files in `src/components/ui/`. All accept and merge `className` through `cn()`
(`clsx` + `tailwind-merge`), all use `focus-visible` rings from `--ring`, none uses `any`, and none
is a default export.

### `button.tsx` — `<Button>`

```
variant: 'primary' | 'brand' | 'outline' | 'ghost'   default 'primary'
size:    'sm' | 'md' | 'lg'                          default 'md'
asChild?: boolean
...all ButtonHTMLAttributes
```

| Variant | Renders | When |
| --- | --- | --- |
| `primary` | `bg-[var(--ink)] text-white` | the one action that moves the task on: Request booking, Try again, Try a search |
| `brand` | `bg-primary text-primary-foreground` | a second, willing action beside a primary: Search other trips. Lime cream fill, `#23300f` label |
| `outline` | `border bg-card hover:bg-accent` | equal-weight alternatives, and any action sitting on a coloured band or inside a card: View trip, Filters, Clear all |
| `ghost` | `hover:bg-accent` | icon-only and in-table actions where a border would add noise |

Sizes are `h-9` (36px), `h-11` (44px), `h-12` (48px). `asChild` clones the single child and merges
the classes onto it — this is how a `react-router` `<Link>` is dressed as a button. Because it only
merges styling, put `onClick` and `aria-*` on the child, not on `<Button>`.

Never place `variant="brand"` on `bg-primary`, `bg-primary/20` or `bg-accent` — a lime fill on a lime
band has nothing to separate it from the band. Use `outline` there, which is what the landing hero and
the popular-itineraries band both do.

### `card.tsx` — `<Card>`, `<CardBody>`, `<CardMedia>`

```
Card       ...HTMLAttributes<HTMLDivElement>
CardBody   ...HTMLAttributes<HTMLDivElement>
CardMedia  { src, alt, aspect?: '4/3' | '4/5' | '16/10', badge?: ReactNode, className? }
```

`Card` is `rounded-2xl border bg-card` with `hover:shadow-md` and, importantly, `group` — which is
what lets `CardMedia` scale its image `group-hover:scale-[1.03]`. `CardBody` is `flex-1` with `gap-2`
and `p-4`, so a footer pinned with `mt-auto` aligns across a row of unequal cards. `CardMedia`
always sets `loading="lazy"` and `object-cover`, and renders `badge` top-left over the image.

Aspect ratios: `4/3` for trip and guide cards (the default), `4/5` for portrait itinerary cards on
the landing page, `16/10` for the trip gallery hero and the assistant's empty-state image.

### `badge.tsx` — `<Badge>`

```
tone?: 'neutral' | 'brand' | 'success' | 'warning' | 'danger'   default 'neutral'
size?: 'sm' | 'md'                                             default 'md'
children, className?
```

Non-interactive label. `neutral` is a bordered white pill (themes, activities); `brand` is the solid
lime-cream pill and is reserved for the relevance score and other computed claims; `success` /
`warning` / `danger` are 10–20% tints of the state token with an ink label — `bg-[var(--success)]/15`,
`bg-[var(--warning)]/20`, `bg-destructive/10`. `size="sm"` (11px) inside cards and tables, `md` (12px)
standing alone.

Use `Badge` when the value is read and `Chip` when it can be removed.

### `chip.tsx` — `<Chip>`

```
label: string
onRemove?: () => void
icon?: ReactNode
tone?: 'brand' | 'neutral' | 'success' | 'warning' | 'danger'   default 'brand'
className?
```

The removable filter chip: one per constraint TravelIQ read out of the traveller's sentence. Height
is 32px so a row of eight fits above the results, and the remove button widens its own hit area to
about 40px with a `before:-inset-2.5` pseudo-element rather than inflating the chip. `aria-label` on
the remove button reads "Remove filter {label}". Passing no `onRemove` gives a read-only chip, which
is how the zero-result panel echoes what it understood.

### `input.tsx` — `<Input>`, `<SearchField>`

```
Input        { icon?: ReactNode, ...InputHTMLAttributes }               forwardRef
SearchField  { value: string, onChange: (v: string) => void,
               icon?, trailing?, ...InputHTMLAttributes minus value/onChange }   forwardRef
```

`Input` is a 44px pill; pass `icon` and it left-pads to `pl-11`. `SearchField` is the taller 48px
form used for a primary search box: it owns a `type="search"` input, defaults its icon to a
magnifier, hides the WebKit clear button, and rings the whole wrapper with `focus-within`. `trailing`
takes a clear button or a spinner. `onChange` hands you the string, not the event.

### `select.tsx` — `<Select>`

```
value, onChange: (v: string) => void
options: { value: string, label: string }[]
label?, className?
```

A real `<select>` inside a 44px pill with a `ChevronDown`, wrapped in a `<label>` so the optional
label is the accessible name. Native on purpose: the platform menu is keyboard- and
screen-reader-correct and behaves properly on mobile. Used for sort order, analytics range, page
size, market.

### `switch.tsx` — `<Switch>`

```
checked, onChange: (checked: boolean) => void
label?, className?
```

`role="switch"` with `aria-checked`. With a `label` it renders as a `min-h-10` row with the label
left and the control right — that wrapper is what carries the 40px hit target, since the track
itself is only 24px tall. Boolean facets and admin toggles.

### `slider.tsx` — `<Slider>`

```
min, max, step?, value, onChange: (v: number) => void
label?, format?: (v: number) => string, className?
```

Native `input[type=range]`. Because no browser paints the filled portion consistently, the track is
a `linear-gradient` from `--primary-strong` to `--border` at the current percentage — the filled part
is a 3px mark rather than a field, so it takes the ink shade of the brand and not the tint.
`format` renders the
readout and is where "Any price" and "Any" come from at the ends of the range; it also feeds
`aria-valuetext`, so a screen reader hears "Any price" rather than "4400".

### `tabs.tsx` — `<Tabs>`

```
tabs: { id: string, label: string, icon?: ReactNode }[]
active, onChange: (id: string) => void
className?
```

Controlled tablist with roving `tabIndex` and left/right arrow navigation that wraps. The active tab
is marked by a 3px `bg-primary` underline sitting on the container's bottom border. **The panel is
the caller's job**: render it with `id={`panel-${active}`}` and `role="tabpanel"` so `aria-controls`
resolves. `src/components/admin/TabPanel.tsx` is the example.

### `sheet.tsx` — `<Sheet>`

```
open, onClose: () => void
title?, side?: 'right' | 'bottom'   default 'right'
className?, children
```

Modal panel with `role="dialog"`, `aria-modal`, Escape to close, body scroll lock, a Tab cycle
trapped inside the panel, and focus returned to the opener on close. It slides in over one frame
rather than appearing fully formed. `side="bottom"` is the mobile pattern (filters, place detail);
`side="right"` is the desktop one (booking confirmation).

### `stars.tsx` — `<Stars>`, `<RatingLine>`

```
Stars       { value: number, size?: number, className? }
RatingLine  { value: number, count?: number, className? }
```

`Stars` rounds to the nearest half and draws the fraction with a clipped overlay, so 4.3 renders as
four and a half rather than as four. It carries `role="img"` and an `aria-label` of "Rated 4.3 out
of 5", and the five glyphs are hidden from assistive technology. `RatingLine` adds the numeral and
the localised review count and is what cards should use.

### `skeleton.tsx` — `<Skeleton>`, `<SkeletonCard>`

```
Skeleton      { className? }
SkeletonCard  ()
```

`Skeleton` is an `animate-pulse` `bg-border` block, pill-shaped by default — override the radius when
standing in for a heading (`rounded-xl`) or an image (`rounded-none` inside a card). `SkeletonCard`
mirrors the real result card's geometry exactly: 4/3 media, then title, two body lines, and a footer
row. Loading states must match the final layout so nothing jumps when data lands.

### `empty.tsx` — `<Empty>`

```
icon?: ReactNode, title: string, body?: string, action?: ReactNode, className?
```

Dashed-border card for every non-result state: nothing found, nothing loaded, nothing left in the
queue. `title` is a sentence about what happened, `body` says what to do about it, `action` is
usually a `Button`. Search's zero-result state is a bespoke component rather than `Empty` because it
carries chips and one-click relaxations, but it reuses the same dashed-card shape.

---

## 5. Layout and spacing rhythm

### Shell

`AppShell` = `SideRail` + `<Outlet/>` + `SiteFooter` + `BottomTabs`, in a `flex min-h-screen`.

- **Side rail**: `w-16` (64px), `hidden md:flex`, `border-r bg-sidebar`. Logo tile, six nav items at
  `h-10 w-10 rounded-lg`, account button pinned to the bottom. Active item is `bg-sidebar-accent`
  with `aria-current="page"`.
- **Bottom tabs**: below `md` the rail becomes a fixed bottom bar with the same six destinations and
  `pb-[env(safe-area-inset-bottom)]`. The content column pads `pb-16` to clear it.
- `NAV_ITEMS` and `isNavActive()` are exported from `SideRail.tsx` and shared with `BottomTabs`, so
  the two navigations can never disagree. `/trip/:slug` keeps Search lit, because that is where the
  traveller came from.
- The landing page renders **outside** the shell (full-bleed marketing, its own top nav). The
  assistant renders inside it but suppresses the footer, because a footer under a chat composer
  fights it.

### Page containers

| Screen | Container |
| --- | --- |
| Search | `mx-auto w-full max-w-[1440px] px-5 py-8 md:px-10 md:py-12` on `bg-panel` |
| Inspiration, Admin | `mx-auto w-full max-w-7xl px-6 py-8 md:px-10 md:py-12` on `bg-panel` |
| Trip detail | `mx-auto w-full max-w-7xl px-6 pb-36 pt-8 md:px-10 md:pt-10 lg:pb-16` |
| Landing, footer | `mx-auto w-full max-w-7xl px-6 md:px-10`, sections at `py-20` |
| Discover, Assistant | no container — two full-height columns, each padded `px-6 md:px-10` / `px-5 md:px-8` |

Search is wider than `max-w-7xl` (1280px) because it carries a 264px rail plus a three-up grid; at
1280px the cards get too narrow to read a title in two lines.

### Fixed measures

| Measure | Value | Where |
| --- | --- | --- |
| Facet rail | `16.5rem` (264px) | Search grid: `lg:grid-cols-[16.5rem_1fr]` |
| Booking panel | `22rem` (352px) | Trip detail: `lg:grid-cols-[minmax(0,1fr)_22rem]` |
| Assistant split | `lg:grid-cols-[1fr_1.15fr]` | conversation narrower than the rails |
| Discover split | `lg:grid-cols-2` | list and map equal |
| Reading measure | `max-w-2xl` / `max-w-3xl` | body prose, page intros, the conversation thread |

### Gap ladder

`gap-1.5` inside a control · `gap-2` / `gap-2.5` inside a card body · `gap-3` between controls in a
row · `gap-4` between tiles · `gap-6` between cards in a grid · `gap-8` `lg:gap-10` between rail and
results · `gap-10` `lg:gap-12` between the trip's main column and its booking panel ·
`space-y-10` / `space-y-12` between sections of one page.

Sticky elements park at `top-8` (facet rail, booking panel), `top-0` for the admin tab strip and the
Discover map. Anything sticky that receives scroll needs `max-h-[calc(100vh-4rem)] overflow-y-auto`
and the `scrollbar-thin` class.

### Motion

CSS only. `transition-colors` for hover and state, `transition-shadow` for card lift,
`transition-transform` for the sheet slide and the card image scale, `transition-opacity` for a stale
result grid. Two keyframes exist in `index.css` and nothing more: `rise` (0.24s, applied through
`.animate-rise` on streamed chat content) and `blink` (the streaming caret). Everything is at or
under 250ms.

---

## 6. Do and do not

### Do

- Use tokens. `bg-panel`, `text-muted-foreground`, `border`, `bg-[var(--success)]/15`.
- Use `rounded-full` for anything you operate and `rounded-2xl` for anything you read.
- Give every loading state the geometry of its loaded state.
- Give every empty and error state a sentence about what happened and one action.
- Put figures in `tabular-nums`.
- Say when the data is not real. The "Demo data" badge on Search and the seeded-fixture notes on
  Admin are load-bearing honesty, not decoration.
- Keep one `font-extrabold` element per fold.
- Let the content be the loudest thing on the page.

### Do not

- **No hardcoded hex.** If the colour is not a token, add a token. `MapPanel`'s `PIN_HEX` is the one
  exception and §2.6 says why, and why it is currently wrong.
- **No brand lime as text on white** (1.4:1) and **no lime hairline** — a `border-primary` edge with
  nothing filled behind it does not exist on screen. Use `--primary-strong` for a mark, `bg-primary`
  for a fill.
- **No third hue.** Lime means brand and positive, periwinkle means state and focus, and
  `--destructive` is the only colour outside both. Anything else needs a reason written down here.
- **No solid state colour behind body text without checking §7.** White on `--success` and on
  `--destructive` both pass at 5.0:1, so a solid chip is allowed — but the house pattern is a 10–20%
  tint with an ink label, and mixing the two in one table looks like a bug.
- **No second font family, no icon font.** Icons come from `lucide-react` at `size-4` / `h-5 w-5`.
- **No `any`, no barrel `index.ts`, no default exports** except `App.tsx`.
- **No JSDoc walls** on components and no ASCII section dividers in `.tsx`.

### Banned techniques, and why

| Banned | Why |
| --- | --- |
| Scroll-jacking, scroll-linked animation | takes the scrollbar away from the reader; breaks Find-in-page, keyboard paging and screen readers |
| Parallax | motion the reader did not ask for, a vestibular trigger, and it costs a paint on every frame |
| Canvas / WebGL / 3D | no text in the accessibility tree, no selectable copy, nothing for a crawler; this is a search product whose whole point is indexable content |
| Animation libraries (framer-motion, anime.js, GSAP) | a dependency and a bundle for effects that four `transition-*` utilities already cover |
| Marquees, auto-advancing carousels | move content out from under the eye and fail WCAG 2.2.2 unless paused |
| Cursor followers, custom cursors | pointer-only, meaningless on touch, and they hide the affordance the platform already provides |
| Gradient-mesh hero blobs | not in the reference, and they push text contrast below AA wherever the mesh happens to be light |
| Glassmorphism beyond a thin bar | blurred translucency puts text over unpredictable luminance. The two `backdrop-blur` uses are the mobile tab bar and the chat composer, both at `/95` opacity so the text sits on a known colour |
| Auto-playing video or audio | uninvited, expensive on mobile data, and a WCAG 1.4.2 failure without a control |
| Infinite scroll on results | the brief requires shareable, crawlable, numbered pages; Search paginates |

---

## 7. Accessibility

Ratios below were computed from the sRGB hex values in §2 with the WCAG 2.1 relative-luminance
formula. They are conversions, not device measurements, and they are reproducible from the hex column
with any contrast checker.

### Text contrast — measured pairs

| Foreground | Background | Ratio | Verdict |
| --- | --- | --- | --- |
| `--foreground` / `--ink` `#191823` | `--background` `#ffffff` | **17.6** | AAA |
| `--muted-foreground` `#5a5a68` | `--background` | **6.8** | AA (AAA at 18.66px bold / 24px) |
| `--muted-foreground` | `--panel` `#f7f8f2` | **6.3** | AA |
| `--primary-foreground` `#23300f` | `--primary` `#c8e98a` | **10.3** | AAA — the brand pill's label |
| `--warning-foreground` `#1b1636` | `--warning` `#9287e2` | **5.6** | AA — white on the same fill is 3.1, which is why this one is ink |
| `--primary-strong` / `--lime-ink` `#5c7d2a` | `--background` | **4.6** | AA at any size |
| `--periwinkle-ink` `#5f52b8` | `--background` | **5.3** | AA at any size |
| white | `--success` `#4f7a3a` | **5.0** | AA |
| white | `--destructive` `#c2415a` | **5.0** | AA |
| white | `--ink` | **17.6** | AAA — the primary button |
| `--ring` `#9287e2` | `--background` | **3.1** | non-text indicator only — see Focus below |

The binding number is `--muted-foreground` at **6.8:1**. Every 11px and 12px string in the system
uses it, and the 1.9 points of headroom over AA are exactly what let the same token sit on `--panel`
(6.3:1) and on `--accent` without a second value.

Three pairs are bounded rather than measured separately, because the bound is enough to close them:

- `--foreground` on `--panel` and on `--accent` sit just under its 17.6:1 on white — both surfaces are
  within 6% of white, so neither can drop below AAA.
- `--foreground` on `--primary` clears **10.3:1**, because `--foreground` is darker than the
  `--primary-foreground` measured against the same fill. This is what licenses the full-strength lime
  hero band.
- `--sidebar-foreground` is the same value as `--muted-foreground`, so the rail's inactive icons are
  6.8:1 on `--sidebar` — and icons need 3:1, not 4.5:1.

### Text contrast — the combinations we refuse

| Foreground | Background | Ratio | Consequence |
| --- | --- | --- | --- |
| `--primary` `#c8e98a` | white | 1.4 | never text, never a hairline. §2.5 |
| `--secondary` / tea green `#d0f0a8` | white | 1.3 | as above |
| `--periwinkle` `#a8adf0` | white | 2.1 | a wash and a gradient stop only; `--periwinkle-ink` is the text form |
| `--border` / platinum `#ebebeb` | white | 1.2 | fine for a card edge, marginal for an input edge — see the known gap below |

Under the old yellow palette the refused pairs were white-on-`--success` and white-on-`--destructive`.
Both now pass at 5.0:1, so the reason `--success-foreground`, `--warning-foreground` and
`--destructive-foreground` stay unreferenced is consistency of pattern rather than contrast:
`SourceHealth`, `ReviewQueue`, `Badge` and `Chip` all express state as a tint with an ink label, and
one solid chip among them would read as an unstyled element.

### Focus

`index.css` sets a global `:focus-visible { outline: 2px solid var(--ring); outline-offset: 2px }` and
every interactive primitive adds `focus-visible:ring-2 focus-visible:ring-[var(--ring)]`, with
`ring-offset-2` where the control sits on a fill. Keyboard focus is never invisible.

`--ring` is soft periwinkle, the most saturated colour in the palette, chosen for this job rather than
inherited: it measures **3.1:1 against white**, which meets WCAG 2.2 SC 1.4.11's 3:1 for a non-text
indicator, and it stays legible over a lime fill because it is the opposite hue. Under the previous
palette the ring was the brand yellow at 1.56:1 and failed outright; that gap is closed.

**Known gap, stated plainly — two, and both are one line each.**

1. The ring is **2.9:1 on `--panel`**, fractionally short of 3:1. In practice almost every focusable
   control on the three `bg-panel` screens sits inside a `bg-card` container, and `outline-offset: 2px`
   puts a white gap between the control and the outline, so the measured pair is usually
   ring-on-white. It is still a real edge case for a control placed directly on the panel. The fix is
   `--ring: var(--periwinkle-ink)` (5.3:1 on white, 4.9:1 on panel) at the cost of a less obviously
   "focus-coloured" ring, or a two-tone indicator: `outline: 2px solid var(--foreground)` with
   `box-shadow: 0 0 0 4px var(--ring)`.
2. The field border is platinum at **1.2:1 on white**. A card hairline at that weight is a deliberate
   choice and SC 1.4.11 asks nothing of it, but a text input's border *is* how the field is
   identified, and 1.2:1 does not reach the 3:1 a UI-component boundary needs. `--input` exists as a
   separate token for exactly this case and is currently unreferenced — `Input`, `SearchField`,
   `Select` and `SearchBar` all use bare `border`, which the base layer resolves to `--border`. So the
   fix is two lines rather than one: point those four at `border-[var(--input)]`, then raise `--input`
   to a mid grey around 3.2:1. Every field changes and no card does.

### Hit targets

The baseline is 44px: `Input`, `Select`, `Tabs` and `Button size="md"` are all `h-11`;
`SearchField` and `Button size="lg"` are `h-12`. Deviations, all deliberate:

| Control | Height | Mitigation |
| --- | --- | --- |
| `Button size="sm"` | 36px | used only inside a card footer or a table row, where the surrounding row is taller and the whole card is the click target anyway |
| `Chip` remove button | 20px visual | `before:-inset-2.5` extends the target to about 40px without changing the chip's geometry |
| `Switch` track | 24px | wrapped in a `min-h-10` label row, so the label and the control are one 40px target |
| Facet row | 36px (`min-h-9`) | full-width row, 264px wide, in a vertical list with no adjacent target |
| Bottom tab | 44px+ | `py-2.5` around a 20px icon and a 10px label |

`Button size="sm"` at 36px is the one place the system sits under 40px. Raising `SIZES.sm` to `h-10`
would close it; it has not been changed because it would make every card footer taller and the
reference's card footers are compact.

### Semantics that are actually in the code

- `Tabs`: `role="tablist"` / `role="tab"`, `aria-selected`, `aria-controls`, roving `tabIndex`,
  arrow-key navigation.
- `Sheet`: `role="dialog"`, `aria-modal="true"`, `aria-label` from `title`, Escape, focus trap,
  scroll lock, focus restored to the opener.
- `Switch`: `role="switch"` + `aria-checked`. Facet rows: `aria-pressed`.
- `Stars`: one `role="img"` with a readable label; the glyphs are `aria-hidden`.
- `Slider`: `aria-valuetext` carries the formatted readout, including "Any price".
- Navigation: `aria-label="Primary"` on both the rail and the bottom bar, `aria-current="page"` on
  the active item.
- Live regions: the Inspiration result count is `aria-live="polite"`; the Discover rails set
  `aria-busy` while refetching.
- Every page sets `<title>` and `<meta name="description">` through `usePageMeta`.

### Reduced motion

```css
@media (prefers-reduced-motion: reduce) {
  .animate-rise,
  .caret { animation: none; }
}
```

Keyframe animation — the streamed-content entrance and the blinking caret — is switched off. Colour,
shadow and transform transitions are left on: they are all at or under 250ms and convey state rather
than decoration, which is the accepted reading of SC 2.3.3.

**Known gap.** Tailwind's `animate-pulse` on skeletons is not covered by that block, so a
reduced-motion user still sees loading blocks breathe. Adding `.animate-pulse` to the selector list
in `src/index.css` fixes it; skeletons remain legible without the pulse because they are
`bg-border` on `bg-card`.

### Language and locale

`<html lang="en-GB">`. Copy is UK English. `money()` formats GBP through `Intl.NumberFormat('en-GB')`
and `shortDate()` renders `12 Nov 2026`. There is no i18n layer and no second currency; both are
recorded in [`scope-and-limitations.md`](./scope-and-limitations.md).

---

## 8. How to add a component

1. **Check it is not already there.** Thirteen primitives cover most needs. A "pill with a count" is
   a `Badge`; a "removable pill" is a `Chip`; a "panel that slides in" is a `Sheet`.
2. **Decide the layer.** A generic, screen-agnostic control goes in `src/components/ui/`. Anything
   that knows about a `Trip`, a `Facet` or an endpoint goes in `src/components/<screen>/`. If it
   imports from `src/lib/api.ts`, it is not a primitive.
3. **Write the props type first**, as a local `interface XProps` above the component. No `any`. Use
   `import type` for type-only imports. Include `className?: string` and merge it last through
   `cn()` so callers can always override.
4. **Reach for a token, never a hex.** Missing colour? Add it to `:root` and to `@theme inline` in
   `src/index.css` — one place, both maps.
5. **Pick from the shape vocabulary.** `rounded-full` if it is operated, `rounded-2xl` if it is read.
   Height from the ladder: 36 / 44 / 48px.
6. **Make focus visible.** `focus-visible:outline-none focus-visible:ring-2
   focus-visible:ring-[var(--ring)]`, plus `ring-offset-2` on a filled surface. Never remove the
   outline without replacing it.
7. **Check the hit target.** 44px, or document the mitigation the way §7 does.
8. **Add the semantics as you go**, not afterwards: `role`, `aria-pressed`/`aria-checked`/
   `aria-selected`, an `aria-label` on any icon-only control, `aria-hidden` on decoration.
9. **Design the three other states**: loading (a skeleton with the same geometry), empty
   (`<Empty>` with a real sentence and an action), error (the same, plus Retry).
10. **Only CSS transitions**, at or under 250ms, from `transition-colors` / `-shadow` / `-transform`.
    If it needs a keyframe, add it to `index.css` and to the reduced-motion block in the same edit.
11. **Match the house voice**: named function export, no semicolons, single quotes, 2-space indent,
    hooks then derived values then JSX, comments only where a reader would ask "why?".
12. **Document it here.** A primitive that is not in §4 will be reimplemented by the next person.
