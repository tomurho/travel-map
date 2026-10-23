# Travel map audit fixes: implementation prompt

Recommended model: **GPT-6.1 Sol**, with **Extra High** reasoning (`xhigh`).

Official OpenAI documentation recommends GPT-6.1 Sol for complex coding and agentic workflows. Extra High is my task-specific recommendation for this work across UI, data handling, and admin workflows. Source: [OpenAI model guidance](https://learn.chatgpt.com/docs/models#recommended-models), checked 23 October 2026.

Copy the prompt below into a Codex chat attached to this project.

```text
Implement all actionable findings in the travel map and admin audit. Complete the implementation and verification; do not stop after planning.

Project: /Users/tomurho/projects/travel map

Read these files first:
- /Users/tomurho/projects/travel map/docs/audits/2026-10-23-travel-map-admin-audit.md
- /Users/tomurho/projects/travel map/docs/audits/2026-10-22-audit-fixes.md
- Applicable AGENTS.md instructions and README.md.

Use the full audit as the scope, including smaller UX, data-quality, maintenance, and measurement items. Recheck each finding against the current code. Preserve existing user changes. Use the engineering and UI review skills. Delegate independent work where useful, with clear file ownership.

Implement in priority order:

1. Local access: Make laptop-only admin access the default. Bind local development to loopback and apply consistent admin enablement to pages and APIs. Preserve existing authentication and hosted-disabled behavior. Keep setup simple for one owner. Test the browser through http://localhost because the earlier audit found that Google Maps rejected the 127.0.0.1 browser origin.

2. Public map: Make Show on map reveal the selected pin with useful street context above the detail card. Preserve selection, filters, pan, and zoom during ordinary Map/List switches. Reframe results only when their actual content changes. Explain when no saved city is near the user and retain a useful map view.

3. Preview and Apply: Share complete record validation and Sheet-status normalization. Make dashboard counts and action eligibility agree. Show invalid rows and fields before enabling Apply. Distinguish known validation failures from uncertain writes.

4. Admin recovery: Keep valid candidates available when unrelated rows fail. Label retained snapshots with their last checked time after a failed refresh. Show the failure beside the affected action and provide Retry.

5. Screenshot intake: Return outcomes per image. Preserve successful results and manual corrections. Retry failed images only. Prevent delayed responses from older selections replacing current results. Show complete thumbnails and provide a keyboard-accessible original-image viewer.

6. Admin workflow: Put current work and the overview first. Add a New captures queue with source evidence, selection, direct Sheet links, and Mark ready. Protect the new mutation against changed rows and duplicate submissions. Keep lookup, human verification, and publication as distinct actions. Make screenshot upload easy to reach without dominating the returning-user view.

7. Connection recovery: Keep interactive Google authorization in an explicit setup command. HTTP requests must return clear repair instructions instead of waiting for hidden terminal input. Bound provider waits and preserve drafts when requests fail.

8. Catalog quality: Review repeated Google Place IDs, conflicting duplicate records, the distant Taipei listing, and useful district gaps. Warn about duplicate identities and geographic outliers during intake/review. Let users select distinct venues sharing coordinates. Use backups and preserve mappings from replaced IDs to retained IDs.

9. Smaller UX fixes: Hide the unusable mobile Edit list control if editing remains desktop-only. Hide or explain Area when no useful choices exist. Preserve the current direct category-selection behavior, accessible result messages, list details, and map-failure recovery.

10. Maintenance: Remove proven-unreachable admin code and separate the active workflows into focused components. Check callers before retiring routes. Apply current atomic-write and record-version safeguards to legacy writers that remain supported. Share the public-record allowlist across the main guide, /original, and /concept. Remove confirmed-unused mapping dependencies. Keep batching, clustering, and the existing architecture.

11. Performance: Measure transfer size, map startup, and filter response under representative mobile conditions. Optimize only demonstrated problems. Record the measurements and any limits; do not introduce a database or replace the map framework without evidence.

Data and execution boundaries:
- Make routine implementation choices autonomously. Preserve the October 22 safeguards and existing editorial intent.
- Apply evidence-supported, reversible local data corrections with backups. Do not invent districts or silently resolve conflicting Loved/Been/Want to go values.
- For ambiguous catalog decisions, prepare exact before/after proposals with evidence. Complete independent engineering work, then ask one concise, grouped question for the remaining choices. Keep those items visibly pending.
- Use fixtures or mocks for destructive actions, Sheet mutations, publication, provider failures, missing credentials, and geolocation. Do not change live Google Sheets or deploy as part of testing.

Verification and completion:
- Add focused regressions for the confirmed failures, including browser coverage for Show on map, Map/List, filter dismissal, Back, and map failure.
- Inspect the rendered public UI at desktop, 390 × 844, and 320 × 568. Inspect populated admin queues, conflicts, screenshot results, loading, empty, error, and stale states using safe fixtures.
- Check keyboard access, focus, readable errors, and image-viewer dismissal. Test text enlargement and reflow where supported. State any untested accessibility or physical-device limits.
- Run pnpm test, pnpm typecheck, pnpm build, and git diff --check. Obtain an independent final review and fix material in-scope findings.
- Save a Markdown implementation report under /Users/tomurho/projects/travel map/docs/audits/. Map every audit item to its change, evidence, tests, and remaining decision. Record measured items that need no code change.
- Finish only when the engineering scope is implemented and verified, or a specific external dependency or editorial decision remains. Do not claim all issues are fixed while items remain pending.

Use ASD-STE100-inspired short, clear sentences in updates and the final response. Explain both the outcome and next steps in ELI5 language. Distinguish local implementation, verified behavior, live data changes, and deployment.
```
