/** Synthetic Explorer assets; imported by usability-fixtures.mjs --enrich-viewers. */
import assert from "node:assert/strict";
import { lstatSync } from "node:fs";
import { join } from "node:path";
import { deflateSync } from "node:zlib";

// A small, metadata-free RGB diagram; no image library or external asset needed.
function auditPng() {
  const width = 160;
  const height = 96;
  const scanlines = Buffer.alloc(height * (1 + width * 3));
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const offset = y * (1 + width * 3) + 1 + x * 3;
      const color = y < 20 ? [48, 68, 103] : x < 48 ? [71, 166, 158] : [235, 240, 247];
      scanlines.set(color, offset);
    }
  }
  const chunk = (type, payload) => {
    const body = Buffer.concat([Buffer.from(type), payload]);
    let crc = 0xffffffff;
    for (const byte of body) {
      crc ^= byte;
      for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
    }
    const result = Buffer.alloc(body.length + 8);
    result.writeUInt32BE(payload.length);
    body.copy(result, 4);
    result.writeUInt32BE((crc ^ 0xffffffff) >>> 0, result.length - 4);
    return result;
  };
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width);
  header.writeUInt32BE(height, 4);
  header[8] = 8;
  header[9] = 2;
  return Buffer.concat([
    Buffer.from("89504e470d0a1a0a", "hex"),
    chunk("IHDR", header),
    chunk("IDAT", deflateSync(scanlines)),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

export function viewerFixtures() {
  const longKey = `audit_navigation_context_${"unbroken_key_segment_".repeat(12)}`;
  const longValue = `AUDIT_ONLY_${"LongUnbrokenValue0123456789".repeat(40)}`;
  const json = {
    fixture: "TracePilot disposable Explorer review",
    summary: { status: "ready", owner: null, optionalNotes: "", enabled: true },
    viewport: { width: 1440, height: 960 },
    checks: ["Keyboard focus", "café 日本語 العربية 🧭", { nested: [0, false, null] }],
    [longKey]: longValue,
  };
  const records = Array.from({ length: 120 }, (_, index) => ({
    type: index % 3 ? "audit.observation" : "audit.checkpoint",
    id: `audit-${String(index + 1).padStart(4, "0")}`,
    timestamp: new Date(Date.UTC(2026, 8, 12, 0, 0, index)).toISOString(),
    data: {
      label: index === 119 ? "Final record — filter target café" : `Review item ${index + 1}`,
      status: index % 4 ? "ready" : "pending",
      note: index === 1 ? longValue : null,
    },
  }));
  const rows = [["Check ID", "Label", "Status", "Notes", "Optional owner"]];
  for (let index = 0; index < 120; index++)
    rows.push([
      `audit-${index + 1}`,
      index === 119 ? "Final row — filter target café" : `Desktop check ${index + 1}`,
      index % 4 ? "ready" : "pending",
      index === 0
        ? 'Comma, quote "Ready", and a\nsecond line'
        : index === 1
          ? longValue
          : "日本語 🧭",
      "",
    ]);
  const csvCell = (value) => `"${value.replaceAll('"', '""')}"`;
  return new Map([
    ["audit-structured.json", `${JSON.stringify(json, null, 2)}\n`],
    ["audit-records.jsonl", `${records.map((record) => JSON.stringify(record)).join("\n")}\n`],
    ["audit-table.csv", `${rows.map((row) => row.map(csvCell).join(",")).join("\r\n")}\r\n`],
    [
      "audit-notes.txt",
      `AUDIT FIXTURE — plain text\n\nAll content is disposable.\nSearch marker: viewer-fixture-target\nUnicode: café 日本語 العربية 🧭\n\nLong unbroken line:\n${longValue}\n\nEnd of the readable fixture.\n`,
    ],
    [
      "audit-invalid.json",
      '{"fixture":"Intentionally truncated JSON for error recovery","items":[1,2,\n',
    ],
    [
      "audit-diagram.svg",
      '<svg xmlns="http://www.w3.org/2000/svg" width="320" height="160" viewBox="0 0 320 160"><title>Disposable audit diagram</title><rect width="320" height="160" fill="#ebf0f7"/><rect x="16" y="16" width="288" height="48" rx="8" fill="#304467"/><text x="32" y="48" fill="white" font-family="sans-serif" font-size="20">AUDIT FIXTURE</text><rect x="16" y="80" width="80" height="64" rx="8" fill="#47a69e"/></svg>\n',
    ],
    ["audit-preview.png", auditPng()],
    [
      "audit-binary.bin",
      Buffer.from([0x54, 0x50, 0x41, 0x55, 0x44, 0x49, 0x54, 0, 0xff, 0xfe, 0x80, 0]),
    ],
  ]);
}

/** Caller validates the complete profile's ownership; all writes stay exclusive. */
export function enrichViewerFixtures(manifest, { sessionRoot, ensureDirectory, writeNew }) {
  const rich = manifest.sessions.filter((session) => session.kind === "rich-lifecycle");
  assert.equal(rich.length, 1, "Expected one owned rich fixture session.");
  assert.match(rich[0].id, /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i);
  const directory = join(sessionRoot, rich[0].id, "viewer-fixtures");
  ensureDirectory(directory);
  const files = [...viewerFixtures()].map(([name, content]) => {
    const path = join(directory, name);
    let exists = false;
    try {
      const stat = lstatSync(path);
      assert(stat.isFile() && !stat.isSymbolicLink(), `Unsafe existing fixture file: ${path}`);
      exists = true;
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
    return { name, path, content, exists };
  });
  // Preflight every destination before adding any file; reruns preserve edited fixtures.
  for (const file of files) if (!file.exists) writeNew(file.path, file.content);
  return {
    directory,
    created: files.filter((file) => !file.exists).map((file) => file.name),
    preserved: files.filter((file) => file.exists).map((file) => file.name),
  };
}
