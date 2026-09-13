import { describe, test, expect, beforeAll } from "vitest";
import JSZip from "jszip";
import { buildSelfAssessmentReport } from "../utils/selfAssessmentReport.js";
import { buildReadinessDocx, docxHtmlFromDocument, DOCX_MIME } from "../utils/selfAssessmentDocx.js";

function sub(department, userEmail, answers) {
  return { department, userEmail, userName: userEmail, answers, submittedAt: new Date().toISOString() };
}

const submissions = [
  sub("IT", "it@co.com", { "it-1": "NO", "it-8": "NO", "it-12": "NO", "it-11": "NO", "it-15": "NO", "lg-6": "NO" }),
  sub("Legal", "lg@co.com", { "lg-2": "PARTIAL", "lg-3": "YES" }),
];

describe("docxHtmlFromDocument — the HTML transform", () => {
  const report = buildSelfAssessmentReport({ companyName: "Acme Ltd", submissions, aiExposureMappings: [], narrative: null });
  const html = docxHtmlFromDocument(report.document, { companyName: "Acme Ltd" });

  test("strips the browser-only furniture", () => {
    expect(html).not.toContain("PagedConfig");
    expect(html).not.toContain("<script");
    expect(html).not.toContain('class="watermark"');
    expect(html).not.toContain('class="toolbar');
    expect(html).not.toContain('class="running-header"');
  });

  test("keeps the report content", () => {
    expect(html).toContain("Acme Ltd");
    expect(html).toContain("Findings Register");
    expect(html).toContain("Annexure G");
    expect(html).toContain("Document Control");
  });

  test("inserts a page break before every section except the cover", () => {
    const sections = (html.match(/<section/g) || []).length;
    const breaks = (html.match(/page-break-after:always/g) || []).length;
    expect(sections).toBeGreaterThan(15);
    expect(breaks).toBe(sections - 1);
  });

  test("rasterises the inline <svg> charts to PNG <img>", () => {
    expect(html).not.toContain("<svg");
    // both dashboard charts become embedded PNGs (plus the cover logo → 3)
    expect((html.match(/<img [^>]*src="data:image\/png;base64,/g) || []).length).toBeGreaterThanOrEqual(3);
  });
});

describe("buildReadinessDocx — the .docx", () => {
  let buf, docXml;

  beforeAll(async () => {
    const report = buildSelfAssessmentReport({ companyName: "Acme Ltd", submissions, aiExposureMappings: [], narrative: null });
    buf = await buildReadinessDocx(report, { companyName: "Acme Ltd" });
    const zip = await JSZip.loadAsync(buf);
    docXml = await zip.file("word/document.xml").async("string");
  }, 30000);

  test("returns a non-trivial Buffer that is a valid docx zip", async () => {
    expect(Buffer.isBuffer(buf)).toBe(true);
    expect(buf.length).toBeGreaterThan(20_000);
    const zip = await JSZip.loadAsync(buf);
    expect(zip.file("word/document.xml")).toBeTruthy();
    expect(zip.file("word/header1.xml")).toBeTruthy();
    expect(zip.file("word/footer1.xml")).toBeTruthy();
  });

  test("carries the report content, tables and section page breaks", () => {
    expect(docXml).toContain("Acme Ltd");
    expect(docXml).toContain("Findings Register");
    expect(docXml).toContain("Annexure G");
    expect((docXml.match(/<w:tbl>/g) || []).length).toBeGreaterThan(25);
    expect((docXml.match(/<w:br w:type="page"\/>/g) || []).length).toBeGreaterThan(15);
  });

  test("running header names the company; footer has a page-number field", async () => {
    const zip = await JSZip.loadAsync(buf);
    const header = await zip.file("word/header1.xml").async("string");
    const footer = await zip.file("word/footer1.xml").async("string");
    expect(header).toContain("Acme Ltd");
    expect(footer).toContain("Neozaar Digital Private Limited");
    expect(footer).toContain("PAGE");
  });

  test("rejects a report with no document", async () => {
    await expect(buildReadinessDocx({})).rejects.toThrow(/document is required/);
  });

  test("exports the Word MIME type", () => {
    expect(DOCX_MIME).toBe("application/vnd.openxmlformats-officedocument.wordprocessingml.document");
  });
});
