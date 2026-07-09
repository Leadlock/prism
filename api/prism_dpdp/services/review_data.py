"""Review Data Builder — single source of truth for all review/report data.

Both the review HTML page and the PDF report call this to get
the exact same scores, risks, and recommendations.
"""

from __future__ import annotations

from prism_dpdp.models.dpdpa_assessment import DPDPA_QUESTIONS
from prism_dpdp.models.recommendation import PRISM_PILLARS
from prism_dpdp.services.assessment_store import AssessmentStore
from prism_dpdp.services.recommendation_engine import RecommendationEngine

engine = RecommendationEngine()

# ─── IT Ops Risk Map ──────────────────────────────────────────────────────────

IT_OPS_RISK_MAP = {
    "Backup & Recovery": {
        "pillar": "R", "severity_if_missing": "Critical",
        "critical_items": ["Automated daily backups configured", "Backup covers all critical systems"],
        "important_items": ["Backup tested/restored periodically", "Backup encryption enabled", "Backup monitoring and alerting active"],
        "dpdpa_ref": "Section 8(4) - Reasonable Security Safeguards",
        "dpdpa_impact": "Inability to restore personal data after breach violates duty to maintain data availability. Board may impose penalties up to Rs.250 Cr.",
    },
    "Disaster Recovery & Business Continuity": {
        "pillar": "R", "severity_if_missing": "Critical",
        "critical_items": ["DR plan documented and approved", "RTO and RPO defined per system"],
        "important_items": ["DR site/region configured", "Failover tested in last 12 months", "Data replication to DR site active"],
        "dpdpa_ref": "Section 8(4) + Section 8(5) - Breach Notification",
        "dpdpa_impact": "Prolonged unavailability delays breach notification. Extended RTO increases breach exposure window.",
    },
    "Web Application Firewall (WAF) & API Security": {
        "pillar": "S", "severity_if_missing": "High",
        "critical_items": ["WAF deployed on all public apps"],
        "important_items": ["DDoS protection active", "OWASP Top 10 rules configured", "Web traffic logging and monitoring"],
        "dpdpa_ref": "Section 8(4) - Reasonable Security Safeguards",
        "dpdpa_impact": "Unprotected web apps are #1 breach entry point. May be deemed 'unreasonable' security.",
    },
    "Data Archival & Retention": {
        "pillar": "P", "severity_if_missing": "High",
        "critical_items": ["Archival policy defined per data type", "Retention periods enforced automatically"],
        "important_items": ["Archived data searchable for DSR requests", "Deletion at end of retention verified"],
        "dpdpa_ref": "Section 8(7) - Erasure + Section 11 - Data Principal Rights",
        "dpdpa_impact": "Data retained beyond lawful purpose violates erasure duty. Cannot respond to access/erasure requests.",
    },
    "Email Archival & eDiscovery": {
        "pillar": "M", "severity_if_missing": "High",
        "critical_items": ["Email archival enabled for all users"],
        "important_items": ["Retention policies applied to mailboxes", "eDiscovery/search available for investigations"],
        "dpdpa_ref": "Section 8(7) + Section 11(2) - Right to Access",
        "dpdpa_impact": "Email is the largest PD repository. Cannot demonstrate compliance or respond to access requests without archival.",
    },
    "Patch Management & Vulnerability Remediation": {
        "pillar": "S", "severity_if_missing": "High",
        "critical_items": ["Automated patching for OS", "Critical patches applied within 72 hours"],
        "important_items": ["Vulnerability scanning scheduled", "Patch compliance reporting active"],
        "dpdpa_ref": "Section 8(4) - Reasonable Security Safeguards",
        "dpdpa_impact": "Unpatched known vulnerabilities = negligent security. Breach via CVE viewed as failure of 'reasonable safeguards'.",
    },
    "Network Segmentation & Zero Trust": {
        "pillar": "S", "severity_if_missing": "High",
        "critical_items": ["Network segmentation between departments", "Production data isolated from dev/test"],
        "important_items": ["Zero Trust architecture implemented", "Lateral movement prevention controls"],
        "dpdpa_ref": "Section 8(4) - Reasonable Security Safeguards",
        "dpdpa_impact": "Flat network = single compromise exposes all PD. Lack of segmentation increases blast radius.",
    },
}

