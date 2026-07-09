"""PRISM DPDP Web Application — FastAPI with tabbed department workflow.

After department selection and head assignment, each department gets its
own tab for tool selection, data discovery, and control assessment.
"""

from __future__ import annotations

import uuid
from datetime import datetime, timezone

from fastapi import FastAPI, Request
from fastapi.responses import HTMLResponse, RedirectResponse, FileResponse
from fastapi.middleware.cors import CORSMiddleware

from prism_dpdp.models.organisation import STANDARD_DEPARTMENTS, DATA_SUBJECTS, Department
from prism_dpdp.models.tool_catalogue import (
    DEPARTMENT_TOOLS, ToolEntry,
    HOSTING_OPTIONS, DATA_ACCESS_OPTIONS,
    EXISTING_CONTROLS_OPTIONS, DETECTION_SOURCE_OPTIONS, PRISM_INTAKE_OPTIONS,
    KNOWN_TOOL_HOSTING,
)
from prism_dpdp.models.recommendation import PRISM_PILLARS
from prism_dpdp.models.dpdpa_assessment import DPDPA_QUESTIONS
from prism_dpdp.services.assessment_store import AssessmentStore
from prism_dpdp.services.recommendation_engine import RecommendationEngine
from prism_dpdp.services.review_data import build_review_data

import os
BASE = os.environ.get("PRISM_BASE_URL", "")

app = FastAPI(title="PRISM DPDP Governance Platform", docs_url="/api/docs")
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"])
store = AssessmentStore()
engine = RecommendationEngine()


# ─── HTML Helpers ─────────────────────────────────────────────────────────────

def _checkbox_html(name: str, options: list[str], selected: list[str] | None = None) -> str:
    selected = selected or []
    html = '<div class="checkbox-grid">'
    for opt in options:
        checked = "checked" if opt in selected else ""
        html += f'<label class="checkbox-item"><input type="checkbox" name="{name}" value="{opt}" {checked}> {opt}</label>'
    html += '</div>'
    return html


def _grouped_checkbox_html(name: str, groups: dict[str, list[str]], selected: list[str] | None = None, allow_other: bool = False, other_label: str = "Other (specify)") -> str:
    """Render checkboxes organized under category headings, with optional 'Other' input."""
    selected = selected or []
    html = ""
    for category, options in groups.items():
        html += f'<div style="margin-bottom:12px"><h4 style="font-size:0.84rem;color:var(--accent);margin-bottom:4px;border-left:3px solid var(--accent);padding-left:8px">{category}</h4>'
        html += '<div class="checkbox-grid">'
        for opt in options:
            checked = "checked" if opt in selected else ""
            html += f'<label class="checkbox-item"><input type="checkbox" name="{name}" value="{opt}" {checked}> {opt}</label>'
        html += '</div></div>'
    if allow_other:
        html += f'''<div style="margin-top:10px;padding:10px 12px;background:var(--bg3);border:1px dashed var(--line);border-radius:8px">
            <label class="fl" style="margin-top:0">➕ {other_label}</label>
            <input type="text" name="{name}_other" placeholder="Enter additional items separated by commas" style="margin-bottom:0">
        </div>'''
    return html


def _grouped_checkbox_with_tools_html(name: str, groups: dict[str, dict], selected: list[str] | None = None, allow_other: bool = False, other_label: str = "Other (specify)") -> str:
    """Render checkboxes with recommended tools shown as hints under each category.

    groups format: {"Category Name": {"options": [...], "tools": [...]}}
    """
    selected = selected or []
    html = ""
    for category, config in groups.items():
        options = config.get("options", [])
        tools = config.get("tools", [])
        html += f'<div style="margin-bottom:14px"><h4 style="font-size:0.84rem;color:var(--accent);margin-bottom:4px;border-left:3px solid var(--accent);padding-left:8px">{category}</h4>'
        html += '<div class="checkbox-grid">'
        for opt in options:
            checked = "checked" if opt in selected else ""
            html += f'<label class="checkbox-item"><input type="checkbox" name="{name}" value="{opt}" {checked}> {opt}</label>'
        html += '</div>'
        if tools:
            html += f'<div style="margin-top:4px;padding:6px 10px;background:rgba(76,175,125,0.08);border-radius:6px;font-size:0.78rem;color:var(--green)">💡 <strong>Tools that can help:</strong> {", ".join(tools)}</div>'
        html += '</div>'
    if allow_other:
        html += f'''<div style="margin-top:10px;padding:10px 12px;background:var(--bg3);border:1px dashed var(--line);border-radius:8px">
            <label class="fl" style="margin-top:0">➕ {other_label}</label>
            <input type="text" name="{name}_other" placeholder="Enter additional items separated by commas" style="margin-bottom:0">
        </div>'''
    return html


# ─── Grouped options for IT Admin section (with tool recommendations) ─────────

CONTROLS_GROUPED: dict[str, dict] = {
    "Governance & Privacy": {
        "options": ["Privacy notice", "Consent capture", "Data retention rule", "Data deletion process", "Vendor agreement / DPA"],
        "tools": ["OneTrust", "TrustArc", "Securiti.ai", "BigID", "WireWheel", "Osano", "Cookiebot"],
    },
    "Access & Identity": {
        "options": ["Role-based access", "MFA", "Periodic access review"],
        "tools": ["Microsoft Entra ID", "Okta", "CyberArk", "SailPoint", "Saviynt", "OneLogin", "Duo Security"],
    },
    "Data Protection": {
        "options": ["Encryption", "DLP", "Audit logs"],
        "tools": ["Microsoft Purview DLP", "Symantec DLP", "Forcepoint DLP", "Varonis", "Thales CipherTrust", "HashiCorp Vault"],
    },
    "Resilience & Incident Response": {
        "options": ["Backup", "Incident-response process"],
        "tools": ["Veeam", "Commvault", "Rubrik", "PagerDuty", "ServiceNow SecOps", "Splunk SOAR", "TheHive"],
    },
    "Unknown": {
        "options": ["None known", "Unsure"],
        "tools": [],
    },
}

DETECTION_GROUPED: dict[str, dict] = {
    "Human Reporting": {
        "options": ["Employee or manager reports it", "Customer complaint", "Internal audit finding", "Vendor notification"],
        "tools": ["ServiceNow", "Freshservice", "Jira Service Management", "PRISM Incident Form"],
    },
    "Application & Data Security": {
        "options": ["Application audit logs", "DLP alert", "Email / collaboration security alert"],
        "tools": ["Microsoft Purview", "Proofpoint", "Mimecast", "Netskope", "Code42 Incydr"],
    },
    "Endpoint & Network": {
        "options": ["Endpoint security / EDR alert", "Firewall or network alert", "IAM or suspicious-login alert"],
        "tools": ["CrowdStrike Falcon", "SentinelOne", "Microsoft Defender", "Sophos", "Trend Micro", "Palo Alto Cortex XDR"],
    },
    "Cloud & Infrastructure": {
        "options": ["Cloud-security alert", "Backup / ransomware alert", "SIEM / SOC monitoring"],
        "tools": ["Microsoft Sentinel", "Splunk", "Wiz", "AWS GuardDuty", "Google Chronicle", "Elastic SIEM"],
    },
    "Unknown": {
        "options": ["No defined detection source", "Unsure"],
        "tools": [],
    },
}

INTAKE_GROUPED: dict[str, dict] = {
    "Manual": {
        "options": ["Manual incident form", "Alert email"],
        "tools": ["Google Forms", "Microsoft Forms", "Jotform", "ServiceNow"],
    },
    "Log-Based": {
        "options": ["Audit-log upload", "Scheduled log import"],
        "tools": ["Splunk Forwarder", "Elastic Filebeat", "Fluentd", "AWS CloudWatch Logs"],
    },
    "Automated / Integration": {
        "options": ["API connector", "Webhook / event trigger", "SIEM / SOC integration", "Vendor notification portal"],
        "tools": ["Microsoft Sentinel Connectors", "Splunk HEC", "PagerDuty", "Zapier", "Make (Integromat)", "n8n"],
    },
    "Not Configured": {
        "options": ["Not connected yet", "Unsure"],
        "tools": [],
    },
}


import re

_LINK_RE = re.compile(r'(href|action)="(/[^"]*?)"')

def _rewrite_links(html: str) -> str:
    """Prefix all root-relative href/action attributes with BASE."""
    if not BASE:
        return html
    return _LINK_RE.sub(lambda m: f'{m.group(1)}="{BASE}{m.group(2)}"', html)


