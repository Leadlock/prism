"""PRISM Recommendation Engine — generates gap-based recommendations.

Analyses tool assessments against PRISM pillars and produces actionable
recommendations with explainable triggers.
"""

from __future__ import annotations

import uuid
from datetime import datetime, timezone

from prism_dpdp.models.recommendation import Recommendation, PRISM_PILLARS
from prism_dpdp.models.tool_catalogue import ToolEntry, ENTERPRISE_SAAS_WITH_BUILTIN_GOVERNANCE


def _is_enterprise_tool(tool_name: str) -> bool:
    """Check if a tool is a known enterprise/vendor product with built-in governance.

    Uses exact match first, then prefix matching for vendor families.
    """
    if tool_name in ENTERPRISE_SAAS_WITH_BUILTIN_GOVERNANCE:
        return True

    # Prefix matching for vendor families
    VENDOR_PREFIXES = [
        "Microsoft", "Google", "Zoho", "SAP", "Oracle", "Salesforce",
        "HubSpot", "Freshworks", "Fresh", "Keka", "Darwinbox", "GreytHR",
        "CrowdStrike", "SentinelOne", "Sophos", "Trend Micro", "Palo Alto",
        "Fortinet", "Check Point", "Cisco", "Splunk", "IBM",
        "Okta", "CyberArk", "Veeam", "Commvault", "Rubrik", "Acronis",
        "Veritas", "Druva", "Datto", "Slack", "Zoom", "LinkedIn",
        "ServiceNow", "Jira", "Atlassian", "DocuSign", "Adobe",
        "Mailchimp", "Marketo", "Brevo", "OneTrust", "TrustArc",
        "Proofpoint", "Mimecast", "Box", "Dropbox", "Stripe",
        "Razorpay", "PayU", "QuickBooks", "Xero", "Tally",
        "BambooHR", "Workable", "Greenhouse", "Lever", "Naukri",
        "Indeed", "Pipedrive", "Apollo", "ManageEngine", "Hexnode",
        "ESET", "Kaspersky", "Carbon Black", "Malwarebytes",
        "Symantec", "McAfee", "Trellix", "Crowdstrike",
        "Wiz", "Orca", "Netskope", "Zscaler", "Cloudflare",
        "PagerDuty", "Elastic", "Wazuh", "LogRhythm", "Securonix",
        "Varonis", "BigID", "Securiti", "Spirion",
        "Udemy", "Cornerstone", "Moodle", "Leapsome",
        "Culture Amp", "Peakon", "Officevibe",
        "Calendly", "GoodTime", "HireVue",
        "HackerRank", "Codility", "TestGorilla",
        "SpringVerify", "AuthBridge", "HireRight", "First Advantage",
        "Plum", "Loop Health", "PolicyBazaar",
        "VisitorCheck", "Kisi", "HID", "Honeywell", "Suprema",
        "Hikvision", "Dahua", "CP Plus", "Verkada",
        "Leadpages", "Unbounce", "Typeform", "Airmeet",
        "Envoy", "Proxyclick", "SwipedOn",
        "Snipe-IT", "AssetTiger",
        "Zendesk", "Intercom", "Drift", "Tidio",
        "Five9", "Genesys", "Ameyo",
        "Ironclad", "Agiloft", "Clio",
        "Coupa", "GEP", "Jaggaer", "Ivalua",
        "Tipalti", "Basware",
        "Jamf", "VMware", "Ivanti", "SOTI", "Kandji", "Mosyle",
        "Scalefusion", "WatchGuard", "Juniper", "Barracuda",
        "NordLayer", "Perimeter 81", "Tailscale",
        "Abnormal Security", "Ironscales", "Cofense", "Tessian",
        "Rapid7", "Qualys", "Tenable", "Automox",
        "Thales", "HashiCorp", "Delinea", "BeyondTrust",
        "Arcon", "SailPoint", "Saviynt", "Ping Identity",
        "ForgeRock", "JumpCloud", "OneLogin",
        "Cohesity", "Dell EMC", "Nakivo", "Unitrends", "Carbonite",
        "Lacework", "Aqua Security", "Sysdig",
        "Citrix", "Egnyte", "Tresorit",
        "SurveyMonkey", "Qualtrics",
        "Notion", "Confluence", "Document360",
        "ConvergePoint", "PowerDMS",
        "AWS", "Azure", "GCP",
        # Additional commonly used SaaS
        "Lusha", "ZoomInfo", "Dialpad", "RingCentral", "Ozonetel", "Knowlarity",
        "PandaDoc", "Proposify", "QuoteWerks",
        "Hotjar", "Mixpanel", "Amplitude",
        "Cookiebot", "Osano", "WireWheel",
        "Duo Security", "Ping", "SortCut",
        "Expensify", "Happay", "Concur",
        "Loom", "Asana", "Monday", "Trello", "ClickUp",
        "Figma", "Canva", "Miro",
        "Twilio", "SendGrid", "Postmark",
        "Segment", "mParticle",
        "Datadog", "New Relic", "Dynatrace",
        "Snowflake", "Databricks", "BigQuery",
        "Power BI", "Tableau", "Looker",
        "Workato", "Zapier", "Make", "n8n",
        # Fill remaining catalogue tools
        "ADP", "AlienVault", "BioTime", "BitLocker", "Boldon James",
        "CCAvenue", "Code42", "ContractPodAi", "Cylance", "BlackBerry",
        "Digital Guardian", "Drata", "Endpoint Protector", "CoSoSys",
        "Exabeam", "FileVault", "Forcepoint", "GTB Technologies",
        "Glassdoor", "GoTo", "Graylog", "HDFC", "ICICI",
        "Ideal", "LegalDesk", "MealPe", "Meta", "Mettl",
        "ModernLoop", "Monster", "MyCase", "One Identity",
        "OpenVPN", "ParkWhiz", "PolicyHub", "Pymetrics", "Ramco",
        "SBI YONO", "Safetica", "Salto", "SharePoint",
        "SpotHero", "Sumo Logic", "Titus", "Twitter",
        "Vanta", "VeraCrypt", "Vormetric", "Wallix",
        "WireGuard", "WithSecure", "ZKTeco", "Zeta",
        "Zycus", "pfSense", "Paper",
        "Custom system",
    ]

    tool_lower = tool_name.lower()
    for prefix in VENDOR_PREFIXES:
        if tool_lower.startswith(prefix.lower()):
            return True

    return False


