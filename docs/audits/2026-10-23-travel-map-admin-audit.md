# Travel map and admin audit — 23 October 2026

## Outcome in plain language

**Keep the current application. Fix its unreliable actions before adding features or changing the design.**

The public guide supports browsing, filtering, and reading place details. Its mobile layout is compact and usable at the tested widths. However, **Show on map** can open the whole city instead of revealing the selected place. Some saved venues also appear more than once.

The admin has useful checks before it saves or publishes data. Its largest usability gap is the handoff to Google Sheets. The page tells you to mark new captures Ready, but provides no action to do that. Screenshot processing and error recovery also need attention.

**ELI5 — outcome:** The guide is a useful box of place cards. Sometimes it points to the whole city when you ask for one card's location. The admin is the workbench for those cards. Some work still requires another workbench, and one bad input can interrupt unrelated work.

This is an audit, not an implementation. Application code and place records were not changed. The deliverables are this report and five screenshots.

## Your local-admin assumption

**Your assumption is reasonable if the server accepts connections only from your laptop. The normal start command does not enforce that condition.**

`pnpm dev` runs `next dev` without a hostname restriction. The installed Next server passes an unspecified hostname to its listener. Without a configured admin password, the authorization helper accepts development requests. The local configuration currently has no admin password.

This can expose the development server to other devices, subject to your firewall and network. I did not test access from another device. This is a configuration gap, not evidence that anyone has accessed it.

The smallest fix is a local start command such as `pnpm dev --hostname 127.0.0.1`. Make this the default for admin use. Keep hosted admin disabled, and apply the same enablement rule to its API endpoints. Complex account management is unnecessary for this single-user workflow.

Local use does not prevent accidental edits, stale data, failed network calls, or duplicate venues. Keep the existing previews, checks for changed records, and backups.

Evidence: [start command](</Users/tomurho/projects/travel map/package.json:6>), [authorization helper](</Users/tomurho/projects/travel map/src/lib/admin-auth.ts:16>), [page enablement](</Users/tomurho/projects/travel map/app/admin/page.tsx:7>). The audit server used a loopback-only listener throughout inspection.

## Prioritized work

P1 means establish the intended access boundary first. P2 means fix a confirmed behavior problem or a significant workflow gap. P3 means later polish or maintenance. These priorities reflect one owner maintaining a personal travel guide.

**Effort:** Small means a few hours. Medium means roughly half a day to two days, including focused checks. Editorial review can add time.

| Order | Priority | Area | Recommended work | Effort |
|---|---|---|---|---|
| 1 | P1, conditional | Local operation | Make laptop-only access the default. | Small |
| 2 | P2 | Public map | Make Show on map reveal the selected pin. Preserve the view when switching Map/List. | Small–medium |
| 3 | P2 | Admin reliability | Make Preview validate the same rules as Apply. Use one rule for Sheet statuses. | Medium |
| 4 | P2 | Admin reliability | Keep valid reviews available when another row fails. Label old data after a failed refresh. | Medium |
| 5 | P2 | Admin intake | Preserve successful screenshot results and edited drafts. Ignore responses from an older selection. | Medium |
| 6 | P2 | Admin ease of use | Add a New captures queue with Mark ready. Put the current task above screenshot upload. | Medium |
| 7 | P2 | Catalog quality | Review duplicate identities and the distant Taipei listing. | Medium |
| 8 | P2 | Public map | Explain when no saved city is near the user. Keep a useful map view. | Small |
| 9 | P2 | Admin recovery | Give browser users clear steps when Google authorization needs repair. | Small–medium |
| 10 | P3 | UX and maintenance | Improve screenshot inspection, hide unusable mobile editing, and remove abandoned code. | Several small changes |

## Public guide: findings and fixes

### U1 — Show on map opens an overview

**Observed:** At 390 × 844 pixels, I opened Kyoto in List, selected `120gバインミー京都`, then chose **Show on map**. The card stayed selected, but the map opened at zoom 11 with city-wide clusters. It did not show useful street context for that place.

Changing `view` creates a new filters object and results array. The map then fits all results. The separate effect that reveals a selected place does not run again because that place has not changed.

