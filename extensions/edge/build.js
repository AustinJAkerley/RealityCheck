/**
 * Build script — bundles TypeScript source with esbuild and copies
 * static assets (manifest, popup HTML/CSS, icons) into dist/.
 */
const esbuild = require('esbuild');
const fs = require('fs');
const path = require('path');

const ROOT = __dirname;
const DIST = path.join(ROOT, 'dist');

fs.mkdirSync(path.join(DIST, 'popup'), { recursive: true });
fs.mkdirSync(path.join(DIST, 'icons'), { recursive: true });

async function build() {
  const shared = {
    bundle: true,
    platform: 'browser',
    target: ['chrome88'],
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

  console.log('Edge extension built → dist/');
}

build().catch((err) => {
  console.error(err);
  process.exit(1);
});
