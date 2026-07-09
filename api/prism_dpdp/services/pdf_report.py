"""PDF Report Generator — styled to match the PRISM review page design."""

from __future__ import annotations

from datetime import datetime, timezone
from pathlib import Path

from fpdf import FPDF

from prism_dpdp.models.dpdpa_assessment import DPDPA_QUESTIONS
from prism_dpdp.models.recommendation import PRISM_PILLARS
from prism_dpdp.services.assessment_store import AssessmentStore
from prism_dpdp.services.review_data import build_review_data

# Colors matching the review page
BLUE = (30, 64, 175)
PURPLE = (124, 58, 237)
GREEN = (5, 150, 105)
AMBER = (217, 119, 6)
RED = (220, 38, 38)
GRAY = (107, 114, 128)
DARK = (30, 41, 59)
LIGHT_BG = (248, 250, 252)
CARD_BG = (255, 255, 255)
BADGE_COLORS = {
    "P": (37, 99, 235), "R": (217, 119, 6), "I": (5, 150, 105),
    "S": (124, 58, 237), "M": (219, 39, 119),
}


class PRISMReport(FPDF):
    def header(self):
        # Skip header on title page (page 1)
        if self.page_no() == 1:
            return
        # Blue gradient-style header bar — consistent on all pages
        self.set_fill_color(*BLUE)
        self.rect(0, 0, 210, 12, style="F")
        self.set_fill_color(*PURPLE)
        self.rect(145, 0, 65, 12, style="F")
        self.set_font("Helvetica", "B", 8)
        self.set_text_color(255, 255, 255)
        self.set_y(2.5)
        self.set_x(30)
        self.cell(75, 7, "PRISM - DPDPA Readiness Assessment", align="L")
        self.cell(75, 7, datetime.now(timezone.utc).strftime("%B %Y"), align="R")
        self.ln(11)

    def footer(self):
        self.set_y(-12)
        self.set_font("Helvetica", "", 7)
        self.set_text_color(*GRAY)
        self.cell(0, 8, f"PRISM Recovery Lite | Page {self.page_no()}/{{nb}} | Confidential", align="C")


