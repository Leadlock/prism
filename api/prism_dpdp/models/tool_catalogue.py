"""Tool Catalogue — configurable department-wise tool and data categories."""

from __future__ import annotations

from pydantic import BaseModel, Field


class ToolEntry(BaseModel):
    """A tool/system declared by a department."""

    tool_id: str = ""
    department_id: str = ""
    category: str = ""  # e.g. "HRMS", "CRM", "Email platform"
    tool_name: str = ""  # e.g. "SAP SuccessFactors" or custom entry
    is_custom: bool = False
    personal_data_categories: list[str] = Field(default_factory=list)
    # Phase 4 assessment fields
    collects_personal_data: str = "Unsure"  # Yes / No / Unsure
    data_handling: list[str] = Field(default_factory=list)
    hosting_location: str = "Unknown"
    data_access: list[str] = Field(default_factory=list)
    existing_controls: list[str] = Field(default_factory=list)
    detection_sources: list[str] = Field(default_factory=list)
    prism_intake_methods: list[str] = Field(default_factory=list)
    # Audit
    created_at: str = ""
    created_by: str = ""
    updated_at: str = ""
    updated_by: str = ""
    assessment_status: str = "Not Started"


# ─── Tool Catalogue Seed Data ────────────────────────────────────────────────

DEPARTMENT_TOOLS: dict[str, dict] = {
    "HR & People Operations": {
        "tool_groups": {
            "HRMS": ["SAP SuccessFactors", "Workday", "Darwinbox", "Zoho People", "Keka", "GreytHR", "BambooHR"],
            "Payroll": ["GreytHR Payroll", "Keka Payroll", "ADP", "Ramco"],
            "Attendance / Biometric": ["BioTime", "ZKTeco", "GreytHR Attendance", "Keka Attendance"],
            "Employee Self-Service Portal": ["SAP ESS", "Darwinbox ESS", "Keka ESS"],
            "Employee Engagement": ["Culture Amp", "Peakon", "Officevibe", "Leapsome"],
            "Learning Management (LMS)": ["Cornerstone", "Udemy Business", "LinkedIn Learning", "Moodle"],
            "Background Verification": ["SpringVerify", "AuthBridge", "HireRight", "First Advantage"],
            "Insurance / Benefits": ["Plum", "Loop Health", "PolicyBazaar Corporate"],
            "Spreadsheets & Shared Drives": ["Microsoft Excel", "Google Sheets", "Microsoft SharePoint", "Google Drive"],
            "Email & Collaboration": ["Microsoft 365", "Google Workspace", "Slack", "Microsoft Teams"],
        },
        "personal_data": [
            "Employee name", "Employee ID", "Contact details", "Address",
            "Date of birth", "Photograph", "Aadhaar / PAN / passport",
            "Bank details", "Salary details", "Attendance data", "Biometric data",
            "Health / insurance details", "Emergency contacts", "Performance records", "Other",
        ],
    },
    "Recruitment": {
        "tool_groups": {
            "Applicant Tracking System (ATS)": ["Workable", "Greenhouse", "Lever", "Zoho Recruit", "Freshteam"],
            "Job Portal": ["LinkedIn Recruiter", "Naukri", "Indeed", "Monster", "Glassdoor"],
            "AI Resume Screening": ["SortCut", "HireVue", "Pymetrics", "Ideal"],
            "Assessment Platform": ["HackerRank", "Codility", "TestGorilla", "Mettl"],
            "Interview Scheduling": ["Calendly", "GoodTime", "ModernLoop"],
            "Video Interview": ["Zoom", "Microsoft Teams", "HireVue Video"],
            "Spreadsheets": ["Microsoft Excel", "Google Sheets"],
        },
        "personal_data": [
            "Resume", "Contact details", "Education", "Work experience",
            "Photograph", "Salary expectations", "References", "Interview feedback",
            "Assessment scores", "Identity documents", "Other",
        ],
    },
    "Sales": {
        "tool_groups": {
            "CRM": ["Salesforce", "Microsoft Dynamics 365", "HubSpot CRM", "Zoho CRM", "Freshsales", "Pipedrive"],
            "Lead Management": ["Apollo", "LinkedIn Sales Navigator", "Lusha", "ZoomInfo"],
            "Calling Platform": ["Dialpad", "RingCentral", "Ozonetel", "Knowlarity"],
            "Quotation / Proposal": ["PandaDoc", "Proposify", "QuoteWerks"],
            "Contract / E-Signature": ["DocuSign", "Adobe Sign", "Zoho Sign"],
            "Customer Portal": ["Salesforce Community", "HubSpot Portal", "Zoho Desk Portal"],
            "Spreadsheets": ["Microsoft Excel", "Google Sheets"],
        },
        "personal_data": [
            "Name", "Business email", "Mobile number", "Job title",
            "Company information", "Meeting notes", "Purchase history",
            "Proposal details", "Contract signatory details", "Other",
        ],
    },
    "Marketing": {
        "tool_groups": {
            "Email Marketing": ["Mailchimp", "HubSpot Marketing Hub", "Zoho Campaigns", "Marketo", "Brevo"],
            "Website Forms / Landing Pages": ["HubSpot Forms", "Typeform", "Unbounce", "Leadpages"],
            "Webinar / Events": ["Zoom Webinars", "Microsoft Teams Webinars", "GoTo Webinar", "Airmeet"],
            "Social Media Lead Forms": ["Meta Lead Ads", "LinkedIn Lead Gen Forms", "Twitter Ads"],
            "Consent Management (CMP)": ["OneTrust", "Cookiebot", "TrustArc"],
            "Website Analytics": ["Google Analytics", "Hotjar", "Mixpanel", "Amplitude"],
            "Spreadsheets": ["Microsoft Excel", "Google Sheets"],
        },
        "personal_data": [
            "Name", "Email", "Phone number", "Company", "Job title",
            "IP address", "Website behaviour", "Consent preference",
            "Campaign response", "Webinar attendance", "Other",
        ],
    },
    "Finance & Accounts": {
        "tool_groups": {
            "ERP": ["SAP", "Oracle ERP", "Microsoft Dynamics 365 Finance"],
            "Accounting": ["Tally", "Zoho Books", "QuickBooks", "Xero"],
            "Expense Management": ["SAP Concur", "Expensify", "Zoho Expense", "Happay"],
            "Payment Gateway": ["Razorpay", "Stripe", "PayU", "CCAvenue"],
            "Banking Portal": ["ICICI Corporate", "HDFC Corporate", "SBI YONO Business"],
            "Invoicing": ["Zoho Invoice", "FreshBooks", "Bill.com"],
            "Vendor Portal": ["SAP Ariba", "Coupa", "GEP"],
            "Spreadsheets": ["Microsoft Excel", "Google Sheets"],
        },
        "personal_data": [
            "Vendor contact details", "Customer contact details",
            "Bank account information", "PAN / GST details", "Billing address",
            "Payment history", "Salary reimbursement details", "Tax documents", "Other",
        ],
    },
    "Administration & Facilities": {
        "tool_groups": {
            "Visitor Management": ["VisitorCheck.in", "Envoy", "Proxyclick", "SwipedOn"],
            "Access Control": ["Kisi", "HID", "Honeywell", "Suprema", "Salto"],
            "CCTV / Surveillance": ["Hikvision", "Dahua", "CP Plus", "Verkada"],
            "Parking Management": ["ParkWhiz", "SpotHero", "Custom system"],
            "Canteen / Cafeteria": ["Zeta (Sodexo)", "MealPe", "Custom system"],
            "Asset Management": ["AssetTiger", "Snipe-IT", "Freshservice Assets"],
            "Physical Registers": ["Paper visitor register", "Paper attendance register"],
        },
        "personal_data": [
            "Visitor name", "Mobile number", "Photograph", "ID proof",
            "Vehicle number", "Entry / exit time", "Host employee details",
            "Access-card information", "Other",
        ],
    },
    "IT & Information Security": {
        "tool_groups": {
            "Email & Collaboration (where personal data is communicated)": [
                "Microsoft 365", "Google Workspace", "Slack", "Zoom",
                "Microsoft Teams", "Cisco Webex",
            ],
            "Identity & Access Management (who can access personal data)": [
                "Microsoft Entra ID (Azure AD)", "Okta", "CyberArk", "Ping Identity",
                "OneLogin", "JumpCloud", "SailPoint", "Saviynt",
                "ForgeRock", "IBM Security Verify",
            ],
            "Endpoint Security / EDR (protecting devices that store personal data)": [
                "Microsoft Defender for Endpoint", "CrowdStrike Falcon",
                "SentinelOne", "Sophos Intercept X", "Trend Micro Apex One",
                "Trend Micro Vision One", "Symantec Endpoint Protection",
                "ESET Protect", "Kaspersky Endpoint Security",
                "Carbon Black (VMware)", "Cortex XDR (Palo Alto)",
                "Trellix (McAfee) Endpoint Security", "Malwarebytes",
                "Cylance (BlackBerry)", "WithSecure Elements",
            ],
            "Data Loss Prevention / DLP (preventing personal data leakage)": [
                "Microsoft Purview DLP", "Symantec DLP (Broadcom)",
                "Digital Guardian", "Forcepoint DLP", "Trellix DLP (McAfee)",
                "Zscaler DLP", "Netskope DLP", "Code42 Incydr",
                "Endpoint Protector (CoSoSys)", "Safetica",
                "GTB Technologies DLP", "Spirion (Identity Finder)",
            ],
            "Data Classification & Discovery (finding where personal data lives)": [
                "Microsoft Purview Information Protection", "Boldon James Classifier",
                "Titus Classification", "Varonis DatAdvantage",
                "Spirion Sensitive Data Platform", "BigID",
                "OneTrust Data Discovery", "Securiti.ai",
                "AWS Macie", "Google Cloud DLP",
            ],
            "Firewall / Network Security (protecting network perimeter)": [
                "Palo Alto Networks NGFW", "Fortinet FortiGate",
                "Check Point Quantum", "Cisco Firepower",
                "Sophos XG Firewall", "WatchGuard Firebox",
                "Juniper SRX", "pfSense", "Barracuda CloudGen Firewall",
            ],
            "SIEM / SOC / Threat Detection (detecting breaches involving personal data)": [
                "Microsoft Sentinel", "Splunk Enterprise Security",
                "IBM QRadar", "LogRhythm", "Elastic SIEM",
                "Sumo Logic", "Securonix", "Exabeam",
                "Google Chronicle", "Rapid7 InsightIDR",
                "AlienVault USM (AT&T)", "Wazuh", "Graylog",
            ],
            "Cloud Security / CSPM (securing cloud-hosted personal data)": [
                "Microsoft Defender for Cloud", "Wiz", "Prisma Cloud (Palo Alto)",
                "AWS Security Hub", "AWS GuardDuty", "AWS Inspector",
                "Google Security Command Center", "Orca Security",
                "Lacework", "Aqua Security", "Sysdig Secure",
                "Qualys CloudView", "Tenable Cloud Security",
            ],
            "Backup & Recovery (ensuring personal data can be restored)": [
                "Veeam Backup & Replication", "Commvault", "Rubrik",
                "Acronis Cyber Protect", "Veritas NetBackup",
                "Cohesity DataProtect", "Dell EMC Avamar",
                "AWS Backup", "Azure Backup", "Google Cloud Backup",
                "Druva", "Datto", "Carbonite (OpenText)",
                "Unitrends", "Nakivo",
            ],
            "Device Management / MDM / UEM (managing endpoints with personal data)": [
                "Microsoft Intune", "VMware Workspace ONE",
                "Jamf (macOS/iOS)", "ManageEngine Endpoint Central",
                "Ivanti UEM", "Citrix Endpoint Management",
                "SOTI MobiControl", "Hexnode", "Kandji",
                "Mosyle", "Scalefusion",
            ],
            "VPN / Zero Trust Network Access (securing remote access to personal data)": [
                "Cisco AnyConnect", "Zscaler Private Access",
                "Palo Alto GlobalProtect", "Fortinet FortiClient VPN",
                "Cloudflare Access (ZTNA)", "Netskope Private Access",
                "Perimeter 81", "NordLayer", "Tailscale",
                "WireGuard", "OpenVPN",
            ],
            "Email Security / Anti-Phishing (protecting personal data in email)": [
                "Microsoft Defender for Office 365", "Proofpoint Email Protection",
                "Mimecast", "Abnormal Security", "Barracuda Email Protection",
                "Trend Micro Email Security", "Cisco Email Security",
                "Ironscales", "Cofense", "Tessian",
            ],
            "File Storage & Sharing (where personal data files are kept)": [
                "Microsoft SharePoint", "Microsoft OneDrive",
                "Google Drive", "Box", "Dropbox Business",
                "Citrix ShareFile", "Egnyte", "Tresorit",
            ],
            "Vulnerability Management / Patch Management (securing systems with personal data)": [
                "Qualys VMDR", "Tenable Nessus / Tenable.io",
                "Rapid7 InsightVM", "Microsoft Defender Vulnerability Management",
                "CrowdStrike Falcon Spotlight", "Ivanti Patch Management",
                "ManageEngine Patch Manager Plus", "Automox",
            ],
            "Encryption & Key Management (protecting personal data at rest and in transit)": [
                "BitLocker (Microsoft)", "FileVault (Apple)",
                "VeraCrypt", "Thales CipherTrust", "Vormetric (Thales)",
                "AWS KMS", "Azure Key Vault", "Google Cloud KMS",
                "HashiCorp Vault",
            ],
            "Privileged Access Management / PAM (controlling admin access to personal data)": [
                "CyberArk Privileged Access Security", "BeyondTrust",
                "Delinea (Thycotic) Secret Server", "HashiCorp Vault",
                "One Identity Safeguard", "Arcon PAM",
                "ManageEngine PAM360", "Wallix Bastion",
            ],
        },
        "personal_data": [
            "User identity", "Login history", "IP address", "Device information",
            "Access logs", "Email metadata", "File-sharing information",
            "Security alerts", "Location information", "Authentication tokens",
            "Encryption keys", "Backup content (may contain all org PD)",
            "Audit trails", "Network traffic metadata", "Other",
        ],
    },
    "Customer Support": {
        "tool_groups": {
            "Helpdesk / Ticketing": ["Zendesk", "Freshdesk", "Zoho Desk", "ServiceNow"],
            "Live Chat": ["Intercom", "Drift", "Freshchat", "Tidio"],
            "Call Centre": ["Five9", "Genesys", "Ozonetel", "Ameyo"],
            "Knowledge Base": ["Confluence", "Notion", "Document360"],
            "Customer Feedback": ["SurveyMonkey", "Typeform", "Qualtrics"],
            "Spreadsheets": ["Microsoft Excel", "Google Sheets"],
        },
        "personal_data": [
            "Customer name", "Email", "Phone number", "Account details",
            "Support history", "Chat transcripts", "Call recordings",
            "Complaint details", "Other",
        ],
    },
    "Legal & Compliance": {
        "tool_groups": {
            "Contract Management": ["Ironclad", "Agiloft", "ContractPodAi", "Zoho Contracts"],
            "E-Signature": ["DocuSign", "Adobe Sign", "Zoho Sign"],
            "Compliance Platform": ["OneTrust", "TrustArc", "Vanta", "Drata"],
            "Legal Case Management": ["Clio", "MyCase", "LegalDesk"],
            "Policy Management": ["PolicyHub", "PowerDMS", "ConvergePoint"],
            "Spreadsheets / Shared Drive": ["Microsoft Excel", "Google Sheets", "SharePoint"],
        },
        "personal_data": [
            "Party names", "Contact details", "Contract terms",
            "Legal correspondence", "Compliance records", "Consent records",
            "Regulatory filings", "Other",
        ],
    },
    "Procurement & Vendor Management": {
        "tool_groups": {
            "Procurement Platform": ["SAP Ariba", "Coupa", "GEP SMART", "Jaggaer"],
            "Vendor Onboarding": ["SAP VIM", "Ivalua", "Zycus"],
            "Invoice Management": ["Tipalti", "Bill.com", "Basware"],
            "Contract Repository": ["Ironclad", "ContractPodAi", "SharePoint"],
            "Spreadsheets": ["Microsoft Excel", "Google Sheets"],
        },
        "personal_data": [
            "Vendor contact person", "Email", "Phone number",
            "Bank details", "PAN / GST / tax ID", "Contract signatories",
            "KYC documents", "Other",
        ],
    },
}

