# RealityCheck — Security & Privacy Notes

## Permission rationale

| Permission | Why it is needed |
|---|---|
| `storage` | Persist user settings (global toggle, watermark config, API keys) across browser sessions using `chrome.storage.sync` / `browser.storage.sync`. |
| `activeTab` | Read the URL of the active tab to display the per-site hostname in the popup. |
| `scripting` (Chrome/Edge MV3) | Inject the content script into pages (Manifest V3 requirement). |
| `host_permissions: <all_urls>` | Allow the content script to run on any page the user visits. Required to analyse content on arbitrary sites. |

No permissions beyond the above are requested. The extension does not use:
- `cookies` — not requested.
- `webRequest` — not requested (no traffic interception).
- `history` — not requested.
- `geolocation` — not requested.

---

## Data handling

### Local-only mode (default)

In local-only mode (the default):
- **No data ever leaves the browser.**
- All heuristics run entirely in the content script process.
- Settings are stored in the browser's built-in extension sync storage.
- No telemetry, analytics, or crash reporting is collected.

### Remote detection mode (opt-in)

Remote detection must be explicitly enabled by the user. When enabled:

1. A clear warning is shown in the popup UI: _"When remote mode is active, selected content will be sent to the configured endpoint."_
2. Only the content currently being analysed is sent:
   - **Text**: A snippet of up to 2,000 characters.
   - **Images**: A downscaled JPEG thumbnail (max 128×128 pixels).
   - **Video frames**: A single downscaled JPEG frame (max 128×128 pixels).
3. The full page DOM, browsing history, cookies, credentials, and any other data are **never** sent.
4. The remote endpoint and API key are configured by the user and stored in `chrome.storage.sync`. They are never hardcoded.

### API key storage

API keys are stored exclusively in `chrome.storage.sync` (or `browser.storage.sync` for Firefox). This storage:
- Is encrypted at rest by the browser.
- Is accessible only to the extension itself (same extension ID).
- Syncs across the user's logged-in devices (subject to the user's browser sync settings).

API keys are **never**:
- Logged to the browser console in release mode.
- Included in error reports.
- Sent to any endpoint other than the one the user configured.

---

## Content Security Policy

The extension uses a strict CSP:
```
script-src 'self'; object-src 'self'
```

This prevents:
- Inline script execution.
- Loading external scripts.
- `eval()` and dynamic code execution.

---

## XSS prevention

The watermark overlay is injected as a DOM element with `textContent` (not `innerHTML`) for the label text, preventing XSS via detected content. The text watermark wrap uses `innerHTML` to preserve existing content structure, but the badge and tooltip text use `textContent`. The confidence label is derived from a controlled enum — not from page content.

---

## Cross-origin isolation

Frame capture via Canvas is subject to browser CORS restrictions. Cross-origin videos (`<video src="...">` from a different origin) will throw a `SecurityError` when `toDataURL()` is called on the canvas, which is caught and silently skipped. This prevents leaking pixel data from cross-origin resources.

---

## Performance impact

- The IntersectionObserver limits analysis to elements near the viewport (200px margin).
- MutationObserver changes are debounced at 500ms.
- Detection results are cached in memory for 5 minutes.
- Remote calls are rate-limited to 10/minute (text/image) and 5/minute (video).
- CSS animations are used instead of JS timers, minimising main-thread work.
- The watermark overlay uses `pointer-events: none` so it never blocks user interaction.
