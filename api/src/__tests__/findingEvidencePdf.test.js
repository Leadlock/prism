import zlib from "zlib";
import { describe, test, expect } from "vitest";
import { renderFindingEvidencePdf } from "../utils/findingEvidencePdf.js";
import { buildEvidencePayload } from "../connectors/shared/evidencePayload.js";

// pdfkit's output uses FlateDecode-compressed content streams, and this repo's
// pdf-parse version is incompatible with pdfkit 0.15's PDF structure (fails with
// "bad XRef entry" even on pre-existing, unmodified payloads — unrelated to this
// change). To assert on the *rendered text* of a generated PDF without relying on
// that broken combination, inflate every FlateDecode stream in the raw PDF bytes
// and pull out the actual glyph bytes: pdfkit writes each Tj/TJ string operand as
// a hex string (`<...>`) whose bytes are plain WinAnsi/ASCII for the fonts used
// here, so hex-decoding those substrings reconstructs the rendered text.
function extractDecompressedText(buf) {
  const raw = buf.toString("latin1");
  const streamRe = /stream\r?\n([\s\S]*?)\r?\nendstream/g;
  let match;
  let combined = "";
  while ((match = streamRe.exec(raw))) {
    const streamBytes = Buffer.from(match[1], "latin1");
    let content;
    try {
      content = zlib.inflateSync(streamBytes).toString("latin1");
    } catch {
      continue; // Not a Flate-compressed stream (e.g. a font file) — skip it.
    }
    const hexStringRe = /<([0-9a-fA-F]+)>/g;
    let hexMatch;
    while ((hexMatch = hexStringRe.exec(content))) {
      combined += Buffer.from(hexMatch[1], "hex").toString("latin1");
    }
  }
  return combined;
}

describe("renderFindingEvidencePdf", () => {
  test("produces a valid PDF buffer containing the finding's data", async () => {
    const buf = await renderFindingEvidencePdf({
      title: "S3 buckets block public access",
      testKey: "aws.network.s3_public_access_blocked",
      resourceId: "bucket-1",
      severity: "critical",
      message: "bucket-1 has no public access block configuration",
      evidencePayload: { BlockPublicAcls: false, BlockPublicPolicy: false },
      isoReferences: ["A.8.2.3"],
      connectionName: "Prod AWS",
      integrationKey: "aws",
    });
    expect(Buffer.isBuffer(buf)).toBe(true);
    expect(buf.subarray(0, 5).toString()).toBe("%PDF-");
  });

  test("handles an empty evidence payload and missing optional fields without throwing", async () => {
    const buf = await renderFindingEvidencePdf({
      title: "t",
      testKey: "k",
      resourceId: "r",
      severity: "low",
      message: null,
      evidencePayload: {},
      isoReferences: [],
      connectionName: null,
      integrationKey: null,
    });
    expect(buf.subarray(0, 5).toString()).toBe("%PDF-");
  });

  test("renders resourceType/resourceName/region as labeled fields when the evidence payload uses the standardized shape", async () => {
    const buf = await renderFindingEvidencePdf({
      title: "RDS instances have storage encryption enabled",
      testKey: "aws.rds.storage_encrypted",
      resourceId: "arn:aws:rds:us-east-1:123456789012:db:prod-1",
      severity: "critical",
      message: "prod-1 does not have storage encryption enabled",
      evidencePayload: buildEvidencePayload({
        resourceType: "rds_instance",
        resourceId: "arn:aws:rds:us-east-1:123456789012:db:prod-1",
        resourceName: "prod-1",
        region: "us-east-1",
        details: { storageEncrypted: false },
      }),
      isoReferences: ["A.8.2.3"],
      connectionName: "Prod AWS",
      integrationKey: "aws",
    });
    expect(Buffer.isBuffer(buf)).toBe(true);
    expect(buf.subarray(0, 5).toString()).toBe("%PDF-");

    const content = extractDecompressedText(buf);
    expect(content).toContain("Resource type:");
    expect(content).toContain("rds_instance");
    expect(content).toContain("Resource name:");
    expect(content).toContain("prod-1");
    expect(content).toContain("Region:");
    expect(content).toContain("us-east-1");
  });
});
