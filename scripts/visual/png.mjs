import { PNG } from "pngjs";

// Accept the bounded, non-interlaced RGB/RGBA profile produced by Chromium.
// Check every header BEFORE pngjs: repeated IHDR can replace dimensions and
// its interlaced decoder does not bound inflated bytes by the image dimensions.
export function validatePng(bytes) {
  if (
    bytes.length < 57 ||
    bytes.length > 8_000_000 ||
    !bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
  )
    return false;
  let offset = 8,
    header = false,
    data = false,
    chunks = 0;
  while (offset + 12 <= bytes.length) {
    if (++chunks > 4096) return false;
    const size = bytes.readUInt32BE(offset);
    const type = bytes.toString("ascii", offset + 4, offset + 8);
    const end = offset + size + 12;
    if (end > bytes.length) return false;
    if (type === "IHDR") {
      if (header || offset !== 8 || size !== 13) return false;
      if (
        bytes.readUInt32BE(offset + 8) !== 1440 ||
        bytes.readUInt32BE(offset + 12) !== 960 ||
        bytes[offset + 16] !== 8 ||
        ![2, 6].includes(bytes[offset + 17]) ||
        bytes[offset + 18] !== 0 ||
        bytes[offset + 19] !== 0 ||
        bytes[offset + 20] !== 0
      )
        return false;
      header = true;
    } else if (!header) return false;
    else if (type === "IDAT") {
      data = true;
    } else if (type === "IEND") {
      return size === 0 && data && end === bytes.length;
    } else {
      // Chromium captures contain only IHDR/IDAT/IEND. Reject color/gamma and
      // transparency metadata whose display effect raw RGBA does not model.
      return false;
    }
    offset = end;
  }
  return false;
}

export function decodePng(bytes) {
  if (!validatePng(bytes)) throw new Error("Unsupported or malformed 1440×960 screenshot PNG");
  const decoded = PNG.sync.read(bytes, { checkCRC: true });
  if (decoded.data.length !== 1440 * 960 * 4) throw new Error("Unexpected decoded PNG size");
  return decoded.data;
}

export function encodeHeat(data) {
  return PNG.sync.write({ width: 1440, height: 960, data: Buffer.from(data) });
}
