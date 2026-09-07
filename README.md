# Travel Field Guide

A personal, map-first travel field guide built with Next.js. It turns saved place data into a mobile-friendly guide for revisiting favorites and deciding where to go next.

## Getting started

1. Install dependencies with `pnpm install`.
2. Add `NEXT_PUBLIC_GOOGLE_MAPS_API_KEY=...` to `.env.local`.
3. Start the app with `pnpm dev`.
4. Open the local URL shown in the terminal. The Field Guide is the default route at `/`; the previous interface remains available at `/original` for comparison.

## Browse the guide

Select a place name to show it on the map; use **Open in Google Maps** in its
details when ready to leave the guide. Selecting a pin reveals its list entry,
even beyond the first batch of results. On mobile, **Map** and **List** preserve
your filters and selection. Numbered map circles group nearby places; select a
circle to zoom in. The legend explains the individual marker colors.

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

## Preview and apply pipeline changes

Both pipeline CLIs now preview by default. Inspect the returned field changes,
then pass that result's `previewHash` to Apply:

```bash
pnpm publish:places -- --sheet-id <SHEET_ID>
pnpm publish:places -- --sheet-id <SHEET_ID> --write --expected-preview-hash <HASH>
pnpm sync:published:places -- --sheet-id <SHEET_ID>
pnpm sync:published:places -- --sheet-id <SHEET_ID> --write --expected-preview-hash <HASH>
```

The publish command previously wrote immediately; it now requires explicit
`--write` and a matching preview hash. Source edits, row/header reordering, a
changed sheet ID, or an intervening local dataset edit invalidate the relevant
preview. Preview again after a conflict or failed/uncertain write. The admin UI
follows the same contract and never automatically applies a refreshed plan.

Sync preserves local `category`, `status`, `loved`, `tabelog`, and `subway` values.
Published continues to own `notes`. Local `Closed/Moved` records remain unchanged
and are reported as preserved closures. Existing verification status, check date,
or evidence protects venue identity/location: differing names, cities, areas,
addresses, coordinates, Maps URLs, or Place IDs block the entire sync until
reconciled. City aliases and whitespace-only differences are equivalent.
Verification evidence stays together; sync does not guess which source is newer.
Places absent from Published remain in the app.

In Admin, enter the admin password if one is configured, then select **Preview
Update**. Each verification conflict shows local and Published values with direct
Sheet and Maps links. If the local record is correct, fix Published and preview
again. If Published is correct, select **Review correction**, check the venue and
pin, enter a verification note, and explicitly confirm **Verify and save
correction**. This updates only that place's venue fields and records a new manual
verification; old candidate evidence is cleared from the active record and retained
in the dataset backup. Local editorial fields stay unchanged; Published notes are
still applied separately by sync. Closures cannot be reopened through this action.
Every correction rechecks the preview and local file, invalidates the old preview,
and requires **Preview again** before another correction or sync. Failed or
uncertain saves also require a fresh preview and never retry automatically.

For reviewed partial recovery, pass `--allow-partial` to **both** Preview and
Apply. It can skip ordinary invalid rows, but cannot bypass duplicate IDs or
verification conflicts. No dataset migration is required.

Preview fingerprints detect stale inputs; they are not authentication or a
Sheets transaction. Concurrent external writers can still race after the final
read. A failed publish may have partially completed, so inspect a fresh preview
before retrying. JSON writes retain their atomic replacement, stale-writer check,
and timestamped backups under `.cache/places-backups`.
