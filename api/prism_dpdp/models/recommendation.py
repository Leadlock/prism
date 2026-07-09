"""Recommendation model — PRISM framework gap findings and actions."""

from __future__ import annotations

from datetime import datetime, timezone
from pydantic import BaseModel, Field


class Recommendation(BaseModel):
    """A PRISM-framework recommendation generated from assessment gaps."""

    recommendation_id: str = ""
    department_id: str = ""
    tool_id: str = ""
    tool_name: str = ""
    personal_data_category: str = ""
    prism_pillar: str = ""  # P, R, I, S, M
    gap_title: str = ""
    why_it_matters: str = ""
    severity: str = "Medium"  # Critical / High / Medium / Low
    suggested_owner: str = ""
    suggested_timeline: str = ""  # Immediate / 30 days / 60 days / 90 days
    evidence_required: str = ""
    recommended_action: str = ""
    technology_category: str | None = None
    triggered_by: str = ""  # The customer response that caused this recommendation
    status: str = "Open"  # Open / In Progress / Closed / Accepted
    created_at: str = Field(default_factory=lambda: datetime.now(timezone.utc).isoformat())


# ─── PRISM Pillar Definitions ─────────────────────────────────────────────────

PRISM_PILLARS = {
    "P": "Policies & Governance",
    "R": "Risk & Resiliency",
    "I": "Identity & People",
    "S": "Security Architecture",
    "M": "Management Review & Audit",
}
