import fs from "fs";

// Magic byte signatures for allowed MIME types
const MAGIC = [
  { mime: "application/pdf",    bytes: [0x25, 0x50, 0x44, 0x46] },        // %PDF
  { mime: "image/png",          bytes: [0x89, 0x50, 0x4E, 0x47] },        // PNG
  { mime: "image/jpeg",         bytes: [0xFF, 0xD8, 0xFF] },               // JPEG
  { mime: "image/gif",          bytes: [0x47, 0x49, 0x46, 0x38] },        // GIF8
  { mime: "image/webp",         bytes: [0x52, 0x49, 0x46, 0x46] },        // RIFF (webp)
  { mime: "application/msword", bytes: [0xD0, 0xCF, 0x11, 0xE0] },        // OLE2
  { mime: "text/plain",         bytes: null },                              // no magic — allow
  { mime: "text/csv",           bytes: null },
];

// All OOXML + zip types share the PK magic bytes
const ZIP_MIMES = new Set([
  "application/zip",
  "application/x-zip-compressed",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  "application/vnd.ms-excel",
  "application/vnd.ms-powerpoint",
]);

function checkMagicBytes(filePath, declaredMime) {
  const buf = Buffer.alloc(12);
  const fd = fs.openSync(filePath, "r");
  fs.readSync(fd, buf, 0, 12, 0);
  fs.closeSync(fd);

  if (ZIP_MIMES.has(declaredMime)) {
    return buf[0] === 0x50 && buf[1] === 0x4B; // PK
  }

  const entry = MAGIC.find(m => m.mime === declaredMime);
  if (!entry) return false;        // unknown type — reject
  if (!entry.bytes) return true;   // text — no magic check needed
  return entry.bytes.every((b, i) => buf[i] === b);
}

let _clamClient = null;
let _clamInitFailed = false;

async function getClamClient() {
  if (_clamClient) return _clamClient;
  if (_clamInitFailed) return null;

  const host = process.env.CLAMAV_HOST;
  const port = parseInt(process.env.CLAMAV_PORT || "3310");
  if (!host) return null;

  try {
    const { default: NodeClam } = await import("clamscan");
    _clamClient = await new NodeClam().init({
      clamdscan: { host, port, timeout: 15000, active: true },
      preference: "clamdscan",
    });
    console.log("[scanFile] ClamAV connected at", host, port);
    return _clamClient;
  } catch (e) {
    console.warn("[scanFile] ClamAV unavailable:", e.message);
    _clamInitFailed = true;
    return null;
  }
}

/**
 * Scans an uploaded file for:
 *   1. Magic byte mismatch (spoofed MIME type)
 *   2. Malware via ClamAV (if configured)
 *
 * Returns { safe: true } or { safe: false, reason: string }
 */
export async function scanFile(filePath, declaredMime) {
  // 1. Magic bytes
  try {
    if (!checkMagicBytes(filePath, declaredMime)) {
      return { safe: false, reason: "File content does not match its declared type" };
    }
  } catch (e) {
    return { safe: false, reason: "Could not read file for validation" };
  }

  // 2. ClamAV
  const clam = await getClamClient();
  if (clam) {
    try {
      const { isInfected, viruses } = await clam.scanFile(filePath);
      if (isInfected) {
        return { safe: false, reason: `Malware detected: ${viruses.join(", ")}` };
      }
    } catch (e) {
      // ClamAV scan error — log and fail open so uploads aren't blocked by infra issues
      console.warn("[scanFile] ClamAV scan error:", e.message);
    }
  }

  return { safe: true };
}
