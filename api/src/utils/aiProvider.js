/**
 * AI Provider abstraction layer.
 *
 * Set PRISM_AI_PROVIDER to choose the backend:
 *   bedrock  (default) — AWS Bedrock via ConverseCommand
 *   azure              — Azure AI Agent (threads/runs)
 *   none               — keyword-only fallback, no LLM calls
 *
 * Each provider module must export:
 *   analyzeEvidence({ evidenceName, evidenceType, questId, moduleId, requiredEvidence, filePath })
 *   suggestEvidence({ questionContext, vaultItems })  — optional; falls back to keywordSuggest
 */

const PROVIDER = (process.env.PRISM_AI_PROVIDER || "bedrock").toLowerCase();

let _provider = null;

async function loadProvider() {
  if (_provider) return _provider;
  if (PROVIDER === "azure") {
    _provider = await import("./azureOpenAI.js");
  } else if (PROVIDER === "none") {
    _provider = {};
  } else {
    _provider = await import("./bedrock.js");
  }
  return _provider;
}

export async function analyzeEvidence(args) {
  const m = await loadProvider();
  if (typeof m.analyzeEvidence !== "function") {
    throw new Error(`AI provider "${PROVIDER}" does not support analyzeEvidence`);
  }
  return m.analyzeEvidence(args);
}

export async function chatWithDocuments(args) {
  const m = await loadProvider();
  if (typeof m.chatWithDocuments !== "function") {
    throw new Error(`AI provider "${PROVIDER}" does not support chatWithDocuments`);
  }
  return m.chatWithDocuments(args);
}

export async function suggestEvidence(args) {
  const m = await loadProvider();
  if (typeof m.suggestEvidence === "function") {
    try {
      return await m.suggestEvidence(args);
    } catch (e) {
      console.warn(`[AI] suggestEvidence failed (${PROVIDER}), falling back to keyword match:`, e.message); // nosemgrep
      return keywordSuggest(args);
    }
  }
  return keywordSuggest(args);
}

// ─── Keyword fallback ────────────────────────────────────────────────────────

const STOP_WORDS = new Set([
  "with", "that", "this", "have", "from", "they", "will", "been", "were",
  "their", "there", "which", "when", "what", "your", "into", "than", "then",
  "also", "does", "each", "more", "must", "some", "such", "used", "where",
]);

function keywordSuggest({ questionContext, vaultItems }) {
  const { baselineQuestion = "", requiredEvidence = "", tags = "", controlArea = "", moduleName = "" } = questionContext;

  const corpus = [baselineQuestion, requiredEvidence, tags, controlArea, moduleName]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();

  const words = [
    ...new Set(
      corpus.split(/\W+/).filter(w => w.length > 3 && !STOP_WORDS.has(w))
    ),
  ];

  if (!words.length) return [];

  return vaultItems
    .map(v => {
      const text = `${v.title} ${v.description || ""}`.toLowerCase();
      const matches = words.filter(w => text.includes(w));
      const score = Math.min(95, matches.length * 18);
      if (score < 30) return null;
      return {
        vaultId: v.id,
        relevanceScore: score,
        reason: `Keyword match: ${matches.slice(0, 4).join(", ")}`,
      };
    })
    .filter(Boolean)
    .sort((a, b) => b.relevanceScore - a.relevanceScore)
    .slice(0, 5);
}
