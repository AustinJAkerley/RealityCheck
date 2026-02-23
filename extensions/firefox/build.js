/**
 * Simple build script — copies manifest, popup HTML/CSS, and icons
 * into the dist/ folder alongside the compiled JS.
 */
const fs = require('fs');
const path = require('path');

const ROOT = __dirname;
const DIST = path.join(ROOT, 'dist');

fs.mkdirSync(path.join(DIST, 'popup'), { recursive: true });
fs.mkdirSync(path.join(DIST, 'icons'), { recursive: true });

fs.copyFileSync(path.join(ROOT, 'manifest.json'), path.join(DIST, 'manifest.json'));
fs.copyFileSync(path.join(ROOT, 'src', 'popup', 'popup.html'), path.join(DIST, 'popup', 'popup.html'));
fs.copyFileSync(path.join(ROOT, 'src', 'popup', 'popup.css'), path.join(DIST, 'popup', 'popup.css'));

const iconSizes = [16, 48, 128];
for (const size of iconSizes) {
  const src = path.join(ROOT, 'icons', `icon${size}.png`);
  const dest = path.join(DIST, 'icons', `icon${size}.png`);
  if (fs.existsSync(src)) {
    fs.copyFileSync(src, dest);
  }
}

console.log('Build assets copied to dist/');
