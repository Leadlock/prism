import { describe, test, expect } from "vitest";
import { renderFindingEvidencePdf } from "../utils/findingEvidencePdf.js";

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
});
