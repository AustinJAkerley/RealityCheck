#!/usr/bin/env node
/**
 * Downloads the Xenova/ai-image-detector model files from HuggingFace Hub
 * for local bundling with the browser extension.
 *
 * Run this ONCE before building (after `npm install`):
 *
 *   node scripts/download-model.mjs
 *
 * If the model requires authentication (gated), pass your HuggingFace token:
 *
 *   HF_TOKEN=hf_xxx node scripts/download-model.mjs
 *   node scripts/download-model.mjs --token hf_xxx
 *
 * Files are saved to: extensions/model-cache/Xenova/ai-image-detector/
 * The extension build script (build.js) copies them into dist/models/ automatically.
 *
 * After downloading, rebuild the extension:
 *   make build-chrome              # Linux/macOS
 *   .\scripts\build.ps1 chrome    # Windows PowerShell
 */

import { mkdir, writeFile } from 'fs/promises';
import { existsSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..');

const MODEL_ID = 'Xenova/ai-image-detector';
const MODEL_CACHE_DIR = path.join(REPO_ROOT, 'extensions', 'model-cache', 'Xenova', 'ai-image-detector');
const HF_BASE = 'https://huggingface.co';

// --- Token resolution ---
const args = process.argv.slice(2);
const tokenIdx = args.indexOf('--token');
const HF_TOKEN = (tokenIdx >= 0 ? args[tokenIdx + 1] : undefined) || process.env.HF_TOKEN;

function makeHeaders() {
  const headers = {};
  if (HF_TOKEN) headers['Authorization'] = `Bearer ${HF_TOKEN}`;
  return headers;
}

async function listFiles() {
  const url = `${HF_BASE}/api/models/${MODEL_ID}`;
  const res = await fetch(url, { headers: makeHeaders() });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`HF API returned ${res.status} for ${url}:\n${body}`);
  }
  const data = await res.json();
  const siblings = data.siblings || [];
  return siblings.map((s) => s.rfilename);
}

async function downloadFile(filename) {
  // Construct URL by treating each path segment individually so that file names
  // with special characters are encoded but path separators are preserved as-is.
  const urlPath = filename.split('/').map(encodeURIComponent).join('/');
  const url = `${HF_BASE}/${MODEL_ID}/resolve/main/${urlPath}`;
  const destPath = path.join(MODEL_CACHE_DIR, ...filename.split('/'));

  await mkdir(path.dirname(destPath), { recursive: true });

  const res = await fetch(url, { headers: makeHeaders() });
  if (!res.ok) {
    throw new Error(`HTTP ${res.status} downloading ${url}`);
  }

  const buffer = await res.arrayBuffer();
  await writeFile(destPath, Buffer.from(buffer));
  const sizeMb = (buffer.byteLength / 1024 / 1024).toFixed(1);
  console.log(`  ✓ ${filename.padEnd(50)} ${sizeMb} MB`);
}

async function main() {
  console.log(`\nDownloading ${MODEL_ID} model files…\n`);

  if (!HF_TOKEN) {
    console.warn('⚠️  HF_TOKEN is not set.');
    console.warn('   If the model is gated, you will get a 401 error.');
    console.warn('   To fix: HF_TOKEN=hf_xxx node scripts/download-model.mjs\n');
  }

  let files;
  try {
    files = await listFiles();
  } catch (err) {
    console.error('Failed to list model files:', err.message);
    if (!HF_TOKEN) {
      console.error('\n→ Try again with a HuggingFace token:');
      console.error('  1. Go to https://huggingface.co/Xenova/ai-image-detector and accept model terms');
      console.error('  2. Go to https://huggingface.co/settings/tokens and create a read token');
      console.error('  3. Run: HF_TOKEN=hf_xxx node scripts/download-model.mjs');
    }
    process.exit(1);
  }

  console.log(`Found ${files.length} files in ${MODEL_ID}\n`);

  await mkdir(MODEL_CACHE_DIR, { recursive: true });

  for (const filename of files) {
    try {
      await downloadFile(filename);
    } catch (err) {
      console.error(`  ✗ Failed to download ${filename}: ${err.message}`);
      process.exit(1);
    }
  }

  console.log(`\n✅  Model saved to extensions/model-cache/Xenova/ai-image-detector/`);
  console.log('\nNext step — rebuild the extension to bundle the model:');
  console.log('  make build-chrome              (Linux/macOS)');
  console.log('  .\\scripts\\build.ps1 chrome   (Windows PowerShell)\n');
}

main();
