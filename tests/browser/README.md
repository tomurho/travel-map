# Browser regressions

Start the loopback development server, then run the browser checks:

```sh
pnpm dev
pnpm test:browser
```

The default address is `http://localhost:3000`. Set `BROWSER_TEST_URL` for another local port. Chrome must be installed. A map API key must be set when starting Next.js; `NEXT_PUBLIC_GOOGLE_MAPS_API_KEY=browser-fixture pnpm dev` also works for the mocked checks.

The public suite loads a small Google Maps fixture before the application starts. It blocks Google provider scripts and all admin APIs. It checks application behavior and map commands. It does not establish the quality of Google's actual tiles or controls. Inspect the real map at localhost separately.

The tests cover selected-pin reveal above the detail card, manual pan/zoom preservation across Map/List, category dismissal, Escape focus, browser Back, map-failure recovery, distant geolocation, mobile edit/Area controls, a keyboard chooser for shared coordinates, and Taipei's city overview.

Traces remain in the ignored `test-results` directory after a failure. No live Sheet mutation or publication is permitted in this suite.

The admin suite intercepts every admin API before navigation. Unknown admin endpoints
fail locally. It uses generated screenshots and fixture capture/review/conflict rows.
It covers retained snapshots, partial extraction, failed sends, versioned Mark ready,
confirmation gates, per-action errors, image-viewer focus, and narrow-screen reflow.

For a production build, use `pnpm build`, then
`ENABLE_ADMIN=true ADMIN_PASSWORD=browser-fixture pnpm start`. The normal mocked
suite does not use that password because it supplies local API responses.

Run the separate real-provider measurement with:
`MEASURE_PUBLIC_MAP=1 pnpm test:browser performance.spec.ts --output /tmp/travel-map-perf-results`.
It blocks admin requests, disables cache, and applies a 1.6 Mbps connection, 150 ms
latency, and four-times CPU slowdown at 390 × 844. Results are written to
`docs/audits/2026-10-23-implementation/performance.json`. This is laptop emulation,
not a physical-phone measurement. Startup ends when the map renderer and controls
are present; tile completion is not measured.
