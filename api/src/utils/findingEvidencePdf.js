import PDFDocument from "pdfkit";

/**
 * Renders a one-page PDF for a single failing security-test finding.
 *
 * @param {object} opts
 * @param {string}   opts.title            - Human-readable finding title (falls back to testKey).
 * @param {string}   opts.testKey          - Programmatic test identifier (e.g. "aws.iam.mfa_enforced").
 * @param {string}   opts.resourceId       - The specific resource that failed (e.g. "bucket-1", "account").
 * @param {string}   opts.severity         - "critical" | "high" | "medium" | "low".
 * @param {string|null} opts.message       - Human-readable description / explanation.
 * @param {object}   opts.evidencePayload  - Raw evidence collected by the connector (JSON-serialisable).
 * @param {string[]} opts.isoReferences    - ISO 27001 control references mapped to this test.
 * @param {string|null} opts.connectionName - Name of the integration connection that produced this finding.
 * @param {string|null} opts.integrationKey - Integration key (e.g. "aws").
 * @returns {Promise<Buffer>} Resolved with the complete PDF as a Buffer.
 */
export function renderFindingEvidencePdf({
  title,
  testKey,
  resourceId,
  severity,
  message,
  evidencePayload,
  isoReferences,
  connectionName,
  integrationKey,
}) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ margin: 50 });
    const chunks = [];
    doc.on("data", (chunk) => chunks.push(chunk));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);

    // ── Title + timestamp ─────────────────────────────────────────────────
    doc
      .fontSize(18)
      .font("Helvetica-Bold")
      .fillColor("#0f172a")
      .text(title || testKey);

    doc
      .fontSize(10)
      .font("Helvetica")
      .fillColor("#64748b")
      .text(`Generated ${new Date().toLocaleString("en-GB")}`);

    doc.moveDown();

    // ── Labeled field block ───────────────────────────────────────────────
    const field = (label, value) => {
      doc
        .fillColor("#0f172a")
        .font("Helvetica-Bold")
        .fontSize(11)
        .text(`${label}:`, { continued: true });
      doc.font("Helvetica").text(` ${value ?? "—"}`);
    };

    field("Severity", severity);
    field("Resource", resourceId);
    field("Test key", testKey);
    field(
      "ISO 27001 reference(s)",
      isoReferences && isoReferences.length ? isoReferences.join(", ") : "—"
    );
    field(
      "Source connection",
      `${connectionName || "—"} (${integrationKey || "—"})`
    );

    doc.moveDown();

    // ── Description ───────────────────────────────────────────────────────
    doc
      .fillColor("#0f172a")
      .font("Helvetica-Bold")
      .fontSize(12)
      .text("Description");

    doc
      .font("Helvetica")
      .fontSize(10)
      .fillColor("#334155")
      .text(message || "—");

    doc.moveDown();

    // ── Evidence payload (pretty-printed JSON) ────────────────────────────
    doc
      .fillColor("#0f172a")
      .font("Helvetica-Bold")
      .fontSize(12)
      .text("Evidence collected");

    doc
      .font("Courier")
      .fontSize(9)
      .fillColor("#334155")
      .text(JSON.stringify(evidencePayload ?? {}, null, 2));

    doc.end();
  });
}
