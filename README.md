# Doodlemap

NYC neighborhood map doodler game built with Next.js.

## What It Does

- Loads NYC 2020 Neighborhood Tabulation Areas (NTAs) from NYC Open Data (`9nt8-h7nd`)
- Renders neighborhoods on an interactive map
- Lets users select a neighborhood and draw a doodle representing its vibe
- Saves one doodle per `nta_code` and supports view/edit/clear flows
- Tracks map completion progress (`doodled / total playable`)

## Stack

- Next.js (App Router)
- TypeScript
- Tailwind CSS v4
- MapLibre GL JS (loaded from CDN at runtime)

## Requirements

- Node.js 20+
- npm 10+

## Quick Start

```bash
npm install
npm run dev
```

App runs at [http://localhost:3000](http://localhost:3000).

## Scripts

```bash
npm run dev           # Start dev server
npm run build         # Production build
npm run start         # Run production build
npm run fetch:nta     # Fetch + normalize NYC NTA GeoJSON into src/data/nyc-nta-2020.json
npm run lint          # Lint entire repo
npm run lint:fix      # Lint + auto-fix
npm run typecheck     # TypeScript type check
npm run format        # Prettier write
npm run format:check  # Prettier check
npm run check         # Lint + typecheck + format check
```

## API Contract

- `GET /api/neighborhoods`
  - Returns normalized NTA features with `ntaCode`, `name`, `borough`, `type`, `hasDoodle`
  - Returns progression counters (`total`, `doodled`, `remaining`, `completionPct`)
- `GET /api/doodles/:ntaCode`
  - Returns doodle document or `null`
- `PUT /api/doodles/:ntaCode`
  - Upserts doodle as vector strokes
- `DELETE /api/doodles/:ntaCode`
  - Clears doodle for neighborhood

## Data + Persistence

- Neighborhood boundary source:
  - NYC Open Data view ID `9nt8-h7nd`
- Doodle storage:
  - JSON file in temp dir (`$TMPDIR/doodlemap/doodles.json`)

## Attribution

- Neighborhood boundaries: NYC Open Data
- Basemap data: OpenStreetMap contributors

## Production Note

Do not rely on OSM Foundation default tile servers (`tile.openstreetmap.org`) for production traffic. Use a dedicated OSM-derived provider or self-host vector/raster tiles.
