# Travel Field Guide

A personal, map-first travel field guide built with Next.js. It turns saved place data into a mobile-friendly guide for revisiting favorites and deciding where to go next.

## Getting started

1. Install dependencies with `pnpm install`.
2. Add `NEXT_PUBLIC_GOOGLE_MAPS_API_KEY=...` to `.env.local`.
3. Start the app with `pnpm dev`.
4. Open **http://localhost:3000** (use the printed port if it differs). The server listens only on this laptop. Google Maps accepts the localhost browser origin. The Field Guide is the default route at `/`; the previous interface remains available at `/original` for comparison.

## Manage places: Inbox → Review → Live

Run `pnpm dev` on this laptop, then open `http://localhost:3000/admin` and sign in
with the owner password. Admin binds to loopback and is unavailable on the hosted
site, including its APIs and older deployments. Add a **place name and city**;
the app saves it in Inbox and finds Google Maps candidates. In Review, check the
place and map pin, set the category, Saved/Want to go/Been status, rating, and notes.
**Wrong place or pin** retains your personal edits while you choose another match.
**Publish to live map** publishes the draft and checks the unauthenticated public
catalogue before reporting **Live confirmed**. A failed check remains pending and
can be retried without publishing again. Removal has an explicit preview and Undo.

Admin and every public map route use the same Neon catalogue when
`CATALOGUE_ENABLED=true`. Each place retains a draft, live version, and publication
history. Editing a draft does not change the live listing. Catalogue changes need
no GitHub commit or Vercel deployment. Public tabs refresh on focus. Public API
responses exclude drafts, sources, and verification evidence.

The laptop's gitignored `.env.local` has the limited `DATABASE_URL`,
`ADMIN_PASSWORD`, `ENABLE_ADMIN=true`, `CATALOGUE_ENABLED=true`, and
`PUBLIC_SITE_URL=https://travel.tomurho.com`. Local publishing writes the shared
catalogue and checks the real public map. The laptop must be running for Admin;
the public map stays online independently.

Vercel uses `ENABLE_ADMIN=false`, `DATABASE_URL`, and `CATALOGUE_ENABLED=true`.
A project firewall blocks `/admin` and `/api/admin` on all hosted deployments.
Server code also rejects Admin on Vercel even if the flag is accidentally enabled.
`GOOGLE_PLACES_API_KEY` enables lookup; `OPENAI_API_KEY` enables screenshot intake.
Keep secrets in Vercel's encrypted server environment, never `NEXT_PUBLIC_*`.
The database application role needs only schema USAGE and SELECT/INSERT/UPDATE on
`travel_catalogue`. It does not need DELETE, DDL, or database ownership.

Migration previews by default: `pnpm catalogue:migrate -- --sheets /path/to/sheets.json`.
Apply with `--apply`. `--database-stdin` accepts the owner connection privately
through stdin. It seeds only an empty table, keeps a complete source backup under
`.cache/catalogue-migration`, and compares every existing place field after readback.
Pending Review/Capture rows are imported as private drafts/Inbox records. Existing
IDs, aliases, closures, null/false ratings, notes, and verification evidence survive.
For isolated development, use `CATALOGUE_LOCAL_PATH=/private/tmp/catalogue.json`;
local checks say **Local preview confirmed**, never **Live confirmed**.

**Export catalogue** downloads a complete owner-only JSON backup, including history.
After cutover, the old admin API writers return 410. Old spreadsheet commands are
legacy maintenance tools and do not publish to the shared catalogue. The bundled
JSON remains a migration backup, not the live data source. Do not disable the shared
catalogue or roll back to a pre-catalogue app after publishing new changes; that
would serve an old snapshot. Restore a publication through Undo, or restore the
database from a reviewed current backup.

## Browse the guide

The main guide at `/` and `/field-guide` uses the approved compact mobile layout
for every city. Choose a city in the header, then a broad group and an optional
specialty. The guide starts on **All categories**, including types awaiting review.
Specialties occupy one horizontal row; **More** opens the searchable full list.
Counts and area choices come from the selected city. Empty groups are disabled.

On mobile, the header stays at two rows: city/Search/Filters, then active filter
chips and one button for the opposite view. Map shows **List**; List shows **Map**.
Filters expands the controls over the current view. Selecting a specific category,
such as Bakery, updates that view and closes the panel. This also works from
**More**. Broad groups remain open so you can choose a specialty. Other refinements
update results while the panel stays open. The footer shows the count and the
same opposite-view action. Filters or Escape closes the panel while retaining its
changes. Search opens the panel and focuses its input. Active chips can be
removed individually; Reset clears every refinement. Desktop keeps its visible
filter panel and local editing controls.

