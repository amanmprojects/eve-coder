/**
 * Detect a supported image MIME type from a file's leading bytes, so read_file
 * can describe binary image files instead of returning an opaque "binary".
 *
 * Ported (trimmed) from pi's `harness/tools/image.ts`: signature-only detection
 * for the formats models commonly accept as image attachments.
 */
const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

function startsWith(buf: Uint8Array, bytes: number[]): boolean {
  if (buf.length < bytes.length) return false;
  return bytes.every((b, i) => buf[i] === b);
}

function startsWithAscii(buf: Uint8Array, offset: number, text: string): boolean {
  if (buf.length < offset + text.length) return false;
  for (let i = 0; i < text.length; i++) {
    if (buf[offset + i] !== text.charCodeAt(i)) return false;
  }
  return true;
}

function readUint32BE(buf: Uint8Array, offset: number): number {
  return (
    (buf[offset] ?? 0) * 0x1000000 +
    ((buf[offset + 1] ?? 0) << 16) +
    ((buf[offset + 2] ?? 0) << 8) +
    (buf[offset + 3] ?? 0)
  );
}

function isAnimatedPng(buf: Uint8Array): boolean {
  let offset = PNG_SIGNATURE.length;
  while (offset + 8 <= buf.length) {
    const chunkLength = readUint32BE(buf, offset);
    const typeOffset = offset + 4;
    if (startsWithAscii(buf, typeOffset, "acTL")) return true;
    if (startsWithAscii(buf, typeOffset, "IDAT")) return false;
    const next = offset + 8 + chunkLength + 4;
    if (next <= offset || next > buf.length) return false;
    offset = next;
  }
  return false;
}

function isPng(buf: Uint8Array): boolean {
  return buf.length >= 16 && readUint32BE(buf, PNG_SIGNATURE.length) === 13 && startsWithAscii(buf, 12, "IHDR");
}

export function detectSupportedImageMimeType(buf: Uint8Array): string | undefined {
  if (startsWith(buf, [0xff, 0xd8, 0xff])) return buf[3] === 0xf7 ? undefined : "image/jpeg";
  if (startsWith(buf, PNG_SIGNATURE)) return isPng(buf) && !isAnimatedPng(buf) ? "image/png" : undefined;
  if (startsWithAscii(buf, 0, "GIF")) return "image/gif";
  if (startsWithAscii(buf, 0, "RIFF") && startsWithAscii(buf, 8, "WEBP")) return "image/webp";
  if (startsWithAscii(buf, 0, "BM")) return "image/bmp";
  return undefined;
}
