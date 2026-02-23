# RealityCheck — Security & Privacy Notes

## Permission rationale

| Permission | Why it is needed |
|---|---|
| `storage` | Persist user settings (global toggle, watermark config, detection quality, optional custom API key) across browser sessions using `chrome.storage.sync` / `browser.storage.sync`. |
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

### Remote classification (on by default)

Remote classification is **enabled by default**. The extension calls our hosted Azure classifier (`https://api.realitycheck.ai/v1/classify`). No API key is required from the user — authentication to downstream AI services is handled server-side by the proxy.

Before any content is sent off-device, the local photorealism pre-filter runs first. Only images that score above the photorealism threshold proceed; non-photorealistic images (icons, cartoons, text graphics) are skipped entirely and never sent. For text, the remote call is made only when the local heuristic score is inconclusive.

When a remote call is made, only the minimal payload needed for classification is sent:
- **Text**: A snippet of up to 2,000 characters.
- **Images**: A downscaled JPEG thumbnail (max 128 × 128 pixels) plus a content hash.
- **Video frames**: A single downscaled JPEG frame (max 128 × 128 pixels) plus a content hash.

The full page DOM, browsing history, cookies, credentials, and any other data are **never** sent.

A notice is displayed in the popup whenever remote mode is active.

### Remote classification OFF (user opt-out)

When the user disables remote classification in the popup, **no data ever leaves the browser.** All heuristics run entirely in the content script process. The popup recommends using Medium or High detection quality in this mode for best local accuracy.

### API key storage

API keys are only needed for custom/development endpoints configured in the Advanced section. For the default hosted endpoint, no API key is required.

If a custom API key is configured, it is stored exclusively in `chrome.storage.sync` (or `browser.storage.sync` for Firefox). This storage:
- Is encrypted at rest by the browser.
- Is accessible only to the extension itself (same extension ID).
- Syncs across the user's logged-in devices (subject to the user's browser sync settings).

API keys are **never**:
- Logged to the browser console.
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