CONTROL_EXPECTATIONS = [
    {"control": "Incident-response process", "pillar": "R", "severity": "Critical", "dpdpa_ref": "Section 8(5) - Breach Notification", "dpdpa_impact": "DPDPA mandates breach notification 'without delay'. Without IR process, this is impossible.", "penalty": 15},
    {"control": "Consent capture", "pillar": "P", "severity": "High", "dpdpa_ref": "Section 6 - Consent", "dpdpa_impact": "Cannot demonstrate lawful basis for processing without consent capture.", "penalty": 8},
    {"control": "Vendor agreement / DPA", "pillar": "P", "severity": "High", "dpdpa_ref": "Section 8(1) - Processing by Processor", "dpdpa_impact": "Data Fiduciary liable for processor. Without DPA, no obligation on vendor.", "penalty": 8},
    {"control": "Encryption", "pillar": "S", "severity": "High", "dpdpa_ref": "Section 8(4) - Safeguards", "dpdpa_impact": "Unencrypted PD exposed if compromised. Encryption is baseline expectation.", "penalty": 8},
    {"control": "Audit logs", "pillar": "S", "severity": "High", "dpdpa_ref": "Section 8(4) + 8(5)", "dpdpa_impact": "Cannot detect unauthorized access, investigate breaches, or provide evidence to Board.", "penalty": 8},
    {"control": "Role-based access", "pillar": "I", "severity": "High", "dpdpa_ref": "Section 8(4) - Safeguards", "dpdpa_impact": "Unrestricted access = unauthorized processing. Access beyond purpose is a violation.", "penalty": 8},
    {"control": "MFA", "pillar": "I", "severity": "High", "dpdpa_ref": "Section 8(4) - Safeguards", "dpdpa_impact": "Compromised credentials without MFA is leading breach cause. May be deemed unreasonable.", "penalty": 8},
    {"control": "Backup", "pillar": "R", "severity": "High", "dpdpa_ref": "Section 8(4) - Data Availability", "dpdpa_impact": "Ransomware causes permanent PD loss without backup. Cannot fulfil access requests.", "penalty": 8},
    {"control": "DLP", "pillar": "S", "severity": "Medium", "dpdpa_ref": "Section 8(4) - Safeguards", "dpdpa_impact": "PD can be exfiltrated via email/uploads/downloads without detection.", "penalty": 4},
    {"control": "Data retention rule", "pillar": "P", "severity": "Medium", "dpdpa_ref": "Section 8(7) - Erasure", "dpdpa_impact": "Data retained without defined periods violates erasure obligation.", "penalty": 4},
    {"control": "Data deletion process", "pillar": "P", "severity": "Medium", "dpdpa_ref": "Section 8(7) + 12(3)", "dpdpa_impact": "Cannot honour erasure or consent withdrawal within mandated timelines.", "penalty": 4},
    {"control": "Periodic access review", "pillar": "M", "severity": "Medium", "dpdpa_ref": "Section 8(4) + 8 - Accountability", "dpdpa_impact": "Stale access creates unauthorized processing risk.", "penalty": 4},
]

