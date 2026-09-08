# Travel Field Guide

A personal, map-first travel field guide built with Next.js. It turns saved place data into a mobile-friendly guide for revisiting favorites and deciding where to go next.

## Getting started

1. Install dependencies with `pnpm install`.
2. Add `NEXT_PUBLIC_GOOGLE_MAPS_API_KEY=...` to `.env.local`.
3. Start the app with `pnpm dev`.
4. Open the local URL shown in the terminal. The Field Guide is the default route at `/`; the previous interface remains available at `/original` for comparison.

## Browse the guide

The main guide at `/` and `/field-guide` uses the approved compact mobile layout
for every city. Choose a city in the header, then a broad group and an optional
specialty. The guide starts on **All categories**, including types awaiting review.
Specialties occupy one horizontal row; **More** opens the searchable full list.
Counts and area choices come from the selected city. Empty groups are disabled.

On mobile, the header stays at two rows: city/Search/Filters, then active filter
chips and Map/List. Filters expands the controls over the map; selecting options
updates results without collapsing the panel. **Show places**, Filters, or Escape
closes it. Search opens the panel and focuses its input. Active chips can be
removed individually; Reset clears every refinement. Desktop keeps its visible
filter panel and local editing controls.

Select a pin or place name to open one card with status, name, type, address, and
**Open in Google Maps**. On mobile, **Map** and **List** preserve filters and
selection; desktop shows both panes. Numbered map circles zoom into clusters.
The mobile card uses a compact **Maps ↗** action and omits the type when its exact
specialty is already selected. Addresses remove exact repeated city/district and
country components while retaining street, building, and unit details; stored
addresses and Maps links are unchanged. Notes expand within the card on demand.
The list loads in batches, and selecting a pin reveals its entry even beyond the
first batch. On localhost, **Edit list** retains the existing inline editor.

The last city is remembered when storage is available. An explicit city in a URL
takes priority. Nearby can switch to the city near your location; choosing a city
manually turns Nearby off. Group, specialty, area, Loved/Want to go, search, and
Map/List state persist in the URL. Old `category` links resolve approved aliases
and choose the corresponding group. Labels awaiting review remain unchanged.

### Kyoto type preview

`/preview/kyoto` remains available with the same shared interface. It stays fixed
to Kyoto, starts with Bars, has no editing controls, and does not change the
remembered city. `src/lib/field-guide-explorer.ts` owns grouping/filter behavior;
`src/lib/kyoto-preview.ts` is a compatibility wrapper for the pilot.

Use the laptop’s iPhone simulator at `http://localhost:3000/?city=Kyoto` to test
the main guide. No separate HTTPS deployment is needed.

### Approved type reconciliation

The completed September 7 workbook is recorded in
`src/data/place-type-decisions.json`: blank Types column A means approved, and
the user's four explicit column E comments supply the chosen labels. The Tea
house comment on E90 overrides that row's original Defer flag; the other ten
deferred types retain their labels. No venue-specific review decisions were made.

The batch changed only `category` on 145 of 674 listings, reducing 94 type names
to 87. `src/lib/place-types.ts` retains the approved old labels as search and URL
aliases. Imports normalize these aliases so old sheet labels do not return to
the local catalog. Published sync continues to preserve local editorial types.

The reviewed migration can be inspected with
`node --import tsx scripts/apply-place-type-decisions.ts`. It previews by default;
`--apply` writes only against the original reviewed dataset hash, with the atomic
store's stale-write protection and backup. Rerunning after application is a no-op.
The local audit is in `outputs/type-reconciliation-2026-09-07/applied/`.


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
