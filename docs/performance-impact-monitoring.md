# Measuring RealityCheck Web Performance Impact

This guide helps you determine whether RealityCheck is slowing down websites and how to quantify that impact.

## 1) Quick A/B check (fastest)

1. Open a page with many images/videos (search results, social feed).
2. Open DevTools Console.
3. With extension **enabled**, reload once and capture the logs:
   - `"[RealityCheck] Image detection"` / `"[RealityCheck] Video detection"`
   - Each log includes `durationMs`.
4. Disable the extension for the site and reload again.
5. Compare:
   - page responsiveness while scrolling,
   - first meaningful paint/load timing in DevTools Performance.

If UX is clearly smoother with the extension disabled, collect timings from steps below.

## 2) Measure detector latency from logs

RealityCheck logs include:

- `detectionId` (also shown on watermark as `ID: ...` for fast log matching)
- `stage` (`Initial`, `Local ML`, `Remote ML`)
- `score`
- `source`
- `localModelScore` (when local ML ran)
- `details`
- `durationMs`

In dev mode, both AI and Not-AI watermarks include this `detectionId`, so missed detections can be traced back to the exact console entry.

Use these to identify expensive paths:

- High `durationMs` + `Local ML` => local model is hot path.
- High `durationMs` + `Remote ML` => network/remote path is hot path.

## 3) DevTools Performance recording

1. Open Chrome DevTools → **Performance**.
2. Start recording.
3. Scroll through a media-heavy page for ~10–20 seconds.
4. Stop recording.
5. Inspect:
   - Main thread long tasks,
   - scripting time spikes during content loading,
   - FPS drops while scrolling.

Repeat with extension disabled for the same page pattern and compare.

## 4) Practical mitigation options

- Use `Detection Quality: medium` for lower CPU cost.
- Keep `Remote classification` off when testing local-only overhead.
- Limit testing to a single host via site toggle to isolate impact.

## 5) Reporting useful perf diagnostics

When filing a perf issue include:

- Browser + version,
- URL pattern / site type,
- quality setting + remote toggle,
- sample log entries with `durationMs`,
- before/after DevTools Performance screenshots.
