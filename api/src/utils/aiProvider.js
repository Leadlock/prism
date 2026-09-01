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
  async clusterQuestions(args) {
    return deterministicCluster(args);
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

/**
 * Cluster incoming framework-import questions against the existing canonical set.
 *
 * @param {{ provider?:string, incoming:Array, existing:Array }} args
 *   incoming: [{ tempId, frameworkKey, moduleId, controlArea, controlReference, question, level3, requiredEvidence, facet }]
 *   existing: [{ questId, moduleId, controlArea, question, frameworks:[{key,ref}] }]
 * @returns {Promise<{ clusters: Array<{ memberTempIds:string[], action:string,
 *   existingQuestId?:string|null, canonicalQuestion:string, level3:string,
 *   confidence:number, rationale:string, matchMethod:string }> }>}
 */
const CLUSTER_CHUNK = 30;
const MAX_CLUSTER_MEMBERS = 6; // a control has ~3 facet rows; >6 in one bucket ⇒ the model over-merged

/**
 * A control legitimately produces ~3 rows, so reject any LLM response that dumps
 * a whole chunk into one bucket or produces an oversized cluster.
 */
export function validClusterResponse(out, chunkLen) {
  if (!out || !Array.isArray(out.clusters) || out.clusters.length === 0) return null;
  const sizes = out.clusters.map(c => (c.memberTempIds || []).length);
  const max = Math.max(...sizes);
  if (max > MAX_CLUSTER_MEMBERS) return null;
  if (chunkLen >= 4 && out.clusters.length === 1 && max >= chunkLen) return null;
  return out;
}

export async function clusterQuestions(args) {
  const { provider, rest } = splitProvider(args);
  const incoming = Array.isArray(rest.incoming) ? rest.incoming : [];
  if (incoming.length === 0) return { clusters: [] };
  const existing = rest.existing || [];
  const { name, module: m } = await loadProvider(provider);
  const hasLLM = typeof m.clusterQuestions === "function";

  const chunks = [];
  for (let i = 0; i < incoming.length; i += CLUSTER_CHUNK) chunks.push(incoming.slice(i, i + CLUSTER_CHUNK));

  const all = [];
  const placed = new Set();
  for (const chunk of chunks) {
    let out = null;
    if (hasLLM) {
      try {
        out = validClusterResponse(await m.clusterQuestions({ incoming: chunk, existing }), chunk.length);
        if (!out) console.warn(`[AI] clusterQuestions (${name}) gave a degenerate response — deterministic for this chunk`); // nosemgrep
      } catch (e) {
        console.warn(`[AI] clusterQuestions failed (${name}), deterministic for this chunk:`, e.message); // nosemgrep
      }
    }
    const use = out || deterministicCluster({ incoming: chunk, existing });
    for (const c of use.clusters) {
      const ids = (c.memberTempIds || [])
        .map(String)
        .filter(id => chunk.some(q => String(q.tempId) === id) && !placed.has(id));
      if (!ids.length) continue;
      ids.forEach(id => placed.add(id));
      all.push({ ...c, memberTempIds: ids });
    }
  }

  // Anything the clusterer dropped becomes its own deterministic cluster.
  const missing = incoming.filter(q => !placed.has(String(q.tempId)));
  if (missing.length) {
    for (const c of deterministicCluster({ incoming: missing, existing }).clusters) all.push(c);
  }
  return { clusters: all };
}

// ─── Deterministic question clustering (the "none" provider + universal fallback) ──

const FACET_RE = [
  /\bimplemented,?\s*(formally\s+)?documented,?\s*and\s+assigned\b.*/i,
  /\bcan\s+(the\s+)?(organi[sz]ation|owner)\s+provide\b.*/i,
  /\bprovide\s+current,?\s*dated\s+evidence\b.*/i,
  /\bis\s+.+\s+periodically\s+reviewed\b.*/i,
  /\breviewed\s+(or\s+\w+\s+)?(at\s+the\s+)?(required|defined)\s+frequency\b.*/i,
  /\brate\s+the\s+maturity\b.*/i,
];

function normText(s) {
  return String(s || "").trim().toLowerCase().replace(/\s+/g, " ");
}

function tokenSet(s) {
  return new Set(
    normText(s).split(/[^a-z0-9]+/).filter(w => w.length > 2 && !STOP_WORDS.has(w))
  );
}

function jaccard(a, b) {
  if (!a.size || !b.size) return 0;
  let inter = 0;
  for (const t of a) if (b.has(t)) inter++;
  return inter / (a.size + b.size - inter);
}

/** Collapse the facet boilerplate ("Is X implemented, documented and assigned…") into a control name. */
function stripFacet(question) {
  let q = String(question || "").trim();
  const lead = q.match(/^(is|are|can|does|do|has|have)\s+(the\s+)?/i);
  if (lead) q = q.slice(lead[0].length);
  for (const re of FACET_RE) q = q.replace(re, "").trim();
  q = q.replace(/[?.\s]+$/, "").trim();
  return q;
}

function canonicalQuestionFor(members) {
  const area = members.map(m => m.controlArea).find(Boolean)
    || members.map(m => stripFacet(m.question)).find(Boolean)
    || "this control";
  return `Is ${area} implemented, operating effectively, evidenced, and periodically reviewed?`;
}

function bestLevel3(members) {
  return members.map(m => m.level3 || "").sort((a, b) => b.length - a.length)[0] || "";
}

export function deterministicCluster({ incoming = [], existing = [] } = {}) {
  // 1. Group incoming rows that describe the same control. Staging has already
  //    collapsed each control's facet rows, so here we only merge rows whose
  //    control AREA is the same (exact) or near-identical (token Jaccard ≥ 0.9).
  //    A shared clause reference alone is NOT enough — frameworks reuse a ref
  //    (e.g. SOC2 CC1.1) across several distinct controls.
  const groups = [];
  const areaTokens = incoming.map(q => tokenSet(q.controlArea));

  for (let i = 0; i < incoming.length; i++) {
    const q = incoming[i];
    let g = groups.find(grp => {
      const rep = grp.members[0];
      if (normText(rep.controlArea) && normText(rep.controlArea) === normText(q.controlArea)) return true;
      if (rep.frameworkKey === q.frameworkKey
          && normText(rep.controlReference) && normText(rep.controlReference) === normText(q.controlReference)
          && jaccard(areaTokens[grp.repIndex], areaTokens[i]) >= 0.6) return true;
      return normText(q.controlArea).length > 0 && jaccard(areaTokens[grp.repIndex], areaTokens[i]) >= 0.9;
    });
    if (!g) { g = { members: [], repIndex: i }; groups.push(g); }
    g.members.push(q);
  }

  // 2. For each group, try to match an existing canonical question.
  const existTokens = existing.map(e => tokenSet(e.controlArea || e.question));
  const clusters = groups.map(grp => {
    const members = grp.members;
    const memberTempIds = members.map(m => m.tempId);
    const gTokens = tokenSet(members[0].controlArea || members[0].question);

    let match = null;
    let matchScore = 0;
    for (let j = 0; j < existing.length; j++) {
      const e = existing[j];
      const exactArea = normText(e.controlArea) && normText(e.controlArea) === normText(members[0].controlArea);
      const exactQ = normText(e.question) && members.some(m => normText(m.question) === normText(e.question));
      const sim = jaccard(existTokens[j], gTokens);
      const score = exactArea || exactQ ? 0.92 : (sim >= 0.85 ? 0.72 : 0);
      if (score > matchScore) { matchScore = score; match = e; }
    }

    if (match) {
      return {
        memberTempIds,
        action: "MERGE_INTO_EXISTING",
        existingQuestId: match.questId,
        canonicalQuestion: match.question || canonicalQuestionFor(members),
        level3: bestLevel3(members),
        confidence: matchScore,
        rationale: matchScore >= 0.9
          ? `Same control area as existing canonical "${match.questId}".`
          : `High wording overlap with existing canonical "${match.questId}".`,
        matchMethod: "fingerprint",
      };
    }

    const frameworks = [...new Set(members.map(m => m.frameworkKey))];
    return {
      memberTempIds,
      action: "NEW_CANONICAL",
      existingQuestId: null,
      canonicalQuestion: canonicalQuestionFor(members),
      level3: bestLevel3(members),
      confidence: members.length > 1 ? 0.8 : 0.6,
      rationale: members.length > 1
        ? `${members.length} rows${frameworks.length > 1 ? ` across ${frameworks.join(", ")}` : ""} describe one control — collapsed.`
        : `Single control with no existing canonical match.`,
      matchMethod: "fingerprint",
    };
  });

  return { clusters };
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
