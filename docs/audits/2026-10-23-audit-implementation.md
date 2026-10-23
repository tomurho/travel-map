# Travel map audit implementation — 23 October 2026

The local engineering changes are implemented and verified. Final validation is recorded below.
Seven approved catalog merges and the Taipei day-trip choice are applied locally. Two uncertain identity pairs remain separate. No deployment or live Google Sheet write was performed.

The guide now reveals a selected pin above its card. The admin keeps successful work when another item fails.
New captures can advance to lookup in the admin. Lookup, human verification, and publication remain separate actions.

## Scope and preserved work

Source: [implementation prompt](2026-10-23-fix-prompt.md), [October 23 audit](2026-10-23-travel-map-admin-audit.md), and [October 22 safeguards](2026-10-22-audit-fixes.md).

The starting tracked tree had no user changes. The user’s untracked prompt, audit, and five screenshots remain intact.
No commits, live Sheet mutations, real provider extraction, live Publish/Apply actions, or deployment were performed.
Normal public Google Maps loading was inspected at `http://localhost:3000`.

Local catalog changes fill 59 blank districts, merge seven approved pairs, and label 鮨安 as a Taipei day trip.
The catalog now contains 705 records. Full before/after records, ID mappings, and backups preserve every replaced value. Coordinates were not changed.

## Audit-to-change record

| Audit item | Implemented behavior and evidence | Regression or inspection | Remaining decision |
|---|---|---|---|
| Local access | `pnpm dev` and `pnpm start` bind to loopback. `isAdminEnabled` governs the page and every existing API through shared authorization. Production still needs `ENABLE_ADMIN=true` and a password. README specifies the working localhost browser origin. | `audit-regressions.test.ts`, existing authorization tests; listener inspected as `127.0.0.1:3000`. | Hosted configuration and LAN firewall were not changed. |
| U1: selected pin and view switches | Map framing keys use IDs and coordinates, independent of view and result order. Show on map has an explicit reveal request and measured card inset. Ordinary switches retain selection, filters, center, and zoom. New map instances reset framing safely. | `map-viewport.test.ts`; browser suite checks zoom ≥17, pin above card, manual pan/zoom, selection, Back, and category dismissal. Real Google map inspected at all three widths. | None. |
| U2: duplicate identities | Review candidates warn about repeated Google Place IDs. Co-located venues open a keyboard chooser; both records remain selectable. Nine groups have complete before/after proposals and proposed ID mappings. | `audit-regressions.test.ts`, `pipeline-audit-fixes.test.ts`, shared-pin browser test. | Seven merges approved and applied. Two uncertain venue pairs remain separate and flagged. |
| U3: Taipei outlier | City overview frames central results and explains the distant saved place. Show all places includes every result. Review warns about distant pins. The outlier’s list entry remains available. | Viewport helper tests, Taipei browser test, saved address and proposal. | Owner chose a Taipei day trip; applied with a durable public label. |
| U4: distant Nearby | A location outside saved cities shows “No saved city is near you.” Current city and map pins remain useful. Cancelled and superseded requests retain previous safeguards. | Mocked geolocation browser test and existing location callback tests. | Physical location permission was not requested. |
| U5: mobile editing and districts | Edit list is hidden below 900 pixels. Area is hidden when it has no choices. Filled 54 Tainan and five Kaohsiung districts from saved addresses. | 320-pixel browser test; `district-changes.json` contains every field change and address. | Other missing districts remain blank where evidence was insufficient. |
| A1: Preview and Apply | Publish and Sync construct complete records and share the file validator. Preview identifies invalid rows and fields. Shared status normalization makes counts and actions agree. Known invalid plans return `VALIDATION_FAILED`, not an uncertain-write message. | Invalid URL, lowercase Verified, blocked Apply, and existing preview/stale-plan tests. | None. |
| A2: row isolation and stale data | Snapshot returns valid candidates and captures independently from publish/sync issues. Failed refreshes label retained data with its checked time and Retry. Lookup, Publish, and Update retain separate errors and retry actions. | Mixed valid/invalid fixture, malformed unrelated headers, stale snapshot browser test, concurrent-failure browser test. | None. |
| A3: screenshot work preservation | Extraction returns a result per image ID. Successful results, corrections, and ignored rows survive failed-image retries. Replacement is disabled during requests; selection generations reject obsolete responses. | Same-name images, partial provider failure, timeout, corrected drafts, failed Send, and retry browser tests. | No personal screenshot or real extraction provider was used. |
| A4: current work and New captures | Overview and current work appear first. Add screenshots is collapsed below them. New captures show evidence, selection, and direct Sheet links. Mark ready checks full row versions and serializes duplicate submissions. | Backend row/header/position/Sheet-change and duplicate submission tests; browser confirms exactly one versioned mutation. | No live capture was advanced. |
| A5: Google connection repair | Only `pnpm setup:google-sheets` requests interactive consent. HTTP paths return exact repair steps. OAuth, Sheets, Places, screenshot extraction, and browser waits have deadlines. Drafts stay present after failures. | Missing-token and bounded-wait fixtures; connection-error and failed-Send browser states. | Real credentials were not removed or repaired. |
| A6: readable screenshot evidence | Thumbnails use `object-fit: contain`. Native modal viewer shows the complete original. Escape, Close, backdrop dismissal, and focus restoration are supported. | Generated tall image with visible top/bottom bands; browser keyboard and focus checks; rendered original image inspection. | Spoken screen-reader output remains untested. |
| Maintenance: active admin code | Removed unreachable production-editing, staging, resolution, and export UI handlers. Active code is split into auth shell, pipeline, capture queue, and screenshot intake components. Existing review/conflict components remain focused. | Existing rendered/source guard tests updated to follow component ownership; type check and build. | None. |
| Maintenance: retained writers | Callers were checked before retaining legacy APIs. Staging uses the existing lock, backup, expected file hash, and atomic rename. Existing draft edits, deletes, clears, and Publish require viewed versions. Catalog verification, deletion, and URL resolution also check original records. Reads and successful saves supply fresh versions. A completed publication with failed staging cleanup reports both outcomes explicitly. | Atomic staging and stale-record tests; legacy Publish cleanup regression; existing edit/resolver tests. | File publication and staging cleanup are separate operations. Recovery never forces deletion of newer drafts. |
| Maintenance: public fields | Main guide, `/original`, and `/concept` share `public-place.ts`. Existing route-specific city normalization stays intact. | Public allowlist regression rejects private verification/provider fields. | None. |
| Maintenance: dependencies | Confirmed no source imports before removing Leaflet, React Leaflet, MapLibre, and Leaflet type packages. | Repository import search, lockfile update, type check, build. | No browser bundle saving is claimed from removing unused packages. |
| Performance | Recorded three cold runs with mobile network and CPU emulation. Kept list batching, clustering, JSON storage, and the map framework. | Repeatable opt-in measurement and raw baseline/final files. | Laptop emulation does not establish physical-phone performance. |

