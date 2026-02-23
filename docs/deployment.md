# RealityCheck — Deployment & Publishing

## Chrome Web Store

1. Build the extension:
   ```bash
   cd extensions/chrome
   npm run build
   ```
2. Zip the `dist/` folder:
   ```bash
   cd dist
   zip -r ../realitycheck-chrome.zip .
   ```
3. Go to the [Chrome Web Store Developer Dashboard](https://chrome.google.com/webstore/devconsole/).
4. Click **New item** → upload `realitycheck-chrome.zip`.
5. Fill in:
   - **Store listing**: name, description, screenshots.
   - **Privacy practices**: declare storage usage, explain that remote calls are opt-in.
   - **Permissions justification**: `storage` (settings), `activeTab` (content analysis), `scripting` (content script injection), `host_permissions <all_urls>` (needed to run content scripts on any page).
6. Submit for review. Review typically takes a few days to a week.

### Version bumping

Update `version` in both `manifest.json` and `package.json` before uploading a new ZIP.

---

## Microsoft Edge Add-ons

1. Build `extensions/edge/` the same way as Chrome.
2. Go to the [Edge Add-ons Developer Dashboard](https://partner.microsoft.com/dashboard/microsoftedge/).
3. Follow the same process as Chrome (both use MV3).

---

## Firefox Add-ons (AMO)

Firefox requires extensions to be **signed** before they can be installed permanently.

### Signing with web-ext

```bash
npm install -g web-ext
cd extensions/firefox

# Sign via AMO API (requires API keys from https://addons.mozilla.org/developers/)
web-ext sign \
  --api-key=<your-jwt-issuer> \
  --api-secret=<your-jwt-secret> \
  --channel=listed
```

This uploads the extension, gets it reviewed by Mozilla, and downloads a signed `.xpi`.

### Self-distribution (unlisted)

For enterprise or beta distribution, use `--channel=unlisted`. This generates a signed `.xpi` that users can install manually via `about:addons` → gear icon → **Install Add-on From File**.

### Submitting to AMO (listed)

1. Create an account at [addons.mozilla.org](https://addons.mozilla.org/developers/).
2. Submit the zip of `extensions/firefox/` via the submission wizard.
3. Mozilla reviews submissions and requires source code for any build tooling.

---

## Versioning strategy

Use semantic versioning (`MAJOR.MINOR.PATCH`):
- **MAJOR**: Breaking changes to settings schema or content API.
- **MINOR**: New features (new detector, new watermark mode).
- **PATCH**: Bug fixes, heuristic tuning.

The version in `manifest.json` must match the store listing version.
