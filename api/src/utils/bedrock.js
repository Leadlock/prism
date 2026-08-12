import {
  BedrockRuntimeClient,
  ConverseCommand
} from "@aws-sdk/client-bedrock-runtime";
import fs from "fs";
import path from "path";

const client = new BedrockRuntimeClient({
  region: process.env.AWS_REGION || "eu-north-1",
  credentials: process.env.AWS_ACCESS_KEY_ID ? {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
    ...(process.env.AWS_SESSION_TOKEN ? { sessionToken: process.env.AWS_SESSION_TOKEN } : {})
  } : undefined
});

const MODEL_ID = process.env.BEDROCK_CHAT_MODEL || process.env.BEDROCK_MODEL_ID || "eu.amazon.nova-pro-v1:0";
const MAX_CONTENT_CHARS = 20000;

const IMAGE_TYPES = {
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  gif: "image/gif",
  webp: "image/webp"
};

// Lazy singletons — imported once on first use, cached thereafter.
let _pdfParse, _xlsx, _mammoth;
async function getPdfParse() { return (_pdfParse ??= (await import("pdf-parse/lib/pdf-parse.js")).default); }
async function getExcelJS()  { return (_xlsx     ??= (await import("exceljs")).default); }
async function getMammoth()  { return (_mammoth  ??= (await import("mammoth")).default); }

async function extractFileContent(filePath, fileExt) {
  if (["txt", "csv", "log", "json", "md", "html", "xml"].includes(fileExt)) {
    const content = fs.readFileSync(filePath, "utf8");
    return { type: "text", content: content.substring(0, MAX_CONTENT_CHARS) };
  }

  if (fileExt === "pdf") {
    const pdfParse = await getPdfParse();
    const buffer = fs.readFileSync(filePath);
    const data = await pdfParse(buffer);
    const text = data.text.trim().substring(0, MAX_CONTENT_CHARS);
    console.log(`[AI] Extracted ${text.length} chars from PDF (${data.numpages} pages)`);
    return { type: "text", content: text || "(PDF contained no extractable text)" };
  }

  if (["xlsx", "xlsm"].includes(fileExt)) {
    const ExcelJS = await getExcelJS();
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(fs.readFileSync(filePath));
    const sheets = wb.worksheets.map(ws => {
      const rows = [];
      ws.eachRow({ includeEmpty: true }, row => {
        const cells = [];
        row.eachCell({ includeEmpty: true }, cell => {
          let v = cell.value;
          if (v !== null && v !== undefined && typeof v === 'object') {
            if ('result' in v) v = v.result ?? '';
            else if ('richText' in v) v = v.richText.map(t => t.text).join('');
            else if (v instanceof Date) v = v.toISOString();
            else v = '';
          }
          const s = (v === null || v === undefined) ? '' : String(v);
          cells.push(s.includes(',') || s.includes('"') ? `"${s.replace(/"/g, '""')}"` : s);
        });
        rows.push(cells.join(','));
      });
      return `--- Sheet: ${ws.name} ---\n${rows.join('\n')}`;
    }).join("\n\n");
    const content = sheets.substring(0, MAX_CONTENT_CHARS);
    console.log(`[AI] Extracted ${content.length} chars from Excel (${wb.worksheets.length} sheets)`);
    return { type: "text", content };
  }

  if (fileExt === "docx") {
    const mammoth = await getMammoth();
    const result = await mammoth.extractRawText({ path: filePath });
    const content = result.value.trim().substring(0, MAX_CONTENT_CHARS);
    console.log(`[AI] Extracted ${content.length} chars from DOCX`);
    return { type: "text", content: content || "(DOCX contained no extractable text)" };
  }

  if (IMAGE_TYPES[fileExt]) {
    const buffer = fs.readFileSync(filePath);
    const base64 = buffer.toString("base64");
    console.log(`[AI] Loaded image (${fileExt}, ${Math.round(buffer.length / 1024)}KB) for vision`);
    return { type: "image", mediaType: IMAGE_TYPES[fileExt], base64 };
  }

  return { type: "text", content: `Unsupported file type: ${fileExt.toUpperCase()} — analyzing based on filename and metadata only.` };
}

