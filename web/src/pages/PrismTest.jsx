import { useRef, useState } from "react";
import { Link } from "react-router-dom";
import Logo from "../components/Logo";

const API_URL = import.meta.env.VITE_API_URL || "";

// ─── IT Assessment: 16 DPDPA Technology Controls ─────────────────────────────
const IT_CONTROLS = [
  {
    id: "b01", num: 1, cat: "Data Discovery & Classification",
    title: "Required for Identifying & Mapping Personal Data",
    why: "An organisation needs visibility into where personal data exists before it can effectively protect, retain or delete it.",
    how: "Data discovery and classification technologies scan supported repositories and identify personal or sensitive information.",
    products: ["Microsoft Purview", "BigID", "Varonis", "Securiti", "Other", "None"],
    subFields: [
      { id: "environments", label: "What environments are covered?", type: "multiselect",
        options: ["Email", "SharePoint / OneDrive", "Endpoints", "Databases", "Cloud Storage", "SaaS Applications", "File Servers", "Other"] },
    ],
  },
  {
    id: "b02", num: 2, cat: "Consent & Notice Management",
    title: "Required for Managing Notice & Consent",
    why: "The organisation needs to manage applicable privacy notices, consent and withdrawal in a controlled and demonstrable manner.",
    how: "Consent/privacy platforms can present notices, capture consent preferences, maintain records and process withdrawal or preference changes.",
    products: ["OneTrust", "Securiti", "Other", "None"],
    subFields: [
      { id: "how_managed", label: "How is notice/consent managed today?", type: "select",
        options: ["Dedicated consent platform", "Website/application functionality", "CRM", "Manual records", "Not centrally managed", "Unsure"] },
    ],
  },
  {
    id: "b03", num: 3, cat: "Data Principal Requests",
    title: "Required for Managing Data Principal Requests",
    why: "The organisation needs a repeatable way to receive, validate, route and complete applicable requests such as correction or erasure.",
    how: "Workflow and privacy-management systems can create a case, identify responsible system owners, track actions and maintain evidence.",
    products: ["OneTrust", "ServiceNow", "Jira", "Other", "None"],
    subFields: [
      { id: "handling", label: "How are requests handled today?", type: "select",
        options: ["Automated workflow", "Ticketing/workflow system", "Email + manual coordination", "Department handles individually", "No defined process", "Unsure"] },
      { id: "data_locatable", label: "Can IT locate a person's data across relevant systems?", type: "select",
        options: ["Yes", "Partially", "No", "Unsure"] },
    ],
  },
  {
    id: "b04", num: 4, cat: "Data Retention & Deletion",
    title: "Required for Managing Data Retention & Deletion",
    why: "Keeping personal data indefinitely increases exposure and makes deletion obligations difficult to execute.",
    how: "Lifecycle and information-governance technologies can apply retention rules and automate deletion where supported.",
    products: ["Microsoft Purview", "Application-specific lifecycle", "Other", "None"],
    subFields: [
      { id: "enforcement", label: "Are retention policies technically enforced?", type: "select",
        options: ["Automated", "Partially automated", "Manual", "No", "Unsure"] },
      { id: "scope", label: "Does this cover:", type: "multiselect",
        options: ["Email", "Documents", "Databases", "Business Applications", "Endpoints / Local Files", "Backups", "Other"] },
    ],
  },
  {
    id: "b05", num: 5, cat: "Personal Data Security",
    title: "Required for Securing Personal Data",
    why: "Personal data needs appropriate safeguards against unauthorised access, compromise, disclosure, alteration or loss.",
    how: "Multiple security layers protect identities, endpoints, networks, applications, cloud workloads and the data itself.",
    products: [],
    subFields: [
      { id: "identity", label: "Identity", type: "product-select", options: ["Microsoft Entra", "IBM Verify", "Okta", "Other", "None"] },
      { id: "endpoint", label: "Endpoint Security", type: "product-select", options: ["Microsoft Defender", "CrowdStrike", "Sophos", "Trend Micro", "Other", "None"] },
      { id: "dlp", label: "Data Loss Prevention", type: "product-select", options: ["Microsoft Purview DLP", "Forcepoint", "Symantec", "Proofpoint", "Other", "None"] },
      { id: "network", label: "Network Security", type: "product-select", options: ["Fortinet", "Palo Alto Networks", "Check Point", "Other", "None"] },
      { id: "encryption", label: "Encryption", type: "select", options: ["Implemented", "Partial", "No", "Unsure"] },
    ],
  },
  {
    id: "b06", num: 6, cat: "Device Security",
    title: "Required for Securing Devices Handling Personal Data",
    why: "Personal data frequently leaves central applications through downloads, Excel files, email attachments and local copies.",
    how: "Device-management platforms enforce security configuration and help restrict access from unmanaged or non-compliant devices.",
    products: [],
    subFields: [
      { id: "device_mgmt", label: "Device Management", type: "product-select", options: ["Microsoft Intune", "ManageEngine", "NinjaOne", "Other", "None"] },
      { id: "endpoint_prot", label: "Endpoint Protection", type: "product-select", options: ["Defender", "CrowdStrike", "Sophos", "Trend Micro", "Other"] },
      { id: "endpoints_managed", label: "Are all corporate endpoints managed?", type: "select", options: ["All", "Most", "Some", "No", "Unknown"] },
      { id: "local_storage", label: "Can users store personal data locally?", type: "select", options: ["Yes", "Restricted", "No", "Unsure"] },
      { id: "usb", label: "Are USB/removable devices controlled?", type: "select", options: ["Yes", "Partially", "No", "Unsure"] },
    ],
  },
  {
    id: "b07", num: 7, cat: "Application & API Security",
    title: "Required for Securing Applications & APIs Collecting Personal Data",
    why: "Websites, portals and APIs are often the first point where customer or employee personal data enters the organisation.",
    how: "WAF and API-security platforms inspect traffic and detect/block attacks, bots, exploits and API abuse.",
    products: ["Akamai", "Cloudflare", "Indusface AppTrana", "F5", "FortiWeb", "Other", "None"],
    subFields: [
      { id: "waf_coverage", label: "Coverage:", type: "multiselect",
        options: ["Public websites", "Customer portals", "Employee portals", "Mobile application APIs", "Partner APIs", "Other"] },
      { id: "all_protected", label: "Are all internet-facing applications protected?", type: "select", options: ["Yes", "Partially", "No", "Unsure"] },
    ],
  },
  {
    id: "b08", num: 8, cat: "Cloud & Infrastructure Security",
    title: "Required for Securing Cloud & Infrastructure",
    why: "Misconfigured cloud storage, excessive permissions or vulnerable workloads can expose personal data.",
    how: "Cloud-security platforms continuously identify vulnerabilities, misconfigurations, excessive permissions and exposure paths.",
    products: ["Wiz", "Cloudanix", "Microsoft Defender for Cloud", "Palo Alto Prisma Cloud", "Check Point CloudGuard", "Other", "None"],
    subFields: [
      { id: "cloud_platforms", label: "Cloud coverage:", type: "multiselect", options: ["AWS", "Azure", "Google Cloud", "Private Cloud"] },
      { id: "coverage_level", label: "Coverage level:", type: "select", options: ["Complete", "Partial", "Limited", "None", "Unknown"] },
    ],
  },
  {
    id: "b09", num: 9, cat: "Data Sharing & Leakage Control",
    title: "Required for Controlling Data Sharing & Leakage",
    why: "Even legitimate users can accidentally or deliberately send personal data to unauthorised locations.",
    how: "DLP and related controls identify sensitive information and can monitor, warn, restrict or block risky movement.",
    products: ["Microsoft Purview DLP", "Zscaler", "Forcepoint", "Proofpoint", "Other", "None"],
    subFields: [
      { id: "channels", label: "Can personal data be controlled when shared through:", type: "multiselect-with-status",
        options: ["Email", "SharePoint / OneDrive", "Teams / Collaboration", "Endpoints", "USB", "Web Upload", "Cloud Applications", "Excel / CSV exports"],
        statusOptions: ["Controlled", "Partially Controlled", "Not Controlled", "Unknown"] },
    ],
  },
  {
    id: "b10", num: 10, cat: "Vendor & Processor Management",
    title: "Required for Managing Third Parties / Data Processors",
    why: "Personal data may continue to be exposed when it leaves internal systems and is processed by external service providers.",
    how: "Vendor/processor registers, risk-management workflows and evidence systems help maintain visibility and accountability.",
    products: ["Dedicated platform", "GRC", "Spreadsheet", "Documents", "Email", "Other", "None"],
    subFields: [
      { id: "vendor_list", label: "Do you maintain a list of vendors that process personal data?", type: "select", options: ["Yes", "Partial", "No", "Unsure"] },
      { id: "assessments", label: "Are vendor security assessments performed?", type: "select", options: ["Always", "Sometimes", "No", "Unsure"] },
      { id: "processor_reviews", label: "Are processor access and integrations reviewed?", type: "select", options: ["Yes", "Partially", "No", "Unsure"] },
    ],
  },
  {
    id: "b11", num: 11, cat: "Access & Identity Management",
    title: "Required for Managing Access & Delegated Authority",
    why: "Only authorised users should access personal data, while administrative and privileged access requires stronger governance.",
    how: "IAM, MFA, SSO, RBAC, identity governance and PAM technologies control who can access systems and what they are authorised to do.",
    products: [],
    subFields: [
      { id: "identity_platform", label: "Identity Platform:", type: "product-select", options: ["Microsoft Entra", "IBM Verify", "Okta", "Other", "None"] },
      { id: "mfa", label: "MFA:", type: "select", options: ["All Users", "Selected Users", "Admins Only", "No", "Unsure"] },
      { id: "rbac", label: "Role-Based Access:", type: "select", options: ["Implemented", "Partial", "No", "Unsure"] },
      { id: "access_reviews", label: "Access Reviews:", type: "select", options: ["Automated", "Manual", "Not Performed", "Unsure"] },
      { id: "pam", label: "Privileged Access Management:", type: "product-select", options: ["CyberArk", "FortiPAM", "Other", "None"] },
      { id: "jml", label: "Joiner-Mover-Leaver process:", type: "select", options: ["Automated", "Partially Automated", "Manual", "Undefined"] },
    ],
  },
  {
    id: "b12", num: 12, cat: "Breach Detection",
    title: "Required for Detecting a Personal Data Breach",
    why: "The organisation needs to identify suspicious activity quickly when systems containing personal data may have been compromised.",
    how: "SIEM, XDR, EDR, DLP and cloud-security platforms generate and correlate signals indicating potential compromise or data exposure.",
    products: ["Microsoft Sentinel", "IBM QRadar", "Splunk", "Defender XDR", "CrowdStrike", "Other", "None"],
    subFields: [
      { id: "monitoring", label: "Security monitoring:", type: "select", options: ["24×7 SOC", "Business Hours", "Alerts Only", "No Central Monitoring", "Unsure"] },
      { id: "correlation", label: "Are security events correlated across systems?", type: "select", options: ["Yes", "Partial", "No", "Unsure"] },
    ],
  },
  {
    id: "b13", num: 13, cat: "Incident Response",
    title: "Required for Responding to a Personal Data Breach",
    why: "Detection alone is insufficient. The organisation needs to investigate, contain, remediate and document incidents.",
    how: "Incident-response, XDR, SIEM/SOAR and case-management capabilities coordinate investigation and containment.",
    products: [],
    subFields: [
      { id: "documented", label: "Is there a documented incident response process?", type: "select", options: ["Yes", "Partial", "No", "Unsure"] },
      { id: "responsibility", label: "Is responsibility clearly assigned?", type: "select", options: ["Yes", "No", "Unsure"] },
      { id: "identification", label: "Can affected users, systems and data be identified?", type: "select", options: ["Yes", "Partially", "No", "Unsure"] },
      { id: "evidence_recorded", label: "Are incident actions and evidence recorded?", type: "select", options: ["Yes", "Partially", "No", "Unsure"] },
    ],
  },
  {
    id: "b14", num: 14, cat: "Recovery & Backup",
    title: "Required for Recovery After an Incident",
    why: "Ransomware, corruption, accidental deletion or infrastructure failure can make important systems and data unavailable.",
    how: "Backup, immutable storage and disaster-recovery technologies provide protected copies and recovery capabilities.",
    products: ["Veeam", "Commvault", "Rubrik", "Acronis", "AvePoint", "Carbonite", "Other", "None"],
    subFields: [
      { id: "backup_scope", label: "What is protected?", type: "multiselect",
        options: ["Servers", "Databases", "Endpoints", "Microsoft 365", "Cloud Workloads", "Business Applications"] },
      { id: "immutable", label: "Are backups immutable/protected against ransomware?", type: "select", options: ["Yes", "Partially", "No", "Unsure"] },
      { id: "recovery_tests", label: "Are recovery tests performed?", type: "select", options: ["Regularly", "Occasionally", "Never", "Unsure"] },
      { id: "rto", label: "Is recovery time defined?", type: "select", options: ["Yes", "Partially", "No", "Unsure"] },
    ],
  },
  {
    id: "b15", num: 15, cat: "Continuous Compliance Monitoring",
    title: "Required for Monitoring Compliance Continuously",
    why: "Security and data controls can drift after implementation. New users, applications, cloud resources and data can create new exposure.",
    how: "Security posture, cloud posture, configuration and data-governance technologies continuously identify changes and control gaps.",
    products: ["Microsoft Purview", "Wiz", "Cloudanix", "Microsoft Defender for Cloud", "Palo Alto Prisma Cloud", "Check Point CloudGuard", "Other", "None"],
    subFields: [
      { id: "gaps_monitored", label: "Are control gaps monitored continuously?", type: "select", options: ["Yes", "Partially", "Periodically", "No", "Unsure"] },
      { id: "remediation", label: "Are remediation actions assigned to owners?", type: "select", options: ["Automatically", "Manually", "No", "Unsure"] },
    ],
  },
  {
    id: "b16", num: 16, cat: "Evidence & Audit Trail",
    title: "Required for Maintaining Evidence & Audit Trail",
    why: "The organisation should be able to demonstrate what controls existed, what actions were taken, by whom and when.",
    how: "Logs, reports, workflow records and evidence repositories provide an auditable history.",
    products: [],
    subFields: [
      { id: "evidence_areas", label: "Can IT produce evidence for:", type: "multiselect-with-status",
        options: ["Identity controls", "Endpoint protection", "DLP", "Cloud security", "WAF/API security", "Backup/recovery", "Security incidents", "Access reviews", "Retention/deletion actions"],
        statusOptions: ["Yes", "Partial", "No", "Unsure"] },
    ],
  },
];