DETECTION_EXPECTATIONS = [
    {"detection": "Application audit logs", "pillar": "S", "severity": "High", "dpdpa_ref": "Section 8(5) - Breach detection", "dpdpa_impact": "Cannot notify what you cannot detect. Audit logs are primary detection.", "penalty": 8},
    {"detection": "Endpoint security / EDR alert", "pillar": "S", "severity": "High", "dpdpa_ref": "Section 8(4) - Safeguards", "dpdpa_impact": "Malware/ransomware exfiltrating data goes undetected without EDR.", "penalty": 8},
    {"detection": "DLP alert", "pillar": "S", "severity": "Medium", "dpdpa_ref": "Section 8(4) - Prevention of sharing", "dpdpa_impact": "DLP detects PD leaving org via email/cloud/USB.", "penalty": 4},
    {"detection": "SIEM / SOC monitoring", "pillar": "R", "severity": "Medium", "dpdpa_ref": "Section 8(5) - Timely detection", "dpdpa_impact": "SIEM provides correlated detection. Without it, detection time increases.", "penalty": 4},
    {"detection": "IAM or suspicious-login alert", "pillar": "I", "severity": "High", "dpdpa_ref": "Section 8(4) - Unauthorized access", "dpdpa_impact": "Compromised accounts accessing PD must be detected immediately.", "penalty": 8},
]


