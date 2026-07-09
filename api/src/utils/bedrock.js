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
async function getXlsx()     { return (_xlsx     ??= await import("xlsx")); }
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

  if (["xlsx", "xls", "xlsm"].includes(fileExt)) {
    const { read, utils } = await getXlsx();
    const workbook = read(fs.readFileSync(filePath));
    const sheets = workbook.SheetNames.map(name => {
      const csv = utils.sheet_to_csv(workbook.Sheets[name]);
      return `--- Sheet: ${name} ---\n${csv}`;
    }).join("\n\n");
    const content = sheets.substring(0, MAX_CONTENT_CHARS);
    console.log(`[AI] Extracted ${content.length} chars from Excel (${workbook.SheetNames.length} sheets)`);
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

export async function analyzeEvidence({ evidenceName, evidenceType, questId, moduleId, requiredEvidence, filePath }) {
  console.log(`[AI] Analyzing evidence: ${evidenceName}`);
  console.log(`[AI] File path: ${filePath}`);
  console.log(`[AI] Evidence type: ${evidenceType}`);
  console.log(`[AI] Using Bedrock model: ${MODEL_ID}`);

  const metaBlock = `**Evidence Details:**
- Evidence Name: ${evidenceName || "N/A"}
- Type: ${evidenceType}
- Question ID: ${questId || "N/A"}
- Module ID: ${moduleId || "N/A"}
- Required Evidence per ISO 27001: ${requiredEvidence || "Not specified"}`;

  const taskBlock = `**Task:**
Evaluate whether this evidence adequately addresses the ISO 27001 compliance requirements.
Respond with ONLY a JSON object (no markdown fences) with these exact keys:
{
  "contributorComments": "feedback for the person who uploaded the evidence",
  "reviewerComments": "recommendation for the reviewer/approver",
  "gaps": ["array of identified gaps"],
  "suggestions": ["array of improvement suggestions"]
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
        suggestions: Array.isArray(parsed.suggestions) ? parsed.suggestions : []
      };
    } catch (parseError) {
      console.error(`[AI] JSON parse error:`, parseError.message);
      return {
        contributorComments: rawContent,
        reviewerComments: "AI provided unstructured feedback. See contributor comments.",
        gaps: [],
        suggestions: []
      };
    }
  } catch (error) {
    console.error(`[AI] Bedrock Error:`, error.message);
    throw new Error(`AI analysis failed: ${error.message}`);
  }
}