const IT_OVERALL_QS = [
  { id: "c1", text: "How confident are you that all systems containing personal data are known?", options: ["Very Confident", "Confident", "Partially Confident", "Not Confident", "Unsure"] },
  { id: "c2", text: "How confident are you that personal data is adequately protected across these systems?", options: ["Very Confident", "Confident", "Partially Confident", "Not Confident", "Unsure"] },
  { id: "c3", text: "Can you identify where a specific individual's personal data resides?", options: ["Yes", "Partially", "No", "Unsure"] },
  { id: "c4", text: "Can you delete eligible personal data across all relevant systems when required?", options: ["Yes", "Partially", "No", "Unsure"] },
  { id: "c5", text: "Can you demonstrate evidence that required security controls are operating?", options: ["Yes", "Partially", "No", "Unsure"] },
];

const IT_TOTAL_STEPS = 18; // 0=Section A, 1-16=B controls, 17=Section C

function defaultItData() {
  const d = { a_productivity: [], a_cloud: [], a_applications: [], c1: "", c2: "", c3: "", c4: "", c5: "" };
  IT_CONTROLS.forEach(ctrl => {
    d[`${ctrl.id}_status`] = "";
    d[`${ctrl.id}_products`] = [];
    d[`${ctrl.id}_coverage`] = "";
    d[`${ctrl.id}_how_used`] = "";
    d[`${ctrl.id}_evidence`] = "";
    ctrl.subFields.forEach(sf => {
      if (sf.type === "multiselect" || sf.type === "product-select") d[`${ctrl.id}_${sf.id}`] = [];
      else if (sf.type === "multiselect-with-status") d[`${ctrl.id}_${sf.id}`] = {};
      else d[`${ctrl.id}_${sf.id}`] = "";
    });
  });
  return d;
}

function mapToScore(v) {
  if (!v) return "na";
  const s = v.toLowerCase();
  if (["implemented", "yes", "automated", "all ", "all users", "complete", "24×7", "always", "regularly", "very confident", "confident", "dedicated consent", "automated workflow"].some(k => s.includes(k))) return "yes";
  if (["partially implemented", "partially automated", "partially", "most", "partial", "business hours", "sometimes", "occasionally", "partially confident", "selected users", "pilot", "ticketing", "website/application"].some(k => s.includes(k))) return "partial";
  if (["not implemented", "not centrally", "no ", " no", "manual", "some ", "limited", "alerts only", "never", "not confident", "admins only", "no central", "no defined", "department handles", "email + manual", "undefined"].some(k => s.includes(k)) || s === "no" || s === "manual" || s === "some") return "no";
  return "na";
}

function getITVirtualQuestions() {
  return [
    ...IT_CONTROLS.map(ctrl => ({ id: `it_${ctrl.id}`, cat: ctrl.cat, text: ctrl.title, weight: 1, dept: "IT" })),
    ...IT_OVERALL_QS.map(q => ({ id: `it_${q.id}`, cat: "Overall IT Assessment", text: q.text, weight: 1, dept: "IT" })),
  ];
}

function getITVirtualAnswers(itData) {
  const ans = {};
  IT_CONTROLS.forEach(ctrl => { ans[`it_${ctrl.id}`] = mapToScore(itData[`${ctrl.id}_status`]); });
  IT_OVERALL_QS.forEach(q => { ans[`it_${q.id}`] = mapToScore(itData[q.id]); });
  return ans;
}