def _page(title: str, content: str, step: str = "") -> str:
    html = f"""<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0">
<title>PRISM — {title}</title>
<link href="https://fonts.googleapis.com/css2?family=IBM+Plex+Sans:wght@400;500;600;700&family=IBM+Plex+Mono:wght@400;600&display=swap" rel="stylesheet">
<style>
:root{{
  --bg:#E7EEF5;--bg2:#E7EEF5;--bg3:#DFE6EF;--bg4:#D6DFE9;
  --ink:#3E5771;--muted:#5B7A99;--muted2:#8A9DB5;
  --line:rgba(163,177,198,0.35);
  --accent:#6E8CAE;--green:#4CAF7D;--red:#D65B5B;--amber:#D49A4E;--teal:#4CA8A0;
  --neu-light:rgba(255,255,255,0.8);--neu-dark:rgba(163,177,198,0.6);
  --neu-raised:8px 8px 20px var(--neu-dark),-8px -8px 20px var(--neu-light);
  --neu-raised-sm:4px 4px 10px var(--neu-dark),-4px -4px 10px var(--neu-light);
  --neu-inset:inset 4px 4px 10px var(--neu-dark),inset -4px -4px 10px var(--neu-light);
  --neu-inset-sm:inset 2px 2px 6px var(--neu-dark),inset -2px -2px 6px var(--neu-light);
  --font:'IBM Plex Sans',-apple-system,BlinkMacSystemFont,sans-serif;
  --mono:'IBM Plex Mono',monospace;
  --r:16px;--r-sm:12px;--r-xs:8px;
}}
*{{margin:0;padding:0;box-sizing:border-box}}
body{{font-family:var(--font);background:var(--bg);color:var(--ink);line-height:1.6;min-height:100vh}}
.container{{max-width:960px;margin:0 auto;padding:24px 20px}}
.header{{background:var(--bg);border-radius:var(--r);padding:20px 24px;margin-bottom:20px;text-align:center;box-shadow:var(--neu-raised)}}
.header-logo{{height:48px;overflow:hidden;display:flex;align-items:center;justify-content:center;margin:0 auto 10px}}
.header-logo img{{height:68px;transform:scale(0.62);transform-origin:center center}}
.header h1{{font-size:1.15rem;font-weight:700;color:var(--ink);margin-bottom:2px}}
.header p{{font-size:0.84rem;color:var(--muted)}}
.step{{background:var(--bg);border-radius:var(--r-sm);padding:10px 16px;margin-bottom:16px;font-size:0.84rem;color:var(--muted);box-shadow:var(--neu-raised-sm)}}
.card{{background:var(--bg);border-radius:var(--r);padding:20px 24px;margin-bottom:14px;box-shadow:var(--neu-raised)}}
.card h2{{font-size:1.0rem;font-weight:700;margin-bottom:10px;color:var(--ink)}}
.card h3{{font-size:0.9rem;font-weight:600;margin-bottom:8px;color:var(--muted)}}
.checkbox-grid{{display:grid;grid-template-columns:repeat(auto-fill,minmax(240px,1fr));gap:6px;margin:10px 0}}
.checkbox-item{{display:flex;align-items:center;gap:8px;padding:6px 10px;background:var(--bg);border-radius:var(--r-xs);font-size:0.84rem;cursor:pointer;box-shadow:var(--neu-raised-sm);transition:box-shadow 0.15s}}
.checkbox-item:hover{{box-shadow:var(--neu-inset-sm)}}
.checkbox-item input{{width:15px;height:15px;accent-color:var(--accent)}}
.btn{{display:inline-block;background:linear-gradient(135deg,var(--ink),var(--teal));color:#fff;border:none;padding:10px 22px;border-radius:var(--r-xs);font-size:0.9rem;font-family:var(--font);font-weight:600;cursor:pointer;text-decoration:none;margin-top:12px;box-shadow:var(--neu-raised-sm);transition:box-shadow 0.2s,opacity 0.2s}}
.btn:hover{{box-shadow:var(--neu-inset-sm);opacity:0.9}}
.btn-sm{{padding:6px 14px;font-size:0.8rem;margin-top:0}}
.btn-secondary{{background:var(--bg);color:var(--ink);box-shadow:var(--neu-raised-sm)}}
.btn-secondary:hover{{box-shadow:var(--neu-inset-sm)}}
.btn-green{{background:linear-gradient(135deg,var(--teal),var(--green))}}
input[type="text"],select{{width:100%;padding:8px 12px;border:none;border-radius:var(--r-xs);font-size:0.85rem;font-family:var(--font);background:var(--bg);color:var(--ink);box-shadow:var(--neu-inset-sm);outline:none;margin:3px 0 10px}}
input[type="text"]::placeholder{{color:var(--muted2)}}
label.fl{{font-weight:600;font-size:0.84rem;color:var(--muted);display:block;margin-top:8px}}
.tabs{{display:flex;flex-wrap:wrap;gap:4px;margin-bottom:16px;padding-bottom:0}}
.tab{{padding:8px 16px;border-radius:var(--r-xs);background:var(--bg);font-size:0.84rem;cursor:pointer;text-decoration:none;color:var(--muted);box-shadow:var(--neu-raised-sm);transition:box-shadow 0.15s,color 0.15s}}
.tab:hover{{box-shadow:var(--neu-inset-sm);color:var(--ink)}}
.tab.active{{box-shadow:var(--neu-inset-sm);color:var(--accent);font-weight:700}}
.tab-content{{display:none}}.tab-content.active{{display:block}}
table{{width:100%;border-collapse:collapse;font-size:0.84rem;margin:10px 0}}
th{{text-align:left;padding:8px 10px;font-size:0.75rem;text-transform:uppercase;letter-spacing:0.04em;color:var(--muted2);font-weight:700;font-family:var(--mono)}}
td{{padding:8px 10px;border-bottom:1px solid var(--line);color:var(--ink)}}
tr:last-child td{{border-bottom:none}}
.badge{{display:inline-block;padding:2px 8px;border-radius:999px;font-size:0.72rem;font-weight:700}}
.badge-P{{background:rgba(76,168,160,0.12);color:var(--teal)}}
.badge-R{{background:rgba(212,154,78,0.12);color:var(--amber)}}
.badge-I{{background:rgba(76,175,125,0.12);color:var(--green)}}
.badge-S{{background:rgba(110,140,174,0.12);color:var(--accent)}}
.badge-M{{background:rgba(214,91,91,0.12);color:var(--red)}}
.badge-Critical{{background:rgba(214,91,91,0.15);color:var(--red)}}
.badge-High{{background:rgba(212,154,78,0.15);color:var(--amber)}}
.badge-Medium{{background:rgba(110,140,174,0.15);color:var(--accent)}}
.badge-Low{{background:rgba(76,175,125,0.15);color:var(--green)}}
.score-bar{{height:10px;background:var(--bg3);border-radius:999px;overflow:hidden;margin:4px 0;box-shadow:var(--neu-inset-sm)}}
.score-fill{{height:100%;border-radius:999px}}
.nav{{display:flex;gap:10px;margin-top:14px;flex-wrap:wrap}}
.section-sep{{border-top:1px solid var(--line);margin:16px 0;padding-top:12px}}
h4{{font-size:0.84rem;color:var(--accent);margin-bottom:4px;border-left:3px solid var(--accent);padding-left:8px}}
</style>
</head>
<body>
<div class="container">
<div class="header">
  <div class="header-logo"><img src="/prism-logo.png" alt="PRISM" /></div>
  <h1>Personal Data Discovery & Governance</h1>
  <p>Map your data, assess controls, and build your DPDPA compliance programme.</p>
</div>
{f'<div class="step">{step}</div>' if step else ''}
{content}
</div>
</body>
</html>"""
    return _rewrite_links(html)


# ─── Step 1: Home ─────────────────────────────────────────────────────────────

@app.get("/", response_class=HTMLResponse)
async def home():
    content = """
    <div class="card" style="text-align:center">
        <h2>Welcome to PRISM</h2>
        <p style="color:#6B7280;margin:10px 0 16px">Identify what personal data your organisation handles, where it lives, and what to do next — through guided checkboxes.</p>
        <a href="/departments" class="btn">Start Assessment →</a>
    </div>"""
    return _page("Home", content)


# ─── Step 2: Department Selection ─────────────────────────────────────────────

