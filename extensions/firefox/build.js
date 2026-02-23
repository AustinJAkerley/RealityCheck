/**
 * Build script — bundles TypeScript source with esbuild and copies
 * static assets (manifest, popup HTML/CSS, icons) into dist/.
 *
 * Firefox MV2 uses iife format for the background script (no ES modules
 * in background pages) and esm for the content script and popup.
 */
const esbuild = require('esbuild');
const fs = require('fs');
const path = require('path');

const ROOT = __dirname;
const DIST = path.join(ROOT, 'dist');

fs.mkdirSync(path.join(DIST, 'popup'), { recursive: true });
fs.mkdirSync(path.join(DIST, 'icons'), { recursive: true });

async function build() {
  await Promise.all([
    // Background page: Firefox MV2 doesn't support ES module background scripts
    esbuild.build({
      bundle: true,
      platform: 'browser',
      target: ['firefox109'],
      format: 'iife',
      sourcemap: true,
      logLevel: 'info',
      entryPoints: [path.join(ROOT, 'src', 'background.ts')],
      outfile: path.join(DIST, 'background.js'),
    }),
    esbuild.build({
      bundle: true,
      platform: 'browser',
      target: ['firefox109'],
      format: 'iife',
      sourcemap: true,
      logLevel: 'info',
      entryPoints: [path.join(ROOT, 'src', 'content.ts')],
      outfile: path.join(DIST, 'content.js'),
    }),
    esbuild.build({
      bundle: true,
      platform: 'browser',
      target: ['firefox109'],
      format: 'iife',
      sourcemap: true,
      logLevel: 'info',
      entryPoints: [path.join(ROOT, 'src', 'popup', 'popup.ts')],
      outfile: path.join(DIST, 'popup', 'popup.js'),
    }),
  ]);

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

  console.log('Firefox extension built → dist/');
}

build().catch((err) => {
  console.error(err);
  process.exit(1);
});