// ─── Non-IT Question Banks ────────────────────────────────────────────────────
const QUESTIONS_BY_DEPT = {
  HR: [
    { id: "hr_q01", cat: "Employee Data & Consent", text: "Do you maintain a lawful basis for processing employee personal data (contract, legal obligation, or consent where required)?", weight: 1 },
    { id: "hr_q02", cat: "Employee Data & Consent", text: "Do candidates and employees receive a clear privacy notice explaining what data is collected and how it is used?", weight: 1 },
    { id: "hr_q03", cat: "Employee Data & Consent", text: "Do employees have a mechanism to access, correct, or request deletion of their personal data held by HR?", weight: 1 },
    { id: "hr_q04", cat: "Sensitive Data Protection", text: "Are sensitive employee data categories (health records, biometrics, union membership) identified and afforded heightened protection?", weight: 1 },
    { id: "hr_q05", cat: "Sensitive Data Protection", text: "Is access to HR Information Systems (HRMS / payroll) restricted to authorised HR and payroll staff only?", weight: 1 },
    { id: "hr_q06", cat: "Sensitive Data Protection", text: "Is payroll and salary data encrypted both at rest and in transit?", weight: 1 },
    { id: "hr_q07", cat: "Data Retention", text: "Do you have defined retention schedules for candidate data (rejected CVs, application forms) and delete it on expiry?", weight: 1 },
    { id: "hr_q08", cat: "Data Retention", text: "Is ex-employee data (payroll records, appraisals, contracts) securely archived and deleted after the legally required retention period?", weight: 1 },
    { id: "hr_q09", cat: "Vendor & Third-Party", text: "Do third-party HR vendors (background screeners, payroll processors, benefits providers) have signed Data Processing Agreements?", weight: 1 },
    { id: "hr_q10", cat: "Vendor & Third-Party", text: "Are background checks conducted through vetted providers contractually bound to data protection standards?", weight: 1 },
    { id: "hr_q11", cat: "Audit & Access Control", text: "Are HR records (performance reviews, disciplinary records, payslips) stored in controlled systems with audit trails?", weight: 1 },
    { id: "hr_q12", cat: "Training & Awareness", text: "Are HR staff trained annually on data privacy obligations, including handling of sensitive personal data?", weight: 1 },
  ],
  Finance: [
    { id: "fi_q01", cat: "Data Inventory & Classification", text: "Do you maintain a data inventory of all personal and financial data processed by the Finance department?", weight: 1 },
    { id: "fi_q02", cat: "Access Control", text: "Is access to financial systems (ERP, accounting software, banking portals) restricted to authorised staff on a need-to-know basis?", weight: 1 },
    { id: "fi_q03", cat: "Access Control", text: "Do you conduct periodic access reviews for financial systems to remove stale or unnecessary user accounts?", weight: 1 },
    { id: "fi_q04", cat: "Data Security", text: "Is customer financial data (payment details, bank account numbers) encrypted both at rest and in transit?", weight: 1 },
    { id: "fi_q05", cat: "Data Security", text: "Do you maintain tamper-evident audit trails for all financial transactions and data access events?", weight: 1 },
    { id: "fi_q06", cat: "Data Security", text: "Do you have controls to prevent and detect insider threats or fraud related to financial data access?", weight: 1 },
    { id: "fi_q07", cat: "Compliance & Retention", text: "Do you have data retention policies for financial records that comply with applicable tax and regulatory requirements?", weight: 1 },
    { id: "fi_q08", cat: "Compliance & Retention", text: "Are payment card data processes (if applicable) in scope for PCI-DSS compliance?", weight: 1 },
    { id: "fi_q09", cat: "Vendor & Third-Party", text: "Are third-party finance vendors (payment gateways, accounting software, ERP providers) assessed for security and covered by DPAs?", weight: 1 },
    { id: "fi_q10", cat: "Vendor & Third-Party", text: "Is customer financial data shared with third parties only under contractual data protection obligations?", weight: 1 },
    { id: "fi_q11", cat: "Incident Response", text: "Do you have a process for detecting and reporting financial data breaches within regulatory timeframes?", weight: 1 },
    { id: "fi_q12", cat: "Training & Awareness", text: "Are Finance staff trained on data privacy obligations and social engineering / phishing risks targeting financial data?", weight: 1 },
  ],
  Legal: [
    { id: "le_q01", cat: "Data Classification", text: "Do you identify and classify personal data contained in contracts, legal filings, and correspondence?", weight: 1 },
    { id: "le_q02", cat: "Data Classification", text: "Are privileged and confidential legal documents stored in access-controlled repositories with audit logs?", weight: 1 },
    { id: "le_q03", cat: "Data Subject Rights", text: "Do you have a procedure for responding to Data Subject Access Requests (DSARs) that involve Legal department records?", weight: 1 },
    { id: "le_q04", cat: "Data Subject Rights", text: "Is personal data in court filings, regulatory submissions, and correspondence minimised where possible?", weight: 1 },
    { id: "le_q05", cat: "Legal Hold & Retention", text: "Do you have a legal hold process that preserves relevant data while preventing indefinite retention of personal data?", weight: 1 },
    { id: "le_q06", cat: "Legal Hold & Retention", text: "Are retention schedules defined for legal records containing personal data, with secure disposal on expiry?", weight: 1 },
    { id: "le_q07", cat: "Vendor & Third-Party", text: "Are legal software tools (document management, e-discovery, matter management) covered by Data Processing Agreements?", weight: 1 },
    { id: "le_q08", cat: "Vendor & Third-Party", text: "Do external counsel and litigation support vendors comply with your data protection standards under contract?", weight: 1 },
    { id: "le_q09", cat: "Cross-Border Transfers", text: "Do you manage personal data flows across jurisdictions when handling cross-border legal matters?", weight: 1 },
    { id: "le_q10", cat: "Contract Governance", text: "Do you review contracts with third parties to ensure adequate data protection and confidentiality clauses are included?", weight: 1 },
  ],
  Operations: [
    { id: "op_q01", cat: "Data Inventory", text: "Do you maintain a data inventory of personal data flowing through operational processes (logistics, supply chain, facilities)?", weight: 1 },
    { id: "op_q02", cat: "Data Minimisation", text: "Do you apply data minimisation principles — collecting only the personal data strictly necessary for operational processes?", weight: 1 },
    { id: "op_q03", cat: "Access Control", text: "Are access rights to operational systems (ERP, WMS, SCADA/ICS) granted on a least-privilege, need-to-know basis?", weight: 1 },
    { id: "op_q04", cat: "System Security", text: "Are operational data systems (including IoT and edge devices) regularly patched and vulnerability-assessed?", weight: 1 },
    { id: "op_q05", cat: "System Security", text: "Is customer-facing data in operational systems (delivery addresses, order history) protected with appropriate access controls?", weight: 1 },
    { id: "op_q06", cat: "Vendor & Third-Party", text: "Do you have data processing agreements with supply chain partners and logistics providers who handle personal data?", weight: 1 },
    { id: "op_q07", cat: "Vendor & Third-Party", text: "Are third-party operational tools and integrations assessed for security before onboarding?", weight: 1 },
    { id: "op_q08", cat: "Incident Response", text: "Do you have a process for reporting and responding to operational data incidents (e.g. a lost device containing customer data)?", weight: 1 },
    { id: "op_q09", cat: "Data Retention", text: "Are defined retention periods in place for operational records containing personal data?", weight: 1 },
    { id: "op_q10", cat: "Training & Awareness", text: "Are operational staff trained to recognise and report data privacy incidents?", weight: 1 },
  ],
  Marketing: [
    { id: "mk_q01", cat: "Consent & Opt-in", text: "Do you obtain explicit, freely given consent before sending marketing emails, SMS, or push notifications?", weight: 1 },
    { id: "mk_q02", cat: "Consent & Opt-in", text: "Do you maintain a suppression list and honour opt-outs promptly (within 10 business days)?", weight: 1 },
    { id: "mk_q03", cat: "Consent & Opt-in", text: "Are website cookies and tracking technologies disclosed in a cookie banner, with consent captured before non-essential cookies are set?", weight: 1 },
    { id: "mk_q04", cat: "CRM Data Governance", text: "Do you have a CRM data governance policy covering how customer records are created, updated, and deleted?", weight: 1 },
    { id: "mk_q05", cat: "CRM Data Governance", text: "Do you regularly audit your marketing database to remove invalid, stale, or unsubscribed contacts?", weight: 1 },
    { id: "mk_q06", cat: "CRM Data Governance", text: "Do you have a process for handling customer requests to access, correct, or erase their marketing data?", weight: 1 },
    { id: "mk_q07", cat: "Profiling & Targeting", text: "Is personal data used for customer segmentation and profiling limited to what users have consented to?", weight: 1 },
    { id: "mk_q08", cat: "Profiling & Targeting", text: "Do you conduct DPIAs before launching campaigns that involve new forms of profiling or behavioural targeting?", weight: 1 },
    { id: "mk_q09", cat: "Vendor & Third-Party", text: "Are third-party marketing platforms (email tools, ad networks, analytics providers) covered by Data Processing Agreements?", weight: 1 },
    { id: "mk_q10", cat: "Vendor & Third-Party", text: "Do you review advertising partners' data practices to ensure alignment with your privacy policy and user consent?", weight: 1 },
    { id: "mk_q11", cat: "Cross-Border Transfers", text: "Is cross-border transfer of customer data (e.g. to overseas email platforms) covered by appropriate transfer mechanisms?", weight: 1 },
    { id: "mk_q12", cat: "Training & Awareness", text: "Are marketing staff trained on anti-spam regulations, cookie consent laws, and data privacy obligations?", weight: 1 },
  ],
};

const PRESET_DEPTS = ["IT", "HR", "Finance", "Legal", "Operations", "Marketing"];

function getGenericQuestions(dept) {
  return [
    { id: `${dept}_gq01`, cat: "Data Inventory", text: `Does the ${dept} department maintain an inventory of personal data it collects and processes?`, weight: 1 },
    { id: `${dept}_gq02`, cat: "Lawful Basis", text: `Has the ${dept} department identified a lawful basis for each category of personal data it processes?`, weight: 1 },
    { id: `${dept}_gq03`, cat: "Data Subject Rights", text: `Does the ${dept} department have a process to respond to data subject requests (access, correction, deletion)?`, weight: 1 },
    { id: `${dept}_gq04`, cat: "Data Minimisation", text: `Does the ${dept} department collect only the minimum personal data necessary for its activities?`, weight: 1 },
    { id: `${dept}_gq05`, cat: "Data Retention", text: `Does the ${dept} department have defined retention periods and securely dispose of personal data when no longer needed?`, weight: 1 },
    { id: `${dept}_gq06`, cat: "Access Control", text: `Is access to personal data held by the ${dept} department restricted to authorised staff only?`, weight: 1 },
    { id: `${dept}_gq07`, cat: "Vendor & Third-Party", text: `Does the ${dept} department have data processing agreements with third-party vendors who handle personal data on its behalf?`, weight: 1 },
    { id: `${dept}_gq08`, cat: "Incident Response", text: `Does the ${dept} department have a process for identifying and reporting data breaches?`, weight: 1 },
    { id: `${dept}_gq09`, cat: "Training & Awareness", text: `Are staff in the ${dept} department trained on data privacy obligations relevant to their role?`, weight: 1 },
    { id: `${dept}_gq10`, cat: "Data Security", text: `Is personal data handled by the ${dept} department protected with appropriate technical and organisational security measures?`, weight: 1 },
  ];
}

function getDeptQuestions(depts) {
  const result = [];
  for (const dept of depts.filter(d => d !== "IT")) {
    const qs = QUESTIONS_BY_DEPT[dept] || getGenericQuestions(dept);
    for (const q of qs) result.push({ ...q, dept });
  }
  return result;
}

const ANSWER_OPTIONS = [
  { value: "yes",     label: "Yes",     color: "var(--green,#16a34a)",  score: 1.0 },
  { value: "partial", label: "Partial", color: "var(--amber,#d97706)", score: 0.5 },
  { value: "no",      label: "No",      color: "var(--red,#dc2626)",   score: 0.0 },
  { value: "na",      label: "N/A",     color: "var(--text3,#888)",    score: null },
];

function storageKey(email) { return `prism_test_v2_${email.trim().toLowerCase()}`; }