function buildText(metaBlock, taskBlock, middle = "") {
  return [metaBlock, middle, taskBlock].filter(Boolean).join("\n\n");
}

export async function analyzeEvidence({ evidenceName, evidenceType, questId, moduleId, requiredEvidence, filePath, recurrenceInterval, today }) {
  console.log(`[AI] Analyzing evidence: ${evidenceName}`);
  console.log(`[AI] File path: ${filePath}`);
  console.log(`[AI] Evidence type: ${evidenceType}`);
  console.log(`[AI] Using Bedrock model: ${MODEL_ID}`);

  const intervalLabel = recurrenceInterval ? recurrenceInterval.toLowerCase() : null;
  const dateContext = intervalLabel && intervalLabel !== "none"
    ? `- Today's Date: ${today}\n- Control Recurrence: ${intervalLabel} (evidence must be refreshed at this cadence)`
    : `- Today's Date: ${today}`;

  const metaBlock = `**Evidence Details:**
- Evidence Name: ${evidenceName || "N/A"}
- Type: ${evidenceType}
- Question ID: ${questId || "N/A"}
- Module ID: ${moduleId || "N/A"}
- Required Evidence per ISO 27001: ${requiredEvidence || "Not specified"}
${dateContext}`;

  const dateInstruction = intervalLabel && intervalLabel !== "none"
    ? `4. DATE VALIDATION: Scan the document for any dates (creation date, review date, approval date, policy date, report date, etc.). Compare the most recent date found against today (${today}). Given the control recurrence is "${intervalLabel}", flag if the evidence appears expired or stale. If no dates are found in the document, note that dates could not be verified. Set "dateWarning" to null if evidence appears current, or to a concise warning string (e.g. "Policy last reviewed Jan 2023 — may be overdue for ${intervalLabel} refresh") if stale.`
    : `4. DATE VALIDATION: Scan the document for any dates. Set "dateWarning" to null if evidence appears current, or to a concise warning if you find dates suggesting the document is significantly out of date.`;

  const taskBlock = `**Task:**
Evaluate whether this evidence adequately addresses the ISO 27001 compliance requirements.
${dateInstruction}
Respond with ONLY a JSON object (no markdown fences) with these exact keys:
{
  "contributorComments": "feedback for the person who uploaded the evidence",
  "reviewerComments": "recommendation for the reviewer/approver",
  "gaps": ["array of identified gaps"],
  "suggestions": ["array of improvement suggestions"],
  "dateWarning": null
}`;

  let messageContent;

  if (evidenceType === "FILE" && filePath) {
    try {
      if (!fs.existsSync(filePath)) throw new Error(`File not found: ${filePath}`);
      const fileExt = path.extname(filePath).replace(".", "").toLowerCase();
      const extracted = await extractFileContent(filePath, fileExt);

      if (extracted.type === "image") {
        // Converse API image block uses format + bytes (not base64 string)
        const fmt = extracted.mediaType.split("/")[1]; // e.g. "jpeg", "png"
        messageContent = [
          { text: buildText(metaBlock, taskBlock, "Analyze the compliance document shown in this image.") },
          { image: { format: fmt, source: { bytes: Buffer.from(extracted.base64, "base64") } } }
        ];
      } else {
        messageContent = [{ text: buildText(metaBlock, taskBlock, `**File Content:**\n${extracted.content}`) }];
      }
    } catch (err) {
      console.error(`[AI] Error extracting file content:`, err.message);
      messageContent = [{ text: buildText(metaBlock, taskBlock, `Note: Could not extract file content — ${err.message}`) }];
    }
  } else if (evidenceType === "LINK") {
    messageContent = [{ text: buildText(metaBlock, taskBlock, "Evidence provided as external link.") }];
  } else {
    messageContent = [{ text: buildText(metaBlock, taskBlock) }];
  }

  console.log(`[AI] Sending request to Amazon Bedrock...`);

  try {
    const command = new ConverseCommand({
      modelId: MODEL_ID,
      messages: [{ role: "user", content: messageContent }],
      inferenceConfig: { maxTokens: 4096, temperature: 0.2 }
    });

    const response = await client.send(command);
    const rawContent = response.output?.message?.content?.[0]?.text || "";
    console.log(`[AI] Response preview: ${rawContent.substring(0, 200)}...`);

    try {
      const jsonMatch = rawContent.match(/```json\s*([\s\S]*?)\s*```/) || rawContent.match(/\{[\s\S]*\}/);
      const jsonStr = jsonMatch ? (jsonMatch[1] || jsonMatch[0]) : rawContent;
      const parsed = JSON.parse(jsonStr);
      return {
        contributorComments: parsed.contributorComments || "No contributor feedback generated",
        reviewerComments: parsed.reviewerComments || "No reviewer feedback generated",
        gaps: Array.isArray(parsed.gaps) ? parsed.gaps : [],
        suggestions: Array.isArray(parsed.suggestions) ? parsed.suggestions : [],
        dateWarning: parsed.dateWarning || null
      };
    } catch (parseError) {
      console.error(`[AI] JSON parse error:`, parseError.message);
      return {
        contributorComments: rawContent,
        reviewerComments: "AI provided unstructured feedback. See contributor comments.",
        gaps: [],
        suggestions: [],
        dateWarning: null
      };
    }
  } catch (error) {
    console.error(`[AI] Bedrock Error:`, error.message);
    throw new Error(`AI analysis failed: ${error.message}`);
  }
}

