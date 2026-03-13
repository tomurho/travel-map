# Travel Map

A personal travel website built with Next.js and MapLibre. It turns a spreadsheet of places into a bold, map-first site for revisiting favorites and tracking future destinations.

## Getting started

1. Install dependencies with `pnpm install`.
2. Add `NEXT_PUBLIC_GOOGLE_MAPS_API_KEY=...` to `.env.local`.
3. Start the app with `pnpm dev`.
4. Open the local URL shown in the terminal.

## Import spreadsheet data

Export your spreadsheet to `.xlsx` or `.csv`, then run:

```bash
pnpm import:places path/to/places.xlsx
pnpm import:places path/to/places.xlsx --sheet Test
```

That command writes normalized place data to `src/data/places.json`.

## Expected columns

- `location name`
- `category`
- `status`
- `loved it`
- `district/neighborhood`
- `address`
- `latitude`
- `longitude`

Accepted status variants include `been`, `been to`, `visited`, `want to go`, `wishlist`, and `bucket list`. Blank status currently defaults to `want_to_go`.
