# Slice engine — build spec

_The "dive into any dimension without a page each" answer. One descriptor → one reader → one view (`SliceView`, built). Ships **after** trending. Mostly a refactor of `getIPDetail`/`getPlatformDetail`, not net-new surface._

## Concept
Every cut of the market (chain, IP, set, grade, and combinations) is a **`SliceDescriptor`**. `getSlice()` turns it into data (from the spine, or computed on-demand). `SliceView` renders it. Every breakdown panel links one dimension deeper — the panels *are* the navigation.

## Shared contract
```ts
type Dim = "market" | "ip" | "platform" | "chain" | "set" | "grade";
type SliceDescriptor = { dim: Dim; key: string; parents?: SliceDescriptor[] };
// canonical path form (fixed dim order → one URL per cut): chain > platform > ip > set > grade
//   e.g. /explore/ip/pokemon/set/base-set/grade/psa-10
getSlice(d: SliceDescriptor): Promise<SliceData>;          // SliceData = the shape SliceView already consumes
sliceLabel(d: SliceDescriptor): { title: string; breadcrumb: { label: string; href: string }[] };
childSlices(d: SliceDescriptor, byDim: Dim): { key: string; label: string; href: string; value: number }[];
```

## Backend
- **B-S1 — descriptor codec.** `SliceDescriptor` + canonical encode/decode (URL path ⇄ descriptor), fixed dim order so the same cut is one URL / one cache key.
- **B-S2 — `getSlice()`, tiered:**
  - **Tier 1 (instant, from the spine):** map descriptor → `entity_type`/`entity_key`. Single dims already exist — `ip`, `platform`, `set` (`"{ip}:{set}"`), `grade` (`"{ip}:{grade}"`), `platform_ip`. `chain` = sum of member platforms (Solana = cc + phygitals, Base = beezie, Polygon = courtyard).
  - **Tier 2 (on-demand + cached):** combos not pre-aggregated → filter the `cards` + sale-panel rows by **all** dims in the descriptor (ip/set/grade via card columns; chain/platform via platform; the window), aggregate to `SliceData`, cache under the canonical key. Apply the index's **liquidity floor** → "insufficient data" when thin.
  - Returns uniform `SliceData`: rail stats + activity series + dominance breakdowns + top cards + recent sales — the same shape `getIPDetail`/`getPlatformDetail` return today.
- **B-S3 — `childSlices()`** for the drill-down panels (by set / grade / platform / chain): ranked child values + their deeper-descriptor hrefs.

## Frontend
- **F-S1 — `/explore/[...path]` route:** parse path → descriptor → `getSlice` → `<SliceView>`.
- **F-S2 — collapse the named pages:** `/ip/[key]`, `/platform/[key]`, new `/chain/[key]` become thin wrappers that build a descriptor and render the same engine (keep the pretty URLs for the top entities).
- **F-S3 — drill-down:** make the dominance/breakdown rows (`IPDominance`, By-Platform, etc.) link to `childSlices()` deeper descriptors; breadcrumb from `sliceLabel.breadcrumb`; optional facet bar (dim dropdowns) for lateral cuts. Reuse `SliceView`, `IPActivityChart`, `IPDominance` unchanged.

## Caveats (design in from the start)
- **Thin deep slices** → liquidity floor / "insufficient data", not noise.
- **Tier-2 first-hit latency** → cache under the canonical key; precompute popular combos if needed.
- **Trending composes:** `getTrendingCards` is being built slice-aware → "trending in this slice" is a free panel per cut.

## Sequencing
Trending (B3/F6) ships first. This is the next round.
