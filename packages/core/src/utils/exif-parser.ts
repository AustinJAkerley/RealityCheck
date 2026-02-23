/**
 * Lightweight EXIF binary parser for JPEG images.
 *
 * Extracts key EXIF fields from a JPEG data URL without any external dependencies.
 * AI-generated images almost always lack camera-specific EXIF metadata (Make, Model,
 * exposure settings, GPS), which is a useful authenticity signal.
 *
 * Supports only JPEG (APP1/EXIF markers). PNG and WebP have separate metadata
 * formats and return null from this parser.
 *
 * Known limitations:
 * - Only parses baseline TIFF-IFD0 and ExifIFD tag sets.
 * - Does not validate EXIF checksums.
 * - MakerNote blobs are skipped.
 */

export interface ExifData {
  /** Camera manufacturer (EXIF Make tag 0x010F) */
  make?: string;
  /** Camera model (EXIF Model tag 0x0110) */
  model?: string;
  /** Exposure time in seconds (EXIF ExposureTime tag 0x829A) */
  exposureTime?: number;
  /** Aperture F-number (EXIF FNumber tag 0x829D) */
  fNumber?: number;
  /** ISO speed rating (EXIF ISOSpeedRatings tag 0x8827) */
  iso?: number;
  /** GPS latitude (IFD presence indicates location was recorded) */
  gpsLatitude?: number;
  /** Lens model string (EXIF LensModel tag 0xA434) */
  lensModel?: string;
  /** Software tag — often populated by photo editors or AI generators */
  software?: string;
  /** Whether the image has any camera hardware EXIF (Make or Model present) */
  hasCameraHardware: boolean;
}

/** EXIF tag IDs we care about */
const TAG_MAKE = 0x010f;
const TAG_MODEL = 0x0110;
const TAG_SOFTWARE = 0x0131;
const TAG_EXPOSURE_TIME = 0x829a;
const TAG_F_NUMBER = 0x829d;
const TAG_EXIF_IFD = 0x8769;
const TAG_GPS_IFD = 0x8825;
const TAG_ISO = 0x8827;
const TAG_LENS_MODEL = 0xa434;

/** EXIF data types */
const TYPE_BYTE = 1;
const TYPE_ASCII = 2;
const TYPE_SHORT = 3;
const TYPE_LONG = 4;
const TYPE_RATIONAL = 5;
const TYPE_SLONG = 9;
const TYPE_SRATIONAL = 10;

const TYPE_SIZES: Record<number, number> = {
  [TYPE_BYTE]: 1,
  [TYPE_ASCII]: 1,
  [TYPE_SHORT]: 2,
  [TYPE_LONG]: 4,
  [TYPE_RATIONAL]: 8,
  [TYPE_SLONG]: 4,
  [TYPE_SRATIONAL]: 8,
};

/**
 * Convert a base64 data URL to a Uint8Array.
 * Returns null if the data URL is not a valid JPEG (does not start with FF D8).
 */
function dataUrlToBytes(dataUrl: string): Uint8Array | null {
  try {
    const commaIdx = dataUrl.indexOf(',');
    if (commaIdx < 0) return null;
    const b64 = dataUrl.slice(commaIdx + 1);
    const binary = atob(b64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
      bytes[i] = binary.charCodeAt(i);
    }
    // JPEG must start with FF D8
    if (bytes[0] !== 0xff || bytes[1] !== 0xd8) return null;
    return bytes;
  } catch {
    return null;
  }
}

/**
 * Locate the EXIF APP1 segment in a JPEG byte array.
 * Returns the offset to the start of the TIFF header inside the segment,
 * or -1 if not found.
 */
function findExifOffset(bytes: Uint8Array): number {
  // Scan JPEG segments looking for APP1 (FF E1) with "Exif\0\0" identifier
  let offset = 2; // skip FF D8
  while (offset + 4 < bytes.length) {
    if (bytes[offset] !== 0xff) break;
    const marker = bytes[offset + 1];
    const segLen = (bytes[offset + 2] << 8) | bytes[offset + 3];
    if (marker === 0xe1) {
      // APP1 — check for "Exif\0\0"
      if (
        offset + 10 < bytes.length &&
        bytes[offset + 4] === 0x45 && // E
        bytes[offset + 5] === 0x78 && // x
        bytes[offset + 6] === 0x69 && // i
        bytes[offset + 7] === 0x66 && // f
        bytes[offset + 8] === 0x00 &&
        bytes[offset + 9] === 0x00
      ) {
        return offset + 10; // TIFF header starts here
      }
    }
    offset += 2 + segLen;
  }
  return -1;
}