**Fix:** Separate changes to results from changes to presentation. Reframe all pins only when the actual results change. Give **Show on map** an explicit action that reveals the selected pin after Map is visible. Preserve manual pan and zoom during ordinary Map/List switches.

**Completion check:** Select a place in List, then choose Show on map. Its pin and nearby streets must be visible above the detail card. Switching to List and back must retain the intended view.

Evidence: [filter state](</Users/tomurho/projects/travel map/src/components/field-guide/field-guide-app.tsx:88>), [result calculation](</Users/tomurho/projects/travel map/src/components/field-guide/field-guide-app.tsx:117>), [whole-result framing](</Users/tomurho/projects/travel map/src/components/map-view.tsx:279>), [selected-place framing](</Users/tomurho/projects/travel map/src/components/map-view.tsx:322>).

![Selected place remains in a city overview after Show on map.](</Users/tomurho/projects/travel map/docs/audits/2026-10-23/mobile-show-on-map.png>)

### U2 — Duplicate identities can produce conflicting advice

**Data evidence:** Nine Google Place IDs occur twice, across 18 records. These are review candidates; a shared identity does not justify automatically merging every pair.

The two Saeki records have the same name, address, coordinates, Maps URL, and Google Place ID. One says Loved/Been; the other says Want to go. CHIUnE and Edo Yakiniku also have strong duplicate candidates. Counts and status filters can therefore describe the same venue twice.

**Fix:** Produce a duplicate review list using provider identity, then compare address and coordinates. Choose which editorial values to retain before merging. Warn about matching identities during intake. Preserve a backup and the relationship between old and retained IDs.

Six pairs also share exact coordinates. When clustering stops at zoom 16, their pins can overlap. After duplicate cleanup, let users choose from a small list when distinct venues share a pin.

**Completion check:** Each reviewed venue has the intended status and one canonical record. Legitimate businesses at the same coordinates remain individually selectable.

Evidence: [Saeki record one](</Users/tomurho/projects/travel map/src/data/places.json:5209>), [Saeki record two](</Users/tomurho/projects/travel map/src/data/places.json:5228>), [cluster zoom limit](</Users/tomurho/projects/travel map/src/components/map-view.tsx:169>).

### U3 — Review the distant Taipei listing

**Data evidence:** `鮨安` is assigned to Taipei, but its stored address says Zhubei, Hsinchu. Its coordinates are about 57.7 km from the median position of Taipei's saved places. The next farthest entry is about 7.47 km away.

All entries influence the initial map bounds. This one entry expands the Taipei overview substantially. It may be an intentional day trip; the audit does not establish that the stored coordinates are wrong.

**Fix:** Review the city assignment. If nearby trips belong in the Taipei guide, label them clearly and retain a useful city-center view. Add a warning for distant entries during admin review.

Evidence: [stored listing](</Users/tomurho/projects/travel map/src/data/places.json:13588>), [bounds calculation](</Users/tomurho/projects/travel map/src/components/map-view.tsx:311>).

### U4 — Nearby can show a map unrelated to the count

**Source evidence:** If the user is more than 80 km from a saved city, the code retains the selected city but centers on the user's location. The count still describes the selected city's places. The success message is suppressed in the guide.

**Fix:** Show “No saved city is near you.” Keep the current city's pins visible, or offer the nearest saved city as a deliberate choice. Do not leave the user with a positive count and an unrelated map.

**Completion check:** Test a simulated position outside every saved city. The message, city, count, and visible pins must agree. This scenario was inspected in source; no physical location request was made.

Evidence: [city threshold](</Users/tomurho/projects/travel map/src/components/map-view.tsx:376>), [fallback location behavior](</Users/tomurho/projects/travel map/src/components/map-view.tsx:410>), [message handling](</Users/tomurho/projects/travel map/src/components/field-guide/field-guide-app.tsx:335>).

### U5 — Smaller interface improvements