class RecommendationEngine:
    """Generates PRISM-framework recommendations from tool assessments."""

    def generate_recommendations(self, tool: ToolEntry, department_name: str = "") -> list[Recommendation]:
        """Analyse a single tool assessment and generate recommendations.

        For enterprise SaaS tools (LinkedIn, Zoho, Salesforce, etc.), only flag
        customer-side configuration gaps — NOT vendor-side controls like privacy
        policies, incident response, or data retention (the vendor handles those).

        Args:
            tool: Completed tool assessment
            department_name: Name of the department for context

        Returns:
            List of recommendations based on identified gaps
        """
        recs: list[Recommendation] = []
        self._is_enterprise_saas = _is_enterprise_tool(tool.tool_name)

        if tool.collects_personal_data == "Unsure":
            recs.append(self._make_rec(
                tool=tool, pillar="M", severity="Medium",
                gap_title="Data collection status unclear",
                why="Cannot determine compliance posture without confirming whether personal data is collected.",
                action="Clarify with tool owner whether personal data is collected, stored or processed.",
                timeline="Immediate",
                evidence="Confirmation from tool owner or data-flow diagram",
                triggered_by="Customer selected 'Unsure' for data collection",
                owner="Assessment Owner",
            ))

        if tool.collects_personal_data in ("Yes", "Unsure"):
            # Only generate control-based recommendations if IT assessment was done
            if tool.existing_controls or tool.detection_sources or tool.assessment_status == "Submitted":
                # P — Policies & Governance checks
                recs.extend(self._check_policies(tool))
                # R — Risk & Resiliency checks
                recs.extend(self._check_risk(tool))
                # I — Identity & People checks
                recs.extend(self._check_identity(tool))
                # S — Security Architecture checks
                recs.extend(self._check_security(tool))
                # M — Management Review & Audit checks
                recs.extend(self._check_management(tool))
            else:
                # IT assessment not done yet — only flag for non-enterprise tools
                if not self._is_enterprise_saas:
                    recs.append(self._make_rec(
                        tool=tool, pillar="M", severity="Medium",
                        gap_title="IT security assessment pending",
                        why="Controls, detection sources and intake methods have not been assessed yet.",
                        action="IT Administrator must complete the security assessment for this department's tools.",
                        timeline="Immediate",
                        evidence="Completed IT assessment with controls and detection sources selected",
                        triggered_by="IT assessment not yet submitted for this tool",
                        owner="IT Administrator",
                    ))

        return recs

    def generate_all_recommendations(self, tools: list[ToolEntry]) -> list[Recommendation]:
        """Generate recommendations for all assessed tools.

        Deduplicates by gap_title + department — produces one recommendation per
        unique gap per department, listing all affected tools.
        """
        # First generate raw recs per tool
        raw_recs: list[Recommendation] = []
        for tool in tools:
            raw_recs.extend(self.generate_recommendations(tool))

        # Deduplicate: same gap_title + department_id = one recommendation
        seen: dict[str, Recommendation] = {}
        for r in raw_recs:
            key = f"{r.department_id}::{r.prism_pillar}::{r.gap_title}"
            if key not in seen:
                seen[key] = r
            else:
                # Append tool name to existing rec
                existing = seen[key]
                if r.tool_name not in existing.tool_name:
                    existing.tool_name = f"{existing.tool_name}, {r.tool_name}"

        return list(seen.values())

    # ─── P — Policies & Governance ────────────────────────────────────────

    def _check_policies(self, tool: ToolEntry) -> list[Recommendation]:
        recs = []
        controls = tool.existing_controls

        # For enterprise SaaS, the vendor already has privacy notice and incident response.
        # Only flag customer-side gaps: retention rules the CUSTOMER must define,
        # consent the CUSTOMER must capture, DPA the CUSTOMER must execute.

        if "Privacy notice" not in controls and not self._is_enterprise_saas:
            # Enterprise SaaS vendors have their own privacy policies.
            # Only flag for custom/internal tools.
            recs.append(self._make_rec(
                tool=tool, pillar="P", severity="High",
                gap_title="No privacy notice for data subjects",
                why="DPDP requires individuals to be informed about how their data is collected and used.",
                action="Create or update privacy notice covering this tool's data collection purposes.",
                timeline="30 days",
                evidence="Published privacy notice with collection purposes documented",
                triggered_by="'Privacy notice' not selected and tool is not enterprise SaaS",
                owner="Legal / DPO",
            ))

        if "Consent capture" not in controls:
            has_direct_collection = "Collects data directly from individuals" in tool.data_handling
            if has_direct_collection and not self._is_enterprise_saas:
                recs.append(self._make_rec(
                    tool=tool, pillar="P", severity="High",
                    gap_title="No consent capture for direct data collection",
                    why="Direct collection from individuals typically requires consent under DPDP.",
                    action="Implement consent capture mechanism with purpose specification.",
                    timeline="30 days",
                    evidence="Consent records with timestamp, purpose and data subject identifier",
                    triggered_by="Tool collects data directly but 'Consent capture' not selected",
                    owner="Business Owner / Legal",
                ))

        if "Data retention rule" not in controls:
            # Customer must define their own retention policy regardless of vendor.
            # But severity is lower for enterprise SaaS since vendor has defaults.
            severity = "Low" if self._is_enterprise_saas else "Medium"
            recs.append(self._make_rec(
                tool=tool, pillar="P", severity=severity,
                gap_title="No customer-defined data retention rule",
                why="Organisation should define how long data is kept in this tool, beyond vendor defaults.",
                action="Define retention schedule aligned with business purpose and DPDP requirements.",
                timeline="60 days",
                evidence="Documented retention policy with defined periods",
                triggered_by="'Data retention rule' not selected in existing controls",
                owner="Data Owner / Legal",
            ))

        if "Data deletion process" not in controls and not self._is_enterprise_saas:
            recs.append(self._make_rec(
                tool=tool, pillar="P", severity="Medium",
                gap_title="No data deletion process",
                why="Without a deletion process, retained data may exceed lawful retention periods.",
                action="Implement documented data deletion process with verification steps.",
                timeline="60 days",
                evidence="Deletion procedure document and deletion log evidence",
                triggered_by="'Data deletion process' not selected in existing controls",
                owner="IT / Data Owner",
            ))

        if "Vendor agreement / DPA" not in controls:
            if "Shares data with third parties" in tool.data_handling or tool.hosting_location in ("Outside India", "SaaS / vendor managed"):
                # For enterprise SaaS, DPA is usually part of their standard terms.
                # Flag as Low severity — just verify it exists.
                severity = "Low" if self._is_enterprise_saas else "High"
                action = "Verify that vendor's standard DPA/T&C covers DPDP obligations." if self._is_enterprise_saas else "Execute data-processing agreement with vendor covering obligations and breach notification."
                recs.append(self._make_rec(
                    tool=tool, pillar="P", severity=severity,
                    gap_title="Vendor DPA verification needed" if self._is_enterprise_saas else "No vendor data-processing agreement",
                    why="Confirm vendor's standard terms cover your DPDP obligations." if self._is_enterprise_saas else "Third-party data sharing or external hosting requires a contractual DPA.",
                    action=action,
                    timeline="60 days" if self._is_enterprise_saas else "30 days",
                    evidence="Copy of vendor DPA or T&C confirming data protection terms",
                    triggered_by="Data shared externally; vendor DPA not confirmed",
                    owner="Procurement / Legal",
                ))

        return recs

    # ─── R — Risk & Resiliency ────────────────────────────────────────────

    def _check_risk(self, tool: ToolEntry) -> list[Recommendation]:
        recs = []
        controls = tool.existing_controls
        detection = tool.detection_sources

        # Enterprise SaaS vendors have their own incident response.
        # Only flag for custom/internal tools.
        if "Incident-response process" not in controls and not self._is_enterprise_saas:
            recs.append(self._make_rec(
                tool=tool, pillar="R", severity="High",
                gap_title="No incident-response process",
                why="Without a defined process, personal data breaches cannot be escalated within DPDP timelines.",
                action="Create incident-response and breach-escalation procedure for this tool.",
                timeline="30 days",
                evidence="Documented IR procedure with roles, timelines and escalation path",
                triggered_by="'Incident-response process' not selected and tool is not enterprise SaaS",
                owner="CISO / IT Security",
            ))

        if "No defined detection source" in detection or "Unsure" in detection:
            # For enterprise SaaS, the vendor provides detection but customer
            # should still know how THEY would be notified.
            severity = "Medium" if self._is_enterprise_saas else "Critical"
            action = "Confirm how vendor notifies you of breaches and define internal escalation." if self._is_enterprise_saas else "Define detection source, assign escalation owner and configure PRISM intake method."
            recs.append(self._make_rec(
                tool=tool, pillar="R", severity=severity,
                gap_title="Breach detection/notification path unclear" if self._is_enterprise_saas else "No breach detection source",
                why="Ensure you know how the vendor will notify you and how you will escalate internally." if self._is_enterprise_saas else "Without a detection mechanism, data breaches may go unnoticed indefinitely.",
                action=action,
                timeline="30 days" if self._is_enterprise_saas else "Immediate",
                evidence="Documented vendor notification process and internal escalation path",
                triggered_by="'No defined detection source' or 'Unsure' selected",
                owner="IT Security",
            ))

        if "Backup" not in controls and not self._is_enterprise_saas:
            has_sensitive = any(d in tool.personal_data_categories for d in [
                "Bank details", "Salary details", "Aadhaar / PAN / passport",
                "Health / insurance details", "Identity documents",
            ])
            if has_sensitive:
                recs.append(self._make_rec(
                    tool=tool, pillar="R", severity="High",
                    gap_title="Sensitive personal data without backup",
                    why="Loss of sensitive personal data without backup may cause irreversible harm.",
                    action="Validate backup coverage and recovery testing for this tool.",
                    timeline="30 days",
                    evidence="Backup policy confirmation and last successful restore test",
                    triggered_by="Sensitive personal data present but 'Backup' not in controls",
                    owner="IT Operations",
                ))

        if not tool.prism_intake_methods or "Not connected yet" in tool.prism_intake_methods or "Unsure" in tool.prism_intake_methods:
            if not self._is_enterprise_saas:
                recs.append(self._make_rec(
                    tool=tool, pillar="R", severity="Medium",
                    gap_title="No PRISM intake method configured",
                    why="PRISM cannot receive incident alerts from this tool without a configured intake method.",
                    action="Define how alerts or incident information from this tool will reach PRISM.",
                    timeline="60 days",
                    evidence="Configured intake method (form, email, API, webhook or SIEM integration)",
                    triggered_by="PRISM intake method not configured",
                    owner="IT Security / PRISM Admin",
                ))

        return recs

    # ─── I — Identity & People ────────────────────────────────────────────

    def _check_identity(self, tool: ToolEntry) -> list[Recommendation]:
        recs = []
        controls = tool.existing_controls
        access = tool.data_access

        if "Role-based access" not in controls:
            recs.append(self._make_rec(
                tool=tool, pillar="I", severity="High",
                gap_title="No role-based access control",
                why="Without RBAC, personal data may be accessible to unauthorised users.",
                action="Implement role-based access restricting personal data to authorised roles only.",
                timeline="30 days",
                evidence="Access-control configuration showing role assignments and restrictions",
                triggered_by="'Role-based access' not selected in existing controls",
                owner="IT / Application Owner",
            ))

        if "MFA" not in controls:
            has_sensitive_access = "Vendor support team" in access or "External consultants" in access
            if has_sensitive_access or "Unknown" in access:
                recs.append(self._make_rec(
                    tool=tool, pillar="I", severity="High",
                    gap_title="No MFA with external or unknown access",
                    why="External access without MFA increases risk of unauthorised data access.",
                    action="Enable MFA for all users, especially external and privileged accounts.",
                    timeline="Immediate",
                    evidence="MFA enforcement policy and activation confirmation",
                    triggered_by="External/unknown access without MFA",
                    owner="IT Security",
                ))

        if "Periodic access review" not in controls:
            recs.append(self._make_rec(
                tool=tool, pillar="I", severity="Medium",
                gap_title="No periodic access review",
                why="Without regular reviews, dormant or excessive access may persist undetected.",
                action="Conduct periodic access review and remove inactive or excessive privileges.",
                timeline="60 days",
                evidence="Access review records showing review date, reviewer and actions taken",
                triggered_by="'Periodic access review' not selected in existing controls",
                owner="Application Owner / IT",
            ))

        return recs

    # ─── S — Security Architecture ───────────────────────────────────────

    def _check_security(self, tool: ToolEntry) -> list[Recommendation]:
        recs = []
        controls = tool.existing_controls
        handling = tool.data_handling

        if "Audit logs" not in controls:
            recs.append(self._make_rec(
                tool=tool, pillar="S", severity="High",
                gap_title="No audit logs enabled",
                why="Without audit logs, data access and changes cannot be traced for accountability.",
                action="Enable audit logging for data access, modifications and exports.",
                timeline="30 days",
                evidence="Audit log configuration showing enabled events and retention period",
                triggered_by="'Audit logs' not selected in existing controls",
                owner="IT / Application Owner",
            ))

        if "DLP" not in controls:
            allows_export = "Allows users to download or export data" in handling
            if allows_export:
                recs.append(self._make_rec(
                    tool=tool, pillar="S", severity="High",
                    gap_title="Data export capability without DLP",
                    why="Users can export personal data without detection or prevention controls.",
                    action="Enable export monitoring and configure DLP / CASB controls.",
                    timeline="30 days",
                    evidence="DLP policy covering personal data export with alert configuration",
                    triggered_by="Tool allows export but 'DLP' not in controls",
                    owner="IT Security",
                ))

        if "Encryption" not in controls:
            has_sensitive = any(d in tool.personal_data_categories for d in [
                "Bank details", "Salary details", "Aadhaar / PAN / passport",
                "Health / insurance details", "Biometric data",
            ])
            if has_sensitive:
                recs.append(self._make_rec(
                    tool=tool, pillar="S", severity="High",
                    gap_title="Sensitive personal data without encryption",
                    why="Sensitive data without encryption is exposed if storage or transmission is compromised.",
                    action="Enable encryption at rest and in transit for sensitive personal data.",
                    timeline="30 days",
                    evidence="Encryption configuration or certificate confirming data protection",
                    triggered_by="Sensitive personal data present but 'Encryption' not in controls",
                    owner="IT / Cloud Team",
                ))

        return recs

    # ─── M — Management Review & Audit ────────────────────────────────────

    def _check_management(self, tool: ToolEntry) -> list[Recommendation]:
        recs = []
        controls = tool.existing_controls

        has_audit_logs = "Audit logs" in controls
        has_review = "Periodic access review" in controls

        if has_audit_logs and not has_review:
            recs.append(self._make_rec(
                tool=tool, pillar="M", severity="Medium",
                gap_title="Audit logs exist but no periodic review",
                why="Logs without review provide no oversight — breaches may exist in unreviewed data.",
                action="Assign log-review owner and establish periodic review schedule.",
                timeline="60 days",
                evidence="Review schedule, assigned owner and latest review record",
                triggered_by="'Audit logs' selected but 'Periodic access review' not selected",
                owner="CISO / IT Manager",
            ))

        # Only flag hosting as unknown for tools NOT recognised as enterprise SaaS
        from prism_dpdp.models.tool_catalogue import KNOWN_TOOL_HOSTING
        is_known_hosting = tool.tool_name in KNOWN_TOOL_HOSTING
        if tool.hosting_location in ("Unknown", "Unsure") and not is_known_hosting and not self._is_enterprise_saas:
            recs.append(self._make_rec(
                tool=tool, pillar="M", severity="Medium",
                gap_title="Data hosting location unknown",
                why="Cannot assess cross-border transfer compliance without knowing hosting location.",
                action="Clarify data hosting location with vendor or IT team.",
                timeline="Immediate",
                evidence="Vendor confirmation of data hosting region(s)",
                triggered_by="'Unknown' selected for hosting location",
                owner="IT / Procurement",
            ))

        return recs

    # ─── Helper ───────────────────────────────────────────────────────────

    def _make_rec(
        self, tool: ToolEntry, pillar: str, severity: str,
        gap_title: str, why: str, action: str, timeline: str,
        evidence: str, triggered_by: str, owner: str,
    ) -> Recommendation:
        data_category = ", ".join(tool.personal_data_categories[:3]) if tool.personal_data_categories else "General"
        return Recommendation(
            recommendation_id=f"REC-{uuid.uuid4().hex[:8].upper()}",
            department_id=tool.department_id,
            tool_id=tool.tool_id,
            tool_name=tool.tool_name or tool.category,
            personal_data_category=data_category,
            prism_pillar=pillar,
            gap_title=gap_title,
            why_it_matters=why,
            severity=severity,
            suggested_owner=owner,
            suggested_timeline=timeline,
            evidence_required=evidence,
            recommended_action=action,
            triggered_by=triggered_by,
        )