## Catalog changes and retained identity questions

[District changes](2026-10-23-implementation/district-changes.json) record every applied field and its existing address evidence.
[Catalog integrity proof](2026-10-23-implementation/data-verification.json) confirms those limits.
The atomic writer saved the original catalog under `.cache/places-backups/places-2026-10-23T06-50-51-359Z.json`.
The original hash is `91be1eedc3d1923ec6bb520a33c8103fb7ee1b3895afbb5d2cf3dd3e3ce9f2f7`.
The district script previews by default and applies with `--apply`. Repeating it makes no further changes.

[Catalog decisions](2026-10-23-implementation/catalog-decisions.md) explain all nine duplicate groups and the Taipei outlier.
[Exact proposals](2026-10-23-implementation/catalog-proposals.json) contain complete before/after records, differences, and seven proposed ID mappings.
The owner approved the seven merges and chose to retain 鮨安 as a Taipei day trip.
[Executed merge ledger](2026-10-23-implementation/approved-merges.json) records every approved record, backup, and old-to-retained ID mapping.
The catalog changed from 712 to 705 records. No city reassignment occurred.

The proposal keeps Loved/Been for Saeki and Bar K家. It keeps Want to go for Ikehan and 廟東 食肆.
It retains the specific Yakiniku category for Edo Yakiniku and Café for MITSUO.
The two differently named pairs, 大極殿本舗/栖園 and 小隱茶庵/木下庵, remain separate until their identities are confirmed.
The seven proposed merges are now approved and applied. The two remaining pairs still need venue identity evidence before any future merge.

## Validation