| Priority | Finding | Recommendation |
|---|---|---|
| P3 | On local mobile List, Edit list changes to Editing/Done, but no row editor appears. Reproduced at 320 × 568 pixels. | Hide the edit toolbar below 900 pixels if editing remains desktop-only. [Toolbar](</Users/tomurho/projects/travel map/src/components/field-guide/field-guide-app.tsx:348>), [hidden editor CSS](</Users/tomurho/projects/travel map/src/components/field-guide/field-guide.module.css:913>). |
| P3 | Ninety-nine places have no district. This includes every Tainan, Matsue, Kaohsiung, and Nagasaki entry: 54, 17, 10, and 7 respectively. | Hide or explain Area when it has no useful options. Add district data where it helps browsing, starting with Tainan. [Area choices](</Users/tomurho/projects/travel map/src/lib/field-guide-explorer.ts:52>). |

[Mobile editor evidence](</Users/tomurho/projects/travel map/docs/audits/2026-10-23/mobile-edit-list.png>).

## Admin: findings and fixes

### A1 — Preview and Apply use different validation rules

**Reproduced with fixtures:** A Published row with `googleMapsUrl=not-a-url` passed Sync Preview. The response said `canApply: true` with no validation errors. Apply then failed the file validator and returned an uncertain-write error.

The instruction to preview again cannot fix the invalid field. The write protection works, but the preview and recovery advice are misleading.

A second fixture used lowercase `verified` in Review. The dashboard reported one row ready to publish. Publish Preview found zero, because the publisher requires exact `Verified` while the dashboard ignores case.

**Fix:** Use the full record validator when constructing Publish and Sync previews. Normalize Sheet statuses once and share that rule across counts and actions. Report the row and invalid field before enabling Apply. Preserve known validation errors instead of describing them as uncertain writes.

**Completion check:** Invalid URLs are blocked in Preview with a row-level explanation. Every status accepted by the dashboard is treated the same way by the publisher.

Evidence: [URL presence check](</Users/tomurho/projects/travel map/src/lib/place-sheet-pipeline.ts:2652>), [record validator](</Users/tomurho/projects/travel map/src/lib/place-validation.ts:54>), [error conversion](</Users/tomurho/projects/travel map/src/lib/place-sheet-pipeline.ts:3176>), [publisher status check](</Users/tomurho/projects/travel map/src/lib/place-sheet-pipeline.ts:2465>), [dashboard status check](</Users/tomurho/projects/travel map/src/lib/place-sheet-pipeline.ts:2969>).

### A2 — An unrelated bad row can hide valid reviews

**Reproduced with fixtures:** A sheet contained one valid Candidate and one Verified row without latitude. The candidate queue could be built, but the combined snapshot failed because the dashboard tried to construct a publish plan.

There is a related display problem. After a later refresh fails, the client retains the last good status. The overview hides its error whenever that old status exists. The candidate section shows an error, but the overview can continue presenting old advice without a warning beside it.

**Fix:** Return candidate rows and validation issues separately. Block only the affected action. After a failed refresh, label retained data: “Refresh failed. Showing data checked at [time].” Place Retry beside that message.

**Completion check:** One invalid Verified row does not hide valid candidates. A failed refresh visibly marks the overview as old data.

Evidence: [throwing publish plan](</Users/tomurho/projects/travel map/src/lib/place-sheet-pipeline.ts:2971>), [combined snapshot](</Users/tomurho/projects/travel map/src/lib/place-sheet-pipeline.ts:3067>), [retained status](</Users/tomurho/projects/travel map/src/components/admin-workflow.tsx:1276>), [conditional error display](</Users/tomurho/projects/travel map/src/components/admin-workflow.tsx:2455>).

### A3 — Screenshot processing can discard or mix work

**Reproduced with mocked providers:** One image succeeded and another failed. The route returned HTTP 502 without the successful rows because the batch uses `Promise.all`.

**Source evidence:** Starting extraction clears the current results, including manual corrections. Selecting replacement files remains possible during extraction. A delayed response from the previous batch can then populate results under the new selection.

**Fix:** Return one success or error result per image. Preserve reviewed drafts and retry only failed images. Associate each request with its selection, or disable replacement during extraction. Discard responses from superseded requests.

**Completion check:** One failed image does not erase successful results. A retry retains edited names and locations. Replacing a selection cannot display results from its predecessor.