function computeScore(answers, questions) {
  const cats = {}, deptsMap = {};
  let totalEarned = 0, totalPossible = 0;
  for (const q of questions) {
    const a = answers[q.id];
    const catKey = `${q.dept}__${q.cat}`;
    if (!cats[catKey]) cats[catKey] = { name: q.cat, dept: q.dept, earned: 0, possible: 0 };
    if (!deptsMap[q.dept]) deptsMap[q.dept] = { earned: 0, possible: 0 };
    if (!a || a === "na") continue;
    const opt = ANSWER_OPTIONS.find(o => o.value === a);
    const earned = opt ? opt.score * q.weight : 0;
    cats[catKey].earned += earned; cats[catKey].possible += q.weight;
    deptsMap[q.dept].earned += earned; deptsMap[q.dept].possible += q.weight;
    totalEarned += earned; totalPossible += q.weight;
  }
  const overall = totalPossible > 0 ? Math.round((totalEarned / totalPossible) * 100) : 0;
  const byCategory = Object.values(cats).map(v => ({
    name: v.name, dept: v.dept,
    score: v.possible > 0 ? Math.round((v.earned / v.possible) * 100) : 0,
    earned: v.earned, possible: v.possible,
  })).sort((a, b) => a.score - b.score);
  const byDept = Object.entries(deptsMap).map(([name, v]) => ({
    name, score: v.possible > 0 ? Math.round((v.earned / v.possible) * 100) : 0,
  }));
  return { overall, byCategory, byDept };
}

function scoreColor(s) {
  if (s >= 75) return "var(--green,#16a34a)";
  if (s >= 50) return "var(--amber,#d97706)";
  if (s >= 30) return "#ea580c";
  return "var(--red,#dc2626)";
}

function scoreLabel(s) {
  if (s >= 75) return "Good";
  if (s >= 50) return "Moderate";
  if (s >= 30) return "At Risk";
  return "Critical";
}

function ScoreRing({ score }) {
  const c = scoreColor(score);
  const circ = 2 * Math.PI * 52;
  const off = circ * (1 - score / 100);
  return (
    <svg viewBox="0 0 120 120" width={140} height={140}>
      <circle cx="60" cy="60" r="52" fill="none" stroke="var(--bg3,#e5e7eb)" strokeWidth="10" />
      <circle cx="60" cy="60" r="52" fill="none" stroke={c} strokeWidth="10"
        strokeDasharray={circ} strokeDashoffset={off} strokeLinecap="round"
        transform="rotate(-90 60 60)" style={{ transition: "stroke-dashoffset 0.8s ease" }} />
      <text x="60" y="56" textAnchor="middle" fontSize="26" fontWeight="800" fill={c}>{score}</text>
      <text x="60" y="73" textAnchor="middle" fontSize="11" fill="var(--text3,#888)">/ 100</text>
    </svg>
  );
}

// ─── IT Form Field Components ─────────────────────────────────────────────────

function ItLabel({ children }) {
  return <div style={{ fontSize: 13, fontWeight: 700, color: "var(--text2,#374151)", marginBottom: 6 }}>{children}</div>;
}

function SelectButtons({ options, value, onChange, small }) {
  return (
    <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
      {options.map(opt => {
        const sel = value === opt;
        return (
          <button key={opt} type="button" onClick={() => onChange(sel ? "" : opt)} style={{
            padding: small ? "5px 12px" : "8px 16px",
            borderRadius: 8, border: `2px solid ${sel ? "var(--accent,#2563eb)" : "var(--border2,#d1d5db)"}`,
            background: sel ? "var(--accent,#2563eb)" : "var(--bg,#f9fafb)",
            color: sel ? "#fff" : "var(--text2,#374151)",
            fontSize: small ? 12 : 13, fontWeight: 600, cursor: "pointer",
          }}>{opt}</button>
        );
      })}
    </div>
  );
}

function MultiChips({ options, value, onChange, small }) {
  const arr = Array.isArray(value) ? value : [];
  return (
    <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
      {options.map(opt => {
        const sel = arr.includes(opt);
        return (
          <button key={opt} type="button" onClick={() => onChange(sel ? arr.filter(v => v !== opt) : [...arr, opt])} style={{
            padding: small ? "5px 12px" : "7px 14px",
            borderRadius: 20, border: `2px solid ${sel ? "var(--accent,#2563eb)" : "var(--border2,#d1d5db)"}`,
            background: sel ? "rgba(37,99,235,0.1)" : "transparent",
            color: sel ? "var(--accent,#2563eb)" : "var(--text2,#374151)",
            fontSize: small ? 12 : 13, fontWeight: 600, cursor: "pointer",
          }}>{sel ? "✓ " : ""}{opt}</button>
        );
      })}
    </div>
  );
}

function MultiStatusGrid({ options, statusOptions, value, onChange }) {
  const map = value || {};
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      {options.map(opt => {
        const cur = map[opt] || "";
        return (
          <div key={opt} style={{ display: "flex", alignItems: "flex-start", gap: 10, flexWrap: "wrap" }}>
            <span style={{ flex: "0 0 180px", fontSize: 13, color: "var(--text2)", fontWeight: 500, paddingTop: 6 }}>{opt}</span>
            <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
              {statusOptions.map(st => {
                const sel = cur === st;
                return (
                  <button key={st} type="button" onClick={() => onChange({ ...map, [opt]: sel ? "" : st })} style={{
                    padding: "5px 10px", borderRadius: 6,
                    border: `1.5px solid ${sel ? "var(--accent,#2563eb)" : "var(--border2,#d1d5db)"}`,
                    background: sel ? "var(--accent,#2563eb)" : "transparent",
                    color: sel ? "#fff" : "var(--text2,#374151)",
                    fontSize: 11, fontWeight: 600, cursor: "pointer",
                  }}>{st}</button>
                );
              })}
            </div>
          </div>
        );
      })}
    </div>
  );
}

const APP_TYPES = ["CRM", "ERP", "HRMS", "Finance", "Support", "Custom Application", "Database", "Other"];
const APP_HOSTING = ["Cloud / SaaS", "On-Premises"];
const APP_PERSONAL_DATA_OPTS = ["Yes", "No", "Unsure"];