Select a pin to open its map card. In List, tap the row background or its category
and area to expand or collapse details. Keyboard users can focus that same toggle
and press Enter or Space. Each row shows the place name once. The underlined name
opens Google Maps in a new tab. The single **Map** button in expanded list details
reveals the selected place on the web app's map. Links, Map, notes controls, and
local editor fields keep their own actions. On mobile, **Map** and **List** preserve
filters and selection; desktop shows both panes. Numbered circles zoom into clusters.
The map card also links its underlined name directly to Google Maps. It omits the
type when its exact specialty is already selected. Addresses remove exact repeated city/district and
country components while retaining street, building, and unit details; stored
addresses and Maps links are unchanged. Notes expand within the card on demand.
The list loads in batches, and selecting a pin reveals its entry even beyond the
first batch. On localhost, **Edit list** retains the existing inline editor.

If Google Maps cannot load, **View list** keeps places and their details available.
Result counts remain available to assistive technology while filters are open.
Cancelling Nearby or choosing a city ignores any outstanding location response.
Kyoto ward aliases share one area filter. **Other** contains types without an
approved group, retaining their original specialty labels and saved data.

The last city is remembered when storage is available. An explicit city in a URL
takes priority. Nearby can switch to the city near your location; choosing a city
manually turns Nearby off. Group, specialty, area, Loved/Want to go, search, and
Map/List state persist in the URL. Deliberate choices add browser history entries;
typing a search updates the current entry. Old `category` links resolve approved aliases
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

In Admin, enter the admin password if one is configured, then select **Load admin
data**. The page opens without private catalog records; an authenticated request
loads them without caching. Workflows appear after that request succeeds. On
unprotected localhost, the initial data load can proceed automatically.

Verify and Reject require the candidate version shown in the review queue. If a
Sheet row changes, refresh the data and review it again. Local editors also check
the original record version. A stale save leaves the newer data intact and asks
for a page reload. Category-only edits preserve the original unrated value.

Select **Preview Update** to inspect Published changes. Each verification conflict shows local and Published values with direct
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

## October 22 audit fixes

The [implementation record](docs/audits/2026-10-22-audit-fixes.md) maps the backend
and UI findings to their fixes, regression coverage, browser evidence, and release
checks. It links the original audit for context. No catalog migration is needed.

## October 23 admin and map fixes

`pnpm dev` and `pnpm start` bind to `127.0.0.1`. Open the browser through
`http://localhost:3000` so the configured Maps referrer works. Local production-mode
tests require `ENABLE_ADMIN=true` and the existing admin password. Hosted Admin
pages and APIs are always disabled. The remaining Sheet workflow notes below
describe the retired interface; use the local Inbox → Review → Live interface.

Run `pnpm setup:google-sheets` in a terminal to connect or repair Google Sheets.
Only that command asks for a Google authorization code. HTTP requests return repair
steps instead of waiting for terminal input. Provider calls have deadlines.

The admin starts with the overview and current work. In **New captures**, inspect
the source evidence, select the intended rows, then choose **Mark ready**. This
permits lookup only. **Process Ready Rows**, human candidate verification, Publish,
and the final app update remain separate actions. Changed rows require a fresh review.

**Add screenshots** is below current work. Each image reports its own result.
Retry processes failed images and retains successful text and manual corrections.
Use **View original screenshot** to inspect the full image; Escape closes it.
A failed refresh labels the last good snapshot with its checked time and offers Retry.

Retained staging APIs still support incomplete drafts. Reads return `recordVersion`
and `stagingVersion`; updates require `expectedRecordVersion`. Delete, clear,
and staged Publish require the viewed version in `x-record-version`. Catalog
verification and URL resolution also require `expectedRecordVersion`; catalog
delete requires `x-record-version`. Missing or stale versions leave newer data intact.
Staged writes use the same lock, backup, and atomic replacement as the catalog.

Run the safe browser regressions with the local server running:
`pnpm test:browser`. They use a Maps fixture and intercept admin APIs. They never
write to live Sheets or call screenshot providers. For production checks, start
with `ENABLE_ADMIN=true ADMIN_PASSWORD=browser-fixture pnpm start`; test responses
are mocked before page navigation.

The seven approved duplicate merges are recorded in `src/data/place-id-aliases.json`.
Publish and Sync reject retired IDs and identify their retained records. Reconcile
those Sheet rows deliberately before applying a new plan. `src/data/place-day-trips.json`
keeps the approved Taipei day-trip label separate from Sheet-owned venue notes.
The full [October 23 implementation report](docs/audits/2026-10-23-audit-implementation.md)
contains evidence, measurements, backups, and the two unresolved identity pairs.