function readUint16(bytes: Uint8Array, offset: number, littleEndian: boolean): number {
  if (offset + 1 >= bytes.length) return 0;
  return littleEndian
    ? bytes[offset] | (bytes[offset + 1] << 8)
    : (bytes[offset] << 8) | bytes[offset + 1];
}

function readUint32(bytes: Uint8Array, offset: number, littleEndian: boolean): number {
  if (offset + 3 >= bytes.length) return 0;
  return littleEndian
    ? bytes[offset] |
        (bytes[offset + 1] << 8) |
        (bytes[offset + 2] << 16) |
        (bytes[offset + 3] << 24)
    : (bytes[offset] << 24) |
        (bytes[offset + 1] << 16) |
        (bytes[offset + 2] << 8) |
        bytes[offset + 3];
}

function readRational(
  bytes: Uint8Array,
  offset: number,
  littleEndian: boolean,
  signed: boolean
): number {
  if (offset + 7 >= bytes.length) return 0;
  const num = signed
    ? readInt32(bytes, offset, littleEndian)
    : readUint32(bytes, offset, littleEndian);
  const den = signed
    ? readInt32(bytes, offset + 4, littleEndian)
    : readUint32(bytes, offset + 4, littleEndian);
  return den === 0 ? 0 : num / den;
}

function readInt32(bytes: Uint8Array, offset: number, littleEndian: boolean): number {
  const u = readUint32(bytes, offset, littleEndian);
  return u | 0; // signed
}

function readAscii(bytes: Uint8Array, offset: number, count: number): string {
  let result = '';
  for (let i = 0; i < count - 1 && offset + i < bytes.length; i++) {
    const c = bytes[offset + i];
    if (c === 0) break;
    result += String.fromCharCode(c);
  }
  return result.trim();
}

interface IFDEntry {
  tag: number;
  type: number;
  count: number;
  valueOffset: number; // absolute byte offset into the TIFF block for multi-byte values
  inlineValue: number; // raw 4-byte inline value (for short/long types that fit)
}

/**
 * Parse all entries in one IFD (Image File Directory).
 * `tiffStart` is the absolute offset in `bytes` where the TIFF header begins.
 * `ifdStart` is the absolute offset of the IFD entry count field.
 */
function readIFD(
  bytes: Uint8Array,
  tiffStart: number,
  ifdStart: number,
  littleEndian: boolean
): IFDEntry[] {
  if (ifdStart + 2 > bytes.length) return [];
  const entryCount = readUint16(bytes, ifdStart, littleEndian);
  const entries: IFDEntry[] = [];
  for (let i = 0; i < entryCount; i++) {
    const base = ifdStart + 2 + i * 12;
    if (base + 12 > bytes.length) break;
    const tag = readUint16(bytes, base, littleEndian);
    const type = readUint16(bytes, base + 2, littleEndian);
    const count = readUint32(bytes, base + 4, littleEndian);
    const typeSize = TYPE_SIZES[type] ?? 1;
    const totalSize = typeSize * count;
    let valueOffset: number;
    let inlineValue: number;
    if (totalSize <= 4) {
      // Value fits inline in the 4-byte field
      inlineValue = readUint32(bytes, base + 8, littleEndian);
      valueOffset = base + 8;
    } else {
      // Value is at the offset stored in the 4-byte field (relative to TIFF start)
      const relOffset = readUint32(bytes, base + 8, littleEndian);
      inlineValue = relOffset;
      valueOffset = tiffStart + relOffset;
    }
    entries.push({ tag, type, count, valueOffset, inlineValue });
  }
  return entries;
}

function extractTagValue(
  entry: IFDEntry,
  bytes: Uint8Array,
  littleEndian: boolean
): string | number | null {
  const { tag, type, count, valueOffset } = entry;
  switch (type) {
    case TYPE_ASCII:
      return readAscii(bytes, valueOffset, count);
    case TYPE_SHORT:
      if (count === 1) {
        return littleEndian
          ? bytes[valueOffset] | (bytes[valueOffset + 1] << 8)
          : (bytes[valueOffset] << 8) | bytes[valueOffset + 1];
      }
      // Return first value for multi-count shorts
      return readUint16(bytes, valueOffset, littleEndian);
    case TYPE_LONG:
      return readUint32(bytes, valueOffset, littleEndian);
    case TYPE_RATIONAL:
      return readRational(bytes, valueOffset, littleEndian, false);
    case TYPE_SRATIONAL:
      return readRational(bytes, valueOffset, littleEndian, true);
    default:
      return null;
  }
  void tag; // suppress unused warning
}

/**
 * Parse EXIF metadata from a JPEG data URL.
 * Returns null if:
 * - The data URL is not a JPEG
 * - No EXIF APP1 segment is found
 * - The TIFF header is malformed
 */
