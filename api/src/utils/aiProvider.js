/**
 * AI Provider abstraction layer.
 *
 * Set PRISM_AI_PROVIDER to choose the backend:
 *   bedrock  (default) — AWS Bedrock via ConverseCommand
 *   azure              — Azure AI Agent (threads/runs)
 *   none               — no LLM calls: suggestEvidence uses keyword matching,
 *                        the analysis functions return empty "not configured" results
 *
 * A per-company override (company_settings.ai_provider) can be threaded through
 * any call as an optional `provider` arg; it wins over PRISM_AI_PROVIDER.
 *
 * Each provider module must export:
 *   analyzeEvidence({ evidenceName, evidenceType, questId, moduleId, requiredEvidence, filePath })
 *   suggestEvidence({ questionContext, vaultItems })  — optional; falls back to keywordSuggest
 */

const ENV_PROVIDER = (process.env.PRISM_AI_PROVIDER || "bedrock").toLowerCase();

// Provider modules are cached per resolved name so a process serving companies
// on different providers loads each backend at most once.
const _cache = new Map();

// Resolve a provider name: an explicit per-company override wins, otherwise the
// process-wide PRISM_AI_PROVIDER default. Anything unrecognised falls back to
// bedrock (the historical default) rather than erroring.
function resolveProviderName(override) {
  const name = (override || ENV_PROVIDER || "bedrock").toLowerCase();
  return ["bedrock", "azure", "none"].includes(name) ? name : "bedrock";
}

const NOT_CONFIGURED_MSG =
  "AI analysis is not configured for this deployment. Set PRISM_AI_PROVIDER (and the matching provider credentials) to enable automated review.";

// The "none" provider — no LLM calls. Analysis functions return valid, empty
// results (never throw) so the UI degrades to a clear "not configured" state.
// suggestEvidence is intentionally omitted so callers fall through to
// keywordSuggest.
const NONE_PROVIDER = {
  async analyzeEvidence() {
    return {
      contributorComments: NOT_CONFIGURED_MSG,
      reviewerComments: "AI not configured — this evidence needs manual review.",
      gaps: [],
      suggestions: [],
      dateWarning: null,
    };
  },
  async analyzePolicy() {
    return {
      readiness: "incomplete",
      summary: NOT_CONFIGURED_MSG,
      gaps: [],
      dpdpGaps: [],
      suggestions: [],
    };
  },
  async chatWithDocuments() {
    return NOT_CONFIGURED_MSG;
  },
};

async function loadProvider(override) {
  const name = resolveProviderName(override);
  if (_cache.has(name)) return { name, module: _cache.get(name) };
  let mod;
  if (name === "azure") {
    mod = await import("./azureOpenAI.js");
  } else if (name === "none") {
    mod = NONE_PROVIDER;
  } else {
    mod = await import("./bedrock.js");
  }
  _cache.set(name, mod);
  return { name, module: mod };
}

// Pull the per-call provider override out of the args object so it never reaches
// the concrete provider module.
function splitProvider(args) {
  const { provider, ...rest } = args || {};
  return { provider, rest };
}

export async function analyzeEvidence(args) {
  const { provider, rest } = splitProvider(args);
  const { name, module: m } = await loadProvider(provider);
  if (typeof m.analyzeEvidence !== "function") {
    throw new Error(`AI provider "${name}" does not support analyzeEvidence`);
  }
  return m.analyzeEvidence(rest);
}

export async function chatWithDocuments(args) {
  const { provider, rest } = splitProvider(args);
  const { name, module: m } = await loadProvider(provider);
  if (typeof m.chatWithDocuments !== "function") {
    throw new Error(`AI provider "${name}" does not support chatWithDocuments`);
  }
  return m.chatWithDocuments(rest);
}

export async function analyzePolicy(args) {
  const { provider, rest } = splitProvider(args);
  const { name, module: m } = await loadProvider(provider);
  if (typeof m.analyzePolicy !== "function") {
    throw new Error(`AI provider "${name}" does not support analyzePolicy`);
  }
  return m.analyzePolicy(rest);
}

export async function suggestEvidence(args) {
  const { provider, rest } = splitProvider(args);
  const { name, module: m } = await loadProvider(provider);
  if (typeof m.suggestEvidence === "function") {
    try {
      return await m.suggestEvidence(rest);
    } catch (e) {
      console.warn(`[AI] suggestEvidence failed (${name}), falling back to keyword match:`, e.message); // nosemgrep
      return keywordSuggest(rest);
    }
  }
  return keywordSuggest(rest);
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
        matchType: "keyword",
      };
    })
    .filter(Boolean)
    .sort((a, b) => b.relevanceScore - a.relevanceScore)
    .slice(0, 5);
}