def generate_report(store: AssessmentStore, output_path: str | Path = "exports/PRISM_DPDPA_Report.pdf") -> Path:
    """Generate styled PDF matching the review page layout."""
    output_path = Path(output_path)
    output_path.parent.mkdir(parents=True, exist_ok=True)

    data = build_review_data(store)
    departments = data["departments"]
    tools = data["tools"]
    recs = data["recs"]
    risks = data["risks"]
    pillar_scores = data["pillar_scores"]
    overall_score = data["overall_score"]
    tools_with_data = data["tools_with_data"]
    dpdpa_answers = data["dpdpa_answers"]

    pdf = PRISMReport()
    pdf.alias_nb_pages()
    pdf.set_auto_page_break(auto=True, margin=18)
    pdf.set_left_margin(30)
    pdf.set_right_margin(30)

    # ═══ Title Page ═══════════════════════════════════════════════════════
    pdf.add_page()
    pdf.ln(30)
    # Title
    pdf.set_font("Helvetica", "B", 32)
    pdf.set_text_color(*BLUE)
    pdf.cell(0, 14, "PRISM", align="C", new_x="LMARGIN", new_y="NEXT")
    pdf.set_font("Helvetica", "", 11)
    pdf.set_text_color(*GRAY)
    pdf.cell(0, 6, "Personal Data Discovery & Governance Platform", align="C", new_x="LMARGIN", new_y="NEXT")
    pdf.ln(14)

    # Score box - clean centered rectangle with score
    score_color = GREEN if overall_score >= 75 else AMBER if overall_score >= 40 else RED
    box_x = 75
    box_y = pdf.get_y()
    box_w = 60
    box_h = 36
    pdf.set_fill_color(248, 250, 252)
    pdf.set_draw_color(*score_color)
    pdf.set_line_width(1.2)
    pdf.rect(box_x, box_y, box_w, box_h, style="DF")
    pdf.set_line_width(0.2)
    # Score number
    pdf.set_y(box_y + 6)
    pdf.set_font("Helvetica", "B", 28)
    pdf.set_text_color(*score_color)
    pdf.cell(0, 14, f"{overall_score}%", align="C", new_x="LMARGIN", new_y="NEXT")
    # Label
    pdf.set_font("Helvetica", "", 9)
    pdf.set_text_color(*GRAY)
    pdf.cell(0, 5, "DPDPA Readiness Score", align="C", new_x="LMARGIN", new_y="NEXT")
    pdf.set_y(box_y + box_h + 10)

    # Stats row
    pdf.set_font("Helvetica", "", 10)
    pdf.set_text_color(*DARK)
    pdf.cell(50, 6, f"Departments: {len(departments)}", align="C")
    pdf.cell(50, 6, f"Tools: {len(tools)}", align="C")
    pdf.cell(50, 6, f"PD Tools: {tools_with_data}", align="C", new_x="LMARGIN", new_y="NEXT")
    pdf.ln(20)
    pdf.set_font("Helvetica", "", 9)
    pdf.set_text_color(*GRAY)
    pdf.cell(0, 5, "Assessment Framework: Digital Personal Data Protection Act (DPDPA), 2023", align="C", new_x="LMARGIN", new_y="NEXT")
    pdf.cell(0, 5, f"Generated: {datetime.now(timezone.utc).strftime('%Y-%m-%d %H:%M UTC')}", align="C", new_x="LMARGIN", new_y="NEXT")

    # ═══ Pillar Scores ════════════════════════════════════════════════════
    pdf.add_page()
    _card_title(pdf, "PRISM Pillar Scores")
    pdf.set_font("Helvetica", "", 8)
    pdf.set_text_color(*GRAY)
    pdf.cell(0, 5, "Based on DPDPA assessment responses with IT operational penalties applied", new_x="LMARGIN", new_y="NEXT")
    pdf.ln(4)

    for pillar, label in PRISM_PILLARS.items():
        ps = pillar_scores[pillar]
        score = ps["score"]
        penalty = ps["penalty"]
        color = BADGE_COLORS[pillar]

        # Pillar row
        pdf.set_font("Helvetica", "B", 9)
        pdf.set_text_color(*color)
        pdf.cell(7, 7, pillar)
        pdf.set_text_color(*DARK)
        pdf.cell(52, 7, label)

        # Responses
        pdf.set_font("Helvetica", "", 8)
        pdf.set_text_color(*GRAY)
        pdf.cell(32, 7, f"{ps['yes']}Y / {ps['partial']}P / {ps['no']}N")

        # Progress bar
        bar_x = pdf.get_x()
        bar_y = pdf.get_y() + 2
        bar_w = 35
        bar_h = 4
        pdf.set_fill_color(226, 232, 240)
        pdf.rect(bar_x, bar_y, bar_w, bar_h, style="F")
        fill_w = bar_w * score / 100
        bar_color = GREEN if score >= 75 else AMBER if score >= 40 else RED
        pdf.set_fill_color(*bar_color)
        if fill_w > 0:
            pdf.rect(bar_x, bar_y, fill_w, bar_h, style="F")
        pdf.set_x(bar_x + bar_w + 3)

        # Score text
        pdf.set_font("Helvetica", "B", 9)
        pdf.set_text_color(*bar_color)
        score_text = f"{score}%"
        if penalty > 0:
            pdf.set_font("Helvetica", "", 7)
            score_text += f" (-{penalty}%)"
        pdf.cell(25, 7, score_text, new_x="LMARGIN", new_y="NEXT")
        pdf.ln(1)

    # ═══ Key Findings ═════════════════════════════════════════════════════
    pdf.ln(6)
    _card_title(pdf, "Key Findings")
    critical_count = sum(1 for r in risks if r["severity"] == "Critical")
    high_count = sum(1 for r in risks if r["severity"] == "High")
    _finding_row(pdf, "Critical-severity risks", str(critical_count), RED)
    _finding_row(pdf, "High-severity risks", str(high_count), AMBER)
    _finding_row(pdf, "Total IT operational risks", str(len(risks)), DARK)
    _finding_row(pdf, "Tool-level recommendations", str(len(recs)), DARK)

    # ═══ IT Operational Risks ═════════════════════════════════════════════
    pdf.add_page()
    _card_title(pdf, "IT Operational Risks & DPDPA Impact - Action Plan")
    pdf.set_font("Helvetica", "", 8)
    pdf.set_text_color(*GRAY)
    pdf.cell(0, 4, "Sorted by severity. Timelines indicate deployment urgency.", new_x="LMARGIN", new_y="NEXT")
    pdf.ln(3)

    if risks:
        # Table header
        _table_header(pdf, ["Pillar", "Area", "Severity", "DPDPA Section", "Deploy By"], [10, 42, 18, 45, 35])
        for r in risks:
            sev_color = RED if r["severity"] == "Critical" else AMBER if r["severity"] == "High" else BLUE
            pdf.set_font("Helvetica", "B", 7)
            pdf.set_text_color(*BADGE_COLORS.get(r["pillar"], DARK))
            pdf.cell(10, 5.5, r["pillar"], border=1)
            pdf.set_font("Helvetica", "", 7)
            pdf.set_text_color(*DARK)
            pdf.cell(42, 5.5, r["area"][:22], border=1)
            pdf.set_text_color(*sev_color)
            pdf.set_font("Helvetica", "B", 7)
            pdf.cell(18, 5.5, r["severity"], border=1)
            pdf.set_font("Helvetica", "", 7)
            pdf.set_text_color(*BLUE)
            pdf.cell(45, 5.5, r["dpdpa_ref"][:24], border=1)
            timeline_color = RED if "Immediate" in r["timeline"] else AMBER if "Urgent" in r["timeline"] else DARK
            pdf.set_text_color(*timeline_color)
            pdf.set_font("Helvetica", "B", 7)
            pdf.cell(35, 5.5, r["timeline"], border=1, new_x="LMARGIN", new_y="NEXT")

    # ═══ Tool-Level Recommendations ═══════════════════════════════════════
    pdf.add_page()
    _card_title(pdf, "Tool-Level Recommended Actions")

    immediate = [r for r in recs if r.suggested_timeline == "Immediate"]
    thirty = [r for r in recs if r.suggested_timeline == "30 days"]
    sixty = [r for r in recs if r.suggested_timeline == "60 days"]

    for label, items, badge_color in [("Immediate", immediate, RED), ("30-Day Plan", thirty, AMBER), ("60-Day Plan", sixty, BLUE)]:
        if not items:
            continue
        pdf.ln(3)
        pdf.set_font("Helvetica", "B", 9)
        pdf.set_text_color(*badge_color)
        pdf.cell(0, 6, f"{label} ({len(items)})", new_x="LMARGIN", new_y="NEXT")
        _table_header(pdf, ["P", "Gap", "Tools", "Sev", "Owner"], [8, 40, 45, 17, 40])
        for r in items[:12]:
            pdf.set_font("Helvetica", "", 7)
            pdf.set_text_color(*BADGE_COLORS.get(r.prism_pillar, DARK))
            pdf.cell(8, 5, r.prism_pillar, border=1)
            pdf.set_text_color(*DARK)
            pdf.cell(40, 5, r.gap_title[:22], border=1)
            pdf.cell(45, 5, r.tool_name[:24], border=1)
            sev_c = RED if r.severity == "Critical" else AMBER if r.severity == "High" else GRAY
            pdf.set_text_color(*sev_c)
            pdf.cell(17, 5, r.severity, border=1)
            pdf.set_text_color(*DARK)
            pdf.cell(40, 5, r.suggested_owner[:20], border=1, new_x="LMARGIN", new_y="NEXT")

    # ═══ DPDPA Responses ══════════════════════════════════════════════════
    pdf.add_page()
    _card_title(pdf, "DPDPA Assessment Responses")
    for pillar, label in PRISM_PILLARS.items():
        pdf.set_font("Helvetica", "B", 9)
        pdf.set_text_color(*BADGE_COLORS[pillar])
        pdf.cell(0, 7, f"{pillar} - {label}", new_x="LMARGIN", new_y="NEXT")
        questions = [q for q in DPDPA_QUESTIONS if q["pillar"] == pillar]
        for q in questions:
            ans = dpdpa_answers.get(q["id"], "Not Answered")
            ans_color = GREEN if ans == "Yes" else AMBER if ans == "Partially" else RED if ans in ("No", "Not Sure") else GRAY
            # Render as single line: [Answer] Question text
            pdf.set_font("Helvetica", "", 8)
            pdf.set_text_color(*ans_color)
            line_text = f"[{ans}]  "
            pdf.set_text_color(*DARK)
            # Use one multi_cell for the full line to respect margins
            pdf.set_font("Helvetica", "", 8)
            pdf.set_text_color(*DARK)
            pdf.multi_cell(0, 5, f"[{ans}]   {q['question']}")
            pdf.ln(1)
        pdf.ln(4)

    # ═══ Roadmap ══════════════════════════════════════════════════════════
    pdf.add_page()
    _card_title(pdf, "Recommended Roadmap")
    phases = [
        ("Phase 1: Immediate (0-15 Days)", RED, [
            "Implement Incident Response Plan and breach notification",
            "Establish Disaster Recovery and Business Continuity",
            "Assign IR roles and escalation paths",
        ]),
        ("Phase 2: Urgent (15-30 Days)", AMBER, [
            "Implement consent management",
            "Execute Vendor DPAs",
            "Ensure backup for critical systems",
            "Deploy archival, segmentation, encryption",
        ]),
        ("Phase 3: Planned (30-60 Days)", BLUE, [
            "Implement DLP and SIEM monitoring",
            "Define retention/deletion policies",
            "Periodic access reviews",
            "WAF and patch management",
        ]),
        ("Phase 4: Validation (60-90 Days)", GREEN, [
            "Internal DPDPA compliance audits",
            "Employee awareness training",
            "Validate all controls",
            "Prepare evidence for Board",
        ]),
    ]
    for title, color, items in phases:
        pdf.set_font("Helvetica", "B", 9)
        pdf.set_text_color(*color)
        pdf.cell(0, 7, title, new_x="LMARGIN", new_y="NEXT")
        for item in items:
            pdf.set_font("Helvetica", "", 8)
            pdf.set_text_color(*DARK)
            pdf.set_x(34)
            pdf.cell(0, 4.5, f"- {item}", new_x="LMARGIN", new_y="NEXT")
        pdf.ln(3)

    # ═══ Expected Improvement ═════════════════════════════════════════════
    pdf.ln(4)
    _card_title(pdf, "Expected Compliance Improvement")
    improvements = [
        ("Current", overall_score),
        ("After Phase 1", min(overall_score + 22, 100)),
        ("After Phase 2", min(overall_score + 42, 100)),
        ("After Phase 3", min(overall_score + 57, 100)),
        ("After Phase 4", min(overall_score + 70, 98)),
    ]
    for label, score in improvements:
        pdf.set_font("Helvetica", "", 8)
        pdf.set_text_color(*DARK)
        pdf.cell(40, 5.5, label)
        bar_x = pdf.get_x()
        bar_y = pdf.get_y() + 1
        pdf.set_fill_color(226, 232, 240)
        pdf.rect(bar_x, bar_y, 80, 3.5, style="F")
        bar_color = GREEN if score >= 75 else AMBER if score >= 40 else RED
        pdf.set_fill_color(*bar_color)
        pdf.rect(bar_x, bar_y, score * 0.8, 3.5, style="F")
        pdf.set_x(bar_x + 83)
        pdf.set_font("Helvetica", "B", 8)
        pdf.set_text_color(*bar_color)
        pdf.cell(25, 5.5, f"{score}%", new_x="LMARGIN", new_y="NEXT")
        pdf.ln(1)

    # ═══ Conclusion ═══════════════════════════════════════════════════════
    pdf.add_page()
    _card_title(pdf, "Conclusion")
    worst = sorted(pillar_scores.items(), key=lambda x: x[1]["score"])[:2]
    worst_str = " and ".join(f"{PRISM_PILLARS[p]} ({s['score']}%)" for p, s in worst)
    pdf.set_font("Helvetica", "", 9)
    pdf.set_text_color(*DARK)
    pdf.multi_cell(0, 5, f"Overall DPDPA readiness stands at {overall_score}%. The most significant gaps are in {worst_str}. Immediate action on incident response, disaster recovery, consent management, and security safeguards is essential for compliance with the Digital Personal Data Protection Act, 2023.")
    pdf.ln(4)
    pdf.multi_cell(0, 5, f"By following the phased remediation roadmap, the organization can reach an estimated {min(overall_score + 70, 98)}% readiness within 90 days.")

    pdf.output(str(output_path))
    return output_path


