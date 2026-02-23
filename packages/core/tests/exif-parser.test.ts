/**
 * Tests for the EXIF parser utility.
 */
import { parseExifFromDataUrl, getExifAIScore, ExifData } from '../src/utils/exif-parser';

// ── Helpers ────────────────────────────────────────────────────────────────────

/**
 * Build a minimal JPEG data URL with an EXIF APP1 segment.
 * The constructed JPEG has: SOI + APP1 (with EXIF) + EOI.
 */
function buildMinimalJpegWithExif(
  make: string,
  model: string,
  software?: string
): string {
  // Build TIFF IFD0 with Make, Model, (optional Software) entries
  const LE = true; // little-endian

  function w16(v: number): number[] {
    return [v & 0xff, (v >> 8) & 0xff];
  }
  function w32(v: number): number[] {
    return [v & 0xff, (v >> 8) & 0xff, (v >> 16) & 0xff, (v >> 24) & 0xff];
  }
  function asciiTag(tag: number, str: string, dataOffset: number): { entry: number[]; data: number[] } {
    const bytes = [...str].map((c) => c.charCodeAt(0)).concat([0]); // NUL-terminated
    const entry = [...w16(tag), ...w16(2 /* ASCII */), ...w32(bytes.length), ...w32(dataOffset)];
    return { entry, data: bytes };
  }

  // TIFF header: II (LE), magic 0x002A, IFD0 offset = 8
  const tiffHeader = [0x49, 0x49, 0x2a, 0x00, 0x08, 0x00, 0x00, 0x00];

  const entries: number[][] = [];
  const strings: number[][] = [];

  // IFD0 entries are 12 bytes each. IFD data area starts after:
  // TIFF header (8) + entry count (2) + entries (N*12) + next IFD offset (4)
  const numEntries = software ? 3 : 2;
  let dataOffset = 8 + 2 + numEntries * 12 + 4; // relative to TIFF start

  const makeTag = asciiTag(0x010f, make, dataOffset);
  entries.push(makeTag.entry);
  strings.push(makeTag.data);
  dataOffset += makeTag.data.length;

  const modelTag = asciiTag(0x0110, model, dataOffset);
  entries.push(modelTag.entry);
  strings.push(modelTag.data);
  dataOffset += modelTag.data.length;

  if (software) {
    const swTag = asciiTag(0x0131, software, dataOffset);
    entries.push(swTag.entry);
    strings.push(swTag.data);
  }

  const ifd: number[] = [
    ...w16(numEntries),
    ...entries.flat(),
    ...w32(0), // next IFD offset = 0 (no more IFDs)
    ...strings.flat(),
  ];

  const tiff = [...tiffHeader, ...ifd];

  // APP1 segment: FF E1 + 2-byte length + "Exif\0\0" + TIFF data
  const exifHeader = [0x45, 0x78, 0x69, 0x66, 0x00, 0x00]; // "Exif\0\0"
  const app1Content = [...exifHeader, ...tiff];
  const app1Length = app1Content.length + 2; // +2 for the length field itself
  const app1 = [0xff, 0xe1, (app1Length >> 8) & 0xff, app1Length & 0xff, ...app1Content];

  // Minimal JPEG: SOI + APP1 + EOI
  const jpegBytes = [0xff, 0xd8, ...app1, 0xff, 0xd9];

  // Convert to base64 data URL
  const binary = String.fromCharCode(...jpegBytes);
  const b64 = btoa(binary);
  return `data:image/jpeg;base64,${b64}`;
}

/** Build a minimal JPEG with no EXIF (SOI + EOI only) */
function buildJpegNoExif(): string {
  const bytes = [0xff, 0xd8, 0xff, 0xd9];
  const binary = String.fromCharCode(...bytes);
  return `data:image/jpeg;base64,${btoa(binary)}`;
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('parseExifFromDataUrl', () => {
  test('returns null for non-JPEG data URL', () => {
    expect(parseExifFromDataUrl('data:image/png;base64,iVBORw0KGgo=')).toBeNull();
  });

  test('returns null for JPEG with no EXIF segment', () => {
    expect(parseExifFromDataUrl(buildJpegNoExif())).toBeNull();
  });

  test('returns null for invalid/empty data URL', () => {
    expect(parseExifFromDataUrl('')).toBeNull();
    expect(parseExifFromDataUrl('not-a-data-url')).toBeNull();
  });

  test('parses Make and Model from a minimal JPEG with EXIF', () => {
    const dataUrl = buildMinimalJpegWithExif('Canon', 'EOS 5D Mark IV');
    const result = parseExifFromDataUrl(dataUrl);
    expect(result).not.toBeNull();
    expect(result!.make).toBe('Canon');
    expect(result!.model).toBe('EOS 5D Mark IV');
    expect(result!.hasCameraHardware).toBe(true);
  });

  test('parses Software tag', () => {
    const dataUrl = buildMinimalJpegWithExif('', '', 'Stable Diffusion');
    const result = parseExifFromDataUrl(dataUrl);
    expect(result).not.toBeNull();
    expect(result!.software).toBe('Stable Diffusion');
  });
});

describe('getExifAIScore', () => {
  test('returns 0.25 for null (no EXIF)', () => {
    expect(getExifAIScore(null)).toBe(0.25);
  });

  test('returns 0 when camera hardware is present', () => {
    const exif: ExifData = { hasCameraHardware: true, make: 'Nikon', model: 'D850' };
    expect(getExifAIScore(exif)).toBe(0);
  });

  test('returns 0.25 when EXIF present but no camera hardware', () => {
    const exif: ExifData = { hasCameraHardware: false };
    expect(getExifAIScore(exif)).toBe(0.25);
  });

  test('returns 0.9 when software is a known AI generator', () => {
    const aiSoftware: Array<ExifData> = [
      { hasCameraHardware: false, software: 'Stable Diffusion v2.1' },
      { hasCameraHardware: false, software: 'DALL-E 3' },
      { hasCameraHardware: false, software: 'Midjourney v6' },
      { hasCameraHardware: false, software: 'InvokeAI' },
      { hasCameraHardware: false, software: 'ComfyUI' },
    ];
    for (const exif of aiSoftware) {
      expect(getExifAIScore(exif)).toBe(0.9);
    }
  });

  test('is case-insensitive for software names', () => {
    const exif: ExifData = { hasCameraHardware: false, software: 'STABLE DIFFUSION' };
    expect(getExifAIScore(exif)).toBe(0.9);
  });
});