| Check | Result |
|---|---|
| `pnpm test` | 218 passed; no failures or skips. |
| `pnpm typecheck` | Passed. |
| `pnpm build` | Production build passed. |
| `git diff --check` | Passed. |
| Browser regressions | 18 passed against the final production build with the approved 705-record catalog. |
| Independent review | All material findings resolved and rechecked. |
| Disabled production admin | `/admin` returned 404. Authenticated `/api/admin/places` returned 401 with `ENABLE_ADMIN=false`. |
| Catalog integrity | Reconstructed the final 705 records from the original catalog, 59 district fills, seven approved merges, and the day-trip note; exact match. |

Destructive actions, Google Sheets writes, publication, failed credentials, provider failures, and geolocation used fixtures or temporary files.
Every browser fixture intercepts admin requests before navigation. Unknown admin endpoints fail locally.
The real-map measurement blocks admin requests and records host totals without credential-bearing URLs.

## Performance measurements

[Baseline raw measurements](2026-10-23-implementation/performance-baseline.json) use three cold Chrome contexts at 390 × 844.
The simulation uses 1.6 Mbps download, 0.75 Mbps upload, 150 ms latency, and four-times CPU slowdown.
Cache was disabled. The server was a local production build.

Initial medians: public shell 2.03 seconds; map renderer and controls 7.32 seconds.
Completed transfer at that point was about 802 KB: 319 KB from the app and 483 KB from Google.
Category click to the next rendered state took about 687 ms. Browser action overhead was measured separately.
Startup means the map renderer and Zoom in control exist. It does not mean all map tiles finished loading.
Transfer excludes pending and failed requests. Local hosting omits real deployment latency.

The repeated measurements after cluster batching are in [final raw measurements](2026-10-23-implementation/performance.json).
The final median click-to-frame time was 282 ms, compared with 687 ms before the fix: about 59% faster. Both measurements used the 712-record catalog before the approved merges; the delivered catalog is smaller at 705 records.
Each removed marker previously triggered cluster calculation. The implementation suppresses those individual redraws and renders once after the batch.
A browser regression checks excessive cluster-marker creation. List batching and clustering remain enabled.

Final medians were 2.12 seconds for the shell and 8.42 seconds for map renderer/controls.
Transfer was about 799 KB: 319 KB app and 480 KB Google. Startup varied between 7.40 and 8.61 seconds.
This small sample does not establish a startup improvement. It supports the filtering fix only.
No database, framework replacement, or city-specific loading was added because these measurements do not justify that larger change.

## Independent review

A separate agent reviewed the complete source changes without implementing them.
It found missing version tokens in retained API responses, shared action errors, and outdated startup instructions.
Those findings were fixed and rechecked. A second review found misleading recovery after staging cleanup failed.
That outcome now explicitly reports completed publication and preserved newer drafts. A focused regression covers it. The reviewer confirmed the cluster batching and desktop action style. Post-approval review also checked the seven exact merges and found that sync could erase the day-trip note. The label now comes from local metadata, independent of Sheet-owned notes. A regression verifies that it stays visible after notes are replaced.

## Browser evidence and accessibility limits

Public inspection covered desktop 1280 × 720, 390 × 844, and 320 × 568.
The real Google map showed the selected pin with street context above the detail card.
Browser automation also covers direct categories, filter dismissal, browser Back, map failure, shared pins, and distant geolocation.

Admin fixtures cover populated queues, validation conflicts, screenshot results, loading, empty, failed, and stale states.
Keyboard tests cover filter Escape, shared-location choices, and original-image dismissal with focus restoration.
Reflow was checked at 320 CSS pixels. The public probe doubles actual text sizes, including fixed-pixel labels.
The admin probe sets the root font to 200% and checks panel overflow; fixed-pixel admin text is not fully covered by that probe.
These checks do not establish complete accessibility compliance.
Physical phones, spoken screen-reader output, and a full browser-zoom audit remain untested.

Evidence files are in [the implementation evidence folder](2026-10-23-implementation/).

Visual follow-up fixed two admin mobile layout problems: crowded overview actions and misleading zero captures during initial loading.
The final screenshot review also found a public detail title squeezed beside large action text.
The compact card now wraps its copy and actions instead of forcing narrow columns. The strengthened browser check rejects title/action overlap.
The desktop Show on map label also has explicit contrast after a stylesheet inheritance conflict was found visually.

