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
  hand-authored (and presumably checked at the time) in `api/src/scanner/rules.js`, which
  predates this file and has been in production use. Direct fetches of
  `meity.gov.in`/`indiacode.nic.in` during authoring were bot-blocked (HTTP 403), so the
  `url` field points to PRS Legislative Research's tracking page for the Act instead — a
  well-known Indian legislative-research nonprofit, reachable, but a secondary source.
  **Before relying on these for a real audit, swap `url` to the primary
  indiacode.nic.in / gazette PDF citation** and spot-check section numbers against it.
- **`iso-27001-2022-annex-a.json`** — Annex A's four-theme structure (Organizational
  A.5.1–5.37, People A.6.1–6.8, Physical A.7.1–7.14, Technological A.8.1–8.34) is
  well-established and stable; this file is a **curated subset** (not all 93 controls) —
  the ones most likely to be relevant to the self-assessment's department questions.
  `iso.org/standard/27001` was bot-blocked during authoring (not confirmed live this
  session) — verify before shipping to a customer-facing audit context. ISO does not
  publish the standard's control body text for free, so only control IDs/short titles are
  included here, never reproduced standard text.

## Penalty figures

`penalty` is left `null` on any provision whose fine amount wasn't already confirmed by
existing, shipped Prism content (the two DPDPA figures that survive — ₹250 crore for
s.8(5), ₹50 crore for s.6 — match `FALLBACK_REFERENCE` in
`api/src/utils/selfAssessmentReport.js`, in production before this file existed). The
DPDP Act's penalty Schedule has several more tiers (children's data, Significant Data
Fiduciary obligations, etc.) that are commonly quoted at ₹150–200 crore, but that wasn't
independently confirmed while authoring this file — fill those in only once verified
against the Schedule text itself, not a summary. A report showing "penalty: not
confirmed" is honest; a wrong number is not.

## Maintenance

Re-verify all three files at least whenever a framework's citations in
`api/src/scanner/rules.js` change, and periodically otherwise (acts get amended, ISO
revises standards). This is deliberately small and curated rather than exhaustive —
extend it as new self-assessment departments/questions need a provision that isn't here
yet, rather than trying to enumerate every section/article up front.
