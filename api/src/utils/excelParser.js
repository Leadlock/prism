import ExcelJS from 'exceljs';

/**
 * Parse an Excel workbook and extract modules + questions.
 *
 * Supports two formats:
 * 1. Combined format (single sheet): columns like "Module Grouping", "Module ID",
 *    "Question ID", "Question Text", etc. Modules are derived from unique Module IDs.
 * 2. Separate sheets: "Modules" sheet + "Questions" sheet with dedicated columns.
 *
 * @param {string} filePath - Path to the uploaded .xlsx file
 * @returns {Promise<{ modules: object[], questions: object[], errors: string[] }>}
 */
export async function parseExcelImport(filePath) {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile(filePath);
  const errors = [];

  const sheetNames = workbook.worksheets.map(ws => ws.name);

  // Check for separate "Modules" and "Questions" sheets
  const moduleSheetName = sheetNames.find(
    (name) => name.toLowerCase() === 'modules'
  );
  const questionSheetName = sheetNames.find(
    (name) => name.toLowerCase() === 'questions'
  );

  // If we have dedicated sheets, use the legacy parser
  if (moduleSheetName || questionSheetName) {
    return parseSeparateSheets(workbook, moduleSheetName, questionSheetName, errors);
  }

  // Otherwise, parse as combined format (single sheet with all data)
  return parseCombinedSheet(workbook, errors);
}

/**
 * Parse a combined single-sheet format where each row is a question
 * and modules are derived from unique "Module ID" values.
 *
 * Expected columns (flexible matching):
 * - Module Grouping / module_grouping
 * - Module ID / module_id
 * - Question ID / quest_id / Question_ID
 * - Question Text / baseline_question
 * - Control Area / control_area
 * - ISO / Clause Reference / iso_reference
 * - Owner / default_owner
 * - Frequency / frequency
 * - Purpose / Description / purpose
 * - Level 3 Criteria / level3_yes_criteria
 * - Required Evidence / required_evidence
 */
