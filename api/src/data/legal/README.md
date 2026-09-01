# Regulatory provision index

These three JSON files are the **only source of citation text** (`title`, `url`,
`penalty`) that the self-assessment regulatory-exposure feature is allowed to show.
`mapRegulatoryExposure` (see `api/src/utils/aiProvider.js`) sends the relevant file's
contents to the model and asks it to choose provision `id`s from what's here — the
model's own text for `title`/`url`/`penalty` is discarded even if it echoes one back;
those three fields are always looked up from these files after the model responds. If a
model-returned `id` doesn't exist in the matching file, the mapping is dropped.

This makes these files the compliance-content equivalent of a schema: **wrong or stale
data here produces wrong citations everywhere downstream.** Treat edits like you would a
migration — they should be deliberate and reviewed, not "AI seemed confident so I typed
it."

## Provenance / confidence per file

- **`gdpr.json`** — article numbers and official titles verified live against
  eur-lex.europa.eu (CELEX 32016R0679) during authoring. High confidence. `url` points to
  the single official EUR-Lex consolidated-text page for all articles (EUR-Lex doesn't
  expose a stable per-article anchor scheme, so the article number lives in `id`/`title`,
  not the URL fragment).
- **`dpdpa-2023.json`** — section numbers are consolidated from the citations already
  hand-authored in `api/src/scanner/rules.js` (in production use before this file). The
  `url` field points to PRS Legislative Research's tracking page for the Act — reachable,
  but a secondary source; **before relying on these for a real audit, swap `url` to the
  primary indiacode.nic.in / gazette PDF citation** and spot-check section numbers.
  Penalty figures were crosschecked 2026-09-01 against the Schedule to the Act (see
  "Penalty figures" below). This file tracks the **2023 Act only** — subordinate rules
  are deliberately out of scope.
- **`iso-27001-2022-annex-a.json`** — Annex A's four-theme structure (Organizational
  A.5.1–5.37, People A.6.1–6.8, Physical A.7.1–7.14, Technological A.8.1–8.34) is
  well-established and stable; this file is a **curated subset** (not all 93 controls) —
  the ones most likely to be relevant to the self-assessment's department questions.
  `iso.org/standard/27001` was bot-blocked during authoring (not confirmed live this
  session) — verify before shipping to a customer-facing audit context. ISO does not
  publish the standard's control body text for free, so only control IDs/short titles are
  included here, never reproduced standard text.

## Penalty figures

**DPDPA** — crosschecked 2026-09-01 against the Schedule to the DPDP Act, 2023
(reproduced at `dpdpa.com/theschedule.html`; a commercial secondary source, but the
Schedule text is short and unambiguous). The Schedule assigns a fine ceiling per breach:

| Schedule entry | Section | Provision | Ceiling |
|---|---|---|---|
| 1 | 8(5) | Reasonable security safeguards | ₹250 crore |
| 2 | 8(6) | Personal-data-breach notification | ₹200 crore |
| 3 | 9 | Additional obligations re: children | ₹200 crore |
| 4 | 10 | Additional obligations of a Significant Data Fiduciary | ₹150 crore |
| 5 | 15 | Data Principal's duties | ₹10,000 |
| 6 | 32 | Breach of a voluntary undertaking | as applicable to the underlying breach |
| 7 | (residuary) | Breach of any other provision of the Act or its rules | ₹50 crore |

So only 8(5) / 8(6) / 9 / 10 carry an explicit `penalty` in `dpdpa-2023.json`. Every other
provision inherits the file-level `defaultPenalty` (₹50 crore, Schedule entry 7) via
`provisionIndex.js` (`p.penalty ?? parsed.defaultPenalty ?? null`) — including s.6, which
previously carried a hand-typed ₹50 crore and now resolves to the same figure through the
residuary default, correctly labelled. s.15 and s.32 are not in the index (not relevant to
the department self-assessment questions).

**GDPR** — Art. 83(4) tier (€10M / 2%) and Art. 83(5) tier (€20M / 4%) per provision, set
during authoring. **ISO 27001** — no statutory fine; `defaultPenalty` records the
certification/audit-nonconformity consequence instead.

## Maintenance

Re-verify all three files at least whenever a framework's citations in
`api/src/scanner/rules.js` change, and periodically otherwise (acts get amended, ISO
revises standards). This is deliberately small and curated rather than exhaustive —
extend it as new self-assessment departments/questions need a provision that isn't here
yet, rather than trying to enumerate every section/article up front.
