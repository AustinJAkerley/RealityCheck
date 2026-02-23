/**
 * C2PA (Coalition for Content Provenance and Authenticity) metadata detection.
 *
 * C2PA is an industry standard for content authenticity. When C2PA metadata is
 * present and structurally valid, it is a positive signal that the content was
 * created or processed by a tool that supports content credentials (cameras,
 * Adobe Photoshop, Leica cameras, etc.).
 *
 * This module performs a lightweight heuristic check for C2PA markers in
 * image binary data without fully validating the cryptographic signature
 * (full validation requires trust-store lookup and asymmetric crypto which is
 * impractical in a browser extension without a backend).
 *
 * Marker locations by format:
 * - JPEG: APP11 segment (0xFF EB) containing a JUMBF "c2pa" box
 * - PNG:  "caBX" ancillary chunk
 * - WebP: RIFF chunk with "C2PA" FourCC
 * - XMP:  dcterms:conformsTo referencing the c2pa.org spec URI
 *
 * See https://c2pa.org/specifications/ for the full specification.
 */

export type C2PAPresence = 'present' | 'absent' | 'unknown';

export interface C2PAResult {
  /** Whether C2PA manifest markers were found in the image binary */
  presence: C2PAPresence;
  /**
   * Authenticity score adjustment.
   * Positive values reduce the AI-generation score (content is more likely authentic).
   * Negative values are not used here — absence of C2PA is not evidence of AI.
   *   present  → -0.3  (strong authenticity signal)
   *   absent   →  0.0  (neutral — absence is expected for most real photos)
   *   unknown  →  0.0
   */
  scoreAdjustment: number;
}

/** JUMBF box type label for C2PA */
const C2PA_JUMBF_LABEL = 'c2pa';

/** XMP conformsTo URI prefix used in C2PA manifests */
const C2PA_XMP_URI = 'https://c2pa.org/specifications';

/** JPEG APP11 marker bytes */
const JPEG_APP11_MARKER = [0xff, 0xeb];

/**
 * Scan a byte array for a UTF-8 string pattern.
 * Returns true if the pattern is found within the first `maxScanBytes` bytes.
 */
function containsAsciiPattern(bytes: Uint8Array, pattern: string, maxScanBytes = 65536): boolean {
  const limit = Math.min(bytes.length, maxScanBytes);
  const pat = pattern.split('').map((c) => c.charCodeAt(0));
  const patLen = pat.length;
  outer: for (let i = 0; i <= limit - patLen; i++) {
    for (let j = 0; j < patLen; j++) {
      if (bytes[i + j] !== pat[j]) continue outer;
    }
    return true;
  }
  return false;
}

/**
 * Check for JPEG APP11 segment (C2PA JUMBF embedding).
 * JPEG APP11 = FF EB, followed by 2-byte segment length, then content.
 * C2PA JUMBF boxes contain the ASCII label "c2pa".
 */
function hasJpegC2PASegment(bytes: Uint8Array): boolean {
  let offset = 2; // skip FF D8
  while (offset + 4 < bytes.length) {
    if (bytes[offset] !== 0xff) break;
    const marker = bytes[offset + 1];
    const segLen = (bytes[offset + 2] << 8) | bytes[offset + 3];
    if (marker === 0xeb) {
      // APP11 — scan for "c2pa" label within this segment
      const segEnd = Math.min(offset + 2 + segLen, bytes.length);
      const segSlice = bytes.subarray(offset + 4, segEnd);
      if (containsAsciiPattern(segSlice, C2PA_JUMBF_LABEL, segSlice.length)) {
        return true;
      }
    }
    // Stop scanning at SOS (FF DA) — compressed image data follows
    if (marker === 0xda) break;
    offset += 2 + segLen;
  }
  return false;
}

/**
 * Check for PNG "caBX" chunk (C2PA in PNG).
 * PNG chunk structure: 4-byte length + 4-byte type + data + CRC.
 */
function hasPngC2PAChunk(bytes: Uint8Array): boolean {
  // PNG signature is 8 bytes
  let offset = 8;
  while (offset + 8 < bytes.length) {
    const chunkLen =
      (bytes[offset] << 24) |
      (bytes[offset + 1] << 16) |
      (bytes[offset + 2] << 8) |
      bytes[offset + 3];
    const chunkType = String.fromCharCode(
      bytes[offset + 4],
      bytes[offset + 5],
      bytes[offset + 6],
      bytes[offset + 7]
    );
    if (chunkType === 'caBX') return true;
    // IEND marks end of PNG
    if (chunkType === 'IEND') break;
    offset += 12 + chunkLen; // length + type + data + CRC
  }
  return false;
}

/**
 * Convert a base64 data URL to bytes.
 * Returns null for invalid or non-image data URLs.
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
    return bytes;
  } catch {
    return null;
  }
}

/**
 * Detect C2PA Content Credentials in a JPEG or PNG data URL.
 *
 * Strategy (in priority order):
 * 1. JPEG APP11 segment with JUMBF "c2pa" box label
 * 2. PNG "caBX" chunk
 * 3. XMP conformsTo C2PA URI anywhere in the first 64 KB
 *
 * Falls back to 'unknown' if the data URL cannot be decoded.
 */
export function detectC2PAFromDataUrl(dataUrl: string): C2PAResult {
  const bytes = dataUrlToBytes(dataUrl);
  if (!bytes || bytes.length < 12) {
    return { presence: 'unknown', scoreAdjustment: 0 };
  }

  // Detect format from magic bytes
  const isJpeg = bytes[0] === 0xff && bytes[1] === 0xd8;
  const isPng =
    bytes[0] === 0x89 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x4e &&
    bytes[3] === 0x47;

  let found = false;

  if (isJpeg) {
    found = hasJpegC2PASegment(bytes);
    if (!found) {
      // Also check for XMP embedded in APP1 (some tools use this path)
      found = containsAsciiPattern(bytes, C2PA_XMP_URI);
    }
  } else if (isPng) {
    found = hasPngC2PAChunk(bytes);
    if (!found) {
      found = containsAsciiPattern(bytes, C2PA_XMP_URI);
    }
  } else {
    // WebP, AVIF, or unknown — scan for XMP C2PA URI
    found = containsAsciiPattern(bytes, C2PA_XMP_URI);
    if (!found) {
      found = containsAsciiPattern(bytes, C2PA_JUMBF_LABEL, 4096);
    }
  }

  if (found) {
    return {
      presence: 'present',
      // Presence of C2PA is a positive authenticity signal — reduce AI score
      scoreAdjustment: -0.30,
    };
  }

  return { presence: 'absent', scoreAdjustment: 0 };
}

/**
 * Detect C2PA from an HTMLImageElement by attempting a same-origin canvas
 * capture to obtain the data URL.
 * Returns { presence: 'unknown', scoreAdjustment: 0 } for cross-origin images.
 */
export function detectC2PAFromImage(img: HTMLImageElement): C2PAResult {
  try {
    const canvas = document.createElement('canvas');
    // Use full resolution for C2PA metadata scanning
    canvas.width = img.naturalWidth || 1;
    canvas.height = img.naturalHeight || 1;
    const ctx = canvas.getContext('2d');
    if (!ctx) return { presence: 'unknown', scoreAdjustment: 0 };
    ctx.drawImage(img, 0, 0);
    const dataUrl = canvas.toDataURL('image/png');
    return detectC2PAFromDataUrl(dataUrl);
  } catch {
    // Cross-origin taint or canvas unavailable
    return { presence: 'unknown', scoreAdjustment: 0 };
  }
}
