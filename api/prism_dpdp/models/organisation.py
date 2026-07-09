"""Organisation and Department models for PRISM DPDP."""

from __future__ import annotations

from datetime import datetime, timezone
from pydantic import BaseModel, Field


class Department(BaseModel):
    """A department within the organisation."""

    department_id: str = ""
    name: str = ""
    department_head: str = ""
    assessment_owner: str = ""
    handles_personal_data: str = "Unsure"  # Yes / No / Unsure
    data_subjects: list[str] = Field(default_factory=list)
    business_function: str = ""
    selected: bool = False
    created_at: str = Field(default_factory=lambda: datetime.now(timezone.utc).isoformat())
    updated_at: str = Field(default_factory=lambda: datetime.now(timezone.utc).isoformat())
    created_by: str = ""
    updated_by: str = ""
    assessment_status: str = "Not Started"  # Not Started / In Progress / Submitted / Reviewed
    review_comments: str = ""


class Organisation(BaseModel):
    """Top-level organisation record."""

    org_id: str = ""
    org_name: str = ""
    departments: list[Department] = Field(default_factory=list)
    created_at: str = Field(default_factory=lambda: datetime.now(timezone.utc).isoformat())
    created_by: str = ""


# Standard department options
STANDARD_DEPARTMENTS = [
    "HR & People Operations",
    "Recruitment",
    "Sales",
    "Marketing",
    "Customer Support",
    "Finance & Accounts",
    "Legal & Compliance",
    "Procurement & Vendor Management",
    "IT & Information Security",
    "Administration & Facilities",
    "Operations & Delivery",
    "Cloud / DevOps",
    "Data & Analytics",
    "Leadership / Corporate Communications",
]

# Standard data-subject options
DATA_SUBJECTS = [
    "Employees",
    "Candidates",
    "Customers",
    "Prospects",
    "Vendors",
    "Partners",
    "Visitors",
    "Contractors",
    "Children",
    "Other",
]