# ─── Styled Helpers ───────────────────────────────────────────────────────────

def _card_title(pdf, text):
    """Section title styled like the review page card headers."""
    pdf.set_font("Helvetica", "B", 12)
    pdf.set_text_color(*DARK)
    pdf.cell(0, 8, text, new_x="LMARGIN", new_y="NEXT")
    pdf.set_draw_color(*BLUE)
    pdf.set_line_width(0.5)
    pdf.line(30, pdf.get_y(), 90, pdf.get_y())
    pdf.set_line_width(0.2)
    pdf.ln(4)

def _finding_row(pdf, label, value, color):
    """Key finding row with colored value."""
    pdf.set_font("Helvetica", "", 9)
    pdf.set_text_color(*DARK)
    pdf.cell(100, 6, label)
    pdf.set_font("Helvetica", "B", 9)
    pdf.set_text_color(*color)
    pdf.cell(50, 6, value, new_x="LMARGIN", new_y="NEXT")

def _table_header(pdf, headers, widths):
    """Styled table header matching review page."""
    pdf.set_font("Helvetica", "B", 7)
    pdf.set_fill_color(241, 245, 249)
    pdf.set_text_color(*DARK)
    for i, h in enumerate(headers):
        pdf.cell(widths[i], 5.5, h, border=1, fill=True)
    pdf.ln()
