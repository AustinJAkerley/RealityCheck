/**
 * Tests for the C2PA detection utility.
 */
import { detectC2PAFromDataUrl } from '../src/utils/c2pa';

// ── Helpers ────────────────────────────────────────────────────────────────────

/** Convert a byte array to a base64 data URL */
function bytesToDataUrl(bytes: number[], mimeType = 'image/jpeg'): string {
  const binary = String.fromCharCode(...bytes);
  return `data:${mimeType};base64,${btoa(binary)}`;
}

/** Minimal valid JPEG with enough bytes to pass size check (SOI + APP0 + EOI) */
function minimalJpeg(): number[] {
  // SOI (FF D8), APP0 segment (FF E0, length 16), EOI (FF D9)
  const app0 = [
    0xff, 0xe0, 0x00, 0x10, // APP0 marker + length (16)
    0x4a, 0x46, 0x49, 0x46, 0x00, // "JFIF\0"
    0x01, 0x01, 0x00, 0x00, 0x01, 0x00, 0x01, 0x00, // version + density
  ];
  return [0xff, 0xd8, ...app0, 0xff, 0xd9];
}

/** Build a JPEG with an APP11 segment containing "c2pa" */
function jpegWithC2PAApp11(): number[] {
  const content = Array.from('c2pa-jumbf-marker').map((c) => c.charCodeAt(0));
  const segLen = content.length + 2; // +2 for length field itself
  const app11 = [0xff, 0xeb, (segLen >> 8) & 0xff, segLen & 0xff, ...content];
  return [0xff, 0xd8, ...app11, 0xff, 0xd9];
}

/** Build a JPEG that embeds a C2PA XMP URI */
function jpegWithC2PAXmp(): number[] {
  const xmpContent = Array.from(
    'https://c2pa.org/specifications/specifications/1.0/c2pa_1.0.pdf'
  ).map((c) => c.charCodeAt(0));
  // Embed in APP1 (but without proper EXIF header — just raw bytes for detection)
  const segLen = xmpContent.length + 2;
  const app1 = [0xff, 0xe1, (segLen >> 8) & 0xff, segLen & 0xff, ...xmpContent];
  return [0xff, 0xd8, ...app1, 0xff, 0xd9];
}

/** Build a PNG with a "caBX" chunk */
function pngWithCaBXChunk(): number[] {
  // PNG signature
  const sig = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  // IHDR chunk (minimal — just needs to exist)
  const ihdrData = [
    0, 0, 0, 1, // width = 1
    0, 0, 0, 1, // height = 1
    8,           // bit depth = 8
    2,           // color type = RGB
    0, 0, 0,     // compression, filter, interlace
  ];
  const ihdrType = [0x49, 0x48, 0x44, 0x52]; // "IHDR"
  const ihdrLen = [0, 0, 0, ihdrData.length];
  const ihdrCrc = [0, 0, 0, 0]; // fake CRC
  const ihdr = [...ihdrLen, ...ihdrType, ...ihdrData, ...ihdrCrc];
  // caBX chunk (C2PA marker)
  const caBXData = [0x01, 0x02, 0x03]; // arbitrary content
  const caBXType = [0x63, 0x61, 0x42, 0x58]; // "caBX"
  const caBXLen = [0, 0, 0, caBXData.length];
  const caBXCrc = [0, 0, 0, 0];
  const caBX = [...caBXLen, ...caBXType, ...caBXData, ...caBXCrc];
  // IEND chunk
  const iendType = [0x49, 0x45, 0x4e, 0x44]; // "IEND"
  const iend = [0, 0, 0, 0, ...iendType, 0xae, 0x42, 0x60, 0x82];
  return [...sig, ...ihdr, ...caBX, ...iend];
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('detectC2PAFromDataUrl', () => {
  test('returns absent for a minimal JPEG with no C2PA markers', () => {
    const result = detectC2PAFromDataUrl(bytesToDataUrl(minimalJpeg()));
    expect(result.presence).toBe('absent');
    expect(result.scoreAdjustment).toBe(0);
  });

  test('returns unknown for invalid/non-decodable data URL', () => {
    const result = detectC2PAFromDataUrl('data:image/jpeg;base64,!!!invalid!!!');
    expect(result.presence).toBe('unknown');
  });

  test('returns unknown for empty data URL', () => {
    const result = detectC2PAFromDataUrl('');
    expect(result.presence).toBe('unknown');
  });

  test('detects C2PA APP11 segment in JPEG', () => {
    const result = detectC2PAFromDataUrl(bytesToDataUrl(jpegWithC2PAApp11()));
    expect(result.presence).toBe('present');
    expect(result.scoreAdjustment).toBeLessThan(0);
  });

  test('detects C2PA XMP URI embedded in JPEG', () => {
    const result = detectC2PAFromDataUrl(bytesToDataUrl(jpegWithC2PAXmp()));
    expect(result.presence).toBe('present');
    expect(result.scoreAdjustment).toBeLessThan(0);
  });

  test('detects C2PA caBX chunk in PNG', () => {
    const result = detectC2PAFromDataUrl(bytesToDataUrl(pngWithCaBXChunk(), 'image/png'));
    expect(result.presence).toBe('present');
    expect(result.scoreAdjustment).toBeLessThan(0);
  });

  test('score adjustment is -0.30 when present', () => {
    const result = detectC2PAFromDataUrl(bytesToDataUrl(jpegWithC2PAApp11()));
    expect(result.scoreAdjustment).toBe(-0.30);
  });
});