# ─── Phase 4 Assessment Options ──────────────────────────────────────────────

DATA_HANDLING_OPTIONS = [
    "Collects data directly from individuals",
    "Imports data from another system",
    "Stores personal data",
    "Processes or analyses data",
    "Shares data internally",
    "Shares data with third parties",
    "Allows users to download or export data",
    "Uses data for analytics or reporting",
    "Retains archived records",
    "Deletes data after a defined period",
    "Other",
]

HOSTING_OPTIONS = [
    "India",
    "Outside India",
    "Multiple locations",
    "On-premises",
    "SaaS / vendor managed",
    "Unknown",
]

DATA_ACCESS_OPTIONS = [
    "Department users",
    "Managers",
    "HR / Finance / Legal",
    "IT administrators",
    "Security team",
    "Vendor support team",
    "External consultants",
    "Customers / partners",
    "Unknown",
]

EXISTING_CONTROLS_OPTIONS = [
    "Privacy notice",
    "Consent capture",
    "Data retention rule",
    "Data deletion process",
    "Role-based access",
    "MFA",
    "Encryption",
    "Audit logs",
    "Periodic access review",
    "DLP",
    "Backup",
    "Vendor agreement / DPA",
    "Incident-response process",
    "None known",
    "Unsure",
]

DETECTION_SOURCE_OPTIONS = [
    "Employee or manager reports it",
    "Application audit logs",
    "Email / collaboration security alert",
    "DLP alert",
    "Endpoint security / EDR alert",
    "IAM or suspicious-login alert",
    "Firewall or network alert",
    "Cloud-security alert",
    "Backup / ransomware alert",
    "SIEM / SOC monitoring",
    "Vendor notification",
    "Customer complaint",
    "Internal audit finding",
    "No defined detection source",
    "Unsure",
]