def build_review_data(store: AssessmentStore) -> dict:
    """Compute all review data — the single source of truth.

    Returns a dict with all scores, risks, recommendations, and stats
    used by both the review HTML and the PDF report.
    """
    departments = store.load_departments()
    tools = store.load_tools()
    summary = store.load_review_summary()
    dpdpa_answers = summary.get("dpdpa_answers", {})
    it_ops = summary.get("it_operations", {})
    it_ops_completed = summary.get("it_assessment_completed", False)

    # Generate recommendations
    recs = engine.generate_all_recommendations(tools)
    store.save_recommendations(recs)

    # ─── Collect actual controls and detection from tools ─────────────────
    actual_controls: set[str] = set()
    actual_detection: set[str] = set()
    for t in tools:
        actual_controls.update(t.existing_controls)
        actual_detection.update(t.detection_sources)

    # ─── Build risks list and pillar penalties ────────────────────────────
    risks: list[dict] = []
    pillar_penalties: dict[str, int] = {"P": 0, "R": 0, "I": 0, "S": 0, "M": 0}

    # Missing controls
    if actual_controls and "None known" not in actual_controls and "Unsure" not in actual_controls:
        for exp in CONTROL_EXPECTATIONS:
            if exp["control"] not in actual_controls:
                sev = exp["severity"]
                timeline = "Immediate (0-15 days)" if sev == "Critical" else "Urgent (15-30 days)" if sev == "High" else "Planned (30-60 days)"
                risks.append({
                    "area": f"Control: {exp['control']}",
                    "pillar": exp["pillar"],
                    "severity": sev,
                    "finding": f"'{exp['control']}' not in place across organisation tools",
                    "dpdpa_ref": exp["dpdpa_ref"],
                    "impact": exp["dpdpa_impact"],
                    "action": f"Implement '{exp['control']}' for all tools handling personal data",
                    "timeline": timeline,
                })
                pillar_penalties[exp["pillar"]] += exp["penalty"]

    # Missing detection
    if actual_detection and "No defined detection source" not in actual_detection and "Unsure" not in actual_detection:
        for exp in DETECTION_EXPECTATIONS:
            if exp["detection"] not in actual_detection:
                sev = exp["severity"]
                timeline = "Urgent (15-30 days)" if sev == "High" else "Planned (30-60 days)"
                risks.append({
                    "area": f"Detection: {exp['detection']}",
                    "pillar": exp["pillar"],
                    "severity": sev,
                    "finding": f"'{exp['detection']}' not configured as breach detection source",
                    "dpdpa_ref": exp["dpdpa_ref"],
                    "impact": exp["dpdpa_impact"],
                    "action": f"Configure '{exp['detection']}' to enable breach detection",
                    "timeline": timeline,
                })
                pillar_penalties[exp["pillar"]] += exp["penalty"]

    # IT Ops capabilities
    if it_ops_completed:
        for area_name, config in IT_OPS_RISK_MAP.items():
            answers = it_ops.get(area_name, [])
            pillar = config["pillar"]
            if not answers or "Not configured" in answers or "Unsure" in answers:
                sev = config["severity_if_missing"]
                timeline = "Immediate (0-15 days)" if sev == "Critical" else "Urgent (15-30 days)"
                risks.append({
                    "area": area_name,
                    "pillar": pillar,
                    "severity": sev,
                    "finding": f"{area_name} is not configured or status unknown",
                    "dpdpa_ref": config["dpdpa_ref"],
                    "impact": config["dpdpa_impact"],
                    "action": f"Implement {area_name.lower()} covering all systems with personal data",
                    "timeline": timeline,
                })
                pillar_penalties[pillar] += 20
            else:
                missing_critical = [i for i in config["critical_items"] if i not in answers]
                missing_important = [i for i in config["important_items"] if i not in answers]
                if missing_critical:
                    risks.append({
                        "area": area_name,
                        "pillar": pillar,
                        "severity": "High",
                        "finding": f"Missing critical: {', '.join(missing_critical)}",
                        "dpdpa_ref": config["dpdpa_ref"],
                        "impact": config["dpdpa_impact"],
                        "action": f"Implement: {', '.join(missing_critical)}",
                        "timeline": "Urgent (15-30 days)",
                    })
                    pillar_penalties[pillar] += 10
                elif missing_important:
                    risks.append({
                        "area": area_name,
                        "pillar": pillar,
                        "severity": "Medium",
                        "finding": f"Improvement needed: {', '.join(missing_important)}",
                        "dpdpa_ref": config["dpdpa_ref"],
                        "impact": config["dpdpa_impact"],
                        "action": f"Consider: {', '.join(missing_important)}",
                        "timeline": "Planned (30-60 days)",
                    })
                    pillar_penalties[pillar] += 5

    # Sort risks by severity
    sev_order = {"Critical": 0, "High": 1, "Medium": 2}
    risks.sort(key=lambda r: sev_order.get(r["severity"], 3))

    # ─── Compute pillar scores ────────────────────────────────────────────
    pillar_scores: dict[str, dict] = {}
    for pillar in PRISM_PILLARS:
        questions = [q for q in DPDPA_QUESTIONS if q["pillar"] == pillar]
        total = len(questions)
        yes = sum(1 for q in questions if dpdpa_answers.get(q["id"]) == "Yes")
        partial = sum(1 for q in questions if dpdpa_answers.get(q["id"]) == "Partially")
        no = sum(1 for q in questions if dpdpa_answers.get(q["id"]) in ("No", "Not Sure"))
        na = sum(1 for q in questions if dpdpa_answers.get(q["id"]) == "Not Applicable")
        unanswered = total - yes - partial - no - na
        applicable = total - na
        raw = int(((yes + partial * 0.5) / max(applicable, 1)) * 100) if applicable > 0 and unanswered < applicable else 0
        penalty = pillar_penalties[pillar]
        final = max(0, raw - penalty)
        pillar_scores[pillar] = {
            "score": final, "raw": raw, "penalty": penalty,
            "yes": yes, "partial": partial, "no": no, "total": total,
        }

    all_final = [ps["score"] for ps in pillar_scores.values()]
    overall_score = int(sum(all_final) / len(all_final)) if all_final else 0

    # ─── Stats ────────────────────────────────────────────────────────────
    tools_with_data = sum(1 for t in tools if t.collects_personal_data == "Yes")
    no_detection = sum(1 for t in tools if "No defined detection source" in t.detection_sources or not t.detection_sources)

    return {
        "departments": departments,
        "tools": tools,
        "recs": recs,
        "risks": risks,
        "pillar_scores": pillar_scores,
        "pillar_penalties": pillar_penalties,
        "overall_score": overall_score,
        "tools_with_data": tools_with_data,
        "no_detection": no_detection,
        "dpdpa_answers": dpdpa_answers,
        "it_ops": it_ops,
        "it_ops_completed": it_ops_completed,
        "has_assessment": bool(dpdpa_answers),
    }