@app.get("/departments", response_class=HTMLResponse)
async def departments_page():
    existing = store.load_departments()
    selected_names = [d.name for d in existing if d.selected]
    checkboxes = _checkbox_html("departments", STANDARD_DEPARTMENTS, selected_names)
    content = f"""
    <div class="card">
        <h2>Select Your Departments</h2>
        <p style="color:#6B7280;margin-bottom:12px">Which departments handle or might handle personal data?</p>
        <form method="post" action="/departments/save">
            {checkboxes}
            <button type="submit" class="btn">Continue →</button>
        </form>
    </div>"""
    return _page("Departments", content, step="Step 1 of 5 — Department Selection")


@app.post("/departments/save")
async def save_departments(request: Request):
    form = await request.form()
    selected = form.getlist("departments")
    now = datetime.now(timezone.utc).isoformat()
    departments = []
    for name in selected:
        dept_id = name.replace(" ", "_").replace("&", "").replace("/", "_").strip("_")
        departments.append(Department(
            department_id=dept_id, name=name, selected=True,
            handles_personal_data="Unsure", created_at=now, updated_at=now,
        ))
    store.save_departments(departments)
    return RedirectResponse(url=f"{BASE}/departments/heads", status_code=303)


# ─── Step 3: Department Heads (then tabs for each) ────────────────────────────

@app.get("/departments/heads", response_class=HTMLResponse)
async def department_heads_page():
    departments = store.load_departments()
    if not departments:
        return RedirectResponse(url=f"{BASE}/departments")

    rows = ""
    for dept in departments:
        rows += f"""
        <tr>
            <td><strong>{dept.name}</strong></td>
            <td><input type="text" name="head_{dept.department_id}" value="{dept.department_head}" placeholder="Name or role" style="margin:0"></td>
            <td><input type="text" name="owner_{dept.department_id}" value="{dept.assessment_owner}" placeholder="Person completing assessment" style="margin:0"></td>
            <td>
                <select name="handles_{dept.department_id}" style="margin:0">
                    <option value="Yes" {'selected' if dept.handles_personal_data=='Yes' else ''}>Yes</option>
                    <option value="No" {'selected' if dept.handles_personal_data=='No' else ''}>No</option>
                    <option value="Unsure" {'selected' if dept.handles_personal_data=='Unsure' else ''}>Unsure</option>
                </select>
            </td>
        </tr>"""

    content = f"""
    <div class="card">
        <h2>Department Heads & Ownership</h2>
        <p style="color:#6B7280;margin-bottom:12px">Assign a head and assessment owner for each department.</p>
        <form method="post" action="/departments/heads/save">
            <table>
                <thead><tr><th>Department</th><th>Department Head</th><th>Assessment Owner</th><th>Handles PD?</th></tr></thead>
                <tbody>{rows}</tbody>
            </table>
            <button type="submit" class="btn">Continue to Department Assessments →</button>
        </form>
    </div>"""
    return _page("Department Heads", content, step="Step 2 of 5 — Department Ownership")


@app.post("/departments/heads/save")
async def save_department_heads(request: Request):
    form = await request.form()
    departments = store.load_departments()
    now = datetime.now(timezone.utc).isoformat()
    for dept in departments:
        dept.department_head = form.get(f"head_{dept.department_id}", "")
        dept.assessment_owner = form.get(f"owner_{dept.department_id}", "")
        dept.handles_personal_data = form.get(f"handles_{dept.department_id}", "Unsure")
        dept.updated_at = now
    store.save_departments(departments)
    # Redirect to the tabbed department view — first department
    active_depts = [d for d in departments if d.handles_personal_data != "No"]
    if active_depts:
        return RedirectResponse(url=f"{BASE}/department/{active_depts[0].department_id}", status_code=303)
    return RedirectResponse(url=f"{BASE}/review", status_code=303)


# ─── Step 4: Per-Department Tabbed Assessment ─────────────────────────────────

@app.get("/department/{dept_id}", response_class=HTMLResponse)
async def department_tab_page(dept_id: str):
    """Department Owner view — tools, data subjects, personal data, hosting, access."""
    departments = store.load_departments()
    active_depts = [d for d in departments if d.handles_personal_data != "No"]
    current = next((d for d in active_depts if d.department_id == dept_id), None)
    if not current:
        return RedirectResponse(url=f"{BASE}/departments")

    existing_tools = store.load_tools()
    dept_tools = [t for t in existing_tools if t.department_id == dept_id]
    selected_tool_names = [t.tool_name for t in dept_tools]

    # Build tabs
    tabs_html = ""
    for d in active_depts:
        active_class = "active" if d.department_id == dept_id else ""
        tabs_html += f'<a href="/department/{d.department_id}" class="tab {active_class}">{d.name}</a>'

    # Tool catalogue for this department
    catalogue = DEPARTMENT_TOOLS.get(current.name, {})
    tool_groups = catalogue.get("tool_groups", {"Other": []})
    personal_data = catalogue.get("personal_data", ["Other"])

    # Use grouped checkbox with "other" input for tools
    grouped_tools_html = _grouped_checkbox_html("tools", tool_groups, selected_tool_names, allow_other=True, other_label="Any other tools not listed above?")

    data_checkboxes = _checkbox_html("data", personal_data, dept_tools[0].personal_data_categories if dept_tools else [])
    subject_checkboxes = _checkbox_html("subjects", DATA_SUBJECTS, current.data_subjects)

    content = f"""
    <div class="tabs">{tabs_html}</div>

    <form method="post" action="/department/{dept_id}/save">
    <div class="card">
        <h2>📋 {current.name}</h2>
        <p style="color:#6B7280;font-size:0.85rem">Head: {current.department_head or '—'} | Assessment Owner: {current.assessment_owner or '—'}</p>
        {'<div style="background:rgba(110,140,174,0.10);border:1px solid rgba(110,140,174,0.25);border-radius:8px;padding:12px 16px;margin-top:12px;font-size:0.84rem;color:var(--accent)"><strong>📌 Note:</strong> IT manages the infrastructure that processes and protects personal data across the entire organisation. Select the security tools and platforms your team operates — these form the foundation of your organisation&rsquo;s data protection posture.</div>' if 'IT' in current.name else ''}

        <div class="section-sep"></div>
        <h3>Who are the data subjects?</h3>
        {subject_checkboxes}
        <div style="margin-top:8px;padding:10px 12px;background:var(--bg3);border:1px dashed var(--line);border-radius:8px">
            <label class="fl" style="margin-top:0">➕ Other data subjects not listed above?</label>
            <input type="text" name="subjects_other" placeholder="Enter additional subjects separated by commas" style="margin-bottom:0">
        </div>

        <div class="section-sep"></div>
        <h3>Which tools, systems or records does this department use?</h3>
        <p style="color:#6B7280;font-size:0.82rem;margin-bottom:8px">Select all that apply, grouped by category.</p>
        {grouped_tools_html}

        <div class="section-sep"></div>
        <h3>What personal data is captured in these tools?</h3>
        {data_checkboxes}
        <div style="margin-top:8px;padding:10px 12px;background:var(--bg3);border:1px dashed var(--line);border-radius:8px">
            <label class="fl" style="margin-top:0">➕ Any other personal data not listed above?</label>
            <input type="text" name="data_other" placeholder="Enter additional data types separated by commas" style="margin-bottom:0">
        </div>

        <div class="section-sep"></div>
        <h3>Where is the data hosted?</h3>
        <p style="color:#6B7280;font-size:0.82rem;margin-bottom:6px">This applies to tools not already in our known hosting database. Tools like Zoho, Keka, Freshdesk (India), Microsoft 365, Salesforce (Multiple locations) etc. are pre-filled automatically.</p>
        <select name="hosting">{''.join(f'<option value="{o}">{o}</option>' for o in HOSTING_OPTIONS)}</select>

        <h3>Who can access the data?</h3>
        {_checkbox_html("access", DATA_ACCESS_OPTIONS, dept_tools[0].data_access if dept_tools else [])}
        <div style="margin-top:8px;padding:10px 12px;background:var(--bg3);border:1px dashed var(--line);border-radius:8px">
            <label class="fl" style="margin-top:0">➕ Any other roles with access not listed above?</label>
            <input type="text" name="access_other" placeholder="Enter additional roles separated by commas" style="margin-bottom:0">
        </div>
    </div>

    <div class="nav">
        <button type="submit" class="btn btn-green">💾 Save {current.name}</button>
        <a href="/it-review" class="btn">IT Admin Section →</a>
        <a href="/review" class="btn btn-secondary">Skip to Review →</a>
    </div>
    </form>
    """
    return _page(current.name, content, step=f"Step 3 of 5 — {current.name} (Department Owner)")


# ─── IT Administrator View (single page, applies to all departments) ──────────