Evidence: [batch execution](</Users/tomurho/projects/travel map/app/api/admin/screenshot-intake/extract/route.ts:324>), [draft clearing](</Users/tomurho/projects/travel map/src/components/admin-workflow.tsx:1643>), [selection replacement](</Users/tomurho/projects/travel map/src/components/admin-workflow.tsx:1604>), [response assignment](</Users/tomurho/projects/travel map/src/components/admin-workflow.tsx:1689>), [upload controls](</Users/tomurho/projects/travel map/src/components/admin-workflow.tsx:2210>).

### A4 — The next task cannot be completed in admin

**Observed:** The live read showed six New captures and zero ready rows, candidates, publish changes, or app changes. The overview said to choose New captures and mark them Ready. It supplied no capture list or Mark ready action. The workflow guide directs this step to Google Sheets.

At 1280 × 720 pixels, the initial viewport was mostly the password form and an expanded, empty Screenshot Intake panel. The useful overview began at the bottom of the screen. Returning to existing work requires scrolling past a different task.

**Fix:** Put the overview and current work first. Add a compact New captures queue with selection, source evidence, **Mark ready**, and direct Sheet row links. Keep screenshot intake available as **Add screenshots**. If adding the queue is deferred, provide a clear **Review new captures in Sheets** action beside the instruction.

Keep lookup, human verification, and publication distinct. Reducing navigation must not silently approve a candidate.

**Completion check:** Starting with new captures, the owner can see each item and advance the intended items without searching through Sheet columns.

Evidence: [next action](</Users/tomurho/projects/travel map/src/components/admin-workflow.tsx:2464>), [candidate-only queue](</Users/tomurho/projects/travel map/src/components/admin-workflow.tsx:2500>), [manual Sheet instruction](</Users/tomurho/projects/travel map/src/components/admin-workflow.tsx:2605>).

![Admin directs the owner to mark captures Ready but has no capture action.](</Users/tomurho/projects/travel map/docs/audits/2026-10-23/admin-next-step.png>)

[Initial admin viewport](</Users/tomurho/projects/travel map/docs/audits/2026-10-23/admin-entry.png>).

### A5 — Google connection recovery belongs in the browser flow

**Source evidence:** When the token file cannot be read, the shared Google Sheets helper opens a terminal prompt for an authorization code. An HTTP request can enter this path. The browser has no matching setup action, and the request can wait for terminal input.

**Fix:** Keep interactive authorization in an explicit local setup command. HTTP handlers should return a clear connection error with the exact repair steps. Add bounded timeouts for provider requests and retain drafts when they fail.

**Completion check:** A missing token produces a prompt browser error with actionable instructions. It must not leave the page waiting for hidden terminal input.

Evidence: [token fallback](</Users/tomurho/projects/travel map/src/lib/google-sheets-oauth.ts:104>), [terminal prompt](</Users/tomurho/projects/travel map/src/lib/google-sheets-oauth.ts:121>). This failure path was inspected in source; the real token was not removed.

### A6 — Make source screenshots readable

The extraction result uses a 116-pixel-wide, cropped 4:3 thumbnail. It has no enlargement action. A tall screenshot loses context, making it difficult to check the extracted text.

**Fix:** Add **View original screenshot** with keyboard support. Fit the complete image inside the thumbnail. Keep the editable text beside it.

Evidence: [image element](</Users/tomurho/projects/travel map/src/components/admin-workflow.tsx:2294>), [crop styles](</Users/tomurho/projects/travel map/app/globals.css:2513>). This is source-derived; no personal screenshots were uploaded for the audit.

## Code and performance improvements

**Remove abandoned paths before introducing new abstractions.** `admin-workflow.tsx` has 2,919 lines. It retains production editing, staging, resolution, and export handlers although its final UI renders only Screenshot Intake and the Sheets pipeline. Remove unreachable component code, then split the two active workflows into focused components.

Check callers before retiring old API routes. Some retained staging paths use direct file writes or lack the current editor's original-record check. If these routes remain supported, apply the existing atomic storage and version conventions. Do not describe their hidden controls as current UI defects.

Evidence: [retained handlers](</Users/tomurho/projects/travel map/src/components/admin-workflow.tsx:1785>), [rendered workflows](</Users/tomurho/projects/travel map/src/components/admin-workflow.tsx:2913>), [staging writes](</Users/tomurho/projects/travel map/src/lib/admin-staging.ts:379>), [retained verification path](</Users/tomurho/projects/travel map/src/lib/admin-staging.ts:826>).