PRISM_INTAKE_OPTIONS = [
    "Manual incident form",
    "Alert email",
    "Audit-log upload",
    "Scheduled log import",
    "API connector",
    "Webhook / event trigger",
    "SIEM / SOC integration",
    "Vendor notification portal",
    "Not connected yet",
    "Unsure",
]

# ─── Known Tool Hosting Locations ─────────────────────────────────────────────
# Pre-filled to avoid unnecessary "Unknown hosting" severity flags.
# Format: tool_name -> hosting location

KNOWN_TOOL_HOSTING: dict[str, str] = {
    # Indian SaaS (hosted in India)
    "Zoho People": "India",
    "Zoho CRM": "India",
    "Zoho Books": "India",
    "Zoho Campaigns": "India",
    "Zoho Recruit": "India",
    "Zoho Desk": "India",
    "Zoho Sign": "India",
    "Zoho Expense": "India",
    "Zoho Invoice": "India",
    "Zoho Contracts": "India",
    "Keka": "India",
    "Keka Payroll": "India",
    "Keka Attendance": "India",
    "Keka ESS": "India",
    "Darwinbox": "India",
    "Darwinbox ESS": "India",
    "GreytHR": "India",
    "GreytHR Payroll": "India",
    "GreytHR Attendance": "India",
    "Freshsales": "India",
    "Freshdesk": "India",
    "Freshservice": "India",
    "Freshchat": "India",
    "Freshteam": "India",
    "Razorpay": "India",
    "Tally": "India",
    "Happay": "India",
    "Naukri": "India",
    "AuthBridge": "India",
    "SpringVerify": "India",
    "Ozonetel": "India",
    "Knowlarity": "India",
    "Plum": "India",
    "Loop Health": "India",
    "PolicyBazaar Corporate": "India",
    "Arcon PAM": "India",
    "Scalefusion": "India",
    "MealPe": "India",
    "VisitorCheck.in": "India",
    "Leapsome": "India",
    # Global SaaS (hosted outside India / multiple regions)
    "Microsoft 365": "Multiple locations",
    "Microsoft Teams": "Multiple locations",
    "Microsoft Entra ID (Azure AD)": "Multiple locations",
    "Microsoft Defender for Endpoint": "Multiple locations",
    "Microsoft Defender for Office 365": "Multiple locations",
    "Microsoft Purview DLP": "Multiple locations",
    "Microsoft Purview Information Protection": "Multiple locations",
    "Microsoft Sentinel": "Multiple locations",
    "Microsoft Defender for Cloud": "Multiple locations",
    "Microsoft Intune": "Multiple locations",
    "Microsoft SharePoint": "Multiple locations",
    "Microsoft OneDrive": "Multiple locations",
    "Microsoft Defender Vulnerability Management": "Multiple locations",
    "Google Workspace": "Multiple locations",
    "Google Analytics": "Multiple locations",
    "Google Drive": "Multiple locations",
    "Google Cloud DLP": "Multiple locations",
    "Google Security Command Center": "Multiple locations",
    "Google Chronicle": "Multiple locations",
    "Salesforce": "Multiple locations",
    "Salesforce Community": "Multiple locations",
    "SAP SuccessFactors": "Multiple locations",
    "SAP": "Multiple locations",
    "SAP ESS": "Multiple locations",
    "SAP Concur": "Multiple locations",
    "SAP Ariba": "Multiple locations",
    "SAP VIM": "Multiple locations",
    "Workday": "Multiple locations",
    "Oracle ERP": "Multiple locations",
    "Microsoft Dynamics 365": "Multiple locations",
    "Microsoft Dynamics 365 Finance": "Multiple locations",
    "HubSpot": "Outside India",
    "HubSpot CRM": "Outside India",
    "HubSpot Marketing Hub": "Outside India",
    "HubSpot Forms": "Outside India",
    "HubSpot Portal": "Outside India",
    "Slack": "Outside India",
    "Zoom": "Outside India",
    "Zoom Webinars": "Outside India",
    "Cisco Webex": "Multiple locations",
    "Cisco AnyConnect": "On-premises",
    "Cisco Firepower": "On-premises",
    "AWS Security Hub": "Multiple locations",
    "AWS GuardDuty": "Multiple locations",
    "AWS Macie": "Multiple locations",
    "AWS Inspector": "Multiple locations",
    "AWS Backup": "Multiple locations",
    "AWS KMS": "Multiple locations",
    "Azure Backup": "Multiple locations",
    "Azure Key Vault": "Multiple locations",
    "Okta": "Outside India",
    "OneLogin": "Outside India",
    "CyberArk": "Multiple locations",
    "CyberArk Privileged Access Security": "Multiple locations",
    "SailPoint": "Outside India",
    "Saviynt": "Outside India",
    "Ping Identity": "Outside India",
    "CrowdStrike Falcon": "Multiple locations",
    "CrowdStrike Falcon Spotlight": "Multiple locations",
    "SentinelOne": "Multiple locations",
    "Sophos Intercept X": "Multiple locations",
    "Sophos XG Firewall": "On-premises",
    "Trend Micro Apex One": "Multiple locations",
    "Trend Micro Vision One": "Multiple locations",
    "Trend Micro Email Security": "Multiple locations",
    "Palo Alto Networks NGFW": "On-premises",
    "Palo Alto GlobalProtect": "Multiple locations",
    "Cortex XDR (Palo Alto)": "Multiple locations",
    "Prisma Cloud (Palo Alto)": "Multiple locations",
    "Fortinet FortiGate": "On-premises",
    "Fortinet FortiClient VPN": "On-premises",
    "Check Point Quantum": "On-premises",
    "Splunk Enterprise Security": "Multiple locations",
    "Splunk": "Multiple locations",
    "IBM QRadar": "Multiple locations",
    "Elastic SIEM": "Multiple locations",
    "Wiz": "Outside India",
    "Orca Security": "Outside India",
    "Veeam Backup & Replication": "On-premises",
    "Commvault": "Multiple locations",
    "Rubrik": "Multiple locations",
    "Acronis Cyber Protect": "Multiple locations",
    "Veritas NetBackup": "On-premises",
    "Druva": "Multiple locations",
    "Datto": "Outside India",
    "Carbonite (OpenText)": "Multiple locations",
    "ServiceNow": "Multiple locations",
    "Jira Service Management": "Outside India",
    "PagerDuty": "Outside India",
    "DocuSign": "Multiple locations",
    "Adobe Sign": "Multiple locations",
    "Mailchimp": "Outside India",
    "Marketo": "Outside India",
    "Brevo": "Outside India",
    "LinkedIn Recruiter": "Outside India",
    "LinkedIn Sales Navigator": "Outside India",
    "LinkedIn Lead Gen Forms": "Outside India",
    "Indeed": "Outside India",
    "Workable": "Outside India",
    "Greenhouse": "Outside India",
    "Lever": "Outside India",
    "BambooHR": "Outside India",
    "Pipedrive": "Outside India",
    "Apollo": "Outside India",
    "Stripe": "Outside India",
    "PayU": "India",
    "Bill.com": "Outside India",
    "QuickBooks": "Multiple locations",
    "Xero": "Outside India",
    "Box": "Multiple locations",
    "Dropbox Business": "Outside India",
    "OneTrust": "Multiple locations",
    "TrustArc": "Outside India",
    "BigID": "Multiple locations",
    "Securiti.ai": "Multiple locations",
    "Varonis DatAdvantage": "Multiple locations",
    "Proofpoint Email Protection": "Multiple locations",
    "Mimecast": "Multiple locations",
    "Abnormal Security": "Outside India",
    "Netskope DLP": "Multiple locations",
    "Zscaler DLP": "Multiple locations",
    "Zscaler Private Access": "Multiple locations",
    "Cloudflare Access (ZTNA)": "Multiple locations",
    "HashiCorp Vault": "Multiple locations",
    "Thales CipherTrust": "Multiple locations",
    "ManageEngine Endpoint Central": "India",
    "ManageEngine Patch Manager Plus": "India",
    "ManageEngine PAM360": "India",
    "Hexnode": "India",
    # On-premises only
    "Microsoft Excel": "On-premises",
    "Google Sheets": "SaaS / vendor managed",
    "Paper register": "On-premises",
    "pfSense": "On-premises",
    "WireGuard": "On-premises",
    "OpenVPN": "On-premises",
    "Wazuh": "On-premises",
    "Graylog": "On-premises",
    "VeraCrypt": "On-premises",
    "BitLocker (Microsoft)": "On-premises",
    "FileVault (Apple)": "On-premises",
}

