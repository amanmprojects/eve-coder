import { createReadStream } from "node:fs";
import * as path from "node:path";

export const MAX_FILE_SIZE_BYTES = 256 * 1024;

const BINARY_EXTENSIONS = new Set([
  "exe",
  "dll",
  "so",
  "dylib",
  "bin",
  "zip",
  "tar",
  "gz",
  "bz2",
  "xz",
  "7z",
  "rar",
  "jpg",
  "jpeg",
  "png",
  "gif",
  "webp",
  "bmp",
  "ico",
  "tiff",
  "tif",
  "heic",
  "heif",
  "avif",
  "pdf",
  "doc",
  "docx",
  "xls",
  "xlsx",
  "ppt",
  "pptx",
  "mp3",
  "mp4",
  "avi",
  "mov",
  "wav",
  "flac",
  "ogg",
  "wasm",
  "class",
  "jar",
  "pyc",
  "pyo",
  "o",
  "a",
  "woff",
  "woff2",
  "ttf",
  "otf",
  "eot",
  "db",
  "sqlite",
  "sqlite3",
]);

function hasBinaryExtension(filePath: string): boolean {
  const ext = path.extname(filePath).toLowerCase().slice(1);
  return BINARY_EXTENSIONS.has(ext);
}

export async function isBinaryFile(filePath: string): Promise<boolean> {
  if (hasBinaryExtension(filePath)) return true;

  try {
    const buffer = Buffer.alloc(8192);
    const stream = createReadStream(filePath, { start: 0, end: 8191 });
    let bytesRead = 0;

    for await (const chunk of stream) {
      const buf = chunk as Buffer;
      const toCopy = Math.min(buf.length, buffer.length - bytesRead);
      buf.copy(buffer, bytesRead, 0, toCopy);
      bytesRead += toCopy;
      if (bytesRead >= buffer.length) break;
    }

    for (let i = 0; i < bytesRead; i++) {
      if (buffer[i] === 0) return true;
    }
  } catch {
    // If we can't read, assume it's not binary and let text reading fail naturally
  }

  return false;
}
