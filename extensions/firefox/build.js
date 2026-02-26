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
const REPO_ROOT = path.resolve(ROOT, '..', '..');
const MODEL_CACHE = path.join(REPO_ROOT, 'extensions', 'model-cache');

fs.mkdirSync(path.join(DIST, 'popup'), { recursive: true });
fs.mkdirSync(path.join(DIST, 'icons'), { recursive: true });

/** Recursively copy a directory tree. */
function copyDirSync(src, dest) {
  fs.mkdirSync(dest, { recursive: true });
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);
    if (entry.isDirectory()) {
      copyDirSync(srcPath, destPath);
    } else {
      fs.copyFileSync(srcPath, destPath);
    }
  }
}

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

  // Bundle ONNX Runtime WASM files required by Transformers.js.
  const ortWasmSrc = path.join(REPO_ROOT, 'node_modules', 'onnxruntime-web', 'dist');
  const ortDist = path.join(DIST, 'ort');
  if (fs.existsSync(ortWasmSrc)) {
    fs.mkdirSync(ortDist, { recursive: true });
    const wasmFiles = fs.readdirSync(ortWasmSrc).filter(f => f.endsWith('.wasm'));
    for (const f of wasmFiles) {
      fs.copyFileSync(path.join(ortWasmSrc, f), path.join(ortDist, f));
    }
    console.log(`Bundled ${wasmFiles.length} ONNX Runtime WASM files into dist/ort/`);
  }

  // Bundle local model files if they have been pre-downloaded.
  // Run `node scripts/download-model.mjs` once before building to populate the cache.
  if (fs.existsSync(MODEL_CACHE)) {
    const modelDist = path.join(DIST, 'models');
    copyDirSync(MODEL_CACHE, modelDist);
    console.log('Bundled local model files into dist/models/ (offline inference enabled)');
  } else {
    console.log('ℹ️  No model cache found at extensions/model-cache/');
    console.log('   The extension will download the model (~90 MB) from HuggingFace at runtime.');
    console.log('   To bundle the model at build time:  node scripts/download-model.mjs');
  }
}

build().catch((err) => {
  console.error(err);
  process.exit(1);
});
