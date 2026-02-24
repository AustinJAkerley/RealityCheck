# RealityCheck — Developer Setup Guide

**Goal**: Get from a fresh machine to a working, locally loaded extension in ~10 minutes.

---

## 1. Prerequisites — Node.js and npm

You need **Node.js 18 or newer**. Check your version:

```
node --version   # must be 18.x or higher
npm --version    # must be 9.x or higher
```

### Installing Node.js

**Windows**
1. Download the LTS installer from [nodejs.org](https://nodejs.org/).
2. Run the `.msi` installer — keep all default options (npm is bundled).
3. Open a **new** Command Prompt or PowerShell window and run `node --version`.

**Linux (Ubuntu/Debian)**
```bash
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt-get install -y nodejs
node --version
```

**Linux (Fedora/RHEL)**
```bash
sudo dnf install nodejs
node --version
```

**macOS** (via [Homebrew](https://brew.sh/))
```bash
brew install node
node --version
```

---

## 2. Clone the repository

```bash
git clone https://github.com/AustinJAkerley/RealityCheck.git
cd RealityCheck
```

> **Windows users**: Use Git Bash, PowerShell, or Command Prompt. If you don't have Git, get it from [git-scm.com](https://git-scm.com/).

---

## 3. Install dependencies

Run this **once** from the repository root — it installs everything for every workspace in one step:

```bash
npm install
```

---

## 4. Build

### Build everything at once

**Linux/macOS**
```bash
make build
```

**Windows (PowerShell — recommended)**
```powershell
.\scripts\build.ps1
```

**Windows (Command Prompt)**
```bat
scripts\build.bat all
```

**Any platform (npm)**
```bash
npm run build
```

This builds:
1. `packages/core/` → `packages/core/dist/` (shared TypeScript library)
2. `extensions/chrome/` → `extensions/chrome/dist/`
3. `extensions/edge/` → `extensions/edge/dist/`
4. `extensions/firefox/` → `extensions/firefox/dist/`
5. `extensions/safari/` → `extensions/safari/dist/`

A successful build looks like:
```
  dist/background.js   4.2kb ⚡ Done in 20ms
  dist/content.js     31.6kb ⚡ Done in 20ms
  dist/popup/popup.js  5.7kb ⚡ Done in 20ms
Chrome extension built → dist/
...
Firefox extension built → dist/
```

### Build a single extension (faster during development)

```bash
# Linux/macOS
make build-chrome    # or build-edge / build-firefox / build-safari

# Windows (PowerShell)
.\scripts\build.ps1 chrome    # or edge / firefox / safari

# Windows (Command Prompt)
scripts\build.bat chrome    # or edge / firefox / safari
```

### Rebuild after source changes

Re-run the same build command. The full build takes about 1–2 seconds.

---

## 5. Load the extension in your browser

> **Important**: always load from the `dist/` folder, not `src/`.

### Chrome

1. Open Chrome → navigate to `chrome://extensions/`
2. Enable the **Developer mode** toggle (top-right corner).
3. Click **Load unpacked**.
4. Select: `<repo root>/extensions/chrome/dist/`

The RealityCheck icon appears in the toolbar. If it's hidden, click the puzzle-piece icon → pin RealityCheck.

> **After rebuilding**: click the **↺ Reload** button on the RealityCheck card in `chrome://extensions/`.

### Microsoft Edge

1. Open Edge → navigate to `edge://extensions/`
2. Enable **Developer mode** (left sidebar toggle).
3. Click **Load unpacked**.
4. Select: `<repo root>/extensions/edge/dist/`

Steps are identical to Chrome — both use Manifest V3.

### Firefox

1. Open Firefox → navigate to `about:debugging#/runtime/this-firefox`
2. Click **Load Temporary Add-on…**
3. Navigate to `<repo root>/extensions/firefox/dist/` and select `manifest.json`.

> **Note**: Firefox removes temporary add-ons when it restarts. For a persistent dev session use [web-ext](https://github.com/mozilla/web-ext):
> ```bash
> npm install -g web-ext
> cd extensions/firefox/dist
> web-ext run
> ```

### Safari

Safari requires Manifest V3 support, available in **Safari 16.4 or later** on macOS Ventura 13.3+.

**Load for development (macOS only):**

1. Enable the Develop menu: Safari → Settings → Advanced → check **Show features for web developers**.
2. Build the extension: `make build-safari` (or `node extensions/safari/build.js` after building core).
3. Open Safari → Develop → Show Extension Builder.
4. Click **(+)** in the bottom-left → **Add Extension…** and select `<repo root>/extensions/safari/dist/`.
5. Click **Run** to load the extension. The RealityCheck icon appears in the Safari toolbar.

> **After rebuilding**: click **Reload** in the Extension Builder, or remove and re-add the extension.

**For App Store / permanent installation:**

Safari Web Extensions must be wrapped in a native macOS/iOS app using Xcode:
1. In Xcode, choose **File → New → Target → Safari Web Extension**.
2. Point it at the `extensions/safari/dist/` folder for the extension resources.
3. Build and run the Xcode project — Safari will prompt to enable the extension in its settings.

---

## 6. Configure the extension (first launch)

Click the RealityCheck icon in the toolbar.

For local-only testing (no remote API needed):

| Setting | Recommended value |
|---|---|
| **Global toggle** | On |
| **Detection Quality** | Medium (default) or High |
| **Remote classification** | **Off** (see [Testing Guide](testing.md)) |
| **Watermark mode** | Static |
| **Opacity** | 70–100% |

When **Remote classification** is off, the popup shows a note recommending Medium or High quality.

---

## 7. Run unit tests

```bash
# Linux/macOS
make test

# Windows (PowerShell — recommended)
.\scripts\build.ps1 test

# Windows (Command Prompt)
scripts\build.bat test

# Any platform
cd packages/core && npm test
```

All 50 tests should pass:
```
Tests:  50 passed, 50 total
```

---

## 8. Available make/script targets

| `make` target | PowerShell (`build.ps1`) | CMD (`build.bat`) | What it does |
|---|---|---|---|
| `make install` | — | — | `npm install` |
| `make build` | `.\scripts\build.ps1` | `scripts\build.bat all` | Build core + all four extensions |
| `make build-core` | `.\scripts\build.ps1 core` | `scripts\build.bat core` | Build core library only |
| `make build-chrome` | `.\scripts\build.ps1 chrome` | `scripts\build.bat chrome` | Build Chrome extension only |
| `make build-edge` | `.\scripts\build.ps1 edge` | `scripts\build.bat edge` | Build Edge extension only |
| `make build-firefox` | `.\scripts\build.ps1 firefox` | `scripts\build.bat firefox` | Build Firefox extension only |
| `make build-safari` | `.\scripts\build.ps1 safari` | `scripts\build.bat safari` | Build Safari extension only |
| `make test` | `.\scripts\build.ps1 test` | `scripts\build.bat test` | Run all unit tests |
| `make clean` | `.\scripts\build.ps1 clean` | `scripts\build.bat clean` | Remove all `dist/` folders |

---

## Troubleshooting

| Problem | Fix |
|---|---|
| `node: command not found` | Node.js not on PATH — re-open terminal after install |
| `npm install` ENOENT errors | Make sure you're in the repo root, not a subdirectory |
| `npm install` permission error (Linux) | Don't use `sudo npm install` — fix npm global permissions or use nvm |
| `build.ps1 cannot be loaded, running scripts is disabled` | Run `Set-ExecutionPolicy -Scope CurrentUser RemoteSigned` once in PowerShell |
| Extension shows "Could not load background script" | You loaded `src/` instead of `dist/` — re-do Load Unpacked pointing at `dist/` |
| Extension loads but nothing happens | Check Global toggle is On; open DevTools → Console and filter by `[RealityCheck]` |
| Changes not reflected | Rebuild (`make build-chrome`) then click ↺ Reload in `chrome://extensions/` |