@app.get("/it-review", response_class=HTMLResponse)
async def it_admin_page():
    """IT Administrator view — single page for org-wide controls, detection, intake.

    These answers apply across all departments and tools.
    """
    departments = store.load_departments()
    active_depts = [d for d in departments if d.handles_personal_data != "No"]
    all_tools = store.load_tools()

    if not all_tools:
        tool_list_html = '<p style="color:var(--amber);margin-bottom:12px">⚠️ No tools declared yet. Department owners must complete their sections first.</p>'
    else:
        # Group tools by department for display
        tool_list_html = '<div style="margin-bottom:16px">'
        for dept in active_depts:
            dept_tools = [t for t in all_tools if t.department_id == dept.department_id]
            if dept_tools:
                tool_list_html += f'<p style="margin-bottom:4px"><strong>{dept.name}:</strong> {", ".join(t.tool_name for t in dept_tools)}</p>'
        tool_list_html += '</div>'

    # Get existing answers (from first tool that has them, since they're org-wide)
    existing_controls: list[str] = []
    existing_detection: list[str] = []
    existing_intake: list[str] = []
    for t in all_tools:
        if t.existing_controls:
            existing_controls = t.existing_controls
            break
    for t in all_tools:
        if t.detection_sources:
            existing_detection = t.detection_sources
            break
    for t in all_tools:
        if t.prism_intake_methods:
            existing_intake = t.prism_intake_methods
            break

    # Build IT operational capabilities section
    existing_summary = store.load_review_summary()
    it_ops = existing_summary.get("it_operations", {})

    IT_OPS_SECTIONS = {
        "Backup & Recovery": {
            "question": "How is backup managed for systems containing personal data?",
            "options": [
                "Automated daily backups configured",
                "Backup covers all critical systems",
                "Backup tested/restored periodically",
                "Offsite/cloud backup copy maintained",
                "Backup encryption enabled",
                "Backup retention policy defined",
                "Backup monitoring and alerting active",
                "Backup failure notification configured",
                "Not configured",
                "Unsure",
            ],
            "tools": ["Veeam", "Commvault", "Rubrik", "Acronis", "AWS Backup", "Azure Backup", "Druva", "Cohesity"],
        },
        "Disaster Recovery & Business Continuity": {
            "question": "What DR/BCP capabilities exist for personal data systems?",
            "options": [
                "DR plan documented and approved",
                "DR site/region configured",
                "Failover tested in last 12 months",
                "RTO and RPO defined per system",
                "DR runbook available",
                "Communication plan for DR events",
                "Data replication to DR site active",
                "Not configured",
                "Unsure",
            ],
            "tools": ["Zerto", "Veeam DR", "Azure Site Recovery", "AWS Disaster Recovery", "Commvault DR"],
        },
        "Web Application Firewall (WAF) & API Security": {
            "question": "How are customer-facing applications protected?",
            "options": [
                "WAF deployed on all public apps",
                "Bot protection enabled",
                "DDoS protection active",
                "API gateway with rate limiting",
                "OWASP Top 10 rules configured",
                "SSL/TLS inspection enabled",
                "Web traffic logging and monitoring",
                "Not configured",
                "Unsure",
            ],
            "tools": ["AWS WAF", "Azure WAF", "Cloudflare WAF", "Akamai", "Imperva", "F5 BIG-IP", "Barracuda WAF"],
        },
        "Data Archival & Retention": {
            "question": "How is data archived and retained for compliance?",
            "options": [
                "Archival policy defined per data type",
                "Automated archival rules configured",
                "Archived data encrypted",
                "Archived data searchable for DSR requests",
                "Retention periods enforced automatically",
                "Deletion at end of retention verified",
                "Legal hold capability available",
                "Not configured",
                "Unsure",
            ],
            "tools": ["Microsoft Purview Retention", "Veritas Enterprise Vault", "AWS Glacier", "Azure Archive Storage", "Google Archive Storage", "Druva"],
        },
        "Email Archival & eDiscovery": {
            "question": "How is email data preserved and retrievable?",
            "options": [
                "Email archival enabled for all users",
                "Retention policies applied to mailboxes",
                "eDiscovery/search available for investigations",
                "Journal rules configured",
                "Litigation hold capability available",
                "Not configured",
                "Unsure",
            ],
            "tools": ["Microsoft Purview eDiscovery", "Google Vault", "Mimecast Archive", "Proofpoint Archive", "Barracuda Archiver"],
        },
        "Patch Management & Vulnerability Remediation": {
            "question": "How are security patches managed across systems with personal data?",
            "options": [
                "Automated patching for OS",
                "Automated patching for applications",
                "Critical patches applied within 72 hours",
                "Vulnerability scanning scheduled",
                "Patch compliance reporting active",
                "Third-party app patching covered",
                "Not configured",
                "Unsure",
            ],
            "tools": ["Microsoft Intune", "WSUS", "Ivanti Patch", "ManageEngine Patch Manager", "Automox", "Qualys VMDR"],
        },
        "Network Segmentation & Zero Trust": {
            "question": "How is network access to personal data systems controlled?",
            "options": [
                "Network segmentation between departments",
                "Production data isolated from dev/test",
                "Micro-segmentation for critical databases",
                "Zero Trust architecture implemented",
                "Lateral movement prevention controls",
                "Network access logging enabled",
                "Not configured",
                "Unsure",
            ],
            "tools": ["Zscaler ZTA", "Palo Alto Prisma Access", "Cisco ISE", "Illumio", "VMware NSX", "Cloudflare Zero Trust"],
        },
    }

    it_ops_html = ""
    for section_name, section_config in IT_OPS_SECTIONS.items():
        existing_answers = it_ops.get(section_name, [])
        checkboxes = _checkbox_html(f"itops_{section_name.replace(' ', '_').replace('&','').replace('/','_')}", section_config["options"], existing_answers)
        tools_hint = f'<div style="margin-top:4px;padding:6px 10px;background:rgba(76,175,125,0.08);border-radius:6px;font-size:0.78rem;color:var(--green)">💡 <strong>Common tools:</strong> {", ".join(section_config["tools"])}</div>'
        it_ops_html += f"""
        <div style="margin-bottom:16px;padding-bottom:14px;border-bottom:1px solid #E2E8F0">
            <h4 style="font-size:0.88rem;color:var(--accent);margin-bottom:2px;border-left:3px solid var(--accent);padding-left:8px">{section_name}</h4>
            <p style="font-size:0.82rem;color:#6B7280;margin-bottom:6px">{section_config['question']}</p>
            {checkboxes}
            {tools_hint}
        </div>"""

    content = f"""
    <form method="post" action="/it-review/save">
    <div class="card">
        <h2>🔒 IT & Security Assessment</h2>
        <p style="color:#6B7280;font-size:0.85rem;margin-bottom:12px">
            This section is for <strong>IT Administrators / Security Team</strong> only.<br>
            Your answers will apply across all departments and tools listed below.
        </p>

        <div style="background:var(--bg3);padding:12px 16px;border-radius:8px;margin-bottom:16px">
            <strong style="font-size:0.84rem">Tools declared across the organisation:</strong>
            {tool_list_html}
        </div>

        <div class="section-sep"></div>
        <h3>Which controls are currently in place across these tools?</h3>
        <p style="color:#6B7280;font-size:0.82rem;margin-bottom:8px">Select all security and governance controls that are configured and active organisation-wide.</p>
        {_grouped_checkbox_with_tools_html("controls", CONTROLS_GROUPED, existing_controls, allow_other=True, other_label="Any other controls not listed above?")}

        <div class="section-sep"></div>
        <h3>How would you detect a data breach in these tools?</h3>
        <p style="color:#6B7280;font-size:0.82rem;margin-bottom:8px">Select all detection mechanisms that would alert you if data was exposed, lost, misused or accessed without authorisation.</p>
        {_grouped_checkbox_with_tools_html("detection", DETECTION_GROUPED, existing_detection, allow_other=True, other_label="Any other detection sources not listed above?")}

        <div class="section-sep"></div>
        <h3>How can PRISM receive alert or incident information?</h3>
        <p style="color:#6B7280;font-size:0.82rem;margin-bottom:8px">Select how incident data can flow into PRISM for tracking and governance.</p>
        {_grouped_checkbox_with_tools_html("intake", INTAKE_GROUPED, existing_intake, allow_other=True, other_label="Any other intake methods not listed above?")}
    </div>

    <div class="card">
        <h2>🏗️ IT Operational Capabilities for Data Protection</h2>
        <p style="color:#6B7280;font-size:0.85rem;margin-bottom:12px">
            How does IT manage backup, recovery, archival, WAF and business continuity for systems containing personal data?
            These capabilities are critical for DPDPA breach readiness and data availability.
        </p>
        {it_ops_html}
    </div>

    <div class="nav">
        <button type="submit" class="btn btn-green">💾 Save IT Assessment</button>
        <a href="/dpdpa-assessment" class="btn">Continue to DPDPA Assessment →</a>
    </div>
    </form>
    """
    return _page("IT & Security Assessment", content, step="Step 4 of 5 — IT Administrator (Organisation-Wide)")