export function parseExifFromDataUrl(dataUrl: string): ExifData | null {
  const bytes = dataUrlToBytes(dataUrl);
  if (!bytes) return null;

  const tiffStart = findExifOffset(bytes);
  if (tiffStart < 0) return null;

  // Determine byte order: "II" = little-endian, "MM" = big-endian
  if (tiffStart + 8 > bytes.length) return null;
  const byteOrder = (bytes[tiffStart] << 8) | bytes[tiffStart + 1];
  if (byteOrder !== 0x4949 && byteOrder !== 0x4d4d) return null; // "II" or "MM"
  const littleEndian = byteOrder === 0x4949;

  // TIFF magic (0x002A) and IFD0 offset
  const magic = readUint16(bytes, tiffStart + 2, littleEndian);
  if (magic !== 0x002a) return null;
  const ifd0RelOffset = readUint32(bytes, tiffStart + 4, littleEndian);
  const ifd0Offset = tiffStart + ifd0RelOffset;

  const ifd0 = readIFD(bytes, tiffStart, ifd0Offset, littleEndian);

  const result: ExifData = { hasCameraHardware: false };
  let exifIFDOffset: number | null = null;
  let gpsIFDOffset: number | null = null;

  for (const entry of ifd0) {
    const val = extractTagValue(entry, bytes, littleEndian);
    switch (entry.tag) {
      case TAG_MAKE:
        if (typeof val === 'string' && val.length > 0) {
          result.make = val;
          result.hasCameraHardware = true;
        }
        break;
      case TAG_MODEL:
        if (typeof val === 'string' && val.length > 0) {
          result.model = val;
          result.hasCameraHardware = true;
        }
        break;
      case TAG_SOFTWARE:
        if (typeof val === 'string') result.software = val;
        break;
      case TAG_EXIF_IFD:
        if (typeof val === 'number') exifIFDOffset = tiffStart + val;
        break;
      case TAG_GPS_IFD:
        if (typeof val === 'number') gpsIFDOffset = tiffStart + val;
        break;
    }
  }

  // Parse Exif sub-IFD for camera settings
  if (exifIFDOffset !== null) {
    const exifEntries = readIFD(bytes, tiffStart, exifIFDOffset, littleEndian);
    for (const entry of exifEntries) {
      const val = extractTagValue(entry, bytes, littleEndian);
      switch (entry.tag) {
        case TAG_EXPOSURE_TIME:
          if (typeof val === 'number') result.exposureTime = val;
          break;
        case TAG_F_NUMBER:
          if (typeof val === 'number') result.fNumber = val;
          break;
        case TAG_ISO:
          if (typeof val === 'number') result.iso = val;
          break;
        case TAG_LENS_MODEL:
          if (typeof val === 'string' && val.length > 0) result.lensModel = val;
          break;
      }
    }
  }

  // Parse GPS sub-IFD — just check presence
  if (gpsIFDOffset !== null) {
    const gpsEntries = readIFD(bytes, tiffStart, gpsIFDOffset, littleEndian);
    // Tag 0x0002 = GPSLatitude
    const latEntry = gpsEntries.find((e) => e.tag === 0x0002);
    if (latEntry) {
      const val = extractTagValue(latEntry, bytes, littleEndian);
      if (typeof val === 'number') result.gpsLatitude = val;
    }
  }

  return result;
}

/**
 * Compute an AI-generation signal from EXIF data (or lack thereof).
 *
 * Logic:
 * - If EXIF is completely absent → likely AI (score += 0.25)
 * - If EXIF present but no camera hardware (Make/Model) → likely AI (score += 0.25)
 * - If camera hardware present → real photo signal (score = 0)
 * - Software tag containing "Stable Diffusion", "DALL-E", "Midjourney", etc. → strong AI signal
 *
 * Returns 0–1; higher = more likely AI-generated.
 */
export function getExifAIScore(exifData: ExifData | null): number {
  if (exifData === null) {
    // No EXIF at all — moderate AI signal (JPEG from real cameras always has EXIF)
    return 0.25;
  }

  if (exifData.hasCameraHardware) {
    // Real camera make/model present — authenticity signal, reduce AI score
    return 0;
  }

  // Check software tag for known AI generator names
  const software = (exifData.software ?? '').toLowerCase();
  const AI_SOFTWARE_PATTERNS = [
    'stable diffusion',
    'dall-e',
    'dall·e',
    'midjourney',
    'novelai',
    'invokeai',
    'automatic1111',
    'comfyui',
    'diffusers',
    'firefly',
    'imagen',
  ];
  if (AI_SOFTWARE_PATTERNS.some((p) => software.includes(p))) {
    return 0.9; // Very strong AI signal
  }

  // EXIF present but no camera hardware
  return 0.25;
}