Check logs: [unit tests](2026-10-23-implementation/unit-tests.txt), [browser tests](2026-10-23-implementation/browser-tests.txt), [build](2026-10-23-implementation/build.txt), and [measurement run](2026-10-23-implementation/performance-run.txt).

The approved merge backup is `.cache/places-backups/places-2026-10-23T07-27-50-382Z.json`.
The seven permanent mappings are in `src/data/place-id-aliases.json`.
An old Published or Review ID now blocks its Preview with the retained ID and repair guidance.
Reconcile any affected live Sheet rows deliberately before a future Publish or Sync. This run did not inspect or edit those live rows.
Published still owns ordinary notes. `src/data/place-day-trips.json` preserves the approved guide label even when a Sheet sync replaces those notes.

To use the verified local app, run `pnpm dev`, then open `http://localhost:3000`.
Temporary validation servers are stopped after inspection. The changes are local and have not been deployed.

The independent reviewer rechecked the durable label and reported no remaining material finding.
Two shared-identity pairs remain intentionally separate: 大極殿本舗/栖園 and 小隱茶庵/木下庵.
Their provider identities remain unresolved. No additional unapproved catalog changes are queued for automatic application.

## Evidence to inspect

- [Real map at 390 pixels](2026-10-23-implementation/mobile-show-on-map.png).
- [Real map at 320 pixels](2026-10-23-implementation/mobile-320.png).
- [Populated admin on desktop](2026-10-23-implementation/admin-populated-desktop.png).
- [Stale snapshot](2026-10-23-implementation/admin-stale-mobile.png).
- [Conflict review](2026-10-23-implementation/admin-conflict-mobile.png).
- [Partial screenshot results](2026-10-23-implementation/admin-screenshot-partial-mobile.png).
- [Original-image viewer](2026-10-23-implementation/admin-screenshot-original-mobile.png).
- [Loading](2026-10-23-implementation/admin-loading-mobile.png), [empty](2026-10-23-implementation/admin-empty-mobile.png), and [connection error](2026-10-23-implementation/admin-connection-error-mobile.png).
- [Public text enlargement](2026-10-23-implementation/public-320-enlarged-text.png).

## Follow-up: simpler selected list rows

The selected row now shows its status, name, category, area, and address once.
The underlined venue name opens Google Maps. One **Map** button reveals that venue in the web app.
The previous **Show on map**, external Maps button, and list-only Close button are removed.
The standalone map card also uses its underlined name for the external link.

Tapping the row background, address, or category/area expands or collapses it.
The category/area control is a native button with `aria-expanded` and `aria-controls`; Enter and Space work.
Links, the Map button, notes controls, and local editor inputs keep their own actions.
No catalog or admin workflow changes were made for this follow-up.

Validation: 218 unit tests passed, all 11 public browser regressions passed, type checking passed,
the production build passed, and `git diff --check` passed. The new browser check opens
a mocked Google Maps destination, verifies one name/status/category, tests row/background/address
toggling and Enter/Space, and confirms the in-app Map action keeps selection and reveals street context.
Desktop, 390-pixel, 320-pixel, and enlarged-text checks passed. Physical-phone behavior remains untested.

[Updated wine-bar list](2026-10-23-implementation/list-row-wine-mobile.png), [320-pixel layout](2026-10-23-implementation/list-row-wine-320.png), and [browser results](2026-10-23-implementation/list-row-browser-tests.txt).
The follow-up is local and has not been deployed.

## Follow-up: list spacing and alignment

The category and district now sit directly below the underlined place name.
The address starts at the same left edge, with a small gap above it.
The name keeps its existing text style and Google Maps link.
The row toggle retains a 24-pixel minimum height, and the Map button retains its 44-pixel height.

Visual inspection covered the selected beef-noodle venue at 390 × 844 and 320 × 568.
The name, category, and address share the same measured left edge.
The production build, all 11 public browser checks, and `git diff --check` passed.
The browser checks include keyboard toggling, external links, the in-app Map action, and enlarged text.
Physical-phone behavior remains untested. This change is local and has not been deployed.

[390-pixel layout](2026-10-23-implementation/list-row-alignment-mobile.png) and [320-pixel layout](2026-10-23-implementation/list-row-alignment-320.png).
