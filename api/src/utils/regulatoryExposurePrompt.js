// Shared prompt for aiProvider.mapRegulatoryExposure — used by both the
// Bedrock and Azure provider implementations so the wording can't drift.
//
// The self-assessment tool is fundamentally an India DPDP Act 2023 readiness
// check (its question bank is DPDPA-tagged), so the prompt makes DPDPA the
// primary lens: any personal-data gap must map to a DPDPA provision, with
// GDPR / ISO 27001 added on top where they also apply.

export function buildExposurePrompt({ departments = [], provisionIndex = {} }) {
  const deptBlock = departments.map(d => {
    const lines = [
      ...(d.gapQuestions || []).map(q => `  - [GAP id=${q.id}] ${q.text}`),
      ...(d.partialQuestions || []).map(q => `  - [PARTIAL id=${q.id}] ${q.text}`),
    ];
    return `${d.dept}:\n${lines.length ? lines.join("\n") : "  (no open items)"}`;
  }).join("\n\n");

  const indexBlock = Object.entries(provisionIndex)
    .map(([fw, provisions]) => `${fw}:\n${provisions.map(p => `  - id="${p.id}" — ${p.title}`).join("\n")}`)
    .join("\n\n");

  return `You map a company's open self-assessment items (unresolved "gaps" and "partial" controls, one department at a time) to the specific regulatory/standard provisions they put at risk.

CONTEXT: This is an India Digital Personal Data Protection Act, 2023 (DPDPA) readiness self-assessment. DPDPA is the PRIMARY framework. For every open item that touches personal data in any way — collection, notice, consent, purpose limitation, retention or erasure, security safeguards, breach detection or notification, children's data, data-principal rights (access / correction / erasure / grievance), processor/vendor agreements, or cross-border transfer — you MUST map it to the most relevant DPDPA provision from the index, and then ALSO map it to any GDPR or ISO/IEC 27001 provision that independently applies. Do not return a GDPR or ISO mapping for a personal-data item without also giving its DPDPA provision.

OPEN ITEMS BY DEPARTMENT:
${deptBlock}

PROVISION INDEX — the ONLY provisions you may cite. You MUST NOT invent an id that isn't listed here, and provisionId must be copied EXACTLY as given (including punctuation):
${indexBlock}

Rules:
- Be selective. For each open item, cite the SINGLE most directly relevant DPDPA provision, plus at most ONE GDPR article and at most ONE ISO/IEC 27001 control — only where each genuinely adds something a compliance auditor would cite for that specific gap. Do not map an item to every provision that is loosely related.
- Only cite a provision for a department if a real open item of that department's actually relates to it. Do not cite a provision just because the department exists.
- Cite the specific open-item id(s) responsible in relatedQuestionIds — never leave it empty.
- A provision may apply to several departments; list each department separately.
- rationale: one sentence explaining why these specific open items put this provision at risk.

Respond with ONLY valid JSON, no markdown fences:
{"mappings":[{"dept":"...","framework":"DPDPA|GDPR|ISO27001","provisionId":"...","rationale":"...","relatedQuestionIds":["..."]}]}`;
}

// Normalises a raw model response into the mapping list the router validates.
// Accepts {"mappings":[...]} (the asked-for shape) or a bare [...] array (a
// common way models loosen the schema).
export function normaliseMappings(parsed) {
  const list = Array.isArray(parsed) ? parsed
    : parsed && Array.isArray(parsed.mappings) ? parsed.mappings
    : null;
  if (!list) return null;
  return list.map(m => ({
    dept: String(m.dept ?? ""),
    framework: String(m.framework ?? ""),
    provisionId: String(m.provisionId ?? ""),
    rationale: String(m.rationale ?? ""),
    relatedQuestionIds: Array.isArray(m.relatedQuestionIds) ? m.relatedQuestionIds.map(String) : [],
  }));
}