function DynamicAppsField({ value, onChange }) {
  const apps = Array.isArray(value) ? value : [];
  const addApp = () => onChange([...apps, { name: "", type: "", hosting: "", personalData: "", users: "", owner: "" }]);
  const upd = (idx, field, val) => onChange(apps.map((a, i) => i === idx ? { ...a, [field]: val } : a));
  const rem = (idx) => onChange(apps.filter((_, i) => i !== idx));
  return (
    <div>
      {apps.map((app, idx) => (
        <div key={idx} style={{ background: "var(--bg3,#f9fafb)", border: "1px solid var(--border2)", borderRadius: 8, padding: "14px", marginBottom: 10 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
            <span style={{ fontSize: 13, fontWeight: 700, color: "var(--text2)" }}>Application {idx + 1}</span>
            <button type="button" onClick={() => rem(idx)} style={{ background: "none", border: "none", color: "var(--text3)", cursor: "pointer", fontSize: 13 }}>Remove</button>
          </div>
          <div style={{ marginBottom: 8 }}>
            <ItLabel>Application Name</ItLabel>
            <input type="text" value={app.name} onChange={e => upd(idx, "name", e.target.value)} placeholder="e.g. Salesforce, SAP, custom CRM" style={{ ...itInputStyle }} />
          </div>
          <div style={{ marginBottom: 8 }}>
            <ItLabel>Application Type</ItLabel>
            <SelectButtons options={APP_TYPES} value={app.type} onChange={v => upd(idx, "type", v)} small />
          </div>
          <div style={{ marginBottom: 8 }}>
            <ItLabel>Deployment</ItLabel>
            <SelectButtons options={APP_HOSTING} value={app.hosting} onChange={v => upd(idx, "hosting", v)} small />
          </div>
          <div style={{ marginBottom: 8 }}>
            <ItLabel>Does it contain personal data?</ItLabel>
            <SelectButtons options={APP_PERSONAL_DATA_OPTS} value={app.personalData} onChange={v => upd(idx, "personalData", v)} small />
          </div>
          <div style={{ display: "flex", gap: 12 }}>
            <div style={{ flex: 1 }}>
              <ItLabel>Approximate Users</ItLabel>
              <input type="text" value={app.users} onChange={e => upd(idx, "users", e.target.value)} placeholder="e.g. 500" style={{ ...itInputStyle }} />
            </div>
            <div style={{ flex: 1 }}>
              <ItLabel>Application Owner</ItLabel>
              <input type="text" value={app.owner} onChange={e => upd(idx, "owner", e.target.value)} placeholder="e.g. IT Manager" style={{ ...itInputStyle }} />
            </div>
          </div>
        </div>
      ))}
      <button type="button" onClick={addApp} style={{
        width: "100%", padding: "10px", borderRadius: 8,
        border: "2px dashed var(--border2,#d1d5db)", background: "transparent",
        color: "var(--accent,#2563eb)", fontSize: 13, fontWeight: 700, cursor: "pointer",
      }}>+ Add Application</button>
    </div>
  );
}

const itInputStyle = {
  width: "100%", padding: "8px 10px", borderRadius: 8, border: "1px solid var(--border2,#d1d5db)",
  background: "var(--bg,#f9fafb)", color: "var(--text,#111)", fontSize: 13, boxSizing: "border-box", outline: "none",
};

const STATUS_OPTIONS = ["Implemented", "Partially Implemented", "Not Implemented", "Unsure"];
const COVERAGE_OPTIONS = ["All", "Most", "Some", "Pilot", "Unknown"];
const EVIDENCE_OPTIONS = ["Yes", "No", "Unsure"];

function ITSectionA({ itData, onChange }) {
  return (
    <div>
      <div style={{ marginBottom: 22 }}>
        <div style={{ fontSize: 14, fontWeight: 700, color: "var(--text)", marginBottom: 4 }}>1. Primary Productivity Platform</div>
        <div style={{ fontSize: 12, color: "var(--text3)", marginBottom: 10 }}>Select all that apply.</div>
        <MultiChips options={["Microsoft 365", "Google Workspace", "Other", "Not Sure"]} value={itData.a_productivity} onChange={v => onChange("a_productivity", v)} />
      </div>
      <div style={{ marginBottom: 22 }}>
        <div style={{ fontSize: 14, fontWeight: 700, color: "var(--text)", marginBottom: 4 }}>2. Cloud Platforms</div>
        <div style={{ fontSize: 12, color: "var(--text3)", marginBottom: 10 }}>Select all that apply.</div>
        <MultiChips options={["Microsoft Azure", "AWS", "Google Cloud", "Private Cloud", "On-Premises", "Other", "No Cloud", "Not Sure"]} value={itData.a_cloud} onChange={v => onChange("a_cloud", v)} />
      </div>
      <div>
        <div style={{ fontSize: 14, fontWeight: 700, color: "var(--text)", marginBottom: 4 }}>3. Core Business Applications</div>
        <div style={{ fontSize: 12, color: "var(--text3)", marginBottom: 10 }}>Add applications that process personal data.</div>
        <DynamicAppsField value={itData.a_applications} onChange={v => onChange("a_applications", v)} />
      </div>
    </div>
  );
}

function ITControlStep({ ctrl, itData, onChange }) {
  const get = k => itData[`${ctrl.id}_${k}`];
  const set = (k, v) => onChange(`${ctrl.id}_${k}`, v);
  return (
    <div>
      <div style={{ background: "rgba(37,99,235,0.05)", border: "1px solid rgba(37,99,235,0.15)", borderRadius: 8, padding: "12px 14px", marginBottom: 20 }}>
        <div style={{ fontSize: 11, fontWeight: 700, color: "var(--accent,#2563eb)", textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: 4 }}>Why is this important?</div>
        <div style={{ fontSize: 13, color: "var(--text2)", lineHeight: 1.55, marginBottom: 10 }}>{ctrl.why}</div>
        <div style={{ fontSize: 11, fontWeight: 700, color: "var(--accent,#2563eb)", textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: 4 }}>How technology helps</div>
        <div style={{ fontSize: 13, color: "var(--text2)", lineHeight: 1.55 }}>{ctrl.how}</div>
      </div>

      <div style={{ marginBottom: 16 }}>
        <ItLabel>Current Status</ItLabel>
        <SelectButtons options={STATUS_OPTIONS} value={get("status")} onChange={v => set("status", v)} />
      </div>

      {ctrl.products.length > 0 && (
        <div style={{ marginBottom: 16 }}>
          <ItLabel>Products currently used</ItLabel>
          <MultiChips options={ctrl.products} value={get("products")} onChange={v => set("products", v)} />
        </div>
      )}

      <div style={{ marginBottom: 16 }}>
        <ItLabel>Coverage</ItLabel>
        <SelectButtons options={COVERAGE_OPTIONS} value={get("coverage")} onChange={v => set("coverage", v)} small />
      </div>

      <div style={{ marginBottom: 16 }}>
        <ItLabel>How Used Today</ItLabel>
        <textarea value={get("how_used")} onChange={e => set("how_used", e.target.value)}
          placeholder="Brief description of current usage..." rows={2}
          style={{ ...itInputStyle, resize: "vertical" }} />
      </div>

      <div style={{ marginBottom: 20 }}>
        <ItLabel>Evidence Available</ItLabel>
        <SelectButtons options={EVIDENCE_OPTIONS} value={get("evidence")} onChange={v => set("evidence", v)} small />
      </div>

      {ctrl.subFields.map(sf => (
        <div key={sf.id} style={{ marginBottom: 16, paddingTop: 16, borderTop: "1px solid var(--border2,#e5e7eb)" }}>
          <ItLabel>{sf.label}</ItLabel>
          {sf.type === "select" && <SelectButtons options={sf.options} value={itData[`${ctrl.id}_${sf.id}`]} onChange={v => onChange(`${ctrl.id}_${sf.id}`, v)} small />}
          {(sf.type === "multiselect" || sf.type === "product-select") && <MultiChips options={sf.options} value={itData[`${ctrl.id}_${sf.id}`]} onChange={v => onChange(`${ctrl.id}_${sf.id}`, v)} small />}
          {sf.type === "multiselect-with-status" && (
            <MultiStatusGrid options={sf.options} statusOptions={sf.statusOptions} value={itData[`${ctrl.id}_${sf.id}`]} onChange={v => onChange(`${ctrl.id}_${sf.id}`, v)} />
          )}
        </div>
      ))}
    </div>
  );
}

function ITSectionC({ itData, onChange }) {
  return (
    <div>
      {IT_OVERALL_QS.map((q, i) => (
        <div key={q.id} style={{ marginBottom: i < IT_OVERALL_QS.length - 1 ? 24 : 0, paddingBottom: i < IT_OVERALL_QS.length - 1 ? 24 : 0, borderBottom: i < IT_OVERALL_QS.length - 1 ? "1px solid var(--border2)" : "none" }}>
          <div style={{ fontSize: 14, fontWeight: 600, color: "var(--text)", marginBottom: 12, lineHeight: 1.5 }}>{q.text}</div>
          <SelectButtons options={q.options} value={itData[q.id]} onChange={v => onChange(q.id, v)} small />
        </div>
      ))}
    </div>
  );
}

// ─── Report Builders ──────────────────────────────────────────────────────────
function buildReportText({ userInfo, answers, score, questions, selectedDepts }) {
  const { overall, byCategory, byDept } = score;
  const lines = [
    `PRISM Compliance Self-Assessment Report`,
    `========================================`,
    ``,
    `Name:        ${userInfo.name}`,
    `Email:       ${userInfo.email}`,
    userInfo.company ? `Company:     ${userInfo.company}` : null,
    `Departments: ${selectedDepts.join(", ")}`,
    `Date:        ${new Date().toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" })}`,
    ``,
    `Overall Score: ${overall}/100 — ${scoreLabel(overall)}`,
    ``,
    ...(byDept.length > 1 ? [`── Department Scores ───────────────────────`, ...byDept.map(d => `  ${d.name}: ${d.score}%`), ``] : []),
    `── Category Breakdown ─────────────────────`,
    ...byCategory.map(c => `  ${c.dept} · ${c.name}: ${c.score}%`),
    ``,
    `── Gaps (No / Partial answers) ───────────`,
    ...questions.filter(q => answers[q.id] === "no" || answers[q.id] === "partial").map(q =>
      `  ${answers[q.id] === "no" ? "✗" : "~"} [${q.dept} · ${q.cat}] ${q.text}`
    ),
    ``,
    `──────────────────────────────────────────`,
    `Generated by PRISM Compliance Platform`,
    `https://prism.auditready.in`,
  ].filter(l => l !== null);
  return lines.join("\n");
}

function buildReportHtml({ userInfo, answers, score, questions, selectedDepts }) {
  const { overall, byCategory, byDept } = score;
  const gaps = questions.filter(q => answers[q.id] === "no" || answers[q.id] === "partial");
  const c = scoreColor(overall);
  return `<!DOCTYPE html>
<html lang="en"><head><meta charset="UTF-8"/><title>PRISM Compliance Assessment Report</title>
<style>body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;background:#f9fafb;color:#111;margin:0;padding:0}.wrap{max-width:680px;margin:0 auto;background:#fff;border-radius:12px;overflow:hidden;box-shadow:0 4px 24px rgba(0,0,0,.08)}.header{background:#1e3a5f;color:#fff;padding:32px 36px}.header h1{margin:0 0 4px;font-size:22px}.header p{margin:0;font-size:14px;opacity:.75}.body{padding:32px 36px}.score-box{text-align:center;padding:24px 0 16px}.score-num{font-size:64px;font-weight:800;color:${c};line-height:1}.score-label{font-size:18px;font-weight:600;color:${c};margin-top:4px}.section-title{font-size:15px;font-weight:700;color:#374151;margin:28px 0 12px;border-bottom:1px solid #e5e7eb;padding-bottom:6px}.dept-chip{display:inline-block;padding:2px 10px;border-radius:12px;background:#eff6ff;color:#1e40af;font-size:11px;font-weight:700;margin:0 4px 4px 0}.cat-row{display:flex;align-items:center;gap:10px;margin-bottom:8px}.cat-name{flex:1;font-size:13px;color:#374151}.cat-dept{font-size:11px;font-weight:600;color:#6b7280;margin-right:4px}.cat-bar-wrap{width:160px;height:8px;background:#e5e7eb;border-radius:4px;overflow:hidden}.cat-bar{height:100%;border-radius:4px}.cat-pct{font-size:13px;font-weight:600;width:36px;text-align:right}.dept-row{display:flex;align-items:center;gap:10px;margin-bottom:10px;padding:10px 12px;background:#f9fafb;border-radius:6px;border:1px solid #e5e7eb}.gap-item{padding:10px 12px;border-left:3px solid #e5e7eb;margin-bottom:8px;background:#f9fafb;border-radius:0 6px 6px 0}.gap-item.no{border-left-color:#dc2626}.gap-item.partial{border-left-color:#d97706}.gap-cat{font-size:11px;font-weight:600;color:#6b7280;text-transform:uppercase;letter-spacing:.04em;margin-bottom:2px}.gap-text{font-size:13px;color:#111}.footer{background:#f3f4f6;padding:20px 36px;font-size:12px;color:#6b7280;text-align:center}.meta{font-size:13px;color:#6b7280;margin-bottom:4px}</style>
</head><body><div class="wrap">
<div class="header"><h1>PRISM Compliance Assessment</h1><p>Self-Assessment Report · ${new Date().toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" })}</p></div>
<div class="body">
<p class="meta"><strong>${userInfo.name}</strong>${userInfo.company ? ` · ${userInfo.company}` : ""}</p>
<p class="meta">${userInfo.email}</p>
<p class="meta" style="margin-top:8px">${selectedDepts.map(d => `<span class="dept-chip">${d}</span>`).join("")}</p>
<div class="score-box"><div class="score-num">${overall}</div><div class="score-label">${scoreLabel(overall)}</div><div style="font-size:13px;color:#6b7280;margin-top:6px;">Overall compliance score out of 100</div></div>
${byDept.length > 1 ? `<div class="section-title">Department Scores</div>${byDept.map(dept => { const dc = dept.score >= 75 ? "#16a34a" : dept.score >= 50 ? "#d97706" : dept.score >= 30 ? "#ea580c" : "#dc2626"; return `<div class="dept-row"><div style="flex:1;font-size:14px;font-weight:700;color:#374151">${dept.name}</div><div style="width:140px;height:8px;background:#e5e7eb;border-radius:4px;overflow:hidden"><div style="height:100%;width:${dept.score}%;background:${dc};border-radius:4px"></div></div><div style="font-size:14px;font-weight:700;color:${dc};width:36px;text-align:right">${dept.score}%</div></div>`; }).join("")}` : ""}
<div class="section-title">Category Breakdown</div>
${byCategory.map(cat => { const cc = cat.score >= 75 ? "#16a34a" : cat.score >= 50 ? "#d97706" : cat.score >= 30 ? "#ea580c" : "#dc2626"; return `<div class="cat-row"><div class="cat-name"><span class="cat-dept">${cat.dept}:</span>${cat.name}</div><div class="cat-bar-wrap"><div class="cat-bar" style="width:${cat.score}%;background:${cc}"></div></div><div class="cat-pct" style="color:${cc}">${cat.score}%</div></div>`; }).join("")}
${gaps.length > 0 ? `<div class="section-title">Gaps to Address (${gaps.length})</div>${gaps.map(q => `<div class="gap-item ${answers[q.id]}"><div class="gap-cat">${q.dept} · ${q.cat} · ${answers[q.id] === "no" ? "Not in place" : "Partial"}</div><div class="gap-text">${q.text}</div></div>`).join("")}` : ""}
<div style="margin-top:32px;padding:20px;background:#eff6ff;border-radius:8px;border:1px solid #bfdbfe"><div style="font-size:15px;font-weight:700;color:#1e40af;margin-bottom:8px">Ready to close the gaps?</div><div style="font-size:13px;color:#1e3a5f;line-height:1.6">PRISM helps you track compliance posture over time — assign owners, record evidence, set reminders, and always be audit-ready.</div><a href="https://prism.auditready.in/register" style="display:inline-block;margin-top:12px;padding:10px 20px;background:#1e3a5f;color:#fff;border-radius:6px;font-weight:600;font-size:13px;text-decoration:none">Start a full PRISM assessment →</a></div>
</div><div class="footer">Generated by PRISM Compliance Platform · prism.auditready.in</div></div></body></html>`;
}

// ─── Main Component ───────────────────────────────────────────────────────────
export default function PrismTest() {
  const [phase, setPhase] = useState("intro");
  const [userInfo, setUserInfo] = useState({ name: "", email: "", company: "" });
  const [selectedDepts, setSelectedDepts] = useState(["IT"]);
  const [customDepts, setCustomDepts] = useState([]);
  const [showAddDept, setShowAddDept] = useState(false);
  const [newDeptName, setNewDeptName] = useState("");
  const [formErrors, setFormErrors] = useState({});
  const [answers, setAnswers] = useState({});
  const [activeQuestions, setActiveQuestions] = useState([]);
  const [current, setCurrent] = useState(0);
  const [itData, setItData] = useState(defaultItData);
  const [itStep, setItStep] = useState(0);
  const [emailSending, setEmailSending] = useState(false);
  const [emailSent, setEmailSent] = useState(false);
  const [emailError, setEmailError] = useState("");
  const cardRef = useRef(null);
  const itTopRef = useRef(null);

  const restoreProgress = (email) => {
    try { return JSON.parse(localStorage.getItem(storageKey(email)) || "null"); } catch { return null; }
  };

  const saveProgress = (email, data) => {
    try { localStorage.setItem(storageKey(email), JSON.stringify(data)); } catch {}
  };

  const toggleDept = (dept) => {
    setSelectedDepts(prev => prev.includes(dept)
      ? prev.length === 1 ? prev : prev.filter(d => d !== dept)
      : [...prev, dept]);
  };

  const handleAddDept = () => {
    const name = newDeptName.trim();
    if (name && !PRESET_DEPTS.includes(name) && !customDepts.includes(name)) {
      setCustomDepts(prev => [...prev, name]);
      setSelectedDepts(prev => [...prev, name]);
    }
    setNewDeptName(""); setShowAddDept(false);
  };

  const handleStart = (e) => {
    e.preventDefault();
    const errors = {};
    if (!userInfo.name.trim()) errors.name = "Name is required";
    if (!userInfo.email.trim()) errors.email = "Email is required";
    else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(userInfo.email.trim())) errors.email = "Enter a valid email address";
    if (Object.keys(errors).length) { setFormErrors(errors); return; }

    const saved = restoreProgress(userInfo.email);
    let restoredAnswers = {};
    let restoredItData = defaultItData();

    if (saved?.depts && JSON.stringify(saved.depts) === JSON.stringify(selectedDepts)) {
      if (saved.answers) restoredAnswers = saved.answers;
      if (saved.itData) restoredItData = { ...defaultItData(), ...saved.itData };
    }

    setItData(restoredItData);

    if (selectedDepts.includes("IT")) {
      setItStep(0);
      setPhase("it-form");
    } else {
      const qs = getDeptQuestions(selectedDepts);
      setActiveQuestions(qs);
      setAnswers(restoredAnswers);
      setCurrent(restoredAnswers && Object.keys(restoredAnswers).length > 0
        ? Math.max(0, qs.findIndex(q => !restoredAnswers[q.id]))
        : 0);
      setPhase("assessing");
    }
  };

  const handleITChange = (key, val) => {
    setItData(prev => {
      const next = { ...prev, [key]: val };
      saveProgress(userInfo.email, { answers, userInfo, depts: selectedDepts, itData: next });
      return next;
    });
  };

  const handleITNext = () => {
    if (itStep < IT_TOTAL_STEPS - 1) {
      setItStep(s => s + 1);
      itTopRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    } else {
      const nonIT = selectedDepts.filter(d => d !== "IT");
      if (nonIT.length > 0) {
        const qs = getDeptQuestions(nonIT);
        setActiveQuestions(qs);
        setAnswers({});
        setCurrent(0);
        setPhase("assessing");
      } else {
        setPhase("results");
      }
    }
  };

  const handleITBack = () => {
    if (itStep > 0) {
      setItStep(s => s - 1);
      itTopRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    } else {
      setPhase("intro");
    }
  };

  const handleAnswer = (value) => {
    const q = activeQuestions[current];
    const newAnswers = { ...answers, [q.id]: value };
    setAnswers(newAnswers);
    saveProgress(userInfo.email, { answers: newAnswers, userInfo, depts: selectedDepts, itData });
    if (current < activeQuestions.length - 1) {
      setCurrent(i => i + 1);
      cardRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    } else {
      setPhase("results");
    }
  };

  const handleRestart = () => {
    setAnswers({}); setCurrent(0); setActiveQuestions([]);
    setSelectedDepts(["IT"]); setItData(defaultItData()); setItStep(0);
    setPhase("intro"); setEmailSent(false); setEmailError("");
  };

  const itVirtualQs = selectedDepts.includes("IT") ? getITVirtualQuestions() : [];
  const itVirtualAnswers = selectedDepts.includes("IT") ? getITVirtualAnswers(itData) : {};
  const allAnswers = { ...answers, ...itVirtualAnswers };
  const allQuestions = [...activeQuestions, ...itVirtualQs];
  const answeredCount = allQuestions.filter(q => allAnswers[q.id] && allAnswers[q.id] !== "na").length;
  const score = computeScore(allAnswers, allQuestions);

  const handleEmailReport = async () => {
    setEmailSending(true); setEmailError("");
    const reportHtml = buildReportHtml({ userInfo, answers: allAnswers, score, questions: allQuestions, selectedDepts });
    const reportText = buildReportText({ userInfo, answers: allAnswers, score, questions: allQuestions, selectedDepts });
    try {
      const resp = await fetch(`${API_URL}/api/contact/report`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: userInfo.name, email: userInfo.email, company: userInfo.company, score: score.overall, reportHtml, reportText }),
      });
      const data = await resp.json();
      if (!resp.ok) throw new Error(data.error || "Failed to send report");
      setEmailSent(true);
    } catch (err) {
      setEmailError(err.message || "Could not send report. Please try again.");
    } finally {
      setEmailSending(false);
    }
  };

  // ── Intro screen ─────────────────────────────────────────────────────────
  if (phase === "intro") {
    const previewCount = getDeptQuestions(selectedDepts).length + (selectedDepts.includes("IT") ? IT_TOTAL_STEPS : 0);
    return (
      <div style={styles.shell}>
        <div style={styles.header}>
          <Link to="/" style={{ textDecoration: "none" }}><Logo style={{ height: 36 }} /></Link>
          <Link to="/login" style={styles.signInBtn}>Sign In →</Link>
        </div>
        <div style={styles.body}>
          <div style={styles.introBadge}>Free · DPDPA / GDPR · Per-Department Assessment</div>
          <h1 style={styles.heroTitle}>Is your organisation compliance-ready?</h1>
          <p style={styles.heroSub}>Select the departments you want to assess. Each department gets questions tailored to its specific data handling activities — covering DPDPA 2023, GDPR, and ISO 27001 key controls.</p>
          <div style={styles.card}>
            <h2 style={styles.cardTitle}>Start your assessment</h2>
            <p style={{ fontSize: 13, color: "var(--text3)", marginBottom: 20, marginTop: 0 }}>Enter your details to save progress and receive your report by email when you're done.</p>
            <form onSubmit={handleStart}>
              <div style={styles.fieldRow}>
                <label style={styles.label}>Full Name *</label>
                <input style={{ ...styles.input, borderColor: formErrors.name ? "var(--red,#dc2626)" : "var(--border2)" }} type="text" placeholder="Jane Smith" value={userInfo.name} onChange={e => setUserInfo(v => ({ ...v, name: e.target.value }))} autoComplete="name" />
                {formErrors.name && <p style={styles.fieldError}>{formErrors.name}</p>}
              </div>
              <div style={styles.fieldRow}>
                <label style={styles.label}>Work Email *</label>
                <input style={{ ...styles.input, borderColor: formErrors.email ? "var(--red,#dc2626)" : "var(--border2)" }} type="email" placeholder="jane@company.com" value={userInfo.email} onChange={e => setUserInfo(v => ({ ...v, email: e.target.value }))} autoComplete="email" />
                {formErrors.email && <p style={styles.fieldError}>{formErrors.email}</p>}
              </div>
              <div style={styles.fieldRow}>
                <label style={styles.label}>Company <span style={{ color: "var(--text3)" }}>(optional)</span></label>
                <input style={styles.input} type="text" placeholder="Acme Corp" value={userInfo.company} onChange={e => setUserInfo(v => ({ ...v, company: e.target.value }))} autoComplete="organization" />
              </div>
              <div style={styles.fieldRow}>
                <label style={styles.label}>Departments to assess *</label>
                <p style={{ fontSize: 12, color: "var(--text3)", margin: "0 0 10px" }}>Select one or more departments. IT generates the DPDPA Technology Controls assessment.</p>
                <div style={{ display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center" }}>
                  {[...PRESET_DEPTS, ...customDepts].map(dept => {
                    const selected = selectedDepts.includes(dept);
                    return (
                      <button key={dept} type="button" onClick={() => toggleDept(dept)} style={{
                        padding: "7px 16px", borderRadius: 20,
                        border: `2px solid ${selected ? "var(--accent,#2563eb)" : "var(--border2,#d1d5db)"}`,
                        background: selected ? "var(--accent,#2563eb)" : "var(--bg,#f9fafb)",
                        color: selected ? "#fff" : "var(--text2,#374151)",
                        fontSize: 13, fontWeight: 600, cursor: "pointer", transition: "all 0.15s ease",
                      }}>{dept}</button>
                    );
                  })}
                  {showAddDept ? (
                    <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
                      <input autoFocus type="text" placeholder="Department name" value={newDeptName}
                        onChange={e => setNewDeptName(e.target.value)}
                        onKeyDown={e => { if (e.key === "Enter") { e.preventDefault(); handleAddDept(); } if (e.key === "Escape") { setShowAddDept(false); setNewDeptName(""); } }}
                        style={{ ...styles.input, width: 160, padding: "6px 10px", fontSize: 13 }} />
                      <button type="button" onClick={handleAddDept} style={{ ...styles.primaryBtn, width: "auto", padding: "6px 14px", fontSize: 13 }}>Add</button>
                      <button type="button" onClick={() => { setShowAddDept(false); setNewDeptName(""); }} style={{ ...styles.ghostBtn, padding: "6px 8px" }}>✕</button>
                    </div>
                  ) : (
                    <button type="button" onClick={() => setShowAddDept(true)} style={{ padding: "7px 14px", borderRadius: 20, border: "2px dashed var(--border2,#d1d5db)", background: "transparent", color: "var(--text3,#888)", fontSize: 13, fontWeight: 600, cursor: "pointer" }}>+ Add</button>
                  )}
                </div>
                <div style={{ marginTop: 10, fontSize: 12, color: "var(--text3)", display: "flex", alignItems: "center", gap: 6 }}>
                  <span style={{ fontWeight: 700, color: "var(--accent,#2563eb)" }}>{previewCount} sections</span>
                  <span>· {selectedDepts.length} department{selectedDepts.length > 1 ? "s" : ""} selected</span>
                  {selectedDepts.includes("IT") && <span style={{ background: "rgba(37,99,235,0.1)", color: "var(--accent,#2563eb)", padding: "2px 8px", borderRadius: 10, fontSize: 11, fontWeight: 700 }}>IT: 18-step assessment</span>}
                </div>
              </div>
              <button type="submit" style={styles.primaryBtn}>Begin Assessment →</button>
              <p style={{ fontSize: 11, color: "var(--text3)", marginTop: 12, textAlign: "center", lineHeight: 1.5 }}>Your responses are saved locally in your browser. We only use your email to send the report if you request it.</p>
            </form>
          </div>
          <div style={{ display: "flex", gap: 24, justifyContent: "center", flexWrap: "wrap", marginTop: 32 }}>
            {[{ icon: "🔒", title: "Data Privacy", desc: "DPDPA 2023 & GDPR readiness" }, { icon: "🛡", title: "ISO 27001", desc: "Key security controls coverage" }, { icon: "📋", title: "Instant Report", desc: "Score + actionable gap list" }].map(f => (
              <div key={f.title} style={styles.featureChip}>
                <div style={{ fontSize: 22 }}>{f.icon}</div>
                <div><div style={{ fontWeight: 700, fontSize: 13 }}>{f.title}</div><div style={{ fontSize: 12, color: "var(--text3)" }}>{f.desc}</div></div>
              </div>
            ))}
          </div>
        </div>
      </div>
    );
  }

  // ── IT Form screen ────────────────────────────────────────────────────────
  if (phase === "it-form") {
    const ctrl = itStep >= 1 && itStep <= 16 ? IT_CONTROLS[itStep - 1] : null;
    const itProgress = Math.round((itStep / IT_TOTAL_STEPS) * 100);
    const sectionLabel = itStep === 0 ? "Section A" : itStep <= 16 ? "Section B" : "Section C";
    const stepTitle = itStep === 0 ? "A. Organisation Technology Profile"
      : itStep <= 16 ? `B${itStep}. ${ctrl.title}`
      : "C. Overall IT Assessment";
    const isLast = itStep === IT_TOTAL_STEPS - 1;
    const nonIT = selectedDepts.filter(d => d !== "IT");

    return (
      <div style={styles.shell}>
        <div style={styles.header}>
          <Link to="/" style={{ textDecoration: "none" }}><Logo style={{ height: 36 }} /></Link>
          <div style={{ fontSize: 13, color: "var(--text2)" }}>IT Assessment · {itStep + 1} of {IT_TOTAL_STEPS}</div>
        </div>
        <div style={{ height: 4, background: "var(--bg3,#e5e7eb)" }}>
          <div style={{ height: "100%", width: `${itProgress}%`, background: "var(--accent,#2563eb)", transition: "width 0.3s ease" }} />
        </div>
        <div style={{ ...styles.body, maxWidth: 640 }} ref={itTopRef}>
          <div style={{ textAlign: "center", marginBottom: 8 }}>
            <span style={{ fontSize: 11, fontWeight: 700, letterSpacing: "0.05em", textTransform: "uppercase", color: "var(--text3)", background: "var(--bg3)", padding: "4px 12px", borderRadius: 20 }}>{sectionLabel}</span>
          </div>
          <div style={styles.card}>
            <h2 style={{ ...styles.cardTitle, fontSize: 16, marginBottom: 20 }}>{stepTitle}</h2>
            {itStep === 0 && <ITSectionA itData={itData} onChange={handleITChange} />}
            {ctrl && <ITControlStep ctrl={ctrl} itData={itData} onChange={handleITChange} />}
            {itStep === 17 && <ITSectionC itData={itData} onChange={handleITChange} />}
          </div>

          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", maxWidth: 560, margin: "0 auto" }}>
            <button onClick={handleITBack} style={styles.ghostBtn}>← Back</button>
            <button onClick={handleITNext} style={{ ...styles.primaryBtn, width: "auto", padding: "10px 24px" }}>
              {isLast ? (nonIT.length > 0 ? "Next Department →" : "View Results →") : "Next →"}
            </button>
          </div>

          <div style={{ display: "flex", flexWrap: "wrap", gap: 3, justifyContent: "center", maxWidth: 480, margin: "14px auto 0" }}>
            {Array.from({ length: IT_TOTAL_STEPS }, (_, i) => (
              <button key={i} onClick={() => { setItStep(i); itTopRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }); }} style={{
                width: 8, height: 8, borderRadius: "50%", padding: 0, border: i === itStep ? "2px solid var(--accent,#2563eb)" : "none",
                background: i < itStep ? "var(--accent,#2563eb)" : i === itStep ? "var(--accent,#2563eb)" : "var(--bg3,#e5e7eb)",
                cursor: "pointer", opacity: i < itStep ? 0.45 : 1, boxSizing: "border-box",
              }} title={i === 0 ? "Section A" : i <= 16 ? `B${i}: ${IT_CONTROLS[i-1].cat}` : "Section C"} />
            ))}
          </div>
        </div>
      </div>
    );
  }

  // ── Assessment screen (non-IT questions) ──────────────────────────────────
  if (phase === "assessing") {
    const q = activeQuestions[current];
    const nonITAnswered = activeQuestions.filter(q => answers[q.id]).length;
    const progress = Math.round((nonITAnswered / activeQuestions.length) * 100);

    return (
      <div style={styles.shell}>
        <div style={styles.header}>
          <Link to="/" style={{ textDecoration: "none" }}><Logo style={{ height: 36 }} /></Link>
          <div style={{ fontSize: 13, color: "var(--text2)" }}>{userInfo.name} · {nonITAnswered}/{activeQuestions.length} answered</div>
        </div>
        <div style={{ height: 4, background: "var(--bg3,#e5e7eb)" }}>
          <div style={{ height: "100%", width: `${progress}%`, background: "var(--accent,#2563eb)", transition: "width 0.3s ease" }} />
        </div>
        <div style={styles.body} ref={cardRef}>
          <div style={{ textAlign: "center", marginBottom: 8 }}>
            <span style={{ fontSize: 11, fontWeight: 700, letterSpacing: "0.05em", textTransform: "uppercase", color: "var(--text3)", background: "var(--bg3)", padding: "4px 12px", borderRadius: 20 }}>
              {activeQuestions.length > 0 && selectedDepts.filter(d => d !== "IT").length > 1 ? `${q.dept} · ` : ""}{q.cat}
            </span>
          </div>
          <div style={{ textAlign: "center", marginBottom: 4 }}>
            <span style={{ fontSize: 12, color: "var(--text3)" }}>Question {current + 1} of {activeQuestions.length}</span>
          </div>
          <div style={{ ...styles.card, textAlign: "center" }}>
            <p style={{ fontSize: 17, fontWeight: 600, lineHeight: 1.55, color: "var(--text)", margin: "0 0 28px" }}>{q.text}</p>
            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              {ANSWER_OPTIONS.map(opt => (
                <button key={opt.value} onClick={() => handleAnswer(opt.value)} style={{
                  ...styles.answerBtn,
                  borderColor: answers[q.id] === opt.value ? opt.color : "var(--border2)",
                  background: answers[q.id] === opt.value ? `${opt.color}18` : "var(--bg)",
                  color: answers[q.id] === opt.value ? opt.color : "var(--text)",
                  fontWeight: answers[q.id] === opt.value ? 700 : 500,
                }}>{opt.label}</button>
              ))}
            </div>
          </div>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", maxWidth: 480, margin: "0 auto" }}>
            <button onClick={() => setCurrent(i => Math.max(0, i - 1))} disabled={current === 0} style={{ ...styles.ghostBtn, opacity: current === 0 ? 0.3 : 1 }}>← Back</button>
            {nonITAnswered === activeQuestions.length && <button onClick={() => setPhase("results")} style={styles.primaryBtn}>View Results →</button>}
            <button onClick={() => setCurrent(i => Math.min(activeQuestions.length - 1, i + 1))} disabled={current === activeQuestions.length - 1} style={{ ...styles.ghostBtn, opacity: current === activeQuestions.length - 1 ? 0.3 : 1 }}>Skip →</button>
          </div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 4, justifyContent: "center", maxWidth: 400, margin: "12px auto 0" }}>
            {activeQuestions.map((qq, i) => {
              const a = answers[qq.id];
              const bg = !a ? "var(--bg3,#e5e7eb)" : a === "yes" ? "var(--green,#16a34a)" : a === "partial" ? "var(--amber,#d97706)" : a === "no" ? "var(--red,#dc2626)" : "var(--text3,#888)";
              return <button key={qq.id} onClick={() => setCurrent(i)} style={{ width: 10, height: 10, borderRadius: "50%", border: i === current ? "2px solid var(--accent,#2563eb)" : "none", background: bg, cursor: "pointer", padding: 0, boxSizing: "border-box" }} title={`Q${i + 1}: ${qq.dept} · ${qq.cat}`} />;
            })}
          </div>
        </div>
      </div>
    );
  }

  // ── Results screen ────────────────────────────────────────────────────────
  const { overall, byCategory, byDept } = score;
  const gaps = allQuestions.filter(q => allAnswers[q.id] === "no" || allAnswers[q.id] === "partial");

  return (
    <div style={styles.shell}>
      <div style={styles.header}>
        <Link to="/" style={{ textDecoration: "none" }}><Logo style={{ height: 36 }} /></Link>
        <button onClick={handleRestart} style={styles.ghostBtn}>← Restart</button>
      </div>
      <div style={styles.body}>
        <h1 style={{ ...styles.heroTitle, marginBottom: 8 }}>Your assessment is complete</h1>
        <p style={{ ...styles.heroSub, marginBottom: 0 }}>{userInfo.name}{userInfo.company ? ` · ${userInfo.company}` : ""}</p>
        <div style={{ display: "flex", gap: 6, justifyContent: "center", flexWrap: "wrap", marginTop: 8, marginBottom: 4 }}>
          {selectedDepts.map(d => <span key={d} style={{ fontSize: 11, fontWeight: 700, padding: "2px 10px", borderRadius: 12, background: "rgba(37,99,235,0.08)", color: "var(--accent,#2563eb)", border: "1.5px solid rgba(37,99,235,0.25)" }}>{d}</span>)}
        </div>
        <div style={{ ...styles.card, textAlign: "center" }}>
          <ScoreRing score={overall} />
          <div style={{ fontSize: 18, fontWeight: 700, color: scoreColor(overall), marginTop: 8 }}>{scoreLabel(overall)}</div>
          <div style={{ fontSize: 13, color: "var(--text3)", marginTop: 4 }}>{answeredCount} of {allQuestions.length} sections answered</div>
          <div style={{ marginTop: 24, borderTop: "1px solid var(--border2)", paddingTop: 20 }}>
            {emailSent ? (
              <div style={{ fontSize: 14, color: "var(--green,#16a34a)", fontWeight: 600 }}>✓ Report sent to {userInfo.email}</div>
            ) : (
              <>
                <p style={{ fontSize: 13, color: "var(--text2)", marginBottom: 12, marginTop: 0 }}>Get a full HTML report with your scores and gap list delivered to your inbox.</p>
                {emailError && <p style={{ fontSize: 13, color: "var(--red,#dc2626)", marginBottom: 10 }}>{emailError}</p>}
                <button onClick={handleEmailReport} disabled={emailSending} style={{ ...styles.primaryBtn, display: "inline-flex", alignItems: "center", gap: 8 }}>
                  {emailSending ? "Sending…" : "📧 Email my report"}
                </button>
                <div style={{ fontSize: 11, color: "var(--text3)", marginTop: 8 }}>Will be sent to {userInfo.email}</div>
              </>
            )}
          </div>
        </div>

        {byDept.length > 1 && (
          <div style={styles.card}>
            <h2 style={styles.cardTitle}>Department Scores</h2>
            {byDept.map(dept => (
              <div key={dept.name} style={{ marginBottom: 14 }}>
                <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 4, fontSize: 13 }}>
                  <span style={{ fontWeight: 700 }}>{dept.name}</span>
                  <span style={{ color: scoreColor(dept.score), fontWeight: 700 }}>{dept.score}%</span>
                </div>
                <div style={{ height: 8, background: "var(--bg3,#e5e7eb)", borderRadius: 4, overflow: "hidden" }}>
                  <div style={{ height: "100%", width: `${dept.score}%`, background: scoreColor(dept.score), borderRadius: 4, transition: "width 0.6s ease" }} />
                </div>
              </div>
            ))}
          </div>
        )}

        <div style={styles.card}>
          <h2 style={styles.cardTitle}>Category Breakdown</h2>
          {byCategory.map(cat => (
            <div key={`${cat.dept}_${cat.name}`} style={{ marginBottom: 14 }}>
              <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 4, fontSize: 13 }}>
                <span style={{ fontWeight: 600 }}>
                  {byDept.length > 1 && <span style={{ fontSize: 11, color: "var(--text3)", marginRight: 4 }}>{cat.dept}:</span>}
                  {cat.name}
                </span>
                <span style={{ color: scoreColor(cat.score), fontWeight: 700 }}>{cat.score}%</span>
              </div>
              <div style={{ height: 8, background: "var(--bg3,#e5e7eb)", borderRadius: 4, overflow: "hidden" }}>
                <div style={{ height: "100%", width: `${cat.score}%`, background: scoreColor(cat.score), borderRadius: 4, transition: "width 0.6s ease" }} />
              </div>
            </div>
          ))}
        </div>

        {gaps.length > 0 && (
          <div style={styles.card}>
            <h2 style={styles.cardTitle}>Gaps to Address ({gaps.length})</h2>
            {gaps.map(q => {
              const isNo = allAnswers[q.id] === "no";
              return (
                <div key={q.id} style={{ padding: "10px 12px", marginBottom: 8, borderLeft: `3px solid ${isNo ? "var(--red,#dc2626)" : "var(--amber,#d97706)"}`, background: "var(--bg3,#f9fafb)", borderRadius: "0 6px 6px 0" }}>
                  <div style={{ fontSize: 11, fontWeight: 700, color: "var(--text3)", textTransform: "uppercase", letterSpacing: "0.04em", marginBottom: 2 }}>
                    {byDept.length > 1 ? `${q.dept} · ` : ""}{q.cat} · {isNo ? "Not in place" : "Partial"}
                  </div>
                  <div style={{ fontSize: 13, color: "var(--text)", lineHeight: 1.5 }}>{q.text}</div>
                </div>
              );
            })}
          </div>
        )}

        <div style={{ ...styles.card, background: "var(--accent,#2563eb)", color: "#fff", textAlign: "center" }}>
          <h2 style={{ margin: "0 0 8px", fontSize: 18 }}>Close the gaps with PRISM</h2>
          <p style={{ fontSize: 13, opacity: 0.85, margin: "0 0 20px", lineHeight: 1.6 }}>PRISM tracks your compliance posture over time — assign owners, record evidence, set reminders, and always be audit-ready across DPDPA, ISO 27001, and GDPR.</p>
          <Link to="/register" style={{ display: "inline-block", padding: "12px 24px", background: "#fff", color: "var(--accent,#2563eb)", borderRadius: 8, fontWeight: 700, fontSize: 14, textDecoration: "none" }}>Start a full PRISM assessment →</Link>
        </div>

        <div style={{ textAlign: "center", marginTop: 16 }}>
          {activeQuestions.length > 0 && <><button onClick={() => { setCurrent(0); setPhase("assessing"); }} style={styles.ghostBtn}>← Review answers</button>&nbsp;&nbsp;</>}
          <button onClick={handleRestart} style={styles.ghostBtn}>Restart assessment</button>
        </div>
      </div>
    </div>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────