@app.post("/it-review/save")
async def save_it_assessment(request: Request):
    """Save IT administrator answers — applies to ALL tools across all departments."""
    form = await request.form()
    now = datetime.now(timezone.utc).isoformat()

    controls = list(form.getlist("controls"))
    detection = list(form.getlist("detection"))
    intake = list(form.getlist("intake"))

    # Append custom "other" entries
    controls_other = form.get("controls_other", "").strip()
    if controls_other:
        controls.extend([c.strip() for c in controls_other.split(",") if c.strip()])

    detection_other = form.get("detection_other", "").strip()
    if detection_other:
        detection.extend([d.strip() for d in detection_other.split(",") if d.strip()])

    intake_other = form.get("intake_other", "").strip()
    if intake_other:
        intake.extend([i.strip() for i in intake_other.split(",") if i.strip()])

    # Apply to ALL tools across all departments
    all_tools = store.load_tools()
    for tool in all_tools:
        tool.existing_controls = controls
        tool.detection_sources = detection
        tool.prism_intake_methods = intake
        tool.updated_at = now
        tool.updated_by = "IT Administrator"
        tool.assessment_status = "Submitted"

    store.save_tools(all_tools)

    # Save IT operational capabilities
    IT_OPS_KEYS = [
        "Backup__Recovery",
        "Disaster_Recovery__Business_Continuity",
        "Web_Application_Firewall_(WAF)__API_Security",
        "Data_Archival__Retention",
        "Email_Archival__eDiscovery",
        "Patch_Management__Vulnerability_Remediation",
        "Network_Segmentation__Zero_Trust",
    ]
    IT_OPS_NAMES = [
        "Backup & Recovery",
        "Disaster Recovery & Business Continuity",
        "Web Application Firewall (WAF) & API Security",
        "Data Archival & Retention",
        "Email Archival & eDiscovery",
        "Patch Management & Vulnerability Remediation",
        "Network Segmentation & Zero Trust",
    ]

    it_ops: dict[str, list[str]] = {}
    for key, name in zip(IT_OPS_KEYS, IT_OPS_NAMES):
        field_name = f"itops_{key}"
        values = list(form.getlist(field_name))
        if values:
            it_ops[name] = values

    summary = store.load_review_summary()
    summary["it_operations"] = it_ops
    summary["it_assessment_completed"] = True
    summary["it_assessment_date"] = now
    store.save_review_summary(summary)

    return RedirectResponse(url=f"{BASE}/dpdpa-assessment", status_code=303)


# ─── DPDPA Compliance Assessment ─────────────────────────────────────────────

@app.get("/dpdpa-assessment", response_class=HTMLResponse)
async def dpdpa_assessment_page():
    """DPDPA-specific compliance questions based on actual Act obligations."""
    # Load existing answers
    existing = store.load_review_summary().get("dpdpa_answers", {})

    # Group questions by pillar
    pillar_groups: dict[str, list[dict]] = {"P": [], "R": [], "I": [], "S": [], "M": []}
    for q in DPDPA_QUESTIONS:
        pillar_groups[q["pillar"]].append(q)

    forms_html = ""
    for pillar, label in PRISM_PILLARS.items():
        questions = pillar_groups.get(pillar, [])
        if not questions:
            continue
        forms_html += f'<div class="card"><h2><span class="badge badge-{pillar}">{pillar}</span> {label}</h2>'
        for q in questions:
            current_answer = existing.get(q["id"], "")
            options_html = ""
            for opt in q["options"]:
                checked = "checked" if opt == current_answer else ""
                options_html += f'<label class="checkbox-item"><input type="radio" name="{q["id"]}" value="{opt}" {checked}> {opt}</label>'
            forms_html += f'''
            <div style="margin-bottom:16px;padding-bottom:12px;border-bottom:1px solid #F1F5F9">
                <p style="font-weight:600;font-size:0.88rem;margin-bottom:2px">{q["question"]}</p>
                <p style="font-size:0.78rem;color:#6B7280;margin-bottom:6px">DPDPA Reference: {q["dpdpa_section"]}</p>
                <div class="checkbox-grid" style="grid-template-columns:repeat(auto-fill,minmax(140px,1fr))">{options_html}</div>
            </div>'''
        forms_html += '</div>'

    content = f"""
    <form method="post" action="/dpdpa-assessment/save">
        <div class="card">
            <h2>📜 DPDPA Readiness Assessment</h2>
            <p style="color:#6B7280;font-size:0.85rem">Answer these questions based on your organisation's current state. These map directly to obligations under the Digital Personal Data Protection Act, 2023.</p>
        </div>
        {forms_html}
        <button type="submit" class="btn btn-green">💾 Save & View Results →</button>
    </form>
    """
    return _page("DPDPA Assessment", content, step="Step 4b of 5 — DPDPA Compliance Assessment")


@app.post("/dpdpa-assessment/save")
async def save_dpdpa_assessment(request: Request):
    form = await request.form()
    answers: dict[str, str] = {}
    for q in DPDPA_QUESTIONS:
        answers[q["id"]] = form.get(q["id"], "")

    # Save to review summary
    summary = store.load_review_summary()
    summary["dpdpa_answers"] = answers
    store.save_review_summary(summary)

    return RedirectResponse(url=f"{BASE}/review", status_code=303)


@app.post("/department/{dept_id}/save")
async def save_department_assessment(dept_id: str, request: Request):
    """Save department owner answers — tools, data subjects, personal data, hosting, access."""
    form = await request.form()
    departments = store.load_departments()
    active_depts = [d for d in departments if d.handles_personal_data != "No"]
    now = datetime.now(timezone.utc).isoformat()

    # Update department subjects (including custom "other" entries)
    subjects = list(form.getlist("subjects"))
    subjects_other = form.get("subjects_other", "").strip()
    if subjects_other:
        subjects.extend([s.strip() for s in subjects_other.split(",") if s.strip()])

    for dept in departments:
        if dept.department_id == dept_id:
            dept.data_subjects = subjects
            dept.updated_at = now
            dept.assessment_status = "In Progress"
    store.save_departments(departments)

    # Save tools for this department
    selected_tools = list(form.getlist("tools"))
    # Add custom tools from the "other" input
    tools_other = form.get("tools_other", "").strip()
    custom_tools_from_other = [t.strip() for t in tools_other.split(",") if t.strip()] if tools_other else []

    personal_data = list(form.getlist("data"))
    data_other = form.get("data_other", "").strip()
    if data_other:
        personal_data.extend([d.strip() for d in data_other.split(",") if d.strip()])

    hosting = form.get("hosting", "Unknown")
    access = list(form.getlist("access"))
    access_other = form.get("access_other", "").strip()
    if access_other:
        access.extend([a.strip() for a in access_other.split(",") if a.strip()])

    # Load existing tools and remove old ones for this dept
    all_tools = [t for t in store.load_tools() if t.department_id != dept_id]

    for tool_name in selected_tools:
        hosting_for_tool = KNOWN_TOOL_HOSTING.get(tool_name, hosting)
        all_tools.append(ToolEntry(
            tool_id=f"TOOL-{uuid.uuid4().hex[:6].upper()}",
            department_id=dept_id, category=dept_id, tool_name=tool_name,
            personal_data_categories=personal_data,
            collects_personal_data="Yes",
            hosting_location=hosting_for_tool, data_access=access,
            assessment_status="In Progress",
            created_at=now, updated_at=now,
        ))

    for custom_name in custom_tools_from_other:
        hosting_for_tool = KNOWN_TOOL_HOSTING.get(custom_name, hosting)
        all_tools.append(ToolEntry(
            tool_id=f"TOOL-{uuid.uuid4().hex[:6].upper()}",
            department_id=dept_id, category=dept_id, tool_name=custom_name,
            is_custom=True, personal_data_categories=personal_data,
            collects_personal_data="Yes",
            hosting_location=hosting_for_tool, data_access=access,
            assessment_status="In Progress",
            created_at=now, updated_at=now,
        ))

    store.save_tools(all_tools)

    # Navigate to next department tab
    current_idx = next((i for i, d in enumerate(active_depts) if d.department_id == dept_id), -1)
    if current_idx < len(active_depts) - 1:
        next_dept = active_depts[current_idx + 1]
        return RedirectResponse(url=f"{BASE}/department/{next_dept.department_id}", status_code=303)

    # All departments done — go to IT review
    return RedirectResponse(url=f"{BASE}/it-review", status_code=303)