Other proportionate improvements:

- Add a small browser regression suite for selected-pin reveal, Map/List, filter dismissal, Back, and map failure. The current test command runs library tests; it did not detect U1.
- Share one public-record allowlist across the main guide, `/original`, and `/concept`. This reduces the chance that their data exposure rules drift.
- Remove unused Leaflet, React Leaflet, and MapLibre dependencies if the comparison interfaces no longer need them. No source imports were found. The expected benefit is less maintenance and installation work; this audit did not measure a browser bundle reduction.
- Keep list batching and marker clustering. The catalog has 712 places across 11 cities. No measured user-facing delay justified a database migration or a new map framework.
- Measure transfer size, map startup, and filter response on a phone before adding city-specific data loading. A local calculation benchmark does not establish phone performance.

## Next steps in plain language

These are recommended implementation passes. They have not been performed.

1. **Establish laptop-only access.** Make the default admin command bind to `127.0.0.1`. Check that hosted admin remains disabled.
2. **Fix misleading actions.** Repair Show on map, Preview validation, shared status rules, and failed-refresh messages.
3. **Protect unfinished work.** Preserve screenshot successes and drafts. Keep unrelated candidate reviews available after a row error.
4. **Finish the admin workflow.** Add the New captures queue. Put the current task first and make source screenshots readable.
5. **Review the catalog.** Resolve duplicate candidates deliberately. Confirm the Taipei outlier and fill useful district gaps.
6. **Reduce maintenance work.** Remove unused paths and dependencies. Add browser checks for the failures found here.

**ELI5 — next steps:** First, keep the workbench on your laptop. Then make each button do what it promises. Keep good work when one item fails. Finally, remove duplicate cards and tools you no longer use.

## Verification and limits

The audit started from a clean tracked tree at commit `6a61e64`. Three independent agents reviewed public code, admin backend code, and admin UI code. I consolidated their findings and inspected the rendered application.

| Check | Result |
|---|---|
| `pnpm test` | 185 passed; zero failures or skips. |
| `pnpm typecheck` | Passed. |
| `pnpm build` | Passed. |
| Public browser inspection | Desktop 1280 × 720; mobile 390 × 844 and 320 × 568. |
| Public interactions | Category selection, Map/List preservation, place details, Show on map, search, zero results, Reset, Escape, and local Edit list. |
| Admin browser inspection | Laptop layout, automatic local load, actual Sheet status read, empty candidate queue, and next-step guidance. |
| Backend fixture probes | Invalid URL preview, inconsistent status casing, unrelated invalid-row failure, and partial screenshot failure reproduced without real data writes. |
| Source/data integrity | Application files and catalog match the starting tracked version. The build-generated change to `next-env.d.ts` was restored. |

The live admin queue had no candidates. Populated candidate review, conflict correction, screenshot extraction, Verify, Publish, and Apply were not exercised against real data. Provider failure probes used synthetic inputs and mocked responses.

No venue edits, Sheet writes, publication, or deployment were performed. The temporary server was stopped and audit tabs were closed.

No physical phone, spoken screen reader, complete keyboard traversal, 200% text enlargement, or 400% browser zoom audit was performed. Narrow viewport checks do not establish full accessibility compliance. Nearby was not tested with the owner's real location. LAN access and the hosted environment were not inspected.

Yesterday's completed fixes remain present. They include authenticated catalog loading, checks for changed candidates and editor records, protected previews, atomic file replacement, backups, list details, and map-failure recovery. See the [previous implementation record](</Users/tomurho/projects/travel map/docs/audits/2026-10-22-audit-fixes.md>) for that history.

Screenshots: [desktop map](</Users/tomurho/projects/travel map/docs/audits/2026-10-23/desktop-map.png>), [selected-place overview](</Users/tomurho/projects/travel map/docs/audits/2026-10-23/mobile-show-on-map.png>), [mobile editor](</Users/tomurho/projects/travel map/docs/audits/2026-10-23/mobile-edit-list.png>), [admin entry](</Users/tomurho/projects/travel map/docs/audits/2026-10-23/admin-entry.png>), [admin next step](</Users/tomurho/projects/travel map/docs/audits/2026-10-23/admin-next-step.png>).