const styles = {
  shell: { minHeight: "100vh", background: "var(--bg,#f9fafb)", fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif" },
  header: { display: "flex", alignItems: "center", justifyContent: "space-between", padding: "14px 24px", background: "var(--bg2,#fff)", borderBottom: "1px solid var(--border2,#e5e7eb)", position: "sticky", top: 0, zIndex: 10 },
  body: { maxWidth: 520, margin: "0 auto", padding: "32px 16px 64px" },
  introBadge: { textAlign: "center", display: "inline-block", width: "100%", fontSize: 12, fontWeight: 700, letterSpacing: "0.06em", textTransform: "uppercase", color: "var(--accent,#2563eb)", marginBottom: 12 },
  heroTitle: { fontSize: 26, fontWeight: 800, lineHeight: 1.25, textAlign: "center", color: "var(--text,#111)", margin: "0 0 12px" },
  heroSub: { fontSize: 14, color: "var(--text2,#555)", textAlign: "center", lineHeight: 1.6, margin: "0 0 28px" },
  card: { background: "var(--bg2,#fff)", border: "1px solid var(--border2,#e5e7eb)", borderRadius: 12, padding: "24px", marginBottom: 16 },
  cardTitle: { margin: "0 0 16px", fontSize: 15, fontWeight: 700, color: "var(--text,#111)" },
  label: { display: "block", fontSize: 13, fontWeight: 600, color: "var(--text2,#374151)", marginBottom: 6 },
  input: { width: "100%", padding: "10px 12px", borderRadius: 8, border: "1px solid var(--border2,#d1d5db)", background: "var(--bg,#f9fafb)", color: "var(--text,#111)", fontSize: 14, boxSizing: "border-box", outline: "none" },
  fieldRow: { marginBottom: 16 },
  fieldError: { margin: "4px 0 0", fontSize: 12, color: "var(--red,#dc2626)" },
  primaryBtn: { display: "block", width: "100%", padding: "12px 20px", background: "var(--accent,#2563eb)", color: "#fff", border: "none", borderRadius: 8, fontSize: 15, fontWeight: 700, cursor: "pointer", textAlign: "center", textDecoration: "none" },
  ghostBtn: { background: "none", border: "none", color: "var(--text2,#555)", fontSize: 13, cursor: "pointer", padding: "6px 10px", borderRadius: 6 },
  answerBtn: { padding: "14px 20px", borderRadius: 8, border: "2px solid", cursor: "pointer", fontSize: 15, fontWeight: 500, transition: "all 0.15s ease", textAlign: "left" },
  signInBtn: { padding: "8px 16px", background: "var(--accent,#2563eb)", color: "#fff", borderRadius: 8, fontWeight: 600, fontSize: 13, textDecoration: "none" },
  featureChip: { display: "flex", alignItems: "center", gap: 10, padding: "12px 16px", background: "var(--bg2,#fff)", border: "1px solid var(--border2,#e5e7eb)", borderRadius: 10, minWidth: 160 },
};