# ─── Enterprise SaaS with Built-in Governance ────────────────────────────────
# These vendors have their own privacy policies, DPAs, incident response,
# data retention controls, and breach notification procedures.
# PRISM should NOT flag these for vendor-side controls — only for
# customer-side configuration gaps (e.g., customer hasn't enabled MFA).

ENTERPRISE_SAAS_WITH_BUILTIN_GOVERNANCE: set[str] = {
    # Microsoft
    "Microsoft 365", "Microsoft Teams", "Microsoft Entra ID (Azure AD)",
    "Microsoft Defender for Endpoint", "Microsoft Defender for Office 365",
    "Microsoft Purview DLP", "Microsoft Purview Information Protection",
    "Microsoft Sentinel", "Microsoft Defender for Cloud", "Microsoft Intune",
    "Microsoft SharePoint", "Microsoft OneDrive", "Microsoft Dynamics 365",
    "Microsoft Dynamics 365 Finance", "Azure Backup", "Azure Key Vault",
    # Google
    "Google Workspace", "Google Analytics", "Google Drive",
    "Google Cloud DLP", "Google Security Command Center", "Google Chronicle",
    # Salesforce
    "Salesforce", "Salesforce Community",
    # LinkedIn
    "LinkedIn Recruiter", "LinkedIn Sales Navigator", "LinkedIn Lead Gen Forms",
    # Zoho
    "Zoho People", "Zoho CRM", "Zoho Books", "Zoho Campaigns",
    "Zoho Recruit", "Zoho Desk", "Zoho Sign", "Zoho Expense",
    "Zoho Invoice", "Zoho Contracts",
    # SAP
    "SAP SuccessFactors", "SAP", "SAP ESS", "SAP Concur", "SAP Ariba", "SAP VIM",
    # Oracle
    "Oracle ERP",
    # Workday
    "Workday",
    # HubSpot
    "HubSpot", "HubSpot CRM", "HubSpot Marketing Hub", "HubSpot Forms", "HubSpot Portal",
    # Freshworks
    "Freshsales", "Freshdesk", "Freshservice", "Freshchat", "Freshteam",
    # Indian HR/Payroll
    "Keka", "Keka Payroll", "Keka Attendance", "Keka ESS",
    "Darwinbox", "Darwinbox ESS",
    "GreytHR", "GreytHR Payroll", "GreytHR Attendance",
    # CRM & Sales
    "Pipedrive", "Apollo",
    # Email Marketing
    "Mailchimp", "Marketo", "Brevo",
    # Security vendors
    "CrowdStrike Falcon", "CrowdStrike Falcon Spotlight",
    "SentinelOne", "Sophos Intercept X", "Trend Micro Apex One",
    "Trend Micro Vision One", "Palo Alto Networks NGFW", "Cortex XDR (Palo Alto)",
    "Prisma Cloud (Palo Alto)", "Check Point Quantum",
    "Splunk Enterprise Security", "Splunk", "IBM QRadar",
    "Okta", "OneLogin", "CyberArk", "CyberArk Privileged Access Security",
    "Wiz", "Orca Security",
    # Backup
    "Veeam Backup & Replication", "Commvault", "Rubrik", "Acronis Cyber Protect", "Druva",
    # Collaboration
    "Slack", "Zoom", "Zoom Webinars", "Cisco Webex",
    # Job portals
    "Naukri", "Indeed",
    # Others
    "ServiceNow", "Jira Service Management", "DocuSign", "Adobe Sign",
    "BambooHR", "Workable", "Greenhouse", "Lever",
    "OneTrust", "TrustArc", "BigID",
    "Proofpoint Email Protection", "Mimecast", "Abnormal Security",
    "Box", "Dropbox Business",
    "Stripe", "Razorpay", "PayU",
    "QuickBooks", "Xero", "Bill.com",
    "PagerDuty",
    "ManageEngine Endpoint Central", "ManageEngine Patch Manager Plus", "ManageEngine PAM360",
    "Hexnode",
}
