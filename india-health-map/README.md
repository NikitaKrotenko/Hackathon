# India Health Coverage Map

Standalone React/Vite version of the NFHS-5 India district health map.

This package does not require Databricks at runtime. It uses static JSON exports in
`public/data/`:

- `nfhs_records.json` — NFHS-5 district health indicators exported from the hackathon Databricks workspace.
- `india_districts.geojson` — simplified Census 2011 district boundary layer from DataMeet.
- `datameet_districts_readme.md` — source attribution for the boundary layer.

## Run Locally

```bash
npm install
npm run dev
```

## Build

```bash
npm run build
```

## Data Notes

NFHS values marked `*` are treated as suppressed. Parenthesized values are parsed
as numeric estimates and marked as small-sample values. The bundled district
boundaries are Census 2011 boundaries, while NFHS-5 includes newer districts and
state reorganizations, so the app reports direct, fallback, and unmatched
boundary counts.
