import { describe, test, expect, vi } from "vitest";
import request from "supertest";
import ExcelJS from "exceljs";
import app from "../../app.js";
import { createCompany, createUser, createSuperAdmin } from "../setup/helpers.js";
import { query } from "../../db/index.js";

vi.mock("../../utils/scanFile.js", () => ({
  scanFile: vi.fn().mockResolvedValue({ safe: true }),
  scanBuffer: vi.fn().mockResolvedValue({ safe: true }),
}));
vi.mock("../../utils/notifyReviewers.js", () => ({
  notifyReviewers: vi.fn().mockResolvedValue(undefined),
}));

const AUDIT_HEADERS = [
  "Module Grouping", "Module ID", "Question ID", "Question Text", "Control Area",
  "GDPR Reference", "Owner", "Frequency", "Purpose / Description",
  "Audit-Ready Criteria", "Required Evidence",
];

/** One control → 3 facet rows, matching the real audit-ready sheet shape. */
function controlRows(prefix, area, ref) {
  return [
    ["PRISM", "G - Governance", `${prefix}-Q1`,
     `Is ${area} implemented, documented, and assigned to an accountable owner?`, area, ref,
     "DPO", "Annual", "purpose", "criteria", "policy pack"],
    ["PRISM", "G - Governance", `${prefix}-Q2`,
     `Can the organization provide current, dated evidence demonstrating operation of ${area}?`, area, ref,
     "DPO", "Annual", "purpose", "criteria", "policy pack"],
    ["PRISM", "G - Governance", `${prefix}-Q3`,
     `Is ${area} periodically reviewed or tested?`, area, ref,
     "DPO", "Annual", "purpose", "criteria", "policy pack"],
  ];
}

async function sheetBuffer(headers, rows) {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("GDPR Audit Framework");
  ws.addRow(headers);
  for (const r of rows) ws.addRow(r);
  return wb.xlsx.writeBuffer();
}

describe("framework import — superadmin", () => {
  test("import-modules with frameworkKey activates the framework and maps controls", async () => {
    const company = await createCompany({ domain: `fw-import-${Date.now()}.com` });
    const sa = await createSuperAdmin();

    const buf = await sheetBuffer(AUDIT_HEADERS, [
      ...controlRows("ACC", "Accountability framework", "Art. 5(2), 24"),
      ...controlRows("POL", "Data protection policies", "Art. 24"),
    ]);

    const res = await request(app)
      .post("/api/superadmin/import-modules")
      .set("Authorization", `Bearer ${sa.token}`)
      .attach("file", Buffer.from(buf), { filename: "PRISM_GDPR_Audit_Framework.xlsx" })
      .field("companyId", String(company.id))
      .field("frameworkKey", "GDPR");

    expect(res.status).toBe(200);
    expect(res.body.questionsImported).toBe(6);

    const cf = await query(
      "SELECT framework_key FROM company_frameworks WHERE company_id = $1",
      [company.id]
    );
    expect(cf.rows.map(r => r.framework_key)).toEqual(["GDPR"]);

    const qfc = await query(
      `SELECT DISTINCT control_reference FROM question_framework_controls
       WHERE company_id = $1 AND framework_key = 'GDPR' ORDER BY control_reference`,
      [company.id]
    );
    // iso_reference is stored raw at this phase; both controls mapped.
    expect(qfc.rows.map(r => r.control_reference)).toEqual(["Art. 24", "Art. 5(2), 24"]);

    const qs = await query("SELECT COUNT(*)::int AS n FROM questions WHERE company_id = $1", [company.id]);
    expect(qs.rows[0].n).toBe(6);
  });

  test("importing the same sheet twice is idempotent (no duplicate questions)", async () => {
    const company = await createCompany({ domain: `fw-import2-${Date.now()}.com` });
    const sa = await createSuperAdmin();
    const buf = await sheetBuffer(AUDIT_HEADERS, controlRows("ACC", "Accountability framework", "Art. 5(2)"));

    for (let i = 0; i < 2; i++) {
      const res = await request(app)
        .post("/api/superadmin/import-modules")
        .set("Authorization", `Bearer ${sa.token}`)
        .attach("file", Buffer.from(buf), { filename: "PRISM_GDPR_Audit_Framework.xlsx" })
        .field("companyId", String(company.id))
        .field("frameworkKey", "GDPR");
      expect(res.status).toBe(200);
    }
    const qs = await query("SELECT COUNT(*)::int AS n FROM questions WHERE company_id = $1", [company.id]);
    expect(qs.rows[0].n).toBe(3);
  });

  test("rejects an unknown framework key", async () => {
    const sa = await createSuperAdmin();
    const buf = await sheetBuffer(AUDIT_HEADERS, controlRows("ACC", "Accountability framework", "Art. 5(2)"));
    const res = await request(app)
      .post("/api/superadmin/import-modules")
      .set("Authorization", `Bearer ${sa.token}`)
      .attach("file", Buffer.from(buf), { filename: "sheet.xlsx" })
      .field("companyId", "1")
      .field("frameworkKey", "NOPE");
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/Unknown framework/i);
  });

  test("preview-import returns a framework guess from the filename", async () => {
    const sa = await createSuperAdmin();
    const buf = await sheetBuffer(AUDIT_HEADERS, controlRows("ACC", "Accountability framework", "Art. 5(2)"));
    const res = await request(app)
      .post("/api/superadmin/preview-import")
      .set("Authorization", `Bearer ${sa.token}`)
      .attach("file", Buffer.from(buf), { filename: "PRISM_GDPR_Audit_Framework.xlsx" });
    expect(res.status).toBe(200);
    expect(res.body.frameworkGuess).toBe("GDPR");
  });
});

