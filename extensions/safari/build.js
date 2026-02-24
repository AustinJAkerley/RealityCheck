/**
 * Build script — bundles TypeScript source with esbuild and copies
 * static assets (manifest, popup HTML/CSS, icons) into dist/.
 *
 * esbuild resolves the @reality-check/core workspace package and
 * produces self-contained JS files that work in Safari Web Extensions
 * without a module loader.
 *
 * Safari MV3 service workers support ES modules (type: "module"), so we
 * use ESM format throughout — consistent with the Chrome/Edge extensions.
 *
 * To load the built extension in Safari for testing:
 *   1. Build the extension: node extensions/safari/build.js
 *   2. Open Safari → Develop → Show Extension Builder (enable Develop menu
 *      in Safari Preferences → Advanced → Show Develop menu in menu bar)
 *   3. Click (+) → Add Extension → select extensions/safari/dist/
 *   For App Store distribution, wrap the dist/ folder in an Xcode Safari
 *   Web Extension target (File → New → Target → Safari Web Extension).
 */
const esbuild = require('esbuild');
const fs = require('fs');
const path = require('path');

const ROOT = __dirname;
const DIST = path.join(ROOT, 'dist');

// Ensure dist directories exist
fs.mkdirSync(path.join(DIST, 'popup'), { recursive: true });
fs.mkdirSync(path.join(DIST, 'icons'), { recursive: true });

async function build() {
  const shared = {
    bundle: true,
    platform: 'browser',
    target: ['safari16'],
    format: 'esm',
    sourcemap: true,
    logLevel: 'info',
  };

  await Promise.all([
    esbuild.build({
      ...shared,
      entryPoints: [path.join(ROOT, 'src', 'background.ts')],
      outfile: path.join(DIST, 'background.js'),
    }),
    esbuild.build({
      ...shared,
      entryPoints: [path.join(ROOT, 'src', 'content.ts')],
      outfile: path.join(DIST, 'content.js'),
    }),
    esbuild.build({
      ...shared,
      entryPoints: [path.join(ROOT, 'src', 'popup', 'popup.ts')],
      outfile: path.join(DIST, 'popup', 'popup.js'),
    }),
  ]);

  // Copy static assets
  fs.copyFileSync(path.join(ROOT, 'manifest.json'), path.join(DIST, 'manifest.json'));
  fs.copyFileSync(
    path.join(ROOT, 'src', 'popup', 'popup.html'),
    path.join(DIST, 'popup', 'popup.html')
  );
  fs.copyFileSync(
    path.join(ROOT, 'src', 'popup', 'popup.css'),
    path.join(DIST, 'popup', 'popup.css')
  );

  const iconSizes = [16, 48, 128];
  for (const size of iconSizes) {
    const src = path.join(ROOT, 'icons', `icon${size}.png`);
    const dest = path.join(DIST, 'icons', `icon${size}.png`);
    if (fs.existsSync(src)) {
      fs.copyFileSync(src, dest);
    }
  }

  console.log('Safari extension built → dist/');
}

build().catch((err) => {
  console.error(err);
  process.exit(1);
});