export async function suggestEvidence({ questionContext, vaultItems }) {
  if (!vaultItems.length) return [];

  const { questId, moduleName, controlArea, baselineQuestion, requiredEvidence, tags } = questionContext;

  const itemsList = vaultItems
    .map(v => `ID:${v.id} | "${v.title}"${v.description ? ` — ${v.description.substring(0, 120)}` : ""}`)
    .join("\n");

  const prompt = `You are a compliance evidence matcher. Given a compliance control question and a list of evidence items from a vault, identify which items are relevant.

**Compliance Control:**
- ID: ${questId}
- Module: ${moduleName || "N/A"}
- Control Area: ${controlArea || "N/A"}
- Question: ${baselineQuestion || "N/A"}
- Required Evidence: ${requiredEvidence || "N/A"}
- Tags: ${tags || "N/A"}

**Evidence Vault Items:**
${itemsList}

**Instructions:**
Score each item's relevance to this control from 0–100.
Return only items scoring 40 or above, up to 5 items.
Respond with ONLY a valid JSON array, no markdown fences, no explanation:
[{"vaultId":<number>,"relevanceScore":<number>,"reason":"<one sentence why relevant>"}]
If nothing scores 40+, return: []`;

  try {
    const command = new ConverseCommand({
      modelId: MODEL_ID,
      messages: [{ role: "user", content: [{ text: prompt }] }],
      inferenceConfig: { maxTokens: 1024, temperature: 0.1 }
    });
    const response = await client.send(command);
    const raw = response.output?.message?.content?.[0]?.text || "[]";
    console.log(`[AI] suggestEvidence response preview: ${raw.substring(0, 200)}`);

    const jsonMatch = raw.match(/\[[\s\S]*\]/);
    if (!jsonMatch) return [];

    const parsed = JSON.parse(jsonMatch[0]);
    if (!Array.isArray(parsed)) return [];

    return parsed
      .map(p => ({
        vaultId: parseInt(p.vaultId),
        relevanceScore: Math.min(100, Math.max(0, parseInt(p.relevanceScore) || 0)),
        reason: p.reason || "Relevant to this control",
      }))
      .filter(p => !isNaN(p.vaultId) && p.relevanceScore >= 40);
  } catch (error) {
    console.error(`[AI] Bedrock suggestEvidence error:`, error.message);
    throw new Error(`AI suggestion failed: ${error.message}`);
  }
}