describe("evidence AI analysis on the shared vault item", () => {
  // perTest truncates before every test, so each test builds its own fixture.
  async function seedEvidence(domain) {
    const company = await createCompany({ domain });
    const admin = await createUser(company.id, "ADMIN");
    await query(`INSERT INTO modules (module_id, company_id, name) VALUES ('M1', $1, 'Module 1')`, [company.id]);
    await query(
      `INSERT INTO questions (quest_id, company_id, module_id, control_area, baseline_question, required_evidence, priority)
       VALUES ('Q-EV-1', $1, 'M1', 'Access control', 'Is access reviewed?', 'Access review report', 'Medium')`,
      [company.id]
    );
    const up = await request(app)
      .post("/api/evidence")
      .set("Authorization", `Bearer ${admin.token}`)
      .attach("file", Buffer.from("access review Q1 2026"), { filename: "review.txt", contentType: "text/plain" })
      .field("questId", "Q-EV-1")
      .field("moduleId", "M1");
    expect(up.status).toBe(201);
    const v = await query("SELECT id FROM evidence_vault WHERE legacy_evidence_id = $1", [up.body.id]);
    return { company, admin, questId: "Q-EV-1", evidenceId: up.body.id, vaultId: v.rows[0].id };
  }

  test("POST /api/vault/:id/analyze writes analysis onto the vault row and GET /api/evidence surfaces it", async () => {
    const { admin, questId, evidenceId, vaultId } = await seedEvidence(`ev-ai-1-${Date.now()}.com`);

    const res = await request(app)
      .post(`/api/vault/${vaultId}/analyze`)
      .set("Authorization", `Bearer ${admin.token}`);
    expect(res.status).toBe(200);
    expect(res.body.aiReviewerComments).toMatch(/manual review/i);
    expect(res.body.aiAnalyzedAt).toBeTruthy();

    // evidence.ai_* is untouched; the vault row carries the analysis.
    const ev = await query("SELECT ai_reviewer_comments FROM evidence WHERE id = $1", [evidenceId]);
    expect(ev.rows[0].ai_reviewer_comments).toBeNull();

    const list = await request(app)
      .get(`/api/evidence?questId=${questId}`)
      .set("Authorization", `Bearer ${admin.token}`);
    expect(list.status).toBe(200);
    const rec = list.body.find(r => r.id === evidenceId);
    expect(rec.aiReviewerComments).toMatch(/manual review/i); // COALESCE from the vault
  });

  test("POST /api/evidence/:id/analyze dual-writes evidence + vault", async () => {
    const { admin, evidenceId, vaultId } = await seedEvidence(`ev-ai-2-${Date.now()}.com`);

    const res = await request(app)
      .post(`/api/evidence/${evidenceId}/analyze`)
      .set("Authorization", `Bearer ${admin.token}`);
    expect(res.status).toBe(200);
    expect(res.body.aiReviewerComments).toMatch(/manual review/i);

    const [ev, vault] = await Promise.all([
      query("SELECT ai_reviewer_comments FROM evidence WHERE id = $1", [evidenceId]),
      query("SELECT ai_analyzed_at FROM evidence_vault WHERE id = $1", [vaultId]),
    ]);
    expect(ev.rows[0].ai_reviewer_comments).toMatch(/manual review/i);
    expect(vault.rows[0].ai_analyzed_at).toBeTruthy();
  });
});