function parseCombinedSheet(workbook, errors) {
  const modules = [];
  const questions = [];
  const seenModules = new Map(); // module_id -> module object

  const worksheet = workbook.worksheets[0];
  if (!worksheet) {
    errors.push('No sheets found in workbook');
    return { modules, questions, errors };
  }

  const rows = sheetToJson(worksheet);

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    if (isEmptyRow(row)) continue;

    // Remove any empty-string keys (blank columns from Excel)
    const cleanRow = {};
    for (const [k, v] of Object.entries(row)) {
      if (k.trim()) cleanRow[k.trim()] = v;
    }

    // Extract module info
    const moduleId = getField(cleanRow, [
      'Module ID', 'module_id', 'ModuleID', 'Module_ID', 'moduleId'
    ]);
    const moduleGrouping = getField(cleanRow, [
      'Module Grouping', 'module_grouping', 'ModuleGrouping', 'Module_Grouping'
    ]);

    // Extract question info
    const questId = getField(cleanRow, [
      'Question ID', 'quest_id', 'QuestID', 'Quest_ID', 'questionId', 'Question_ID'
    ]);
    const questionText = getField(cleanRow, [
      'Question Text', 'baseline_question', 'BaselineQuestion', 'Baseline_Question', 'question_text'
    ]);
    const controlArea = getField(cleanRow, [
      'Control Area', 'control_area', 'ControlArea', 'Control_Area'
    ]);
    const isoRef = getField(cleanRow, [
      'ISO / Clause Reference', 'ISO/Clause Reference', 'iso_reference', 'ISOReference', 'ISO_Reference', 'Clause Reference', 'Framework Reference', 'framework_reference'
    ]);
    const owner = getField(cleanRow, [
      'Owner', 'default_owner', 'DefaultOwner', 'Default_Owner'
    ]);
    const frequency = getField(cleanRow, [
      'Frequency', 'frequency'
    ]);
    const purpose = getField(cleanRow, [
      'Purpose / Description', 'Purpose/Description', 'purpose', 'Purpose', 'Description'
    ]);
    const level3Criteria = getField(cleanRow, [
      'Level 3 Criteria', 'level3_yes_criteria', 'Level3YesCriteria', 'Level3_Yes_Criteria', 'Level 3 Yes Criteria'
    ]);
    const requiredEvidence = getField(cleanRow, [
      'Required Evidence', 'required_evidence', 'RequiredEvidence', 'Required_Evidence'
    ]);
    const priority = getField(cleanRow, [
      'Priority', 'priority', 'Risk Level', 'risk_level', 'RiskLevel'
    ]);
    const tags = getField(cleanRow, [
      'Tags', 'tags', 'Labels', 'labels', 'Categories', 'categories'
    ]);

    if (!questId) {
      errors.push(`Row ${i + 2}: missing Question ID`);
      continue;
    }
    if (!moduleId) {
      errors.push(`Row ${i + 2}: missing Module ID`);
      continue;
    }

    // Derive module from row (deduplicate by module_id)
    const modIdStr = String(moduleId).trim();
    if (!seenModules.has(modIdStr)) {
      seenModules.set(modIdStr, {
        module_id: modIdStr,
        name: modIdStr, // Use module ID as name (e.g., "P - Policies & Governance")
        primary_owner: String(owner || '').trim(),
        frequency: String(frequency || '').trim(),
        total_quests: 0,
        purpose: String(purpose || '').trim(),
        module_grouping: String(moduleGrouping || '').trim(),
      });
    }
    // Increment question count for this module
    seenModules.get(modIdStr).total_quests++;

    // Add question
    questions.push({
      quest_id: String(questId).trim(),
      module_id: modIdStr,
      module_name: modIdStr,
      control_area: String(controlArea || '').trim(),
      iso_reference: String(isoRef || '').trim(),
      baseline_question: String(questionText || '').trim(),
      level3_yes_criteria: String(level3Criteria || '').trim(),
      required_evidence: String(requiredEvidence || '').trim(),
      default_owner: String(owner || '').trim(),
      frequency: String(frequency || '').trim(),
      priority: String(priority || '').trim(),
      tags: String(tags || '').trim(),
    });
  }

  // Convert modules map to array
  for (const mod of seenModules.values()) {
    modules.push(mod);
  }

  return { modules, questions, errors };
}

/**
 * Parse separate "Modules" and "Questions" sheets (legacy format).
 */