# ─── Step 5: Review Dashboard ─────────────────────────────────────────────────

@app.get("/review", response_class=HTMLResponse)
async def review_page():
    departments = store.load_departments()
    tools = store.load_tools()

    # Generate recommendations from tool assessment
    recs = engine.generate_all_recommendations(tools)
    store.save_recommendations(recs)

    # ─── DPDPA-based scoring (from actual assessment answers) ─────────────
    summary = store.load_review_summary()
    dpdpa_answers = summary.get("dpdpa_answers", {})

    pillar_scores: dict[str, dict] = {}
    for pillar in PRISM_PILLARS:
        pillar_questions = [q for q in DPDPA_QUESTIONS if q["pillar"] == pillar]
        total = len(pillar_questions)
        if total == 0:
            pillar_scores[pillar] = {"score": 0, "answered": 0, "total": 0, "yes": 0, "partial": 0, "no": 0}
            continue

        yes_count = 0
        partial_count = 0
        no_count = 0
        na_count = 0
        unanswered = 0

        for q in pillar_questions:
            ans = dpdpa_answers.get(q["id"], "")
            if ans == "Yes":
                yes_count += 1
            elif ans == "Partially":
                partial_count += 1
            elif ans in ("No", "Not Sure"):
                no_count += 1
            elif ans == "Not Applicable":
                na_count += 1
            else:
                unanswered += 1

        applicable = total - na_count
        if applicable == 0:
            score = 100
        elif unanswered == applicable:
            score = 0  # Not yet assessed
        else:
            score = int(((yes_count * 1.0 + partial_count * 0.5) / max(applicable, 1)) * 100)

        pillar_scores[pillar] = {
            "score": score,
            "answered": total - unanswered,
            "total": total,
            "applicable": applicable,
            "yes": yes_count,
            "partial": partial_count,
            "no": no_count,
        }

    # Recommendation rows grouped by timeline
    immediate = [r for r in recs if r.suggested_timeline == "Immediate"]
    thirty = [r for r in recs if r.suggested_timeline == "30 days"]
    sixty = [r for r in recs if r.suggested_timeline == "60 days"]

    def _rec_table(items: list, label: str) -> str:
        if not items:
            return ""
        rows = ""
        for r in items[:15]:  # Limit display
            rows += f"""<tr>
                <td><span class="badge badge-{r.prism_pillar}">{r.prism_pillar}</span></td>
                <td>{r.gap_title}</td>
                <td>{r.tool_name}</td>
                <td><span class="badge badge-{r.severity}">{r.severity}</span></td>
                <td>{r.suggested_owner}</td>
            </tr>"""
        return f"""<h3 style="margin-top:16px">{label} ({len(items)})</h3>
        <table><thead><tr><th>Pillar</th><th>Gap</th><th>Tool</th><th>Severity</th><th>Owner</th></tr></thead>
        <tbody>{rows}</tbody></table>"""

    # Stats
    tools_with_data = sum(1 for t in tools if t.collects_personal_data == "Yes")
    no_detection = sum(1 for t in tools if "No defined detection source" in t.detection_sources or not t.detection_sources)
    critical = sum(1 for r in recs if r.severity == "Critical")
    high = sum(1 for r in recs if r.severity == "High")

    # ─── IT Operational Capabilities Risk Assessment ──────────────────────
    it_ops = summary.get("it_operations", {})
    it_ops_completed = summary.get("it_assessment_completed", False)

    # Define what constitutes a risk per capability area
    IT_OPS_RISK_MAP = {
        "Backup & Recovery": {
            "pillar": "R",
            "critical_items": ["Automated daily backups configured", "Backup covers all critical systems"],
            "important_items": ["Backup tested/restored periodically", "Backup encryption enabled", "Backup monitoring and alerting active"],
            "risk_title": "Backup & Recovery Gap",
            "dpdpa_ref": "Section 8(4) — Reasonable Security Safeguards",
            "dpdpa_impact": "Inability to restore personal data after breach violates duty to maintain data availability. Board may impose penalties up to ₹250 Cr.",
        },
        "Disaster Recovery & Business Continuity": {
            "pillar": "R",
            "critical_items": ["DR plan documented and approved", "RTO and RPO defined per system"],
            "important_items": ["DR site/region configured", "Failover tested in last 12 months", "Data replication to DR site active"],
            "risk_title": "Disaster Recovery Gap",
            "dpdpa_ref": "Section 8(4) — Reasonable Security Safeguards + Section 8(5) — Breach Notification",
            "dpdpa_impact": "Prolonged unavailability of personal data systems delays breach notification (must notify Board 'without delay'). Extended RTO increases breach exposure window.",
        },
        "Web Application Firewall (WAF) & API Security": {
            "pillar": "S",
            "critical_items": ["WAF deployed on all public apps"],
            "important_items": ["DDoS protection active", "OWASP Top 10 rules configured", "Web traffic logging and monitoring"],
            "risk_title": "Web Application Security Gap",
            "dpdpa_ref": "Section 8(4) — Reasonable Security Safeguards",
            "dpdpa_impact": "Unprotected web applications are the #1 entry point for data breaches. Failure to deploy WAF may be deemed 'unreasonable' security under DPDPA.",
        },
        "Data Archival & Retention": {
            "pillar": "P",
            "critical_items": ["Archival policy defined per data type", "Retention periods enforced automatically"],
            "important_items": ["Archived data searchable for DSR requests", "Deletion at end of retention verified"],
            "risk_title": "Data Archival & Retention Gap",
            "dpdpa_ref": "Section 8(7) — Erasure Obligation + Section 11 — Data Principal Rights",
            "dpdpa_impact": "Without archival policy, data may be retained beyond lawful purpose (violates erasure duty). Inability to search archives prevents response to Data Principal access/erasure requests within mandated timelines.",
        },
        "Email Archival & eDiscovery": {
            "pillar": "M",
            "critical_items": ["Email archival enabled for all users"],
            "important_items": ["Retention policies applied to mailboxes", "eDiscovery/search available for investigations"],
            "risk_title": "Email Archival Gap",
            "dpdpa_ref": "Section 8(7) — Erasure + Section 11(2) — Right to Access",
            "dpdpa_impact": "Email is the largest repository of personal data in most organisations. Without archival, you cannot demonstrate compliance to the Data Protection Board or respond to access requests.",
        },
        "Patch Management & Vulnerability Remediation": {
            "pillar": "S",
            "critical_items": ["Automated patching for OS", "Critical patches applied within 72 hours"],
            "important_items": ["Vulnerability scanning scheduled", "Patch compliance reporting active"],
            "risk_title": "Patch & Vulnerability Management Gap",
            "dpdpa_ref": "Section 8(4) — Reasonable Security Safeguards",
            "dpdpa_impact": "Unpatched systems with known vulnerabilities constitute negligent security. Exploited CVEs leading to data breach will be viewed as failure to implement 'reasonable safeguards'.",
        },
        "Network Segmentation & Zero Trust": {
            "pillar": "S",
            "critical_items": ["Network segmentation between departments", "Production data isolated from dev/test"],
            "important_items": ["Zero Trust architecture implemented", "Lateral movement prevention controls"],
            "risk_title": "Network Security Gap",
            "dpdpa_ref": "Section 8(4) — Reasonable Security Safeguards",
            "dpdpa_impact": "Flat network allows lateral movement — single compromised system exposes all personal data. Lack of segmentation increases blast radius of any breach.",
        },
    }

    it_ops_risks: list[dict] = []
    it_ops_pillar_penalties: dict[str, int] = {"P": 0, "R": 0, "I": 0, "S": 0, "M": 0}

    # ─── Evaluate Controls & Detection answers against DPDPA expectations ─
    # Get actual controls and detection answers from tools (IT admin filled these)
    all_tools = store.load_tools()
    actual_controls: set[str] = set()
    actual_detection: set[str] = set()
    for t in all_tools:
        actual_controls.update(t.existing_controls)
        actual_detection.update(t.detection_sources)

    # Critical controls expected under DPDPA
    CONTROL_EXPECTATIONS = [
        {
            "control": "Privacy notice",
            "pillar": "P",
            "severity": "High",
            "dpdpa_ref": "Section 5 — Notice to Data Principal",
            "dpdpa_impact": "DPDPA mandates notice before or at the time of data collection. Without it, all processing may be unlawful.",
        },
        {
            "control": "Consent capture",
            "pillar": "P",
            "severity": "High",
            "dpdpa_ref": "Section 6 — Consent",
            "dpdpa_impact": "Without consent capture mechanism, organisation cannot demonstrate lawful basis for processing.",
        },
        {
            "control": "Data retention rule",
            "pillar": "P",
            "severity": "Medium",
            "dpdpa_ref": "Section 8(7) — Erasure when no longer needed",
            "dpdpa_impact": "Data retained without defined retention periods violates erasure obligation. Board can impose penalties.",
        },
        {
            "control": "Data deletion process",
            "pillar": "P",
            "severity": "Medium",
            "dpdpa_ref": "Section 8(7) — Erasure + Section 12(3) — Withdrawal of consent",
            "dpdpa_impact": "Without deletion process, cannot honour erasure requests or consent withdrawal within mandated timelines.",
        },
        {
            "control": "Role-based access",
            "pillar": "I",
            "severity": "High",
            "dpdpa_ref": "Section 8(4) — Reasonable Security Safeguards",
            "dpdpa_impact": "Unrestricted access to personal data = unauthorized processing. Any access beyond purpose is a violation.",
        },
        {
            "control": "MFA",
            "pillar": "I",
            "severity": "High",
            "dpdpa_ref": "Section 8(4) — Reasonable Security Safeguards",
            "dpdpa_impact": "Compromised credentials without MFA is the leading cause of data breaches. Failure to enable MFA may be deemed unreasonable.",
        },
        {
            "control": "Encryption",
            "pillar": "S",
            "severity": "High",
            "dpdpa_ref": "Section 8(4) — Reasonable Security Safeguards",
            "dpdpa_impact": "Unencrypted personal data is exposed if storage or transmission is compromised. Encryption is a baseline expectation.",
        },
        {
            "control": "Audit logs",
            "pillar": "S",
            "severity": "High",
            "dpdpa_ref": "Section 8(4) — Safeguards + Section 8(5) — Breach Detection",
            "dpdpa_impact": "Without audit logs, cannot detect unauthorized access, investigate breaches, or provide evidence to the Data Protection Board.",
        },
        {
            "control": "DLP",
            "pillar": "S",
            "severity": "Medium",
            "dpdpa_ref": "Section 8(4) — Reasonable Security Safeguards",
            "dpdpa_impact": "Without DLP, personal data can be exfiltrated via email, uploads, or downloads without detection.",
        },
        {
            "control": "Backup",
            "pillar": "R",
            "severity": "High",
            "dpdpa_ref": "Section 8(4) — Data Availability",
            "dpdpa_impact": "Without backup, a ransomware attack or system failure causes permanent loss of personal data. Cannot fulfil access requests.",
        },
        {
            "control": "Incident-response process",
            "pillar": "R",
            "severity": "Critical",
            "dpdpa_ref": "Section 8(5) — Breach Notification",
            "dpdpa_impact": "DPDPA mandates breach notification to Board and Data Principals 'without delay'. Without IR process, this is impossible.",
        },
        {
            "control": "Periodic access review",
            "pillar": "M",
            "severity": "Medium",
            "dpdpa_ref": "Section 8(4) — Safeguards + Section 8 — Accountability",
            "dpdpa_impact": "Stale access creates unauthorized processing risk. Periodic review demonstrates active governance to the Board.",
        },
        {
            "control": "Vendor agreement / DPA",
            "pillar": "P",
            "severity": "High",
            "dpdpa_ref": "Section 8(1) — Processing by Data Processor",
            "dpdpa_impact": "Data Fiduciary is liable for processor actions. Without DPA, no contractual obligation on vendor to protect data or notify breaches.",
        },
    ]

    DETECTION_EXPECTATIONS = [
        {
            "detection": "Application audit logs",
            "pillar": "S",
            "severity": "High",
            "dpdpa_ref": "Section 8(5) — Breach Notification (detection prerequisite)",
            "dpdpa_impact": "Cannot notify what you cannot detect. Audit logs are the primary detection mechanism for unauthorized data access.",
        },
        {
            "detection": "Endpoint security / EDR alert",
            "pillar": "S",
            "severity": "High",
            "dpdpa_ref": "Section 8(4) — Reasonable Security Safeguards",
            "dpdpa_impact": "Endpoints are where personal data is accessed. Without EDR, malware/ransomware exfiltrating data goes undetected.",
        },
        {
            "detection": "DLP alert",
            "pillar": "S",
            "severity": "Medium",
            "dpdpa_ref": "Section 8(4) — Prevention of unauthorized sharing",
            "dpdpa_impact": "DLP alerts detect personal data leaving the organisation via email, cloud, or USB — critical for preventing breaches.",
        },
        {
            "detection": "SIEM / SOC monitoring",
            "pillar": "R",
            "severity": "Medium",
            "dpdpa_ref": "Section 8(5) — Timely breach detection",
            "dpdpa_impact": "SIEM provides correlated detection across systems. Without it, breach detection time increases significantly.",
        },
        {
            "detection": "IAM or suspicious-login alert",
            "pillar": "I",
            "severity": "High",
            "dpdpa_ref": "Section 8(4) — Unauthorized access prevention",
            "dpdpa_impact": "Compromised accounts accessing personal data must be detected immediately. IAM alerts are the first indicator.",
        },
    ]

    # Evaluate missing controls
    if actual_controls and "None known" not in actual_controls and "Unsure" not in actual_controls:
        for exp in CONTROL_EXPECTATIONS:
            if exp["control"] not in actual_controls:
                timeline = "Immediate (0–15 days)" if exp["severity"] == "Critical" else "Urgent (15–30 days)" if exp["severity"] == "High" else "Planned (30–60 days)"
                it_ops_risks.append({
                    "area": f"Control: {exp['control']}",
                    "pillar": exp["pillar"],
                    "severity": exp["severity"],
                    "finding": f"'{exp['control']}' not in place across organisation tools",
                    "dpdpa_ref": exp["dpdpa_ref"],
                    "impact": exp["dpdpa_impact"],
                    "action": f"Implement '{exp['control']}' for all tools handling personal data",
                    "timeline": timeline,
                })
                penalty = 15 if exp["severity"] == "Critical" else 8 if exp["severity"] == "High" else 4
                it_ops_pillar_penalties[exp["pillar"]] += penalty

    # Evaluate missing detection sources
    if actual_detection and "No defined detection source" not in actual_detection and "Unsure" not in actual_detection:
        for exp in DETECTION_EXPECTATIONS:
            if exp["detection"] not in actual_detection:
                timeline = "Urgent (15–30 days)" if exp["severity"] == "High" else "Planned (30–60 days)"
                it_ops_risks.append({
                    "area": f"Detection: {exp['detection']}",
                    "pillar": exp["pillar"],
                    "severity": exp["severity"],
                    "finding": f"'{exp['detection']}' not configured as breach detection source",
                    "dpdpa_ref": exp["dpdpa_ref"],
                    "impact": exp["dpdpa_impact"],
                    "action": f"Configure '{exp['detection']}' to enable breach detection",
                    "timeline": timeline,
                })
                penalty = 8 if exp["severity"] == "High" else 4
                it_ops_pillar_penalties[exp["pillar"]] += penalty

    if it_ops_completed:
        for area_name, risk_config in IT_OPS_RISK_MAP.items():
            answers = it_ops.get(area_name, [])
            pillar = risk_config["pillar"]
            dpdpa_ref = risk_config["dpdpa_ref"]
            dpdpa_impact = risk_config["dpdpa_impact"]

            if not answers or "Not configured" in answers or "Unsure" in answers:
                severity = "Critical" if pillar == "R" else "High"
                timeline = "Immediate (0–15 days)" if severity == "Critical" else "Urgent (15–30 days)"
                it_ops_risks.append({
                    "area": area_name,
                    "pillar": pillar,
                    "severity": severity,
                    "finding": f"{area_name} is not configured or status unknown",
                    "dpdpa_ref": dpdpa_ref,
                    "impact": dpdpa_impact,
                    "action": f"Implement {area_name.lower()} covering all systems with personal data",
                    "timeline": timeline,
                })
                it_ops_pillar_penalties[pillar] += 20
            else:
                missing_critical = [item for item in risk_config["critical_items"] if item not in answers]
                missing_important = [item for item in risk_config["important_items"] if item not in answers]

                if missing_critical:
                    it_ops_risks.append({
                        "area": area_name,
                        "pillar": pillar,
                        "severity": "High",
                        "finding": f"Missing critical: {', '.join(missing_critical)}",
                        "dpdpa_ref": dpdpa_ref,
                        "impact": dpdpa_impact,
                        "action": f"Implement: {', '.join(missing_critical)}",
                        "timeline": "Urgent (15–30 days)",
                    })
                    it_ops_pillar_penalties[pillar] += 10

                if missing_important and not missing_critical:
                    it_ops_risks.append({
                        "area": area_name,
                        "pillar": pillar,
                        "severity": "Medium",
                        "finding": f"Improvement needed: {', '.join(missing_important)}",
                        "dpdpa_ref": dpdpa_ref,
                        "impact": dpdpa_impact,
                        "action": f"Consider: {', '.join(missing_important)}",
                        "timeline": "Planned (30–60 days)",
                    })
                    it_ops_pillar_penalties[pillar] += 5

    # Apply IT Ops penalties to pillar scores
    for pillar in pillar_scores:
        penalty = it_ops_pillar_penalties.get(pillar, 0)
        if penalty > 0:
            pillar_scores[pillar]["score"] = max(0, pillar_scores[pillar]["score"] - penalty)

    # Build pillar HTML (AFTER IT Ops penalties are applied)
    colors = {"P": "#2563EB", "R": "#D97706", "I": "#059669", "S": "#7C3AED", "M": "#DB2777"}
    pillar_html = ""
    for pillar, label in PRISM_PILLARS.items():
        ps = pillar_scores.get(pillar, {"score": 0, "yes": 0, "partial": 0, "no": 0, "total": 0})
        score = ps["score"]
        penalty = it_ops_pillar_penalties.get(pillar, 0)
        penalty_note = f' <span style="color:#EF4444;font-size:0.75rem">(−{penalty}% IT Ops)</span>' if penalty > 0 else ""
        status_color = "#22C55E" if score >= 75 else "#F59E0B" if score >= 40 else "#EF4444"
        pillar_html += f"""
        <tr>
            <td><span class="badge badge-{pillar}">{pillar}</span> {label}</td>
            <td>{ps['yes']} Yes / {ps['partial']} Partial / {ps['no']} No</td>
            <td><div class="score-bar"><div class="score-fill" style="width:{score}%;background:{colors[pillar]}"></div></div></td>
            <td style="color:{status_color}"><strong>{score}%</strong>{penalty_note}</td>
        </tr>"""

    # Build IT Ops risks HTML
    it_ops_risks_html = ""
    if it_ops_risks:
        # Sort by severity: Critical > High > Medium
        sev_order = {"Critical": 0, "High": 1, "Medium": 2}
        it_ops_risks.sort(key=lambda r: sev_order.get(r["severity"], 3))

        risk_rows = ""
        for risk in it_ops_risks:
            sev_color = "#991B1B" if risk["severity"] == "Critical" else "#92400E" if risk["severity"] == "High" else "#3730A3"
            timeline_color = "#991B1B" if "Immediate" in risk["timeline"] else "#92400E" if "Urgent" in risk["timeline"] else "#374151"
            risk_rows += f"""<tr>
                <td><span class="badge badge-{risk['pillar']}">{risk['pillar']}</span></td>
                <td><strong>{risk['area']}</strong></td>
                <td><span style="color:{sev_color};font-weight:600">{risk['severity']}</span></td>
                <td>{risk['finding']}</td>
                <td style="font-size:0.78rem;color:var(--accent)">{risk['dpdpa_ref']}</td>
                <td style="font-size:0.78rem">{risk['impact']}</td>
                <td style="font-size:0.78rem">{risk['action']}</td>
                <td style="font-weight:600;color:{timeline_color};font-size:0.78rem;white-space:nowrap">{risk['timeline']}</td>
            </tr>"""
        it_ops_risks_html = f"""
        <div class="card">
            <h2>🏗️ IT Operational Risks & DPDPA Impact — Action Plan</h2>
            <p style="color:#6B7280;font-size:0.82rem;margin-bottom:10px">Gaps in IT operational capabilities directly affect DPDPA compliance. Timelines indicate how urgently each action should be deployed.</p>
            <table>
                <thead><tr><th>Pillar</th><th>Area</th><th>Severity</th><th>Finding</th><th>DPDPA Section</th><th>Why It Matters</th><th>Action Required</th><th>Deploy By</th></tr></thead>
                <tbody>{risk_rows}</tbody>
            </table>
        </div>"""
    elif it_ops_completed:
        it_ops_risks_html = """
        <div class="card">
            <h2>🏗️ IT Operational Capabilities</h2>
            <p style="color:#059669">✅ All critical IT operational capabilities assessed — no major gaps identified.</p>
        </div>"""
    else:
        it_ops_risks_html = """
        <div class="card">
            <h2>🏗️ IT Operational Capabilities</h2>
            <p style="color:var(--amber)">⚠️ IT operational capabilities (Backup, DR, WAF, Archival) not yet assessed. <a href="/it-review" style="color:var(--accent);font-weight:600">Complete IT Assessment →</a></p>
        </div>"""

    # Overall DPDPA readiness
    all_scores = [ps["score"] for ps in pillar_scores.values()]
    overall_score = int(sum(all_scores) / len(all_scores)) if all_scores else 0
    overall_color = "#22C55E" if overall_score >= 75 else "#F59E0B" if overall_score >= 40 else "#EF4444"
    has_assessment = bool(dpdpa_answers)

    assessment_notice = ""
    if not has_assessment:
        assessment_notice = '<div style="background:rgba(212,154,78,0.10);border:1px solid rgba(212,154,78,0.3);border-radius:8px;padding:12px 16px;margin-bottom:16px;font-size:0.85rem;color:var(--amber)">⚠️ <strong>DPDPA assessment not completed yet.</strong> Scores below are based on tool controls only. <a href="/dpdpa-assessment" style="color:var(--accent);font-weight:600">Complete DPDPA Assessment →</a></div>'

    content = f"""
    {assessment_notice}
    <div class="card" style="text-align:center">
        <h2>🛡️ PRISM DPDPA Readiness</h2>
        <div style="font-size:2.5rem;font-weight:700;color:{overall_color};margin:8px 0">{overall_score}%</div>
        <p style="color:#6B7280">Departments: {len(departments)} | Tools: {len(tools)} | Personal Data Tools: {tools_with_data}</p>
    </div>

    <div class="card">
        <h2>PRISM Pillar Scores (based on DPDPA assessment)</h2>
        <table><thead><tr><th>Pillar</th><th>Responses</th><th>Readiness</th><th>Score</th></tr></thead>
        <tbody>{pillar_html}</tbody></table>
    </div>

    <div class="card">
        <h2>⚠️ Key Findings</h2>
        <table>
            <tr><td>🔴 Critical-severity tool gaps</td><td><strong>{critical}</strong></td></tr>
            <tr><td>🟠 High-severity tool gaps</td><td><strong>{high}</strong></td></tr>
            <tr><td>🏗️ IT Ops risks identified</td><td><strong>{len(it_ops_risks)}</strong></td></tr>
            <tr><td>Tools without breach detection</td><td><strong>{no_detection}</strong></td></tr>
            <tr><td>Total tool recommendations</td><td><strong>{len(recs)}</strong></td></tr>
        </table>
    </div>

    {it_ops_risks_html}

    <div class="card">
        <h2>📋 Tool-Level Recommended Actions</h2>
        {_rec_table(immediate, "🔴 Immediate Action")}
        {_rec_table(thirty, "🟠 30-Day Action Plan")}
        {_rec_table(sixty, "🟡 60-Day Action Plan")}
    </div>

    <div class="nav">
        <a href="/download-report" class="btn btn-green">📄 Download PDF Report</a>
        <a href="/departments" class="btn btn-secondary">← Departments</a>
        <a href="/departments/heads" class="btn btn-secondary">← Heads</a>
        <a href="/it-review" class="btn btn-secondary">← IT Review</a>
        <a href="/dpdpa-assessment" class="btn">📜 DPDPA Assessment</a>
    </div>"""
    return _page("Review", content, step="Step 5 of 5 — PRISM Review & Action Plan")


@app.get("/download-report")
async def download_report():
    """Generate and download the PRISM DPDPA Readiness Assessment PDF."""
    from prism_dpdp.services.pdf_report import generate_report
    output_path = generate_report(store)
    return FileResponse(
        path=str(output_path),
        media_type="application/pdf",
        filename=f"PRISM_DPDPA_Report_{datetime.now(timezone.utc).strftime('%Y-%m-%d')}.pdf",
    )
