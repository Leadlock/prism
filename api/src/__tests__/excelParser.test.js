import { describe, test, expect, afterEach } from "vitest";
import fs from "fs";
import os from "os";
import path from "path";
import { fileURLToPath } from "url";
import ExcelJS from "exceljs";
import { parseExcelImport } from "../utils/excelParser.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const tmpFiles = [];

function tmpPath(name) {
  const p = path.join(os.tmpdir(), `xp-${Date.now()}-${Math.random().toString(16).slice(2)}-${name}`);
  tmpFiles.push(p);
  return p;
}

afterEach(() => {
  while (tmpFiles.length) fs.rmSync(tmpFiles.pop(), { force: true });
});

async function writeValidWorkbook() {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("Sheet1");
  ws.addRow(["Module ID", "Question ID", "Question Text"]);
  ws.addRow(["P - Policies", "P-1", "Is there an information security policy?"]);
  const p = tmpPath("valid.xlsx");
  await wb.xlsx.writeFile(p);
  return p;
}

describe("parseExcelImport", () => {
  test("parses a normal .xlsx workbook", async () => {
    const p = await writeValidWorkbook();
    const parsed = await parseExcelImport(p);
    expect(parsed.questions).toHaveLength(1);
    expect(parsed.questions[0].quest_id).toBe("P-1");
    expect(parsed.modules).toHaveLength(1);
  });

  test("recovers a Strict Open XML Spreadsheet that ExcelJS can't read directly", async () => {
    // Fixture: workbook using the ISO-Strict namespace + a prefixed <x:workbook>
    // root — ExcelJS bails with a bare "reading 'sheets'"; the normaliser rescues it.
    // Header row: "Module ID" | "Question ID"; data row: "P - Policies" | "P-1".
    const fixture = path.join(__dirname, "fixtures", "strict-ooxml.xlsx");
    const parsed = await parseExcelImport(fixture);
    expect(parsed.questions).toHaveLength(1);
    expect(parsed.questions[0].quest_id).toBe("P-1");
    expect(parsed.questions[0].module_id).toBe("P - Policies");
    expect(parsed.modules).toHaveLength(1);
  });

  test("rejects a non-xlsx file saved with an .xlsx extension", async () => {
    const p = tmpPath("fake.xlsx");
    fs.writeFileSync(p, "col1,col2\n1,2\n");
    await expect(parseExcelImport(p)).rejects.toMatchObject({
      status: 400,
      message: expect.stringMatching(/not a readable \.xlsx workbook/i),
    });
  });

  test("rejects an unrecoverable workbook with an actionable 400", async () => {
    // A zip that looks like an xlsx but has a workbook.xml ExcelJS can't model
    // and the normaliser can't fix — the friendly Strict message still fires.
    const fixture = path.join(__dirname, "fixtures", "strict-unrecoverable.xlsx");
    await expect(parseExcelImport(fixture)).rejects.toMatchObject({
      status: 400,
      message: expect.stringMatching(/Strict Open XML Spreadsheet/i),
    });
  });
});