function parseSeparateSheets(workbook, moduleSheetName, questionSheetName, errors) {
  const modules = [];
  const questions = [];

  const moduleSheet = moduleSheetName ? workbook.getWorksheet(moduleSheetName) : null;
  const questionSheet = questionSheetName
    ? workbook.getWorksheet(questionSheetName)
    : (!moduleSheetName ? workbook.worksheets[0] : null);

  // Parse modules sheet
  if (moduleSheet) {
    const rows = sheetToJson(moduleSheet);
    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      if (isEmptyRow(row)) continue;

      const moduleId = getField(row, ['module_id', 'ModuleID', 'Module_ID', 'moduleId', 'Module ID']);
      if (!moduleId) {
        errors.push(`Modules sheet row ${i + 2}: missing module_id`);
        continue;
      }

      modules.push({
        module_id: String(moduleId).trim(),
        name: String(getField(row, ['name', 'Name', 'module_name', 'ModuleName']) || '').trim(),
        primary_owner: String(getField(row, ['primary_owner', 'PrimaryOwner', 'primaryOwner', 'Owner']) || '').trim(),
        frequency: String(getField(row, ['frequency', 'Frequency']) || '').trim(),
        total_quests: parseInt(getField(row, ['total_quests', 'TotalQuests', 'totalQuests']) || 0),
        purpose: String(getField(row, ['purpose', 'Purpose', 'Purpose / Description']) || '').trim(),
      });
    }
  }

  // Parse questions sheet
  if (questionSheet) {
    const rows = sheetToJson(questionSheet);
    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      if (isEmptyRow(row)) continue;

      const questId = getField(row, ['quest_id', 'QuestID', 'Quest_ID', 'questId', 'Question ID']);
      const moduleId = getField(row, ['module_id', 'ModuleID', 'Module_ID', 'moduleId', 'Module ID']);

      if (!questId) {
        errors.push(`Questions sheet row ${i + 2}: missing quest_id`);
        continue;
      }
      if (!moduleId) {
        errors.push(`Questions sheet row ${i + 2}: missing module_id`);
        continue;
      }

      questions.push({
        quest_id: String(questId).trim(),
        module_id: String(moduleId).trim(),
        module_name: String(getField(row, ['module_name', 'ModuleName', 'Module_Name']) || '').trim(),
        control_area: String(getField(row, ['control_area', 'ControlArea', 'Control Area']) || '').trim(),
        iso_reference: String(getField(row, ['iso_reference', 'ISOReference', 'ISO / Clause Reference']) || '').trim(),
        baseline_question: String(getField(row, ['baseline_question', 'BaselineQuestion', 'Question Text']) || '').trim(),
        level3_yes_criteria: String(getField(row, ['level3_yes_criteria', 'Level3YesCriteria', 'Level 3 Criteria']) || '').trim(),
        required_evidence: String(getField(row, ['required_evidence', 'RequiredEvidence', 'Required Evidence']) || '').trim(),
        default_owner: String(getField(row, ['default_owner', 'DefaultOwner', 'Owner']) || '').trim(),
        frequency: String(getField(row, ['frequency', 'Frequency']) || '').trim(),
        priority: String(getField(row, ['priority', 'Priority', 'Risk Level', 'risk_level']) || '').trim(),
        tags: String(getField(row, ['tags', 'Tags', 'Labels', 'labels', 'Categories']) || '').trim(),
      });
    }
  }

  return { modules, questions, errors };
}

/**
 * Convert an ExcelJS worksheet to an array of row objects, replicating
 * XLSX.utils.sheet_to_json(sheet, { defval: '' }): row 1 = headers,
 * subsequent rows = objects keyed by header, missing cells default to ''.
 */
function sheetToJson(worksheet) {
  const headers = [];
  const rows = [];

  worksheet.eachRow({ includeEmpty: true }, (row, rowNumber) => {
    if (rowNumber === 1) {
      row.eachCell({ includeEmpty: true }, (cell, colNumber) => {
        headers[colNumber] = getCellValue(cell);
      });
      return;
    }
    const obj = {};
    // Pre-fill all header keys with defval ''
    for (let c = 1; c < headers.length; c++) {
      const h = headers[c];
      if (h !== undefined && h !== '') obj[String(h)] = '';
    }
    row.eachCell({ includeEmpty: true }, (cell, colNumber) => {
      const h = headers[colNumber];
      if (h !== undefined && h !== '') {
        obj[String(h)] = getCellValue(cell);
      }
    });
    rows.push(obj);
  });

  return rows;
}

/**
 * Normalise an ExcelJS cell value to a plain JS primitive.
 * Formula cells return their cached result; null/undefined return ''.
 */
function getCellValue(cell) {
  const v = cell.value;
  if (v === null || v === undefined) return '';
  if (typeof v === 'object') {
    if (v instanceof Date) return v;
    if ('result' in v) return v.result ?? '';
    if ('richText' in v) return v.richText.map(t => t.text).join('');
    return String(v);
  }
  return v;
}

/**
 * Get a field value from a row using multiple possible header names.
 */
function getField(row, keys) {
  for (const key of keys) {
    if (row[key] !== undefined && row[key] !== '') {
      return row[key];
    }
  }
  return undefined;
}

/**
 * Check if a row is effectively empty.
 */
function isEmptyRow(row) {
  return Object.values(row).every(
    (val) => val === '' || val === undefined || val === null
  );
}
