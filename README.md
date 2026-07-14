# Travel Field Guide

A personal, map-first travel field guide built with Next.js. It turns saved place data into a mobile-friendly guide for revisiting favorites and deciding where to go next.

## Getting started

1. Install dependencies with `pnpm install`.
2. Add `NEXT_PUBLIC_GOOGLE_MAPS_API_KEY=...` to `.env.local`.
3. Start the app with `pnpm dev`.
4. Open the local URL shown in the terminal. The Field Guide is the default route at `/`; the previous interface remains available at `/original` for comparison.

## Import spreadsheet data

Export your spreadsheet to `.xlsx` or `.csv`, then run:

```bash
pnpm import:places path/to/places.xlsx
pnpm import:places path/to/places.xlsx --sheet Test --write
```

The importer previews by default. Pass `--write` to update `src/data/places.json`.
Writes are blocked when rows are skipped, IDs are ambiguous, the result is empty,
or the record count drops by more than 20%. Each safeguard has an explicit
`--allow-*` override for reviewed exceptions, and successful writes create a
timestamped backup under `.cache/places-backups`.

Run the focused ingest safety suite with `pnpm test:ingest`.

Published-to-app sync is fail-closed: an invalid or unverified Published row
blocks the entire write. Use the documented `--allow-partial` CLI override only
for a reviewed recovery. Screenshot Capture submission is retry-safe and reports
created versus duplicate rows per source image. Admin credentials are accepted
only through the `x-admin-password` header, never in a URL.

## Expected columns

- `location name`
- `category`
- `status`
- `loved it`
- `district/neighborhood`
- `address`
- `latitude`
- `longitude`

Accepted status variants include `been`, `been to`, `visited`, `want to go`, `wishlist`, and `bucket list`. Blank status defaults to the neutral `location` status.