export async function chatWithDocuments({ systemPrompt, history, message }) {
  console.log(`[AI] Vault chat — ${history.length} prior turns, query: "${message.substring(0, 80)}"`);

  const messages = [
    ...history.map(m => ({ role: m.role, content: [{ text: m.content }] })),
    { role: "user", content: [{ text: message }] }
  ];

  const command = new ConverseCommand({
    modelId: MODEL_ID,
    system: [{ text: systemPrompt }],
    messages,
    inferenceConfig: { maxTokens: 2048, temperature: 0.5 }
  });

  const response = await client.send(command);
  return response.output?.message?.content?.[0]?.text || "I couldn't generate a response. Please try again.";
}

export async function analyzePolicy({ policyName, filePath, fileExt }) {
  console.log(`[AI] analyzePolicy: ${policyName} (${fileExt})`);

  let extracted;
  try {
    if (!fs.existsSync(filePath)) throw new Error("File not found");
    extracted = await extractFileContent(filePath, fileExt);
  } catch (err) {
    extracted = { type: "text", content: `(Could not extract file content: ${err.message})` };
  }

  const contentSection = extracted.type === "image"
    ? "Analyze the policy document shown in this image."
    : `**Document Content:**\n${(extracted.content || "(No content extracted)").substring(0, 15000)}`;

  const prompt = `You are a compliance analyst. Evaluate this policy document for completeness and alignment with India's DPDPA (Digital Personal Data Protection Act 2023).

**Policy Name:** ${policyName}

${contentSection}

**Task:**
1. Assess how complete and production-ready this policy is.
2. Identify general gaps — missing sections, vague ownership, missing review dates, undefined scope.
3. Identify DPDPA-specific gaps — obligations under India's DPDPA 2023 not adequately addressed (e.g. consent mechanisms, data principal rights, breach notification timelines, data fiduciary obligations, retention & deletion, third-party processor controls, grievance redressal).
4. Provide 3–5 concrete improvement suggestions.

Respond with ONLY a valid JSON object, no markdown fences, no explanation:
{
  "readiness": "strong" | "adequate" | "incomplete" | "placeholder",
  "summary": "one sentence summary of the policy's current state",
  "gaps": ["up to 5 key gaps or missing sections"],
  "dpdpGaps": ["up to 4 DPDPA-specific obligations not addressed"],
  "suggestions": ["3 to 5 concrete improvement actions"]
}

Use "placeholder" if the document is a template with unfilled fields. Use "strong" only if the policy is genuinely comprehensive and DPDPA-aligned.`;

  let messageContent;
  if (extracted.type === "image") {
    const fmt = extracted.mediaType.split("/")[1];
    messageContent = [
      { text: prompt },
      { image: { format: fmt, source: { bytes: Buffer.from(extracted.base64, "base64") } } }
    ];
  } else {
    messageContent = [{ text: prompt }];
  }

  const command = new ConverseCommand({
    modelId: MODEL_ID,
    messages: [{ role: "user", content: messageContent }],
    inferenceConfig: { maxTokens: 2048, temperature: 0.2 }
  });

  const response = await client.send(command);
  const raw = response.output?.message?.content?.[0]?.text || "";
  console.log(`[AI] analyzePolicy response preview: ${raw.substring(0, 200)}`);

  try {
    const jsonMatch = raw.match(/```json\s*([\s\S]*?)\s*```/) || raw.match(/\{[\s\S]*\}/);
    const parsed = JSON.parse(jsonMatch ? (jsonMatch[1] || jsonMatch[0]) : raw);
    const VALID_READINESS = ["strong", "adequate", "incomplete", "placeholder"];
    return {
      readiness: VALID_READINESS.includes(parsed.readiness) ? parsed.readiness : "incomplete",
      summary: parsed.summary || "Analysis complete.",
      gaps: Array.isArray(parsed.gaps) ? parsed.gaps.slice(0, 6) : [],
      dpdpGaps: Array.isArray(parsed.dpdpGaps) ? parsed.dpdpGaps.slice(0, 5) : [],
      suggestions: Array.isArray(parsed.suggestions) ? parsed.suggestions.slice(0, 5) : [],
    };
  } catch {
    return { readiness: "incomplete", summary: raw.substring(0, 200), gaps: [], dpdpGaps: [], suggestions: [] };
  }
}

export { extractFileContent };
